import { describe, it, expect } from "vitest";
import { wrapGlossary, type GlossaryTerm } from "./glossary";

const TERMS: GlossaryTerm[] = [
  { term: "SPI", zh: "串行外设接口", en: "Serial Peripheral Interface", q: "SPI bus" },
  { term: "CS", zh: "片选线", en: "Chip Select", q: "SPI chip select signal" },
  { term: "ESP32-S3", zh: "乐鑫双核芯片", en: "Espressif dual-core SoC" },
];

describe("wrapGlossary", () => {
  it("wraps terms with tooltip and Google search link", () => {
    const out = wrapGlossary("<p>SPI 是一种总线</p>", "zh", TERMS);
    expect(out).toContain('class="term"');
    expect(out).toContain('data-tip="串行外设接口"');
    expect(out).toContain("google.com/search?q=SPI%20bus");
    expect(out).toContain('target="_blank"');
  });

  it("uses the locale-matching tooltip", () => {
    const out = wrapGlossary("<p>SPI here</p>", "en", TERMS);
    expect(out).toContain('data-tip="Serial Peripheral Interface"');
  });

  it("never touches code blocks, pre blocks, or existing links", () => {
    const html = '<pre>SPI.begin()</pre><code>SPI</code><a href="/x">SPI docs</a><p>SPI</p>';
    const out = wrapGlossary(html, "zh", TERMS);
    expect(out).toContain("<pre>SPI.begin()</pre>");
    expect(out).toContain("<code>SPI</code>");
    expect(out).toContain('<a href="/x">SPI docs</a>');
    expect(out.match(/class="term"/g)).toHaveLength(1);
  });

  it("matches hyphenated terms and respects word boundaries", () => {
    const out = wrapGlossary("<p>ESP32-S3 与 CSV 不同,CS 是片选</p>", "zh", TERMS);
    expect(out).toContain(">ESP32-S3</a>");
    // "CSV" must not match the shorter term "CS"
    expect(out).not.toContain(">CS</a>V");
    expect(out).toContain(">CS</a>");
  });

  it("returns html unchanged when glossary is empty", () => {
    expect(wrapGlossary("<p>SPI</p>", "zh", [])).toBe("<p>SPI</p>");
  });
});
