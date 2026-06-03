import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * CI guard: the in-app honest voice (see docs/voice/in-app-voice.md).
 *
 * Extends the marketing no-banned-claims pattern into the app, scoped to a
 * bounded, curated corpus of agent-voice copy surfaces. Two rules are enforced
 * here (the rest of the voice spec is review-enforced for now):
 *   R1  no prose em-dash (the AI tell) in functional copy
 *   R2  no "generate" attribution verb (agents draft / render / handle / book)
 *
 * Comments are stripped before scanning, because code comments are full of
 * em-dashes and would otherwise false-positive. A lone "—" no-data glyph is
 * deliberately NOT flagged (only the em-dash used AS prose is).
 *
 * GROW THE CORPUS as more surfaces are brought onto the honest voice.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_SRC = join(HERE, ".."); // apps/dashboard/src

/**
 * Remove // line comments and block comments while preserving string literals,
 * template literals, and JSX text (so an em-dash in a comment is dropped but an
 * em-dash in copy survives). Newlines are preserved so reported line numbers
 * match the original file. Fails open: any unhandled construct without an
 * em-dash is a harmless no-op.
 */
export function stripComments(src: string): string {
  type Mode = "normal" | "line" | "block" | "sq" | "dq" | "tpl";
  let mode: Mode = "normal";
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const c2 = i + 1 < src.length ? src[i + 1] : "";
    if (mode === "normal") {
      if (c === "/" && c2 === "/") {
        mode = "line";
        i++;
        continue;
      }
      if (c === "/" && c2 === "*") {
        mode = "block";
        i++;
        continue;
      }
      if (c === "'") {
        mode = "sq";
        out += c;
        continue;
      }
      if (c === '"') {
        mode = "dq";
        out += c;
        continue;
      }
      if (c === "`") {
        mode = "tpl";
        out += c;
        continue;
      }
      out += c;
      continue;
    }
    if (mode === "line") {
      if (c === "\n") {
        mode = "normal";
        out += c;
      }
      continue;
    }
    if (mode === "block") {
      if (c === "*" && c2 === "/") {
        mode = "normal";
        i++;
        continue;
      }
      if (c === "\n") out += c;
      continue;
    }
    // string / template modes: copy through, honoring escapes
    if (c === "\\") {
      out += c;
      if (i + 1 < src.length) out += src[i + 1];
      i++;
      continue;
    }
    if (mode === "sq" && c === "'") {
      mode = "normal";
      out += c;
      continue;
    }
    if (mode === "dq" && c === '"') {
      mode = "normal";
      out += c;
      continue;
    }
    if (mode === "tpl" && c === "`") {
      mode = "normal";
      out += c;
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * True if the text uses an em-dash (U+2014) as inline prose punctuation, i.e.
 * adjacent (across optional spaces) to a word character on either side. A lone
 * "—" no-data glyph (no adjacent word character) is intentionally NOT flagged.
 */
const PROSE_EM_DASH = /[A-Za-z0-9]\s*—|—\s*[A-Za-z0-9]/;
export function containsProseEmDash(text: string): boolean {
  return PROSE_EM_DASH.test(text);
}

/** R2: the "generate" attribution verb family (not the noun "generation"). */
const GENERATE_VERB = /\bgenerat(e|ed|es|ing)\b/i;

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

/** Scan every corpus file's comment-stripped lines with `predicate`. */
function scanCorpus(predicate: (strippedLine: string) => boolean): Offense[] {
  const offenses: Offense[] = [];
  for (const rel of CORPUS) {
    const raw = readFileSync(join(DASHBOARD_SRC, rel), "utf8");
    const original = raw.split("\n");
    const stripped = stripComments(raw).split("\n");
    stripped.forEach((line, idx) => {
      if (predicate(line)) {
        offenses.push({ file: rel, line: idx + 1, text: (original[idx] ?? line).trim() });
      }
    });
  }
  return offenses;
}

function format(offenses: Offense[]): string {
  return offenses.map((o) => `  ${o.file}:${o.line}  →  ${o.text}`).join("\n");
}

describe("stripComments", () => {
  it("returns plain code unchanged", () => {
    expect(stripComments("const a = 1;")).toBe("const a = 1;");
  });
  it("drops a line comment but keeps the newline", () => {
    expect(stripComments("a;// note — x\nb;")).toBe("a;\nb;");
  });
  it("drops a block comment and preserves line count", () => {
    expect(stripComments("a;/* note —\nmore — */b;")).toBe("a;\nb;");
  });
  it("keeps an em-dash inside a string literal", () => {
    expect(stripComments('const s = "save — try";')).toContain("save — try");
  });
  it("keeps an em-dash inside JSX text (normal mode)", () => {
    expect(stripComments("<p>save — try</p>")).toContain("save — try");
  });
  it("does not treat // inside a string as a comment", () => {
    expect(stripComments('const u = "https://x — y";')).toContain("x — y");
  });
});

describe("containsProseEmDash", () => {
  it("flags an em-dash between words", () => {
    expect(containsProseEmDash("Couldn't save — try again")).toBe(true);
  });
  it("flags an em-dash with no surrounding spaces", () => {
    expect(containsProseEmDash("save—try")).toBe(true);
  });
  it("flags a leading byline em-dash", () => {
    expect(containsProseEmDash("— Riley")).toBe(true);
  });
  it("does NOT flag a lone em-dash glyph", () => {
    expect(containsProseEmDash("—")).toBe(false);
  });
  it("does NOT flag a space-padded standalone connective literal", () => {
    expect(containsProseEmDash(' " — " ')).toBe(false);
  });
  it("does NOT flag a CSS custom-property hyphen string", () => {
    expect(containsProseEmDash("hsl(var(--agent-mira))")).toBe(false);
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

describe("in-app voice guard — R1 no prose em-dash", () => {
  it("agent-voice copy uses no em-dash as prose punctuation", () => {
    const offenses = scanCorpus(containsProseEmDash);
    if (offenses.length > 0) {
      throw new Error(
        `Found ${offenses.length} prose em-dash(es) in agent-voice copy. ` +
          `Use a comma, colon, period, or restructure (see docs/voice/in-app-voice.md). ` +
          `A lone "—" no-data glyph is allowed; this is the em-dash AS PROSE.\n${format(offenses)}`,
      );
    }
    expect(offenses).toEqual([]);
  });
});

describe("in-app voice guard — R2 no 'generate' verb", () => {
  it("agent-voice copy uses draft/render voice, never 'generate'", () => {
    const offenses = scanCorpus((line) => GENERATE_VERB.test(line));
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
