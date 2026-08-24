import fs from "node:fs";
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

/**
 * Scroll the feed. LinkedIn's search results live in an INNER scroll
 * container — plain wheel events often hit the window and nothing moves.
 * So: aim the mouse at the results column, scroll the real inner
 * scroller, and wheel as well (extra scroll just lazy-loads more posts).
 */
async function scrollFeed(page: PWPage): Promise<void> {
  try {
    await page.mouse.move(900, 500);
  } catch {
    /* ignore */
  }
  try {
    await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll("main *"));
      const scrollers = all.filter(
        (el) =>
          el.scrollHeight > el.clientHeight + 200 &&
          ["auto", "scroll"].includes(getComputedStyle(el).overflowY)
      );
      scrollers.sort((a, b) => b.scrollHeight - a.scrollHeight);
      if (scrollers[0]) (scrollers[0] as HTMLElement).scrollBy(0, 1600);
      else window.scrollBy(0, 1600);
    });
  } catch {
    /* ignore */
  }
  try {
    await page.mouse.wheel(0, 1600);
  } catch {
    /* ignore */
  }
  await page.waitForTimeout(1200); // let lazy-loaded posts render
}

/**
 * Log the page's "DOM fingerprint": most-used CSS classes + most-common
 * link href patterns. This reveals the current LinkedIn markup so the
 * card selectors can be written precisely.
 */
async function logDomFingerprint(page: PWPage, log: LogFn): Promise<void> {
  try {
    const fp = await page.evaluate(() => {
      const classCount: Record<string, number> = {};
      for (const el of Array.from(document.querySelectorAll("[class]"))) {
        for (const c of el.classList) classCount[c] = (classCount[c] || 0) + 1;
      }
      const topClasses = Object.entries(classCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25)
        .map(([c, n]) => `${c}x${n}`);
      const hrefGroups: Record<string, number> = {};
      const links = Array.from(document.querySelectorAll("a[href]"));
      for (const a of links) {
        const h = a.getAttribute("href") || "";
        const key = h.split("?")[0].replace(/\d{4,}/g, "N").slice(0, 50) || "(no-href)";
        hrefGroups[key] = (hrefGroups[key] || 0) + 1;
      }
      const topHrefs = Object.entries(hrefGroups)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([h, n]) => `${h}x${n}`);
      return { topClasses, topHrefs, linkCount: links.length };
    });
    log("warn", `DOM FINGERPRINT — top classes: ${fp.topClasses.join(", ")}`);
    log("warn", `DOM FINGERPRINT — top hrefs (${fp.linkCount} links total): ${fp.topHrefs.join(" | ")}`);
  } catch {
    /* ignore */
  }
}

/** Save the results area HTML next to the screenshot for ground truth. */
async function saveHtmlSnapshot(page: PWPage, log: LogFn): Promise<void> {
  const dir = path.join(process.cwd(), "output", "debug");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `linkedin_debug_${Date.now()}.html`);
  try {
    const html = await page.evaluate(
      () => (document.querySelector("main") || document.body).outerHTML
    );
    fs.writeFileSync(file, html.slice(0, 3_000_000));
    log("warn", `PAGE HTML SAVED: ${file} — attach this file to your next message so I can read the exact page structure.`);
  } catch {
    /* ignore */
  }
}

async function isVisible(
  loc: import("playwright").Locator,
  timeout = 1000
): Promise<boolean> {
  try {
    await loc.first().waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

/** Compact visible text of the page — used as a last-resort diagnostic. */
async function pageVisibleText(page: PWPage, max = 2000): Promise<string> {
  try {
    return await page.evaluate(
      (n) => (document.body.innerText || "").slice(0, n),
      max
    );
  } catch {
    return "";
  }
}

/**
 * Dismiss the benign pop-ups LinkedIn likes to put over search results
 * (cookie banner, survey, "no thanks", …). Only clicks well-known,
 * harmless labels.
 */
async function tryDismissInterstitials(page: PWPage, log: LogFn): Promise<void> {
  const patterns = [
    /^got it$/i,
    /^accept all cookies?$/i,
    /^accept all$/i,
    /^no thanks,? continue/i,
    /^no thanks$/i,
    /^dismiss$/i,
  ];
  for (const re of patterns) {
    const btn = page.getByRole("button", { name: re });
    if (await isVisible(btn, 400)) {
      try {
        await btn.first().click({ timeout: 1000 });
        log("info", `Dismissed a page dialog ("${re.source}")`);
        await page.waitForTimeout(800);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Make sure we're on the POSTS (content) tab of the search results —
 * LinkedIn sometimes lands on People/Companies even when the URL says
 * content, or a redirect after login can drop the tab.
 */
async function ensurePostsTab(page: PWPage, log: LogFn): Promise<void> {
  try {
    if (page.url().includes("search/results/content")) return;
    const tab = page
      .locator('a[href*="search/results/content"]')
      .filter({ hasText: /posts/i })
      .first();
    if (await isVisible(tab, 1500)) {
      await tab.click({ timeout: 2000 });
      log("info", "Switched to the 'Posts' tab on the search results page.");
      await page.waitForTimeout(3000);
    } else {
      log(
        "warn",
        `Search results page is not on the content tab (url: ${page.url()}) and no 'Posts' tab link was found.`
      );
    }
  } catch {
    /* ignore */
  }
}

/** A post card found on the results page (text + optional post href). */
interface FoundCard {
  text: string;
  href: string;
}

/** How many cards each discovery strategy contributed. */
interface CardStats {
  byContainer: number;
  byAnchor: number;
  byUrn: number;
  byHeuristic: number;
}

/**
 * Discover post cards on the results page. LinkedIn renames its CSS classes
 * often, so four strategies are combined and deduplicated:
 *   1. known container selectors (class-name based),
 *   2. real post links (/feed/update/urn:li:activity:… and /posts/…) —
 *      climb to the nearest text-rich container,
 *   3. LinkedIn data attributes (data-urn / data-occludable-update-urn /
 *      data-chameleon-result-urn) — the permalink is BUILT from the
 *      urn:li:activity:<id> value, no class names or anchors needed,
 *   4. content heuristic — text-rich elements that read like a recruiting
 *      post (role keywords, your query words, or an email address).
 */
async function findPostCards(
  page: PWPage,
  query: string
): Promise<{ cards: FoundCard[]; stats: CardStats }> {
  const cards: FoundCard[] = [];
  const seen = new Set<string>();
  const stats: CardStats = { byContainer: 0, byAnchor: 0, byUrn: 0, byHeuristic: 0 };

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

  stats.byContainer = cards.length;

  // Strategies 2-4 in a single page pass.
  try {
    const queryWords = (query || "")
      .toLowerCase()
      .split(/[^a-z0-9+#.]+/)
      .filter((w) => w.length >= 3);

    const found: {
      text: string;
      href: string;
      via: "anchor" | "urn" | "heuristic";
    }[] = await page.evaluate((words: string[]) => {
      const emailRe = /[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/;
      const kwRe =
        /\b(hiring|recruit|recruiter|developer|engineer|analyst|consultant|contract|c2c|job|job opening|opportunity|position|walk[\s-]?in|interview|immediate joiner|urgent)\b/i;

      const out: {
        text: string;
        href: string;
        via: "anchor" | "urn" | "heuristic";
      }[] = [];
      const seenText = new Set<string>();

      // Find a post link inside an element: first a real anchor, otherwise
      // build one from a data-urn value (urn:li:activity:<id>).
      const hrefFrom = (el: HTMLElement): string => {
        for (const a of Array.from(el.querySelectorAll("a[href]"))) {
          const h = a.getAttribute("href") || "";
          if (
            h.includes("/posts/") ||
            h.includes("/feed/update/urn:li:activity:")
          )
            return h;
        }
        for (const u of Array.from(
          el.querySelectorAll("[data-urn], [data-occludable-update-urn]")
        )) {
          const v =
            u.getAttribute("data-urn") ||
            u.getAttribute("data-occludable-update-urn") ||
            "";
          const m = v.match(/urn:li:(?:activity|ugcPost):(\d+)/i);
          if (m)
            return `https://www.linkedin.com/feed/update/urn:li:activity:${m[1]}/`;
        }
        return "";
      };

      const add = (
        text: string,
        href: string,
        via: "anchor" | "urn" | "heuristic"
      ) => {
        const t = text.trim();
        if (t.length < 40) return;
        const key = t.slice(0, 200);
        if (seenText.has(key)) return;
        seenText.add(key);
        out.push({ text: t, href, via });
      };

      // Strategy 2: real post links → climb to a text-rich ancestor.
      const anchors = Array.from(
        document.querySelectorAll(
          'a[href*="/feed/update/urn:li:activity:"], a[href*="/posts/"]'
        )
      );
      for (const a of anchors) {
        let node: Element | null = a;
        for (let i = 0; i < 8 && node && node.parentElement; i++) {
          node = node.parentElement;
          if (((node as HTMLElement).innerText || "").length > 120) break;
        }
        add(
          node ? (node as HTMLElement).innerText || "" : "",
          a.getAttribute("href") || "",
          "anchor"
        );
      }

      // Strategy 3: LinkedIn data attributes — the permalink is built
      // straight from the URN, so no anchor or class name is required.
      const ownUrnHref = (el: Element): string => {
        const v =
          el.getAttribute("data-urn") ||
          el.getAttribute("data-occludable-update-urn") ||
          el.getAttribute("data-chameleon-result-urn") ||
          "";
        const m = v.match(/urn:li:(?:activity|ugcPost):(\d+)/i);
        return m
          ? `https://www.linkedin.com/feed/update/urn:li:activity:${m[1]}/`
          : "";
      };
      const climbToCard = (start: Element): HTMLElement | null => {
        let node: Element | null = start;
        for (let i = 0; i < 12 && node; i++) {
          const text = ((node as HTMLElement).innerText || "").trim();
          if (text.length >= 80 && text.length <= 8000)
            return node as HTMLElement;
          node = node.parentElement;
        }
        return null;
      };
      const urnSelectors = [
        '[data-urn*="activity"]',
        '[data-urn*="ugcPost"]',
        "[data-occludable-update-urn]",
        "[data-chameleon-result-urn]",
      ];
      for (const sel of urnSelectors) {
        for (const el of Array.from(document.querySelectorAll(sel))) {
          const card = climbToCard(el);
          if (!card) continue;
          add(card.innerText || "", ownUrnHref(el) || hrefFrom(card), "urn");
        }
      }

      // Strategy 4: content heuristic — text-rich elements that read like a
      // recruiting post. Only the SMALLEST matching element per post is kept,
      // so big wrapper divs are skipped.
      const hasPostSignal = (text: string): boolean => {
        if (emailRe.test(text)) return true;
        if (kwRe.test(text)) return true;
        const low = text.toLowerCase();
        return words.some((w) => low.includes(w));
      };
      const cands: { el: HTMLElement; text: string }[] = [];
      for (const el of Array.from(
        document.querySelectorAll("div, section, article, li")
      )) {
        const text = (el as HTMLElement).innerText || "";
        if (text.length < 100 || text.length > 8000) continue;
        if (el.children.length < 2 || el.children.length > 60) continue;
        if (!hasPostSignal(text)) continue;
        cands.push({ el: el as HTMLElement, text: text.trim() });
      }
      cands.sort((a, b) => a.text.length - b.text.length);
      const keptPrefixes: string[] = [];
      for (const c of cands) {
        if (out.length >= 30) break;
        const prefix = c.text.slice(0, 200);
        if (keptPrefixes.includes(prefix)) continue;
        if (keptPrefixes.some((p) => c.text.includes(p)))
          continue; // this element wraps an already-kept card
        if (seenText.has(prefix)) continue;
        seenText.add(prefix);
        keptPrefixes.push(prefix);
        out.push({ text: c.text, href: hrefFrom(c.el), via: "heuristic" });
      }

      return out;
    }, queryWords);

    for (const f of found) {
      const key = clean(f.text).slice(0, 200);
      if (seen.has(key)) continue;
      push(f.text, [f.href]);
      if (f.via === "anchor") stats.byAnchor++;
      else if (f.via === "urn") stats.byUrn++;
      else stats.byHeuristic++;
    }
  } catch {
    /* ignore — an earlier strategy may have found enough */
  }

  return { cards, stats };
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
        'li.reusable-search__result-container, div.occludable-update, div.feed-shared-update-v2, a[href*="/feed/update/urn:li:activity:"], a[href*="/posts/"], [data-urn*="activity"]',
        { timeout: 15_000 }
      );
    } catch {
      log(
        "warn",
        "No result cards rendered within 15s — LinkedIn may have no results for this query (check for typos), or an interstitial dialog is blocking the page."
      );
    }
    await page.waitForTimeout(1500);

    // Pre-scrape recovery: right tab, no blocking dialog, one reload if
    // the results panel still hasn't hydrated.
    await ensurePostsTab(page, log);
    await tryDismissInterstitials(page, log);
    if ((await findPostCards(page, query)).cards.length === 0) {
      log("info", "Still no cards visible — reloading the results page once...");
      try {
        await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
        await page.waitForTimeout(4000);
        await ensurePostsTab(page, log);
        await tryDismissInterstitials(page, log);
      } catch {
        /* ignore */
      }
    }

    const posts: ScrapedPost[] = [];
    const seen = new Set<string>();
    let cardsSeen = 0;
    let stagnantRounds = 0;
    let statsLogged = false;

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

      const { cards, stats } = await findPostCards(page, query);
      if (cards.length > 0 && !statsLogged) {
        statsLogged = true;
        log(
          "info",
          `Card discovery breakdown: containers=${stats.byContainer}, post-links=${stats.byAnchor}, data-urn=${stats.byUrn}, content-heuristic=${stats.byHeuristic}`
        );
      }
      if (cards.length === 0) {
        // A dialog may have popped up over the results — try clearing it.
        await tryDismissInterstitials(page, log);
      }
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

      await scrollFeed(page);
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
            : `Something is between the bot and the results (a dialog, a Premium nudge, or a changed page). Saving a screenshot + page text so we can see it.`)
      );
      // Ground truth: screenshot + visible page text.
      const shotDir = path.join(process.cwd(), "output", "debug");
      fs.mkdirSync(shotDir, { recursive: true });
      const shot = path.join(shotDir, `linkedin_debug_${Date.now()}.png`);
      try {
        await page.screenshot({ path: shot });
        log("warn", `SCREENSHOT SAVED: ${shot} — open it (folder output/debug) and send me the image so I can see exactly what the page shows.`);
      } catch {
        /* ignore */
      }
      const bodyText = (await pageVisibleText(page, 2000)).replace(/\s+/g, " ").slice(0, 1200);
      if (bodyText) {
        log("warn", `PAGE TEXT (first 1200 chars): ${bodyText}`);
      }
      const lowText = bodyText.toLowerCase();
      if (
        lowText.includes("unusual activity") ||
        lowText.includes("checkpoint") ||
        lowText.includes("security verification")
      ) {
        log(
          "warn",
          "LinkedIn is showing a SECURITY CHECK on this page — solve it in the opened browser window (or wait 10-15 minutes and re-run). Nothing is sent while the check is up."
        );
      }
      await logDomFingerprint(page, log);
      await saveHtmlSnapshot(page, log);
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
