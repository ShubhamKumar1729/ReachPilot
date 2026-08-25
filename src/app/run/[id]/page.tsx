"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  OctagonX,
  ExternalLink,
  Sparkles,
  MailX,
  Radar,
  Activity,
  ShieldCheck,
  Gauge,
  Trash2,
  Pause,
  Play,
  FlaskConical,
} from "lucide-react";
import type { LogRow, RunRow, SentRow } from "@/lib/types";
import { fmtDate, runStatusColor } from "@/lib/types";

interface PollPayload {
  ok: boolean;
  run: RunRow;
  logs: LogRow[];
  sent: SentRow[];
  active: boolean;
}

const LEVEL_STYLE: Record<string, { text: string; tag: string }> = {
  info: { text: "text-fog", tag: "INFO" },
  ok: { text: "text-ok", tag: " OK " },
  warn: { text: "text-amberX", tag: "WARN" },
  err: { text: "text-redX", tag: "ERR " },
  mail: { text: "text-blueX", tag: "MAIL" },
  sys: { text: "text-cyanX", tag: "SYS " },
};

export default function RunConsolePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [data, setData] = useState<PollPayload | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [stopping, setStopping] = useState(false);
  const termRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const poll = useCallback(async () => {
    try {
      const r = await fetch(`/api/runs/${id}`, { cache: "no-store" });
      if (r.status === 404) {
        setNotFound(true);
        return;
      }
      const d = (await r.json()) as PollPayload;
      setData(d);
    } catch {
      /* retry next tick */
    }
  }, [id]);

  useEffect(() => {
    poll();
    const t = setInterval(poll, 1500);
    return () => clearInterval(t);
  }, [poll]);

  useEffect(() => {
    const el = termRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [data?.logs.length]);

  const onTermScroll = () => {
    const el = termRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  const [pausing, setPausing] = useState(false);
  const stop = async () => {
    setStopping(true);
    try {
      await fetch(`/api/runs/${id}/stop`, { method: "POST" });
      await poll();
    } finally {
      setStopping(false);
    }
  };

  const setPaused = async (paused: boolean) => {
    setPausing(true);
    try {
      await fetch(`/api/runs/${id}/${paused ? "pause" : "resume"}`, {
        method: "POST",
      });
      await poll();
    } finally {
      setPausing(false);
    }
  };

  if (notFound) {
    return (
      <div className="pt-24 text-center">
        <p className="text-xl font-bold text-paper">Run not found</p>
        <Link href="/" className="btn btn-ghost mt-6">
          <ArrowLeft size={15} /> Back to console
        </Link>
      </div>
    );
  }

  const run = data?.run;
  const running = run?.status === "running" || run?.status === "queued";
  const paused = Boolean(run?.paused) && running;
  const pct = run ? Math.min(100, Math.round((run.sentCount / Math.max(1, run.maxEmails)) * 100)) : 0;

  return (
    <div className="pt-8">
      {/* header */}
      <div className="fade-up flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/" className="mb-2 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-widest text-fog transition-colors hover:text-acid">
            <ArrowLeft size={12} /> console
          </Link>
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-bold tracking-tight text-paper sm:text-3xl">
            {run?.role ?? "…"}
            {run && (
              <span className={`chip border ${runStatusColor(run.status)}`}>
                {running && !paused && <span className="pulse-dot" />}
              {paused ? "paused" : run.status}
            </span>
            )}
            {run?.mode === "test" && (
              <span className="chip border border-amberX/40 bg-amberX/10 text-amberX">
                <FlaskConical size={10} /> test — nothing sent
              </span>
            )}
            {run?.customizeResume && (
              <span className="chip border border-violetX/40 bg-violetX/10 text-violetX">
                <Sparkles size={10} /> ai tailor
              </span>
            )}
          </h1>
          <p className="mt-1 max-w-2xl truncate font-mono text-[11.5px] text-fog">
            {run?.roles && run.roles.length > 1
              ? `${run.roles.length} roles: ` + run.roles.map((r) => r.role).join(" → ")
              : `query: ${run?.query ?? "…"}`}
          </p>
        </div>
        {running && (
          <div className="flex flex-wrap items-center gap-2">
            {paused ? (
              <button
                onClick={() => setPaused(false)}
                disabled={pausing}
                className="btn btn-acid"
              >
                <Play size={15} /> Resume
              </button>
            ) : (
              <button
                onClick={() => setPaused(true)}
                disabled={pausing}
                className="btn btn-ghost"
                title="Pause between scroll rounds / emails / roles"
              >
                <Pause size={15} /> Pause
              </button>
            )}
            <button onClick={stop} disabled={stopping} className="btn btn-danger">
              <OctagonX size={15} /> {stopping ? "Stopping…" : "Stop run"}
            </button>
          </div>
        )}
      </div>

      {/* progress strip */}
      <div className="panel fade-up mt-5 grid grid-cols-2 gap-px overflow-hidden sm:grid-cols-4" style={{ animationDelay: "60ms" }}>
        <Metric icon={<Radar size={15} />} label="posts scanned" value={run ? String(run.postsScanned) : "…"} />
        <Metric icon={<ShieldCheck size={15} />} label="emails processed" value={run ? `${run.sentCount} / ${run.maxEmails}` : "…"} highlight />
        <Metric icon={<MailX size={15} />} label="skipped / filtered" value={run ? String(run.skippedCount) : "…"} />
        <Metric icon={<Gauge size={15} />} label="progress" value={`${pct}%`} />
        <div className="col-span-2 bg-well px-5 pb-4 pt-1 sm:col-span-4">
          <div className="h-1.5 overflow-hidden rounded-full bg-hairline2/60">
            <div
              className="h-full rounded-full bg-acid transition-all duration-700"
              style={{ width: `${pct}%` }}
            />
          </div>
          {run?.roleProgress && run.roleProgress.length > 1 && (
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
              {run.roleProgress.map((p) => (
                <span key={p.role} className="font-mono text-[10.5px] text-fog">
                  {p.role}{" "}
                  <span className={p.sent >= p.limit ? "text-ok" : "text-mist"}>
                    {p.sent}/{p.limit}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {run?.status === "failed" && (
        <div className="fade-up mt-4 rounded-xl border border-redX/40 bg-redX/10 px-5 py-4 font-mono text-[12.5px] text-redX">
          RUN FAILED — {run.error}
        </div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-5">
        {/* terminal */}
        <div className="panel fade-up overflow-hidden lg:col-span-3" style={{ animationDelay: "120ms" }}>
          <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
            <span className="flex items-center gap-2 font-mono text-[11px] tracking-wider text-fog">
              <Activity size={12} className="text-acid" /> live engine log
            </span>
            {running && (
              <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-acid">
                <span className="pulse-dot" /> streaming
              </span>
            )}
          </div>
          <div
            ref={termRef}
            onScroll={onTermScroll}
            className="h-[460px] space-y-[7px] overflow-y-auto bg-well2 px-5 py-4 font-mono text-[12px] leading-relaxed"
          >
            {!data || data.logs.length === 0 ? (
              <p className="text-fog">$ awaiting engine output<span className="caret" /></p>
            ) : (
              data.logs.map((l, i) => {
                const st = LEVEL_STYLE[l.level] ?? LEVEL_STYLE.info;
                return (
                  <p key={`${l.id}:${i}`} className="log-line flex gap-2.5 break-words">
                    <span className="shrink-0 select-none text-fog/50">
                      {new Date(l.createdAt).toLocaleTimeString(undefined, { hour12: false })}
                    </span>
                    <span className={`shrink-0 select-none ${st.text} opacity-70`}>[{st.tag}]</span>
                    <span className={st.text}>{l.message}</span>
                  </p>
                );
              })
            )}
            {running && <span className="caret" />}
          </div>
        </div>

        {/* outbox for this run */}
        <div className="panel fade-up flex max-h-[540px] flex-col overflow-hidden lg:col-span-2" style={{ animationDelay: "180ms" }}>
          <div className="border-b border-hairline px-5 py-3">
            <span className="font-mono text-[11px] tracking-wider text-fog">
              run outbox · {data?.sent.length ?? 0}
            </span>
          </div>
          <div className="flex-1 space-y-2.5 overflow-y-auto p-4">
            {!data || data.sent.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center text-fog">
                <Radar size={22} className="mb-2 animate-pulse" />
                <p className="text-[12.5px]">No dispatches yet — the engine is still hunting genuine posts.</p>
              </div>
            ) : (
              data.sent.map((s) => (
                <div key={s.id} className="log-line rounded-xl border border-hairline bg-well p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-mono text-[12.5px] font-semibold text-mist">{s.email}</p>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span
                        className={`chip !py-0.5 border ${
                          s.status === "SENT"
                            ? "text-ok border-ok/40 bg-ok/10"
                            : "text-redX border-redX/40 bg-redX/10"
                        }`}
                      >
                        {s.status.toLowerCase()}
                      </span>
                      <button
                        onClick={async () => {
                          await fetch(`/api/sent/${s.id}`, { method: "DELETE" }).catch(
                            () => undefined
                          );
                          poll();
                        }}
                        className="rounded-md p-1 text-fog/60 transition-colors hover:bg-redX/10 hover:text-redX"
                        title="Delete this record"
                      >
                        <Trash2 size={12} />
                      </button>
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-fog">
                    {s.postAuthor || "recruiter"} · {fmtDate(s.sentAt)}
                  </p>
                  {s.matchedSkills && (
                    <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-violetX/90">
                      <Sparkles size={10} className="mt-0.5 shrink-0" />
                      <span className="leading-snug">{s.matchedSkills}</span>
                    </p>
                  )}
                  {s.error && <p className="mt-1.5 text-[11px] text-redX">{s.error}</p>}
                  {s.postLink && (
                    <a
                      href={s.postLink}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1.5 inline-flex items-center gap-1 font-mono text-[10.5px] text-blueX/90 transition-colors hover:text-blueX"
                    >
                      <ExternalLink size={10} /> source post
                    </a>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="bg-well px-5 py-4">
      <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-fog">
        <span className={highlight ? "text-acid" : "text-fog"}>{icon}</span> {label}
      </p>
      <p className={`mt-1.5 text-xl font-bold tracking-tight ${highlight ? "text-acid" : "text-paper"}`}>{value}</p>
    </div>
  );
}
