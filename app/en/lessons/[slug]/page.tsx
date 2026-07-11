import type { Metadata } from "next";
import { getAllLessons, getLessonBySlug } from "@/lib/lessons";
import { STRINGS } from "@/lib/i18n";
import LessonView from "@/components/LessonView";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return getAllLessons("en").map((l) => ({ slug: l.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const lesson = getLessonBySlug(slug, "en");
  return { title: lesson ? STRINGS.en.lessonMetaTitle(lesson.order, lesson.title) : "Lesson" };
}

export default async function EnglishLessonPage({ params }: Props) {
  const { slug } = await params;
  return <LessonView locale="en" slug={slug} />;
}
