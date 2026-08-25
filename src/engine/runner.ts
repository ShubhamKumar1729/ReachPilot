import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  isDuplicateKeyError,
  logsCol,
  nextLogSeq,
  resumeVersionsCol,
  runsCol,
  sentCol,
  type RoleCfg,
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

type RunHandle = { stop: boolean; paused: boolean };

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
    h.paused = false;
    return true;
  }
  return false;
}

export function pauseRun(runId: string): boolean {
  const h = registry().get(runId);
  if (h) {
    h.paused = true;
    return true;
  }
  return false;
}

export function resumeRun(runId: string): boolean {
  const h = registry().get(runId);
  if (h) {
    h.paused = false;
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
  registry().set(runId, { stop: false, paused: false });
  // Fire and forget — runs in the Node server process.
  void executeRun(runId).finally(() => {
    registry().delete(runId);
  });
}

/** Block until unpaused (or stopped). Checkpoints: between roles, between
 *  scroll rounds (via scraper), before each email, during email delays. */
async function pauseGate(handle: RunHandle): Promise<void> {
  while (handle.paused && !handle.stop) await sleep(400);
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

  // Multi-role: falls back to the legacy single-role fields for old runs.
  const roles: RoleCfg[] =
    run.roles && run.roles.length > 0
      ? run.roles
      : [
          {
            role: run.role,
            query: run.query,
            maxEmails: run.maxEmails,
            customizeResume: run.customizeResume,
          },
        ];
  const mode: "live" | "test" = run.mode === "test" ? "test" : "live";
  const globalLimit =
    typeof run.globalLimit === "number" ? run.globalLimit : null;

  try {
    await L(
      "sys",
      roles.length > 1
        ? `Run initialized — ${roles.length} roles: ` +
            roles.map((r) => `“${r.role}”`).join(", ")
        : `Run initialized — role: “${run.role}”`
    );
    if (mode === "test") {
      await L(
        "warn",
        "TEST MODE — scrape, filters, Groq and resumes are all real, but NO real emails will be sent and nothing is recorded in the outbox."
      );
    }

    const cand = config.candidate;
    if (
      !cand.email ||
      /your full name|placeholder/i.test(cand.name) ||
      /0{3,}/.test(cand.phone)
    ) {
      await L(
        "warn",
        `⚠️ Your .env still has PLACEHOLDER candidate data (name="${cand.name}", phone="${cand.phone}", email="${cand.email || "(empty)"}"). ` +
          `Update the CANDIDATE_* lines in .env and restart — otherwise every email goes out with dummy details.`
      );
    }

    if (mode === "live" && !isSmtpConfigured()) {
      throw new Error(
        "GMAIL_ID / GMAIL_APP_PASSWORD not configured — every live run is a real send. Add them to .env and restart the server."
      );
    }

    let totalSent = 0;
    let totalSkipped = 0;
    let totalPosts = 0;
    const roleSent: number[] = [];
    const roleBudgets: number[] = [];
    let versionIndex = 0;

    const roleProgress = () =>
      roles.map((r, i) => ({
        role: r.role,
        sent: roleSent[i] ?? 0,
        limit: roleBudgets[i] ?? r.maxEmails,
      }));

    for (let ri = 0; ri < roles.length; ri++) {
      if (handle.stop) break;
      await pauseGate(handle);

      const rc = roles[ri];
      const remainingGlobal =
        globalLimit != null ? globalLimit - totalSent : null;
      if (remainingGlobal != null && remainingGlobal <= 0) {
        await L(
          "info",
          `Global limit of ${globalLimit} reached — remaining role(s) skipped.`
        );
        break;
      }
      const roleBudget =
        remainingGlobal != null
          ? Math.min(rc.maxEmails, remainingGlobal)
          : rc.maxEmails;
      if (roleBudget <= 0) continue;
      roleBudgets[ri] = roleBudget;
      roleSent[ri] = 0;

      if (roles.length > 1) {
        await L(
          "sys",
          `── Role ${ri + 1}/${roles.length}: “${rc.role}” — query: ${rc.query} — budget: ${roleBudget} email(s)`
        );
      } else {
        await L("info", `Search query: ${rc.query}`);
        await L(
          "info",
          `Target: ${roleBudget} email(s) | Resume AI customization: ${rc.customizeResume ? "ON (Groq)" : "OFF"} | Mode: ${mode === "test" ? "TEST (no real emails)" : "LIVE (real Chromium + LinkedIn + Gmail)"}`
        );
      }

      if (rc.customizeResume && !isGroqConfigured()) {
        await L(
          "warn",
          `GROQ_API_KEY not configured — “${rc.role}” will use the base resume.`
        );
      }

      // 1) Build / locate the base resume for this role.
      await L("info", `Preparing base resume PDF for “${rc.role}” ...`);
      const basePdf = await ensureBaseResume(rc.role);
      const baseProfile = baseResumeProfile(rc.role);
      await L("ok", `Base resume ready: ${config.resumeFilename}`);

      // 2) Open Chromium and acquire the feed of real LinkedIn posts.
      await L(
        "info",
        "Launching LinkedIn live scrape (Playwright persistent profile)..."
      );
      const res = await scrapeLinkedInPosts({
        query: rc.query,
        scrollRounds: config.bot.scrollRounds,
        log: (lvl, msg) => void log(runId, lvl, msg),
        isStopped: () => handle.stop,
        isPaused: () => handle.paused,
      });
      if (res.needsLogin) {
        throw new Error(res.note ?? "LinkedIn login required.");
      }
      const feed: ScrapedPost[] = res.posts;
      totalPosts += feed.length;

      if (feed.length === 0) {
        await L(
          "warn",
          `No posts with recruiter emails found for “${rc.role}”. Try widening the search query.`
        );
        await setRunStatus(runId, {
          sentCount: totalSent,
          skippedCount: totalSkipped,
          postsScanned: totalPosts,
          roleProgress: roleProgress(),
        });
        continue;
      }

      // 3) Walk posts -> verify genuine -> extract emails -> personalize -> send.
      const sent = await sentCol();
      const emailedThisRun = new Set<string>();
      const seenPosts = new Set<string>();
      let sentInRole = 0;
      let skippedInRole = 0;

      for (let i = 0; i < feed.length; i++) {
        if (handle.stop) break;
        if (sentInRole >= roleBudget) break;

        const post = feed[i];
        const postLink = normalizePostLink(post.postLink) || post.postLink;
        // 2026 LinkedIn cards frequently have no permalink — dedupe by content
        // in that case, or every link-less post looks like a duplicate of the
        // first one and the whole feed gets dropped.
        const postKey =
          postLink || `text:${post.text.slice(0, 200).toLowerCase()}`;
        if (seenPosts.has(postKey)) continue;
        seenPosts.add(postKey);

        if (!postLink) {
          skippedInRole++;
          await L(
            "warn",
            `Post ${i + 1} (${post.author || "unknown"}) — no post link could be captured; the Post Link line is mandatory, so this post is skipped`
          );
          continue;
        }

        await setRunStatus(runId, { postsScanned: totalPosts });

        const verdict = shouldSendToPost(rc.role, post.text);
        if (!verdict.allowed) {
          skippedInRole++;
          await L("warn", `Post ${i + 1} by ${post.author || "unknown"} — skipped: ${verdict.reason}`);
          continue;
        }

        const emails = filterRecruiterEmails(
          post.emails.length > 0 ? post.emails : []
        );
        if (emails.length === 0) {
          skippedInRole++;
          await L("warn", `Post ${i + 1} (${post.author || "unknown"}) — genuine post but no valid recruiter email, skipped`);
          continue;
        }

        await L("ok", `Genuine post ${i + 1} by ${post.author || "unknown"} — ${emails.length} recruiter email(s): ${emails.join(", ")}`);

        // Personalization per post (shared by recipients of the same post).
        let matchedSkills = "";
        let customPdfPath: string | null = null;

        if (rc.customizeResume && isGroqConfigured()) {
          await L("info", `Groq: analyzing JD from post ${i + 1} for role “${rc.role}” ...`);
          const [skills, custom] = await Promise.all([
            matchSkillsForPost(rc.role, post.text),
            customizeResumeForPost(rc.role, post.text, baseProfile),
          ]);
          if (skills) {
            matchedSkills = skills;
            await L("ok", `Groq skill match: ${skills}`);
          } else {
            await L("warn", "Groq skill match unavailable — using default pitch line.");
          }
          if (custom) {
            try {
              versionIndex += 1;
              customPdfPath = await renderCustomResume(
                custom,
                runId,
                versionIndex
              );
              // Record the generated version (original resume is never touched).
              try {
                const st = fs.statSync(customPdfPath);
                const rvCol = await resumeVersionsCol();
                await rvCol.insertOne({
                  _id: randomUUID(),
                  fileName: path.basename(customPdfPath),
                  role: rc.role,
                  postAuthor: post.author ?? "",
                  runId,
                  mode,
                  size: st.size,
                  createdAt: new Date(),
                });
              } catch {
                /* version bookkeeping must never crash the run */
              }
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
          if (sentInRole >= roleBudget) break;
          await pauseGate(handle);

          const email = normalizeEmail(rawEmail);
          if (emailedThisRun.has(email)) {
            skippedInRole++;
            await L("warn", `${email} — already contacted in this run, skipped`);
            continue;
          }
          if (mode === "live" && (await alreadySent(email, postLink))) {
            skippedInRole++;
            await L("warn", `${email} — duplicate (already emailed for this post), skipped`);
            continue;
          }

          const { subject, text, html } = buildEmail({
            role: rc.role,
            matchedSkills,
            postText: post.text,
            postLink,
          });
          const attachmentPath = customPdfPath ?? basePdf;

          if (mode === "test") {
            // Test mode: everything real except the SMTP send. Nothing is
            // recorded, so test runs never affect duplicate protection.
            await L("mail", `TEST MODE → prepared email for ${email} — “${subject}” (NOT sent — outbox untouched)`);
            emailedThisRun.add(email);
            sentInRole++;
            roleSent[ri] = sentInRole;
            totalSent++;
            await setRunStatus(runId, {
              sentCount: totalSent,
              skippedCount: totalSkipped + skippedInRole,
              roleProgress: roleProgress(),
            });
            if (sentInRole < roleBudget) {
              const delayMs = config.bot.delayBetweenEmails * 1000;
              await L("info", `Waiting ${Math.round(delayMs / 1000)}s before next email...`);
              for (let t = 0; t < delayMs && !handle.stop; t += 500) {
                await pauseGate(handle);
                await sleep(Math.min(500, delayMs - t));
              }
            }
            continue;
          }

          try {
            await sendEmail({
              to: email,
              subject,
              text,
              html,
              attachmentPath,
              attachmentName: config.resumeFilename,
            });
            await L("mail", `SENT → ${email} — “${subject}”`);
            if (config.ccEmails.length > 0) await L("info", `CC: ${config.ccEmails.join(", ")}`);
            if (config.bccEmails.length > 0) await L("info", `BCC: ${config.bccEmails.join(", ")}`);

            emailedThisRun.add(email);
            const doc: SentDoc = {
              _id: randomUUID(),
              runId,
              email,
              postLink,
              postAuthor: post.author ?? "",
              role: rc.role,
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

            sentInRole++;
            roleSent[ri] = sentInRole;
            totalSent++;
            await setRunStatus(runId, {
              sentCount: totalSent,
              skippedCount: totalSkipped + skippedInRole,
              roleProgress: roleProgress(),
            });

            if (sentInRole < roleBudget) {
              const delayMs = config.bot.delayBetweenEmails * 1000;
              await L("info", `Waiting ${Math.round(delayMs / 1000)}s before next email...`);
              // Sleep in small slices so Stop/Pause react quickly.
              for (let t = 0; t < delayMs && !handle.stop; t += 500) {
                await pauseGate(handle);
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
              role: rc.role,
              subject,
              matchedSkills,
              customized: false,
              status: "FAILED",
              error: msg,
              sentAt: new Date(),
            };
            await sent.insertOne(failDoc).catch(() => undefined);
            skippedInRole++;
            await setRunStatus(runId, {
              sentCount: totalSent,
              skippedCount: totalSkipped + skippedInRole,
              roleProgress: roleProgress(),
            });
          }
        }
      }

      totalSkipped += skippedInRole;
      await setRunStatus(runId, {
        sentCount: totalSent,
        skippedCount: totalSkipped,
        postsScanned: totalPosts,
        roleProgress: roleProgress(),
      });

      // 4) Wait before the next role (skipped after the last one).
      if (ri < roles.length - 1 && !handle.stop) {
        const span = Math.max(
          0,
          config.bot.waitBetweenRolesMax - config.bot.waitBetweenRolesMin
        );
        const waitSec = Math.round(
          config.bot.waitBetweenRolesMin + Math.random() * span
        );
        await L("info", `Waiting ${waitSec}s before next role...`);
        for (let t = 0; t < waitSec * 1000 && !handle.stop; t += 500) {
          await pauseGate(handle);
          await sleep(Math.min(500, waitSec * 1000 - t));
        }
      }
    }

    await setRunStatus(runId, {
      status: handle.stop ? "stopped" : "completed",
      sentCount: totalSent,
      skippedCount: totalSkipped,
      postsScanned: totalPosts,
      paused: false,
      roleProgress: roleProgress(),
      finishedAt: new Date(),
    });
    await L(
      "sys",
      handle.stop
        ? `Run stopped by user — ${totalSent}/${run.maxEmails} emails sent, ${totalSkipped} skipped.`
        : totalSent >= run.maxEmails
          ? `Target reached — ${totalSent}/${run.maxEmails} emails sent. Run complete.`
          : `Reachable recruiter quota exhausted — ${totalSent}/${run.maxEmails} emails sent, ${totalSkipped} skipped. Try broader queries for more.`
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
