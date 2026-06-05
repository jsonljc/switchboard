# In-app voice guard and voice spec (V1) implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Codify the honest in-app voice in a one-page doc and back the mechanically checkable parts with a CI guard that extends the marketing no-banned-claims pattern into the app, then fix the violations it surfaces.

**Architecture:** A single self-contained vitest guard at `apps/dashboard/src/__tests__/in-app-voice.test.ts` scans a bounded, curated corpus of agent-voice copy files. It strips comments (so comment em-dashes do not false-positive), then flags prose em-dashes (an em-dash adjacent to a word character, which skips the lone `"—"` no-data glyph) and the `generate` verb stem. Copy in the corpus is de-em-dashed and moved to draft/render voice so the guard passes. The voice spec lives at `docs/voice/in-app-voice.md` and is referenced by the guard's error messages.

**Tech Stack:** TypeScript (ESM, Next.js dashboard, no `.js` import extensions), vitest, Node `fs`.

Reference: `docs/superpowers/specs/2026-06-03-in-app-voice-guard-design.md`.

---

## File structure

- Create: `docs/voice/in-app-voice.md` (the one-page voice spec).
- Create: `apps/dashboard/src/__tests__/in-app-voice.test.ts` (the guard, with local helpers and their unit tests).
- Modify (copy fixes): `lib/cockpit/mira/mira-config.ts`, `lib/cockpit/mira/desk-copy.ts`, `lib/cockpit/riley/riley-config.ts`, `components/results/states.tsx`, `components/agent-panel/lib/activity-voice.ts`, `components/cockpit/mira/mira-creative-feed.tsx`, `components/cockpit/mira/mira-brief-box.tsx`, `components/cockpit/mira/mira-clip-actions.tsx`, `app/(auth)/mira/creatives/[id]/creative-detail-page.tsx`.
- Modify (named editorial fix, not in corpus): `components/home/this-week.module.css`.
- Modify (dependent tests, as surfaced): e.g. `lib/cockpit/mira/__tests__/desk-copy.test.ts` and any test asserting a changed string.

`risk-chips.ts`, `query-states/states.tsx`, `agent-panel/work-log.tsx` are in the corpus as already-clean anchors (no edits expected).

---

## Task 1: Write the voice spec doc

**Files:**
- Create: `docs/voice/in-app-voice.md`

- [ ] **Step 1: Write the doc.** One page. Codify the five rules with a real good/bad example each (drawn from `states.tsx`, `risk-chips.ts`, `activity-voice.ts`, `work-log.tsx`), mark each `[CI-enforced in corpus]` or `[review-enforced]`, and document the narrow editorial exemption (weeknote letter voice, quote-attribution bylines). Use NO em-dashes in the doc's own prose. Content outline:
  - Title and one-line purpose.
  - Rule 1 Numbers (spell through ten in prose, tabular in metric display) `[review-enforced]`.
  - Rule 2 Attribution verbs (handled / attributed / assisted / booked / drafted, never "generated"; the cockpit speaks "draft", not "generate") `[CI-enforced in corpus]`.
  - Rule 3 Absence phrasing (omit, never placeholder; "No direct cost, comms-only" over "Money at risk:" placeholder) `[review-enforced]`.
  - Rule 4 Agent as actor, first person, never blaming `[review-enforced]`.
  - Rule 5 No em-dash AI tell in functional copy (commas/colons/periods/restructure; drop the dash in letter sign-offs; ranges use a hyphen or "to") `[CI-enforced in corpus, prose em-dash only]`, plus the documented editorial exemption.
  - A short "How this is enforced" section pointing at `apps/dashboard/src/__tests__/in-app-voice.test.ts` and naming the corpus + growth path.

- [ ] **Step 2: Verify no em-dashes in the doc.**

Run: `grep -n '—' docs/voice/in-app-voice.md`
Expected: only quoted bad-copy examples (in backticks or quotes), no em-dash as the doc's own prose punctuation.

- [ ] **Step 3: Commit.**

```bash
git add docs/voice/in-app-voice.md
git commit -m "docs(voice): one-page in-app honest-voice spec"
```

---

## Task 2: Guard helpers (stripComments + prose em-dash detector) with unit tests

**Files:**
- Create: `apps/dashboard/src/__tests__/in-app-voice.test.ts`

- [ ] **Step 1: Write the file with helpers and their unit tests (these are the failing tests first).**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_SRC = join(HERE, ".."); // apps/dashboard/src
const SELF_BASENAME = "in-app-voice.test.ts";

/**
 * Remove // line comments and /* *​/ block comments while preserving string
 * literals, template literals, and JSX text, so an em-dash inside a comment is
 * dropped but an em-dash in copy survives. Newlines are preserved so reported
 * line numbers match the original file. Fails open: any unhandled construct
 * without an em-dash is a harmless no-op.
 */
export function stripComments(src: string): string {
  type Mode = "normal" | "line" | "block" | "sq" | "dq" | "tpl";
  let mode: Mode = "normal";
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const c2 = i + 1 < src.length ? src[i + 1] : "";
    if (mode === "normal") {
      if (c === "/" && c2 === "/") { mode = "line"; i++; continue; }
      if (c === "/" && c2 === "*") { mode = "block"; i++; continue; }
      if (c === "'") { mode = "sq"; out += c; continue; }
      if (c === '"') { mode = "dq"; out += c; continue; }
      if (c === "`") { mode = "tpl"; out += c; continue; }
      out += c; continue;
    }
    if (mode === "line") {
      if (c === "\n") { mode = "normal"; out += c; }
      continue;
    }
    if (mode === "block") {
      if (c === "*" && c2 === "/") { mode = "normal"; i++; continue; }
      if (c === "\n") out += c;
      continue;
    }
    // string / template modes
    if (c === "\\") { out += c; if (i + 1 < src.length) out += src[i + 1]; i++; continue; }
    if (mode === "sq" && c === "'") { mode = "normal"; out += c; continue; }
    if (mode === "dq" && c === '"') { mode = "normal"; out += c; continue; }
    if (mode === "tpl" && c === "`") { mode = "normal"; out += c; continue; }
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
```

- [ ] **Step 2: Run the helper tests, expect FAIL first only if helpers absent.** Since helpers are defined in the same file, run them and expect PASS once the file is syntactically valid:

Run: `pnpm --filter @switchboard/dashboard test -- src/__tests__/in-app-voice.test.ts -t "stripComments"`
Expected: PASS (6 cases). If any fail, fix the helper, not the test.

Run: `pnpm --filter @switchboard/dashboard test -- src/__tests__/in-app-voice.test.ts -t "containsProseEmDash"`
Expected: PASS (6 cases).

- [ ] **Step 3: Commit.**

```bash
git add apps/dashboard/src/__tests__/in-app-voice.test.ts
git commit -m "test(dashboard): add in-app voice guard helpers (comment strip + prose em-dash)"
```

---

## Task 3: Corpus constant + inventory smoke test

**Files:**
- Modify: `apps/dashboard/src/__tests__/in-app-voice.test.ts`

- [ ] **Step 1: Add the corpus constant and a smoke test.** Append:

```ts
/**
 * V1 seed corpus: the agent-voice copy surfaces (paths relative to
 * apps/dashboard/src). GROW THIS as more surfaces are de-em-dashed. Excludes
 * the Wave-0-active inbox/Home files, the Mercury "—" table-placeholder
 * surfaces, the marketing landing (own guard), legal (public) pages, and tests.
 * See docs/voice/in-app-voice.md and the 2026-06-03 design spec.
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

interface Offense { file: string; line: number; text: string; }

function scanCorpus(predicate: (strippedLine: string) => boolean): Offense[] {
  const offenses: Offense[] = [];
  for (const rel of CORPUS) {
    const abs = join(DASHBOARD_SRC, rel);
    const original = readFileSync(abs, "utf8").split("\n");
    const stripped = stripComments(readFileSync(abs, "utf8")).split("\n");
    stripped.forEach((line, idx) => {
      if (predicate(line)) offenses.push({ file: rel, line: idx + 1, text: (original[idx] ?? line).trim() });
    });
  }
  return offenses;
}

describe("in-app voice guard — corpus", () => {
  it("corpus is non-empty and every path exists", () => {
    expect(CORPUS.length).toBeGreaterThan(5);
    for (const rel of CORPUS) {
      expect(existsSync(join(DASHBOARD_SRC, rel)), `${rel} should exist`).toBe(true);
    }
    expect(SELF_BASENAME).toBe("in-app-voice.test.ts"); // self-reference sanity
    expect(relative(DASHBOARD_SRC, DASHBOARD_SRC)).toBe("");
  });
});
```

- [ ] **Step 2: Run the smoke test.**

Run: `pnpm --filter @switchboard/dashboard test -- src/__tests__/in-app-voice.test.ts -t "corpus is non-empty"`
Expected: PASS. If a path does not exist, correct it against the live tree.

- [ ] **Step 3: Commit.**

```bash
git add apps/dashboard/src/__tests__/in-app-voice.test.ts
git commit -m "test(dashboard): define agent-voice corpus + inventory smoke test"
```

---

## Task 4: Rule R1 (no prose em-dash) + fix corpus copy

**Files:**
- Modify: `apps/dashboard/src/__tests__/in-app-voice.test.ts`
- Modify: the corpus copy files listed in the file structure.

- [ ] **Step 1: Add the R1 scan (the failing test).** Append:

```ts
describe("in-app voice guard — R1 no prose em-dash", () => {
  it("agent-voice copy uses no em-dash as prose punctuation", () => {
    const offenses = scanCorpus(containsProseEmDash);
    if (offenses.length > 0) {
      const detail = offenses.map((o) => `  ${o.file}:${o.line}  →  ${o.text}`).join("\n");
      throw new Error(
        `Found ${offenses.length} prose em-dash(es) in agent-voice copy. ` +
          `Use a comma, colon, period, or restructure (see docs/voice/in-app-voice.md). ` +
          `A lone "—" no-data glyph is allowed; this is the em-dash AS PROSE.\n${detail}`,
      );
    }
    expect(offenses).toEqual([]);
  });
});
```

- [ ] **Step 2: Run R1, expect FAIL listing the corpus em-dashes.**

Run: `pnpm --filter @switchboard/dashboard test -- src/__tests__/in-app-voice.test.ts -t "R1"`
Expected: FAIL, listing offenders in `mira-config.ts`, `desk-copy.ts`, `riley-config.ts`, `results/states.tsx`, `activity-voice.ts`, `mira-creative-feed.tsx`, `mira-brief-box.tsx`, `mira-clip-actions.tsx`, `creative-detail-page.tsx`. Use this list as the authoritative fix set.

- [ ] **Step 3: Find dependent tests before editing copy.**

Run: `grep -rn "Creative drafts —\|Generating draft\|Couldn't generate safely\|Summer Botox special —\|ready for your review\|as they generate" apps/dashboard/src --include="*.test.ts" --include="*.test.tsx"`
Note every test asserting a string about to change; update those in the same commits below.

- [ ] **Step 4: Fix the copy (de-em-dash), file by file.** Replace each prose em-dash with a comma, colon, or period, preserving meaning and warmth. Concrete conversions:
  - `lib/cockpit/mira/mira-config.ts`: `"Creative drafts — for your review"` -> `"Creative drafts, ready for your review"`; `"...Draft only — nothing is published without you."` -> `"...Draft only. Nothing is published without you."`.
  - `lib/cockpit/mira/desk-copy.ts`: brief placeholder/examples `"Summer Botox special — $11/unit through July"` -> `"Summer Botox special: $11/unit through July"` (both occurrences); `intentSummary` `"Got it — a draft ad..."` -> `"Got it. A draft ad..."`; off-scope redirect `"...results question — your front desk..."` -> `"...results question. Your front desk..."`.
  - `lib/cockpit/riley/riley-config.ts`: input placeholder `"Tell Riley what to do — pause the Cold Interests adset..."` -> `"Tell Riley what to do. Pause the Cold Interests adset..."`; quick-action chip `"Show CPL — last 30d"` -> `"Show CPL, last 30d"`.
  - `components/results/states.tsx`: `"Riley and Alex are already running — check back after your next booking comes in."` -> `"Riley and Alex are already running. Check back after your next booking comes in."`.
  - `components/agent-panel/lib/activity-voice.ts`: `"I escalated ${who} to you — ${row.head}"` -> `"I escalated ${who} to you. ${row.head}"` and the no-who branch the same. (Confirm `row.head` reads naturally as a trailing clause; if it is a bare time fragment, use a comma instead.)
  - `components/cockpit/mira/mira-creative-feed.tsx`: `"Couldn't load your drafts — pull to refresh."` -> `"Couldn't load your drafts. Pull to refresh."`; `"No drafts to review yet — Mira's drafts will appear here as they generate."` -> `"No drafts to review yet. Mira's drafts will appear here as she drafts them."` (also clears R2).
  - `components/cockpit/mira/mira-brief-box.tsx`: `"Couldn't start the draft — try again."` -> `"Couldn't start the draft. Try again."`; `"Mira is on it — she started a draft. You'll review it before anything goes live."` -> `"Mira is on it. She started a draft. You'll review it before anything goes live."`.
  - `components/cockpit/mira/mira-clip-actions.tsx`: `"Couldn't update the draft — try again."` (x2) -> `"Couldn't update the draft. Try again."`; `"Couldn't save — try again."` -> `"Couldn't save. Try again."`; `"Queued for your approval — over the auto-spend limit. Nothing ran."` -> `"Queued for your approval. This is over the auto-spend limit, so nothing ran."`.
  - `app/(auth)/mira/creatives/[id]/creative-detail-page.tsx`: convert each prose em-dash to a period or colon: `"Couldn't load this draft — try again."` -> `". Try again."`; `"Draft only — not published. Nothing goes live without you."` -> `"Draft only. Not published. Nothing goes live without you."`; `"No draft clip yet — still generating."` -> `"No draft clip yet. Still drafting."` (also clears R2); `"Draft completed — ready for your review."` -> `"Draft completed. Ready for your review."`; `"...It stays a draft —"` -> restructure to end the sentence; `"Couldn't update the draft — try again."` -> `". Try again."`; `"Queued for your approval — this render is over the auto-spend limit, so it needs your review."` -> `". This render is over the auto-spend limit, so it needs your review."`.

- [ ] **Step 5: Update any dependent tests found in Step 3** to assert the new strings, in the same edits.

- [ ] **Step 6: Run R1, expect PASS.**

Run: `pnpm --filter @switchboard/dashboard test -- src/__tests__/in-app-voice.test.ts -t "R1"`
Expected: PASS (offenses empty).

- [ ] **Step 7: Commit.**

```bash
git add apps/dashboard/src
git commit -m "fix(dashboard): de-em-dash agent-voice copy + enable R1 prose em-dash guard"
```

---

## Task 5: Rule R2 (no "generate" verb) + finish draft/render voice

**Files:**
- Modify: `apps/dashboard/src/__tests__/in-app-voice.test.ts`
- Modify: `lib/cockpit/mira/desk-copy.ts`, `app/(auth)/mira/creatives/[id]/creative-detail-page.tsx`, `components/cockpit/mira/mira-clip-actions.tsx`.

- [ ] **Step 1: Add the R2 scan (the failing test).** Append:

```ts
const GENERATE_VERB = /\bgenerat(e|ed|es|ing)\b/i;
describe("in-app voice guard — R2 no 'generate' verb", () => {
  it("agent-voice copy uses draft/render voice, never 'generate'", () => {
    const offenses = scanCorpus((line) => GENERATE_VERB.test(line));
    if (offenses.length > 0) {
      const detail = offenses.map((o) => `  ${o.file}:${o.line}  →  ${o.text}`).join("\n");
      throw new Error(
        `Found ${offenses.length} use(s) of the 'generate' verb in agent-voice copy. ` +
          `Agents draft / render / handle / book; the cockpit speaks "draft", not "generate" ` +
          `(see docs/voice/in-app-voice.md). If a use is genuinely correct, narrow this rule and update the spec.\n${detail}`,
      );
    }
    expect(offenses).toEqual([]);
  });
});
```

- [ ] **Step 2: Run R2, expect FAIL** listing the remaining `generate` uses (`desk-copy.ts` `STAGE_COPY.production` "Generating draft", `PROBLEM_COPY.unsafe` "Couldn't generate safely", `intentSummary` "generating the video"; `creative-detail-page.tsx` "next generation step" variants; `mira-clip-actions.tsx` "next generation step"). Note: comments containing "generation" do NOT appear (they are stripped).

Run: `pnpm --filter @switchboard/dashboard test -- src/__tests__/in-app-voice.test.ts -t "R2"`
Expected: FAIL with the above offenders.

- [ ] **Step 3: Convert to draft/render voice.**
  - `desk-copy.ts`: `STAGE_COPY.production` "Generating draft" -> "Drafting"; `PROBLEM_COPY.unsafe` "Couldn't generate safely" -> "Failed a safety check"; `intentSummary` "...generating the video is a separate step you confirm in review." -> "...rendering the video is a separate step you confirm in review.".
  - `creative-detail-page.tsx`: "Continue runs the next generation step (~$X)..." and the no-estimate variant and the confirm-dialog "Runs the next generation step." -> replace "generation step" with "render step".
  - `mira-clip-actions.tsx`: "Runs the next generation step. This may create provider cost..." -> "Runs the next render step. This may create provider cost...".

- [ ] **Step 4: Update dependent tests** (re-run the Step-3 grep from Task 4 plus `grep -rn "generation step\|Generating draft\|generate safely" apps/dashboard/src --include="*.test.*"`) to the new strings.

- [ ] **Step 5: Run R2, expect PASS.**

Run: `pnpm --filter @switchboard/dashboard test -- src/__tests__/in-app-voice.test.ts -t "R2"`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/dashboard/src
git commit -m "fix(dashboard): cockpit speaks draft/render not generate + enable R2 guard"
```

---

## Task 6: Drop the weeknote letter-signoff em-dash (named editorial fix)

**Files:**
- Modify: `apps/dashboard/src/components/home/this-week.module.css`

- [ ] **Step 1: Find dependent tests.**

Run: `grep -rn "weeknoteSignoff" apps/dashboard/src`
Confirm no test asserts a leading `"—"` in the signoff (it is CSS generated content, so unit tests will not assert it; jsdom does not render `::before`).

- [ ] **Step 2: Remove the signoff dash.** In `.weeknoteSignoff::before`, delete the rule (or set `content: ""`). Keep the monogram (`.weeknoteSignoffMark`) and italic name. Preferred: delete the entire `.weeknoteSignoff::before { ... }` block so no empty pseudo-element renders.

- [ ] **Step 3: Verify the home tests still pass.**

Run: `pnpm --filter @switchboard/dashboard test -- src/components/home`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add apps/dashboard/src/components/home/this-week.module.css
git commit -m "fix(dashboard): drop the weeknote letter-signoff em-dash (keep monogram + name)"
```

---

## Task 7: Full verification

- [ ] **Step 1: Typecheck.** Run: `pnpm --filter @switchboard/dashboard typecheck` — Expected: clean. (If it reports missing lower-layer exports, run a full `pnpm build` first per CLAUDE.md.)
- [ ] **Step 2: Full dashboard test suite.** Run: `pnpm --filter @switchboard/dashboard test` — Expected: all green, including the new guard and the updated copy tests.
- [ ] **Step 3: Format check.** Run: `pnpm format:check` — Expected: clean (run `pnpm format` if not, then re-add).
- [ ] **Step 4: Lint + arch.** Run: `pnpm lint` — Expected: clean (route-ingress + prettier + max-lines; the new test file is well under 600 lines).
- [ ] **Step 5: Build (the only thing that catches a missing `.js`-less import in dashboard).** Run: `pnpm --filter @switchboard/dashboard build` — Expected: success.
- [ ] **Step 6: Live screenshots** of the changed visible copy: Mira desk subtitle, a creative-detail status body, and the Home weeknote signoff. Launch the stack detached, capture with playwright-core + system Chrome, and attach to the PR.

---

## Self-review notes (gaps to watch during execution)

- Confirm `row.head` in `activity-voice.ts` reads naturally after a period; if it is a bare time token, use a comma.
- Re-grep the corpus after edits: `grep -n '—' <each corpus file>` should show zero prose em-dashes (lone `"—"` is acceptable but none exist in the corpus today).
- The guard reports original (un-stripped) line text for readability while scanning the stripped line; keep both arrays aligned by index.
- If `creative-detail-page.tsx` has the `mira-copy-hygiene` guard over it, ensure new copy does not introduce a banned CTA word (Publish/Launch/Go live).
