"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  History as HistoryIcon,
  Search,
  Download,
  ExternalLink,
  Sparkles,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { SentRow } from "@/lib/types";
import { fmtDate } from "@/lib/types";

const FILTERS = ["all", "SENT", "FAILED"] as const;

export default function HistoryPage() {
  const [rows, setRows] = useState<SentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/sent", { cache: "no-store" });
      const d = await r.json();
      setRows(d.rows ?? []);
    } catch {
      /* keep */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const del = async (id: string) => {
    await fetch(`/api/sent/${id}`, { method: "DELETE" }).catch(() => undefined);
    load();
  };

  const [deletingAll, setDeletingAll] = useState(false);
  const delAll = async () => {
    if (deletingAll) return;
    if (!rows.length) return;
    if (
      !confirm(
        `Delete ALL ${rows.length} outbox record(s)? This cannot be undone.`
      )
    )
      return;
    setDeletingAll(true);
    try {
      await fetch("/api/sent", { method: "DELETE" });
      load();
    } finally {
      setDeletingAll(false);
    }
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (!needle) return true;
      return (
        r.email.toLowerCase().includes(needle) ||
        r.role.toLowerCase().includes(needle) ||
        r.postAuthor.toLowerCase().includes(needle) ||
        r.subject.toLowerCase().includes(needle)
      );
    });
  }, [rows, q, filter]);

  const exportCsv = () => {
    const header = ["email", "post_link", "post_author", "role", "status", "customized", "matched_skills", "time"];
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const lines = [
      header.join(","),
      ...filtered.map((r) =>
        [r.email, r.postLink, r.postAuthor, r.role, r.status, r.customized ? "yes" : "no", r.matchedSkills, r.sentAt]
          .map(esc)
          .join(",")
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reachpilot_outbox_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="pt-10">
      <div className="fade-up mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label-mono mb-2 flex items-center gap-2">
            <HistoryIcon size={12} className="text-acid" /> delivered submissions
          </p>
          <h1 className="display text-[30px] text-paper sm:text-[40px]">Outbox</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="btn btn-ghost !px-4 !py-2.5 text-[13px]">
            <RefreshCw size={14} /> Refresh
          </button>
          <button onClick={exportCsv} disabled={filtered.length === 0} className="btn btn-acid !px-4 !py-2.5 text-[13px]">
            <Download size={14} /> Export CSV
          </button>
          <button
            onClick={delAll}
            disabled={rows.length === 0 || deletingAll}
            className="btn btn-ghost !px-4 !py-2.5 text-[13px] !text-redX"
          >
            <Trash2 size={14} /> {deletingAll ? "Deleting…" : "Delete all"}
          </button>
        </div>
      </div>

      {/* controls */}
      <div className="fade-up mb-4 flex flex-wrap items-center gap-3" style={{ animationDelay: "60ms" }}>
        <div className="relative min-w-64 flex-1">
          <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-fog" />
          <input
            className="input-dark !pl-10"
            placeholder="search email, role, recruiter, subject…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`btn !rounded-lg !px-3.5 !py-2 font-mono text-[11px] uppercase tracking-wider ${
                    filter === f ? "btn-acid" : "btn-ghost"
                  }`}
            >
              {f.toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {/* table */}
      <div className="panel fade-up overflow-hidden" style={{ animationDelay: "120ms" }}>
        <div className="overflow-x-auto">
          <table className="table-soft w-full min-w-[860px] text-left">
            <thead>
              <tr className="border-b border-hairline bg-panel2 font-mono text-[10px] uppercase tracking-[0.16em] text-fog">
                <th className="px-5 py-3.5 font-medium">recruiter email</th>
                <th className="px-5 py-3.5 font-medium">author / role</th>
                <th className="px-5 py-3.5 font-medium">status</th>
                <th className="px-5 py-3.5 font-medium">ai</th>
                <th className="px-5 py-3.5 font-medium">post</th>
                <th className="px-5 py-3.5 font-medium">time</th>
                <th className="px-3 py-3.5" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-14 text-center font-mono text-[12px] text-fog">
                    loading outbox…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-14 text-center">
                    <p className="text-[15px] font-semibold text-mist">Nothing here yet</p>
                    <p className="mt-1 text-[12.5px] text-fog">
                      Launch a run from the <Link href="/run/new" className="text-acid underline underline-offset-4">console</Link> to start filling the outbox.
                    </p>
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.id} className="border-b border-hairline/60 transition-colors last:border-0 hover:bg-panel2/60">
                    <td className="px-5 py-3.5">
                      <span className="font-mono text-[12.5px] text-mist">{r.email}</span>
                      {r.error && <p className="mt-0.5 max-w-64 truncate text-[10.5px] text-redX">{r.error}</p>}
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="max-w-52 truncate text-[12.5px] text-mist">{r.postAuthor || "—"}</p>
                      <p className="max-w-52 truncate font-mono text-[10.5px] text-fog">{r.role}</p>
                    </td>
                    <td className="px-5 py-3.5">
                        <span
                          className={`chip !py-0.5 border ${
                            r.status === "SENT"
                              ? "text-ok border-ok/40 bg-ok/10"
                              : "text-redX border-redX/40 bg-redX/10"
                          }`}
                        >
                          {r.status.toLowerCase()}
                        </span>
                    </td>
                    <td className="px-5 py-3.5">
                      {r.customized ? (
                        <span title={r.matchedSkills || "JD-tailored resume"}>
                          <Sparkles size={14} className="text-violetX" />
                        </span>
                      ) : (
                        <span className="text-fog/40">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <a
                        href={r.postLink}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-[11px] text-blueX/90 transition-colors hover:text-blueX"
                      >
                        <ExternalLink size={11} /> open
                      </a>
                    </td>
                    <td className="px-5 py-3.5 font-mono text-[11px] text-fog">{fmtDate(r.sentAt)}</td>
                    <td className="px-3 py-3.5">
                      <button
                        onClick={() => del(r.id)}
                        className="rounded-md p-1.5 text-fog/50 transition-colors hover:bg-redX/10 hover:text-redX"
                        title="Delete this record"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="helper mt-3 font-mono text-[10.5px] uppercase tracking-[0.14em]">
        {filtered.length} of {rows.length} records · duplicates blocked at the database level
      </p>
    </div>
  );
}
