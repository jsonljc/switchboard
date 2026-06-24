# Aesthetic-rehaul thread-3 polish — Implementation Plan (light, TDD)

> **For agentic workers:** execute via superpowers:subagent-driven-development (fresh subagent per task, RED proof, per-task review). Steps use `- [ ]` tracking.

**Goal:** Land the documented thread-3 polish follow-ups from the post-merge independent review of #1237: (1) restore the funnel desktop 2-col grid lost in the dedup, (2) delete the orphaned /reports CSS the dedup left behind, (3) resolve the funnel color-ramp design call.

**Architecture:** Pure dashboard CSS + test changes. One PR, two commits. The shared funnel widget (`components/reports-shared/funnel.module.css`) is consumed by BOTH /reports and /results; the orphaned CSS lives only in `app/(auth)/(mercury)/reports/reports.module.css`. No component logic, no schema, no governance, no send paths.

**Tech stack:** Next 14 (App Router), CSS Modules (vitest `css: false` → CSS asserted as source text), vitest.

## Global Constraints (verbatim, every task)

- Governed CSS: mono font-weight 400/500/600 only; NO `font-style: italic`; NO raw hex color literals (use tokens / `hsl(var(--x))`). `funnel.module.css` is governed (mercury-voiced, see its header).
- No em-dashes anywhere (copy, comments, commit, PR).
- Conventional Commits, lowercase subject.
- Dashboard coverage floor 40/35/40/40.
- Three-dot diffs vs origin/main. Branch: design/rehaul-thread3-polish. Worktree: .claude/worktrees/rehaul-thread3-polish.
- Ground-truth correction: the original /results 2-col funnel was at `@media (min-width: 1024px)` (NOT 768px as the memory note said). Use 1024px.

## Item 3 decision (no code) — DOCUMENTED

The old /reports funnel had a per-stage color ramp (`.funnelTable[data-i="0..4"] .fill` = `--ink` → `--ink-2` → `--ink-3` → `--accent-deep` → `--accent`) plus a `.funnelTable:hover` row tint. The thesis (`docs/superpowers/specs/2026-06-19-aesthetic-rehaul-thesis.md`) states: "amber (`--action`) is the ONLY action color. Agent hues are identity-only" and "flatness as the calm default." The original /results funnel was ALREADY uniform amber with no hover. DECISION: **accept uniform amber, no row hover, no code change.** Restoring a 5-color ramp would re-introduce the exact multi-color register fracture the thesis fights; a non-interactive hover is decoration the audit's motion-restraint work (PL-7) cut. The dedup brought /reports IN LINE with the more thesis-aligned /results treatment. Note this in the PR body.

---

### Task 1: restore funnel desktop 2-col grid (shared widget)

**Files:**

- Create: `apps/dashboard/src/components/reports-shared/__tests__/funnel-responsive-grid.test.ts`
- Modify: `apps/dashboard/src/components/reports-shared/funnel.module.css` (append at end, after line 109)

**Interfaces:** none (CSS + source-text test only).

- [ ] **Step 1: Write the failing test** — `funnel-responsive-grid.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// vitest runs with css: false, so we assert the CSS as source text.
// The shared funnel is a stacked list on mobile; on desktop (>=1024px, matching
// the original /results breakpoint) it must become a two-column grid. The #1237
// dedup dropped this rule, leaving the funnel single-column on desktop.
describe("shared funnel responsive grid", () => {
  it("upgrades .funnelRows to a 2-column grid at >=1024px", async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const css = await readFile(resolve(here, "../funnel.module.css"), "utf-8");

    // The desktop breakpoint exists.
    expect(css).toMatch(/@media\s*\(min-width:\s*1024px\)/);

    // Within it, .funnelRows becomes a 2-column grid.
    expect(css).toMatch(
      /@media\s*\(min-width:\s*1024px\)\s*\{[\s\S]*\.funnelRows\s*\{[\s\S]*grid-template-columns:\s*1fr\s+1fr/,
    );
  });
});
```

- [ ] **Step 2: Run test, verify RED**

Run: `pnpm --filter @switchboard/dashboard exec vitest run src/components/reports-shared/__tests__/funnel-responsive-grid.test.ts`
Expected: FAIL — no `@media (min-width: 1024px)` block in funnel.module.css yet.

- [ ] **Step 3: Add the rule** — append to `funnel.module.css`:

```css
/* Desktop: stacked list becomes a two-column grid (restores the /results
   behavior dropped in the #1237 dedup; both surfaces share this widget). */
@media (min-width: 1024px) {
  .funnelRows {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px 32px;
    align-items: start;
  }
}
```

- [ ] **Step 4: Run test, verify GREEN**

Run: same as Step 2 → PASS. Also run the existing shared-widgets test:
`pnpm --filter @switchboard/dashboard exec vitest run src/components/reports-shared/__tests__/shared-widgets.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/reports-shared/funnel.module.css \
        apps/dashboard/src/components/reports-shared/__tests__/funnel-responsive-grid.test.ts
git commit -m "fix(dashboard): restore funnel desktop 2-col grid lost in the reports/results dedup (thread-3 polish)"
```

---

### Task 2: delete orphaned reports CSS + down-scope the integrity allowlist

**Files:**

- Modify: `apps/dashboard/src/app/(auth)/(mercury)/reports/reports.module.css` (delete two contiguous blocks)
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/reports/__tests__/css-class-integrity.test.ts` (remove 26 entries from REQUIRED_CLASSES)

**Interfaces:** none. The reports funnel/managed-comparison/colophon components are now thin re-exports of the shared widgets (verified: `funnel.tsx`/`managed-comparison.tsx` re-export `@/components/reports-shared/*`; `colophon.tsx` wraps the shared one). The three families are referenced by ZERO `.tsx` files repo-wide; only reports.module.css + the integrity test reference them.

**Exact deletions (grep-verified contiguous regions):**

- Funnel family: lines **635-796** (`/* ===== Funnel ===== */` through the `@media (max-width: 520px)` block; includes `.funnel`, `.funnelTable` + `:hover` + `[data-i]` ramp, `.funnelStage`, `.funnelBar`, `.fill` + `::after`, `.funnelNum`, `.funnelDelta` + `.pos/.neg/.flat`, `.funnelByline`, `.marker` + `::before`, `.text`).
- Managed-comparison + colophon: lines **1147-1320** (`/* ===== Managed comparison ===== */` through `.mode.live .dot`; includes `.mcWrap/.mcGrid/.mcCol/.colEyebrow/.mcMetric/.mcSide/.managed/.unmanaged/.delta/.emptyMessage` and `.colophon/.period/.caveat/.mode/.live/.dot`). KEEP `.fadeIn` (1322+).
- DO NOT touch the standalone `.right` (260), `.label` (468), `.who` (547), `.desc` (476), `.cap` (594), `.em` (424), `.v` (campaigns/cost-vs-value), `.pos/.neg/.flat` (`.deltaBadge.*` at 502/507/511) — all survive and stay required.

**Exact 26 REQUIRED_CLASSES removals** (the RED test will list precisely these):
funnel(10): `funnel funnelTable funnelStage funnelBar fill funnelNum funnelDelta funnelByline marker text`
managed-comparison(10): `mcWrap mcGrid mcCol colEyebrow mcMetric mcSide managed unmanaged delta emptyMessage`
colophon(6): `colophon period caveat mode live dot`

- [ ] **Step 1: Delete the two CSS blocks** from `reports.module.css` (635-796 and 1147-1320, with surrounding blank-line tidy so no double blanks remain).

- [ ] **Step 2: Run the integrity test, verify RED with the expected 26**

Run: `pnpm --filter @switchboard/dashboard exec vitest run "src/app/(auth)/(mercury)/reports/__tests__/css-class-integrity.test.ts"`
Expected: FAIL — "Missing CSS class selectors: " listing EXACTLY the 26 classes above (verify the set matches; if it differs, STOP and reconcile — a mismatch means a region boundary was wrong).

- [ ] **Step 3: Down-scope REQUIRED_CLASSES** — remove exactly those 26 entries (and their `// funnel`, `// managed comparison`, `// colophon` group comments) from the array in `css-class-integrity.test.ts`.

- [ ] **Step 4: Run integrity + perf + full reports tests, verify GREEN**

Run:
`pnpm --filter @switchboard/dashboard exec vitest run "src/app/(auth)/(mercury)/reports"`
Expected: PASS (css-class-integrity green; css-no-perf-red-green green — it is an upper-bound `<=2` assertion and the colophon green was `hsl(150 ...)`, hue 150, not matched by its `1[34][0-9]` regex; all reports-page + component tests green since no component referenced the deleted classes).

- [ ] **Step 5: Commit**

```bash
git add "apps/dashboard/src/app/(auth)/(mercury)/reports/reports.module.css" \
        "apps/dashboard/src/app/(auth)/(mercury)/reports/__tests__/css-class-integrity.test.ts"
git commit -m "refactor(dashboard): drop orphaned reports funnel/managed-comparison/colophon css (thread-3 polish)"
```

---

## VERIFY (after both tasks)

- `pnpm --filter @switchboard/dashboard exec tsc --noEmit` (typecheck)
- `pnpm --filter @switchboard/dashboard test` (full dashboard vitest)
- `pnpm --filter @switchboard/dashboard exec next build` (CSS-module + .js-extension catch)
- `pnpm lint` ; `pnpm format:check` (covers .css + .tsx) ; `pnpm arch:check`
- `CI=1 npx tsx scripts/local-verify-fast.ts` (route/env allowlist + raw-status-color guard)
- `pnpm audit --audit-level=high` ; token-governance test
- `/reports` funnel fixture screenshot → confirm 2-col-both does not break /reports (data-gated /results noted honestly).
- Three-dot diff vs origin/main; independent fresh-context review; fix Critical/Important.

## Self-review notes

- Spec coverage: item 1 = Task 1; item 2 = Task 2; item 3 = documented decision (no code). All three review follow-ups covered.
- The RED for Task 2 is driven by an EXISTING guard (css-class-integrity), which is the intended pin; the expected-missing set is pre-computed (26) so a boundary error surfaces as a set mismatch.
- No placeholders; exact line ranges + exact class lists provided.
