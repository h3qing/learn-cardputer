import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAllLessons, getLessonBySlug, shortTopics } from "@/lib/lessons";
import { renderMarkdown } from "@/lib/markdown";
import { DoneButton } from "@/components/Progress";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return getAllLessons().map((l) => ({ slug: l.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const lesson = getLessonBySlug(slug);
  return { title: lesson ? `第 ${lesson.order} 课 · ${lesson.title}` : "课程" };
}

export default async function LessonPage({ params }: Props) {
  const { slug } = await params;
  const lesson = getLessonBySlug(slug);
  if (!lesson) notFound();

  const lessons = getAllLessons();
  const idx = lessons.findIndex((l) => l.slug === lesson.slug);
  const prev = idx > 0 ? lessons[idx - 1] : undefined;
  const next = idx < lessons.length - 1 ? lessons[idx + 1] : undefined;

  return (
    <main className="lesson-page">
      <div className="lesson-header">
        <a href="/#lessons" className="crumb">
          ← 课程总线
        </a>
        <p className="lesson-ref">
          U{lesson.order} · {shortTopics(lesson.hardware)}
        </p>
        <h1>{lesson.title}</h1>
        <p className="lesson-subtitle">{lesson.subtitle}</p>
        <div className="lesson-meta">
          <span>难度 {"●".repeat(lesson.difficulty)}{"○".repeat(5 - lesson.difficulty)}</span>
          <span>约 {lesson.estHours} 小时</span>
          <span>作品:{lesson.project}</span>
        </div>
      </div>

      <article
        className="lesson-body"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(lesson.content) }}
      />

      <div className="lesson-done">
        <DoneButton slug={lesson.slug} />
      </div>

      <nav className="lesson-nav">
        {prev ? (
          <a href={`/lessons/${prev.slug}`}>
            ← U{prev.order} {prev.title}
          </a>
        ) : (
          <span />
        )}
        {next ? (
          <a href={`/lessons/${next.slug}`}>
            U{next.order} {next.title} →
          </a>
        ) : (
          <span />
        )}
      </nav>
    </main>
  );
}
