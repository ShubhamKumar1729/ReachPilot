function env(key: string, fallback = ""): string {
  const v = process.env[key];
  return (v ?? fallback).trim();
}

function envInt(key: string, fallback: number): number {
  const n = parseInt(env(key), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envList(key: string): string[] {
  return env(key)
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes("@"));
}

export const config = {
  gmailId: env("GMAIL_ID"),
  // Gmail app passwords are often pasted with spaces — strip them.
  gmailAppPassword: env("GMAIL_APP_PASSWORD").replace(/\s+/g, ""),
  groqApiKey: env("GROQ_API_KEY"),
  groqModel: env("GROQ_MODEL", "openai/gpt-oss-120b") || "openai/gpt-oss-120b",
  // Every run is live: open Chromium, search LinkedIn, extract recruiter
  // emails from genuine posts, then email. There is no simulation mode.
  linkedinProfileDir: env("LINKEDIN_PROFILE_DIR", "linkedin_saved_login"),
  // How long to wait for a manual LinkedIn sign-in on first use (seconds).
  // The session is then stored in the persistent profile — sign in once only.
  linkedinLoginWaitSec: envInt("LINKEDIN_LOGIN_WAIT_SEC", 300),
  dailyResponseTarget: envInt("DAILY_RESPONSE_TARGET", 20),

  candidate: {
    name: env("CANDIDATE_NAME", "Candidate"),
    email: env("CANDIDATE_EMAIL"),
    phone: env("CANDIDATE_PHONE"),
    linkedin: env("CANDIDATE_LINKEDIN"),
    location: env("CANDIDATE_LOCATION"),
    relocation: env("CANDIDATE_RELOCATION"),
    workAuth: env("CANDIDATE_WORK_AUTH"),
    availability: env("CANDIDATE_AVAILABILITY"),
    experience: env("CANDIDATE_EXPERIENCE"),
    expectedRate: env("CANDIDATE_EXPECTED_RATE"),
  },

  resumeFilename: env("RESUME_FILENAME", "Resume.pdf") || "Resume.pdf",
  ccEmails: envList("CC_EMAILS"),
  bccEmails: envList("BCC_EMAILS"),

  bot: {
    maxEmailsPerRole: envInt("MAX_EMAILS_PER_ROLE", 15),
    delayBetweenEmails: envInt("DELAY_BETWEEN_EMAILS", 12),
    scrollRounds: envInt("SCROLL_ROUNDS", 8),
    waitBetweenRolesMin: envInt("WAIT_BETWEEN_ROLES_MIN", 60),
    waitBetweenRolesMax: envInt("WAIT_BETWEEN_ROLES_MAX", 120),
  },
};

export function isSmtpConfigured(): boolean {
  return Boolean(config.gmailId && config.gmailAppPassword);
}

export function isGroqConfigured(): boolean {
  return Boolean(config.groqApiKey);
}
