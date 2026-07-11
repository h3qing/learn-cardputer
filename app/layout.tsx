import type { Metadata } from "next";
import { getCourse } from "@/lib/lessons";
import ThemeToggle from "@/components/ThemeToggle";
import "./globals.css";

/* 与 heqing-blog 相同的约定:localStorage.theme(system/light/dark),paint 前设置
   data-theme,避免主题闪烁。 */
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("theme")||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light";}catch(e){document.documentElement.dataset.theme="light";}})();`;

export function generateMetadata(): Metadata {
  const course = getCourse();
  return {
    title: { default: course.title, template: `%s · ${course.title}` },
    description: course.tagline,
    metadataBase: new URL("https://cardputer.heqinghuang.com"),
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <header className="site-header">
          <a href="/" className="site-mark">
            CARDPUTER<span className="site-mark-dim">://</span>硬件冒险
          </a>
          <nav className="site-nav">
            <a href="/#lessons">课程</a>
            <a href="/#about">关于</a>
            <ThemeToggle />
          </nav>
        </header>
        {children}
        <footer className="site-footer">
          <span>用一台 Cardputer 学硬件 · 开源课程 · MIT License</span>
          <span className="site-footer-dim">heqinghuang · 2026</span>
        </footer>
      </body>
    </html>
  );
}
