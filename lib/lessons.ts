import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { Locale } from "./i18n";

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

const CONTENT_DIR = path.join(process.cwd(), "content");

const DEFAULT_COURSE: Record<Locale, Course> = {
  zh: {
    title: "Cardputer 硬件冒险",
    tagline: "一台掌上电脑,从零学会硬件",
    intro:
      "这是一份边玩边学的开源课程:用一台 M5Stack Cardputer,把显示、键盘、音频、无线这些硬件子系统一个个拆开搞懂,每一课都亲手做出一个好玩的小东西。",
  },
  en: {
    title: "Cardputer Hardware Adventure",
    tagline: "One palm-sized computer, hardware from zero",
    intro:
      "An open-source, learn-by-building course: take one M5Stack Cardputer and pull apart its display, keyboard, audio, and radio subsystems one by one — building something fun in every lesson.",
  },
};

function lessonsDir(locale: Locale): string {
  return locale === "en"
    ? path.join(CONTENT_DIR, "lessons", "en")
    : path.join(CONTENT_DIR, "lessons");
}

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

/** 眉标用的短硬件标签:取每个主题冒号/破折号前的部分,最多 n 个。 */
export function shortTopics(hardware: string[], n = 3): string {
  const tags = hardware.slice(0, n).map((t) => t.split(/[::(（]|\s[—–-]\s/)[0].trim());
  // 英文标签偏长,超出就少放一个,保持眉标一行内
  while (tags.length > 1 && tags.join(" / ").length > 72) tags.pop();
  return tags.join(" / ");
}

export function getAllLessons(locale: Locale = "zh"): Lesson[] {
  const dir = lessonsDir(locale);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  return files
    .map((f) => parseLesson(fs.readFileSync(path.join(dir, f), "utf8"), f))
    .sort((a, b) => a.order - b.order);
}

export function getLessonBySlug(slug: string, locale: Locale = "zh"): Lesson | undefined {
  return getAllLessons(locale).find((l) => l.slug === slug);
}

export function getCourse(locale: Locale = "zh"): Course {
  const file = path.join(CONTENT_DIR, locale === "en" ? "course.en.json" : "course.json");
  if (!fs.existsSync(file)) return DEFAULT_COURSE[locale];
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    title: String(data.title ?? DEFAULT_COURSE[locale].title),
    tagline: String(data.tagline ?? DEFAULT_COURSE[locale].tagline),
    intro: String(data.intro ?? DEFAULT_COURSE[locale].intro),
  };
}
