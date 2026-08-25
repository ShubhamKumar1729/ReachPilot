"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Activity } from "lucide-react";

interface ActiveRun {
  id: string;
  role: string;
  status: string;
}

/** Persistent "live run" pill in the navbar: while a run is executing
 *  (even if you're on another page), one click brings you back to its
 *  live log. Polls the runs list every 4s. */
export default function LiveRunBadge() {
  const [active, setActive] = useState<ActiveRun | null>(null);

  useEffect(() => {
    let disposed = false;
    const load = () => {
      fetch("/api/runs", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          if (disposed) return;
          const runs: Array<ActiveRun> = Array.isArray(d.runs) ? d.runs : [];
          const run =
            runs.find((r) => r.status === "running") ??
            runs.find((r) => r.status === "queued") ??
            null;
          setActive(run);
        })
        .catch(() => undefined);
    };
    load();
    const t = setInterval(load, 4000);
    return () => {
      disposed = true;
      clearInterval(t);
    };
  }, []);

  if (!active) return null;

  const label =
    active.role.length > 18 ? active.role.slice(0, 18) + "…" : active.role;

  return (
    <Link
      href={`/run/${active.id}`}
      title="Open the live log of the running run"
      className="flex items-center gap-2 rounded-lg border border-acid/50 bg-acid/10 px-3 py-2 text-[12px] font-semibold text-acid transition-colors hover:bg-acid/20"
    >
      <Activity size={14} strokeWidth={2.4} className="animate-pulse" />
      <span className="hidden items-center gap-2 md:flex">
        live: <span className="max-w-36 truncate">{label}</span>
      </span>
      <span className="md:hidden">live</span>
      <span className="pulse-dot" />
    </Link>
  );
}
