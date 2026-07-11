import { notFound } from "next/navigation";
import { getAllLessons, getLessonBySlug, shortTopics } from "@/lib/lessons";
import { renderMarkdown } from "@/lib/markdown";
import { DoneButton } from "@/components/Progress";
import LessonRail from "@/components/LessonRail";
import { STRINGS, type Locale } from "@/lib/i18n";

export default function LessonView({ locale, slug }: { locale: Locale; slug: string }) {
  const t = STRINGS[locale];
  const lesson = getLessonBySlug(slug, locale);
  if (!lesson) notFound();

  const prefix = locale === "en" ? "/en" : "";
  const lessons = getAllLessons(locale);
  const idx = lessons.findIndex((l) => l.slug === lesson.slug);
  const prev = idx > 0 ? lessons[idx - 1] : undefined;
  const next = idx < lessons.length - 1 ? lessons[idx + 1] : undefined;

  return (
    <main className="lesson-page">
      <LessonRail
        lessons={lessons.map((l) => ({ slug: l.slug, order: l.order, title: l.title }))}
        currentSlug={lesson.slug}
        locale={locale}
      />
      <div className="lesson-header">
        <a href={`${prefix}/#lessons`} className="crumb">
          {t.crumb}
        </a>
        <p className="lesson-ref">
          U{lesson.order} · {shortTopics(lesson.hardware)}
        </p>
        <h1>{lesson.title}</h1>
        <p className="lesson-subtitle">{lesson.subtitle}</p>
        <div className="lesson-meta">
          <span>
            {t.difficulty} {"●".repeat(lesson.difficulty)}
            {"○".repeat(5 - lesson.difficulty)}
          </span>
          <span>{t.hours(lesson.estHours)}</span>
          <span>
            {t.project}
            {lesson.project}
          </span>
        </div>
      </div>

      <article
        className="lesson-body"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(lesson.content, locale) }}
      />

      <div className="lesson-done">
        <DoneButton slug={lesson.slug} locale={locale} />
      </div>

      <nav className="lesson-nav">
        {prev ? (
          <a href={`${prefix}/lessons/${prev.slug}`}>
            ← U{prev.order} {prev.title}
          </a>
        ) : (
          <span />
        )}
        {next ? (
          <a href={`${prefix}/lessons/${next.slug}`}>
            U{next.order} {next.title} →
          </a>
        ) : (
          <span />
        )}
      </nav>
    </main>
  );
}
