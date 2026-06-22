import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Home layout drift-guard (audit H3 + M4). Reads home.module.css and asserts the
 * measure-cap contract that the layout restructure depends on. Mirrors the
 * source-assertion style of token-governance.test.ts: the dashboard ESLint "lint"
 * is stubbed and CI format:check is *.ts-only, so a CSS regression on these caps
 * is otherwise ungated. The home-page render test guards composition order; this
 * file guards the measure caps that keep the bento readable on wide screens.
 */
const homeCss = readFileSync(
  path.resolve(process.cwd(), "src/components/home/home.module.css"),
  "utf8",
);

/** Body of the first matching CSS rule (e.g. ".bento", ".column"). */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = homeCss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  expect(m, `${selector} rule must exist in home.module.css`).not.toBeNull();
  return m![1];
}

describe("home layout governance — bento measure caps (H3 + M4)", () => {
  it("the desktop bento caps the main column at minmax(0, 720px), not 1fr", () => {
    // The bento main holds the decision queue / This Week; capping its measure
    // (640–720 target) keeps line length readable on wide screens.
    expect(homeCss).toMatch(/grid-template-columns:\s*minmax\(0,\s*720px\)/);
    expect(homeCss).not.toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });

  it("the page column is bounded at the lg breakpoint (max-width: 1080px, never none)", () => {
    // origin/main filled the shell frame (max-width: none); audit M4 bounds it so
    // the full-width stack (KpiStrip / Verdict / TeamBand) has a finite measure.
    expect(homeCss).toMatch(/max-width:\s*1080px/);
    expect(homeCss).not.toMatch(/max-width:\s*none/);
  });

  it("the salutation-fold container (.verdictTop) exists", () => {
    // verdict.tsx wraps the eyebrow + salutation into .verdictTop so they share
    // one baseline-aligned row (verdict density).
    expect(ruleBody(".verdictTop")).toMatch(/display:\s*flex/);
  });
});
