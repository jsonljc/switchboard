import { describe, it, expect } from "vitest";
import { collectGovernedFiles, rel, typeVoiceGoverned, tokenValue } from "./token-governance.lib";

// ─────────────────────────────────────────────────────────────────────────────
// Mira reskin A2: raw font-family string guard. next/font loads JetBrains Mono
// at weights 400/500/600 only, exposing it as --font-mono-editorial. An inline
// fontFamily: "JetBrains Mono" bypasses the registration and matches a
// system-installed font (if any) or silently falls back to sans. The token
// T.mono = "var(--font-mono-editorial)" is the correct reference.
// Split from token-governance.test.ts because that file was already over the
// eslint max-lines cap; shared mechanics live in token-governance.lib.ts.
// ─────────────────────────────────────────────────────────────────────────────
describe("type honesty: no raw font-family strings in governed TSX (mira reskin)", () => {
  it("inline fontFamily must be a var() token or inherit, never a raw family name", () => {
    const offenders: string[] = [];
    for (const f of collectGovernedFiles()) {
      if (!/\.(ts|tsx)$/.test(f.path)) continue;
      if (!typeVoiceGoverned(f.path)) continue;
      const re = /fontFamily:\s*["'`](?!inherit\b|var\()/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(f.content)) !== null) {
        const line = f.content.slice(0, m.index).split("\n").length;
        offenders.push(`${rel(f.path)}:${line}`);
      }
    }
    expect(
      offenders,
      "raw font-family strings bypass next/font (use T.mono / T.display / var(--font-*))",
    ).toEqual([]);
  });
});

describe("risk tint (mira stop confirm)", () => {
  it("defines the terracotta risk-tint primitive and semantic alias", () => {
    expect(tokenValue("palette-risk-tint")).toBe("14 45% 93%");
    expect(tokenValue("risk-tint")).toBe("var(--palette-risk-tint)");
  });
});

describe("radius tokens", () => {
  it("defines the pill radius consumed by panel/nav controls", () => {
    expect(tokenValue("radius-pill")).toBe("999px");
  });
});

describe("night register tokens (mira review feed)", () => {
  it("defines warm-charcoal primitives (never pure black) under night semantics", () => {
    expect(tokenValue("palette-night-canvas")).toBe("45 22% 7%");
    expect(tokenValue("palette-night-surface")).toBe("45 14% 12%");
    expect(tokenValue("palette-night-ink")).toBe("40 30% 94%");
    expect(tokenValue("palette-night-ink-2")).toBe("42 12% 74%");
    expect(tokenValue("palette-night-ink-3")).toBe("43 9% 60%");
    expect(tokenValue("palette-night-scrim")).toBe("45 22% 4%");
    expect(tokenValue("palette-night-risk")).toBe("0 42% 34%");
    for (const name of ["canvas", "surface", "ink", "ink-2", "ink-3", "scrim", "risk"]) {
      expect(tokenValue(`night-${name}`)).toBe(`var(--palette-night-${name})`);
    }
  });
});

describe("night register: mira surfaces carry no raw neutral literals", () => {
  it("mira feed/detail consume tokens, never #000/#fff/raw rgba", () => {
    const SCOPES = ["components/cockpit/mira/", "app/(auth)/mira/"];
    const offenders: string[] = [];
    for (const f of collectGovernedFiles()) {
      if (!SCOPES.some((s) => f.path.includes(s))) continue;
      const re = /#(?:000|fff)\b|rgba?\(\s*\d/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(f.content)) !== null) {
        const line = f.content.slice(0, m.index).split("\n").length;
        offenders.push(`${rel(f.path)}:${line}: ${m[0]}`);
      }
    }
    expect(offenders, "use hsl(var(--night-*)) / T.* tokens on Mira surfaces").toEqual([]);
  });
});
