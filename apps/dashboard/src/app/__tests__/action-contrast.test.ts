import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contrastRatio } from "@/lib/tokens/contrast";

// Guard for audit finding L4 (rehaul PL-12): the primary action button is white
// text on the amber --action, which computes ~4.52:1 — only just over WCAG AA.
// Pin the shipped token so a future tweak cannot quietly tip it under 4.5:1.
const css = readFileSync(join(__dirname, "../globals.css"), "utf8");

/** First (light :root) value of an HSL-triple palette token in globals.css. */
function firstTriple(name: string): string {
  const m = css.match(new RegExp(`--${name}:\\s*(\\d+\\s+\\d+%\\s+\\d+%)`));
  if (!m) throw new Error(`could not find --${name} in globals.css`);
  return m[1];
}

describe("globals.css action-button contrast (audit L4, PL-12)", () => {
  it("white text on --action clears WCAG AA (>= 4.5:1)", () => {
    const ratio = contrastRatio(firstTriple("palette-action-fg"), firstTriple("palette-action"));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("pins --palette-action lightness so a future lightening cannot drop it under AA", () => {
    const m = css.match(/--palette-action:\s*\d+\s+\d+%\s+(\d+)%/);
    expect(m, "could not find --palette-action").not.toBeNull();
    expect(Number(m![1])).toBeLessThanOrEqual(41);
  });
});
