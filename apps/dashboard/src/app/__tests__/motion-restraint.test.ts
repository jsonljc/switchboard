import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Audit M6: cut always-on ambient motion theater. These guard the CSS-level
// changes (the component-level aura-breathe removal is covered by
// operator-character.test.tsx).
const DASH_SRC = resolve(__dirname, "..", "..");
const globals = readFileSync(resolve(DASH_SRC, "app/globals.css"), "utf8");
const inbox = readFileSync(resolve(DASH_SRC, "components/inbox/inbox.css"), "utf8");

describe("motion restraint (audit M6)", () => {
  it("the live-pip pulse-ring fires once on mount, never loops infinitely", () => {
    // a steady dot already reads as live; the ring is a one-time entrance.
    expect(globals).toMatch(/animation:\s*pulse-ring\s+2s\s+ease-out\s*;/);
    expect(globals).not.toMatch(/pulse-ring[^;]*\binfinite\b/);
  });

  it("keeps the aura-breathe keyframe for the login mark (only the Home character drops it)", () => {
    // login/page.tsx still uses .animate-aura-breathe; the keyframe must survive.
    expect(globals).toMatch(/@keyframes\s+aura-breathe/);
  });

  it("disables the inbox armed-pulse under prefers-reduced-motion (mirrors the swipe-card twin)", () => {
    expect(inbox).toMatch(
      /prefers-reduced-motion[\s\S]{0,400}decision-foot-affordance\[data-armed="true"\][\s\S]{0,80}animation:\s*none/,
    );
  });
});
