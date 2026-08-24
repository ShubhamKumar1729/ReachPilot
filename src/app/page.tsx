"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Rocket,
  Send,
  Users,
  Activity,
  Crosshair,
  RefreshCw,
  ArrowUpRight,
  Sparkles,
  MailCheck,
  ShieldCheck,
  FileText,
} from "lucide-react";
import type { StatsPayload } from "@/lib/types";
import { fmtDate, runStatusColor } from "@/lib/types";

const CAPS = [
  "genuine-post filtering",
  "bench-sales auto-block",
  "groq jd-tailored resumes",
  "gmail smtp dispatch",
  "duplicate protection",
  "live run console",
  "cc / bcc routing",
  "per-post skill matching",
];

export default function Dashboard() {
  const [data, setData] = useState<StatsPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/stats", { cache: "no-store" });
      const d = await r.json();
      setData(d);
    } catch {
      /* keep old data */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const t = data?.totals;
  const today = data?.today;
  const target = data?.dailyTarget ?? 20;
  const todayPct = Math.min(100, Math.round(((today?.count ?? 0) / target) * 100));

  return (
    <div className="pt-10">
      {/* HERO */}
      <section className="fade-up relative overflow-hidden rounded-2xl border border-hairline bg-panel p-8 sm:p-12">
        <div className="relative flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="label-mono mb-4 flex items-center gap-2">
              <span className="pulse-dot" /> system online · engine ready
            </p>
            <h1 className="max-w-2xl text-4xl font-bold leading-[1.05] tracking-tight text-paper sm:text-6xl">
              Hunt genuine posts.
              <br />
              <span className="text-acid">Strike recruiter inboxes.</span>
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-fog">
              Feed it a role and a LinkedIn search query. ReachPilot scrapes real hiring
              posts, blocks bench-sales noise, optionally tailors your resume per JD with
              Groq, and dispatches polished applications through your Gmail.
            </p>
          </div>
          <div className="flex flex-col items-start gap-3">
            <Link href="/run/new" className="btn btn-acid text-[15px]">
              <Rocket size={17} strokeWidth={2.4} /> Launch New Run
            </Link>
            <Link href="/history" className="btn btn-ghost text-sm">
              Open Outbox <ArrowUpRight size={15} />
            </Link>
          </div>
        </div>

        {/* capabilities */}
        <div className="mt-10 border-t border-hairline pt-5">
          <div className="flex flex-wrap gap-2">
            {CAPS.map((c) => (
              <span key={c} className="chip whitespace-nowrap">
                <Sparkles size={10} className="text-acid" /> {c}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* STATS */}
      <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          icon={<Send size={16} />}
          label="Emails sent"
          value={loading ? "…" : String(t?.totalSent ?? 0)}
          sub={`${t?.totalFailed ?? 0} failed · real SMTP dispatch`}
          accent="acid"
          delay={0}
        />
        <StatCard
          icon={<Users size={16} />}
          label="Unique recruiters"
          value={loading ? "…" : String(t?.uniqueRecruiters ?? 0)}
          sub="deduped across every run"
          accent="violetX"
          delay={60}
        />
        <div className="panel fade-up p-5" style={{ animationDelay: "120ms" }}>
          <div className="flex items-center justify-between">
            <span className="grid size-8 place-items-center rounded-lg border border-hairline2 bg-panel2 text-amberX">
              <Crosshair size={16} />
            </span>
            <span className="font-mono text-[10px] uppercase tracking-widest text-fog">today</span>
          </div>
          <p className="mt-4 text-3xl font-bold text-paper">{today?.count ?? 0}</p>
          <p className="mt-1 text-xs text-fog">sent today · target {target}/day</p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-hairline">
            <div
              className="h-full rounded-full bg-acid transition-all duration-700"
              style={{ width: `${todayPct}%` }}
            />
          </div>
        </div>
      </section>

      {/* RUNS + OUTBOX */}
      <section className="mt-6 grid gap-4 lg:grid-cols-5">
        {/* recent runs */}
        <div className="panel fade-up relative overflow-hidden p-6 lg:col-span-3" style={{ animationDelay: "220ms" }}>
          <div className="mb-5 flex items-center justify-between">
            <h2 className="flex items-center gap-2.5 text-lg font-bold text-paper">
              <Activity size={17} className="text-acid" /> Recent Runs
            </h2>
            <button onClick={load} className="btn btn-ghost !rounded-lg !p-2" title="Refresh">
              <RefreshCw size={14} />
            </button>
          </div>
          {!data || data.recentRuns.length === 0 ? (
            <EmptyState
              icon={<Rocket size={26} />}
              title="No runs yet"
              body="Launch your first run — give it a role, a LinkedIn search query and a target count."
              cta
            />
          ) : (
            <div className="space-y-2.5">
              {data.recentRuns.map((r) => (
                <Link
                  key={r.id}
                  href={`/run/${r.id}`}
                  className="group flex items-center justify-between gap-3 rounded-xl border border-hairline bg-well px-4 py-3 transition-colors hover:border-acid/40 hover:bg-well2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold text-mist group-hover:text-paper">
                      {r.role}
                      <span className="ml-2 font-mono text-[11px] text-fog">{r.sentCount}/{r.maxEmails}</span>
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-fog">{r.query}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {r.customizeResume && (
                      <span className="chip !py-1 text-violetX" title="Groq resume customization">
                        <Sparkles size={9} /> ai
                      </span>
                    )}
                    <span className={`chip !py-1 border ${runStatusColor(r.status)}`}>{r.status}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* recent outbox */}
        <div className="panel fade-up p-6 lg:col-span-2" style={{ animationDelay: "280ms" }}>
          <div className="mb-5 flex items-center justify-between">
            <h2 className="flex items-center gap-2.5 text-lg font-bold text-paper">
              <MailCheck size={17} className="text-acid" /> Latest Outbox
            </h2>
            <Link href="/history" className="font-mono text-[11px] uppercase tracking-widest text-fog transition-colors hover:text-acid">
              view all
            </Link>
          </div>
          {!data || data.recentSent.length === 0 ? (
            <EmptyState
              icon={<FileText size={26} />}
              title="Outbox empty"
              body="Delivered submissions land here with source post links."
            />
          ) : (
            <div className="space-y-2.5">
              {data.recentSent.map((s) => (
                <div key={s.id} className="rounded-xl border border-hairline bg-well px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-mono text-[12.5px] text-mist">{s.email}</p>
                    <span
                      className={`chip !py-0.5 border ${
                        s.status === "SENT"
                          ? "text-ok border-ok/40 bg-ok/10"
                          : "text-redX border-redX/40 bg-redX/10"
                      }`}
                    >
                      {s.status.toLowerCase()}
                    </span>
                  </div>
                  <p className="mt-1 flex items-center gap-2 text-[11px] text-fog">
                    <span className="truncate">{s.postAuthor || "recruiter"} · {s.role}</span>
                    {s.customized && <Sparkles size={10} className="shrink-0 text-violetX" />}
                    <span className="ml-auto shrink-0 font-mono text-[10px]">{fmtDate(s.sentAt)}</span>
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* pipeline strip */}
      <section className="panel fade-up mt-6 grid gap-0 overflow-hidden sm:grid-cols-4" style={{ animationDelay: "340ms" }}>
        {[
          { icon: Crosshair, t: "01 / Target", d: "Type the role + LinkedIn query. Location: anywhere." },
          { icon: ShieldCheck, t: "02 / Verify", d: "Bench-sales blocked, job-signal + role relevance enforced." },
          { icon: Sparkles, t: "03 / Tailor", d: "Groq rewrites your resume per JD and mines pitch skills." },
          { icon: Send, t: "04 / Dispatch", d: "Formatted submission + resume PDF via Gmail SMTP, CC/BCC aware." },
        ].map(({ icon: Icon, t: title, d }, i) => (
          <div key={title} className={`p-6 ${i > 0 ? "border-t border-hairline sm:border-l sm:border-t-0" : ""}`}>
            <Icon size={18} className="text-acid" />
            <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.18em] text-paper">{title}</p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-fog">{d}</p>
          </div>
        ))}
      </section>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  accent,
  delay,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  accent: "acid" | "violetX";
  delay: number;
}) {
  const colorMap = {
    acid: "text-acid",
    violetX: "text-violetX",
  } as const;
  return (
    <div className="panel fade-up p-5" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center justify-between">
        <span className={`grid size-8 place-items-center rounded-lg border border-hairline2 bg-panel2 ${colorMap[accent]}`}>
          {icon}
        </span>
      </div>
      <p className="mt-4 text-3xl font-bold tracking-tight text-paper">{value}</p>
      <p className="mt-0.5 text-[12.5px] font-medium text-mist">{label}</p>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-fog">{sub}</p>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  body,
  cta,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  cta?: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-hairline2 px-6 py-10 text-center">
      <span className="grid size-12 place-items-center rounded-xl border border-hairline2 bg-panel2 text-fog">{icon}</span>
      <p className="mt-4 text-[15px] font-semibold text-mist">{title}</p>
      <p className="mt-1 max-w-xs text-[12.5px] leading-relaxed text-fog">{body}</p>
      {cta && (
        <Link href="/run/new" className="btn btn-acid mt-5 !px-5 !py-2.5 text-[13px]">
          <Rocket size={14} /> New Run
        </Link>
      )}
    </div>
  );
}
