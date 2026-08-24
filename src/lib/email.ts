import { config } from "./config";
import { clean } from "./filters";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface EmailPayload {
  subject: string;
  text: string;
  html: string;
}

const ACRONYMS = new Set([
  "sql", "api", "apis", "ai", "ml", "mlops", "c2c", "w2", "aws", "k8s",
  "sre", "scrum", "agile", "hr", "qa", "jd",
]);

const SPECIAL_ROLE_WORDS: Record<string, string> = { devops: "DevOps" };

/** "java developer" -> "Java Developer" (keeps acronyms like SQL/AI). */
export function displayRole(role: string): string {
  return clean(role)
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      const low = w.toLowerCase();
      if (SPECIAL_ROLE_WORDS[low]) return SPECIAL_ROLE_WORDS[low];
      if (ACRONYMS.has(low)) return low.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");
}

/** Sensible pitch skills when Groq tailoring is off. */
function defaultSkills(role: string): string {
  const low = role.toLowerCase();
  if (/java/.test(low)) return "Java, Spring Boot, SQL and REST APIs";
  if (/product analyst|analyst/.test(low))
    return "SQL, Python, Product Analytics and A/B Testing";
  if (/python|data/.test(low)) return "Python, SQL, Data Analysis and Automation";
  if (/devops|sre|cloud|site reliability/.test(low))
    return "Cloud Infrastructure, Automation, CI/CD, Monitoring and Production Support";
  if (/react|frontend|front-end|full[- ]?stack/.test(low))
    return "React, JavaScript, TypeScript, Node.js and REST APIs";
  if (/node/.test(low)) return "Node.js, Express, SQL and REST APIs";
  return "the skills and technologies relevant to this role";
}

function mdLink(text: string, href: string): string {
  return `[${text}](${href})`;
}

/**
 * Post text for the "FOR REFERENCE" section — the post itself, minus
 * LinkedIn UI chrome (labels, degree markers, action buttons, reaction
 * counts, "… more" markers).
 */
export function postReferenceExcerpt(raw: string, max = 2000): string {
  const uiLine =
    /^(feed post|reposted|promoted|sponsored|follow|following|connect|message|like|likes|comment|comments|share|repost|reposts|save|send|reply|replies|view replies|view comments|more options|copy link|copy link to post|copy post link|view profile|show more|show less|hide expanded content|no results)$/i;
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => {
      if (!l) return true;
      if (uiLine.test(l)) return false;
      if (/^(\.{2,}|…)\s*more$/i.test(l)) return false; // collapsed-post marker
      if (/^\d+\s*(reactions?|comments?|reposts?|likes?|views?)\b/i.test(l))
        return false; // "16 reactions", "1 comment"
      if (/^\d+$/.test(l)) return false; // bare counts ("16")
      if (/^•\s*\d+(st|nd|rd|th)\+?$/.test(l)) return false;
      if (/^\d+[hdmwy]\b/.test(l)) return false;
      return true;
    });
  let out = lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (out.length > max) out = `${out.slice(0, max).trimEnd()}…`;
  return out;
}

export function buildSubject(role: string): string {
  const c = config.candidate;
  return `${displayRole(role)} | ${c.name} | ${c.experience} | ${c.workAuth} | ${c.availability}`;
}

/**
 * Email body in the exact submission format:
 * greeting -> role-specific pitch -> submission details block ->
 * resume note + call CTA -> signature -> FOR REFERENCE (post text) -> Post Link.
 * Links use literal markdown `[text](url)` form, exactly as the format
 * requires. The HTML view renders the identical text (pre-wrap), so every
 * client shows the same layout.
 */
export function buildEmail(opts: {
  role: string;
  matchedSkills: string;
  postText: string;
  postLink: string;
}): EmailPayload {
  const c = config.candidate;
  const { role, matchedSkills, postText, postLink } = opts;
  const subject = buildSubject(role);
  const Role = displayRole(role);
  const skillsLine = matchedSkills || defaultSkills(role);

  const emailLink = c.email ? mdLink(c.email, `mailto:${c.email}`) : "";
  const linkedinLink = c.linkedin ? mdLink(c.linkedin, c.linkedin) : "";

  const details: Array<[string, string]> = [
    ["Candidate Name", c.name],
    ["Applied Role", Role],
    ["Total Experience", c.experience],
    ["Phone / Contact", c.phone],
    ["Email Address", emailLink],
    ["Current Location", c.location],
    ["Relocation", c.relocation],
    ["Work Authorization", c.workAuth],
    ["Availability", c.availability],
    ["Rate / Compensation", c.expectedRate],
    ["LinkedIn Profile", linkedinLink],
  ];

  const reference = postReferenceExcerpt(postText);

  let tail = "";
  if (reference) tail += `\n\n\nFOR REFERENCE\n\n${reference}`;
  if (postLink) tail += `\n\nPost Link: ${mdLink(postLink, postLink)}`;

  const text = `Dear Hiring Manager,

I came across your posting for a ${Role} position. My hands-on experience with ${skillsLine} maps directly to what you are looking for, and I would welcome the opportunity to be considered.

Please find my submission details below for your review:

--- SUBMISSION DETAILS ---
${details.map(([k, v]) => `• ${k}: ${v}`).join("\n")}

I have attached my updated resume for your review. Are you available for a brief call sometime this week to discuss this position? Thank you for your time and consideration; I look forward to hearing from you.

Best regards,
${c.name}
Phone: ${c.phone} | Email: ${emailLink}
LinkedIn: ${linkedinLink}${tail}`;

  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f6f8;">
<div style="max-width:640px;margin:24px auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;padding:26px 28px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.65;color:#111827;white-space:pre-wrap;word-break:break-word;">${esc(text)}</div>
</body>
</html>`;

  return { subject, text, html };
}
