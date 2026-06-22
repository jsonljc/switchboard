import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Home layout drift-guard (audit M4 verdict density). Reads home.module.css and
 * asserts the salutation-fold contract. Mirrors the source-assertion style of
 * token-governance.test.ts: the dashboard ESLint "lint" is stubbed and CI
 * format:check is *.ts-only, so a CSS regression here is otherwise ungated.
 *
 * NOTE: the bento is intentionally NOT measure-capped. The app shell already
 * bounds the Home content cell (.app-body max-width --app-frame 1280, minus the
 * 216px nav rail + insets), so a column/main max-width cap never bites; capping
 * was dropped after review confirmed it was inert. The home-page render test
 * guards composition order (TeamBand promoted to a full-width band); this file
 * guards the verdict-density salutation fold.
 */
const homeCss = readFileSync(
  path.resolve(process.cwd(), "src/components/home/home.module.css"),
  "utf8",
);

/** Body of the first matching CSS rule (e.g. ".verdictTop"). */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = homeCss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  expect(m, `${selector} rule must exist in home.module.css`).not.toBeNull();
  return m![1];
}

describe("home layout governance: verdict salutation fold", () => {
  it("folds the salutation into the eyebrow row via a baseline-flex .verdictTop", () => {
    // verdict.tsx wraps the eyebrow + salutation in .verdictTop so they share one
    // baseline-aligned row (audit M4 density), tightening the verdict hero.
    const body = ruleBody(".verdictTop");
    expect(body).toMatch(/display:\s*flex/);
    expect(body).toMatch(/align-items:\s*baseline/);
  });

  it("suppresses the eyebrow trailing rule inside the folded row", () => {
    // The eyebrow's decorative ::after hairline would collapse to a sliver between
    // the eyebrow and the salutation when folded; it is dropped in .verdictTop.
    expect(homeCss).toMatch(/\.verdictTop\s+\.eyebrow::after\s*\{\s*display:\s*none/);
  });
});
