import type { Metadata } from "next";
import { getCourse } from "@/lib/lessons";
import { SiteHeader, SiteFooter } from "@/components/SiteChrome";
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
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
