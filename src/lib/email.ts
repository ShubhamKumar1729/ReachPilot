import { config } from "./config";

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

export function buildSubject(role: string): string {
  const c = config.candidate;
  return `${role} | ${c.name} | ${c.experience} | ${c.availability}`;
}

/**
 * Email body in the exact submission format:
 * greeting -> role-specific pitch -> submission details block ->
 * resume note + call CTA -> signature, with the source post link.
 */
export function buildEmail(opts: {
  role: string;
  matchedSkills: string;
  postLink: string;
}): EmailPayload {
  const c = config.candidate;
  const { role, matchedSkills, postLink } = opts;
  const subject = buildSubject(role);

  const skillsLine =
    matchedSkills ||
    "Cloud Infrastructure, Automation, CI/CD, Monitoring and Production Support";

  const details: Array<[string, string]> = [
    ["Candidate Name", c.name],
    ["Applied Role", role],
    ["Total Experience", c.experience],
    ["Phone / Contact", c.phone],
    ["Email Address", c.email],
    ["Current Location", c.location],
    ["Relocation", c.relocation],
    ["Work Authorization", c.workAuth],
    ["Availability", c.availability],
    ["Rate / Compensation", c.expectedRate],
    ["LinkedIn Profile", c.linkedin],
  ];

  const text = `Dear Hiring Manager,

I came across your posting for a ${role} position. My hands-on experience with ${skillsLine} maps directly to what you are looking for, and I would welcome the opportunity to be considered.

Please find my submission details below for your review:

--- SUBMISSION DETAILS ---
${details.map(([k, v]) => `• ${k}: ${v}`).join("\n")}

I have attached my updated resume for your review. Are you available for a brief call sometime this week to discuss this position? Thank you for your time and consideration; I look forward to hearing from you.

Best regards,
${c.name}
Phone: ${c.phone} | Email: ${c.email}
LinkedIn: ${c.linkedin}

Re: your LinkedIn post: ${postLink}`;

  const detailRows = details
    .map(
      ([k, v]) => `
      <tr>
        <td style="padding:7px 14px;font-size:13px;color:#6b7280;white-space:nowrap;vertical-align:top;border-bottom:1px solid #eef0f3;">${esc(k)}</td>
        <td style="padding:7px 14px;font-size:13px;color:#111827;font-weight:600;border-bottom:1px solid #eef0f3;word-break:break-word;">${
          v.includes("http")
            ? `<a href="${esc(v)}" style="color:#2563eb;text-decoration:none;">${esc(v)}</a>`
            : k === "Email Address"
              ? `<a href="mailto:${esc(v)}" style="color:#2563eb;text-decoration:none;">${esc(v)}</a>`
              : esc(v)
        }</td>
      </tr>`
    )
    .join("");

  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#111827;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 0;">
<tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb;">
<tr>
<td style="background:linear-gradient(135deg,#0f172a,#1d4ed8);padding:24px 28px;color:#ffffff;">
<p style="margin:0;font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:#bfdbfe;">Candidate Profile Submission</p>
<h1 style="margin:10px 0 4px;font-size:23px;font-weight:700;">${esc(c.name)}</h1>
<p style="margin:0;font-size:13px;color:#dbeafe;">${esc(role)} &nbsp;|&nbsp; ${esc(c.experience)} Experience &nbsp;|&nbsp; ${esc(c.workAuth)} &nbsp;|&nbsp; ${esc(c.availability)}</p>
</td>
</tr>
<tr>
<td style="padding:26px 28px;font-size:14px;line-height:1.6;">
<p style="margin:0 0 14px;">Dear Hiring Manager,</p>
<p style="margin:0 0 14px;">I came across your posting for a <b>${esc(role)}</b> position. My hands-on experience with <b>${esc(skillsLine)}</b> maps directly to what you are looking for, and I would welcome the opportunity to be considered.</p>
<p style="margin:0 0 10px;">Please find my submission details below for your review:</p>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;margin:6px 0 18px;">${detailRows}</table>
<p style="margin:0 0 14px;">I have attached my updated resume for your review. Are you available for a brief call sometime this week to discuss this position? Thank you for your time and consideration; I look forward to hearing from you.</p>
<p style="margin:0 0 4px;">Best regards,</p>
<p style="margin:0;font-weight:700;">${esc(c.name)}</p>
<p style="margin:4px 0 0;font-size:13px;color:#374151;">Phone: ${esc(c.phone)} &nbsp;|&nbsp; Email: <a href="mailto:${esc(c.email)}" style="color:#2563eb;text-decoration:none;">${esc(c.email)}</a><br>
LinkedIn: <a href="${esc(c.linkedin)}" style="color:#2563eb;text-decoration:none;">${esc(c.linkedin)}</a></p>
<div style="margin-top:18px;background:#eff6ff;border-left:4px solid #2563eb;border-radius:6px;padding:10px 14px;font-size:12px;color:#1e40af;">
<b>Re: your LinkedIn post</b><br><a href="${esc(postLink)}" style="color:#2563eb;word-break:break-all;">${esc(postLink)}</a>
</div>
</td>
</tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, text, html };
}
