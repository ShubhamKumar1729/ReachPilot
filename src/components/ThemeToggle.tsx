"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
  const obs = new MutationObserver(callback);
  obs.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => obs.disconnect();
}

const getSnapshot = () => document.documentElement.dataset.theme;
const getServerSnapshot = () => "dark";

/** Dark / light theme toggle. Persists to localStorage; applied pre-paint
 *  by the inline script in the root layout (no flash of wrong theme). */
export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const dark = theme !== "light";

  const toggle = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.classList.add("theme-anim");
    document.documentElement.dataset.theme = next;
    window.setTimeout(
      () => document.documentElement.classList.remove("theme-anim"),
      350
    );
    try {
      localStorage.setItem("rp-theme", next);
    } catch {
      /* private mode — theme just won't persist */
    }
  };

  return (
    <button
      onClick={toggle}
      className="btn btn-ghost !p-2.5"
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {dark ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}
