/** 学习进度的本地存储约定:已完成课程集合 + 最后访问的课。 */

export const DONE_KEY = "cardputer-done";
export const LAST_KEY = "cardputer-last";

export type LessonRef = { slug: string; order: number; title: string };

export function readDone(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DONE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function readLast(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

export function markLast(slug: string): void {
  try {
    localStorage.setItem(LAST_KEY, slug);
  } catch {
    /* private mode etc. — progress is best-effort */
  }
}

/**
 * Pick the lesson the "continue" button should target: the last-visited lesson
 * if it still exists, otherwise the first lesson. Pure — unit tested.
 */
export function pickResume(lessons: LessonRef[], lastSlug: string | null): LessonRef | undefined {
  if (lessons.length === 0) return undefined;
  return lessons.find((l) => l.slug === lastSlug) ?? lessons[0];
}
