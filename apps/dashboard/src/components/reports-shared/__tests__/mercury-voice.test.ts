import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * CSS integrity guard for mercury-voice.module.css (Task A).
 * Asserts that the shared Mercury register foundation defines:
 *   - the .mercuryVoice scope token block (--serif, --mono, --paper)
 *   - the voice classes: .eyebrow, .section, .sectionHead, .pageTitle
 * RED until the file is created; GREEN after Task A.
 */

const CSS_PATH = path.resolve(
  process.cwd(),
  "src/components/reports-shared/mercury-voice.module.css",
);

describe("mercury-voice.module.css — CSS integrity", () => {
  let css: string;

  it("the file exists (RED until Task A creates it)", () => {
    css = readFileSync(CSS_PATH, "utf8");
    expect(css.length).toBeGreaterThan(0);
  });

  it(".mercuryVoice scope block exists", () => {
    css = css ?? readFileSync(CSS_PATH, "utf8");
    expect(css).toMatch(/\.mercuryVoice\s*\{/);
  });

  it(".mercuryVoice defines --serif token", () => {
    css = css ?? readFileSync(CSS_PATH, "utf8");
    expect(css).toMatch(/--serif\s*:/);
  });

  it(".mercuryVoice defines --mono token", () => {
    css = css ?? readFileSync(CSS_PATH, "utf8");
    expect(css).toMatch(/--mono\s*:/);
  });

  it(".mercuryVoice defines --paper token", () => {
    css = css ?? readFileSync(CSS_PATH, "utf8");
    expect(css).toMatch(/--paper\s*:/);
  });

  it(".eyebrow class exists", () => {
    css = css ?? readFileSync(CSS_PATH, "utf8");
    expect(css).toMatch(/\.eyebrow\s*\{/);
  });

  it(".section class exists", () => {
    css = css ?? readFileSync(CSS_PATH, "utf8");
    expect(css).toMatch(/\.section\s*\{/);
  });

  it(".sectionHead class exists", () => {
    css = css ?? readFileSync(CSS_PATH, "utf8");
    expect(css).toMatch(/\.sectionHead\s*\{/);
  });

  it(".pageTitle class exists", () => {
    css = css ?? readFileSync(CSS_PATH, "utf8");
    expect(css).toMatch(/\.pageTitle\s*\{/);
  });
});
