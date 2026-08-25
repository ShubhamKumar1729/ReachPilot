"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  Plus,
  Trash2,
  FlaskConical,
  Activity,
} from "lucide-react";
import Link from "next/link";
import type { RunRow, SettingsPayload } from "@/lib/types";
import { buildQuery } from "@/lib/queryBuilder";

const QUERY_SUGGESTIONS = [
  'DevOps AND (W2 OR Fulltime) AND (AWS OR Kubernetes) -C2C -Hotlist -Bench',
  '"Data Engineer" AND hiring AND (Snowflake OR Databricks) -bench',
  '"Product Analyst" AND (hiring OR opening) AND SQL -bench',
  'Java Developer AND (W2 OR "full time") AND hiring -C2C -bench',
  '"Business Analyst" AND hiring AND (remote OR onsite) -bench',
];

type Step = 0 | 1 | 2;

interface RoleDraft {
  id: number;
  role: string;
  query: string;
  maxEmails: number;
  customize: boolean | null; // null = not chosen yet
  selected: boolean;
}

interface Adv {
  includeKeywords: string;
  excludeKeywords: string;
  locations: string;
  companies: string;
  excludeCompanies: string;
}

const EMPTY_ADV: Adv = {
  includeKeywords: "",
  excludeKeywords: "",
  locations: "",
  companies: "",
  excludeCompanies: "",
};

export default function NewRunPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [step, setStep] = useState<Step>(0);
  const [roles, setRoles] = useState<RoleDraft[]>([
    { id: 1, role: "", query: "", maxEmails: 15, customize: null, selected: true },
  ]);
  const [globalLimit, setGlobalLimit] = useState("");
  const [mode, setMode] = useState<"live" | "test">("live");
  const [adv, setAdv] = useState<Adv>(EMPTY_ADV);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(2);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d: SettingsPayload) => {
        setSettings(d);
        // Smart defaults: pre-fill the last used configuration (still editable).
        const last = d.lastRun;
        if (last && last.roles?.length > 0) {
          setRoles(
            last.roles.slice(0, 10).map((r, i) => ({
              id: i + 1,
              role: r.role,
              query: r.query,
              maxEmails: r.maxEmails,
              customize: r.customizeResume,
              selected: true,
            }))
          );
          nextId.current = Math.max(2, last.roles.length + 1);
          if (last.globalLimit != null) setGlobalLimit(String(last.globalLimit));
          setMode(last.mode === "test" ? "test" : "live");
        } else {
          setRoles((rs) =>
            rs.map((r) => ({ ...r, maxEmails: d.bot?.maxEmailsPerRole ?? 15 }))
          );
        }
      })
      .catch(() => undefined);
    const loadRuns = () => {
      fetch("/api/runs", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => setRuns(Array.isArray(d.runs) ? d.runs : []))
        .catch(() => undefined);
    };
    loadRuns();
    // Keep the "run in progress" state live while the wizard is open.
    const t = setInterval(loadRuns, 4000);
    return () => clearInterval(t);
  }, []);

  const updateRole = (id: number, patch: Partial<RoleDraft>) =>
    setRoles((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const addRole = () =>
    setRoles((rs) =>
      rs.length >= 10
        ? rs
        : [
            ...rs,
            {
              id: nextId.current++,
              role: "",
              query: "",
              maxEmails: settings?.bot?.maxEmailsPerRole ?? 15,
              customize: null,
              selected: true,
            },
          ]
    );

  const removeRole = (id: number) =>
    setRoles((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : rs));

  const setAllSelected = (v: boolean) =>
    setRoles((rs) => rs.map((r) => ({ ...r, selected: v })));

  const selected = roles.filter(
    (r) => r.selected && r.role.trim() && r.query.trim()
  );
  const activeRun =
    runs.find((r) => r.status === "running") ??
    runs.find((r) => r.status === "queued") ??
    null;
  const canNextFromRoles =
    roles.some((r) => r.selected) &&
    roles
      .filter((r) => r.selected)
      .every((r) => r.role.trim() && r.query.trim());

  const sumBudget = selected.reduce((s, r) => s + r.maxEmails, 0);
  const gl = globalLimit.trim() ? Math.floor(Number(globalLimit)) || null : null;
  const totalBudget = gl != null ? Math.min(gl, sumBudget) : sumBudget;

  // Similar-search detection (exact role + query among the last 30 runs).
  const similar = useMemo(() => {
    const hits: { role: string; query: string; count: number }[] = [];
    for (const d of selected) {
      const count = runs.filter(
        (r) =>
          r.role.toLowerCase() === d.role.trim().toLowerCase() &&
          r.query === d.query.trim()
      ).length;
      if (count > 0) hits.push({ role: d.role.trim(), query: d.query.trim(), count });
    }
    return hits;
  }, [selected, runs]);

  const launch = async () => {
    if (launching) return;
    setLaunching(true);
    setError("");
    try {
      const r = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roles: selected.map((r) => ({
            role: r.role.trim(),
            query: r.query.trim(),
            maxEmails: r.maxEmails,
            customizeResume: r.customize === true,
          })),
          globalLimit: gl,
          mode,
          ...adv,
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
  const smtpOn = settings?.gmail?.configured ?? false;

  const history: Array<{ label: string; value: string }> = [];
  if (step > 0) {
    history.push({
      label: "roles",
      value: selected
        .map(
          (r) =>
            `“${r.role.trim()}” × ${r.maxEmails}${r.customize === true ? " · AI-tailored" : ""}`
        )
        .join("  →  "),
    });
  }
  if (step > 1) {
    const bits: string[] = [];
    if (gl != null) bits.push(`global limit ${gl}`);
    bits.push(
      mode === "test"
        ? "TEST mode (no real emails)"
        : "auto mode (live sends)"
    );
    if (adv.includeKeywords.trim()) bits.push(`must: ${adv.includeKeywords.trim()}`);
    if (adv.excludeKeywords.trim()) bits.push(`exclude: ${adv.excludeKeywords.trim()}`);
    if (adv.locations.trim()) bits.push(`location: ${adv.locations.trim()}`);
    if (adv.companies.trim()) bits.push(`companies: ${adv.companies.trim()}`);
    if (adv.excludeCompanies.trim()) bits.push(`exclude cos: ${adv.excludeCompanies.trim()}`);
    history.push({ label: "advanced", value: bits.length > 1 ? bits.join(" · ") : "none (defaults)" });
  }

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
          live mode
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
            {activeRun && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amberX/50 bg-amberX/10 px-4 py-3">
                <p className="flex items-center gap-2 font-mono text-[12px] font-bold text-amberX">
                  <Activity size={15} className="animate-pulse" /> A live run is
                  in progress — “{activeRun.role}”
                </p>
                <p className="w-full font-mono text-[11px] leading-relaxed text-fog sm:w-auto sm:flex-1">
                  Only one run can execute at a time (two scrapes on one
                  LinkedIn account = security checkpoint). Stop it or wait for
                  it to finish, then launch this one.
                </p>
                <Link
                  href={`/run/${activeRun.id}`}
                  className="btn btn-ghost !px-3 !py-1.5 font-mono text-[11px] uppercase tracking-wider"
                >
                  view live log <ChevronRight size={12} />
                </Link>
              </div>
            )}

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

            {/* STEP 0 — ROLES (the only required inputs) */}
            {step === 0 && (
              <div className="log-line space-y-4">
                <div className="flex items-center justify-between">
                  <p className="font-mono text-[12px] text-fog">
                    <span className="text-acid">$</span> target role{selected.length > 1 ? "s" : ""}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setAllSelected(true)}
                      className="font-mono text-[10.5px] uppercase tracking-wider text-fog transition-colors hover:text-acid"
                    >
                      select all
                    </button>
                    <span className="text-fog/40">·</span>
                    <button
                      onClick={() => setAllSelected(false)}
                      className="font-mono text-[10.5px] uppercase tracking-wider text-fog transition-colors hover:text-acid"
                    >
                      deselect
                    </button>
                  </div>
                </div>
                <p className="font-mono text-[10.5px] leading-relaxed text-fog/80">
                  {"// "} only Role + Search Query + Max Emails + Customize are
                  required. Add as many roles as you like — they run one after
                  another.
                </p>

                {roles.map((d, i) => (
                  <div
                    key={d.id}
                    className={`rounded-xl border p-4 transition-colors ${
                      d.selected
                        ? "border-acid/50 bg-acid/5"
                        : "border-hairline2 bg-well opacity-70"
                    }`}
                  >
                    <div className="mb-3 flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={d.selected}
                        onChange={(e) => updateRole(d.id, { selected: e.target.checked })}
                        style={{ accentColor: "var(--rp-acid)" }}
                        className="size-4 cursor-pointer"
                        title="Include this role in the run"
                      />
                      <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-fog">
                        role {i + 1}
                      </span>
                      {roles.length > 1 && (
                        <button
                          onClick={() => removeRole(d.id)}
                          className="ml-auto rounded-md p-1 text-fog/60 transition-colors hover:bg-redX/10 hover:text-redX"
                          title="Remove this role"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                    <div className="space-y-3">
                      <input
                        ref={i === 0 ? inputRef : undefined}
                        className="input-dark"
                        placeholder='role — e.g. "Java Developer"'
                        value={d.role}
                        onChange={(e) => updateRole(d.id, { role: e.target.value })}
                      />
                      <input
                        className="input-dark"
                        placeholder="LinkedIn posts search query — e.g. Java Developer AND hiring -C2C"
                        value={d.query}
                        onChange={(e) => updateRole(d.id, { query: e.target.value })}
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="font-mono text-[10.5px] uppercase tracking-wider text-fog">
                          max emails
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={500}
                          className="input-dark !w-24 !py-2 text-center"
                          value={d.maxEmails}
                          onChange={(e) =>
                            updateRole(d.id, {
                              maxEmails: Math.min(500, Math.max(1, Math.floor(Number(e.target.value) || 1))),
                            })
                          }
                        />
                        <div className="ml-auto flex gap-1.5">
                          <button
                            onClick={() => updateRole(d.id, { customize: true })}
                            className={`btn !rounded-lg !px-3 !py-2 font-mono text-[11px] uppercase tracking-wider ${
                              d.customize === true ? "btn-acid" : "btn-ghost"
                            }`}
                          >
                            <BrainCircuit size={12} /> AI tailor
                          </button>
                          <button
                            onClick={() => updateRole(d.id, { customize: false })}
                            className={`btn !rounded-lg !px-3 !py-2 font-mono text-[11px] uppercase tracking-wider ${
                              d.customize === false ? "btn-acid" : "btn-ghost"
                            }`}
                          >
                            <SlidersHorizontal size={12} /> base resume
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {QUERY_SUGGESTIONS.map((s) => (
                          <button
                            key={s}
                            onClick={() => updateRole(d.id, { query: s })}
                            className="chip cursor-pointer transition-colors hover:border-acid/40 hover:text-acid"
                            title="Use this query"
                          >
                            <Lightbulb size={9} /> {s.length > 44 ? s.slice(0, 44) + "…" : s}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}

                <button
                  onClick={addRole}
                  className="btn btn-ghost w-full !border-dashed !py-3 text-[13px]"
                >
                  <Plus size={15} /> Add another role
                </button>
              </div>
            )}

            {/* STEP 1 — ADVANCED (fully optional) */}
            {step === 1 && (
              <div className="log-line space-y-5">
                <p className="font-mono text-[12px] text-fog">
                  <span className="text-acid">$</span> advanced settings <span className="text-fog/60">(all optional — skip if you don&apos;t need them)</span>
                </p>
                <p className="font-mono text-[10.5px] leading-relaxed text-fog/80">
                  {"// "} keywords, locations and companies are merged into each
                  role&apos;s LinkedIn posts search using real LinkedIn operators
                  (AND / OR / -exclude). Empty = the same broad search as before.
                </p>

                <div className="grid gap-4 sm:grid-cols-2">
                  <AdvField
                    label="global max emails (all roles)"
                    hint="blank = sum of per-role limits"
                  >
                    <input
                      type="number"
                      min={1}
                      max={500}
                      placeholder={`blank (sums to ${sumBudget || "—"})`}
                      className="input-dark"
                      value={globalLimit}
                      onChange={(e) => setGlobalLimit(e.target.value)}
                    />
                  </AdvField>

                  <AdvField label="application mode">
                    <div className="grid gap-2">
                      <button
                        onClick={() => setMode("live")}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-[12.5px] transition-colors ${
                          mode === "live"
                            ? "border-acid/60 bg-acid/10 text-paper"
                            : "border-hairline2 bg-well text-fog hover:border-fog/50"
                        }`}
                      >
                        <Rocket size={14} className={mode === "live" ? "text-acid" : "text-fog/60"} />
                        Auto — live (real emails)
                      </button>
                      <button
                        onClick={() => setMode("test")}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-[12.5px] transition-colors ${
                          mode === "test"
                            ? "border-amberX/60 bg-amberX/10 text-paper"
                            : "border-hairline2 bg-well text-fog hover:border-fog/50"
                        }`}
                      >
                        <FlaskConical size={14} className={mode === "test" ? "text-amberX" : "text-fog/60"} />
                        Test — nothing gets sent
                      </button>
                    </div>
                  </AdvField>

                  <AdvField label="must contain (keywords)" hint="comma separated — e.g. React, Node.js, MongoDB">
                    <input
                      className="input-dark"
                      placeholder="e.g. React, Node.js"
                      value={adv.includeKeywords}
                      onChange={(e) => setAdv({ ...adv, includeKeywords: e.target.value })}
                    />
                  </AdvField>
                  <AdvField label="exclude (keywords)" hint="e.g. Senior, Lead, Manager, Architect">
                    <input
                      className="input-dark"
                      placeholder="e.g. Senior, Lead"
                      value={adv.excludeKeywords}
                      onChange={(e) => setAdv({ ...adv, excludeKeywords: e.target.value })}
                    />
                  </AdvField>
                  <AdvField label="locations (optional)" hint="searched as terms — e.g. Chandigarh, Remote, Canada">
                    <input
                      className="input-dark"
                      placeholder="e.g. Chandigarh, Remote"
                      value={adv.locations}
                      onChange={(e) => setAdv({ ...adv, locations: e.target.value })}
                    />
                  </AdvField>
                  <AdvField label="include companies (optional)">
                    <input
                      className="input-dark"
                      placeholder="e.g. Nerdoff, ZS"
                      value={adv.companies}
                      onChange={(e) => setAdv({ ...adv, companies: e.target.value })}
                    />
                  </AdvField>
                  <AdvField label="exclude companies (optional)">
                    <input
                      className="input-dark"
                      placeholder="e.g. Company X"
                      value={adv.excludeCompanies}
                      onChange={(e) => setAdv({ ...adv, excludeCompanies: e.target.value })}
                    />
                  </AdvField>
                </div>
              </div>
            )}

            {/* STEP 2 — CONFIRM & LAUNCH */}
            {step === 2 && (
              <div className="log-line space-y-5">
                <p className="font-mono text-[12px] text-fog">
                  <span className="text-acid">$</span> confirm &amp; launch
                </p>

                {mode === "test" && (
                  <p className="flex items-center gap-2 rounded-xl border border-amberX/50 bg-amberX/10 px-4 py-3 font-mono text-[12.5px] font-bold text-amberX">
                    <FlaskConical size={15} /> TEST MODE — NO EMAILS WILL BE SENT
                    (outbox stays untouched)
                  </p>
                )}

                {similar.length > 0 && (
                  <p className="flex items-start gap-2 rounded-xl border border-blueX/40 bg-blueX/10 px-4 py-3 font-mono text-[11.5px] leading-relaxed text-blueX">
                    <MailWarning size={14} className="mt-0.5 shrink-0" />
                    <span>
                      You&apos;ve already run this exact search —{" "}
                      {similar.map((s) => `“${s.role}” (${s.count} run${s.count > 1 ? "s" : ""})`).join(", ")}.
                      No problem: duplicate emails are blocked automatically, so
                      nobody gets contacted twice.
                    </span>
                  </p>
                )}

                <div className="rounded-xl border border-hairline2 bg-well p-4 text-[13px] leading-relaxed text-fog">
                  <p>
                    Roles run sequentially — {selected.length} role
                    {selected.length > 1 ? "s" : ""}, total budget{" "}
                    <b className="text-mist">{totalBudget} email{totalBudget > 1 ? "s" : ""}</b>
                    {gl != null ? ` (global limit ${gl})` : ""}:
                  </p>
                  <ol className="mt-2 list-decimal space-y-1.5 pl-5">
                    {selected.map((r) => (
                      <li key={r.id}>
                        <b className="text-mist">{r.role.trim()}</b> — {r.maxEmails} max
                        {r.customize === true ? " · AI-tailored resume" : " · base resume"}
                        <span className="block truncate font-mono text-[11px] text-fog/80">
                          {buildQuery(r.query.trim(), adv)}
                        </span>
                      </li>
                    ))}
                  </ol>
                  <p className="mt-2">
                    Every run is real: new Chromium tab, real LinkedIn, real post
                    filters{mode === "live" ? ", real Gmail sends" : " — but emails are prepared, not sent (test mode)"}, duplicate protection on.
                  </p>
                </div>

                {!smtpOn && mode === "live" && (
                  <p className="flex items-center gap-2 rounded-xl border border-amberX/40 bg-amberX/10 px-4 py-3 font-mono text-[12px] text-amberX">
                    <MailWarning size={14} /> Gmail SMTP not configured — set GMAIL_ID +
                    GMAIL_APP_PASSWORD in .env and restart the server, or the run will fail immediately.
                  </p>
                )}
                {!groqReady && selected.some((r) => r.customize === true) && (
                  <p className="flex items-center gap-2 rounded-xl border border-amberX/40 bg-amberX/10 px-4 py-3 font-mono text-[12px] text-amberX">
                    <MailWarning size={14} />
                    {!groqConfigured
                      ? "GROQ_API_KEY missing — base resume will be used for AI-tailored roles"
                      : "GROQ_API_KEY was rejected by Groq (401) — fix it in .env; base resume fallback applies"}
                  </p>
                )}

                {error && (
                  <p className="flex items-center gap-2 rounded-xl border border-redX/40 bg-redX/10 px-4 py-3 font-mono text-[12px] text-redX">
                    <MailWarning size={14} /> {error}
                  </p>
                )}

                <div className="flex items-center gap-3">
                  <button
                    onClick={launch}
                    disabled={launching || Boolean(activeRun)}
                    title={
                      activeRun
                        ? "A run is already in progress"
                        : undefined
                    }
                    className="btn btn-acid flex-1 !py-4 text-[15px]"
                  >
                    {launching ? (
                      <>
                        <Loader2 size={17} className="animate-spin" /> Igniting engine…
                      </>
                    ) : mode === "test" ? (
                      <>
                        <FlaskConical size={17} />
                        Launch test run — {totalBudget} prepared, 0 sent
                      </>
                    ) : (
                      <>
                        <Rocket size={17} strokeWidth={2.4} />
                        Launch live run — {totalBudget} real email{totalBudget > 1 ? "s" : ""}
                        {selected.some((r) => r.customize === true) ? " · AI-tailored" : ""}
                      </>
                    )}
                  </button>
                  <button onClick={() => setStep(1)} className="btn btn-ghost !py-4">
                    back
                  </button>
                </div>
              </div>
            )}

            {/* step advance bar */}
            <div className="flex items-center justify-between border-t border-hairline pt-4">
              <div className="flex gap-1.5">
                {[0, 1, 2].map((i) => (
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
                  onClick={() =>
                    setStep(
                      step === 0
                        ? canNextFromRoles
                          ? (1 as Step)
                          : step
                        : (2 as Step)
                    )
                  }
                  disabled={step === 0 && !canNextFromRoles}
                  className="btn btn-ghost !px-4 !py-2 font-mono text-[12px] uppercase tracking-wider"
                >
                  {step === 1 ? "skip / continue" : "continue"} <ChevronRight size={13} />
                </button>
              </div>
            </div>
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
              {(selected[0]?.role.trim() || "<role>") +
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
              <li className="flex gap-2"><CheckCheck size={13} className="mt-0.5 shrink-0 text-acid" /> Test mode never touches the outbox</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function AdvField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-fog">
        {label}
      </p>
      {children}
      {hint && (
        <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-fog/70">
          {"// "}
          {hint}
        </p>
      )}
    </div>
  );
}
