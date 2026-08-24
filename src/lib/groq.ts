import { config, isGroqConfigured } from "./config";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function groqChat(
  messages: ChatMessage[],
  opts: { json?: boolean; maxTokens?: number; temperature?: number } = {}
): Promise<string | null> {
  if (!isGroqConfigured()) return null;
  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.groqModel,
        messages,
        temperature: opts.temperature ?? 0.4,
        max_tokens: opts.maxTokens ?? 900,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    return content ? content.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Extract the top skills from a job post that the candidate can claim, used to
 * personalize the opening pitch line ("My hands-on experience with X, Y, Z...").
 */
export async function matchSkillsForPost(
  role: string,
  postText: string
): Promise<string | null> {
  const raw = await groqChat(
    [
      {
        role: "system",
        content:
          "You extract hiring signals from recruiter posts. Reply with ONLY a comma-separated list of 3 to 5 concrete technical skills, tools or domains mentioned in the post that a strong candidate for the role would highlight. No sentences, no numbering, no extra words.",
      },
      {
        role: "user",
        content: `Role: ${role}\n\nRecruiter post:\n${postText.slice(0, 4000)}`,
      },
    ],
    { maxTokens: 80, temperature: 0.2 }
  );
  if (!raw) return null;
  const cleaned = raw
    .replace(/\n/g, ", ")
    .replace(/^(skills?:?\s*)/i, "")
    .split(",")
    .map((s) => s.replace(/^[-•*\d.\s]+/, "").trim())
    .filter((s) => s.length > 1 && s.length < 40)
    .slice(0, 5);
  if (cleaned.length === 0) return null;
  return cleaned.join(", ");
}

export interface CustomResume {
  title: string;
  summary: string[];
  skills: Record<string, string>;
  jobs: Array<{
    title: string;
    company: string;
    dates: string;
    bullets: string[];
  }>;
  education: string[];
}

function sanitizeCustomResume(input: unknown): CustomResume | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const asStrArr = (v: unknown, max: number): string[] =>
    Array.isArray(v)
      ? v
          .filter((x): x is string => typeof x === "string")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, max)
      : [];
  const summary = asStrArr(o.summary, 6);
  const jobs = Array.isArray(o.jobs)
    ? o.jobs
        .filter((j) => j && typeof j === "object")
        .slice(0, 4)
        .map((j) => {
          const jo = j as Record<string, unknown>;
          return {
            title: typeof jo.title === "string" ? jo.title : "",
            company: typeof jo.company === "string" ? jo.company : "",
            dates: typeof jo.dates === "string" ? jo.dates : "",
            bullets: asStrArr(jo.bullets, 8),
          };
        })
        .filter((j) => j.title && j.bullets.length > 0)
    : [];
  const skills: Record<string, string> = {};
  if (o.skills && typeof o.skills === "object" && !Array.isArray(o.skills)) {
    for (const [k, v] of Object.entries(o.skills as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) skills[k.trim()] = v.trim();
    }
  }
  if (summary.length === 0 || jobs.length === 0) return null;
  return {
    title: typeof o.title === "string" && o.title.trim() ? o.title.trim() : "",
    summary,
    skills,
    jobs,
    education: asStrArr(o.education, 3),
  };
}

/**
 * Ask Groq to tailor the resume for a specific job post. Returns structured
 * resume content or null (caller falls back to the base resume).
 */
export async function customizeResumeForPost(
  role: string,
  postText: string,
  baseProfile: CustomResume
): Promise<CustomResume | null> {
  const c = config.candidate;
  const raw = await groqChat(
    [
      {
        role: "system",
        content:
          "You are an expert ATS resume tailor. Given a candidate's base resume and a recruiter's job post, rewrite the resume so it aligns with the post while staying 100% truthful to the base resume: never invent employers, degrees, certifications, or years of experience. You may reorder bullets, sharpen wording, mirror the post's terminology, and emphasize the most relevant skills. Reply with STRICT JSON only, matching this TypeScript type: { title: string; summary: string[]; skills: Record<string,string>; jobs: { title: string; company: string; dates: string; bullets: string[] }[]; education: string[] }. Keep 4-5 summary lines, 6-9 skill groups, keep ALL jobs from the base resume with 6-8 detailed bullets each — the finished resume must fill a full page with detail. Bullets must be punchy, start with strong verbs, and include keywords from the post where honest.",
      },
      {
        role: "user",
        content: `Candidate: ${c.name} (${c.experience} experience, ${c.workAuth})
Target role: ${role}

Recruiter post:
${postText.slice(0, 3500)}

Base resume JSON:
${JSON.stringify(baseProfile).slice(0, 6000)}`,
      },
    ],
    { json: true, maxTokens: 2200, temperature: 0.45 }
  );
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return sanitizeCustomResume(parsed);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return sanitizeCustomResume(JSON.parse(m[0]));
    } catch {
      return null;
    }
  }
}
