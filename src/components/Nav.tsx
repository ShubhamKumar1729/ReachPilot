"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Radar, LayoutDashboard, Rocket, History, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import ThemeToggle from "@/components/ThemeToggle";
import LiveRunBadge from "@/components/LiveRunBadge";

const LINKS = [
  { href: "/", label: "Console", icon: LayoutDashboard },
  { href: "/run/new", label: "New Run", icon: Rocket },
  { href: "/history", label: "Outbox", icon: History },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Nav() {
  const pathname = usePathname();
  const [smtpOk, setSmtpOk] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => setSmtpOk(Boolean(d?.gmail?.configured)))
      .catch(() => setSmtpOk(null));
  }, []);

  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-ink/90 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="group flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-[10px] border border-acid/40 bg-acid/10 text-acid transition-colors group-hover:border-acid/70">
            <Radar size={18} strokeWidth={2.2} />
          </span>
          <span className="leading-tight">
            <span className="block text-[16px] font-bold tracking-[0.01em] text-paper">
              REACH<span className="text-acid">PILOT</span>
            </span>
            <span className="block font-mono text-[9.5px] uppercase tracking-[0.24em] text-mist">
              recruiter outreach engine
            </span>
          </span>
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2">
          {LINKS.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`relative flex items-center gap-2 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors ${
                  active
                    ? "text-paper"
                    : "text-fog hover:bg-panel2 hover:text-paper"
                }`}
              >
                <Icon size={15} strokeWidth={2.2} className={active ? "text-acid" : ""} />
                <span className="hidden sm:inline">{label}</span>
                {active && (
                  <span className="absolute inset-x-3 -bottom-[13px] h-[2px] rounded-full bg-acid" />
                )}
              </Link>
            );
          })}
          <LiveRunBadge />
          <span className="ml-1 hidden sm:contents">
            <ThemeToggle />
          </span>
          <span
            className="ml-1 hidden items-center gap-2 sm:flex"
            title="Gmail SMTP status"
          >
            <span className="chip">
              <span
                className={
                  smtpOk === null
                    ? "size-1.5 rounded-full bg-fog"
                    : smtpOk
                      ? "pulse-dot"
                      : "size-1.5 rounded-full bg-redX"
                }
              />
              {smtpOk === null ? "smtp …" : smtpOk ? "smtp ready" : "smtp off"}
            </span>
          </span>
        </nav>
      </div>
    </header>
  );
}
