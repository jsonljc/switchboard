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
