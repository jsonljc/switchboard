import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { css, collectGovernedFiles, rel, typeVoiceGoverned } from "./token-governance.lib";

// ─────────────────────────────────────────────────────────────────────────────
// TY5: authed type collapse (2026-06-22). The authed app speaks ONE serif
// (Fraunces, via --serif repointed to the display token), ONE body (Geist), and
// ONE mono (JetBrains). Source Serif 4 survives ONLY under the retiring Mercury
// register; Space Mono is dropped entirely. DM Sans (--font-display) stays the
// legacy pre-auth/onboarding/landing display face (governed by TY3) and is NOT
// migrated here. Source-assertion guards because the dashboard ESLint "lint" is
// stubbed and CI format:check is *.ts-only, so CSS/layout drift is otherwise
// ungated (same rationale as token-governance.test.ts).
// ─────────────────────────────────────────────────────────────────────────────

const layout = readFileSync(path.resolve(process.cwd(), "src/app/layout.tsx"), "utf8");
const kpiStrip = readFileSync(
  path.resolve(process.cwd(), "src/components/home/home-kpi-strip.module.css"),
  "utf8",
);

describe("type collapse: one authed serif (TY5)", () => {
  it("the authed register repoints --serif to the Fraunces display token", () => {
    // Same selector that scopes the Geist body face (TY4): the marker excludes
    // Mercury + pre-auth, so they keep the :root Source Serif default below.
    expect(css).toMatch(
      /body:has\(\.app-header\):not\(:has\(\[data-register="mercury"\]\)\)\s*\{[^}]*--serif:\s*var\(--font-display-app\)/,
    );
  });

  it("the :root --serif default stays Source Serif (kept for Mercury + pre-auth)", () => {
    // The repoint is register-scoped, not a global redefinition: Mercury inherits
    // this default and reports.module.css further aliases it to --font-serif-mercury.
    const root = css.slice(0, css.indexOf("body:has"));
    expect(root).toMatch(/--serif:\s*var\(--font-serif\),\s*"Source Serif 4"/);
  });

  it("the Home KPI strip rides the serif + mono tokens, not raw next/font vars", () => {
    // .figure on raw --font-serif (Source Serif) would leave Home with two serifs
    // after the repoint; .eyebrow on raw --font-mono (Space Mono) blocks the drop.
    expect(kpiStrip).not.toMatch(/font-family:\s*var\(--font-serif\)/);
    expect(kpiStrip).not.toMatch(/font-family:\s*var\(--font-mono\)/);
    expect(kpiStrip).toMatch(/font-family:\s*var\(--serif\)/);
    expect(kpiStrip).toMatch(/font-family:\s*var\(--mono\)/);
  });
});

describe("type collapse: Space Mono dropped (TY5)", () => {
  it("layout.tsx no longer loads Space Mono", () => {
    expect(layout).not.toMatch(/Space_Mono/);
    expect(layout).not.toMatch(/spaceMono/);
  });

  it("no --font-mono binding survives in the loader (the dropped Space Mono var)", () => {
    // "--font-mono-editorial" (JetBrains) is a different string and stays.
    expect(layout).not.toMatch(/"--font-mono"/);
  });

  it("no governed authed CSS consumes the dropped --font-mono (Space Mono)", () => {
    // typeVoiceGoverned exempts (mercury)/ + landing; the Mercury activity surface
    // is repointed separately to --font-mono-mercury. The authed register must
    // hold zero bare var(--font-mono) after the drop.
    const offenders = collectGovernedFiles()
      .filter((f) => typeVoiceGoverned(f.path))
      .filter((f) => f.path.endsWith(".css"))
      .filter((f) => /var\(--font-mono(?![-\w])/.test(f.content))
      .map((f) => rel(f.path));
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("the Tailwind font-mono utility rides a surviving face, not the dropped --font-mono", () => {
    // tailwind.config.ts lives at the package root (outside collectGovernedFiles'
    // walked roots) and `font-mono` is a className, not a CSS-var string, so the
    // governed-CSS sweep above cannot see this consumer. Dropping Space Mono
    // orphaned --font-mono; the utility must ride the editorial mono token (which
    // carries its own monospace fallback) or every font-mono element (error
    // digests, IDs, phone numbers) inherits the proportional body face.
    const tw = readFileSync(path.resolve(process.cwd(), "tailwind.config.ts"), "utf8");
    const monoDecl = tw.match(/mono:\s*\[([^\]]*)\]/);
    expect(monoDecl, "fontFamily.mono must be defined in tailwind.config.ts").not.toBeNull();
    expect(monoDecl![1]).not.toMatch(/var\(--font-mono(?![-\w])/);
    expect(monoDecl![1]).toMatch(/var\(--mono\)|var\(--font-mono-editorial\)/);
  });

  it("the Mercury activity surface keeps a real mono (repointed, no dangling var)", () => {
    const activity = readFileSync(
      path.resolve(process.cwd(), "src/app/(auth)/(mercury)/activity/activity.module.css"),
      "utf8",
    );
    expect(activity).not.toMatch(/var\(--font-mono,/); // the old bare Space Mono form
    expect(activity).toMatch(/var\(--font-mono-mercury/);
  });
});
