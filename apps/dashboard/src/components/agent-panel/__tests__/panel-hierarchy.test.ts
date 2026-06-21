import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// PL-9 (audit M7): the agent panel reads "broken-empty" because the hero stat,
// the decision list, and the work log all share the same elevated white-card
// treatment, so nothing reads as the headline. These guards pin the hierarchy:
// the hero stays the one elevated "stat zone"; the activity cards flatten to a
// denser supporting group. Visual outcome is verified by before/after screenshots.
const css = readFileSync(resolve(__dirname, "..", "agent-panel.module.css"), "utf8");

function block(selector: string): string {
  // crude single-rule slice: from the selector's opening brace to the next "}"
  const re = new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`);
  const m = css.match(re);
  return m ? m[1] : "";
}

describe("agent panel hero-stat hierarchy (PL-9)", () => {
  it("keeps the hero card elevated as the defined stat zone", () => {
    expect(block("heroCard")).toMatch(/box-shadow:\s*var\(--shadow-card\)/);
  });

  it("flattens the activity cards so the hero reads as the headline", () => {
    expect(block("decisionList")).not.toMatch(/box-shadow:\s*var\(--shadow-card\)/);
    expect(block("apLog")).not.toMatch(/box-shadow:\s*var\(--shadow-card\)/);
  });

  it("keeps a hairline on the flattened activity cards (defined, not floating)", () => {
    expect(block("decisionList")).toMatch(/border:\s*1px solid var\(--hair-soft\)/);
    expect(block("apLog")).toMatch(/border:\s*1px solid var\(--hair-soft\)/);
  });

  it("gives the hero a stat-zone header rule so the figure never floats alone", () => {
    expect(block("heroEyebrow")).toMatch(/border-bottom:\s*1px solid var\(--hair-soft\)/);
  });
});
