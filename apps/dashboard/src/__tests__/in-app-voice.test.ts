import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * CI guard: the in-app honest voice (see docs/voice/in-app-voice.md).
 *
 * Extends the marketing no-banned-claims pattern into the app, scoped to a
 * bounded, curated corpus of agent-voice copy surfaces. Two rules are enforced
 * here (the rest of the voice spec is review-enforced for now):
 *   R1  no em-dash (the AI tell) in functional copy, except the lone "—" glyph
 *   R2  no "generate" attribution verb (agents draft / render / handle / book)
 *
 * Copy is extracted with the TypeScript compiler, NOT a hand-rolled scanner, so
 * comments are never scanned (they are trivia), and template interpolation, JSX
 * text, URLs, nested templates, and regex literals are all parsed correctly. A
 * dynamic connector like `${name} — ${summary}` is caught because the " — "
 * between interpolations is a real template text span.
 *
 * GROW THE CORPUS as more surfaces are brought onto the honest voice.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_SRC = join(HERE, ".."); // apps/dashboard/src

interface CopySpan {
  line: number;
  text: string;
}

/**
 * Parse a TS/TSX source and return every user-facing copy span: string
 * literals, template-literal text (the head and the text between `${...}`
 * interpolations), and JSX text. Comments are trivia and are never returned, so
 * a comment em-dash cannot false-positive; code tokens are not returned either.
 */
export function extractCopySpans(source: string, fileName: string): CopySpan[] {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const spans: CopySpan[] = [];
  const add = (text: string, pos: number) => {
    spans.push({ line: sf.getLineAndCharacterOfPosition(pos).line + 1, text });
  };
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node)) {
      // string literal or no-substitution template literal
      add(node.text, node.getStart(sf));
    } else if (ts.isTemplateExpression(node)) {
      add(node.head.text, node.head.getStart(sf));
      for (const span of node.templateSpans) add(span.literal.text, span.literal.getStart(sf));
    } else if (ts.isJsxText(node)) {
      add(node.text, node.getStart(sf));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return spans;
}

/**
 * R1: an em-dash (U+2014) used in copy. A span whose entire text is exactly the
 * lone "—" no-data glyph is allowed; everything else (prose dashes, the
 * space-padded " — " connector, the text between `${...}` interpolations) is a
 * violation.
 */
export function isEmDashViolation(text: string): boolean {
  return text.includes("—") && text !== "—";
}

/** R2: the "generate" attribution verb family (not the noun "generation"). */
const GENERATE_VERB = /\bgenerat(e|ed|es|ing)\b/i;
export function isGenerateViolation(text: string): boolean {
  return GENERATE_VERB.test(text);
}

/**
 * V1 seed corpus: agent-voice copy surfaces (paths relative to apps/dashboard/src).
 * Excludes the Wave-0-active inbox/Home files, the Mercury "—" table-placeholder
 * surfaces, the marketing landing (own guard), legal (public) pages, and tests.
 * GROW THIS as more surfaces are de-em-dashed. See docs/voice/in-app-voice.md.
 */
const CORPUS = [
  "lib/cockpit/mira/mira-config.ts",
  "lib/cockpit/mira/desk-copy.ts",
  "lib/cockpit/riley/riley-config.ts",
  "lib/decisions/risk-chips.ts",
  "components/query-states/states.tsx",
  "components/results/states.tsx",
  "components/agent-panel/lib/activity-voice.ts",
  "components/agent-panel/work-log.tsx",
  "components/agent-panel/open-decisions.tsx",
  "components/cockpit/mira/mira-creative-feed.tsx",
  "components/cockpit/mira/mira-brief-box.tsx",
  "components/cockpit/mira/mira-clip-actions.tsx",
  "app/(auth)/mira/creatives/[id]/creative-detail-page.tsx",
] as const;

interface Offense {
  file: string;
  line: number;
  text: string;
}

/** Scan every corpus file's extracted copy spans with `predicate`. */
function scanCorpus(predicate: (text: string) => boolean): Offense[] {
  const offenses: Offense[] = [];
  for (const rel of CORPUS) {
    const abs = join(DASHBOARD_SRC, rel);
    const spans = extractCopySpans(readFileSync(abs, "utf8"), abs);
    for (const span of spans) {
      if (predicate(span.text)) {
        offenses.push({ file: rel, line: span.line, text: span.text.trim() });
      }
    }
  }
  return offenses;
}

function format(offenses: Offense[]): string {
  return offenses.map((o) => `  ${o.file}:${o.line}  →  ${JSON.stringify(o.text)}`).join("\n");
}

describe("extractCopySpans", () => {
  it("ignores line and block comments", () => {
    const spans = extractCopySpans("// note — x\n/* block — y */\nconst a = 1;", "f.ts");
    expect(spans.some((s) => s.text.includes("—"))).toBe(false);
  });
  it("extracts a string literal's text", () => {
    const spans = extractCopySpans('const s = "save — try";', "f.ts");
    expect(spans.map((s) => s.text)).toContain("save — try");
  });
  it("extracts JSX text including a URL with // (not treated as a comment)", () => {
    const spans = extractCopySpans("<p>See https://x.ai — then retry</p>", "f.tsx");
    expect(spans.some((s) => s.text.includes("https://x.ai — then retry"))).toBe(true);
  });
  it("extracts the text between template interpolations", () => {
    const spans = extractCopySpans("const g = `${a} — ${b}`;", "f.ts");
    expect(spans.map((s) => s.text)).toContain(" — ");
  });
  it("does NOT leak a comment inside a template interpolation", () => {
    const spans = extractCopySpans("const g = `Ready ${x /* note — c */}`;", "f.ts");
    expect(spans.some((s) => s.text.includes("—"))).toBe(false);
  });
  it("extracts a lone em-dash literal as exactly '—'", () => {
    const spans = extractCopySpans('const x = cond ? v : "—";', "f.ts");
    expect(spans.map((s) => s.text)).toContain("—");
  });
});

describe("isEmDashViolation", () => {
  it("flags an em-dash between words", () => {
    expect(isEmDashViolation("Couldn't save — try again")).toBe(true);
  });
  it("flags an em-dash with no surrounding spaces", () => {
    expect(isEmDashViolation("save—try")).toBe(true);
  });
  it("flags the space-padded connector literal (concatenation / interpolation)", () => {
    expect(isEmDashViolation(" — ")).toBe(true);
  });
  it("does NOT flag the lone em-dash no-data glyph", () => {
    expect(isEmDashViolation("—")).toBe(false);
  });
  it("does NOT flag a CSS custom-property hyphen string", () => {
    expect(isEmDashViolation("hsl(var(--agent-mira))")).toBe(false);
  });
});

describe("isGenerateViolation", () => {
  it("flags the verb forms", () => {
    expect(isGenerateViolation("Generating draft")).toBe(true);
    expect(isGenerateViolation("as they generate")).toBe(true);
  });
  it("does NOT flag the noun 'generation'", () => {
    expect(isGenerateViolation("the next generation step")).toBe(false);
  });
});

describe("in-app voice guard — corpus", () => {
  it("corpus is non-empty and every path exists", () => {
    expect(CORPUS.length).toBeGreaterThan(5);
    for (const rel of CORPUS) {
      expect(existsSync(join(DASHBOARD_SRC, rel)), `${rel} should exist`).toBe(true);
    }
  });
});

describe("in-app voice guard — R1 no em-dash in copy", () => {
  it("agent-voice copy uses no em-dash (the lone '—' glyph excepted)", () => {
    const offenses = scanCorpus(isEmDashViolation);
    if (offenses.length > 0) {
      throw new Error(
        `Found ${offenses.length} em-dash(es) in agent-voice copy. ` +
          `Use a comma, colon, period, or restructure (see docs/voice/in-app-voice.md). ` +
          `Only a lone "—" no-data glyph is allowed.\n${format(offenses)}`,
      );
    }
    expect(offenses).toEqual([]);
  });
});

describe("in-app voice guard — R2 no 'generate' verb", () => {
  it("agent-voice copy uses draft/render voice, never 'generate'", () => {
    const offenses = scanCorpus(isGenerateViolation);
    if (offenses.length > 0) {
      throw new Error(
        `Found ${offenses.length} use(s) of the 'generate' verb in agent-voice copy. ` +
          `Agents draft / render / handle / book; the cockpit speaks "draft", not "generate" ` +
          `(see docs/voice/in-app-voice.md). If a use is genuinely correct, narrow this rule ` +
          `and update the spec.\n${format(offenses)}`,
      );
    }
    expect(offenses).toEqual([]);
  });
});
