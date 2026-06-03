import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
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
    // It delegates to the shared PrintedPortraitAvatar, the single tokenized
    // source of the agent hues (hsl(var(--agent-mira-deep)) lives in that
    // component's CSS module, not hand-rolled here).
    expect(inboxAvatar).toMatch(/PrintedPortraitAvatar/);
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

describe("token governance — one neutral ink ramp by role (T5)", () => {
  it("editorial ink tiers reference the --palette-ink-* ramp", () => {
    expect(tokenValue("ink")).toBe("hsl(var(--palette-ink-900))");
    expect(tokenValue("ink-2")).toBe("hsl(var(--palette-ink-700))");
    expect(tokenValue("ink-3")).toBe("hsl(var(--palette-ink-500))");
    expect(tokenValue("ink-4")).toBe("hsl(var(--palette-ink-400))");
    expect(tokenValue("ink-5")).toBe("hsl(var(--palette-ink-300))");
  });

  it("inbox ink tiers reference the same ramp (no forked inks)", () => {
    expect(inboxToken("ink-1")).toBe("hsl(var(--palette-ink-900))");
    expect(inboxToken("ink-2")).toBe("hsl(var(--palette-ink-700))");
    expect(inboxToken("ink-3")).toBe("hsl(var(--palette-ink-500))");
    expect(inboxToken("ink-4")).toBe("hsl(var(--palette-ink-400))");
  });

  it("the ink-ramp primitives are raw triples (dark-overridable)", () => {
    for (const t of [
      "palette-ink-900",
      "palette-ink-700",
      "palette-ink-500",
      "palette-ink-400",
      "palette-ink-300",
    ]) {
      expect(tokenValue(t)).toMatch(RAW_HSL_TRIPLE);
    }
  });
});

// Recursive sweep over ALL governed source (spec §3.2 governed paths), excluding
// tests (they hold legacy hexes as fixtures), sprite pixel data, node_modules, .next.
function collectGovernedFiles(): Array<{ path: string; content: string }> {
  const roots = ["src/app", "src/components", "src/lib", "src/styles"];
  const out: Array<{ path: string; content: string }> = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".next" || e.name === "__tests__") continue;
        walk(full);
      } else if (/\.(css|ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name)) {
        if (/-variants\.ts$/.test(e.name)) continue; // sprite pixel data (excluded)
        // Strip the bare `.dark { … }` block — dark palette VALUES are Wave-3
        // deferred (spec §0), not part of the light-mode governance contract.
        const content = readFileSync(full, "utf8").replace(/\.dark\s*\{[^}]*\}/g, "");
        out.push({ path: full, content });
      }
    }
  };
  for (const r of roots) walk(path.resolve(process.cwd(), r));
  return out;
}

describe("token governance — governed-source drift sweep (generalized)", () => {
  const files = collectGovernedFiles();
  const rel = (p: string) => (p.includes("/src/") ? p.slice(p.indexOf("/src/") + 1) : p);

  it("scans a meaningful slice of governed source", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("no legacy agent/cockpit hex value survives anywhere in governed source", () => {
    const legacy = [
      "#E07A53",
      "#8C3E1E",
      "#F4D5C5",
      "#FBF0EA",
      "#3F8C86",
      "#215451",
      "#C5DFDD",
      "#EBF5F4",
      "#4A3A66",
      "#E7E1F0",
      "#e07856",
      "#2e8a87",
      "#7e6bb2",
      "#B8782E",
      "#7C4F1C",
      "#3F7A36",
      "#A03A2E",
    ];
    const offenders: string[] = [];
    for (const { path: p, content } of files) {
      for (const hex of legacy) {
        if (content.includes(hex)) offenders.push(`${hex} in ${rel(p)}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("no brand token (action/agent) is re-forked with a literal in any governed file", () => {
    // The spec's general contract: a known brand token defined with a hex/triple
    // (not var()-based) anywhere outside the primitive block is drift. Catches
    // re-forks the enumerated legacy list would miss (e.g. a brand-new hex).
    const BRAND_DEF =
      /--(action|operator|char-accent|agent-(?:alex|riley|mira)|coral|teal|violet|amber)(?:-(?:deep|tint|soft|paper|hover|foreground|subtle))?\s*:\s*([^;]+);/g;
    const offenders: string[] = [];
    for (const { path: p, content } of files) {
      const lines = content.split("\n");
      for (const m of content.matchAll(BRAND_DEF)) {
        const value = m[2].trim();
        if (/var\(--/.test(value)) continue;
        // A token-debt exemption must sit on the declaration's own line or the
        // line directly above it (NOT anywhere in the file) and carry an `expires`
        // clause (spec §3.3) — a file-wide marker no longer disarms the check.
        const lineNo = content.slice(0, m.index ?? 0).split("\n").length - 1;
        const marked = [lines[lineNo], lines[lineNo - 1]].some(
          (l) => l != null && /token-debt:.*expires/.test(l),
        );
        if (!marked) offenders.push(`${rel(p)}: ${m[0].trim()}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

describe("token governance — query-states layer carries no literal color", () => {
  it("query-states/* sources contain no hex literal", () => {
    const dir = path.resolve(process.cwd(), "src/components/query-states");
    const HEX = /#[0-9a-fA-F]{3,8}\b/;
    for (const name of readdirSync(dir)) {
      if (!/\.(ts|tsx)$/.test(name) || /\.test\./.test(name)) continue;
      const content = readFileSync(`${dir}/${name}`, "utf8");
      expect(HEX.test(content), `hex literal in query-states/${name}`).toBe(false);
    }
  });
});

// ─── EL1: elevation ladder ────────────────────────────────────────────────
// A box-shadow value carrying a literal color (NOT a var() reference).
const LITERAL_SHADOW_COLOR = /rgba?\(\s*[\d.]|hsl\(\s*[\d.]|#[0-9a-fA-F]{3,8}\b/;

describe("token governance — elevation ladder single-source (EL1)", () => {
  it("defines one warm shadow base as a dark-overridable raw triple", () => {
    expect(tokenValue("shadow-color")).toMatch(RAW_HSL_TRIPLE);
  });

  it("the five ladder levels exist and carry no literal color", () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const v = tokenValue(`shadow-${n}`);
      expect(v, `--shadow-${n}`).toContain("var(--shadow-color)");
      expect(v, `--shadow-${n}`).not.toMatch(LITERAL_SHADOW_COLOR);
    }
  });

  it("semantic shadow tokens repoint at ladder levels (zero-churn)", () => {
    expect(tokenValue("shadow-card")).toBe("var(--shadow-1)");
    expect(tokenValue("shadow-lift")).toBe("var(--shadow-3)");
  });

  it("the directional sheet shadow shares the warm base, no literal color", () => {
    const v = tokenValue("shadow-sheet");
    expect(v).toContain("var(--shadow-color)");
    expect(v).not.toMatch(LITERAL_SHADOW_COLOR);
  });
});

describe("token governance — no literal-color box-shadow outside globals.css (EL1)", () => {
  const files = collectGovernedFiles();
  const rel = (p: string) => (p.includes("/src/") ? p.slice(p.indexOf("/src/") + 1) : p);
  // Blank /* ... */ comments (newlines preserved) so a commented-out box-shadow
  // never false-positives.
  const blankComments = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  // A single spread-only ring (0 0 0 Npx <color>) is a focus ring / status halo
  // / pulse, never elevation; exempt after collapsing color functions to a token.
  const isRing = (value: string): boolean => {
    const collapsed = value.replace(/(?:rgba?|hsl)\([^)]*\)/g, "C");
    return !collapsed.includes(",") && /^\s*(?:inset\s+)?0\s+0\s+0\s+\S/.test(collapsed);
  };

  it("the ladder is the single source — no --shadow* token defined outside globals.css", () => {
    const offenders: string[] = [];
    for (const { path: p, content } of files) {
      if (p.replace(/\\/g, "/").endsWith("src/app/globals.css")) continue;
      for (const m of content.matchAll(/(--shadow[\w-]*)\s*:/g)) {
        offenders.push(`${rel(p)}: ${m[1]}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("every box-shadow usage resolves to a token / none / ring, never a literal color", () => {
    const offenders: string[] = [];
    for (const { path: p, content: raw } of files) {
      const scan = blankComments(raw);
      // CSS `box-shadow:`, plus JSX `boxShadow:` / imperative `boxShadow =` in
      // quotes or backticks — every value form a literal color can hide in.
      const decls = [
        ...scan.matchAll(/box-shadow\s*:\s*([^;]+);/g),
        ...scan.matchAll(/boxShadow\s*[:=]\s*["'`]([^"'`]+)["'`]/g),
      ];
      for (const m of decls) {
        const value = m[1].trim();
        if (!LITERAL_SHADOW_COLOR.test(value)) continue; // token / var / none → ok
        if (isRing(value)) continue; // focus ring / halo / pulse → not elevation
        offenders.push(`${rel(p)}: ${value.replace(/\s+/g, " ").slice(0, 90)}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

// Tailwind shadow utilities are a literal-color vector the CSS sweep cannot see
// (they are class names, not `box-shadow:` declarations). Govern them too.
describe("token governance — Tailwind shadow utilities use the ladder (EL1)", () => {
  const tsxFiles = collectGovernedFiles().filter((f) => /\.tsx?$/.test(f.path));
  const relTsx = (p: string) => (p.includes("/src/") ? p.slice(p.indexOf("/src/") + 1) : p);

  // Built-in Tailwind elevation utilities default to cool rgb(0 0 0). They are a
  // documented EL1 residual on these out-of-scope surfaces ONLY (marketing
  // landing, the flag-hidden operator-chat widget #825, settings #826, the
  // dev-only panel, and small non-overlay primitives). New authed surfaces must
  // use the ladder via shadow-[var(--shadow-N)].
  const BUILTIN_RESIDUALS = [
    "components/landing/",
    "components/onboarding/",
    "components/dev/",
    "app/(auth)/settings/",
    "components/operator-chat/",
    "components/ui/switch.tsx",
    "components/ui/tabs.tsx",
  ];
  const LANDING = "components/landing/";
  const BUILTIN = /(?<![\w-])shadow-(?:sm|md|lg|xl|2xl)(?![\w-])/;
  const ARBITRARY = /(?<![\w-])shadow-\[([^\]]*)\]/g;

  it("no built-in Tailwind elevation shadow outside the documented residuals", () => {
    const offenders: string[] = [];
    for (const { path: p, content } of tsxFiles) {
      const r = relTsx(p);
      if (BUILTIN_RESIDUALS.some((a) => r.includes(a))) continue;
      if (BUILTIN.test(content)) offenders.push(r);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("no arbitrary shadow-[...] carries a literal color outside marketing landing", () => {
    const offenders: string[] = [];
    for (const { path: p, content } of tsxFiles) {
      const r = relTsx(p);
      if (r.includes(LANDING)) continue;
      for (const m of content.matchAll(ARBITRARY)) {
        if (LITERAL_SHADOW_COLOR.test(m[1])) {
          offenders.push(`${r}: shadow-[${m[1].slice(0, 50)}]`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
