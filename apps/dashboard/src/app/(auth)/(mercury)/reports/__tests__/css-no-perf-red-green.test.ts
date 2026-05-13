import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Per spec §9 (anti-patterns) and plan revision R4: performance signals must not
// use red/green colors. Status indicators (live-pip green dot) ARE allowed because
// they convey state, not performance — we cap green-ish hsl declarations at 2.
describe("reports.module.css forbids red/green for performance signaling", () => {
  it("uses no performance-red or performance-green color tokens", async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const cssPath = resolve(here, "../reports.module.css");
    const css = await readFile(cssPath, "utf-8");

    expect(css).not.toMatch(/:\s*red\b/i);
    expect(css).not.toMatch(/#(f|F){2}0+\b/); // #f00 / #ff0000
    expect(css).not.toMatch(/#0+(f|F){2}0+\b/); // #0f0 / #00ff00

    // Green-ish hsl restricted to status indicators (live-pip & colophon mode-live dot).
    const greenHsl = css.match(/hsl\(\s*1[34][0-9]\s+\d+%\s+\d+%/g) ?? [];
    expect(greenHsl.length).toBeLessThanOrEqual(2);
  });
});
