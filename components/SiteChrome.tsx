"use client";

import { usePathname } from "next/navigation";
import { localeFromPath, switchLocalePath, STRINGS } from "@/lib/i18n";
import ThemeToggle from "@/components/ThemeToggle";

export function SiteHeader() {
  const pathname = usePathname() ?? "/";
  const locale = localeFromPath(pathname);
  const t = STRINGS[locale];
  const home = locale === "en" ? "/en" : "/";

  return (
    <header className="site-header">
      <a href={home} className="site-mark">
        CARDPUTER<span className="site-mark-dim">://</span>
        {t.brandSuffix}
      </a>
      <nav className="site-nav">
        <a href={`${home}#lessons`}>{t.navLessons}</a>
        <a href={`${home}#about`}>{t.navAbout}</a>
        <a
          href={switchLocalePath(pathname)}
          className="lang-toggle"
          aria-label={locale === "zh" ? "Switch to English" : "切换到中文"}
        >
          {t.langSwitch}
        </a>
        <ThemeToggle />
      </nav>
    </header>
  );
}

export function SiteFooter() {
  const pathname = usePathname() ?? "/";
  const t = STRINGS[localeFromPath(pathname)];

  return (
    <footer className="site-footer">
      <span>{t.footerLeft}</span>
      <span className="site-footer-dim">heqinghuang · 2026</span>
    </footer>
  );
}
