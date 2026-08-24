import { config } from "./config";

const EMAIL_REGEX =
  /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g;

const BAD_EMAIL_PREFIXES = new Set([
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
  "admin",
  "support",
  "help",
  "info",
  "contact",
  "sales",
  "marketing",
  "privacy",
  "security",
  "abuse",
  "postmaster",
  "mailer-daemon",
]);

const BAD_EMAIL_DOMAINS = new Set([
  "linkedin.com",
  "example.com",
  "test.com",
]);

const BENCHSALES_BLOCK_KEYWORDS = [
  "bench sales",
  "benchsales",
  "bench-sale",
  "bench_sale",
  "benchsales recruiter",
  "bench sales recruiter",
  "hotlist",
  "hot list",
];

const BENCHSALES_BLOCK_PATTERNS = [
  /\bbench\s*sales\b/i,
  /\bbench[-_\s]*sales\b/i,
  /\bbenchsales\b/i,
];

const JOB_REQUIREMENT_KEYWORDS = [
  "hiring", "we are hiring", "now hiring", "job opening", "opening", "open role",
  "requirement", "urgent requirement", "position", "role", "opportunity",
  "looking for", "need", "needed", "required", "contract", "fulltime",
  "full time", "full-time", "w2", "c2c", "onsite", "remote", "hybrid",
  "job description", "jd", "engineer", "developer", "analyst", "architect",
  "devops", "sre", "site reliability", "aws", "azure", "kubernetes",
  "terraform", "jenkins", "python", "java", "sql", "cloud", "data",
];

export function clean(text: string | null | undefined): string {
  if (text == null) return "";
  let t = String(text);
  t = t.replace(/ /g, " ");
  t = t.replace(/​/g, "");
  t = t.replace(/﻿/g, "");
  t = t.replace(/[ \t]+/g, " ");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

export function normalizeEmail(email: string): string {
  return clean(email).toLowerCase().replace(/^[.,;:()\[\]{}"'<>]+|[.,;:()\[\]{}"'<>]+$/g, "");
}

export function extractEmails(text: string): string[] {
  const t = clean(text);
  const found = t.match(EMAIL_REGEX) ?? [];
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const raw of found) {
    const e = normalizeEmail(raw);
    if (e && !seen.has(e)) {
      seen.add(e);
      unique.push(e);
    }
  }
  return unique;
}

export function blockedEmails(): Set<string> {
  return new Set(
    [
      config.gmailId,
      config.candidate.email,
      ...config.ccEmails,
      ...config.bccEmails,
    ]
      .filter(Boolean)
      .map((e) => normalizeEmail(e))
  );
}

export function isValidRecruiterEmail(email: string): boolean {
  const e = normalizeEmail(email);
  if (!e || !e.includes("@")) return false;
  if (blockedEmails().has(e)) return false;
  const [local, domain] = e.split("@");
  if (!local || !domain) return false;
  if (BAD_EMAIL_DOMAINS.has(domain)) return false;
  if (BAD_EMAIL_PREFIXES.has(local)) return false;
  if (local.length <= 1) return false;
  // reject junk-looking locals like hash strings
  if (/^[0-9]+$/.test(local)) return false;
  return true;
}

export function filterRecruiterEmails(emails: string[]): string[] {
  const seen = new Set<string>();
  const valid: string[] = [];
  for (const raw of emails) {
    const e = normalizeEmail(raw);
    if (isValidRecruiterEmail(e) && !seen.has(e)) {
      seen.add(e);
      valid.push(e);
    }
  }
  return valid;
}

export function isBenchSalesPost(postText: string): { blocked: boolean; reason: string } {
  const low = clean(postText).toLowerCase();
  for (const k of BENCHSALES_BLOCK_KEYWORDS) {
    if (low.includes(k)) return { blocked: true, reason: k };
  }
  for (const p of BENCHSALES_BLOCK_PATTERNS) {
    if (p.test(low)) return { blocked: true, reason: String(p) };
  }
  return { blocked: false, reason: "" };
}

export function looksLikeRealJobRequirement(postText: string): boolean {
  const low = clean(postText).toLowerCase();
  return JOB_REQUIREMENT_KEYWORDS.some((k) => low.includes(k));
}

/** Significant role tokens (e.g. "DevOps Engineer" -> ["devops","engineer"]). */
export function roleTokens(role: string): string[] {
  return clean(role)
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter((t) => t.length > 2 && !["and", "the", "for", "with", "senior", "junior", "lead"].includes(t));
}

export function roleMatchesPost(role: string, postText: string): boolean {
  const low = clean(postText).toLowerCase();
  const tokens = roleTokens(role);
  if (tokens.length === 0) return true;
  return tokens.some((t) => low.includes(t));
}

export function shouldSendToPost(
  role: string,
  postText: string
): { allowed: boolean; reason: string } {
  const bench = isBenchSalesPost(postText);
  if (bench.blocked) {
    return { allowed: false, reason: `Bench Sales skipped only: ${bench.reason}` };
  }
  if (!looksLikeRealJobRequirement(postText)) {
    return { allowed: false, reason: "no clear job/recruiter signal" };
  }
  if (!roleMatchesPost(role, postText)) {
    return { allowed: false, reason: `not relevant to role "${role}"` };
  }
  return { allowed: true, reason: "valid recruiter/job post" };
}

/** Normalize LinkedIn post links to canonical /feed/update/urn:li:activity:ID form. */
export function normalizePostLink(rawLink: string | null | undefined): string {
  let link = clean(String(rawLink ?? ""));
  if (!link) return "";
  link = link.replace(/&amp;/g, "&");
  link = link.replace(/%3A/gi, ":").replace(/%2F/gi, "/");

  let m = link.match(/urn:li:activity:\d+/);
  if (m) return `https://www.linkedin.com/feed/update/${m[0]}/`;

  m = link.match(/activity[-:](\d{10,})/);
  if (m) return `https://www.linkedin.com/feed/update/urn:li:activity:${m[1]}/`;

  if (link.startsWith("www.linkedin.com")) link = "https://" + link;
  if (link.startsWith("/feed/update/") || link.startsWith("/posts/"))
    link = "https://www.linkedin.com" + link;

  link = link.split("?")[0].split("#")[0].replace(/[ /]+$/g, "") + "/";
  if (link.includes("linkedin.com/feed/update/") || link.includes("linkedin.com/posts/")) {
    return link;
  }
  return "";
}
