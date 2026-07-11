"use client";

import { useEffect, useState } from "react";
import { markLast, readDone, type LessonRef } from "@/lib/progress";
import type { Locale } from "@/lib/i18n";

/**
 * Fixed right-side dot navigation on lesson pages — the same idiom as the
 * blog's explainer dot-nav. Current lesson is highlighted, completed lessons
 * are filled, hover reveals the lesson title. Also records the last-visited
 * lesson so the homepage can offer "resume".
 */
export default function LessonRail({
  lessons,
  currentSlug,
  locale,
}: {
  lessons: LessonRef[];
  currentSlug: string;
  locale: Locale;
}) {
  const [done, setDone] = useState<string[]>([]);
  const prefix = locale === "en" ? "/en" : "";

  useEffect(() => {
    markLast(currentSlug);
    setDone(readDone());
  }, [currentSlug]);

  return (
    <nav className="lesson-rail" aria-label={locale === "en" ? "Lessons" : "课程导航"}>
      {lessons.map((l) => {
        const state =
          l.slug === currentSlug ? "is-current" : done.includes(l.slug) ? "is-done" : "";
        return (
          <a
            key={l.slug}
            href={`${prefix}/lessons/${l.slug}`}
            className={`rail-dot ${state}`}
            data-label={`U${l.order} · ${l.title}`}
            aria-current={l.slug === currentSlug ? "page" : undefined}
          >
            <span className="visually-hidden">{`U${l.order} ${l.title}`}</span>
          </a>
        );
      })}
    </nav>
  );
}
