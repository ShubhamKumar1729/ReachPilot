import path from "node:path";
import { config } from "../lib/config";
import { clean, extractEmails, normalizePostLink } from "../lib/filters";
import type { ScrapedPost } from "./simulate";

export interface ScrapeResult {
  posts: ScrapedPost[];
  needsLogin: boolean;
  note?: string;
}

/**
 * Live LinkedIn scraping via Playwright with a persistent browser profile.
 * The profile directory keeps your LinkedIn session between runs — log in once.
 * This module is only loaded when ENGINE_MODE=live.
 */
export async function scrapeLinkedInPosts(opts: {
  query: string;
  scrollRounds: number;
  log: (level: string, msg: string) => void;
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

  const context = await chromium.launchPersistentContext(profileDir, {
    headless,
    viewport: { width: 1400, height: 900 },
    permissions: ["clipboard-read", "clipboard-write"],
    args: ["--disable-blink-features=AutomationControlled"],
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());

    const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(query)}&origin=GLOBAL_SEARCH_HEADER`;
    log("info", `Navigating to LinkedIn posts search: "${query}"`);
    await page.goto(searchUrl, { timeout: 60_000, waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);

    if (page.url().includes("/login") || page.url().includes("/checkpoint")) {
      log("warn", "LinkedIn login required. Log in once in the opened browser window; the session persists for future runs.");
      return { posts: [], needsLogin: true, note: "LinkedIn login required — open the browser window and sign in." };
    }

    const posts: ScrapedPost[] = [];
    const seen = new Set<string>();
    let stagnantRounds = 0;

    for (let round = 0; round < scrollRounds && stagnantRounds < 3; round++) {
      // Expand "...more" so full post text (and emails) become visible.
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
