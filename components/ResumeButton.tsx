"use client";

import { useEffect, useState } from "react";
import { pickResume, readLast, type LessonRef } from "@/lib/progress";
import { STRINGS, type Locale } from "@/lib/i18n";

/**
 * Homepage primary button: "start with lesson 1" for new visitors, or
 * "resume lesson N" when localStorage remembers where they left off.
 * Renders the default first, then upgrades after mount (no hydration flash).
 */
export default function ResumeButton({ lessons, locale }: { lessons: LessonRef[]; locale: Locale }) {
  const t = STRINGS[locale];
  const prefix = locale === "en" ? "/en" : "";
  const [target, setTarget] = useState<LessonRef | undefined>(lessons[0]);
  const [resuming, setResuming] = useState(false);

  useEffect(() => {
    const last = readLast();
    const picked = pickResume(lessons, last);
    if (picked) {
      setTarget(picked);
      setResuming(last !== null && picked.order > 1);
    }
  }, [lessons]);

  if (!target) return null;
  return (
    <a className="btn-primary" href={`${prefix}/lessons/${target.slug}`}>
      {resuming ? t.resumeBtn(target.order) : t.startBtn}
    </a>
  );
}
