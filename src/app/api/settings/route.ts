import { config, isGroqConfigured, isSmtpConfigured } from "@/lib/config";
import { baseResumeExists, baseResumePath } from "@/lib/resume";
import fs from "node:fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function maskEmail(e: string): string {
  if (!e.includes("@")) return e ? "***" : "";
  const [local, domain] = e.split("@");
  return `${local.slice(0, 3)}***@${domain}`;
}

function maskSecret(s: string): string {
  if (!s) return "";
  return `${s.slice(0, 4)}${"•".repeat(Math.max(4, Math.min(12, s.length - 4)))}`;
}

async function verifyGroqKey(): Promise<boolean | null> {
  if (!isGroqConfigured()) return null;
  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${config.groqApiKey}` },
      signal: AbortSignal.timeout(6000),
    });
    return res.ok;
  } catch {
    return null;
  }
}

export async function GET() {
  const groqValid = await verifyGroqKey();
  let resumeSize = 0;
  try {
    if (baseResumeExists()) resumeSize = fs.statSync(baseResumePath()).size;
  } catch {
    /* ignore */
  }
  return Response.json({
    ok: true,
    gmail: {
      configured: isSmtpConfigured(),
      id: maskEmail(config.gmailId),
      password: maskSecret(config.gmailAppPassword),
    },
    groq: {
      configured: isGroqConfigured(),
      valid: groqValid,
      model: config.groqModel,
      key: maskSecret(config.groqApiKey),
    },
    candidate: config.candidate,
    ccEmails: config.ccEmails.map(maskEmail),
    bccEmails: config.bccEmails.map(maskEmail),
    bot: config.bot,
    engineMode: config.engineMode,
    linkedinLoginWaitSec: config.linkedinLoginWaitSec,
    dailyTarget: config.dailyResponseTarget,
    resume: {
      exists: baseResumeExists(),
      filename: config.resumeFilename,
      path: baseResumePath(),
      size: resumeSize,
    },
  });
}
