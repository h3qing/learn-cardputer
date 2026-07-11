"use client";

import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";

const ICONS: Record<Theme, string> = { system: "◐", light: "☀", dark: "☾" };
const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };

function apply(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

/** system → light → dark 三态循环,与 heqing-blog 共用 localStorage.theme 约定。 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark") setTheme(stored);
  }, []);

  function cycle() {
    const next = NEXT[theme];
    localStorage.setItem("theme", next);
    apply(next);
    setTheme(next);
  }

  return (
    <button className="theme-toggle" onClick={cycle} aria-label={`主题:${theme}`} title={`主题:${theme}`}>
      {ICONS[theme]}
    </button>
  );
}
