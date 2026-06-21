import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { contrastRatio } from "@/lib/tokens/contrast";

// Audit M8: the bright --editorial-accent (orange ~55% L) fails WCAG AA as text
// (2.69:1 on the cream canvas). Scope it to LARGE display numerals + backgrounds
// only; move the small-text editorial highlights onto an AA-passing warm-red ink
// (coral-deep, gate-asserted AA on the same grain canvas via the team band), and
// color the Home greeting's "Alex" word with Alex's own deep coral.
const globals = readFileSync(resolve(__dirname, "..", "globals.css"), "utf8");

function paletteTriple(name: string): string {
  const m = globals.match(new RegExp(`--${name}:\\s*([0-9.]+ [0-9.]+% [0-9.]+%)`));
  if (!m) throw new Error(`palette triple --${name} not found`);
  return m[1];
}

const WHITE_CARD = "0 0% 100%";
const CREAM_CANVAS = "40 25% 94%"; // nominal; real grain canvas is darker (a stricter floor in practice)

describe("editorial accent discipline (audit M8)", () => {
  it("the bright editorial accent fails small-text AA (the reason for this slice)", () => {
    const accent = paletteTriple("palette-editorial-accent");
    expect(contrastRatio(WHITE_CARD, accent)).toBeLessThan(4.5);
    expect(contrastRatio(CREAM_CANVAS, accent)).toBeLessThan(4.5);
    // It fails even the 3:1 large-text bar on cream, so it cannot be ANY text
    // (not even the big display numeral) — only decorative fills.
    expect(contrastRatio(CREAM_CANVAS, accent)).toBeLessThan(3.0);
  });

  it("the warm-red editorial ink (coral-deep) passes AA on both white cards and cream", () => {
    const ink = paletteTriple("palette-coral-deep");
    expect(contrastRatio(WHITE_CARD, ink)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(CREAM_CANVAS, ink)).toBeGreaterThanOrEqual(4.5);
  });

  it("declares one editorial ink token mapped to the brand warm-red", () => {
    expect(globals).toMatch(/--editorial-accent-ink:\s*hsl\(var\(--palette-coral-deep\)\)/);
  });

  it("colors the greeting 'Alex' word with Alex's own deep coral, not the bright accent", () => {
    expect(globals).toMatch(/\.greeting-prose \.accent\s*\{[^}]*color:\s*var\(--agent-alex-deep\)/);
    expect(globals).not.toMatch(/\.greeting-prose \.accent\s*\{[^}]*var\(--editorial-accent\)/);
  });

  it("moves the small-text editorial highlights onto the AA ink", () => {
    expect(globals).toMatch(/\.win-prose \.accent\s*\{[^}]*color:\s*var\(--editorial-accent-ink\)/);
    expect(globals).toMatch(
      /\.tile\[data-stage="hot"\] \.tile-stage\s*\{[^}]*color:\s*var\(--editorial-accent-ink\)/,
    );
  });

  it("uses the AA ink for the large display numeral accent too", () => {
    expect(globals).toMatch(/\.hero-num \.accent\s*\{[^}]*color:\s*var\(--editorial-accent-ink\)/);
  });

  it("never uses the bright editorial accent as a text color (decorative fills only)", () => {
    // every remaining var(--editorial-accent) must be a background/fill, never `color:`
    expect(globals).not.toMatch(/color:\s*var\(--editorial-accent\)\s*;/);
  });
});
