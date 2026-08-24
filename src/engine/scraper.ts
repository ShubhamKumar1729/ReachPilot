import path from "node:path";
import { config } from "../lib/config";
import { clean, extractEmails, normalizePostLink } from "../lib/filters";

/** A post scraped from the LinkedIn search results feed. */
export interface ScrapedPost {
  author: string;
  headline: string;
  text: string;
  emails: string[];
  postLink: string;
}

export interface ScrapeResult {
  posts: ScrapedPost[];
  needsLogin: boolean;
  note?: string;
}

type LogFn = (level: string, msg: string) => void;
type PWPage = import("playwright").Page;
type PWContext = import("playwright").BrowserContext;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isLinkedInLoginPage(url: string): boolean {
  const u = url.toLowerCase();
  if (!u.includes("linkedin.com")) return false;
  return (
    u.includes("/login") || u.includes("/uas/login") || u.includes("/checkpoint")
  );
}

/** True when some tab is on a LinkedIn login/checkpoint page. */
function anyPageOnLogin(context: PWContext): boolean {
  return context.pages().some((p) => {
    try {
      return isLinkedInLoginPage(p.url());
    } catch {
      return false; // page may be closing
    }
  });
}

/** True when some tab already shows a signed-in LinkedIn page. */
function hasLoggedInPage(context: PWContext): boolean {
  return context.pages().some((p) => {
    try {
      return p.url().includes("linkedin.com") && !isLinkedInLoginPage(p.url());
    } catch {
      return false;
    }
  });
}

/**
 * Not signed in yet: keep the browser open and wait for the user to sign in
 * manually. The persistent profile dir stores the session, so this happens
 * ONCE — every later run starts already logged in.
 */
async function waitForManualLogin(
  context: PWContext,
  log: LogFn,
  waitMs: number
): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  let nextNudge = Date.now();
  while (Date.now() < deadline) {
    await sleep(3000);
    if (hasLoggedInPage(context)) return true;
    if (Date.now() >= nextNudge) {
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      log(
        "info",
        `Still waiting for LinkedIn sign-in in the opened browser window… ${left}s left`
      );
      nextNudge = Date.now() + 30_000;
    }
  }
  return false;
}

interface FoundCard {
  text: string;
  href: string;
}

/**
 * Discover post cards on the results page. LinkedIn renames its CSS classes
 * often, so we combine (a) known container selectors with (b) a fallback that
 * anchors on real post links (/feed/update/urn:li:activity:… and /posts/…)
 * and climbs to the nearest text-rich container.
 */
async function findPostCards(page: PWPage): Promise<FoundCard[]> {
  const cards: FoundCard[] = [];
  const seen = new Set<string>();

  const push = (rawText: string, hrefs: string[]) => {
    const text = clean(rawText);
    if (text.length < 40) return;
    const key = text.slice(0, 200);
    if (seen.has(key)) return;
    seen.add(key);
    let postHref = "";
    for (const h of hrefs) {
      if (
        h.includes("/feed/update/urn:li:activity:") ||
        h.includes("/posts/")
      ) {
        postHref = h;
        break;
      }
    }
    cards.push({ text, href: postHref });
  };

  // Strategy 1: known container selectors.
  const selectors = [
    "div.feed-shared-update-v2",
    "div.occludable-update",
    "li.reusable-search__result-container",
    "li[data-view-name]",
  ];
  for (const selector of selectors) {
    let els: import("playwright").Locator[] = [];
    try {
      els = await page.locator(selector).all();
    } catch {
      continue;
    }
    for (const el of els) {
      try {
        const text = await el.innerText({ timeout: 800 });
        const hrefs = (await el.evaluate((node) =>
          Array.from(node.querySelectorAll("a[href]")).map(
            (a) => a.getAttribute("href") || ""
          )
        )) as string[];
        push(text, hrefs);
      } catch {
        /* skip broken card */
      }
    }
  }

  // Strategy 2: anchor on real post links and climb to a text-rich ancestor.
  try {
    const found: FoundCard[] = await page.evaluate(() => {
      const anchors = Array.from(
        document.querySelectorAll(
          'a[href*="/feed/update/urn:li:activity:"], a[href*="/posts/"]'
        )
      );
      const seenText = new Set<string>();
      const out: FoundCard[] = [];
      for (const a of anchors) {
        let node: Element | null = a;
        for (let i = 0; i < 8 && node && node.parentElement; i++) {
          node = node.parentElement;
          if (((node as HTMLElement).innerText || "").length > 120) break;
        }
        const text = ((node && (node as HTMLElement).innerText) || "").trim();
        if (text.length < 40) continue;
        const key = text.slice(0, 200);
        if (seenText.has(key)) continue;
        seenText.add(key);
        out.push({ text, href: a.getAttribute("href") || "" });
      }
      return out;
    });
    for (const f of found) push(f.text, [f.href]);
  } catch {
    /* ignore — strategy 1 may have found enough */
  }

  return cards;
}

/**
 * Live LinkedIn scraping via Playwright with a persistent browser profile.
 *
 * - Opens a NEW Chromium tab on every run and navigates it to your search.
 * - The profile directory keeps your LinkedIn session between runs: on the
 *   first run the window stays open and waits for you to sign in (up to
 *   LINKEDIN_LOGIN_WAIT_SEC); that login is stored, so all future runs are
 *   directly logged in.
 * - Used by every run — there is no simulation mode.
 */
export async function scrapeLinkedInPosts(opts: {
  query: string;
  scrollRounds: number;
  log: LogFn;
}): Promise<ScrapeResult> {
  const { query, scrollRounds, log } = opts;
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return {
      posts: [],
      needsLogin: true,
      note: "Playwright is not installed in this environment. Run `npx playwright install chromium` locally to enable live mode.",
    };
  }

  const profileDir = path.join(/*turbopackIgnore: true*/ process.cwd(), config.linkedinProfileDir);
  const headless = process.env.SCRAPER_HEADLESS === "1";
  const loginWaitSec = config.linkedinLoginWaitSec;

  log(
    "info",
    headless
      ? "Launching headless Chromium with your saved LinkedIn profile..."
      : "Opening a new Chromium window + tab with your saved LinkedIn session..."
  );

  let context: PWContext;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless,
      viewport: { width: 1400, height: 900 },
      permissions: ["clipboard-read", "clipboard-write"],
      args: ["--disable-blink-features=AutomationControlled"],
    });
  } catch (err) {
    const msg =
      err instanceof Error ? err.message.split("\n")[0] : String(err);
    return {
      posts: [],
      needsLogin: true,
      note: `Chromium could not be launched (${msg}). If you are on a machine without a display, set SCRAPER_HEADLESS=1.`,
    };
  }

  try {
    const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(query)}&origin=GLOBAL_SEARCH_HEADER`;

    // Prefer the fresh about:blank first tab; otherwise open a brand-new one.
    let page = context.pages()[0];
    if (!page || !page.url().startsWith("about:")) {
      page = await context.newPage();
    }
    log("info", "New Chromium tab ready — navigating to LinkedIn posts search.");
    log("info", `Navigating to LinkedIn posts search: "${query}"`);
    await page.goto(searchUrl, { timeout: 60_000, waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);

    // First run (or expired session): no saved login — wait for the user to
    // sign in in the opened window, then the session is stored for good.
    if (isLinkedInLoginPage(page.url()) || anyPageOnLogin(context)) {
      log(
        "warn",
        `No LinkedIn session found — sign in now in the opened browser window. ` +
          `It only takes ~30s; the login is then STORED and every future run starts logged in.`
      );
      const loggedIn = await waitForManualLogin(
        context,
        log,
        loginWaitSec * 1000
      );
      if (!loggedIn) {
        return {
          posts: [],
          needsLogin: true,
          note:
            `LinkedIn sign-in not completed within ${loginWaitSec}s. Start the run again and sign in ` +
            `in the opened browser window — the session is saved for all future runs.`,
        };
      }
      log(
        "ok",
        "LinkedIn login confirmed — session stored in the persistent profile; future runs skip sign-in."
      );
      // Re-open the search in our tab now that we are authenticated.
      await page.goto(searchUrl, {
        timeout: 60_000,
        waitUntil: "domcontentloaded",
      });
    }

    // Wait for the results to actually render (containers or post links).
    try {
      await page.waitForSelector(
        'li.reusable-search__result-container, div.occludable-update, div.feed-shared-update-v2, a[href*="/feed/update/urn:li:activity:"], a[href*="/posts/"]',
        { timeout: 15_000 }
      );
    } catch {
      log(
        "warn",
        "No result cards rendered within 15s — LinkedIn may have no results for this query (check for typos), or an interstitial dialog is blocking the page."
      );
    }
    await page.waitForTimeout(1500);

    const posts: ScrapedPost[] = [];
    const seen = new Set<string>();
    let cardsSeen = 0;
    let stagnantRounds = 0;

    for (let round = 0; round < scrollRounds && stagnantRounds < 3; round++) {
      // Expand "…more" so full post text (and emails) become visible.
      try {
        const more = page.getByText(/\.\.\.more|…more|see more/i);
        const count = Math.min(await more.count(), 15);
        for (let i = 0; i < count; i++) {
          try {
            await more.nth(i).click({ timeout: 600 });
          } catch {
            /* ignore */
          }
          await page.waitForTimeout(150);
        }
      } catch {
        /* ignore */
      }

      const cards = await findPostCards(page);
      let newCards = 0;
      for (const card of cards) {
        const low = card.text.toLowerCase();
        if (
          ["home my network jobs messaging", "skip to main content", "sort by", "content type"].some((j) =>
            low.includes(j)
          )
        )
          continue;

        let postLink = "";
        try {
          postLink = card.href
            ? normalizePostLink(new URL(card.href, "https://www.linkedin.com").toString())
            : "";
        } catch {
          postLink = "";
        }
        if (!postLink) {
          postLink = `https://www.linkedin.com/feed/update/urn:li:activity:0/`;
        }

        const key = postLink + "|" + card.text.slice(0, 200);
        if (seen.has(key)) continue;
        seen.add(key);
        cardsSeen++;
        newCards++;

        const author = card.text.split("\n")[0]?.trim() ?? "";
        const emails = extractEmails(card.text);
        if (emails.length > 0) {
          posts.push({
            author,
            headline: "",
            text: card.text,
            emails,
            postLink,
          });
          log(
            "ok",
            `Post with visible recruiter email: ${emails.join(", ")} — ${author || "unknown"}`
          );
        }
      }

      log(
        "info",
        `Scroll round ${round + 1}/${scrollRounds}: ${cardsSeen} post card(s) scanned — ${posts.length} with a visible recruiter email`
      );
      if (newCards === 0) stagnantRounds++;
      else stagnantRounds = 0;

      await page.mouse.wheel(0, 1800);
      await page.waitForTimeout(900);
    }

    if (cardsSeen === 0) {
      const title = await page.title().catch(() => "");
      const noResults = await page
        .getByText(/no results|couldn.?t find|didn.?t find|nothing to show/i)
        .count()
        .catch(() => 0);
      log(
        "warn",
        `No post cards detected at all (page: "${title}", url: ${page.url()}). ` +
          (noResults > 0
            ? `LinkedIn shows no results for "${query}" — try a simpler query, e.g. "java developer W2".`
            : `The results page may have loaded differently than expected — try a simpler query and check the opened browser tab manually.`)
      );
    } else if (posts.length === 0) {
      log(
        "warn",
        `${cardsSeen} post(s) were found, but none of them contain a visible email address in the post body. ` +
          `Recruiters often put emails in the COMMENTS instead — try a more targeted query (e.g. "java developer W2 urgent hiring").`
      );
    }

    return { posts, needsLogin: false };
  } finally {
    await context.close().catch(() => undefined);
  }
}
