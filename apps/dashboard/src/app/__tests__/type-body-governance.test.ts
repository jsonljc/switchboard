import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { css, collectGovernedFiles, rel, typeVoiceGoverned } from "./token-governance.lib";

// ─────────────────────────────────────────────────────────────────────────────
// TY4: the authed body face (spec 2026-06-05). Geist loaded as a variable font,
// the register rule on body (portal coverage), the producer pairings for BOTH
// hooks (.app-header and the mercury marker), and one body sans (the previous
// Home grotesk retired). Split from token-governance.test.ts at the eslint
// max-lines cap; shared mechanics live in token-governance.lib.ts.
// ─────────────────────────────────────────────────────────────────────────────
describe("token governance: type body (TY4)", () => {
  const governed = collectGovernedFiles().filter((f) => typeVoiceGoverned(f.path));

  it("layout.tsx loads Geist as a variable font (no weight array: the 450 cut must be real)", () => {
    const layout = readFileSync(path.resolve(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(layout).toMatch(/Geist\(/);
    const geistBlock = layout.slice(layout.indexOf("Geist("));
    const block = geistBlock.slice(0, geistBlock.indexOf("})"));
    expect(block).toMatch(/variable:\s*"--font-geist"/);
    expect(block).not.toMatch(/weight:/);
  });

  it("the body face chains to the loaded Geist primitive (token honesty)", () => {
    expect(css).toMatch(/--font-body-app:\s*var\(--font-geist\)/);
    expect(css).toMatch(/--font-home-sans:\s*var\(--font-body-app\)/);
  });

  it("the register rule carries the mercury exclusion in the same selector", () => {
    expect(css).toMatch(
      /body:has\(\.app-header\):not\(:has\(\[data-register="mercury"\]\)\)\s*\{[^}]*font-family:\s*var\(--font-body-app\)/,
    );
  });

  it("the mercury marker producer exists (the exclusion is inert without it)", () => {
    const mercuryLayout = readFileSync(
      path.resolve(process.cwd(), "src/app/(auth)/(mercury)/layout.tsx"),
      "utf8",
    );
    expect(mercuryLayout).toMatch(/data-register="mercury"/);
  });

  it("the register hook producer exists (.app-header is load-bearing architecture now)", () => {
    // The body-face rule hangs on the .app-header class. A shell refactor that
    // renames it would leave the rule inert while a globals-only guard stays
    // green. Pair the consumer (the rule) with both producers: the shell and
    // its error-boundary fallback.
    for (const p of [
      "src/components/layout/editorial-auth-shell.tsx",
      "src/components/layout/editorial-shell-boundary.tsx",
    ]) {
      const src = readFileSync(path.resolve(process.cwd(), p), "utf8");
      expect(src, p).toMatch(/className="app-header"/);
    }
  });

  it("no governed module CSS pins var(--font-sans) against the register (inheritance or the token)", () => {
    // The register face arrives by inheritance from body. A module-CSS pin of
    // the legacy --font-sans re-Inters that element inside the register: the
    // gap the live census caught on the decision-card pills. globals.css is
    // the definition site (the body baseline + legacy editorial classes with
    // no live app renderers) and stays exempt; Mercury and landing are
    // register-exempt via typeVoiceGoverned.
    const offenders: string[] = [];
    for (const f of governed) {
      if (!f.path.endsWith(".css") || f.path.endsWith("globals.css")) continue;
      if (/font-family:\s*var\(--font-sans\)/.test(f.content)) offenders.push(rel(f.path));
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("no governed CSS names Geist or the retired Home grotesk raw (the face rides the token)", () => {
    const offenders: string[] = [];
    for (const f of governed) {
      if (!f.path.endsWith(".css")) continue;
      if (f.path.endsWith("globals.css")) {
        // The canonical token declaration is the ONE site allowed to name the
        // "Geist" fallback head; the retired grotesk must stay gone.
        if (/Hanken/.test(f.content)) offenders.push("globals.css: Hanken survives");
        continue;
      }
      if (/"Geist"|Hanken/.test(f.content)) offenders.push(rel(f.path));
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
