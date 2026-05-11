# E1a — Nova → Riley Marketing Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile the public marketing site (`apps/dashboard/src/app/(public)/*` + `apps/dashboard/src/components/landing/v6/*`) with the canonical agent roster Alex / **Riley** / Mira by renaming every Nova reference. Nova is the stale name; Riley is the locked canonical name for the paid-spend / ad-optimizer agent.

**Architecture:** Pure rename pass — no new components, no behavior changes, no copy redesign. Touches ~12 files. Includes a one-shot regression test that asserts marketing surfaces never use "Nova" again, so future drift is caught in CI.

**Tech Stack:** Next.js 14 App Router (apps/dashboard), TypeScript, Tailwind, vitest. No backend or DB changes. The marketing site is the only thing that surfaces "Nova"; product code is already on canonical names per `packages/schemas/src/__tests__/agents.test.ts` which rejects `"nova"`/`"jordan"`.

---

## Pre-flight: branch context

This plan is a single small PR landing on `main`. Per `CLAUDE.md` branch doctrine, create a focused feature branch — no worktree needed for a rename of this size.

- [ ] **Step 0.1: Confirm branch context**

Run from repo root:

```bash
git status --short
git branch --show-current
```

Expected: working tree clean, current branch is `main` (or a fresh feature branch you just created). If dirty, stop and surface to the user.

- [ ] **Step 0.2: Create feature branch**

```bash
git checkout -b feat/e1a-nova-to-riley-rename
```

---

## File Structure

No new product files. **One file is renamed** (`beat-nova.tsx` → `beat-riley.tsx`) via `git mv`. **One new test file** is created.

**Created:**

- `apps/dashboard/src/components/landing/v6/__tests__/no-stale-agent-names.test.ts` — regression test asserting marketing surfaces contain no `Nova`/`nova` references.

**Renamed:**

- `apps/dashboard/src/components/landing/v6/beat-nova.tsx` → `apps/dashboard/src/components/landing/v6/beat-riley.tsx`

**Modified:**

- `apps/dashboard/src/components/landing/v6/agent-context.tsx` — type union, `AGENTS` map, `ORDER`, localStorage validator (5 spots)
- `apps/dashboard/src/components/landing/v6/agent-toggle.tsx` — `ITEMS` entry (1 spot)
- `apps/dashboard/src/components/landing/v6/pricing.tsx` — `agent` key union + Nova card (4 spots)
- `apps/dashboard/src/components/landing/v6/synergy.tsx` — FLOW entries (4 spots)
- `apps/dashboard/src/components/landing/v6/footer.tsx` — desk description + anchor link (2 spots)
- `apps/dashboard/src/components/landing/v6/control.tsx` — "Nova's draft pauses" copy (1 spot)
- `apps/dashboard/src/components/landing/v6/glyphs.tsx` — `<symbol id="mark-nova">` + comment (2 spots)
- `apps/dashboard/src/components/landing/v6/landing-v6.css` — section comments only (2 spots)
- `apps/dashboard/src/components/landing/v6/__tests__/no-banned-claims.test.ts` — `reason` strings (2 spots)
- `apps/dashboard/src/app/(public)/page.tsx` — import + page-level metadata description
- `apps/dashboard/src/app/(public)/layout.tsx` — SEO metadata descriptions (3 copies of same string)

**Out of scope for this PR (separate tickets):**

- `packages/ad-optimizer/src/audit-runner.ts:514` runtime log line — surface-agnostic-backend cleanup, not marketing.
- `apps/dashboard/src/hooks/__tests__/use-agents.test.ts` `"Nova"` display-name fixtures — non-canonical, fine to live alongside.
- `apps/dashboard/src/components/character/agent-mark.tsx:90` historical comment.
- `/agents/[slug]` slug-vs-canonical-key question (open question #4 from redesign roadmap).
- Contact-name fixtures using `"Jordan"` as a customer name — leave alone, "Jordan" is a common first name and these are customers, not the stale agent.

---

## Design notes for copy rewrites

The current Nova copy uses she/her pronouns (`"She plans campaigns, reads performance…"`). The Alex and Mira beats avoid pronouns entirely and just repeat the name. For consistency with the rest of the marketing surface, **drop the pronoun** and rewrite as third-person-named:

- Old: `"Nova is your ad operator on shift. She plans campaigns, reads performance, spots budget leaks, prepares changes, and turns the next move into a reviewable draft."`
- New: `"Riley is your ad operator on shift — plans campaigns, reads performance, spots budget leaks, prepares changes, and turns the next move into a reviewable draft."`

The hero `head` copy for Nova (`"catches what you <em>miss</em>."`) still applies to Riley's value prop (catching waste in ad spend) and stays unchanged except agent key.

Job label stays `"ad optimizer"` / `"paid spend"` — these aren't agent-name-coupled.

---

## Task 1: Regression test — assert no Nova references in marketing surfaces

**Files:**

- Create: `apps/dashboard/src/components/landing/v6/__tests__/no-stale-agent-names.test.ts`

This test drives the rename. We write it first, watch it fail (because Nova is currently everywhere), and use the failure list to verify completeness as we work through the rename tasks.

- [ ] **Step 1.1: Write the regression test**

Create `apps/dashboard/src/components/landing/v6/__tests__/no-stale-agent-names.test.ts`:

```typescript
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const V6_DIR = join(__dirname, "..");
const PUBLIC_DIR = join(__dirname, "../../../..", "app", "(public)");

const sourceFiles = (): string[] => {
  const v6 = readdirSync(V6_DIR)
    .filter(
      (f) =>
        (f.endsWith(".tsx") || f.endsWith(".ts") || f.endsWith(".css")) && !f.includes(".test."),
    )
    .map((f) => join(V6_DIR, f));
  return [...v6, join(PUBLIC_DIR, "page.tsx"), join(PUBLIC_DIR, "layout.tsx")];
};

// Word-boundary regex so "innovate"/"renovation" don't false-positive.
const STALE_NAMES = [
  { pattern: /\bnova\b/i, name: "Nova", canonical: "Riley" },
  {
    pattern: /\bjordan\b/i,
    name: "Jordan",
    canonical: "(removed — Jordan was a stale agent name; use Alex/Riley/Mira)",
  },
];

describe("v6 landing — no stale agent names", () => {
  const files = sourceFiles();

  it("source file inventory is non-empty (smoke test)", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const stale of STALE_NAMES) {
    it(`pattern ${stale.pattern} is absent (was: ${stale.name}, canonical: ${stale.canonical})`, () => {
      const offenders: string[] = [];
      for (const path of files) {
        const content = readFileSync(path, "utf8");
        const lines = content.split("\n");
        lines.forEach((line, idx) => {
          if (stale.pattern.test(line)) {
            offenders.push(`${path}:${idx + 1} → ${line.trim()}`);
          }
        });
      }
      if (offenders.length > 0) {
        const message = `Stale agent name "${stale.name}" found in marketing surfaces:\n${offenders.join("\n")}\nCanonical replacement: ${stale.canonical}`;
        throw new Error(message);
      }
    });
  }
});
```

- [ ] **Step 1.2: Run the new test and confirm it fails**

```bash
pnpm --filter @switchboard/dashboard test -- no-stale-agent-names
```

Expected: the `\bnova\b` case FAILS with a long offender list across `agent-context.tsx`, `beat-nova.tsx`, `pricing.tsx`, `synergy.tsx`, `footer.tsx`, `control.tsx`, `agent-toggle.tsx`, `glyphs.tsx`, `landing-v6.css`, `page.tsx`, `layout.tsx`. The `\bjordan\b` case should PASS (no Jordan refs in marketing surfaces today).

**Capture the offender list.** This is the punch-list for the rename. The test will go green only after every Nova reference is updated.

- [ ] **Step 1.3: Commit the regression test**

```bash
git add apps/dashboard/src/components/landing/v6/__tests__/no-stale-agent-names.test.ts
git commit -m "test(dashboard): regression test asserting no stale agent names in marketing surfaces"
```

---

## Task 2: Rename type union and agent registry

**Files:**

- Modify: `apps/dashboard/src/components/landing/v6/agent-context.tsx`

This is the foundation — `AgentKey` type union changes from `"alex" | "nova" | "mira"` to `"alex" | "riley" | "mira"`. All downstream consumers (`agent-toggle.tsx`, `pricing.tsx`, `synergy.tsx` — which use the same string-literal union locally) will then surface TypeScript errors that we'll fix in subsequent tasks.

- [ ] **Step 2.1: Update the `AgentKey` type and `AGENTS` map**

Edit `apps/dashboard/src/components/landing/v6/agent-context.tsx`:

Change line 5:

```typescript
export type AgentKey = "alex" | "nova" | "mira";
```

to:

```typescript
export type AgentKey = "alex" | "riley" | "mira";
```

Change the `AGENTS` map (lines 26-31) from:

```typescript
  nova: {
    name: "Nova",
    head: 'catches what you <em class="text-v6-coral not-italic">miss</em>.',
    cta: "Nova",
    anchor: "#nova",
  },
```

to:

```typescript
  riley: {
    name: "Riley",
    head: 'catches what you <em class="text-v6-coral not-italic">miss</em>.',
    cta: "Riley",
    anchor: "#riley",
  },
```

Change line 40:

```typescript
const ORDER: AgentKey[] = ["alex", "nova", "mira"];
```

to:

```typescript
const ORDER: AgentKey[] = ["alex", "riley", "mira"];
```

Change line 62:

```typescript
      if (saved === "alex" || saved === "nova" || saved === "mira") {
```

to:

```typescript
      if (saved === "alex" || saved === "riley" || saved === "mira") {
```

**Note on localStorage**: the existing storage key is `switchboard.landing.agent.v1`. Visitors who previously saw the hero and had `"nova"` cached will fall through the validator on next visit and reset to the default `"alex"`. This is acceptable for a marketing site; no migration needed.

- [ ] **Step 2.2: Typecheck — expect downstream errors to surface**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: failures in `agent-toggle.tsx`, `pricing.tsx`, `synergy.tsx`, `beat-nova.tsx` referencing the now-removed `"nova"` member. These are exactly the next tasks.

---

## Task 3: Update `agent-toggle.tsx`

**Files:**

- Modify: `apps/dashboard/src/components/landing/v6/agent-toggle.tsx:7`

- [ ] **Step 3.1: Rename the Nova item**

Edit `apps/dashboard/src/components/landing/v6/agent-toggle.tsx`, change line 7:

```typescript
  { key: "nova", name: "Nova", job: "ad optimizer" },
```

to:

```typescript
  { key: "riley", name: "Riley", job: "ad optimizer" },
```

The dynamic glyph ref on line 44 (`<use href={`#mark-${it.key}`} />`) automatically follows once the glyph id is updated in Task 8.

---

## Task 4: Update `synergy.tsx`

**Files:**

- Modify: `apps/dashboard/src/components/landing/v6/synergy.tsx`

The FLOW array references Nova in two ways: as the recipient of Alex's signal (`line: "tells Nova"`), and as its own entry (`key: "nova"`, `name: "Nova"`). The body paragraph also names Nova directly.

- [ ] **Step 4.1: Update FLOW entries**

Edit `apps/dashboard/src/components/landing/v6/synergy.tsx`.

Change lines 4-15:

```typescript
const FLOW = [
  {
    key: "alex",
    name: "Alex",
    line: "tells Nova",
    payload: "which audiences converted",
  },
  {
    key: "nova",
    name: "Nova",
    line: "tells Mira",
    payload: "which angles to retire",
  },
```

to:

```typescript
const FLOW = [
  {
    key: "alex",
    name: "Alex",
    line: "tells Riley",
    payload: "which audiences converted",
  },
  {
    key: "riley",
    name: "Riley",
    line: "tells Mira",
    payload: "which angles to retire",
  },
```

- [ ] **Step 4.2: Update body paragraph**

In the same file, change line 61:

```typescript
              what Nova sees in spend, what Mira learns from creative reviews.{" "}
```

to:

```typescript
              what Riley sees in spend, what Mira learns from creative reviews.{" "}
```

The dynamic glyph ref on line 77 (`<use href={`#mark-${it.key}`} />`) follows the Task 8 glyph rename.

---

## Task 5: Update `pricing.tsx`

**Files:**

- Modify: `apps/dashboard/src/components/landing/v6/pricing.tsx`

- [ ] **Step 5.1: Update card type union and Nova card**

Edit `apps/dashboard/src/components/landing/v6/pricing.tsx`.

Change line 5:

```typescript
agent: "alex" | "nova" | "mira";
```

to:

```typescript
agent: "alex" | "riley" | "mira";
```

Change the Nova card (lines 31-40) from:

```typescript
  {
    agent: "nova",
    name: "Nova",
    job: "ad optimizer",
    price: "$249",
    subtitle: "Ad planning and optimization operator.",
    cta: "Start with Nova",
    ctaHref: "mailto:hello@switchboard.ai?subject=Start%20with%20Nova",
    featured: false,
  },
```

to:

```typescript
  {
    agent: "riley",
    name: "Riley",
    job: "ad optimizer",
    price: "$249",
    subtitle: "Ad planning and optimization operator.",
    cta: "Start with Riley",
    ctaHref: "mailto:hello@switchboard.ai?subject=Start%20with%20Riley",
    featured: false,
  },
```

---

## Task 6: Update `control.tsx`

**Files:**

- Modify: `apps/dashboard/src/components/landing/v6/control.tsx:34`

- [ ] **Step 6.1: Update copy**

Edit `apps/dashboard/src/components/landing/v6/control.tsx`, change line 34:

```typescript
      "Once a workflow is proven — Alex's first replies, Nova's draft pauses — graduate it to autonomous as the agent earns trust. You stay in control of the leash.",
```

to:

```typescript
      "Once a workflow is proven — Alex's first replies, Riley's draft pauses — graduate it to autonomous as the agent earns trust. You stay in control of the leash.",
```

---

## Task 7: Update `footer.tsx`

**Files:**

- Modify: `apps/dashboard/src/components/landing/v6/footer.tsx`

- [ ] **Step 7.1: Update desk description**

Edit `apps/dashboard/src/components/landing/v6/footer.tsx`, change lines 17-20:

```tsx
<span className="text-[0.8125rem] leading-[1.5] text-v6-graphite-2">
  Hire your revenue desk one agent at a time. Alex replies. Nova watches spend. Mira ships creative.
  They share context as they go.
</span>
```

to:

```tsx
<span className="text-[0.8125rem] leading-[1.5] text-v6-graphite-2">
  Hire your revenue desk one agent at a time. Alex replies. Riley watches spend. Mira ships
  creative. They share context as they go.
</span>
```

- [ ] **Step 7.2: Update anchor link**

In the same file, change line 25:

```tsx
<a href="#nova">Nova · ad optimizer</a>
```

to:

```tsx
<a href="#riley">Riley · ad optimizer</a>
```

---

## Task 8: Rename the glyph

**Files:**

- Modify: `apps/dashboard/src/components/landing/v6/glyphs.tsx:43-92`

This is a single SVG `<symbol>` id rename. All dynamic consumers (`agent-toggle`, `pricing`, `synergy`) build the ref via `#mark-${key}` and will pick this up automatically once their data has `key: "riley"`. Hard-coded `#mark-nova` refs in `beat-nova.tsx` (lines 274 and 323) are handled in Task 9 when that file is rewritten.

- [ ] **Step 8.1: Rename symbol id and update comment**

Edit `apps/dashboard/src/components/landing/v6/glyphs.tsx`.

Change line 43:

```tsx
{
  /* NOVA glyph: scope/signal — the watcher */
}
```

to:

```tsx
{
  /* RILEY glyph: scope/signal — the watcher */
}
```

Change line 44:

```tsx
        <symbol id="mark-nova" viewBox="0 0 48 48">
```

to:

```tsx
        <symbol id="mark-riley" viewBox="0 0 48 48">
```

The glyph SVG body (lines 45-91) stays unchanged — same scope/signal design, just attributed to Riley.

---

## Task 9: Rename `beat-nova.tsx` → `beat-riley.tsx`

**Files:**

- Rename: `apps/dashboard/src/components/landing/v6/beat-nova.tsx` → `apps/dashboard/src/components/landing/v6/beat-riley.tsx`
- Modify (within renamed file): component name, anchor id, copy, glyph refs

This is the largest single file change in the PR. Use `git mv` to preserve history.

- [ ] **Step 9.1: Move the file**

```bash
git mv apps/dashboard/src/components/landing/v6/beat-nova.tsx apps/dashboard/src/components/landing/v6/beat-riley.tsx
```

- [ ] **Step 9.2: Rename the component**

Edit `apps/dashboard/src/components/landing/v6/beat-riley.tsx`. Change line 87:

```typescript
export function V6BeatNova() {
```

to:

```typescript
export function V6BeatRiley() {
```

- [ ] **Step 9.3: Update section attributes**

Change line 90:

```tsx
id = "nova";
```

to:

```tsx
id = "riley";
```

Change line 91:

```tsx
      data-screen-label="04 Nova"
```

to:

```tsx
      data-screen-label="04 Riley"
```

- [ ] **Step 9.4: Update aria-labels**

Change line 99:

```tsx
          aria-label="What Nova does, end to end"
```

to:

```tsx
          aria-label="What Riley does, end to end"
```

- [ ] **Step 9.5: Update dashboard "drafting" status badge**

Change line 162:

```tsx
              Nova · drafting
```

to:

```tsx
              Riley · drafting
```

- [ ] **Step 9.6: Update Nova note block**

Change line 270 (comment):

```tsx
{
  /* Nova note */
}
```

to:

```tsx
{
  /* Riley note */
}
```

Change line 274 (hard-coded glyph ref):

```tsx
<use href="#mark-nova" />
```

to:

```tsx
<use href="#mark-riley" />
```

Change line 279:

```tsx
                Nova · 6:41am · draft
```

to:

```tsx
                Riley · 6:41am · draft
```

- [ ] **Step 9.7: Update screen-label band**

Change line 315:

```tsx
<span>a 02 / · nova · paid spend</span>
```

to:

```tsx
<span>a 02 / · riley · paid spend</span>
```

- [ ] **Step 9.8: Update second hard-coded glyph ref + agent caption**

Change line 323:

```tsx
<use href="#mark-nova" />
```

to:

```tsx
<use href="#mark-riley" />
```

Change line 326:

```tsx
                a 02 — Nova · paid spend
```

to:

```tsx
                a 02 — Riley · paid spend
```

- [ ] **Step 9.9: Update headline and body copy (drop she/her pronouns for consistency with Alex/Mira beats)**

Change line 336:

```tsx
                  Nova finds the waste and{" "}
```

to:

```tsx
                  Riley finds the waste and{" "}
```

Change lines 340-344:

```tsx
<p className="max-w-[26rem] text-[1.0625rem] leading-[1.5] text-v6-graphite-2">
  Nova is your ad operator on shift. She plans campaigns, reads performance, spots budget leaks,
  prepares changes, and turns the next move into a reviewable draft.{" "}
  <b className="font-medium text-v6-graphite">You approve what goes live.</b>
</p>
```

to:

```tsx
<p className="max-w-[26rem] text-[1.0625rem] leading-[1.5] text-v6-graphite-2">
  Riley is your ad operator on shift — plans campaigns, reads performance, spots budget leaks,
  prepares changes, and turns the next move into a reviewable draft.{" "}
  <b className="font-medium text-v6-graphite">You approve what goes live.</b>
</p>
```

- [ ] **Step 9.10: Update CTA copy**

Change line 350:

```tsx
                  Start with Nova
```

to:

```tsx
                  Start with Riley
```

---

## Task 10: Update `landing-v6.css` (comments only)

**Files:**

- Modify: `apps/dashboard/src/components/landing/v6/landing-v6.css:208,246`

The `.v6-nl-*` CSS class names (`v6-nl-step`, `v6-nl-num`, `v6-nl-detail`) are internal abbreviations ("nl" = Nova loop). Renaming them would require touching `beat-riley.tsx` selectors and CSS in lockstep, plus they're not user-visible. **Keep the class names as-is** — only the human-readable section comments need updating to stop saying "Nova".

- [ ] **Step 10.1: Update section comments**

Edit `apps/dashboard/src/components/landing/v6/landing-v6.css`.

Change line 208:

```css
/* ── NOVA loop step indicators ── */
```

to:

```css
/* ── BEAT loop step indicators (Riley dashboard) ── */
```

Change line 246:

```css
/* ── DASH pulse (Nova "drafting") ── */
```

to:

```css
/* ── DASH pulse (Riley "drafting") ── */
```

---

## Task 11: Update `app/(public)/page.tsx`

**Files:**

- Modify: `apps/dashboard/src/app/(public)/page.tsx`

- [ ] **Step 11.1: Update import**

Edit `apps/dashboard/src/app/(public)/page.tsx`. Change line 9:

```typescript
import { V6BeatNova } from "@/components/landing/v6/beat-nova";
```

to:

```typescript
import { V6BeatRiley } from "@/components/landing/v6/beat-riley";
```

- [ ] **Step 11.2: Update page-level metadata description**

In the same file, change lines 19-20:

```typescript
  description:
    "Hire your revenue desk one agent at a time. Alex replies. Nova watches spend. Mira ships creative. They share context as they go.",
```

to:

```typescript
  description:
    "Hire your revenue desk one agent at a time. Alex replies. Riley watches spend. Mira ships creative. They share context as they go.",
```

- [ ] **Step 11.3: Update JSX usage**

In the same file, change line 32:

```tsx
<V6BeatNova />
```

to:

```tsx
<V6BeatRiley />
```

---

## Task 12: Update `app/(public)/layout.tsx` SEO metadata

**Files:**

- Modify: `apps/dashboard/src/app/(public)/layout.tsx`

Three copies of the same description string exist for the base, OpenGraph, and Twitter metadata. Update all three.

- [ ] **Step 12.1: Update all three description copies**

Edit `apps/dashboard/src/app/(public)/layout.tsx`. The file has the same description on lines 6, 10, and 18. Use `replace_all`:

Replace every occurrence of:

```
Hire your revenue desk one agent at a time. Alex replies. Nova watches spend. Mira ships creative. They share context as they go.
```

with:

```
Hire your revenue desk one agent at a time. Alex replies. Riley watches spend. Mira ships creative. They share context as they go.
```

---

## Task 13: Update `no-banned-claims.test.ts` reason strings

**Files:**

- Modify: `apps/dashboard/src/components/landing/v6/__tests__/no-banned-claims.test.ts:50-51`

Two `reason` strings reference "Nova has no approval gate (slice B)". The reasons are documentation for the banned-pattern test — update them to refer to Riley so the rationale is still readable.

- [ ] **Step 13.1: Update reason strings**

Edit `apps/dashboard/src/components/landing/v6/__tests__/no-banned-claims.test.ts`.

Change lines 50-51:

```typescript
  { pattern: /moves money/, reason: "Nova has no approval gate (slice B)" },
  { pattern: /Never auto-publishes the big stuff/, reason: "Nova has no approval gate (slice B)" },
```

to:

```typescript
  { pattern: /moves money/, reason: "Riley has no approval gate (slice B)" },
  { pattern: /Never auto-publishes the big stuff/, reason: "Riley has no approval gate (slice B)" },
```

---

## Task 14: Verify — typecheck, lint, tests

- [ ] **Step 14.1: Run the regression test, expect green**

```bash
pnpm --filter @switchboard/dashboard test -- no-stale-agent-names
```

Expected: both `\bnova\b` and `\bjordan\b` patterns now PASS.

- [ ] **Step 14.2: Run typecheck**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: PASS, no errors.

- [ ] **Step 14.3: Run the full dashboard test suite**

```bash
pnpm --filter @switchboard/dashboard test
```

Expected: PASS. The `no-banned-claims.test.ts` regression test will pick up the reason-string changes and stay green; no test should be referencing `V6BeatNova` anywhere.

- [ ] **Step 14.4: Run lint**

```bash
pnpm --filter @switchboard/dashboard lint
```

Expected: PASS.

- [ ] **Step 14.5: Run the dashboard production build**

Per memory entry `feedback_dashboard_build_not_in_ci.md`: CI does NOT run `next build`. Run it locally for any Next code change so `.js`-extension regressions and other build-only failures don't slip through.

```bash
pnpm --filter @switchboard/dashboard build
```

Expected: build succeeds, no warnings about missing modules.

---

## Task 15: Visual verification in browser

This is a marketing-site change. Visual verification is part of "done" per CLAUDE.md: "For UI or frontend changes, start the dev server and use the feature in a browser before reporting the task as complete."

- [ ] **Step 15.1: Start the dashboard dev server**

```bash
pnpm --filter @switchboard/dashboard dev
```

Expected: dashboard up at `http://localhost:3002`.

- [ ] **Step 15.2: Visit the marketing page and verify**

Open `http://localhost:3002/` in a browser. Verify:

1. **Hero rotator** cycles Alex → Riley → Mira (no "Nova" appears in the rotation). Click the Riley toggle pill — hero copy updates to Riley.
2. **Synergy beat** reads "what Alex hears in chat, what **Riley** sees in spend, what Mira learns from creative reviews."
3. **Riley beat** (was beat-nova) renders correctly: section anchor `#riley`, glyph visible (the radar/scope mark), dashboard fragment headlines "**Riley** · drafting", note block signed "**Riley** · 6:41am · draft", body copy reads "**Riley** is your ad operator on shift…", CTA reads "Start with **Riley**".
4. **Pricing card** for Riley renders with the radar glyph, "Start with Riley" CTA, and the mailto link subject decodes to "Start with Riley".
5. **Footer** desk-list shows "Riley · ad optimizer" and clicking it scrolls to the Riley beat.
6. **Agent toggle** in the hero shows three pills: Alex / **Riley** / Mira; clicking Riley sets the localStorage key `switchboard.landing.agent.v1` to `"riley"` (verify via DevTools → Application → Local Storage).
7. **Page-level OG tags** — view source, confirm `<meta name="description">` and `<meta property="og:description">` mention Riley, not Nova.

- [ ] **Step 15.3: Check `prefers-reduced-motion`**

In DevTools, emulate `prefers-reduced-motion: reduce` and confirm the hero rotator still functions and the Riley beat still renders all content.

- [ ] **Step 15.4: Stop the dev server**

`Ctrl-C` in the terminal running `pnpm dev`.

---

## Task 16: Commit and open PR

- [ ] **Step 16.1: Stage everything and review**

```bash
git status --short
git diff --stat
```

Expected: ~12 files changed, 1 file renamed (beat-nova.tsx → beat-riley.tsx), 1 new file created (no-stale-agent-names.test.ts).

- [ ] **Step 16.2: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(dashboard): rename marketing-site Nova → Riley (E1a)

Reconciles public marketing surfaces with the canonical agent roster
Alex / Riley / Mira. Nova was a stale name; Riley is the locked
canonical for the paid-spend / ad-optimizer agent. Pure rename — no
copy redesign or behavior changes.

- Renames beat-nova.tsx → beat-riley.tsx + V6BeatNova → V6BeatRiley
- Updates AgentKey union, AGENTS map, ORDER, localStorage validator
- Renames #mark-nova glyph → #mark-riley
- Drops "she/her" pronouns in beat copy to match Alex/Mira voice
- Adds no-stale-agent-names.test.ts regression test asserting
  marketing surfaces never reintroduce "Nova" or "Jordan"

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 16.3: Push and open PR**

```bash
git push -u origin feat/e1a-nova-to-riley-rename
gh pr create --title "refactor(dashboard): rename marketing-site Nova → Riley (E1a)" --body "$(cat <<'EOF'
## Summary
- Renames Nova → Riley across the public marketing surfaces (`app/(public)` + `components/landing/v6`) to match the canonical agent roster Alex / Riley / Mira
- Adds `no-stale-agent-names.test.ts` regression test asserting marketing surfaces never reintroduce "Nova" or "Jordan"
- Pure rename — no copy redesign, no backend changes, no behavior change

This is PR-E1a of the Phase E (post-Phase-D) work. Out of scope and tracked separately:
- `packages/ad-optimizer/src/audit-runner.ts:514` runtime log line (surface-agnostic backend cleanup)
- `/agents/[slug]` slug-vs-canonical-key question (Open Question #4 from redesign roadmap)
- E2 onboarding reframe

## Test plan
- [ ] `pnpm --filter @switchboard/dashboard test` — all green, regression test confirms no Nova references
- [ ] `pnpm --filter @switchboard/dashboard typecheck` — green
- [ ] `pnpm --filter @switchboard/dashboard lint` — green
- [ ] `pnpm --filter @switchboard/dashboard build` — succeeds locally (not in CI)
- [ ] Visual: hero rotator cycles Alex → Riley → Mira; Riley beat renders with correct glyph, copy, CTA; footer desk-list links to `#riley`; OG metadata mentions Riley

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review checklist (run after plan is fully executed)

1. ✅ **Spec coverage**: Every Tier 1 file from the blast-radius survey has a task. (layout.tsx, page.tsx, beat-nova.tsx, agent-context.tsx, footer.tsx, pricing.tsx, synergy.tsx, agent-toggle.tsx, glyphs.tsx, control.tsx, landing-v6.css, no-banned-claims.test.ts — 12/12 covered.)
2. ✅ **No placeholders**: Every step shows the actual code/command/expected output.
3. ✅ **Type consistency**: `AgentKey` union value `"riley"` and the `AGENTS.riley` map key match across agent-context.tsx and downstream consumers; component name `V6BeatRiley` matches the import in page.tsx; glyph id `#mark-riley` matches both dynamic and hard-coded references.
4. ✅ **Regression coverage**: `no-stale-agent-names.test.ts` will fail in CI if anyone reintroduces "Nova" to marketing surfaces.
