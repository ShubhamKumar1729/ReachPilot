/** Client-safe row shapes (mirror of the Drizzle schema). */

export interface RunRow {
  id: string;
  role: string;
  query: string;
  maxEmails: number;
  customizeResume: boolean;
  status: string;
  sentCount: number;
  skippedCount: number;
  postsScanned: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface SentRow {
  id: string;
  runId: string | null;
  email: string;
  postLink: string;
  postAuthor: string;
  role: string;
  subject: string;
  matchedSkills: string;
  customized: boolean;
  status: string;
  error: string | null;
  sentAt: string;
}

export interface LogRow {
  id: number;
  runId: string;
  level: "info" | "ok" | "warn" | "err" | "mail" | "sys" | string;
  message: string;
  createdAt: string;
}

export interface StatsPayload {
  ok: boolean;
  totals: {
    totalSent: number;
    totalFailed: number;
    uniqueRecruiters: number;
  };
  today: { count: number };
  runStats: { totalRuns: number; running: number; completed: number };
  recentRuns: RunRow[];
  recentSent: SentRow[];
  dailyTarget: number;
}

export interface SettingsPayload {
  ok: boolean;
  gmail: { configured: boolean; id: string; password: string };
  groq: { configured: boolean; valid: boolean | null; model: string; key: string };
  candidate: {
    name: string;
    email: string;
    phone: string;
    linkedin: string;
    location: string;
    relocation: string;
    workAuth: string;
    availability: string;
    experience: string;
    expectedRate: string;
  };
  ccEmails: string[];
  bccEmails: string[];
  bot: {
    maxEmailsPerRole: number;
    delayBetweenEmails: number;
    scrollRounds: number;
    waitBetweenRolesMin: number;
    waitBetweenRolesMax: number;
  };
  linkedinLoginWaitSec: number;
  dailyTarget: number;
  resume: { exists: boolean; filename: string; path: string; size: number };
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function runStatusColor(status: string): string {
  switch (status) {
    case "running":
      return "text-acid border-acid/40 bg-acid/10";
    case "queued":
      return "text-cyanX border-cyanX/40 bg-cyanX/10";
    case "completed":
      return "text-blueX border-blueX/40 bg-blueX/10";
    case "stopped":
      return "text-amberX border-amberX/40 bg-amberX/10";
    case "failed":
      return "text-redX border-redX/40 bg-redX/10";
    default:
      return "text-fog border-hairline2 bg-white/5";
  }
}
