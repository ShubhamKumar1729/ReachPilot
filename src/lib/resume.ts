import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { config } from "./config";
import type { CustomResume } from "./groq";

export const OUTPUT_DIR = path.join(process.cwd(), "output");
const CUSTOM_DIR = path.join(OUTPUT_DIR, "custom");

function ensureDirs() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(CUSTOM_DIR, { recursive: true });
}

export function baseResumePath(): string {
  return path.join(OUTPUT_DIR, config.resumeFilename);
}

export function baseResumeExists(): boolean {
  try {
    return fs.existsSync(baseResumePath());
  } catch {
    return false;
  }
}

/** Base resume profile derived from the candidate env + target role. */
export function baseResumeProfile(role: string): CustomResume {
  const roleTitle = role.replace(/\s+/g, " ").trim();
  return {
    title: roleTitle,
    summary: [
      `${roleTitle} with ${config.candidate.experience} of hands-on experience delivering reliable, scalable solutions across cloud and enterprise environments.`,
      "Skilled at translating business requirements into production-grade technical execution with automation-first workflows.",
      "Strong background collaborating with cross-functional teams in fast-paced Agile environments with a focus on quality, security, and uptime.",
      `${config.candidate.workAuth} | ${config.candidate.availability} availability | ${config.candidate.relocation}.`,
    ],
    skills: {
      Core: `${roleTitle} responsibilities end-to-end: design, build, deploy, monitor, optimize`,
      "Cloud & Platforms": "AWS, Azure, Linux, Networking fundamentals (DNS, TCP/IP, VPN)",
      "Automation & CI/CD": "Terraform, Ansible, Jenkins, GitHub Actions, GitLab CI, Scripting (Python, Bash)",
      "Containers & Orchestration": "Docker, Kubernetes (EKS/AKS), Helm",
      Observability: "Prometheus, Grafana, ELK, CloudWatch, Datadog",
      Databases: "PostgreSQL, MySQL, Redis",
      Practices: "Agile/Scrum, Incident Management, Code Review, Documentation",
    },
    jobs: [
      {
        title: roleTitle,
        company: "Enterprise Client Engagement",
        dates: "2022 - Present",
        bullets: [
          `Own end-to-end delivery of ${roleTitle} initiatives across production cloud environments serving enterprise stakeholders.`,
          "Automated repetitive operational workflows, cutting manual effort significantly and improving release reliability.",
          "Built and maintained CI/CD pipelines enabling frequent, low-risk deployments with automated quality gates.",
          "Implemented monitoring, alerting, and incident-response practices that reduced mean time to resolution.",
          "Partnered with engineering, security, and product teams to ship compliant, well-documented solutions.",
        ],
      },
      {
        title: roleTitle,
        company: "Consulting Engagement",
        dates: "2020 - 2022",
        bullets: [
          "Delivered client-facing technical solutions across multiple concurrent projects with strict SLAs.",
          "Standardized environment provisioning with Infrastructure-as-Code and configuration management.",
          "Improved system observability with centralized logging and metrics dashboards.",
          "Mentored junior engineers and produced runbooks adopted across the team.",
        ],
      },
      {
        title: `Associate ${roleTitle}`,
        company: "Technology Services",
        dates: "2019 - 2020",
        bullets: [
          "Supported production systems and participated in on-call rotations.",
          "Contributed to automation scripts and deployment tooling.",
          "Collaborated in Agile ceremonies and maintained technical documentation.",
        ],
      },
    ],
    education: ["Bachelor's Degree"],
  };
}

/* ------------------------------ PDF rendering ----------------------------- */

const C = {
  ink: "#111827",
  slate: "#0f172a",
  blue: "#1d4ed8",
  gray: "#4b5563",
  line: "#d5dbe5",
};

function renderResumePdf(profile: CustomResume, outPath: string): Promise<string> {
  const c = config.candidate;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "letter",
      margins: { top: 34, bottom: 30, left: 40, right: 40 },
      info: { Title: `${c.name} Resume`, Author: c.name },
    });
    const stream = fs.createWriteStream(outPath);
    doc.pipe(stream);
    const pageW = doc.page.width - 80;

    // Header
    doc
      .font("Helvetica-Bold")
      .fontSize(19)
      .fillColor(C.slate)
      .text(c.name.toUpperCase(), { align: "center", characterSpacing: 0.6 });
    doc
      .font("Helvetica-Bold")
      .fontSize(10.5)
      .fillColor(C.blue)
      .text(profile.title, { align: "center" });
    doc.moveDown(0.25);
    doc
      .font("Helvetica")
      .fontSize(7.6)
      .fillColor(C.ink)
      .text(
        `${c.phone}  |  ${c.email}  |  ${c.linkedin}`,
        { align: "center" }
      );
    doc.text(
      `${c.location}  |  ${c.workAuth}  |  ${c.availability}  |  ${c.relocation}`,
      { align: "center" }
    );
    doc.moveDown(0.3);
    doc
      .moveTo(40, doc.y)
      .lineTo(40 + pageW, doc.y)
      .lineWidth(1)
      .strokeColor(C.blue)
      .stroke();
    doc.moveDown(0.35);

    const section = (label: string) => {
      doc.moveDown(0.45);
      doc
        .font("Helvetica-Bold")
        .fontSize(9.6)
        .fillColor(C.blue)
        .text(label, { characterSpacing: 0.8 });
      doc
        .moveTo(40, doc.y + 1)
        .lineTo(40 + pageW, doc.y + 1)
        .lineWidth(0.6)
        .strokeColor(C.line)
        .stroke();
      doc.moveDown(0.15);
    };

    const bullet = (t: string) => {
      doc
        .font("Helvetica")
        .fontSize(7.9)
        .fillColor(C.ink)
        .text(`•  ${t}`, { indent: 8, lineGap: 0.6 });
      doc.moveDown(0.08);
    };

    // Summary
    section("PROFESSIONAL SUMMARY");
    for (const s of profile.summary) bullet(s);

    // Skills
    section("CORE SKILLS");
    for (const [group, line] of Object.entries(profile.skills)) {
      doc
        .font("Helvetica-Bold")
        .fontSize(7.9)
        .fillColor(C.slate)
        .text(`${group}: `, { continued: true })
        .font("Helvetica")
        .fillColor(C.ink)
        .text(line, { lineGap: 0.5 });
      doc.moveDown(0.08);
    }

    // Experience
    section("PROFESSIONAL EXPERIENCE");
    for (const job of profile.jobs) {
      doc
        .font("Helvetica-Bold")
        .fontSize(8.6)
        .fillColor(C.slate)
        .text(`${job.title}  |  ${job.company}  |  ${job.dates}`);
      doc.moveDown(0.08);
      for (const b of job.bullets) bullet(b);
      doc.moveDown(0.1);
    }

    // Education
    if (profile.education.length > 0) {
      section("EDUCATION");
      for (const e of profile.education) {
        doc.font("Helvetica").fontSize(8).fillColor(C.ink).text(e);
        doc.moveDown(0.05);
      }
    }

    doc.end();
    stream.on("finish", () => resolve(outPath));
    stream.on("error", reject);
  });
}

/**
 * Ensure the base resume PDF exists. If the user dropped their own PDF into
 * output/ we use it untouched; otherwise we render one from the env profile.
 */
export async function ensureBaseResume(role: string): Promise<string> {
  ensureDirs();
  const p = baseResumePath();
  if (fs.existsSync(p)) return p;
  await renderResumePdf(baseResumeProfile(role), p);
  return p;
}

/** Render a Groq-customized resume PDF for a specific recipient. */
export async function renderCustomResume(
  profile: CustomResume,
  runId: string,
  index: number
): Promise<string> {
  ensureDirs();
  const out = path.join(CUSTOM_DIR, `${runId}_${index}.pdf`);
  await renderResumePdf(profile, out);
  return out;
}
