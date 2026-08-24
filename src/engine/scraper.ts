import path from "node:path";
import { config } from "../lib/config";
import { clean, extractEmails, normalizePostLink } from "../lib/filters";
import type { ScrapedPost } from "./simulate";

export interface ScrapeResult {
  posts: ScrapedPost[];
  needsLogin: boolean;
  note?: string;
}

type LogFn = (level: string, msg: string) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isLinkedInLoginPage(url: string): boolean {
  const u = url.toLowerCase();
  if (!u.includes("linkedin.com")) return false;
  return (
    u.includes("/login") || u.includes("/uas/login") || u.includes("/checkpoint")
  );
}

/** True when some tab is on a LinkedIn login/checkpoint page. */
function anyPageOnLogin(context: import("playwright").BrowserContext): boolean {
  return context.pages().some((p) => {
    try {
      return isLinkedInLoginPage(p.url());
    } catch {
      return false; // page may be closing
    }
  });
}

/** True when some tab already shows a signed-in LinkedIn page. */
function hasLoggedInPage(context: import("playwright").BrowserContext): boolean {
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
  context: import("playwright").BrowserContext,
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
 * Live LinkedIn scraping via Playwright with a persistent browser profile.
 *
 * - Opens a NEW Chromium tab on every run and navigates it to your search.
 * - The profile directory keeps your LinkedIn session between runs: on the
 *   first run the window stays open and waits for you to sign in (up to
 *   LINKEDIN_LOGIN_WAIT_SEC); that login is stored, so all future runs are
 *   directly logged in.
 * - Only loaded when ENGINE_MODE=live and the run is not a dry run.
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

  let context: import("playwright").BrowserContext;
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
      await page.waitForTimeout(4000);
      if (isLinkedInLoginPage(page.url())) {
        return {
          posts: [],
          needsLogin: true,
          note:
            "LinkedIn is still showing the login page after sign-in — the session did not stick. Start the run again.",
        };
      }
    }

    const posts: ScrapedPost[] = [];
    const seen = new Set<string>();
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

      const selectors = [
        "div.feed-shared-update-v2",
        "li.reusable-search__result-container",
        "div[data-urn]",
      ];

      let newFound = 0;
      for (const selector of selectors) {
        const cards = await page.locator(selector).all();
        for (const card of cards) {
          try {
            const text = clean(await card.innerText({ timeout: 900 }));
            if (text.length < 40) continue;
            const low = text.toLowerCase();
            if (
              ["home my network jobs messaging", "skip to main content", "sort by", "content type"].some((j) =>
                low.includes(j)
              )
            )
              continue;
            const emails = extractEmails(text);
            if (emails.length === 0) continue;

            // Try to resolve a canonical post link from the card.
            let postLink = "";
            try {
              const hrefs: string[] = await card.evaluate((el) =>
                Array.from(el.querySelectorAll("a[href]"))
                  .map((a) => (a as HTMLAnchorElement).href || a.getAttribute("href") || "")
                  .filter(Boolean)
              );
              for (const href of hrefs) {
                const fixed = normalizePostLink(new URL(href, "https://www.linkedin.com").toString());
                if (fixed) {
                  postLink = fixed;
                  break;
                }
              }
            } catch {
              /* ignore */
            }
            if (!postLink) {
              postLink = `https://www.linkedin.com/feed/update/urn:li:activity:0/`;
            }

            const key = postLink + "|" + text.slice(0, 200);
            if (seen.has(key)) continue;
            seen.add(key);
            newFound++;

            const author = text.split("\n")[0]?.trim() ?? "";
            posts.push({
              author,
              headline: "",
              text,
              emails,
              postLink,
            });
          } catch {
            /* ignore card errors */
          }
        }
      }

      log("info", `Scroll round ${round + 1}/${scrollRounds}: ${posts.length} posts with recruiter emails visible so far`);
      if (newFound === 0) stagnantRounds++;
      else stagnantRounds = 0;

      await page.mouse.wheel(0, 1800);
      await page.waitForTimeout(900);
    }

    return { posts, needsLogin: false };
  } finally {
    await context.close().catch(() => undefined);
  }
}
