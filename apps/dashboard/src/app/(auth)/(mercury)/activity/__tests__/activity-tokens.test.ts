import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// /activity (Mercury Tools tier) must source --ink-3 from the canonical neutral
// ink-ramp primitive (--palette-ink-500, the AA-tuned 36% L), not a forked bare
// hex. globals.css forbids the Mercury tier from consuming the editorial --ink-*
// *semantic* aliases, so we reference the shared *primitive* directly.
const css = readFileSync(
  path.resolve(process.cwd(), "src/app/(auth)/(mercury)/activity/activity.module.css"),
  "utf8",
);
const decl = css.match(/\.activityPage\b[\s\S]*?--ink-3:\s*([^;]+);/);

describe("/activity ink-3 — canonical ramp primitive, no bare hex", () => {
  it("declares --ink-3 in the .activityPage scope", () => {
    expect(decl, "--ink-3 must be declared on .activityPage").not.toBeNull();
  });

  it("references the --palette-ink-500 primitive, not a bare hex", () => {
    const value = decl![1].trim();
    expect(value).toBe("hsl(var(--palette-ink-500))");
    expect(value, "no bare hex").not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
