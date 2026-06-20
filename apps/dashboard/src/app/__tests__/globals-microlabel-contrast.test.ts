import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Guard for audit finding H1 (rehaul slice 2): the mono microlabels and section
// labels must clear WCAG AA on the cream ground. They read the canonical ink ramp
// (--ink-3 = hsl(var(--palette-ink-500))), and --palette-ink-500 is held dark
// enough that ink-3 clears AA on the live grain+gradient cream (live-sampled,
// since the flat-cream estimate overstated it), instead of the sub-AA alpha ink
// literal or the off-ramp --tertiary-foreground token.
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

  it("keeps --palette-ink-500 (the ink-3 source) dark enough for AA on the grain cream", () => {
    // ink-3 = hsl(var(--palette-ink-500)). On the rendered grain+gradient cream
    // (~0.70 to 0.77 luminance) the lightness must stay <= 37% to clear ~4.5:1.
    const m = css.match(/--palette-ink-500:\s*\d+\s+\d+%\s+(\d+)%/);
    expect(m, "could not find --palette-ink-500 declaration").not.toBeNull();
    expect(Number(m![1])).toBeLessThanOrEqual(37);
  });

  it.each([".folio {", ".win-folio {", ".stat-label {", ".section-label {"])(
    "%s sets color to the AA-safe --ink-3",
    (selector) => {
      expect(ruleBlock(css, selector)).toContain("color: var(--ink-3);");
    },
  );
});
