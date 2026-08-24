"use client";

import { useEffect, useState } from "react";
import {
  Settings as SettingsIcon,
  Mail,
  BrainCircuit,
  CircleUser,
  Bot,
  FileText,
  CheckCircle2,
  XCircle,
  TerminalSquare,
  FolderOpen,
} from "lucide-react";
import type { SettingsPayload } from "@/lib/types";

export default function SettingsPage() {
  const [s, setS] = useState<SettingsPayload | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(setS)
      .catch(() => undefined);
  }, []);

  return (
    <div className="pt-10">
      <div className="fade-up mb-6">
        <p className="label-mono mb-2 flex items-center gap-2">
          <SettingsIcon size={12} className="text-acid" /> environment · from .env
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-paper sm:text-4xl">Settings</h1>
        <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-fog">
          Everything comes from your <span className="font-mono text-mist">.env</span> file — edit values there and
          restart the server. Secrets are masked here for safety.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* connections */}
        <div className="panel fade-up p-6" style={{ animationDelay: "60ms" }}>
          <p className="label-mono mb-5 flex items-center gap-2">
            <Mail size={12} className="text-acid" /> connections
          </p>
          <div className="space-y-3">
            <ConnRow
              ok={s?.gmail.configured}
              title="Gmail SMTP"
              sub={s ? `${s.gmail.id} · app password ${s.gmail.password || "missing"}` : "…"}
            />
            <ConnRow
              ok={s ? s.groq.configured && s.groq.valid === true : undefined}
              warn={
                s?.groq.configured && s.groq.valid === false
                  ? "key rejected by Groq (401) — replace GROQ_API_KEY in .env"
                  : s?.groq.configured && s.groq.valid === null
                    ? "network unreachable — will retry at runtime"
                    : undefined
              }
              title="Groq AI"
              sub={s ? `${s.groq.model} · key ${s.groq.key || "missing"}` : "…"}
            />
            <ConnRow
              ok={true}
              title="MongoDB"
              sub="outbox + run history persisted (native driver, embedded fallback built in)"
            />
          </div>

          <div className="mt-6 border-t border-hairline pt-5">
            <p className="label-mono mb-3 flex items-center gap-2">
              <FolderOpen size={12} className="text-acid" /> resume file
            </p>
            <div className="flex items-center gap-3 rounded-xl border border-hairline bg-well px-4 py-3">
              <FileText size={17} className={s?.resume.exists ? "text-acid" : "text-fog"} />
              <div className="min-w-0">
                <p className="truncate font-mono text-[12.5px] text-mist">{s?.resume.filename ?? "…"}</p>
                <p className="text-[11px] text-fog">
                  {s?.resume.exists
                    ? `found in output/ · ${(s.resume.size / 1024).toFixed(1)} KB`
                    : "not found in output/ — a base resume will be generated automatically on first run"}
                </p>
              </div>
              <span className="ml-auto shrink-0">
                {s?.resume.exists ? (
                  <CheckCircle2 size={16} className="text-acid" />
                ) : (
                  <XCircle size={16} className="text-amberX" />
                )}
              </span>
            </div>
          </div>
        </div>

        {/* candidate */}
        <div className="panel fade-up p-6" style={{ animationDelay: "120ms" }}>
          <p className="label-mono mb-5 flex items-center gap-2">
            <CircleUser size={12} className="text-acid" /> candidate profile
          </p>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            {s &&
              ([
                ["name", s.candidate.name],
                ["email", s.candidate.email],
                ["phone", s.candidate.phone],
                ["linkedin", s.candidate.linkedin],
                ["location", s.candidate.location],
                ["relocation", s.candidate.relocation],
                ["work auth", s.candidate.workAuth],
                ["availability", s.candidate.availability],
                ["experience", s.candidate.experience],
                ["rate", s.candidate.expectedRate],
                ["cc", s.ccEmails.join(", ") || "—"],
                ["bcc", s.bccEmails.join(", ") || "—"],
              ] as Array<[string, string]>).map(([k, v]) => (
                <div key={k}>
                  <dt className="font-mono text-[10px] uppercase tracking-widest text-fog">{k}</dt>
                  <dd className="mt-0.5 truncate text-[13px] font-medium text-mist" title={v}>
                    {v || "—"}
                  </dd>
                </div>
              ))}
          </dl>
        </div>

        {/* bot tuning */}
        <div className="panel fade-up p-6" style={{ animationDelay: "180ms" }}>
          <p className="label-mono mb-5 flex items-center gap-2">
            <Bot size={12} className="text-acid" /> bot tuning
          </p>
          <dl className="space-y-3">
            {s &&
                ([
                ["run mode", "live only — real Chromium + LinkedIn + Gmail"],
                ["linkedin login wait", `${s.linkedinLoginWaitSec}s (first run only — session is stored after)`],
                ["default max emails / role", String(s.bot.maxEmailsPerRole)],
                ["delay between emails", `${s.bot.delayBetweenEmails}s`],
                ["scroll rounds", String(s.bot.scrollRounds)],
                ["wait between roles", `${s.bot.waitBetweenRolesMin}–${s.bot.waitBetweenRolesMax}s`],
                ["daily response target", `${s.dailyTarget}/day`],
              ] as Array<[string, string]>).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3 border-b border-hairline/60 pb-2.5 last:border-0 last:pb-0">
                  <dt className="font-mono text-[11px] uppercase tracking-wider text-fog">{k}</dt>
                  <dd className="font-mono text-[12.5px] font-semibold text-mist">{v}</dd>
                </div>
              ))}
          </dl>
        </div>

        {/* how to run live */}
        <div className="panel fade-up relative overflow-hidden p-6" style={{ animationDelay: "240ms" }}>
          <div className="scanline" />
          <p className="label-mono mb-5 flex items-center gap-2">
            <TerminalSquare size={12} className="text-acid" /> single-terminal launch
          </p>
          <ol className="space-y-3 text-[12.5px] leading-relaxed text-fog">
            {[
              "Fill in GMAIL_ID + GMAIL_APP_PASSWORD and candidate info in .env (already done).",
              "Drop your resume PDF into the output/ folder with the same RESUME_FILENAME.",
              "Start the app: npm run start — one command, one terminal.",
              "Open the console → New Run → answer role, search query, max emails, AI tailoring.",
              "Watch the live console. Gmail sends with your resume attached; CC/BCC auto-applied when set.",
              "First run: run npx playwright install chromium once, then log in in the opened browser window — the session is stored for every future run.",
            ].map((t, i) => (
              <li key={i} className="flex gap-3">
                <span className="grid size-5 shrink-0 place-items-center rounded-md border border-acid/40 bg-acid/10 font-mono text-[10px] font-bold text-acid">
                  {i + 1}
                </span>
                <span>{t}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

function ConnRow({
  ok,
  warn,
  title,
  sub,
}: {
  ok: boolean | undefined;
  warn?: string;
  title: string;
  sub: string;
}) {
  const state = ok ? "ok" : warn ? "warn" : "bad";
  return (
    <div className="flex items-center gap-3 rounded-xl border border-hairline bg-well px-4 py-3">
      <span>
        {state === "ok" ? (
          <CheckCircle2 size={16} className="text-acid" />
        ) : state === "warn" ? (
          <XCircle size={16} className="text-amberX" />
        ) : (
          <XCircle size={16} className="text-redX" />
        )}
      </span>
      <div className="min-w-0">
        <p className="text-[13.5px] font-semibold text-mist">{title}</p>
        <p className="truncate font-mono text-[11px] text-fog" title={sub}>
          {sub}
        </p>
      </div>
      <span
        className={`ml-auto shrink-0 text-right font-mono text-[10px] uppercase tracking-widest ${
          state === "ok" ? "text-acid" : state === "warn" ? "text-amberX" : "text-redX"
        }`}
        title={warn}
      >
        {state === "ok" ? "connected" : state === "warn" ? "attention" : "missing"}
      </span>
    </div>
  );
}
