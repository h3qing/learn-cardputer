import fs from "node:fs";
import path from "node:path";
import type { Locale } from "./i18n";

export type GlossaryTerm = {
  term: string;
  zh: string;
  en: string;
  q?: string;
  aliases?: string[];
};

const GLOSSARY_FILE = path.join(process.cwd(), "content", "glossary.json");

let cached: GlossaryTerm[] | null = null;

export function loadGlossary(): GlossaryTerm[] {
  if (cached) return cached;
  if (!fs.existsSync(GLOSSARY_FILE)) return [];
  const data = JSON.parse(fs.readFileSync(GLOSSARY_FILE, "utf8"));
  cached = Array.isArray(data.terms) ? data.terms : [];
  return cached!;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Wrap glossary terms in rendered HTML with hover tooltips linking to a Google
 * search. Skips <pre>, <code>, and existing <a> content so code samples and
 * links stay untouched. Pure function of (html, terms, locale) — testable.
 */
export function wrapGlossary(html: string, locale: Locale, terms: GlossaryTerm[] = loadGlossary()): string {
  if (terms.length === 0) return html;

  const entries = terms
    .flatMap((t) => [t.term, ...(t.aliases ?? [])].map((key) => ({ key, t })))
    .sort((a, b) => b.key.length - a.key.length);
  const lookup = new Map(entries.map((e) => [e.key, e.t]));
  const pattern = new RegExp(
    `(?<![\\w-])(${entries.map((e) => escapeRegExp(e.key)).join("|")})(?![\\w-])`,
    "g"
  );

  // Split into [text, skipped-block, text, ...]: odd indices are tags or
  // untouchable blocks, even indices are plain text safe to annotate.
  const tokens = html.split(/(<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>|<a\b[\s\S]*?<\/a>|<[^>]+>)/g);
  return tokens
    .map((tok, i) => {
      if (i % 2 === 1) return tok;
      return tok.replace(pattern, (match) => {
        const entry = lookup.get(match);
        if (!entry) return match;
        const tip = escapeAttr(locale === "zh" ? entry.zh : entry.en);
        const href = `https://www.google.com/search?q=${encodeURIComponent(entry.q ?? entry.term)}`;
        return `<a class="term" data-tip="${tip}" href="${href}" target="_blank" rel="noopener noreferrer">${match}</a>`;
      });
    })
    .join("");
}
