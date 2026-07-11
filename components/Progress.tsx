"use client";

import { useEffect, useState } from "react";

const KEY = "cardputer-done";

function readDone(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

/** Checkmark shown on the roadmap for completed lessons. */
export function DoneMark({ slug }: { slug: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => setDone(readDone().includes(slug)), [slug]);
  if (!done) return null;
  return (
    <span className="done-mark" title="已完成">
      ✓
    </span>
  );
}

/** Toggle button on a lesson page. Progress lives in localStorage only. */
export function DoneButton({ slug }: { slug: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => setDone(readDone().includes(slug)), [slug]);

  function toggle() {
    const current = readDone();
    const next = done ? current.filter((s) => s !== slug) : [...current, slug];
    localStorage.setItem(KEY, JSON.stringify(next));
    setDone(!done);
  }

  return (
    <button className={done ? "done-btn is-done" : "done-btn"} onClick={toggle}>
      {done ? "✓ 已完成,点击撤销" : "标记为已完成"}
    </button>
  );
}
