export type Locale = "zh" | "en";

export function localeFromPath(pathname: string): Locale {
  return pathname === "/en" || pathname.startsWith("/en/") ? "en" : "zh";
}

/** /lessons/x ↔ /en/lessons/x */
export function switchLocalePath(pathname: string): string {
  if (localeFromPath(pathname) === "en") {
    return pathname.replace(/^\/en/, "") || "/";
  }
  return pathname === "/" ? "/en" : `/en${pathname}`;
}

export const STRINGS = {
  zh: {
    brandSuffix: "硬件冒险",
    navLessons: "课程",
    navAbout: "关于",
    langSwitch: "EN",
    eyebrow: "开源硬件学习计划 · OPEN SOURCE",
    startBtn: "从第 1 课开始",
    resumeBtn: (n: number) => `继续:第 ${n} 课 →`,
    browseBtn: "浏览全部课程",
    busTitle: "课程总线",
    busNote: (n: number) =>
      `${n} 课挂在同一条总线上,按顺序点亮它们。每课深挖一个硬件子系统,做出一个能拿去炫耀的小东西。`,
    aboutTitle: "这个计划是怎么运作的",
    aboutCards: [
      {
        title: "课程给原理,代码自己写",
        text: "每课讲透一个硬件机制,给最小示例和分步提示,但挑战任务没有标准答案——固件由我自己动手实现,放在仓库的 firmware/ 目录里,和课程一起开源。",
      },
      {
        title: "你也可以跟着学",
        text: "准备一台 Cardputer(约 $30)、一根 USB-C 线和一台电脑就能开始。所有课程内容自由取用,发现错误欢迎提 issue。",
      },
      {
        title: "为什么是 Cardputer",
        text: "它把显示、键盘、音频、无线、红外、存储塞进一张卡片,每个子系统恰好对应一种经典总线——SPI、GPIO、I2S、I2C。一台设备,就是一门完整的硬件入门课。",
      },
    ],
    footerLeft: "用一台 Cardputer 学硬件 · 开源课程 · MIT License",
    crumb: "← 课程总线",
    difficulty: "难度",
    hours: (h: number) => `约 ${h} 小时`,
    project: "作品:",
    doneBtn: "标记为已完成",
    undoneBtn: "✓ 已完成,点击撤销",
    bootLine: "> 开始第 1 课",
    lessonMetaTitle: (order: number, title: string) => `第 ${order} 课 · ${title}`,
  },
  en: {
    brandSuffix: "HARDWARE ADVENTURE",
    navLessons: "Lessons",
    navAbout: "About",
    langSwitch: "中文",
    eyebrow: "OPEN-SOURCE HARDWARE COURSE",
    startBtn: "Start with Lesson 1",
    resumeBtn: (n: number) => `Resume Lesson ${n} →`,
    browseBtn: "Browse all lessons",
    busTitle: "The Course Bus",
    busNote: (n: number) =>
      `${n} lessons hang off one bus — light them up in order. Each one digs into a single hardware subsystem and ends with something worth showing off.`,
    aboutTitle: "How this project works",
    aboutCards: [
      {
        title: "Lessons teach theory, you write the code",
        text: "Each lesson explains one hardware mechanism with minimal examples and step-by-step hints, but challenges have no answer key — I implement the firmware myself in firmware/, open-sourced alongside the course.",
      },
      {
        title: "Follow along",
        text: "All you need is a Cardputer (~$30), a USB-C cable, and a computer. All content is free to use — issues welcome if you spot mistakes.",
      },
      {
        title: "Why the Cardputer",
        text: "It packs a display, keyboard, audio, radio, IR, and storage into one card, and each subsystem maps to a classic bus — SPI, GPIO, I2S, I2C. One device is a complete intro course to hardware.",
      },
    ],
    footerLeft: "Learn hardware with a Cardputer · Open-source course · MIT License",
    crumb: "← All lessons",
    difficulty: "Difficulty",
    hours: (h: number) => `~${h} h`,
    project: "Project: ",
    doneBtn: "Mark as done",
    undoneBtn: "✓ Done — click to undo",
    bootLine: "> START LESSON 1",
    lessonMetaTitle: (order: number, title: string) => `Lesson ${order} · ${title}`,
  },
} as const;
