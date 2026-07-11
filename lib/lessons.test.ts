import { describe, it, expect } from "vitest";
import { getAllLessons, parseLesson } from "./lessons";

const SAMPLE = `---
title: 认识你的机器
subtitle: 拆解 Cardputer 的五脏六腑
order: 1
slug: anatomy
difficulty: 1
est_hours: 1.5
hardware:
  - ESP32-S3
  - SPI
project: 画出自己的硬件框图
summary: 了解 Cardputer 上每一块芯片的分工。
---

## 本课目标

正文内容。
`;

describe("parseLesson", () => {
  it("parses frontmatter fields", () => {
    const lesson = parseLesson(SAMPLE, "01-anatomy.md");
    expect(lesson.title).toBe("认识你的机器");
    expect(lesson.order).toBe(1);
    expect(lesson.slug).toBe("anatomy");
    expect(lesson.difficulty).toBe(1);
    expect(lesson.estHours).toBe(1.5);
    expect(lesson.hardware).toEqual(["ESP32-S3", "SPI"]);
    expect(lesson.content).toContain("## 本课目标");
  });

  it("falls back to filename slug and defaults when frontmatter is sparse", () => {
    const lesson = parseLesson("---\ntitle: X\n---\nbody", "03-wifi-scanner.md");
    expect(lesson.slug).toBe("wifi-scanner");
    expect(lesson.order).toBe(0);
    expect(lesson.hardware).toEqual([]);
  });
});

describe("content/lessons integrity", () => {
  const lessons = getAllLessons("zh");

  it("has lessons", () => {
    expect(lessons.length).toBeGreaterThan(0);
  });

  it("every lesson has complete frontmatter", () => {
    for (const l of lessons) {
      expect(l.title, l.slug).not.toBe("");
      expect(l.subtitle, l.slug).not.toBe("");
      expect(l.summary, l.slug).not.toBe("");
      expect(l.project, l.slug).not.toBe("");
      expect(l.hardware.length, l.slug).toBeGreaterThan(0);
      expect(l.difficulty, l.slug).toBeGreaterThanOrEqual(1);
      expect(l.difficulty, l.slug).toBeLessThanOrEqual(5);
      expect(l.estHours, l.slug).toBeGreaterThan(0);
    }
  });

  it("orders are consecutive from 1 and slugs unique", () => {
    expect(lessons.map((l) => l.order)).toEqual(lessons.map((_, i) => i + 1));
    expect(new Set(lessons.map((l) => l.slug)).size).toBe(lessons.length);
  });

  it("every lesson has the required sections", () => {
    for (const l of lessons) {
      for (const section of ["## 本课目标", "## 硬件原理", "## 动手实验", "## 挑战任务", "## 检查点"]) {
        expect(l.content, `${l.slug} 缺少 ${section}`).toContain(section);
      }
    }
  });
});

describe("english translations parity", () => {
  const zh = getAllLessons("zh");
  const en = getAllLessons("en");

  // Translations are generated in a separate step; enforce parity only once
  // any English lesson exists, so the suite stays green mid-generation.
  it.skipIf(en.length === 0)("every zh lesson has an en counterpart with matching slug/order", () => {
    expect(en.map((l) => l.slug).sort()).toEqual(zh.map((l) => l.slug).sort());
    for (const l of en) {
      const source = zh.find((z) => z.slug === l.slug)!;
      expect(l.order, l.slug).toBe(source.order);
      expect(l.difficulty, l.slug).toBe(source.difficulty);
      expect(l.estHours, l.slug).toBe(source.estHours);
    }
  });

  it.skipIf(en.length === 0)("en lessons use the canonical section headings", () => {
    for (const l of en) {
      for (const section of ["## Goals", "## How the Hardware Works", "## Hands-on Lab", "## Challenge", "## Checkpoint"]) {
        expect(l.content, `${l.slug} missing ${section}`).toContain(section);
      }
    }
  });

  it.skipIf(en.length === 0)("en lessons contain no leftover Chinese characters", () => {
    for (const l of en) {
      const cjk = (l.title + l.subtitle + l.summary + l.project + l.content).match(/[一-鿿]+/g);
      expect(cjk, `${l.slug}: ${cjk?.slice(0, 5).join(" ")}`).toBeNull();
    }
  });
});
