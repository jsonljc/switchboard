import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Guard for audit finding L2 (rehaul PL-12): the fixed mobile bottom-nav must be
// cleared from the scroll container (.app-main), gated to mobile + the safe-area
// inset — not via .section:last-of-type, a class the Home modules never use (so
// Home content sat under the bar). The desktop nav is an inline strip, no
// clearance needed there.
const css = readFileSync(join(__dirname, "../globals.css"), "utf8");

describe("globals.css mobile-nav clearance (audit L2, PL-12)", () => {
  it("clears the fixed mobile nav from the scroll container, gated to mobile + safe-area", () => {
    expect(css).toMatch(
      /@media\s*\(max-width:\s*767px\)\s*\{[\s\S]{0,200}\.app-main\s*\{[\s\S]{0,160}padding-bottom:\s*calc\(\s*\d+px\s*\+\s*env\(\s*safe-area-inset-bottom/,
    );
  });

  it("no longer keys nav clearance to .section:last-of-type", () => {
    expect(css).not.toMatch(/\.section:last-of-type\s*\{[\s\S]{0,80}padding-bottom:\s*160px/);
  });
});
