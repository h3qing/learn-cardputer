import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

export type Lesson = {
  slug: string;
  order: number;
  title: string;
  subtitle: string;
  summary: string;
  difficulty: number;
  estHours: number;
  hardware: string[];
  project: string;
  content: string;
};

export type Course = {
  title: string;
  tagline: string;
  intro: string;
};

const LESSONS_DIR = path.join(process.cwd(), "content", "lessons");
const COURSE_FILE = path.join(process.cwd(), "content", "course.json");

const DEFAULT_COURSE: Course = {
  title: "Cardputer 硬件冒险",
  tagline: "一台掌上电脑,从零学会硬件",
  intro:
    "这是一份边玩边学的开源课程:用一台 M5Stack Cardputer,把显示、键盘、音频、无线这些硬件子系统一个个拆开搞懂,每一课都亲手做出一个好玩的小东西。",
};

/** Parse one lesson markdown source into a Lesson. Pure — easy to test. */
export function parseLesson(raw: string, filename: string): Lesson {
  const { data, content } = matter(raw);
  const fallbackSlug = filename.replace(/\.md$/, "").replace(/^\d+-/, "");
  return {
    slug: String(data.slug ?? fallbackSlug),
    order: Number(data.order ?? 0),
    title: String(data.title ?? fallbackSlug),
    subtitle: String(data.subtitle ?? ""),
    summary: String(data.summary ?? ""),
    difficulty: Number(data.difficulty ?? 1),
    estHours: Number(data.est_hours ?? 1),
    hardware: Array.isArray(data.hardware) ? data.hardware.map(String) : [],
    project: String(data.project ?? ""),
    content,
  };
}

/** 眉标用的短硬件标签:取每个主题冒号前的部分,最多 n 个。 */
export function shortTopics(hardware: string[], n = 3): string {
  return hardware
    .slice(0, n)
    .map((t) => t.split(/[::(]/)[0].trim())
    .join(" / ");
}

export function getAllLessons(): Lesson[] {
  if (!fs.existsSync(LESSONS_DIR)) return [];
  const files = fs.readdirSync(LESSONS_DIR).filter((f) => f.endsWith(".md"));
  return files
    .map((f) => parseLesson(fs.readFileSync(path.join(LESSONS_DIR, f), "utf8"), f))
    .sort((a, b) => a.order - b.order);
}

export function getLessonBySlug(slug: string): Lesson | undefined {
  return getAllLessons().find((l) => l.slug === slug);
}

export function getCourse(): Course {
  if (!fs.existsSync(COURSE_FILE)) return DEFAULT_COURSE;
  const data = JSON.parse(fs.readFileSync(COURSE_FILE, "utf8"));
  return {
    title: String(data.title ?? DEFAULT_COURSE.title),
    tagline: String(data.tagline ?? DEFAULT_COURSE.tagline),
    intro: String(data.intro ?? DEFAULT_COURSE.intro),
  };
}
