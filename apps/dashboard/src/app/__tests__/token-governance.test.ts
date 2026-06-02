import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { contrastRatio } from "@/lib/tokens/contrast";

/**
 * Token drift-guard (spec §3.4). Reads globals.css and asserts the governance
 * contract. Grows across slices T1→TG; this file is the CI-enforceable backstop
 * because the dashboard ESLint "lint" is stubbed and CI format:check is *.ts-only,
 * so CSS/token changes are otherwise not gated.
 */

// vitest runs with cwd = apps/dashboard (the package dir).
const css = readFileSync(path.resolve(process.cwd(), "src/app/globals.css"), "utf8");

/** First (:root / light) definition of a CSS custom property in globals.css. */
function tokenValue(name: string): string {
  const m = css.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  if (!m) throw new Error(`token --${name} is not defined in globals.css`);
  return m[1].trim();
}

const RAW_HSL_TRIPLE = /^-?\d+(?:\.\d+)?\s+-?\d+(?:\.\d+)?%\s+-?\d+(?:\.\d+)?%$/;

describe("token governance — action amber single-source (T1)", () => {
  it("defines the AA action amber primitive", () => {
    expect(tokenValue("palette-action")).toBe("30 58% 41%");
  });

  it("semantic action tokens reference the primitive, never a literal", () => {
    expect(tokenValue("action")).toBe("var(--palette-action)");
    expect(tokenValue("action-hover")).toBe("var(--palette-action-hover)");
    expect(tokenValue("operator")).toBe("var(--palette-action)");
    expect(tokenValue("char-accent")).toBe("hsl(var(--action))");
    expect(tokenValue("action")).not.toMatch(RAW_HSL_TRIPLE);
  });

  it("agent identity hues reference primitives, never a literal", () => {
    expect(tokenValue("agent-alex")).toBe("var(--palette-coral)");
    expect(tokenValue("agent-riley")).toBe("var(--palette-teal)");
    expect(tokenValue("agent-mira")).toBe("var(--palette-violet)");
  });

  it("the action foreground references the white primitive", () => {
    expect(tokenValue("action-foreground")).toBe("var(--palette-action-fg)");
  });

  it("the action foreground/background primitives pass WCAG AA (≥ 4.5:1)", () => {
    const fg = tokenValue("palette-action-fg"); // 0 0% 100%
    const bg = tokenValue("palette-action"); // 30 58% 41%
    expect(fg).toMatch(RAW_HSL_TRIPLE);
    expect(bg).toMatch(RAW_HSL_TRIPLE);
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});

const inboxBase = readFileSync(
  path.resolve(process.cwd(), "src/components/inbox/inbox-design-base.css"),
  "utf8",
);
const inboxAvatar = readFileSync(
  path.resolve(process.cwd(), "src/components/inbox/inbox-agent-avatar.tsx"),
  "utf8",
);

function inboxToken(name: string): string {
  const m = inboxBase.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  if (!m) throw new Error(`inbox token --${name} not defined`);
  return m[1].trim();
}

describe("token governance — inbox agent hues single-source (T3)", () => {
  it("inbox identity tokens reference the canonical agent vars", () => {
    expect(inboxToken("coral")).toBe("hsl(var(--agent-alex))");
    expect(inboxToken("teal")).toBe("hsl(var(--agent-riley))");
    expect(inboxToken("violet")).toBe("hsl(var(--agent-mira))");
    expect(inboxToken("coral-deep")).toBe("hsl(var(--agent-alex-deep))");
    expect(inboxToken("violet-deep")).toBe("hsl(var(--agent-mira-deep))");
  });

  it("inbox action amber references the canonical action vars", () => {
    expect(inboxToken("amber")).toBe("hsl(var(--action))");
    expect(inboxToken("amber-deep")).toBe("hsl(var(--action-hover))");
  });

  it("the inbox avatar no longer hand-rolls a Mira hex", () => {
    expect(inboxAvatar).not.toMatch(/#4A3A66/i);
    expect(inboxAvatar).not.toMatch(/#E7E1F0/i);
    expect(inboxAvatar).toMatch(/hsl\(var\(--agent-mira-deep\)\)/);
  });
});
