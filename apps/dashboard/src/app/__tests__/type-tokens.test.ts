import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// vitest runs with cwd = apps/dashboard.
const css = readFileSync(path.resolve(process.cwd(), "src/app/globals.css"), "utf8");

describe("type tokens — tabular metric figures (TY1)", () => {
  it("[data-tabular] applies real tabular-nums (fixes the no-op)", () => {
    const rule = css.match(/\[data-tabular\][^{]*\{[^}]*\}/);
    expect(rule, "no [data-tabular] rule found in globals.css").not.toBeNull();
    expect(rule?.[0] ?? "").toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it(".num is the canonical metric utility (tabular figures)", () => {
    const rule = css.match(/\.num\b[^{]*\{[^}]*\}/);
    expect(rule?.[0] ?? "").toMatch(/font-variant-numeric:\s*tabular-nums/);
  });
});
