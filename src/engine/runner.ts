import { randomUUID } from "node:crypto";
import {
  isDuplicateKeyError,
  logsCol,
  nextLogSeq,
  runsCol,
  sentCol,
  type RunDoc,
  type SentDoc,
} from "@/db";
import { config, isGroqConfigured, isSmtpConfigured } from "@/lib/config";
import {
  filterRecruiterEmails,
  normalizeEmail,
  normalizePostLink,
  shouldSendToPost,
} from "@/lib/filters";
import { buildEmail } from "@/lib/email";
import { customizeResumeForPost, matchSkillsForPost } from "@/lib/groq";
import {
  baseResumeProfile,
  ensureBaseResume,
  renderCustomResume,
} from "@/lib/resume";
import { sendEmail } from "./sender";
import { scrapeLinkedInPosts, type ScrapedPost } from "./scraper";

type RunHandle = { stop: boolean };

const globalEngine = globalThis as typeof globalThis & {
  __reachPilotRuns?: Map<string, RunHandle>;
};

function registry(): Map<string, RunHandle> {
  if (!globalEngine.__reachPilotRuns) globalEngine.__reachPilotRuns = new Map();
  return globalEngine.__reachPilotRuns;
}

export function stopRun(runId: string): boolean {
  const h = registry().get(runId);
  if (h) {
    h.stop = true;
    return true;
  }
  return false;
}

export function isRunActive(runId: string): boolean {
  return registry().has(runId);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function log(runId: string, level: string, message: string) {
  try {
    const logs = await logsCol();
    const seq = await nextLogSeq();
    await logs.insertOne({ runId, seq, level, message, createdAt: new Date() });
  } catch {
    /* logging must never crash the engine */
  }
}

async function alreadySent(email: string, postLink: string): Promise<boolean> {
  const sent = await sentCol();
  const found = await sent.findOne(
    { email, postLink },
    { projection: { _id: 1 } }
  );
  return Boolean(found);
}

export function startRun(runId: string): void {
  if (registry().has(runId)) return;
  registry().set(runId, { stop: false });
  // Fire and forget — runs in the Node server process.
  void executeRun(runId).finally(() => {
    registry().delete(runId);
  });
}

async function setRunStatus(runId: string, patch: Partial<RunDoc>) {
  const runs = await runsCol();
  await runs.updateOne({ _id: runId }, { $set: patch });
}

async function executeRun(runId: string): Promise<void> {
  const handle = registry().get(runId)!;
  const runs = await runsCol();
  const run = await runs.findOne({ _id: runId });
  if (!run) return;

  const L = (level: string, msg: string) => log(runId, level, msg);
  await setRunStatus(runId, { status: "running" });

  try {
    await L("sys", `Run initialized — role: "${run.role}"`);
    await L("info", `Search query: ${run.query}`);
    await L("info", `Target: ${run.maxEmails} email(s) | Resume AI customization: ${run.customizeResume ? "ON (Groq)" : "OFF"} | Mode: LIVE (real Chromium + LinkedIn + Gmail)`);

    if (!isSmtpConfigured()) {
      throw new Error(
        "GMAIL_ID / GMAIL_APP_PASSWORD not configured — every run is a live send. Add them to .env and restart the server."
      );
    }
    if (run.customizeResume && !isGroqConfigured()) {
      await L("warn", "GROQ_API_KEY not configured — falling back to the base resume for every send.");
    }

    // 1) Build / locate the base resume once.
    await L("info", "Preparing base resume PDF in output/ ...");
    const basePdf = await ensureBaseResume(run.role);
    const baseProfile = baseResumeProfile(run.role);
    await L("ok", `Base resume ready: ${config.resumeFilename}`);

    // 2) Open Chromium and acquire the feed of real LinkedIn posts.
    await L("info", "Launching LinkedIn live scrape (Playwright persistent profile)...");
    const res = await scrapeLinkedInPosts({
      query: run.query,
      scrollRounds: config.bot.scrollRounds,
      log: (lvl, msg) => void log(runId, lvl, msg),
    });
    if (res.needsLogin) {
      throw new Error(res.note ?? "LinkedIn login required.");
    }
    const feed: ScrapedPost[] = res.posts;

    if (feed.length === 0) {
      await L("warn", "No posts with recruiter emails found. Try widening the search query.");
      await setRunStatus(runId, { status: "completed", finishedAt: new Date() });
      return;
    }

    // 3) Walk posts -> verify genuine -> extract emails -> personalize -> send.
    const sent = await sentCol();
    let sentCount = 0;
    let skipped = 0;
    const emailedThisRun = new Set<string>();
    const seenPosts = new Set<string>();

    for (let i = 0; i < feed.length; i++) {
      if (handle.stop) break;
      if (sentCount >= run.maxEmails) break;

      const post = feed[i];
      const postLink = normalizePostLink(post.postLink) || post.postLink;
      // 2026 LinkedIn cards frequently have no permalink — dedupe by content
      // in that case, or every link-less post looks like a duplicate of the
      // first one and the whole feed gets dropped.
      const postKey =
        postLink || `text:${post.text.slice(0, 200).toLowerCase()}`;
      if (seenPosts.has(postKey)) continue;
      seenPosts.add(postKey);

      await setRunStatus(runId, { postsScanned: i + 1 });

      const verdict = shouldSendToPost(run.role, post.text);
      if (!verdict.allowed) {
        skipped++;
        await L("warn", `Post ${i + 1} by ${post.author || "unknown"} — skipped: ${verdict.reason}`);
        continue;
      }

      const emails = filterRecruiterEmails(
        post.emails.length > 0 ? post.emails : []
      );
      if (emails.length === 0) {
        skipped++;
        await L("warn", `Post ${i + 1} (${post.author || "unknown"}) — genuine post but no valid recruiter email, skipped`);
        continue;
      }

      await L("ok", `Genuine post ${i + 1} by ${post.author || "unknown"} — ${emails.length} recruiter email(s): ${emails.join(", ")}`);

      // Personalization per post (shared by recipients of the same post).
      let matchedSkills = "";
      let customPdfPath: string | null = null;

      if (run.customizeResume && isGroqConfigured()) {
        await L("info", `Groq: analyzing JD from post ${i + 1} for role "${run.role}" ...`);
        const [skills, custom] = await Promise.all([
          matchSkillsForPost(run.role, post.text),
          customizeResumeForPost(run.role, post.text, baseProfile),
        ]);
        if (skills) {
          matchedSkills = skills;
          await L("ok", `Groq skill match: ${skills}`);
        } else {
          await L("warn", "Groq skill match unavailable — using default pitch line.");
        }
        if (custom) {
          try {
            customPdfPath = await renderCustomResume(custom, runId, sentCount + 1);
            await L("ok", `Groq: JD-tailored resume rendered for ${post.author || "recruiter"}`);
          } catch {
            await L("warn", "Custom resume render failed — base resume will be attached instead.");
          }
        } else {
          await L("warn", "Groq customization returned no result — base resume will be attached.");
        }
      }

      for (const rawEmail of emails) {
        if (handle.stop) break;
        if (sentCount >= run.maxEmails) break;

        const email = normalizeEmail(rawEmail);
        if (emailedThisRun.has(email)) {
          skipped++;
          await L("warn", `${email} — already contacted in this run, skipped`);
          continue;
        }
        if (await alreadySent(email, postLink)) {
          skipped++;
          await L("warn", `${email} — duplicate (already emailed for this post), skipped`);
          continue;
        }

        const { subject, text, html } = buildEmail({
          role: run.role,
          matchedSkills,
          postLink,
        });
        const attachmentPath = customPdfPath ?? basePdf;

        try {
          await sendEmail({
            to: email,
            subject,
            text,
            html,
            attachmentPath,
            attachmentName: config.resumeFilename,
          });
          await L("mail", `SENT → ${email} — "${subject}"`);
          if (config.ccEmails.length > 0) await L("info", `CC: ${config.ccEmails.join(", ")}`);
          if (config.bccEmails.length > 0) await L("info", `BCC: ${config.bccEmails.join(", ")}`);

          emailedThisRun.add(email);
          const doc: SentDoc = {
            _id: randomUUID(),
            runId,
            email,
            postLink,
            postAuthor: post.author ?? "",
            role: run.role,
            subject,
            matchedSkills,
            customized: Boolean(customPdfPath),
            status: "SENT",
            error: null,
            sentAt: new Date(),
          };
          try {
            await sent.insertOne(doc);
          } catch (insErr) {
            if (!isDuplicateKeyError(insErr)) throw insErr;
            // unique (email, postLink) already recorded — race-safe dedupe
          }

          sentCount++;
          await setRunStatus(runId, { sentCount, skippedCount: skipped });

          if (sentCount < run.maxEmails) {
            const delayMs = config.bot.delayBetweenEmails * 1000;
            await L("info", `Waiting ${Math.round(delayMs / 1000)}s before next email...`);
            // Sleep in small slices so Stop reacts quickly.
            for (let t = 0; t < delayMs && !handle.stop; t += 500) {
              await sleep(Math.min(500, delayMs - t));
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await L("err", `FAILED to send to ${email}: ${msg}`);
          const failDoc: SentDoc = {
            _id: randomUUID(),
            runId,
            email,
            postLink,
            postAuthor: post.author ?? "",
            role: run.role,
            subject,
            matchedSkills,
            customized: false,
            status: "FAILED",
            error: msg,
            sentAt: new Date(),
          };
          await sent.insertOne(failDoc).catch(() => undefined);
          skipped++;
          await setRunStatus(runId, { skippedCount: skipped });
        }
      }
    }

    await setRunStatus(runId, {
      status: handle.stop ? "stopped" : "completed",
      sentCount,
      skippedCount: skipped,
      postsScanned: feed.length,
      finishedAt: new Date(),
    });
    await L(
      "sys",
      handle.stop
        ? `Run stopped by user — ${sentCount}/${run.maxEmails} emails sent, ${skipped} skipped.`
        : sentCount >= run.maxEmails
          ? `Target reached — ${sentCount}/${run.maxEmails} emails sent. Run complete.`
          : `Reachable recruiter quota exhausted — ${sentCount}/${run.maxEmails} emails sent, ${skipped} skipped. Try a broader query for more.`
    );
    await L("sys", `Daily response target: ${config.dailyResponseTarget} replies/day — more quality posts = better odds, never guaranteed. Keep running fresh queries.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await setRunStatus(runId, {
      status: "failed",
      error: msg,
      finishedAt: new Date(),
    });
    await L("err", `Run failed: ${msg}`);
  }
}
