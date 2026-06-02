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

const alexConfig = readFileSync(
  path.resolve(process.cwd(), "src/lib/cockpit/alex-config.ts"),
  "utf8",
);
const rileyConfig = readFileSync(
  path.resolve(process.cwd(), "src/lib/cockpit/riley/riley-config.ts"),
  "utf8",
);
const cockpitTokens = readFileSync(
  path.resolve(process.cwd(), "src/components/cockpit/tokens.ts"),
  "utf8",
);

const HEX = /#[0-9a-fA-F]{3,8}\b/;

describe("token governance — finalized drift guard (TG)", () => {
  const governed: Record<string, string> = {
    "alex-config.ts": alexConfig,
    "riley-config.ts": rileyConfig,
    "inbox-agent-avatar.tsx": inboxAvatar,
    "cockpit/tokens.ts": cockpitTokens,
    "inbox-design-base.css": inboxBase,
  };

  it("no legacy agent-hue / cockpit hex survives in governed source", () => {
    const legacy = [
      "#E07A53",
      "#8C3E1E",
      "#F4D5C5",
      "#FBF0EA", // Alex coral family
      "#3F8C86",
      "#215451",
      "#C5DFDD",
      "#EBF5F4", // Riley teal family
      "#4A3A66",
      "#E7E1F0", // Mira avatar override
      "#e07856",
      "#2e8a87",
      "#7e6bb2", // inbox identity hexes
      "#B8782E",
      "#7C4F1C",
      "#3F7A36",
      "#A03A2E", // cockpit amber/green/red
    ];
    for (const [fname, content] of Object.entries(governed)) {
      for (const hex of legacy) {
        expect(content.includes(hex), `${hex} still present in ${fname}`).toBe(false);
      }
    }
  });

  it("the cockpit token family + agent configs carry zero hex color literals", () => {
    expect(cockpitTokens).not.toMatch(HEX);
    expect(alexConfig).not.toMatch(HEX);
    expect(rileyConfig).not.toMatch(HEX);
  });

  it("--palette-action-bright is reserved for non-text fills (never a text color)", () => {
    // spec §4.5: stripes/pip/low-info fills only — never backs text/glyph/label.
    expect(css).not.toMatch(/[^-]color:\s*hsl\(var\(--palette-action-bright\)\)/);
    expect(css).not.toMatch(/-foreground:\s*[^;]*--palette-action-bright/);
  });

  it("each agent hue has exactly one primitive definition", () => {
    expect(tokenValue("palette-coral")).toMatch(RAW_HSL_TRIPLE);
    expect(tokenValue("palette-teal")).toMatch(RAW_HSL_TRIPLE);
    expect(tokenValue("palette-violet")).toMatch(RAW_HSL_TRIPLE);
    expect(tokenValue("agent-alex")).toBe("var(--palette-coral)");
    expect(tokenValue("agent-riley")).toBe("var(--palette-teal)");
    expect(tokenValue("agent-mira")).toBe("var(--palette-violet)");
  });
});
