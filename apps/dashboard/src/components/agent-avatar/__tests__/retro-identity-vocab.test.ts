import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// PL-6 retro identity: the pixel-sprite + riso "registration" frame is the
// signature asset. These guards pin the non-portrait pixel/riso vocabulary so a
// later edit cannot silently revert it back to generic chrome. (Component-level
// behavior, crisp integer sprite scaling, is covered by
// printed-portrait-avatar.test.tsx.)
const DASH_SRC = resolve(__dirname, "..", "..", "..");
const pipCss = readFileSync(
  resolve(DASH_SRC, "components/agent-avatar/printed-portrait-avatar.module.css"),
  "utf8",
);
const posterCss = readFileSync(resolve(DASH_SRC, "components/home/team-band.module.css"), "utf8");

describe("retro identity vocabulary (PL-6)", () => {
  it("renders the status pip as a pixel block, not a generic round dot", () => {
    // The pip echoes the 24px sprite grid: a small pixel block (slight radius),
    // never a 50% Material-style dot.
    expect(pipCss).not.toMatch(/\.pip\s*\{[^}]*border-radius:\s*50%/);
    expect(pipCss).toMatch(/\.pip\s*\{[^}]*border-radius:\s*2px/);
  });

  it("frames the team poster with riso registration crop-marks (painted, not an empty element)", () => {
    // The poster anchors the marks and paints an L-tick at all four corners.
    expect(posterCss).toMatch(/\.poster\s*\{[^}]*position:\s*relative/);
    expect(posterCss).toMatch(/\.registration\s*\{/);
    expect(posterCss).toMatch(/--_arm:/);
    expect(posterCss).toMatch(/background-position:[\s\S]*?right bottom/);
  });

  it("marks the poster eyebrow with a pixel registration block", () => {
    // The "Your team" eyebrow gets a small pixel-block tick (a chamfered square,
    // matching the pip) so the print treatment extends to the heading.
    expect(posterCss).toMatch(/\.heading::before\s*\{/);
    expect(posterCss).toMatch(/\.heading::before\s*\{[^}]*border-radius:\s*1px/);
  });
});
