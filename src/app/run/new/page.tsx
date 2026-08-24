"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Terminal,
  ChevronRight,
  Rocket,
  Sparkles,
  Lightbulb,
  MailWarning,
  CheckCheck,
  Loader2,
  CircleUser,
  SlidersHorizontal,
  BrainCircuit,
  ArrowLeft,
} from "lucide-react";
import type { SettingsPayload } from "@/lib/types";

const QUERY_SUGGESTIONS = [
  'DevOps AND (W2 OR Fulltime) AND (AWS OR Kubernetes) -C2C -Hotlist -Bench',
  '"Data Engineer" AND hiring AND (Snowflake OR Databricks) -bench',
  '"Product Analyst" AND (hiring OR opening) AND SQL -bench',
  'Java Developer AND (W2 OR "full time") AND hiring -C2C -bench',
  '"Business Analyst" AND hiring AND (remote OR onsite) -bench',
];

type Step = 0 | 1 | 2 | 3 | 4;

export default function NewRunPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [step, setStep] = useState<Step>(0);
  const [role, setRole] = useState("");
  const [query, setQuery] = useState("");
  const [maxEmails, setMaxEmails] = useState<number>(15);
  const [custom, setCustom] = useState("");
  const [customize, setCustomize] = useState<boolean | null>(null);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d: SettingsPayload) => {
        setSettings(d);
        setMaxEmails(d.bot?.maxEmailsPerRole ?? 15);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, [step]);

  const history: Array<{ label: string; value: string }> = [];
  if (step > 0) history.push({ label: "target role", value: role });
  if (step > 1) history.push({ label: "search query", value: query });
  if (step > 2) history.push({ label: "max emails", value: String(maxEmails) });
  if (step > 3)
    history.push({
      label: "resume ai tailor",
      value: customize ? "yes — customize per JD (Groq)" : "no — use base resume",
    });

  const applyMax = (v: number) => {
    const n = Math.min(500, Math.max(1, Math.floor(v || 0)));
    setMaxEmails(n || 1);
  };

  const nextFrom = (s: Step) => {
    if (s === 0 && !role.trim()) return;
    if (s === 1 && !query.trim()) return;
    setStep((s + 1) as Step);
  };

  const launch = async () => {
    if (launching) return;
    setLaunching(true);
    setError("");
    try {
      const r = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role: role.trim(),
            query: query.trim(),
            maxEmails,
            customizeResume: Boolean(customize),
          }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "failed to start run");
      router.push(`/run/${d.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to start run");
      setLaunching(false);
    }
  };

  const groqConfigured = settings?.groq?.configured ?? false;
  const groqValid = settings?.groq?.valid;
  const groqReady = groqConfigured && groqValid === true;
  const groqHint = !groqConfigured
    ? "GROQ_API_KEY missing — base resume will be used regardless"
    : groqValid === false
      ? "GROQ_API_KEY was rejected by Groq (401) — fix it in .env; base resume fallback applies"
      : groqValid === null
        ? "could not verify Groq right now — tailoring will be attempted with safe fallback"
        : `model ${settings?.groq.model} is connected and ready`;
  const smtpOn = settings?.gmail?.configured ?? false;

  return (
    <div className="pt-10">
      <div className="fade-up mb-6 flex items-end justify-between">
        <div>
          <p className="label-mono mb-2 flex items-center gap-2">
            <Terminal size={12} className="text-acid" /> new outreach run · guided setup
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-paper sm:text-4xl">
            Configure &amp; launch<span className="caret" />
          </h1>
        </div>
        <span className="chip hidden sm:inline-flex">
          <Rocket size={10} />
          live mode only
        </span>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* ------------ TERMINAL WIZARD ------------ */}
        <div className="panel panel-glow fade-up relative overflow-hidden lg:col-span-3" style={{ animationDelay: "80ms" }}>
          {/* title bar */}
          <div className="flex items-center gap-2 border-b border-hairline px-5 py-3">
            <span className="size-2.5 rounded-full bg-redX/70" />
            <span className="size-2.5 rounded-full bg-amberX/70" />
            <span className="size-2.5 rounded-full bg-acid/70" />
            <span className="ml-3 font-mono text-[11px] tracking-wider text-fog">
              reachpilot — run.setup — interactive
            </span>
          </div>

          <div className="space-y-6 px-5 py-6 sm:px-7">
            {/* history of answered steps */}
            {history.map((h) => (
              <div key={h.label} className="log-line">
                <p className="font-mono text-[12px] text-fog">
                  <span className="text-acid">$</span> {h.label}
                </p>
                <p className="mt-1 flex items-start gap-2 font-mono text-[13px] leading-relaxed text-mist">
                  <CheckCheck size={13} className="mt-0.5 shrink-0 text-acid" />
                  <span className="break-all">“{h.value}”</span>
                </p>
              </div>
            ))}

            {/* STEP 0 — ROLE */}
            {step === 0 && (
              <WizardField
                label="target role"
                hint="the role you are applying to — it is used verbatim in subject, body and AI tailoring"
              >
                <input
                  ref={inputRef}
                  className="input-dark"
                  placeholder='e.g. "DevOps Engineer", "Data Analyst", "Java Developer"'
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && nextFrom(0)}
                />
              </WizardField>
            )}

            {/* STEP 1 — QUERY */}
            {step === 1 && (
              <WizardField
                label="linkedin search query"
                hint="what the bot searches in the LinkedIn Posts tab — location: anywhere"
              >
                <input
                  ref={inputRef}
                  className="input-dark"
                  placeholder='e.g. DevOps AND (W2 OR Fulltime) AND (AWS OR Kubernetes) -C2C -Bench'
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && nextFrom(1)}
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  {QUERY_SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => setQuery(s)}
                      className="chip cursor-pointer transition-all hover:border-acid/40 hover:text-acid"
                      title="Use this query"
                    >
                      <Lightbulb size={9} /> {s.length > 52 ? s.slice(0, 52) + "…" : s}
                    </button>
                  ))}
                </div>
              </WizardField>
            )}

            {/* STEP 2 — MAX EMAILS */}
            {step === 2 && (
              <WizardField
                label="max emails to send"
                hint="the run stops the moment this target is reached"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {[3, 5, 10, 15, 25, 50].map((n) => (
                    <button
                      key={n}
                      onClick={() => applyMax(n)}
                      className={`btn !rounded-lg !px-4 !py-2 font-mono text-[13px] ${
                        maxEmails === n && custom === "" ? "btn-acid" : "btn-ghost"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                  <div className="flex items-center gap-2">
                    <input
                      ref={inputRef}
                      type="number"
                      min={1}
                      max={500}
                      className="input-dark !w-24 text-center"
                      placeholder="custom"
                      value={custom}
                      onChange={(e) => {
                        setCustom(e.target.value);
                        applyMax(parseInt(e.target.value, 10));
                      }}
                      onKeyDown={(e) => e.key === "Enter" && nextFrom(2)}
                    />
                  </div>
                </div>
              </WizardField>
            )}

            {/* STEP 3 — RESUME CUSTOMIZATION */}
            {step === 3 && (
              <WizardField
                label="customize resume per JD with groq ai?"
                hint={groqHint}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <ChoiceCard
                    active={customize === true}
                    onClick={() => setCustomize(true)}
                    icon={<BrainCircuit size={17} />}
                    title="YES — tailor per post"
                    body="For each recruiter email, Groq reads the post's JD, rewrites your resume to match it, and personalizes the pitch line."
                    disabled={!groqReady}
                    warn={!groqReady ? "Groq unavailable — see note below" : undefined}
                  />
                  <ChoiceCard
                    active={customize === false}
                    onClick={() => setCustomize(false)}
                    icon={<SlidersHorizontal size={17} />}
                    title="NO — base resume"
                    body="Attach the resume from your output/ folder to every email. Faster, zero AI latency."
                  />
                </div>
              </WizardField>
            )}

            {/* STEP 4 — CONFIRM & LAUNCH (live only — no simulation mode) */}
            {step === 4 && (
              <div className="log-line space-y-5">
                <WizardField
                  label="confirm & launch"
                  hint="every run is live: real Chromium tab, real LinkedIn, real Gmail sends"
                >
                  <div className="rounded-xl border border-hairline2 bg-well p-4 text-[13px] leading-relaxed text-fog">
                    <p>When you hit launch, the engine will:</p>
                    <ol className="mt-2 list-decimal space-y-1.5 pl-5">
                      <li>
                        Open a <span className="text-mist">new Chromium tab</span> with your saved
                        LinkedIn session — if none is saved yet, the window waits for your one-time
                        sign-in and then remembers it forever.
                      </li>
                      <li>
                        Search <span className="text-mist">“{query.trim() || "your query"}”</span> in
                        LinkedIn posts and scroll through the results.
                      </li>
                      <li>
                        Keep only genuine posts that match{" "}
                        <span className="text-mist">{role.trim() || "your role"}</span> — bench-sales
                        and hotlist posts are auto-blocked.
                      </li>
                      <li>
                        Email the recruiter address(es) found <b>inside the post</b> via Gmail, one
                        every {settings?.bot?.delayBetweenEmails ?? 12}s, stopping at {maxEmails}{" "}
                        email{maxEmails > 1 ? "s" : ""}.
                      </li>
                    </ol>
                  </div>
                </WizardField>

                {!smtpOn && (
                  <p className="flex items-center gap-2 rounded-xl border border-amberX/40 bg-amberX/10 px-4 py-3 font-mono text-[12px] text-amberX">
                    <MailWarning size={14} /> Gmail SMTP not configured — set GMAIL_ID +
                    GMAIL_APP_PASSWORD in .env and restart the server, or the run will fail immediately.
                  </p>
                )}

                {error && (
                  <p className="flex items-center gap-2 rounded-xl border border-redX/40 bg-redX/10 px-4 py-3 font-mono text-[12px] text-redX">
                    <MailWarning size={14} /> {error}
                  </p>
                )}

                <div className="flex items-center gap-3">
                  <button onClick={launch} disabled={launching} className="btn btn-acid flex-1 !py-4 text-[15px]">
                    {launching ? (
                      <>
                        <Loader2 size={17} className="animate-spin" /> Igniting engine…
                      </>
                    ) : (
                      <>
                        <Rocket size={17} strokeWidth={2.4} />
                        Launch live run — {maxEmails} real email{maxEmails > 1 ? "s" : ""}
                        {customize ? " · AI-tailored" : ""}
                      </>
                    )}
                  </button>
                  <button onClick={() => setStep(3)} className="btn btn-ghost !py-4">
                    back
                  </button>
                </div>
              </div>
            )}

            {/* step advance bar */}
            {step < 4 && (
              <div className="flex items-center justify-between border-t border-hairline pt-4">
                <div className="flex gap-1.5">
                  {[0, 1, 2, 3].map((i) => (
                    <span
                      key={i}
                      className={`h-1 rounded-full transition-all ${
                        i === step ? "w-8 bg-acid" : i < step ? "w-4 bg-acid/40" : "w-4 bg-hairline2"
                      }`}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  {step > 0 && (
                    <button
                      onClick={() => setStep((step - 1) as Step)}
                      className="btn btn-ghost !px-4 !py-2 font-mono text-[12px] uppercase tracking-wider"
                    >
                      <ArrowLeft size={13} /> back
                    </button>
                  )}
                  <button
                    onClick={() => nextFrom(step)}
                    disabled={(step === 0 && !role.trim()) || (step === 1 && !query.trim()) || (step === 3 && customize === null)}
                    className="btn btn-ghost !px-4 !py-2 font-mono text-[12px] uppercase tracking-wider"
                  >
                    continue <ChevronRight size={13} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ------------ LIVE BLUEPRINT ------------ */}
        <div className="space-y-5 lg:col-span-2">
          <div className="panel fade-up p-6" style={{ animationDelay: "140ms" }}>
            <p className="label-mono mb-4 flex items-center gap-2">
              <CircleUser size={12} className="text-acid" /> sender identity
            </p>
            <dl className="space-y-2.5 text-[13px]">
              {[
                ["candidate", settings?.candidate.name],
                ["from", settings?.gmail.id],
                ["experience", settings?.candidate.experience],
                ["work auth", settings?.candidate.workAuth],
                ["availability", settings?.candidate.availability],
                ["rate", settings?.candidate.expectedRate],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="font-mono text-[11px] uppercase tracking-wider text-fog">{k}</dt>
                  <dd className="truncate text-right font-medium text-mist">{v ?? "…"}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-3 border-t border-hairline pt-2.5">
                <dt className="font-mono text-[11px] uppercase tracking-wider text-fog">cc / bcc</dt>
                <dd className="text-right font-mono text-[12px] text-fog">
                  {settings && (settings.ccEmails.length > 0 || settings.bccEmails.length > 0)
                    ? [...settings.ccEmails, ...settings.bccEmails].join(", ")
                    : "none (skipped)"}
                </dd>
              </div>
            </dl>
          </div>

          <div className="panel fade-up p-6" style={{ animationDelay: "200ms" }}>
            <p className="label-mono mb-4 flex items-center gap-2">
              <Sparkles size={12} className="text-violetX" /> subject preview
            </p>
            <p className="rounded-xl border border-hairline bg-well px-4 py-3 font-mono text-[12.5px] leading-relaxed text-mist">
              {(role.trim() || "<role>") +
                " | " +
                (settings?.candidate.name ?? "…") +
                " | " +
                (settings?.candidate.experience ?? "…") +
                " | " +
                (settings?.candidate.availability ?? "…")}
            </p>
            <p className="mt-3 text-[12px] leading-relaxed text-fog">
              Body opens with <span className="text-mist">“Dear Hiring Manager,”</span> followed by your JD-matched
              pitch, full submission details block, resume attachment and the source post link — the exact
              submission format.
            </p>
          </div>

          <div className="panel fade-up border-l-2 !border-l-acid p-6" style={{ animationDelay: "260ms" }}>
            <p className="label-mono mb-3">genuine-post guarantee</p>
            <ul className="space-y-2 text-[12.5px] leading-relaxed text-fog">
              <li className="flex gap-2"><CheckCheck size={13} className="mt-0.5 shrink-0 text-acid" /> Bench-sales / hotlist posts auto-blocked</li>
              <li className="flex gap-2"><CheckCheck size={13} className="mt-0.5 shrink-0 text-acid" /> Job-signal keywords must be present</li>
              <li className="flex gap-2"><CheckCheck size={13} className="mt-0.5 shrink-0 text-acid" /> Post must be relevant to your typed role</li>
              <li className="flex gap-2"><CheckCheck size={13} className="mt-0.5 shrink-0 text-acid" /> Your own / CC / BCC emails never contacted</li>
              <li className="flex gap-2"><CheckCheck size={13} className="mt-0.5 shrink-0 text-acid" /> Duplicate (email + post) protection, forever</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function WizardField({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="log-line">
      <p className="font-mono text-[12px] text-fog">
        <span className="text-acid">$</span> {label}
      </p>
      <div className="mt-2.5">{children}</div>
      <p className="mt-2 font-mono text-[10.5px] leading-relaxed text-fog/80">
        {"// "} {hint}
      </p>
    </div>
  );
}

function ChoiceCard({
  active,
  onClick,
  icon,
  title,
  body,
  disabled,
  warn,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  body: string;
  disabled?: boolean;
  warn?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl border p-4 text-left transition-colors ${
        active
          ? "border-acid/60 bg-acid/10"
          : "border-hairline2 bg-well hover:border-fog/50 hover:bg-well2"
      } ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
    >
      <span className={`flex items-center gap-2 text-[13.5px] font-semibold ${active ? "text-acid" : "text-mist"}`}>
        {icon} {title}
      </span>
      <span className="mt-1.5 block text-[12px] leading-relaxed text-fog">{warn ?? body}</span>
    </button>
  );
}
