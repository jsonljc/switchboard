import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Guard for audit finding H1 (rehaul slice 2): the mono microlabels and section
// labels must clear WCAG AA on the cream ground. They now read the canonical
// AA-safe ink ramp (--ink-3 = hsl(20 6% 40%), ~5.1:1 on cream) instead of the
// sub-AA alpha ink literal or the off-ramp --tertiary-foreground token.
const css = readFileSync(join(__dirname, "../globals.css"), "utf8");

function ruleBlock(source: string, selectorWithBrace: string): string {
  const start = source.indexOf(selectorWithBrace);
  if (start === -1) throw new Error(`selector not found in globals.css: ${selectorWithBrace}`);
  const end = source.indexOf("}", start);
  return source.slice(start, end);
}

describe("globals.css microlabel contrast (audit H1, slice 2)", () => {
  it("does not reintroduce the sub-AA alpha ink literal (~3.6:1 on cream)", () => {
    expect(css).not.toContain("hsl(20 10% 12% / 0.55)");
  });

  it("drops the off-ramp --tertiary-foreground token (~2.67:1 on cream)", () => {
    expect(css).not.toContain("--tertiary-foreground");
  });

  it.each([".folio {", ".win-folio {", ".stat-label {", ".section-label {"])(
    "%s sets color to the AA-safe --ink-3",
    (selector) => {
      expect(ruleBlock(css, selector)).toContain("color: var(--ink-3);");
    },
  );
});
