# /activity rebuild — PR-B (filter strip) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shipped two-chip `filter-chips.tsx` with the editorial five-affordance filter strip (scope segment + Custom badge, banded event-type combobox, actor pills + helper line, date range, entity selector), wire `Clear filters` to preserve operator base scope, ensure any narrowing change resets `cursor` / `prevCursorStack` / `expandedId`, read URL params on mount + back/forward (no URL writes), and enforce H6 ("last ledger entry" tile hidden when narrowing is active).

**Architecture:** Filter state moves entirely into local page state. `ActivityPage` owns five mutually-orthogonal local state slices (scope, eventType, actorType, dateRange, entitySel); URL params are read on mount and re-synced on back/forward but never written. The new `FilterStrip` composes five small presentational components — each <120 lines — built directly from the locked design (`docs/design-prompts/locked/switchboard/project/activity-v2/{app.jsx,styles.css}`). `ActivityHeader` gains a `lastLedgerEntryHidden` flag (the page passes `true` whenever `appliedFilters` is non-empty); the existing `lastLedgerEntryIso` prop is preserved. The shipped `FilterChips` component and the `MercuryFilterChips` primitive consumer at `activity-page.tsx` are deleted along with the related CSS classes.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, CSS Modules, vitest + @testing-library/react + @testing-library/user-event, `AuditEntriesListQuery` / `OPERATIONAL_AUDIT_EVENT_TYPES` from `@switchboard/schemas`.

**Spec:** `docs/superpowers/specs/2026-05-13-activity-rebuild-design.md` (PR #448, on `main`). This plan implements the PR-B slice defined in §13.

**Hard invariants this PR introduces** (per spec §12): H6 (`last ledger entry` tile hidden when `appliedFilters` is non-empty). H1–H4 from PR-A remain in force; H5 lands in PR-C.

---

## File structure

PR-B adds the new filter-strip components, integrates them into `ActivityPage`, refactors `ActivityHeader` for H6, deletes `filter-chips.tsx`, extends `activity.module.css` with the locked editorial filter-strip styles, and folds two PR-A code-review carry-overs into the CSS module.

**New files**

| Path                                                                                                 | Responsibility                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/components/scope-segment.tsx`                      | TWO buttons (Operational / All) with page-local counts; adjacent `· Custom` status badge with amber dot when `effectiveScope === "custom"`. Badge has no click handler, no `role="button"`, and is `aria-hidden`.                               |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/components/actor-pills.tsx`                        | Four mutually-exclusive toggles (User / Agent / System / Service) with `· N on this page` counts and a muted helper line about specific-actor filtering.                                                                                        |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/components/date-range.tsx`                         | Two `<input type="date">` in a hairline group with `after` / `before` eyebrow labels, shared `×` clear button.                                                                                                                                  |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/components/entity-selector.tsx`                    | `<select>` (entity types derived from the loaded page, sorted) + freeform id `<input>`.                                                                                                                                                         |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/components/event-type-combobox.tsx`                | Simplified v1 banded combobox. Input opens a popover list grouped by band (non-sticky headers). Type-to-filter via substring match; `↑/↓` move highlight, Enter selects, Esc closes, `×` clears. Each option carries `· N on this page` suffix. |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/components/filter-strip.tsx`                       | Composes the five filter affordances, renders the right-aligned `Clear filters` pill (only when narrowing is active), and the small `limit 50 · cursor head` meta indicator.                                                                    |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/components/__tests__/scope-segment.test.tsx`       | Component tests for §12 / §5.2: badge presence + non-clickability + `aria-hidden`.                                                                                                                                                              |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/components/__tests__/actor-pills.test.tsx`         | Mutual exclusion + helper line + count suffix tests.                                                                                                                                                                                            |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/components/__tests__/date-range.test.tsx`          | ISO output + shared `×` clear test.                                                                                                                                                                                                             |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/components/__tests__/entity-selector.test.tsx`     | Type/id independence + dynamic type list test.                                                                                                                                                                                                  |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/components/__tests__/event-type-combobox.test.tsx` | Grouped band render when empty; flat filtered render when typing; keyboard nav; ×-to-clear; count suffix.                                                                                                                                       |

**Modified files**

| Path                                                                                          | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/activity-page.tsx`                          | Replace `FilterChips` with `FilterStrip`. Lift narrowing into local React state. Read URL params on mount and on back/forward (no URL writes). Pass `lastLedgerEntryHidden` to `ActivityHeader` when narrowing is active (H6). Wire `Clear filters` to preserve operator scope.                                                                                                                                                                                                                                                                                          |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/components/header.tsx`                      | Accept new optional `lastLedgerEntryHidden` boolean prop; hide the stat tile when set, even if `lastLedgerEntryIso` is non-null.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/__tests__/activity-page.test.tsx`           | Update existing tests to assert against the new strip (scope-segment buttons, Clear filters pill, Custom badge). Add tests for: H6 tile hide, filter-signature reset clears `expandedId`, URL-param read on mount, `Clear filters` preserves scope (operational AND all).                                                                                                                                                                                                                                                                                                |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/components/__tests__/header.test.tsx`       | Add test: `lastLedgerEntryHidden={true}` hides the tile even when `lastLedgerEntryIso` is provided.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/components/__tests__/activity-row.test.tsx` | Add test for new `actorGlyph[data-actor="agent"]` amber treatment (PR-A code-review carry-over).                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/activity.module.css`                        | Add the editorial filter-strip CSS block (`.filterStrip`, `.scopeSegment` + buttons + custom mark, `.combo*`, `.actorPill*`, `.dateRange*`, `.entityPick*`, `.filterClear`, `.filterMeta`, etc.). Add `.actorGlyph[data-actor="agent"]` amber-treatment rule (carry-over). Remove the duplicate `.chevronButton` declaration at the bottom of the file that clobbers the v1 padding — restore `padding: 4px 6px` (carry-over). Delete the `.filteredPill / .filteredLabel / .filteredDot / .filteredClear` classes (only the deleted `FilterChips` component used them). |

**Deleted files**

| Path                                                                               | Reason                           |
| ---------------------------------------------------------------------------------- | -------------------------------- |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/components/filter-chips.tsx`     | Replaced by `filter-strip.tsx`.  |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/__tests__/filter-chips.test.tsx` | Test file for deleted component. |

`MercuryFilterChips` at `apps/dashboard/src/components/mercury/filter-chips/` is NOT deleted; spec §3 keeps it in use by `/contacts` and `/automations` until a separate cleanup PR.

**Files left alone in PR-B**

- `apps/dashboard/src/app/(auth)/(mercury)/activity/hooks/use-activity-list.ts` — backend-frozen.
- `apps/dashboard/src/app/(auth)/(mercury)/activity/page.tsx` — server entry; unchanged.
- `apps/dashboard/src/app/(auth)/(mercury)/activity/fixtures.ts` / `fixtures.data.ts` — PR-A already shipped the 30-row v2 distribution.
- `apps/dashboard/src/app/(auth)/(mercury)/activity/components/activity-row.tsx`, `activity-row-drawer.tsx`, `activity-table.tsx`, `format.ts` — PR-A landed these. Tests in `__tests__/` for these continue to pass; row test gets one new assertion for the agent glyph amber rule.
- `apps/dashboard/src/app/(auth)/(mercury)/activity/components/empty-state.tsx`, `pagination-footer.tsx` — PR-C touches.

---

## Workflow

Per CLAUDE.md doctrine:

1. **Plan PR first.** Write this plan, commit on a fresh branch `docs/activity-rebuild-pr-b-plan` off `main`, push, open PR to `main`, merge once approved. The plan must exist on `main` before implementation starts.
2. **Implementation worktree.** From the main checkout, after the plan PR merges:
   ```bash
   git fetch origin main
   git worktree add .worktrees/activity-rebuild-pr-b -b feat/activity-rebuild-pr-b-filter-strip origin/main
   cd .worktrees/activity-rebuild-pr-b
   pnpm worktree:init
   pnpm install   # if not already installed via worktree:init
   ```
3. **Verify the spec and plan are present on this branch:**
   ```bash
   ls docs/superpowers/specs/2026-05-13-activity-rebuild-design.md
   ls docs/superpowers/plans/2026-05-14-activity-rebuild-pr-b-filter-strip.md
   ```
4. **Commit cadence:** one commit per task (TDD red → green → commit). Conventional Commits required by commitlint.
5. **Verification before claiming complete:** every task that touches a `.test.tsx` file runs the targeted test; the final task runs the full dashboard test suite, `pnpm typecheck`, and `pnpm --filter @switchboard/dashboard build` (next build is not in CI — see `memory/feedback_dashboard_build_not_in_ci.md`).
6. **Local test runs:** prefix `TZ=UTC` for any test that asserts formatted clock output (`fmtClock` / `fmtFullISO`). PR-A wasted a cycle on this.
7. **ESM `.js` extensions:** dashboard PRODUCTION files (`apps/dashboard/src/...`) do NOT use `.js` on relative imports. TEST files DO use `.js`. This matches the existing codebase convention.
8. **No `console.log`, no `any`, no unused-var without `_` prefix.** Per CLAUDE.md.

---

## Conventions used in this plan

- All file paths use the literal escaped form when invoking shell tools so the `(auth)/(mercury)` parens parse cleanly. In prose I show them unescaped.
- Code blocks show the **final** state of each file after the task's step is applied, not a diff. The engineer can copy-paste the whole block.
- Test names match the spec acceptance numbering where applicable.

---

### Task 1: Extend `activity.module.css` with filter-strip + carry-over fixes

**Files:**

- Modify: `apps/dashboard/src/app/(auth)/(mercury)/activity/activity.module.css`

The locked design's filter-strip CSS uses kebab-case classes (`.filterstrip`, `.scope-seg`, etc.). CSS Modules in this codebase use camelCase (every existing class in `activity.module.css` does). We port the locked classes verbatim in shape but with camelCase names: `.filterStrip`, `.filterStripRow`, `.scopeSegment`, `.scopeSegmentBtn`, `.scopeSegmentCount`, `.scopeSegmentBtnOn`, `.customBadge`, `.customDot`, `.combo`, `.comboInput`, `.comboCaret`, `.comboClear`, `.comboPop`, `.comboBand`, `.comboOpt`, `.comboOptSelected`, `.comboOptCount`, `.comboEmpty`, `.actorGroup`, `.actorPill`, `.actorPillOn`, `.actorPillCount`, `.actorHelper`, `.dateRange`, `.dateRangeSeg`, `.dateRangeLabel`, `.dateRangeInput`, `.dateRangeClear`, `.entityPick`, `.entityPickSelect`, `.entityPickInput`, `.filterClear`, `.filterMeta`, `.filterSpacer`.

This task is CSS-only — no failing test to write up front. The component tasks (2–7) will fail until these classes exist, which is the gate-driven equivalent of a red test for CSS modules.

- [ ] **Step 1: Append the filter-strip block to `activity.module.css`**

Before the `/* Activity v2 row scaffolding */` block near the bottom of the file, append the editorial filter-strip block. Use the locked design's `styles.css` lines 188–428 as the visual contract, retypewriting class names to camelCase and substituting `var(--font-mono, ui-monospace, monospace)` for `var(--font-mono)` (consistent with the row scaffolding already in this module). The block:

```css
/* ============= editorial filter strip (PR-B) ============= */
.filterStrip {
  position: sticky;
  top: 0;
  z-index: 20;
  background: var(--paper);
  border-top: 1px solid var(--hair);
  border-bottom: 1px solid var(--hair);
  margin-bottom: 16px;
}
.filterStripRow {
  max-width: var(--col-wide);
  margin: 0 auto;
  padding: 14px 0;
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.filterStripRow + .filterStripRow {
  padding-top: 0;
}
.filterStripEyebrow {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--ink-4);
  margin-right: 2px;
}

/* scope segment */
.scopeSegment {
  display: inline-flex;
  align-items: stretch;
  border: 1px solid var(--hair-strong);
  border-radius: 2px;
  background: var(--paper-raised);
  overflow: hidden;
}
.scopeSegmentBtn {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--ink-3);
  padding: 7px 14px;
  border: none;
  background: transparent;
  border-right: 1px solid var(--hair);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  white-space: nowrap;
  transition:
    color 0.18s ease,
    background 0.18s ease;
}
.scopeSegmentBtn:last-child {
  border-right: none;
}
.scopeSegmentBtn:hover {
  color: var(--ink);
  background: rgba(14, 12, 10, 0.03);
}
.scopeSegmentBtnOn {
  background: var(--ink);
  color: var(--paper);
}
.scopeSegmentBtnOn:hover {
  color: var(--paper);
  background: var(--ink);
}
.scopeSegmentCount {
  font-size: 10px;
  letter-spacing: 0.06em;
  color: var(--ink-4);
  font-weight: 600;
}
.scopeSegmentBtnOn .scopeSegmentCount {
  color: var(--paper);
  opacity: 0.7;
}
.customBadge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 10.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-weight: 600;
  color: var(--ink-3);
  padding: 0 6px;
}
.customDot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--amber);
  display: inline-block;
}

/* combobox (event type) */
.combo {
  position: relative;
  min-width: 18rem;
}
.comboInput {
  width: 100%;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11.5px;
  letter-spacing: 0.04em;
  color: var(--ink);
  padding: 8px 32px 8px 12px;
  background: var(--paper-raised);
  border: 1px solid var(--hair-strong);
  border-radius: 2px;
  outline: none;
  transition: border-color 0.18s ease;
}
.comboInput::placeholder {
  color: var(--ink-4);
}
.comboInput:focus {
  border-color: var(--ink);
}
.comboCaret {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 10px;
  color: var(--ink-4);
  pointer-events: none;
}
.comboClear {
  position: absolute;
  right: 22px;
  top: 50%;
  transform: translateY(-50%);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 14px;
  color: var(--ink-4);
  padding: 0 4px;
  line-height: 1;
  background: transparent;
  border: none;
  cursor: pointer;
}
.comboClear:hover {
  color: var(--ink);
}
.comboPop {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: var(--paper-raised);
  border: 1px solid var(--hair-strong);
  border-radius: 2px;
  box-shadow: 0 8px 24px rgba(14, 12, 10, 0.08);
  max-height: 22rem;
  overflow: auto;
  z-index: 50;
}
.comboBand {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ink-4);
  padding: 10px 14px 6px;
  border-bottom: 1px dashed var(--hair);
  background: var(--paper-warm);
}
.comboOpt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 14px;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11.5px;
  letter-spacing: 0.04em;
  color: var(--ink);
  width: 100%;
  border: none;
  background: transparent;
  border-bottom: 1px dashed var(--hair-soft);
  cursor: pointer;
  text-align: left;
}
.comboOpt:hover,
.comboOptActive {
  background: rgba(14, 12, 10, 0.04);
}
.comboOptSelected {
  background: var(--amber-paper);
}
.comboOptCount {
  color: var(--ink-4);
  font-size: 10.5px;
}
.comboEmpty {
  padding: 14px;
  color: var(--ink-4);
  font-family: var(--sans);
  font-size: 13px;
  font-style: italic;
}

/* actor pills */
.actorGroup {
  display: inline-flex;
  align-items: stretch;
  gap: 6px;
}
.actorPill {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 10.5px;
  letter-spacing: 0.12em;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--ink-3);
  padding: 6px 12px;
  border: 1px solid var(--hair-strong);
  border-radius: 999px;
  background: var(--paper-raised);
  display: inline-flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
  transition:
    color 0.18s ease,
    border-color 0.18s ease,
    background 0.18s ease;
}
.actorPill:hover {
  color: var(--ink);
  border-color: var(--ink-3);
}
.actorPillOn {
  color: var(--paper);
  background: var(--ink);
  border-color: var(--ink);
}
.actorPillCount {
  font-size: 10px;
  opacity: 0.7;
  font-weight: 600;
}
.actorHelper {
  width: 100%;
  font-family: var(--sans);
  font-size: 12px;
  color: var(--ink-4);
  margin-top: -6px;
  padding-left: 2px;
}

/* date range */
.dateRange {
  display: inline-flex;
  align-items: stretch;
  border: 1px solid var(--hair-strong);
  border-radius: 2px;
  background: var(--paper-raised);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  letter-spacing: 0.03em;
}
.dateRangeSeg {
  padding: 7px 10px;
  color: var(--ink-2);
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border-right: 1px solid var(--hair);
}
.dateRangeSeg:last-child {
  border-right: none;
}
.dateRangeLabel {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ink-4);
}
.dateRangeInput {
  background: transparent;
  border: none;
  outline: none;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  color: var(--ink);
  width: 7.5rem;
  padding: 0;
}
.dateRangeClear {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12px;
  color: var(--ink-4);
  padding: 0 4px;
  background: transparent;
  border: none;
  cursor: pointer;
}
.dateRangeClear:hover {
  color: var(--ink);
}

/* entity selector */
.entityPick {
  display: inline-flex;
  align-items: stretch;
  border: 1px solid var(--hair-strong);
  border-radius: 2px;
  background: var(--paper-raised);
}
.entityPickSelect {
  appearance: none;
  background: transparent;
  border: none;
  outline: none;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--ink-2);
  padding: 7px 24px 7px 10px;
  border-right: 1px solid var(--hair);
  background-image:
    linear-gradient(45deg, transparent 50%, var(--ink-4) 50%),
    linear-gradient(135deg, var(--ink-4) 50%, transparent 50%);
  background-position:
    calc(100% - 14px) 50%,
    calc(100% - 10px) 50%;
  background-size:
    4px 4px,
    4px 4px;
  background-repeat: no-repeat;
}
.entityPickInput {
  background: transparent;
  border: none;
  outline: none;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  color: var(--ink);
  padding: 7px 10px;
  width: 8.5rem;
}
.entityPickInput::placeholder {
  color: var(--ink-4);
}

.filterClear {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 10.5px;
  letter-spacing: 0.14em;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--ink);
  padding: 6px 12px;
  border: 1px dashed var(--ink-3);
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
  transition:
    color 0.18s ease,
    background 0.18s ease,
    border-color 0.18s ease;
}
.filterClear:hover {
  background: var(--ink);
  color: var(--paper);
  border-color: var(--ink);
}
.filterSpacer {
  flex: 1;
}
.filterMeta {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  color: var(--ink-4);
  letter-spacing: 0.04em;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.filterMeta b {
  color: var(--ink-2);
  font-weight: 600;
}
```

- [ ] **Step 2: Add the `.actorGlyph[data-actor="agent"]` amber-treatment rule (PR-A carry-over)**

Spec §10 #6 calls for amber treatment on the agent glyph. Append immediately after the existing `.actorGlyph` rule near the bottom of the file:

```css
.actorGlyph[data-actor="agent"] {
  background: var(--amber-paper);
  border-color: var(--amber);
  color: var(--amber-deep);
}
```

- [ ] **Step 3: Restore `.chevronButton` padding (PR-A carry-over)**

The file currently has TWO `.chevronButton` declarations. The first (lines 612–630, the v1 declaration) has `padding: 4px 6px`. The second (line 876, in the v2 row scaffolding block) sets `padding: 0` and clobbers it, shrinking the click target to ~18×18.

Delete the second declaration entirely:

```css
.chevronButton {
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
}
```

The v1 declaration (lines 612–630) becomes the canonical one. Verify the remaining declaration includes `padding: 4px 6px`; if not, set it.

- [ ] **Step 4: Delete the `.filteredPill / .filteredLabel / .filteredDot / .filteredClear` block**

These classes are only used by `filter-chips.tsx`, which Task 9 removes. Delete the four class declarations starting at `.filteredPill {` (around line 510). The whole filtered-pill block (≈40 lines) is dropped.

- [ ] **Step 5: Sanity-check the file size**

```bash
wc -l apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/activity.module.css
```

Expected: stays well under 600 lines after the net add (filter-strip block adds ~290, filtered-pill block subtracts ~40, duplicate chevron rule subtracts ~1).

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/activity.module.css
git commit -m "style(dashboard): activity filter-strip CSS + PR-A carry-overs"
```

---

### Task 2: `scope-segment.tsx` — TWO buttons + Custom badge

**Files:**

- Create: `apps/dashboard/src/app/(auth)/(mercury)/activity/components/scope-segment.tsx`
- Create: `apps/dashboard/src/app/(auth)/(mercury)/activity/components/__tests__/scope-segment.test.tsx`

Two-button segmented control plus a non-clickable `· Custom` status badge with amber dot. Spec §5.2 + §2.3 + §12 acceptance #1.

- [ ] **Step 1: Write the failing tests**

Create `components/__tests__/scope-segment.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScopeSegment } from "../scope-segment.js";

describe("ScopeSegment", () => {
  it("renders Operational and All buttons with counts", () => {
    render(
      <ScopeSegment
        effectiveScope="operational"
        baseScope="operational"
        operationalCount={22}
        allCount={30}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /Operational/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /All/ })).toBeInTheDocument();
    expect(screen.getByText("22")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
  });

  it("highlights the base scope button via aria-pressed (not the effective scope)", () => {
    render(
      <ScopeSegment
        effectiveScope="custom"
        baseScope="all"
        operationalCount={22}
        allCount={30}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /All/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Operational/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("does NOT render the Custom badge when effectiveScope is operational", () => {
    render(
      <ScopeSegment
        effectiveScope="operational"
        baseScope="operational"
        operationalCount={0}
        allCount={0}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByText(/Custom/)).toBeNull();
  });

  it("does NOT render the Custom badge when effectiveScope is all", () => {
    render(
      <ScopeSegment
        effectiveScope="all"
        baseScope="all"
        operationalCount={0}
        allCount={0}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByText(/Custom/)).toBeNull();
  });

  it("renders the Custom badge with an amber dot when effectiveScope is custom", () => {
    const { container } = render(
      <ScopeSegment
        effectiveScope="custom"
        baseScope="operational"
        operationalCount={0}
        allCount={0}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText(/Custom/)).toBeInTheDocument();
    // The dot lives in a span that's hidden from AT; assert it exists in the DOM.
    expect(container.querySelector("[data-testid='custom-dot']")).toBeInTheDocument();
  });

  it("Custom badge has no click handler, no role='button', and is aria-hidden", () => {
    render(
      <ScopeSegment
        effectiveScope="custom"
        baseScope="operational"
        operationalCount={0}
        allCount={0}
        onChange={() => {}}
      />,
    );
    const badge = screen.getByText(/Custom/);
    expect(badge.tagName).toBe("SPAN");
    expect(badge.closest("button")).toBeNull();
    // The badge wrapper should be aria-hidden.
    const wrapper = badge.closest("[aria-hidden='true']");
    expect(wrapper).not.toBeNull();
  });

  it("fires onChange('operational') when the Operational button is clicked", async () => {
    const onChange = vi.fn();
    render(
      <ScopeSegment
        effectiveScope="all"
        baseScope="all"
        operationalCount={0}
        allCount={0}
        onChange={onChange}
      />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: /Operational/ }));
    expect(onChange).toHaveBeenCalledWith("operational");
  });

  it("fires onChange('all') when the All button is clicked", async () => {
    const onChange = vi.fn();
    render(
      <ScopeSegment
        effectiveScope="operational"
        baseScope="operational"
        operationalCount={0}
        allCount={0}
        onChange={onChange}
      />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: /All/ }));
    expect(onChange).toHaveBeenCalledWith("all");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/dashboard test scope-segment.test.tsx
```

Expected: fails with "Cannot find module '../scope-segment.js'".

- [ ] **Step 3: Implement `scope-segment.tsx`**

Create `components/scope-segment.tsx`:

```tsx
"use client";

import styles from "../activity.module.css";

export type ScopeBase = "operational" | "all";
export type EffectiveScope = ScopeBase | "custom";

export interface ScopeSegmentProps {
  /** The server-derived effective scope. "custom" when any narrowing is active. */
  effectiveScope: EffectiveScope;
  /** The operator's base scope choice (Operational or All). Drives aria-pressed. */
  baseScope: ScopeBase;
  /** Page-local count for the Operational scope (operational rows on this page). */
  operationalCount: number;
  /** Page-local count for the All scope (all rows on this page). */
  allCount: number;
  /** Fired when the operator clicks one of the two real buttons. */
  onChange: (next: ScopeBase) => void;
}

/**
 * Two-button hairline segmented control + inline `· Custom` status badge.
 *
 * Spec §5.2 + §2.3: the badge is server-auto-derived from `appliedFilters`
 * non-emptiness. It is NOT a button — no click handler, no role="button",
 * aria-hidden so screen readers don't try to announce it (the narrowing
 * affordances below already announce active filters).
 *
 * The active highlight (aria-pressed + .scopeSegmentBtnOn) follows the
 * operator's underlying base scope, not the effective scope — so the chip
 * group reads as "Operational, plus narrowing" rather than "Custom alone".
 */
export function ScopeSegment({
  effectiveScope,
  baseScope,
  operationalCount,
  allCount,
  onChange,
}: ScopeSegmentProps) {
  return (
    <>
      <span className={styles.filterStripEyebrow}>scope</span>
      <div className={styles.scopeSegment} role="group" aria-label="Activity scope">
        <button
          type="button"
          className={
            baseScope === "operational"
              ? `${styles.scopeSegmentBtn} ${styles.scopeSegmentBtnOn}`
              : styles.scopeSegmentBtn
          }
          aria-pressed={baseScope === "operational"}
          onClick={() => onChange("operational")}
        >
          Operational
          <span className={styles.scopeSegmentCount}>{operationalCount}</span>
        </button>
        <button
          type="button"
          className={
            baseScope === "all"
              ? `${styles.scopeSegmentBtn} ${styles.scopeSegmentBtnOn}`
              : styles.scopeSegmentBtn
          }
          aria-pressed={baseScope === "all"}
          onClick={() => onChange("all")}
        >
          All
          <span className={styles.scopeSegmentCount}>{allCount}</span>
        </button>
      </div>
      {effectiveScope === "custom" && (
        <span className={styles.customBadge} aria-hidden="true">
          <span data-testid="custom-dot" className={styles.customDot} />· Custom
        </span>
      )}
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/dashboard test scope-segment.test.tsx
```

Expected: all 8 assertions pass.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/scope-segment.tsx \
        apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/__tests__/scope-segment.test.tsx
git commit -m "feat(dashboard): activity scope-segment (TWO buttons + Custom badge)"
```

---

### Task 3: `actor-pills.tsx` — four mutually-exclusive toggles + helper line

**Files:**

- Create: `apps/dashboard/src/app/(auth)/(mercury)/activity/components/actor-pills.tsx`
- Create: `apps/dashboard/src/app/(auth)/(mercury)/activity/components/__tests__/actor-pills.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `components/__tests__/actor-pills.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActorPills } from "../actor-pills.js";

const COUNTS = { user: 5, agent: 12, system: 7, service_account: 3 };

describe("ActorPills", () => {
  it("renders four pills with `· N on this page` suffix counts", () => {
    render(<ActorPills value={null} counts={COUNTS} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /User/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Agent/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /System/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Service/ })).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("renders the muted helper line about specific-actor filtering", () => {
    render(<ActorPills value={null} counts={COUNTS} onChange={() => {}} />);
    expect(
      screen.getByText(/Specific actor filtering \(e\.g\. just Alex\) is not yet available/),
    ).toBeInTheDocument();
  });

  it("the active pill carries aria-pressed=true", () => {
    render(<ActorPills value="agent" counts={COUNTS} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /Agent/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /User/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("clicking an inactive pill fires onChange with the new actor type (mutual exclusion)", async () => {
    const onChange = vi.fn();
    render(<ActorPills value="agent" counts={COUNTS} onChange={onChange} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /User/ }));
    expect(onChange).toHaveBeenCalledWith("user");
  });

  it("clicking the active pill deselects (fires onChange with null)", async () => {
    const onChange = vi.fn();
    render(<ActorPills value="agent" counts={COUNTS} onChange={onChange} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /Agent/ }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/dashboard test actor-pills.test.tsx
```

Expected: module-not-found.

- [ ] **Step 3: Implement `actor-pills.tsx`**

Create `components/actor-pills.tsx`:

```tsx
"use client";

import type { AuditEntryBrowseRow } from "@switchboard/schemas";
import styles from "../activity.module.css";

export type ActorType = AuditEntryBrowseRow["actorType"];

export interface ActorPillsProps {
  /** Active actor type filter (null = no selection). */
  value: ActorType | null;
  /** Page-local counts keyed by actor type. */
  counts: Record<ActorType, number>;
  /** Mutual exclusion: click active to deselect (null). */
  onChange: (next: ActorType | null) => void;
}

const ORDER: ReadonlyArray<{ key: ActorType; label: string }> = [
  { key: "user", label: "User" },
  { key: "agent", label: "Agent" },
  { key: "system", label: "System" },
  { key: "service_account", label: "Service" },
];

/**
 * Four mutually-exclusive actor-type pills + helper line.
 *
 * Spec §5.2: each pill carries `· N on this page` suffix; the muted helper line
 * below the pills sets expectation that specific-actor filtering (e.g. just
 * Alex) is unavailable — see spec §1.2 for why.
 */
export function ActorPills({ value, counts, onChange }: ActorPillsProps) {
  return (
    <>
      <span className={styles.filterStripEyebrow}>actor</span>
      <div className={styles.actorGroup} role="group" aria-label="Actor type">
        {ORDER.map(({ key, label }) => {
          const active = value === key;
          return (
            <button
              type="button"
              key={key}
              className={active ? `${styles.actorPill} ${styles.actorPillOn}` : styles.actorPill}
              aria-pressed={active}
              onClick={() => onChange(active ? null : key)}
            >
              {label}
              <span className={styles.actorPillCount}>{counts[key] ?? 0}</span>
            </button>
          );
        })}
      </div>
      <p className={styles.actorHelper}>
        Specific actor filtering (e.g. just Alex) is not yet available — see §1.2.
      </p>
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/dashboard test actor-pills.test.tsx
```

Expected: all 5 assertions pass.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/actor-pills.tsx \
        apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/__tests__/actor-pills.test.tsx
git commit -m "feat(dashboard): activity actor-pills (mutually exclusive + helper line)"
```

---

### Task 4: `date-range.tsx` — after / before date inputs with shared clear

**Files:**

- Create: `apps/dashboard/src/app/(auth)/(mercury)/activity/components/date-range.tsx`
- Create: `apps/dashboard/src/app/(auth)/(mercury)/activity/components/__tests__/date-range.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `components/__tests__/date-range.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateRange } from "../date-range.js";

describe("DateRange", () => {
  it("renders two date inputs with after/before eyebrow labels", () => {
    render(<DateRange after={null} before={null} onChange={() => {}} />);
    expect(screen.getByText(/after/)).toBeInTheDocument();
    expect(screen.getByText(/before/)).toBeInTheDocument();
    const inputs = screen.getAllByLabelText(/(after|before)/i);
    expect(inputs).toHaveLength(2);
    inputs.forEach((el) => {
      expect((el as HTMLInputElement).type).toBe("date");
    });
  });

  it("typing into `after` fires onChange with the ISO string and preserves `before`", async () => {
    const onChange = vi.fn();
    render(<DateRange after={null} before="2026-05-09" onChange={onChange} />);
    const afterInput = screen.getByLabelText(/after/i) as HTMLInputElement;
    // userEvent.type with a date input has cross-browser quirks; use fireEvent.
    afterInput.focus();
    afterInput.value = "2026-05-01";
    afterInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onChange).toHaveBeenCalledWith({ after: "2026-05-01", before: "2026-05-09" });
  });

  it("`×` clear button does NOT render when neither date is set", () => {
    render(<DateRange after={null} before={null} onChange={() => {}} />);
    expect(screen.queryByRole("button", { name: /clear dates/i })).toBeNull();
  });

  it("`×` clear button renders when at least one date is set; clicking clears both", async () => {
    const onChange = vi.fn();
    render(<DateRange after="2026-05-01" before="2026-05-09" onChange={onChange} />);
    const clearBtn = screen.getByRole("button", { name: /clear dates/i });
    expect(clearBtn).toBeInTheDocument();
    await userEvent.setup().click(clearBtn);
    expect(onChange).toHaveBeenCalledWith({ after: null, before: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/dashboard test date-range.test.tsx
```

Expected: module-not-found.

- [ ] **Step 3: Implement `date-range.tsx`**

Create `components/date-range.tsx`:

```tsx
"use client";

import { useId } from "react";
import styles from "../activity.module.css";

export interface DateRangeValue {
  after: string | null;
  before: string | null;
}

export interface DateRangeProps {
  after: string | null;
  before: string | null;
  onChange: (next: DateRangeValue) => void;
}

/**
 * Two `<input type="date">` in a hairline group with eyebrow labels.
 * Shared `×` clears both when either is set. Server validates; we don't
 * enforce `after < before` here.
 */
export function DateRange({ after, before, onChange }: DateRangeProps) {
  const afterId = useId();
  const beforeId = useId();
  const anySet = !!(after || before);
  return (
    <>
      <span className={styles.filterStripEyebrow}>range</span>
      <div className={styles.dateRange}>
        <span className={styles.dateRangeSeg}>
          <label htmlFor={afterId} className={styles.dateRangeLabel}>
            after
          </label>
          <input
            id={afterId}
            type="date"
            className={styles.dateRangeInput}
            value={after ?? ""}
            onChange={(e) => onChange({ after: e.target.value || null, before })}
          />
        </span>
        <span className={styles.dateRangeSeg}>
          <label htmlFor={beforeId} className={styles.dateRangeLabel}>
            before
          </label>
          <input
            id={beforeId}
            type="date"
            className={styles.dateRangeInput}
            value={before ?? ""}
            onChange={(e) => onChange({ after, before: e.target.value || null })}
          />
          {anySet && (
            <button
              type="button"
              className={styles.dateRangeClear}
              aria-label="clear dates"
              onClick={() => onChange({ after: null, before: null })}
            >
              ×
            </button>
          )}
        </span>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/dashboard test date-range.test.tsx
```

Expected: all 4 assertions pass.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/date-range.tsx \
        apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/__tests__/date-range.test.tsx
git commit -m "feat(dashboard): activity date-range filter (after/before + shared clear)"
```

---

### Task 5: `entity-selector.tsx` — type select + id input

**Files:**

- Create: `apps/dashboard/src/app/(auth)/(mercury)/activity/components/entity-selector.tsx`
- Create: `apps/dashboard/src/app/(auth)/(mercury)/activity/components/__tests__/entity-selector.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `components/__tests__/entity-selector.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EntitySelector } from "../entity-selector.js";

const TYPES = ["agent", "calendar_event", "connection", "policy"];

describe("EntitySelector", () => {
  it("renders type select populated from the provided types prop, sorted", () => {
    render(
      <EntitySelector
        entityType={null}
        entityId={null}
        types={["policy", "agent", "calendar_event"]}
        onChange={() => {}}
      />,
    );
    const select = screen.getByLabelText(/entity type/i) as HTMLSelectElement;
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.value);
    // First option is the empty "any entity type" placeholder; rest are sorted.
    expect(options).toEqual(["", "agent", "calendar_event", "policy"]);
  });

  it("renders the entityId text input", () => {
    render(
      <EntitySelector entityType={null} entityId={null} types={TYPES} onChange={() => {}} />,
    );
    expect(screen.getByLabelText(/entity id/i)).toBeInTheDocument();
  });

  it("selecting a type fires onChange with the new type and preserves entityId", async () => {
    const onChange = vi.fn();
    render(
      <EntitySelector
        entityType={null}
        entityId="abc"
        types={TYPES}
        onChange={onChange}
      />,
    );
    await userEvent
      .setup()
      .selectOptions(screen.getByLabelText(/entity type/i), "policy");
    expect(onChange).toHaveBeenCalledWith({ entityType: "policy", entityId: "abc" });
  });

  it("typing into entityId fires onChange with the new id and preserves entityType", async () => {
    const onChange = vi.fn();
    render(
      <EntitySelector
        entityType="policy"
        entityId={null}
        types={TYPES}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText(/entity id/i);
    await userEvent.setup().type(input, "x");
    expect(onChange).toHaveBeenLastCalledWith({ entityType: "policy", entityId: "x" });
  });

  it("clearing entityId via empty string fires onChange with entityId: null", async () => {
    const onChange = vi.fn();
    render(
      <EntitySelector
        entityType={null}
        entityId="x"
        types={TYPES}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText(/entity id/i);
    await userEvent.setup().clear(input);
    expect(onChange).toHaveBeenCalledWith({ entityType: null, entityId: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/dashboard test entity-selector.test.tsx
```

Expected: module-not-found.

- [ ] **Step 3: Implement `entity-selector.tsx`**

Create `components/entity-selector.tsx`:

```tsx
"use client";

import { useId, useMemo } from "react";
import styles from "../activity.module.css";

export interface EntitySelectorValue {
  entityType: string | null;
  entityId: string | null;
}

export interface EntitySelectorProps {
  entityType: string | null;
  entityId: string | null;
  /** Distinct entity types from the loaded page; component sorts internally. */
  types: ReadonlyArray<string>;
  onChange: (next: EntitySelectorValue) => void;
}

/**
 * Entity selector — type `<select>` (populated from the loaded page's distinct
 * entityTypes, sorted) + freeform id `<input>`. The server accepts each
 * independently; we don't gate either on the other.
 */
export function EntitySelector({ entityType, entityId, types, onChange }: EntitySelectorProps) {
  const typeId = useId();
  const idId = useId();
  const sortedTypes = useMemo(() => [...types].sort(), [types]);
  return (
    <>
      <span className={styles.filterStripEyebrow}>entity</span>
      <div className={styles.entityPick}>
        <label htmlFor={typeId} className="sr-only">
          entity type
        </label>
        <select
          id={typeId}
          className={styles.entityPickSelect}
          value={entityType ?? ""}
          onChange={(e) => onChange({ entityType: e.target.value || null, entityId })}
        >
          <option value="">any entity type</option>
          {sortedTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <label htmlFor={idId} className="sr-only">
          entity id
        </label>
        <input
          id={idId}
          className={styles.entityPickInput}
          placeholder="entityId…"
          value={entityId ?? ""}
          spellCheck={false}
          onChange={(e) => onChange({ entityType, entityId: e.target.value || null })}
        />
      </div>
    </>
  );
}
```

> **Note:** `sr-only` is the standard Tailwind/utility class for screen-reader-only labels. The dashboard ships with the `sr-only` utility globally (used elsewhere in `apps/dashboard/src/components/`). If a typecheck or lint flags it as undefined, add a small `.srOnly` class to `activity.module.css` and switch to `styles.srOnly` — but verify first that the global utility resolves.

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/dashboard test entity-selector.test.tsx
```

Expected: all 5 assertions pass.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/entity-selector.tsx \
        apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/__tests__/entity-selector.test.tsx
git commit -m "feat(dashboard): activity entity-selector (type select + id input)"
```

---

### Task 6: `event-type-combobox.tsx` — banded combobox (simplified v1)

**Files:**

- Create: `apps/dashboard/src/app/(auth)/(mercury)/activity/components/event-type-combobox.tsx`
- Create: `apps/dashboard/src/app/(auth)/(mercury)/activity/components/__tests__/event-type-combobox.test.tsx`

Spec §5.2: input opens a popover list. Options grouped under non-sticky band headers (`Action lifecycle` / `Identity & governance` / `Events & reactions` / `Agent & WorkTrace`). Type to filter via substring; no `<em>` highlight in v1; no sticky headers; no band-description tooltip. Each option suffixes a `· N on this page` count. Keyboard: ↑/↓/Enter/Esc/×.

- [ ] **Step 1: Write the failing tests**

Create `components/__tests__/event-type-combobox.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EventTypeCombobox } from "../event-type-combobox.js";

const BANDS = {
  "Action lifecycle": ["action.executed", "action.failed"],
  "Identity & governance": ["identity.created", "policy.updated"],
  "Events & reactions": ["event.published"],
  "Agent & WorkTrace": ["agent.activated", "work_trace.persisted"],
} as const;

const COUNTS: Record<string, number> = {
  "action.executed": 4,
  "action.failed": 1,
  "identity.created": 2,
  "policy.updated": 0,
  "event.published": 1,
  "agent.activated": 0,
  "work_trace.persisted": 3,
};

describe("EventTypeCombobox", () => {
  it("does not render the popover initially", () => {
    render(
      <EventTypeCombobox value={null} bands={BANDS} counts={COUNTS} onChange={() => {}} />,
    );
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("opening shows grouped band headers and all options", async () => {
    render(
      <EventTypeCombobox value={null} bands={BANDS} counts={COUNTS} onChange={() => {}} />,
    );
    await userEvent.setup().click(screen.getByRole("combobox"));
    expect(screen.getByText(/Action lifecycle/)).toBeInTheDocument();
    expect(screen.getByText(/Identity & governance/)).toBeInTheDocument();
    expect(screen.getByText(/Events & reactions/)).toBeInTheDocument();
    expect(screen.getByText(/Agent & WorkTrace/)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /action\.executed/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /work_trace\.persisted/ })).toBeInTheDocument();
  });

  it("each option displays its `· N on this page` count suffix", async () => {
    render(
      <EventTypeCombobox value={null} bands={BANDS} counts={COUNTS} onChange={() => {}} />,
    );
    await userEvent.setup().click(screen.getByRole("combobox"));
    const option = screen.getByRole("option", { name: /action\.executed/ });
    expect(within(option).getByText(/4 on this page/)).toBeInTheDocument();
  });

  it("typing filters options by substring (no band headers in filtered view, no <em>)", async () => {
    const { container } = render(
      <EventTypeCombobox value={null} bands={BANDS} counts={COUNTS} onChange={() => {}} />,
    );
    const input = screen.getByRole("combobox");
    await userEvent.setup().type(input, "action");
    expect(screen.getByRole("option", { name: /action\.executed/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /action\.failed/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /identity\.created/ })).toBeNull();
    // Band headers do not render in filtered view.
    expect(screen.queryByText(/Action lifecycle/)).toBeNull();
    // No <em> match highlighting in v1.
    expect(container.querySelector("em")).toBeNull();
  });

  it("clicking an option fires onChange with the value and closes the popover", async () => {
    const onChange = vi.fn();
    render(
      <EventTypeCombobox value={null} bands={BANDS} counts={COUNTS} onChange={onChange} />,
    );
    await userEvent.setup().click(screen.getByRole("combobox"));
    await userEvent.setup().click(screen.getByRole("option", { name: /action\.failed/ }));
    expect(onChange).toHaveBeenCalledWith("action.failed");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("ArrowDown moves highlight; Enter selects the highlighted option", async () => {
    const onChange = vi.fn();
    render(
      <EventTypeCombobox value={null} bands={BANDS} counts={COUNTS} onChange={onChange} />,
    );
    const input = screen.getByRole("combobox");
    await userEvent.setup().click(input);
    await userEvent.setup().keyboard("{ArrowDown}{ArrowDown}{Enter}");
    // Bands iterate in insertion order; flattened ordering = [action.executed,
    // action.failed, identity.created, policy.updated, event.published,
    // agent.activated, work_trace.persisted]. Two ArrowDowns from the initial
    // -1 cursor land on action.failed.
    expect(onChange).toHaveBeenCalledWith("action.failed");
  });

  it("Escape closes the popover without firing onChange", async () => {
    const onChange = vi.fn();
    render(
      <EventTypeCombobox value={null} bands={BANDS} counts={COUNTS} onChange={onChange} />,
    );
    const input = screen.getByRole("combobox");
    await userEvent.setup().click(input);
    await userEvent.setup().keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("the × clear button fires onChange(null) and clears the typed query", async () => {
    const onChange = vi.fn();
    render(
      <EventTypeCombobox
        value="action.executed"
        bands={BANDS}
        counts={COUNTS}
        onChange={onChange}
      />,
    );
    const clear = screen.getByRole("button", { name: /clear event type/i });
    await userEvent.setup().click(clear);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("selected option is marked with aria-selected=true in the popover", async () => {
    render(
      <EventTypeCombobox
        value="action.executed"
        bands={BANDS}
        counts={COUNTS}
        onChange={() => {}}
      />,
    );
    await userEvent.setup().click(screen.getByRole("combobox"));
    const opt = screen.getByRole("option", { name: /action\.executed/ });
    expect(opt).toHaveAttribute("aria-selected", "true");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/dashboard test event-type-combobox.test.tsx
```

Expected: module-not-found.

- [ ] **Step 3: Implement `event-type-combobox.tsx`**

Create `components/event-type-combobox.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "../activity.module.css";

export type EventTypeBands = Readonly<Record<string, ReadonlyArray<string>>>;

export interface EventTypeComboboxProps {
  /** Selected event type, or null when none chosen. */
  value: string | null;
  /** Band-grouped event-type catalogue. Insertion order is preserved. */
  bands: EventTypeBands;
  /** Page-local counts keyed by event type. Missing keys treated as 0. */
  counts: Readonly<Record<string, number>>;
  onChange: (next: string | null) => void;
}

interface FlatOption {
  band: string;
  et: string;
}

/**
 * Simplified-v1 banded combobox (spec §5.2).
 *
 * - Non-sticky band headers (the locked design's sticky headers + match
 *   highlighting + band-description tooltips are deferred per spec).
 * - Each option suffixes a `· N on this page` count.
 * - Substring filter on type; band headers drop out of filtered view.
 * - Keyboard: ↑/↓ move highlight, Enter selects, Esc closes.
 * - Click outside closes.
 *
 * WAI-ARIA combobox-with-listbox pattern (spec §8): the input has role=combobox
 * with aria-expanded / aria-controls / aria-activedescendant; the popover is
 * role=listbox; options are role=option with aria-selected.
 */
export function EventTypeCombobox({ value, bands, counts, onChange }: EventTypeComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState<number>(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = "activity-event-type-listbox";

  // Click-outside closes
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const flat = useMemo<FlatOption[]>(() => {
    const items: FlatOption[] = [];
    for (const [band, list] of Object.entries(bands)) {
      for (const et of list) items.push({ band, et });
    }
    return items;
  }, [bands]);

  const filtered = useMemo<FlatOption[] | null>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null; // show grouped
    return flat.filter((i) => i.et.toLowerCase().includes(q));
  }, [query, flat]);

  // Reset highlight when the visible list changes
  useEffect(() => {
    setHighlight(-1);
  }, [filtered, open]);

  const visibleOptions = useMemo<FlatOption[]>(() => {
    return filtered ?? flat;
  }, [filtered, flat]);

  const pick = useCallback(
    (et: string) => {
      onChange(et);
      setOpen(false);
      setQuery("");
    },
    [onChange],
  );

  const clear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onChange(null);
      setQuery("");
    },
    [onChange],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) {
        if (e.key === "ArrowDown" || e.key === "Enter") {
          setOpen(true);
          e.preventDefault();
        }
        return;
      }
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
        e.preventDefault();
        return;
      }
      if (e.key === "ArrowDown") {
        setHighlight((h) => Math.min(visibleOptions.length - 1, h + 1));
        e.preventDefault();
        return;
      }
      if (e.key === "ArrowUp") {
        setHighlight((h) => Math.max(0, h - 1));
        e.preventDefault();
        return;
      }
      if (e.key === "Enter") {
        if (highlight >= 0 && highlight < visibleOptions.length) {
          pick(visibleOptions[highlight]!.et);
        }
        e.preventDefault();
      }
    },
    [open, highlight, visibleOptions, pick],
  );

  const renderedOption = (et: string, idx: number) => {
    const isSelected = value === et;
    const isHighlighted = highlight === idx;
    const className = [
      styles.comboOpt,
      isSelected ? styles.comboOptSelected : "",
      isHighlighted ? styles.comboOptActive : "",
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <button
        key={et}
        id={`act-combo-opt-${idx}`}
        type="button"
        role="option"
        aria-selected={isSelected}
        className={className}
        onClick={() => pick(et)}
        onMouseEnter={() => setHighlight(idx)}
      >
        <span>{et}</span>
        <span className={styles.comboOptCount}>· {counts[et] ?? 0} on this page</span>
      </button>
    );
  };

  // Indexing across the grouped view must match the flat order used by keyboard
  // navigation. We compute a running index across bands.
  const groupedView = (() => {
    let idx = -1;
    return Object.entries(bands).map(([band, list]) => (
      <div key={band}>
        <div className={styles.comboBand}>{band}</div>
        {list.map((et) => {
          idx += 1;
          return renderedOption(et, idx);
        })}
      </div>
    ));
  })();

  return (
    <>
      <span className={styles.filterStripEyebrow}>event</span>
      <div className={styles.combo} ref={wrapRef}>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={open && highlight >= 0 ? `act-combo-opt-${highlight}` : undefined}
          className={styles.comboInput}
          placeholder="event type — type to filter…"
          value={open ? query : (value ?? "")}
          spellCheck={false}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setOpen(true);
            setQuery(e.target.value);
          }}
          onKeyDown={onKeyDown}
        />
        {value && !open && (
          <button
            type="button"
            className={styles.comboClear}
            aria-label="clear event type"
            onClick={clear}
          >
            ×
          </button>
        )}
        <span className={styles.comboCaret} aria-hidden="true">
          ▾
        </span>
        {open && (
          <div className={styles.comboPop} id={listboxId} role="listbox">
            {filtered ? (
              filtered.length === 0 ? (
                <div className={styles.comboEmpty}>No event type matches “{query}”.</div>
              ) : (
                filtered.map((opt, idx) => renderedOption(opt.et, idx))
              )
            ) : (
              groupedView
            )}
          </div>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/dashboard test event-type-combobox.test.tsx
```

Expected: all 9 assertions pass. If the `Enter` keyboard test is flaky due to focus / blur behaviour, add an explicit `await userEvent.setup().click(input)` before the keyboard sequence.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/event-type-combobox.tsx \
        apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/__tests__/event-type-combobox.test.tsx
git commit -m "feat(dashboard): activity event-type combobox (banded, simplified v1)"
```

---

### Task 7: `filter-strip.tsx` — composer + `Clear filters` pill + filter-meta

**Files:**

- Create: `apps/dashboard/src/app/(auth)/(mercury)/activity/components/filter-strip.tsx`

The composer holds no state of its own — it receives all filter values + setters as props from `ActivityPage`, plus the page-local counts and the dynamic `entityTypes` list. It owns the layout (two rows), the `limit 50 · cursor head` meta indicator, and the right-aligned `Clear filters` pill which renders only when any narrowing is active.

This component is a pure composer; we cover its behaviour via the page integration tests in Task 9. The acceptance criteria that matter here (`Clear filters` only visible when narrowing is active; preserves base scope) are tested in Task 9's `activity-page.test.tsx` because that's where the wiring lives.

- [ ] **Step 1: Implement `filter-strip.tsx`**

Create `components/filter-strip.tsx`:

```tsx
"use client";

import type { EventTypeBands } from "./event-type-combobox";
import { ScopeSegment, type EffectiveScope, type ScopeBase } from "./scope-segment";
import { EventTypeCombobox } from "./event-type-combobox";
import { ActorPills, type ActorType } from "./actor-pills";
import { DateRange, type DateRangeValue } from "./date-range";
import { EntitySelector, type EntitySelectorValue } from "./entity-selector";
import styles from "../activity.module.css";

export interface FilterStripProps {
  /* scope */
  effectiveScope: EffectiveScope;
  baseScope: ScopeBase;
  operationalCount: number;
  allCount: number;
  onScopeChange: (next: ScopeBase) => void;

  /* event type */
  eventType: string | null;
  eventBands: EventTypeBands;
  eventCounts: Readonly<Record<string, number>>;
  onEventTypeChange: (next: string | null) => void;

  /* actor type */
  actorType: ActorType | null;
  actorCounts: Record<ActorType, number>;
  onActorTypeChange: (next: ActorType | null) => void;

  /* date range */
  dateRange: DateRangeValue;
  onDateRangeChange: (next: DateRangeValue) => void;

  /* entity */
  entity: EntitySelectorValue;
  entityTypes: ReadonlyArray<string>;
  onEntityChange: (next: EntitySelectorValue) => void;

  /* clear */
  narrowingActive: boolean;
  onClearFilters: () => void;
}

/**
 * Editorial filter strip — two rows of affordances + right-aligned Clear pill.
 *
 * Spec §5.2: row 1 carries scope-segment + event-type combobox + actor pills.
 * Row 2 carries date-range + entity-selector + filter-meta + Clear filters
 * (when narrowing is active).
 *
 * The strip is a pure composer — all state lives in ActivityPage; this
 * component only wires up the layout and the Clear filters affordance.
 */
export function FilterStrip(props: FilterStripProps) {
  return (
    <form role="search" aria-label="Activity filters" className={styles.filterStrip}>
      <div className={styles.filterStripRow}>
        <ScopeSegment
          effectiveScope={props.effectiveScope}
          baseScope={props.baseScope}
          operationalCount={props.operationalCount}
          allCount={props.allCount}
          onChange={props.onScopeChange}
        />
        <EventTypeCombobox
          value={props.eventType}
          bands={props.eventBands}
          counts={props.eventCounts}
          onChange={props.onEventTypeChange}
        />
        <ActorPills
          value={props.actorType}
          counts={props.actorCounts}
          onChange={props.onActorTypeChange}
        />
      </div>
      <div className={styles.filterStripRow}>
        <DateRange
          after={props.dateRange.after}
          before={props.dateRange.before}
          onChange={props.onDateRangeChange}
        />
        <EntitySelector
          entityType={props.entity.entityType}
          entityId={props.entity.entityId}
          types={props.entityTypes}
          onChange={props.onEntityChange}
        />
        <span className={styles.filterSpacer} />
        <span className={styles.filterMeta}>
          <span>limit</span>
          <b>50</b>
          <span>·</span>
          <span>cursor</span>
          <b>head</b>
        </span>
        {props.narrowingActive && (
          <button type="button" className={styles.filterClear} onClick={props.onClearFilters}>
            Clear filters
          </button>
        )}
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Sanity build check**

```bash
pnpm typecheck
```

Expected: passes. The composer pulls types from its children; any prop-shape drift surfaces here.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/filter-strip.tsx
git commit -m "feat(dashboard): activity filter-strip composer"
```

---

### Task 8: Extend `ActivityHeader` with `lastLedgerEntryHidden` (H6)

**Files:**

- Modify: `apps/dashboard/src/app/(auth)/(mercury)/activity/components/header.tsx`
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/activity/components/__tests__/header.test.tsx`

Spec H6: the "last ledger entry" tile is hidden whenever `appliedFilters` is non-empty. The cleanest signal is a boolean prop on the header; the page sets it from `narrowingActive`.

- [ ] **Step 1: Write the failing test**

Append to `components/__tests__/header.test.tsx`:

```typescript
it("H6: hides the last ledger entry tile when lastLedgerEntryHidden is true", () => {
  const { container } = render(
    <ActivityHeader
      lastLedgerEntryIso="2026-05-10T06:23:11.000Z"
      lastLedgerEntryHidden
    />,
  );
  expect(container.textContent).not.toMatch(/last ledger entry/i);
});

it("H6: renders the tile when lastLedgerEntryHidden is false (default behaviour)", () => {
  render(<ActivityHeader lastLedgerEntryIso="2026-05-10T06:23:11.000Z" />);
  expect(screen.getByText(/last ledger entry/i)).toBeInTheDocument();
});
```

(The existing header test file already imports `ActivityHeader`, `render`, and `screen`; if not, mirror the imports from `activity-row.test.tsx`.)

- [ ] **Step 2: Run test to verify it fails**

```bash
TZ=UTC pnpm --filter @switchboard/dashboard test header.test.tsx
```

Expected: first new test fails (the tile still renders).

- [ ] **Step 3: Modify `components/header.tsx`**

```tsx
"use client";

import styles from "../activity.module.css";
import { fmtRel } from "./format";

export interface ActivityHeaderProps {
  /** ISO timestamp of the most recent ledger entry available to the page (typically rows[0].timestamp).
   *  Null hides the tile. */
  lastLedgerEntryIso: string | null;
  /** When true, the tile is hidden regardless of `lastLedgerEntryIso`. PR-B H6:
   *  hidden whenever appliedFilters is non-empty. */
  lastLedgerEntryHidden?: boolean;
}

export function ActivityHeader({ lastLedgerEntryIso, lastLedgerEntryHidden }: ActivityHeaderProps) {
  const lastRel =
    !lastLedgerEntryHidden && lastLedgerEntryIso
      ? fmtRel(Date.now() - new Date(lastLedgerEntryIso).getTime())
      : null;

  return (
    <header className={styles.pageHeadWrap}>
      <div className={styles.pageHead}>
        <div className={styles.pageHeadLead}>
          <span className={styles.eyebrow}>Mercury Tools · /activity</span>
          <h1 className={styles.pageTitle}>Audit log</h1>
          <p className={styles.pageSub}>
            Every mutation by every actor — user, agent, service account, system — lands here,
            hash-chained. By default this shows the operator-visible actions; switch to All to
            inspect the full audit vocabulary.
          </p>
        </div>
        {lastRel !== null && (
          <div className={styles.pageMeta}>
            <div className={styles.statTile}>
              <span className={styles.eyebrow}>last ledger entry</span>
              <span className={styles.statTileV}>{lastRel}</span>
              <span className={styles.statTileSub}>chain head · verified</span>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
TZ=UTC pnpm --filter @switchboard/dashboard test header.test.tsx
```

Expected: all assertions pass.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/header.tsx \
        apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/__tests__/header.test.tsx
git commit -m "feat(dashboard): activity header — H6 narrowing-aware tile hide"
```

---

### Task 9: Wire `FilterStrip` into `ActivityPage`, delete `FilterChips`

**Files:**

- Modify: `apps/dashboard/src/app/(auth)/(mercury)/activity/activity-page.tsx`
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/activity/__tests__/activity-page.test.tsx`
- Delete: `apps/dashboard/src/app/(auth)/(mercury)/activity/components/filter-chips.tsx`
- Delete: `apps/dashboard/src/app/(auth)/(mercury)/activity/__tests__/filter-chips.test.tsx`

This task is the largest. Filter state lifts entirely into `ActivityPage` local React state. URL params are read on mount and on back/forward but never written. The page hands `FilterStrip` everything it needs.

- [ ] **Step 1: Rewrite `activity-page.test.tsx`**

The existing test relies on `FilterChips` and `mockReplace` URL writes. After the rewrite the page no longer writes URLs, so the test surface changes substantially. Replace the file's contents with:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuditEntriesListResponse } from "@switchboard/schemas";

// ---------------------------------------------------------------------------
// Module mocks — hoisted before any imports of the mocked modules.
// ---------------------------------------------------------------------------

const mockReplace = vi.fn();
const useSearchParamsMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => useSearchParamsMock(),
}));

const mockUseActivityList = vi.fn();
vi.mock("../hooks/use-activity-list", () => ({
  useActivityList: (...args: unknown[]) => mockUseActivityList(...args),
}));

// Delayed import so mocks are in place first.
import { ActivityPage } from "../activity-page";

function setSearch(qs: string) {
  useSearchParamsMock.mockReturnValue(new URLSearchParams(qs));
}

function hookResult(
  partial: Partial<{
    rows: AuditEntriesListResponse["rows"];
    nextCursor: string | null;
    scope: AuditEntriesListResponse["scope"];
    isLoading: boolean;
    isError: boolean;
    refetch: () => Promise<unknown>;
  }>,
): unknown {
  const rows = partial.rows ?? [];
  const data: AuditEntriesListResponse = {
    rows,
    nextCursor: partial.nextCursor ?? null,
    scope: partial.scope ?? "operational",
    appliedFilters: {
      eventType: null,
      actorType: null,
      entityType: null,
      entityId: null,
      after: null,
      before: null,
    },
  };
  return {
    data: partial.isLoading || partial.isError ? undefined : data,
    isLoading: partial.isLoading ?? false,
    isError: partial.isError ?? false,
    isSuccess: !partial.isLoading && !partial.isError,
    refetch: partial.refetch ?? vi.fn().mockResolvedValue(undefined),
    error: partial.isError ? new Error("fetch failed") : null,
  };
}

const liveRow = {
  id: "audit_live_001",
  eventType: "action.executed" as const,
  timestamp: "2026-05-10T10:00:00Z",
  actorType: "agent" as const,
  actorId: "agent_alex_001",
  entityType: "calendar_event",
  entityId: "cal_evt_1",
  riskCategory: "low" as const,
  visibilityLevel: "org" as const,
  summary: "Live row for tests",
  snapshotKeys: [],
  redactedKeyCount: 0,
  evidencePointers: [],
  entryHash: "aaa",
  previousEntryHash: "bbb",
  envelopeId: null,
  traceId: null,
};

describe("ActivityPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSearch("");
    vi.stubEnv("NEXT_PUBLIC_ACTIVITY_LIVE", "");
    mockUseActivityList.mockReturnValue(hookResult({}));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders the FilterStrip — scope segment + actor pills helper line", () => {
    render(<ActivityPage />);
    expect(screen.getByRole("button", { name: /Operational/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /All/ })).toBeInTheDocument();
    expect(
      screen.getByText(/Specific actor filtering \(e\.g\. just Alex\) is not yet available/),
    ).toBeInTheDocument();
  });

  it("gate-off: renders fixtures under Operational by default", () => {
    render(<ActivityPage />);
    expect(screen.getByText(/Booked HydraFacial consult for contact/)).toBeInTheDocument();
    expect(screen.queryByText(/Event order\.completed published to 4 subscribers/)).toBeNull();
  });

  it("gate-on: renders rows returned by useActivityList", () => {
    vi.stubEnv("NEXT_PUBLIC_ACTIVITY_LIVE", "true");
    mockUseActivityList.mockReturnValue(
      hookResult({ rows: [liveRow], scope: "operational" }),
    );
    render(<ActivityPage />);
    expect(screen.getByText("Live row for tests")).toBeInTheDocument();
  });

  it("reads scope=all from the URL on mount", () => {
    setSearch("scope=all");
    render(<ActivityPage />);
    expect(screen.getByRole("button", { name: /All/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("reads narrowing params from the URL on mount and shows the Custom badge", () => {
    setSearch("eventType=action.failed&actorType=user");
    render(<ActivityPage />);
    expect(screen.getByText(/Custom/)).toBeInTheDocument();
    // The narrowing also surfaces the Clear filters pill.
    expect(screen.getByRole("button", { name: /Clear filters/ })).toBeInTheDocument();
  });

  it("H6: hides the `last ledger entry` tile when narrowing is active", () => {
    setSearch("eventType=action.failed");
    render(<ActivityPage />);
    expect(screen.queryByText(/last ledger entry/i)).toBeNull();
  });

  it("H6: shows the tile under default operational scope (no narrowing)", () => {
    render(<ActivityPage />);
    expect(screen.getByText(/last ledger entry/i)).toBeInTheDocument();
  });

  it("Clear filters pill preserves the operator's base scope (operational)", async () => {
    setSearch("eventType=action.failed");
    render(<ActivityPage />);
    await userEvent.setup().click(screen.getByRole("button", { name: /Clear filters/ }));
    // After clear: no Clear filters pill, base scope stays Operational.
    expect(screen.queryByRole("button", { name: /Clear filters/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Operational/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("Clear filters pill preserves the operator's base scope (all)", async () => {
    setSearch("scope=all&eventType=action.failed");
    render(<ActivityPage />);
    await userEvent.setup().click(screen.getByRole("button", { name: /Clear filters/ }));
    expect(screen.queryByRole("button", { name: /Clear filters/ })).toBeNull();
    expect(screen.getByRole("button", { name: /All/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("changing scope via segment clears any expanded drawer state", async () => {
    vi.stubEnv("NEXT_PUBLIC_ACTIVITY_LIVE", "true");
    mockUseActivityList.mockReturnValue(
      hookResult({ rows: [liveRow], scope: "operational" }),
    );
    render(<ActivityPage />);
    // Expand the row.
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Toggle details for entry/ }));
    expect(screen.getByRole("button", { name: /Toggle details for entry/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // Click "All" — filter signature changes → expandedId resets.
    await userEvent.setup().click(screen.getByRole("button", { name: /All/ }));
    expect(screen.getByRole("button", { name: /Toggle details for entry/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("does NOT write the URL when the operator changes the scope", async () => {
    render(<ActivityPage />);
    await userEvent.setup().click(screen.getByRole("button", { name: /All/ }));
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("syncs back from URL on back/forward navigation (useSearchParams change)", () => {
    setSearch("scope=operational");
    const { rerender } = render(<ActivityPage />);
    expect(screen.getByRole("button", { name: /Operational/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Simulate browser back/forward emitting a new searchParams value.
    setSearch("scope=all");
    rerender(<ActivityPage />);
    expect(screen.getByRole("button", { name: /All/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
```

- [ ] **Step 2: Delete the old `FilterChips` test**

```bash
git rm apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/__tests__/filter-chips.test.tsx
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
TZ=UTC pnpm --filter @switchboard/dashboard test activity-page.test.tsx
```

Expected: most assertions fail. The page still uses `FilterChips`, no Custom badge yet, no helper line, etc.

- [ ] **Step 4: Build the event-type band catalogue + supporting structures**

The page needs an `EventTypeBands` constant matching the locked design's grouping. Since the schema enum is the source of truth for the 45 event types, we group them at the page level. Put this in a new helper file rather than the page to keep it focused.

Create `apps/dashboard/src/app/(auth)/(mercury)/activity/event-bands.ts`:

```typescript
import type { AuditEventType } from "@switchboard/schemas";

/**
 * 4-band grouping of the 45 audit event types, matching the locked design's
 * combobox order. Insertion order is preserved when iterated.
 *
 * Source: docs/design-prompts/locked/switchboard/project/activity-v2/data.js
 * (the `eventTypes` object in `window.ACTIVITY_DATA`).
 */
export const EVENT_TYPE_BANDS: Readonly<Record<string, ReadonlyArray<AuditEventType>>> = {
  "Action lifecycle": [
    "action.proposed",
    "action.resolved",
    "action.enriched",
    "action.evaluated",
    "action.approved",
    "action.partially_approved",
    "action.rejected",
    "action.patched",
    "action.queued",
    "action.executing",
    "action.snapshot",
    "action.executed",
    "action.failed",
    "action.denied",
    "action.expired",
    "action.cancelled",
    "action.undo_requested",
    "action.undo_executed",
    "action.approval_expired",
  ],
  "Identity & governance": [
    "identity.created",
    "identity.updated",
    "overlay.activated",
    "overlay.deactivated",
    "policy.created",
    "policy.updated",
    "policy.deleted",
    "connection.established",
    "connection.revoked",
    "connection.degraded",
    "competence.promoted",
    "competence.demoted",
    "competence.updated",
    "delegation.chain_resolved",
    "entity.linked",
    "entity.unlinked",
    "entity.resolved",
  ],
  "Events & reactions": ["event.published", "event.reaction.triggered", "event.reaction.created"],
  "Agent & WorkTrace": [
    "agent.activated",
    "agent.emergency-halted",
    "agent.resumed",
    "work_trace.persisted",
    "work_trace.updated",
    "work_trace.integrity_override",
  ],
};
```

- [ ] **Step 5: Rewrite `activity-page.tsx`**

Replace the file's contents with:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { AuditEntriesListQuery, AuditEntryBrowseRow } from "@switchboard/schemas";
import { OPERATIONAL_AUDIT_EVENT_TYPES } from "@switchboard/schemas";
import { isMercuryToolLive } from "@/lib/route-availability";
import { useActivityList } from "./hooks/use-activity-list";
import { ACTIVITY_FIXTURES } from "./fixtures";
import { ActivityHeader } from "./components/header";
import { FilterStrip } from "./components/filter-strip";
import type { ScopeBase, EffectiveScope } from "./components/scope-segment";
import type { ActorType } from "./components/actor-pills";
import type { DateRangeValue } from "./components/date-range";
import type { EntitySelectorValue } from "./components/entity-selector";
import { ActivityTable } from "./components/activity-table";
import { PaginationFooter } from "./components/pagination-footer";
import { EmptyState } from "./components/empty-state";
import { EVENT_TYPE_BANDS } from "./event-bands";
import styles from "./activity.module.css";

const isActivityLive = (): boolean => isMercuryToolLive("activity");

const OPERATIONAL_SET = new Set<string>(OPERATIONAL_AUDIT_EVENT_TYPES);

// ---------------------------------------------------------------------------
// URL reads (read-only — PR-B does not write URLs)
// ---------------------------------------------------------------------------

interface NarrowingState {
  eventType: string | null;
  actorType: ActorType | null;
  dateRange: DateRangeValue;
  entity: EntitySelectorValue;
}

function readScope(sp: URLSearchParams): ScopeBase {
  return sp.get("scope") === "all" ? "all" : "operational";
}

function readNarrowing(sp: URLSearchParams): NarrowingState {
  const actorParam = sp.get("actorType");
  const isActor = (v: string): v is ActorType =>
    v === "user" || v === "agent" || v === "system" || v === "service_account";
  return {
    eventType: sp.get("eventType"),
    actorType: actorParam && isActor(actorParam) ? actorParam : null,
    dateRange: {
      after: sp.get("after"),
      before: sp.get("before"),
    },
    entity: {
      entityType: sp.get("entityType"),
      entityId: sp.get("entityId"),
    },
  };
}

function narrowingActive(n: NarrowingState): boolean {
  return !!(
    n.eventType ||
    n.actorType ||
    n.dateRange.after ||
    n.dateRange.before ||
    n.entity.entityType ||
    n.entity.entityId
  );
}

// ---------------------------------------------------------------------------
// Fixture-mode in-memory filtering
// ---------------------------------------------------------------------------

function filterRowsInMemory(
  rows: ReadonlyArray<AuditEntryBrowseRow>,
  scope: ScopeBase,
  n: NarrowingState,
): AuditEntryBrowseRow[] {
  let out = rows.slice();
  if (scope === "operational") {
    out = out.filter((r) => OPERATIONAL_SET.has(r.eventType));
  }
  if (n.eventType) out = out.filter((r) => r.eventType === n.eventType);
  if (n.actorType) out = out.filter((r) => r.actorType === n.actorType);
  if (n.dateRange.after) {
    const t = new Date(n.dateRange.after).getTime();
    out = out.filter((r) => new Date(r.timestamp).getTime() >= t);
  }
  if (n.dateRange.before) {
    const t = new Date(n.dateRange.before).getTime() + 24 * 60 * 60 * 1000;
    out = out.filter((r) => new Date(r.timestamp).getTime() < t);
  }
  if (n.entity.entityType) out = out.filter((r) => r.entityType === n.entity.entityType);
  if (n.entity.entityId) {
    const q = n.entity.entityId.toLowerCase();
    out = out.filter((r) => r.entityId.toLowerCase().includes(q));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ActivityPage() {
  const searchParams = useSearchParams();
  const sp = searchParams ?? new URLSearchParams();

  // ---- Filter state (local; URL params are read on mount + back/forward) ----
  const [scope, setScope] = useState<ScopeBase>(() => readScope(sp));
  const initial = useMemo(() => readNarrowing(sp), [sp]);
  const [eventType, setEventType] = useState<string | null>(initial.eventType);
  const [actorType, setActorType] = useState<ActorType | null>(initial.actorType);
  const [dateRange, setDateRange] = useState<DateRangeValue>(initial.dateRange);
  const [entity, setEntity] = useState<EntitySelectorValue>(initial.entity);

  // ---- Cursor / drawer state ----
  const [cursor, setCursor] = useState<string | null>(null);
  const [prevCursorStack, setPrevCursorStack] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ---- Back/forward sync from URL ----
  // The URL is the canonical input on mount and on back/forward navigation.
  // We never write back, so any change in searchParams is external.
  const urlScope = readScope(sp);
  const urlNarrowing = useMemo(() => readNarrowing(sp), [sp]);

  useEffect(() => {
    setScope(urlScope);
  }, [urlScope]);

  // Narrowing fields are syncable individually so the URL is fully respected.
  useEffect(() => {
    setEventType(urlNarrowing.eventType);
    setActorType(urlNarrowing.actorType);
    setDateRange(urlNarrowing.dateRange);
    setEntity(urlNarrowing.entity);
  }, [
    urlNarrowing.eventType,
    urlNarrowing.actorType,
    urlNarrowing.dateRange.after,
    urlNarrowing.dateRange.before,
    urlNarrowing.entity.entityType,
    urlNarrowing.entity.entityId,
    urlNarrowing,
  ]);

  // ---- Filter-signature reset (cursor stack + expanded drawer) ----
  const narrowing: NarrowingState = useMemo(
    () => ({ eventType, actorType, dateRange, entity }),
    [eventType, actorType, dateRange, entity],
  );
  const narrowingOn = narrowingActive(narrowing);
  const filterSignature = useMemo(
    () =>
      [
        scope,
        eventType ?? "",
        actorType ?? "",
        dateRange.after ?? "",
        dateRange.before ?? "",
        entity.entityType ?? "",
        entity.entityId ?? "",
      ].join("|"),
    [scope, eventType, actorType, dateRange, entity],
  );
  useEffect(() => {
    setCursor(null);
    setPrevCursorStack([]);
    setExpandedId(null);
  }, [filterSignature]);

  // ---- Query construction ----
  const query = useMemo<Partial<AuditEntriesListQuery>>(
    () => ({
      scope,
      cursor: cursor ?? undefined,
      eventType: (eventType as AuditEntriesListQuery["eventType"]) ?? undefined,
      actorType: (actorType as AuditEntriesListQuery["actorType"]) ?? undefined,
      entityType: entity.entityType ?? undefined,
      entityId: entity.entityId ?? undefined,
      after: dateRange.after ?? undefined,
      before: dateRange.before ?? undefined,
    }),
    [scope, cursor, eventType, actorType, dateRange, entity],
  );

  // ---- Data — live or fixture ----
  const { data, isLoading, isError, refetch } = useActivityList(query);
  let rows: ReadonlyArray<AuditEntryBrowseRow> = data?.rows ?? [];
  const nextCursor = data?.nextCursor ?? null;
  const effectiveScopeFromApi: EffectiveScope = data?.scope ?? scope;

  if (!isActivityLive()) {
    rows = filterRowsInMemory(ACTIVITY_FIXTURES, scope, narrowing);
  }

  // ---- effectiveScope: narrowing wins in fixture mode (no API to report it) ----
  const effectiveScope: EffectiveScope = narrowingOn ? "custom" : effectiveScopeFromApi;

  // ---- Page-local counts ----
  const sourceRows: ReadonlyArray<AuditEntryBrowseRow> = isActivityLive()
    ? rows
    : ACTIVITY_FIXTURES;
  const counts = useMemo(() => {
    const operationalCount = sourceRows.filter((r) => OPERATIONAL_SET.has(r.eventType)).length;
    const allCount = sourceRows.length;
    const byActor: Record<ActorType, number> = {
      user: 0,
      agent: 0,
      system: 0,
      service_account: 0,
    };
    const byEvent: Record<string, number> = {};
    for (const r of sourceRows) {
      byActor[r.actorType] = (byActor[r.actorType] ?? 0) + 1;
      byEvent[r.eventType] = (byEvent[r.eventType] ?? 0) + 1;
    }
    return { operationalCount, allCount, byActor, byEvent };
  }, [sourceRows]);

  const entityTypes = useMemo(
    () => Array.from(new Set(sourceRows.map((r) => r.entityType))).sort(),
    [sourceRows],
  );

  // ---- Handlers ----
  const onClearFilters = useCallback(() => {
    setEventType(null);
    setActorType(null);
    setDateRange({ after: null, before: null });
    setEntity({ entityType: null, entityId: null });
    // Preserve the operator's base scope choice (operational OR all).
  }, []);

  const onResetToDefault = useCallback(() => {
    setScope("operational");
    onClearFilters();
  }, [onClearFilters]);

  const onNext = useCallback(() => {
    if (!nextCursor) return;
    setPrevCursorStack((prev) => [...prev, cursor ?? ""]);
    setCursor(nextCursor);
  }, [cursor, nextCursor]);

  const onPrev = useCallback(() => {
    setPrevCursorStack((prev) => {
      const stack = [...prev];
      const prevCursor = stack.pop() ?? null;
      setCursor(prevCursor);
      return stack;
    });
  }, []);

  // ---- Render-state derivations ----
  const emptyVariant = narrowingOn ? "filtered" : "zero";
  const showPagination = isActivityLive() && (prevCursorStack.length > 0 || !!nextCursor);

  return (
    <div className={styles.activityPage}>
      <ActivityHeader
        lastLedgerEntryIso={rows[0]?.timestamp ?? null}
        lastLedgerEntryHidden={narrowingOn}
      />

      <FilterStrip
        effectiveScope={effectiveScope}
        baseScope={scope}
        operationalCount={counts.operationalCount}
        allCount={counts.allCount}
        onScopeChange={setScope}
        eventType={eventType}
        eventBands={EVENT_TYPE_BANDS}
        eventCounts={counts.byEvent}
        onEventTypeChange={setEventType}
        actorType={actorType}
        actorCounts={counts.byActor}
        onActorTypeChange={setActorType}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        entity={entity}
        entityTypes={entityTypes}
        onEntityChange={setEntity}
        narrowingActive={narrowingOn}
        onClearFilters={onClearFilters}
      />

      <section className={`${styles.section} ${styles.page}`}>
        {isLoading ? (
          <div className={styles.skeletonTable} role="status" aria-label="Loading activity">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className={styles.skeletonRow} />
            ))}
          </div>
        ) : isError ? (
          <EmptyState variant="filtered" onClear={() => void refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState variant={emptyVariant} onClear={narrowingOn ? onResetToDefault : undefined} />
        ) : (
          <ActivityTable
            rows={rows}
            expandedId={expandedId}
            onToggle={(id) => setExpandedId((cur) => (cur === id ? null : id))}
            now={Date.now()}
          />
        )}

        {showPagination && (
          <PaginationFooter
            canGoPrev={prevCursorStack.length > 0}
            canGoNext={!!nextCursor}
            onPrev={onPrev}
            onNext={onNext}
          />
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 6: Delete `filter-chips.tsx`**

```bash
git rm apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/filter-chips.tsx
```

- [ ] **Step 7: Run the tests**

```bash
TZ=UTC pnpm --filter @switchboard/dashboard test activity-page.test.tsx
```

Expected: all assertions pass.

If `getByText(/Custom/)` collides with another `Custom` in the document, scope the search to the filter strip's role=search region or use `screen.getByText("· Custom")`.

- [ ] **Step 8: Run the full dashboard test suite to surface unrelated regressions**

```bash
TZ=UTC pnpm --filter @switchboard/dashboard test
```

Expected: all tests pass. If `__tests__/activity-row-drawer.test.tsx` or `__tests__/activity-table.test.tsx` break because they imported anything from `filter-chips.tsx`, fix the imports — they shouldn't, but verify.

- [ ] **Step 9: Run typecheck + production build**

```bash
pnpm typecheck
pnpm --filter @switchboard/dashboard build
```

Expected: both succeed. The build catches missing `.js` extensions in test files and any TypeScript strictness issues the test runner skips.

- [ ] **Step 10: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/activity-page.tsx \
        apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/__tests__/activity-page.test.tsx \
        apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/event-bands.ts
git rm apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/filter-chips.tsx \
       apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/__tests__/filter-chips.test.tsx
git commit -m "feat(dashboard): wire activity FilterStrip + H6 + filter-signature reset"
```

---

### Task 10: Activity-row test — agent glyph amber treatment regression guard

**Files:**

- Modify: `apps/dashboard/src/app/(auth)/(mercury)/activity/components/__tests__/activity-row.test.tsx`

Task 1 added the `.actorGlyph[data-actor="agent"]` rule. The row already sets `data-actor={row.actorType}`. Add a small assertion so future edits don't drop the attribute.

- [ ] **Step 1: Append the test**

Append to `activity-row.test.tsx`:

```typescript
it("agent rows carry data-actor='agent' for the amber-treatment CSS rule", () => {
  const { container } = render(
    <ActivityRow
      row={{ ...baseRow, actorType: "agent" }}
      isOpen={false}
      isTarget={false}
      onToggle={() => {}}
      now={NOW_MS}
    />,
  );
  expect(container.querySelector("[data-actor='agent']")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test**

```bash
TZ=UTC pnpm --filter @switchboard/dashboard test activity-row.test.tsx
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/__tests__/activity-row.test.tsx
git commit -m "test(dashboard): activity-row agent-glyph amber-treatment regression guard"
```

---

### Task 11: Final verification + manual QA

**Files:** none — verification only.

This task wraps the implementation. No code changes; commits gated on passing verification.

- [ ] **Step 1: Run the full dashboard test suite**

```bash
TZ=UTC pnpm --filter @switchboard/dashboard test
```

Expected: every test passes.

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck
```

Expected: no errors. If anything reports missing exports from `@switchboard/schemas` / `@switchboard/db` / `@switchboard/core`, run `pnpm reset` first (per CLAUDE.md) — `dist/` may be stale.

- [ ] **Step 3: Run the dashboard production build**

```bash
pnpm --filter @switchboard/dashboard build
```

Expected: builds cleanly. The dashboard `next build` is NOT in CI (`feedback_dashboard_build_not_in_ci.md`); local pass is the gate.

- [ ] **Step 4: Verify file-size budgets**

```bash
wc -l apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/activity-page.tsx \
      apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/filter-strip.tsx \
      apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/event-type-combobox.tsx \
      apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/scope-segment.tsx \
      apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/actor-pills.tsx \
      apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/date-range.tsx \
      apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/entity-selector.tsx \
      apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/activity.module.css
```

Expected: every file under 600 (the CLAUDE.md hard limit). Most well under 400.

- [ ] **Step 5: Manual QA in the browser**

Start the dashboard dev server:

```bash
pnpm --filter @switchboard/dashboard dev
```

Visit http://localhost:3002/activity (fixture mode — `NEXT_PUBLIC_ACTIVITY_LIVE` unset). Verify each acceptance criterion from spec §12:

1. Filter strip exposes scope segment (TWO buttons), event-type combobox, actor pills, date range, entity selector. ✓
2. Setting any narrowing param shows the `· Custom` status badge next to the segmented control AND the `Clear filters` pill at the right edge of the strip. ✓
3. Custom badge has an amber dot. ✓
4. Combobox counts visibly suffixed with `on this page`. ✓
5. Actor pills suffixed with `on this page` AND carry the helper line about specific-actor filtering not being available. ✓
6. Clearing filters via the pill: base scope (operational vs all) is preserved. ✓
7. Changing scope or any narrowing param clears any open drawer state. ✓
8. `last ledger entry` tile is hidden whenever any narrowing is active. ✓
9. URL params are read on mount (paste `/activity?scope=all&eventType=action.failed` into the address bar) AND on browser back/forward. ✓
10. The page does not write URL params when filters change (the address bar stays at `/activity` after clicking around). ✓
11. Chevron click target is comfortable (no longer 18×18; PR-A carry-over fix). ✓
12. Agent rows in the table have an amber-paper glyph background (PR-A carry-over). ✓

If any of the above fails, fix it on the same branch before opening the PR.

- [ ] **Step 6: Push the branch and open the PR**

```bash
git push -u origin feat/activity-rebuild-pr-b-filter-strip
gh pr create --title "feat(dashboard): /activity rebuild PR-B — filter strip" --body "$(cat <<'EOF'
## Summary

Implements PR-B of the /activity rebuild spec — the editorial filter strip.

- Five-affordance filter strip (scope segment + Custom badge, banded event-type combobox, actor pills + helper line, date range, entity selector).
- `Clear filters` pill preserves operator base scope (operational OR all).
- Filter state lifted into local React state; URL params read on mount and on back/forward (no URL writes).
- H6: `last ledger entry` tile hidden when narrowing is active.
- Filter-signature reset clears cursor, prevCursorStack, and expandedId.
- PR-A code-review carry-overs: agent-glyph amber-treatment CSS rule + restored chevron padding.

Spec: docs/superpowers/specs/2026-05-13-activity-rebuild-design.md §13 (PR-B slice).
Plan: docs/superpowers/plans/2026-05-14-activity-rebuild-pr-b-filter-strip.md.

## Test plan

- [ ] `TZ=UTC pnpm --filter @switchboard/dashboard test` (all green)
- [ ] `pnpm typecheck` (green)
- [ ] `pnpm --filter @switchboard/dashboard build` (green — not in CI)
- [ ] Manual QA in fixture mode: every acceptance criterion in spec §12 walks green

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 7: Request code review**

Invoke the `superpowers:requesting-code-review` skill against the PR.

- [ ] **Step 8: Wait for all pushes to register before enabling auto-merge**

`gh pr view <number>` should show every commit listed in the timeline. Only then run:

```bash
gh pr merge <number> --squash --auto
```

When the squash fires, verify the squash-commit body lists every commit. PR-A auto-merged before its hotfix push was registered, so the squash missed the last commit. Don't repeat that.

---

## Self-review (writing-plans skill checklist)

**1. Spec coverage** — every PR-B item from spec §13 has a task:

- New filter strip with five affordances → Tasks 2–7.
- Filter-signature reset behaviour → Task 9 (the `filterSignature` `useEffect` in the rewritten page).
- Clear filters pill (preserves base scope) → Task 9 (tests assert both operational and all cases; the page-level `onClearFilters` callback resets only narrowing).
- URL-param READ on mount + back/forward (no URL WRITES) → Task 9 (the rewritten page uses `useSearchParams` for reads; no `router.replace` calls remain).
- Co-located tests → Tasks 2–6 each ship a test alongside the component; Task 8 extends the header test; Task 9 rewrites the page test; Task 10 adds the row regression guard.
- H6 → Task 8 (header) + Task 9 (page wiring).
- Two PR-A code-review carry-overs (agent-glyph amber treatment + chevron padding) → Task 1 (CSS) + Task 10 (regression guard).
- Auto-merge race avoidance → Task 11 Step 8.

**2. Placeholder scan** — every code block in this plan is a complete file or a complete appendable test block. No "TBD", "implement later", "similar to Task N". Each `Step` lists an explicit run command + expected outcome.

**3. Type consistency** —

- `ScopeBase` / `EffectiveScope` from `scope-segment.tsx` are re-used in `filter-strip.tsx` and `activity-page.tsx`.
- `ActorType` from `actor-pills.tsx` is the same shape as `AuditEntryBrowseRow["actorType"]`; re-used in `filter-strip.tsx` and `activity-page.tsx`.
- `DateRangeValue` from `date-range.tsx` is re-used in `filter-strip.tsx` and `activity-page.tsx`.
- `EntitySelectorValue` from `entity-selector.tsx` is re-used in `filter-strip.tsx` and `activity-page.tsx`.
- `EventTypeBands` from `event-type-combobox.tsx` matches `EVENT_TYPE_BANDS` from `event-bands.ts` (both `Readonly<Record<string, ReadonlyArray<...>>>`).
- `narrowingActive` is consistently a boolean derived from the same six narrowing fields in every place it's referenced.

The plan is complete and internally consistent.

---

## Execution Handoff

Two execution options once this plan PR merges to `main`:

1. **Subagent-Driven (recommended)** — fresh subagent per task with review checkpoints between tasks.
2. **Inline Execution** — execute tasks in the same session using `superpowers:executing-plans` with batch checkpoints.

The PR-B task surface is roughly 11 tasks, each TDD red → green → commit. Either approach works; subagent-driven keeps context lean.
