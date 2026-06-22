import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// vitest runs with css: false, so we assert the CSS as source text.
// The shared funnel is a stacked list on mobile; on desktop (>=1024px, matching
// the original /results breakpoint) it must become a two-column grid. The #1237
// dedup dropped this rule, leaving the funnel single-column on desktop.
describe("shared funnel responsive grid", () => {
  it("upgrades .funnelRows to a 2-column grid at >=1024px", async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const css = await readFile(resolve(here, "../funnel.module.css"), "utf-8");

    // The desktop breakpoint exists.
    expect(css).toMatch(/@media\s*\(min-width:\s*1024px\)/);

    // Within the SAME media block, .funnelRows becomes a 2-column grid.
    // `\s*` after the media `{` and `[^}]*` inside the .funnelRows body keep the
    // match scoped to one block, so an un-nested rule elsewhere cannot satisfy it.
    expect(css).toMatch(
      /@media\s*\(min-width:\s*1024px\)\s*\{\s*\.funnelRows\s*\{[^}]*grid-template-columns:\s*1fr\s+1fr/,
    );
  });
});
