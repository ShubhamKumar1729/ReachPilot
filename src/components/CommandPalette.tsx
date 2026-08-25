"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Rocket,
  LayoutDashboard,
  History,
  Settings,
  SunMoon,
  Search,
} from "lucide-react";

interface Action {
  id: string;
  label: string;
  hint: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  run: () => void;
}

/** Ctrl/Cmd+K command palette — navigation + theme toggle. */
export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        setQ("");
        setIdx(0);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  const toggleTheme = () => {
    const el = document.documentElement;
    const next = el.dataset.theme === "light" ? "dark" : "light";
    el.classList.add("theme-anim");
    el.dataset.theme = next;
    window.setTimeout(() => el.classList.remove("theme-anim"), 350);
    try {
      localStorage.setItem("rp-theme", next);
    } catch {
      /* ignore */
    }
  };

  const actions: Action[] = useMemo(
    () => [
      {
        id: "new-run",
        label: "New Run",
        hint: "configure & launch outreach",
        icon: Rocket,
        run: () => router.push("/run/new"),
      },
      {
        id: "console",
        label: "Console",
        hint: "dashboard & live status",
        icon: LayoutDashboard,
        run: () => router.push("/"),
      },
      {
        id: "outbox",
        label: "Outbox / History",
        hint: "delivered submissions",
        icon: History,
        run: () => router.push("/history"),
      },
      {
        id: "settings",
        label: "Settings",
        hint: "environment & resume versions",
        icon: Settings,
        run: () => router.push("/settings"),
      },
      {
        id: "theme",
        label: "Toggle theme",
        hint: "light / dark",
        icon: SunMoon,
        run: toggleTheme,
      },
    ],
    [router]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return actions;
    return actions.filter((a) => a.label.toLowerCase().includes(needle));
  }, [actions, q]);

  const pick = (a: Action | undefined) => {
    if (!a) return;
    setOpen(false);
    a.run();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[14vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="panel w-full max-w-lg overflow-hidden !rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-hairline px-4 py-3">
          <Search size={15} className="text-fog" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIdx((i) => Math.min(filtered.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIdx((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                pick(filtered[idx]);
              }
            }}
            placeholder="type a command…"
            className="w-full bg-transparent text-[14px] text-paper outline-none placeholder:text-fog/60"
          />
          <kbd className="rounded border border-hairline2 px-1.5 py-0.5 font-mono text-[9.5px] text-fog">
            esc
          </kbd>
        </div>
        <div className="max-h-72 overflow-y-auto p-1.5">
          {filtered.length === 0 && (
            <p className="px-3 py-6 text-center text-[12.5px] text-fog">
              no matching command
            </p>
          )}
          {filtered.map((a, i) => (
            <button
              key={a.id}
              onClick={() => pick(a)}
              onMouseEnter={() => setIdx(i)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13.5px] transition-colors ${
                i === idx ? "bg-acid/10 text-paper" : "text-mist"
              }`}
            >
              <a.icon size={15} className={i === idx ? "text-acid" : "text-fog"} />
              <span className="font-medium">{a.label}</span>
              <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-fog/70">
                {a.hint}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
