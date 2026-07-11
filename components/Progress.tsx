"use client";

import { useEffect, useState } from "react";
import { STRINGS, type Locale } from "@/lib/i18n";
import { DONE_KEY, readDone } from "@/lib/progress";

/** Checkmark shown on the roadmap for completed lessons. */
export function DoneMark({ slug }: { slug: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => setDone(readDone().includes(slug)), [slug]);
  if (!done) return null;
  return (
    <span className="done-mark" title="✓">
      ✓
    </span>
  );
}

/** Toggle button on a lesson page. Progress lives in localStorage only. */
export function DoneButton({ slug, locale = "zh" }: { slug: string; locale?: Locale }) {
  const t = STRINGS[locale];
  const [done, setDone] = useState(false);
  useEffect(() => setDone(readDone().includes(slug)), [slug]);

  function toggle() {
    const current = readDone();
    const next = done ? current.filter((s) => s !== slug) : [...current, slug];
    localStorage.setItem(DONE_KEY, JSON.stringify(next));
    setDone(!done);
  }

  return (
    <button className={done ? "done-btn is-done" : "done-btn"} onClick={toggle}>
      {done ? t.undoneBtn : t.doneBtn}
    </button>
  );
}
