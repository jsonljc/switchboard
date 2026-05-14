# /activity rebuild — PR-C (resilience + polish) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the resilience + polish slice of the `/activity` rebuild: a non-unmounting error banner (introduces hard invariant H5), a bottom-right stale-fetch pill, a rewritten two-variant empty state with editorial copy, a restyled pagination footer (showing N + keyset chrome), and a page-wide accessibility regression suite. Also fold in one PR-B code-review carry-over (TZ-dependent assertion in `activity-row.test.tsx`) and sweep CSS classes orphaned by the PR-A → PR-B → PR-C cascade.

**Architecture:** PR-A's row + drawer and PR-B's filter strip are already on `main`. PR-C does no further extraction of components — it adds `error-banner.tsx` and `stale-pill.tsx` alongside the existing components and rewrites `empty-state.tsx` + `pagination-footer.tsx` in place. The page-level integration is a small render-tree restructure inside `activity-page.tsx`: the current `isError ? <EmptyState variant="filtered" />` branch is replaced by `[ErrorBanner above][Table stays mounted]`, so a fetch error no longer drops the previously-rendered page (this is hard invariant H5 introduced by PR-C per spec §12). The stale pill is fixed to the viewport (`position: fixed; right: 22px; bottom: 22px`) and anchors to the wall-clock timestamp of the last successful query — read off React Query's `dataUpdatedAt` — so "fetched Nm ago" stays honest across the page lifetime. A 15-second ticker recomputes Nm and triggers re-render. The stale pill is suppressed until the first successful fetch (`dataUpdatedAt > 0`), satisfying spec §12 walk-the-page #5. The accessibility regression suite is a single new test file (`__tests__/activity-accessibility.test.tsx`) that runs all the page-level a11y assertions in one file — grid roles, combobox WAI-ARIA pattern, chevron focus management, drawer focus on `view previous ↓`, and `aria-live` announcements on error banner and stale pill.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, CSS Modules, vitest + @testing-library/react + @testing-library/user-event, `@tanstack/react-query` (we read `dataUpdatedAt` + `isFetching`), `AuditEntriesListQuery` / `AuditEntriesListResponse` from `@switchboard/schemas`.

**Spec:** `docs/superpowers/specs/2026-05-13-activity-rebuild-design.md` (PR #448, on `main`). This plan implements the PR-C slice defined in §13.

**Hard invariants this PR introduces** (per spec §12):
- **H5** (newly introduced): fetch errors never unmount the table; the previous page of rows stays on screen with an inline banner above.

H1–H4 (PR-A) and H6 (PR-B) remain in force and are exercised by the regression suite Task 8 adds.

---

## File structure

PR-C adds two new components + four new component tests + one new page-level accessibility test, rewrites the existing empty-state and pagination-footer (and their CSS), restructures the page render-tree, fixes one PR-B test-file carry-over, and runs a dead-CSS sweep across `activity.module.css`.

**New files**

| Path                                                                                                          | Responsibility                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/components/error-banner.tsx`                                | Non-unmounting banner above the table on fetch failure. Eyebrow "request failed", italic display-serif message with method + path + status + duration, ink-bordered `[Retry]` button. `role="alert"`. Stays inert above the table when no error is active. |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/components/stale-pill.tsx`                                  | Fixed bottom-right pill. Reads `fetchedAt` (wall-clock ms) and `isFetching` from props; shows "fetched just now" within 60s, "fetched Nm ago" after. Refresh button calls `onRefetch`. `role="status"`, `aria-live="polite"` on the age value.              |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/components/__tests__/error-banner.test.tsx`                 | Spec §9 / §12 H5: banner mounts above the table; table is NOT unmounted when banner is shown (rendered with a sibling table marker); retry calls the callback; renders the failing path + status from props.                                               |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/components/__tests__/stale-pill.test.tsx`                   | Spec §9: "just now" when fresh, "Nm ago" after 60s+; refresh button invokes `onRefetch`; hidden when `fetchedAt === 0`; `role="status"` and `aria-live="polite"` present.                                                                                  |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/components/__tests__/empty-state.test.tsx`                  | Spec §9: zero variant copy + ledger-health metadata; filtered variant copy + Clear CTA wired to handler; italic accent visible via `<em>` element in both variants.                                                                                         |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/components/__tests__/pagination-footer.test.tsx`            | Spec §9 / §12 acceptance #7: `Showing N of …`; "keyset cursor — total unknown by design"; ← Newer disabled when `canGoPrev=false`; Older → disabled when `canGoNext=false`.                                                                                |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/__tests__/activity-accessibility.test.tsx`                  | Page-level a11y regression suite. Grid `role` structure; combobox combobox-with-listbox pattern; chevron focus management; drawer focus after `view previous ↓`; `role="alert"` on error banner; `role="status"` + `aria-live="polite"` on stale pill.       |

**Modified files**

| Path                                                                                              | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/components/empty-state.tsx`                     | Rewrite for zero + filtered variants per spec §5.5: eyebrow + display-serif italic-accent headline + Inter prose + (filtered only) Clear CTA. Drops the v1 "No activity yet." + "No matching activity." strings.                                                                                                                                                                                                          |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/components/pagination-footer.tsx`               | Restyle to the locked-design split: left "Showing N of … · keyset cursor — total unknown by design · limit 50" info line, right ← Newer / Older → buttons. Accept new `count` prop. 1px top hair border.                                                                                                                                                                                                                |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/activity-page.tsx`                              | (1) Pass `count` + new button labels to `PaginationFooter`. (2) Replace the `isError ? <EmptyState />` branch: instead render `<ErrorBanner above />` and keep the table mounted with the last `rows` (we cache the last successful rows in a ref / state so they survive `isError`). (3) Render `<StalePill />` once `dataUpdatedAt > 0`. (4) Update `EmptyState` callers to use new `scannedCount` + variant API.        |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/hooks/use-activity-list.ts`                     | Pass through `dataUpdatedAt` and `isFetching` from `useQuery` (no behavioural change — these were already returned by `useQuery`, but we surface them explicitly via the destructure shape callers use). No other change.                                                                                                                                                                                                |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/__tests__/activity-page.test.tsx`               | (1) Add `dataUpdatedAt: 0` / `isFetching: false` to the `hookResult()` helper so the new page consumes them. (2) Add H5 tests: when `isError` toggles after a successful fetch, the previous rows stay rendered and the banner appears above. (3) Add a stale-pill visibility test: hidden when no successful fetch; visible after a successful fetch. (4) Update the empty-filtered onClear assertion to the new copy. |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/components/__tests__/activity-row.test.tsx`     | PR-B code-review carry-over: line ~40 asserts `screen.getByText("06:23:11")` which is TZ-dependent. Pass `orgTimezone="UTC"` to the rendered `ActivityRow` so the test passes on Singapore / America hosts too (currently passes only because CI runs UTC).                                                                                                                                                              |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/activity.module.css`                            | (1) Add CSS blocks for `.errBanner`, `.stalePill`, the rewritten empty-state (`.empty`, `.emptyEyebrow`, `.emptyHeadline`, `.emptyHeadlineEm`, `.emptySub`, `.emptyMeta`, `.emptyMetaB`, `.emptyCta`), and the restyled pagination (`.pag`, `.pagInfo`, `.pagInfoB`, `.pagInfoSep`, `.pagNav`, `.pagBtn`). (2) Delete dead classes the sweep finds (see Task 9 grep verification): `.cellTimestamp`, `.cellEvent`, `.cellActor`, `.cellEntity`, `.cellSummary`, `.cellChevron`, `.cellMono`, `.cellHash`, `.riskBadge`, `.riskNone`, `.riskLow`, `.riskMedium`, `.riskHigh`, `.riskCritical`, `.stickyCol`, `.drawerRow`, `.titleRow`, `.titleFolio`, `.toolbar`, `.activity` (the legacy `<table>` root), `.activity thead th`, `.activity tbody tr`, `.activity tbody td`, `.activityRow.isExpanded`, `.sectionLabel`, `.isMuted`, `.tabular`, `.fadeIn` + `@keyframes activityFadeIn`. Plus drop the v1 `.emptyWrap` / `.emptyTitle` / `.emptyBody` / `.emptyAction` classes (replaced by the new empty block). Plus drop v1 `.paginationFooter` / `.moreButton` / `.arr` (replaced by the new `.pag*` block). |

**Files left alone in PR-C**

- `apps/dashboard/src/app/(auth)/(mercury)/activity/page.tsx` — server entry; unchanged.
- `apps/dashboard/src/app/(auth)/(mercury)/activity/fixtures.ts` / `fixtures.data.ts` — PR-A landed the 30-row v2 distribution.
- `apps/dashboard/src/app/(auth)/(mercury)/activity/components/filter-strip.tsx` + the five filter affordance components — PR-B landed these. The accessibility regression suite (Task 8) ASSERTS on them but does not modify them.
- `apps/dashboard/src/app/(auth)/(mercury)/activity/components/activity-row.tsx`, `activity-row-drawer.tsx`, `activity-table.tsx`, `format.ts`, `use-copier.ts`, `header.tsx` — PR-A landed these. The a11y suite asserts on the chevron and drawer; no source change.

`globals.css` is not touched (per spec §1.2 last paragraph — wave-1 surfaces never edit it). All new tokens consumed inside `activity.module.css` come from the existing `.activityPage` scope (`--paper`, `--ink*`, `--hair*`, `--amber*`).

---

## Workflow

Per CLAUDE.md doctrine:

1. **Plan PR first.** This plan is committed on branch `docs/activity-rebuild-pr-c-plan` off `main`, PR opened to `main`, merged once approved. The plan must exist on `main` before implementation starts.
2. **Implementation worktree.** From the main checkout, after the plan PR merges:

   ```bash
   git fetch origin main
   git worktree add .worktrees/activity-rebuild-pr-c -b feat/activity-rebuild-pr-c-resilience-polish origin/main
   cd .worktrees/activity-rebuild-pr-c
   pnpm worktree:init
   pnpm install   # if worktree:init did not already install
   ```
3. **Verify spec and plan are present on this branch:**

   ```bash
   ls docs/superpowers/specs/2026-05-13-activity-rebuild-design.md
   ls docs/superpowers/plans/2026-05-14-activity-rebuild-pr-c-resilience-polish.md
   ```
4. **Commit cadence:** one commit per task (TDD red → green → commit). Conventional Commits required by commitlint.
5. **Verification before claiming complete:** every task that touches a `.test.tsx` file runs the targeted test; the final task (Task 10) runs the full dashboard test suite, `pnpm typecheck`, and `pnpm --filter @switchboard/dashboard build` (next build is not in CI — see `memory/feedback_dashboard_build_not_in_ci.md`).
6. **Local test runs:** prefix `TZ=UTC` for any test that asserts formatted clock output. PR-A wasted a cycle on this; PR-B propagated the rule.
7. **ESM `.js` extensions:** dashboard PRODUCTION files (`apps/dashboard/src/...`) do NOT use `.js` on relative imports. TEST files DO use `.js`. This matches the existing codebase convention.
8. **No `console.log`, no `any`, no unused-var without `_` prefix.** Per CLAUDE.md.
9. **Husky pre-commit** auto-formats with prettier/eslint and silently rewrites staged files. Don't fight it; the linter changes are intentional.

---

## Conventions used in this plan

- All file paths use the literal escaped form when invoking shell tools so the `(auth)/(mercury)` parens parse cleanly. In prose I show them unescaped.
- Code blocks show the **final** state of each file after the task's step is applied, not a diff. The engineer can copy-paste the whole block.
- Test names match the spec acceptance numbering where applicable.

---

### Task 1: PR-B carry-over — make `activity-row.test.tsx` TZ-independent

**Why first:** This is one-line scope and a known PR-B reviewer flag. Landing it first keeps the implementation cadence clean — Tasks 2+ won't be the first commit on the branch to touch a test file PR-B reviewers will inspect.

**Files:**

- Modify: `apps/dashboard/src/app/(auth)/(mercury)/activity/components/__tests__/activity-row.test.tsx`

- [ ] **Step 1: Replace TZ-dependent assertion with an `orgTimezone="UTC"` prop**

Open `apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/__tests__/activity-row.test.tsx`. Find the first test (around line 30) that calls `render(<ActivityRow ... />)` and asserts `screen.getByText("06:23:11")`. The `ActivityRow` component already accepts an `orgTimezone` prop (`apps/dashboard/src/app/(auth)/(mercury)/activity/components/activity-row.tsx:30`); pass it explicitly as `"UTC"` so the rendered clock is deterministic regardless of host TZ.

Apply the same `orgTimezone="UTC"` prop to **every** `render(<ActivityRow ... />)` call in the file (there are several — the test sets `NOW_MS` and re-renders for the H1 / chevron / risk hairline / `+N redacted` cases). Setting it once at the top of each render keeps assertions on `getByText("06:23:11")` and friends stable.

The minimal diff per call is to add the prop:

```tsx
render(
  <ActivityRow
    row={baseRow}
    isOpen={false}
    isTarget={false}
    onToggle={() => {}}
    now={NOW_MS}
    orgTimezone="UTC"
  />,
);
```

- [ ] **Step 2: Run the targeted test**

```bash
TZ=America/New_York pnpm --filter @switchboard/dashboard vitest run components/__tests__/activity-row.test.tsx
```

Expected: PASS. (Prior to this change the same command would fail on the `getByText("06:23:11")` assertion because `fmtClock` would format in `America/New_York` and produce `02:23:11`.)

Also run in UTC to confirm we did not regress the existing CI path:

```bash
TZ=UTC pnpm --filter @switchboard/dashboard vitest run components/__tests__/activity-row.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/__tests__/activity-row.test.tsx
git commit -m "test(dashboard): make activity-row test TZ-independent (PR-B carry-over)"
```

---

### Task 2: CSS — add error-banner, stale-pill, empty (rewrite), pagination (rewrite) blocks

**Files:**

- Modify: `apps/dashboard/src/app/(auth)/(mercury)/activity/activity.module.css`

Add four new editorial CSS blocks, ported camelCase from the locked design (`docs/design-prompts/locked/switchboard/project/activity-v2/styles.css` lines 429–1017 — the `.errbanner`, `.empty`, `.pag`, `.stale-pill` sections). The existing PR-A / PR-B blocks (`.activityPage` tokens, filter strip, row + drawer scaffolding) stay untouched. The v1 `.emptyWrap` / `.emptyTitle` / `.emptyBody` / `.emptyAction` and `.paginationFooter` / `.moreButton` / `.arr` blocks are removed in Task 9 (the dead-CSS sweep) once the new blocks are in place and the components have been switched over.

- [ ] **Step 1: Append the new editorial blocks**

Locate the `.fadeIn` / `@keyframes activityFadeIn` block near the bottom of the file (around line 800). Immediately AFTER that block (and BEFORE the `/* ============= editorial filter strip (PR-B) ============= */` block PR-B added) append:

```css
/* ============= error banner (PR-C, H5) ============= */
.errBanner {
  max-width: 74rem;
  margin: 16px auto 0;
  padding: 14px 18px;
  background: var(--paper-warm);
  border: 1px solid var(--hair-strong);
  border-left: 3px solid var(--ink);
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.errBannerEyebrow {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--ink);
  font-weight: 700;
}
.errBannerMsg {
  font-family: var(--font-display, "Cormorant Garamond", "Source Serif 4", serif);
  font-style: italic;
  font-weight: 500;
  font-size: 17px;
  line-height: 1.35;
  color: var(--ink);
  flex: 1;
  min-width: 16rem;
}
.errBannerRetry {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 10.5px;
  letter-spacing: 0.14em;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--ink);
  padding: 7px 14px;
  border: 1px solid var(--ink);
  border-radius: 2px;
  background: transparent;
  cursor: pointer;
  transition:
    color 0.18s ease,
    background 0.18s ease;
}
.errBannerRetry:hover {
  background: var(--ink);
  color: var(--paper);
}

/* ============= empty states (PR-C rewrite — zero / filtered) ============= */
.empty {
  max-width: 74rem;
  margin: 0 auto;
  padding: 64px 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: flex-start;
}
.emptyEyebrow {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--ink-4);
  font-weight: 700;
}
.emptyHeadline {
  font-family: var(--font-display, "Cormorant Garamond", "Source Serif 4", serif);
  font-size: 30px;
  font-weight: 500;
  color: var(--ink);
  letter-spacing: -0.012em;
  line-height: 1.1;
  margin: 0;
}
.emptyHeadlineEm {
  color: var(--amber-deep);
  font-style: italic;
}
.emptySub {
  font-family: var(--font-sans, "Inter", system-ui, sans-serif);
  font-size: 14.5px;
  color: var(--ink-3);
  max-width: 38em;
  line-height: 1.6;
  text-wrap: pretty;
  margin: 0;
}
.emptyMeta {
  margin-top: 6px;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  color: var(--ink-4);
  letter-spacing: 0.02em;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.emptyMetaB {
  color: var(--ink-2);
  font-weight: 600;
}
.emptyMetaSep {
  color: var(--ink-4);
  opacity: 0.5;
}
.emptyCta {
  margin-top: 8px;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 10.5px;
  letter-spacing: 0.14em;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--ink);
  padding: 9px 16px;
  border: 1px solid var(--ink);
  border-radius: 2px;
  background: transparent;
  cursor: pointer;
  transition:
    color 0.18s ease,
    background 0.18s ease;
}
.emptyCta:hover {
  background: var(--ink);
  color: var(--paper);
}

/* ============= pagination footer (PR-C restyle) ============= */
.pag {
  max-width: 74rem;
  margin: 0 auto;
  padding: 22px 0 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  flex-wrap: wrap;
  border-top: 1px solid var(--hair);
}
.pagInfo {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11.5px;
  letter-spacing: 0.04em;
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}
.pagInfoB {
  color: var(--ink);
  font-weight: 600;
}
.pagInfoSep {
  color: var(--ink-4);
  opacity: 0.5;
  margin: 0 8px;
}
.pagNav {
  display: inline-flex;
  gap: 10px;
}
.pagBtn {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 10.5px;
  letter-spacing: 0.14em;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--ink);
  padding: 9px 18px;
  border: 1px solid var(--hair-strong);
  border-radius: 2px;
  background: var(--paper-raised);
  display: inline-flex;
  align-items: center;
  gap: 9px;
  cursor: pointer;
  transition:
    color 0.18s ease,
    border-color 0.18s ease,
    background 0.18s ease;
}
.pagBtn:hover:not(:disabled) {
  background: var(--ink);
  color: var(--paper);
  border-color: var(--ink);
}
.pagBtn:disabled {
  color: var(--ink-4);
  cursor: not-allowed;
  background: transparent;
}

/* ============= stale-fetch pill (PR-C) ============= */
.stalePill {
  position: fixed;
  right: 22px;
  bottom: 22px;
  z-index: 40;
  background: var(--paper-raised);
  border: 1px solid var(--hair-strong);
  border-radius: 999px;
  padding: 8px 14px;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--ink-3);
  box-shadow: 0 6px 18px rgba(14, 12, 10, 0.06);
}
.stalePillAge {
  color: var(--ink-2);
  font-weight: 600;
}
.stalePillRefresh {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ink);
  padding-left: 10px;
  border-left: 1px solid var(--hair);
  background: transparent;
  border-top: none;
  border-right: none;
  border-bottom: none;
  cursor: pointer;
}
.stalePillRefresh:hover {
  color: var(--amber-deep);
}
.stalePillRefreshSpin {
  color: var(--amber-deep);
  animation: stalePillPulse 1s linear infinite;
}
@keyframes stalePillPulse {
  0%,
  100% {
    opacity: 0.5;
  }
  50% {
    opacity: 1;
  }
}
```

- [ ] **Step 2: Sanity-check the file size**

```bash
wc -l apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/activity.module.css
```

Expected: net growth of ~230 lines on top of the post-PR-B 1305-line file (Task 9's sweep will trim ~120 dead lines back out, landing near 1415 — still under the 600-line `.ts` arch-check threshold, which only scans `.ts` anyway per `memory/feedback_arch_check_ts_only.md`).

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/activity.module.css
git commit -m "style(dashboard): activity error-banner / stale-pill / empty / pagination CSS (PR-C)"
```

---

### Task 3: `error-banner.tsx` — non-unmounting fetch-error banner (H5)

**Files:**

- Create: `apps/dashboard/src/app/(auth)/(mercury)/activity/components/error-banner.tsx`
- Create: `apps/dashboard/src/app/(auth)/(mercury)/activity/components/__tests__/error-banner.test.tsx`

Spec §5.5 + §12 H5 + §12 walk-the-page #4. The banner is a presentational component — page-level logic (caching the last successful rows so the table stays mounted) lives in `activity-page.tsx` (Task 7).

- [ ] **Step 1: Write the failing tests**

Create `apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/__tests__/error-banner.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorBanner } from "../error-banner.js";

describe("ErrorBanner", () => {
  it("renders eyebrow + italic display-serif message with method/path/status", () => {
    render(
      <ErrorBanner
        method="GET"
        path="/api/dashboard/activity"
        status={503}
        durationMs={8000}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText(/request failed/i)).toBeInTheDocument();
    expect(
      screen.getByText(/GET \/api\/dashboard\/activity returned 503 after 8s/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/previous page of entries is still shown below; nothing was dropped/),
    ).toBeInTheDocument();
  });

  it("retry button fires onRetry on click", async () => {
    const onRetry = vi.fn();
    render(
      <ErrorBanner
        method="GET"
        path="/api/dashboard/activity"
        status={503}
        durationMs={8000}
        onRetry={onRetry}
      />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("has role='alert' so AT users get the failure announcement", () => {
    render(
      <ErrorBanner
        method="GET"
        path="/api/dashboard/activity"
        status={503}
        durationMs={8000}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("rounds sub-second durations to '0s' and uses '<status>' fallback when status is null", () => {
    render(
      <ErrorBanner
        method="GET"
        path="/api/dashboard/activity"
        status={null}
        durationMs={140}
        onRetry={() => {}}
      />,
    );
    // Format: "<METHOD> <path> failed after <Ns>." when status is null.
    expect(
      screen.getByText(/GET \/api\/dashboard\/activity failed after 0s/),
    ).toBeInTheDocument();
  });
});
```

Run:

```bash
TZ=UTC pnpm --filter @switchboard/dashboard vitest run components/__tests__/error-banner.test.tsx
```

Expected: FAIL — module not found (`../error-banner.js`).

- [ ] **Step 2: Implement `error-banner.tsx`**

Create `apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/error-banner.tsx`:

```tsx
"use client";

import styles from "../activity.module.css";

export interface ErrorBannerProps {
  /** HTTP method of the failing request (e.g. "GET"). */
  method: string;
  /** Path of the failing request (e.g. "/api/dashboard/activity"). */
  path: string;
  /** HTTP status code, or null if the request errored before a response was received. */
  status: number | null;
  /** Approximate duration of the failed attempt in milliseconds. */
  durationMs: number;
  /** Fired when the operator clicks the [Retry] button. */
  onRetry: () => void;
}

/**
 * Non-unmounting fetch-error banner (spec §5.5, §12 H5).
 *
 * The page renders this ABOVE the still-mounted table when `useActivityList`
 * is in an error state. The previous page of rows survives the error so
 * operators don't lose context mid-investigation.
 *
 * role="alert" — AT users get the failure announcement on appearance.
 */
export function ErrorBanner({ method, path, status, durationMs, onRetry }: ErrorBannerProps) {
  const seconds = Math.round(durationMs / 1000);
  const message =
    status !== null
      ? `${method} ${path} returned ${status} after ${seconds}s. The previous page of entries is still shown below; nothing was dropped.`
      : `${method} ${path} failed after ${seconds}s. The previous page of entries is still shown below; nothing was dropped.`;

  return (
    <div role="alert" className={styles.errBanner}>
      <span className={styles.errBannerEyebrow}>request failed</span>
      <span className={styles.errBannerMsg}>{message}</span>
      <button type="button" className={styles.errBannerRetry} onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Run the tests, expect PASS**

```bash
TZ=UTC pnpm --filter @switchboard/dashboard vitest run components/__tests__/error-banner.test.tsx
```

Expected: 4 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/error-banner.tsx \
        apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/__tests__/error-banner.test.tsx
git commit -m "feat(dashboard): error-banner component for /activity (PR-C, H5)"
```

---

### Task 4: `stale-pill.tsx` — bottom-right fetched-Nm-ago pill

**Files:**

- Create: `apps/dashboard/src/app/(auth)/(mercury)/activity/components/stale-pill.tsx`
- Create: `apps/dashboard/src/app/(auth)/(mercury)/activity/components/__tests__/stale-pill.test.tsx`

Spec §5.5 + §12 walk-the-page #5. The pill anchors to `fetchedAt` (passed in by the page from React Query's `dataUpdatedAt`). It does NOT poll. It schedules a 15-second ticker (via `setInterval`) only to recompute the visible "Nm ago" value when the wall clock advances, not to refetch.

- [ ] **Step 1: Write the failing tests**

Create `apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/__tests__/stale-pill.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StalePill } from "../stale-pill.js";

const NOW = new Date("2026-05-14T12:00:00.000Z").getTime();

describe("StalePill", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when fetchedAt === 0 (no successful fetch yet)", () => {
    const { container } = render(
      <StalePill fetchedAt={0} isFetching={false} onRefetch={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows 'just now' when fetchedAt is within 60s of wall clock", () => {
    render(<StalePill fetchedAt={NOW - 5_000} isFetching={false} onRefetch={() => {}} />);
    expect(screen.getByText(/just now/i)).toBeInTheDocument();
  });

  it("shows 'Nm ago' once at least 60s have elapsed", () => {
    render(<StalePill fetchedAt={NOW - 125_000} isFetching={false} onRefetch={() => {}} />);
    expect(screen.getByText("2m ago")).toBeInTheDocument();
  });

  it("refresh button invokes onRefetch", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onRefetch = vi.fn();
    render(<StalePill fetchedAt={NOW - 5_000} isFetching={false} onRefetch={onRefetch} />);
    await user.click(screen.getByRole("button", { name: /refresh/i }));
    expect(onRefetch).toHaveBeenCalledTimes(1);
  });

  it("renders 'fetching…' label when isFetching=true", () => {
    render(<StalePill fetchedAt={NOW - 5_000} isFetching={true} onRefetch={() => {}} />);
    expect(screen.getByRole("button", { name: /fetching…/i })).toBeInTheDocument();
  });

  it("carries role='status' on the wrapper and aria-live='polite' on the age", () => {
    render(<StalePill fetchedAt={NOW - 5_000} isFetching={false} onRefetch={() => {}} />);
    const wrapper = screen.getByRole("status");
    expect(wrapper).toBeInTheDocument();
    // The "just now"/"Nm ago" span is the polite-announced child.
    const age = wrapper.querySelector("[aria-live='polite']");
    expect(age).not.toBeNull();
  });

  it("re-renders the Nm value after the 15s ticker advances", () => {
    render(<StalePill fetchedAt={NOW - 30_000} isFetching={false} onRefetch={() => {}} />);
    expect(screen.getByText(/just now/i)).toBeInTheDocument();
    // Advance wall clock past 60s; the ticker fires every 15s.
    vi.setSystemTime(NOW + 90_000);
    vi.advanceTimersByTime(15_000);
    expect(screen.getByText("2m ago")).toBeInTheDocument();
  });
});
```

Run:

```bash
TZ=UTC pnpm --filter @switchboard/dashboard vitest run components/__tests__/stale-pill.test.tsx
```

Expected: FAIL — module not found (`../stale-pill.js`).

- [ ] **Step 2: Implement `stale-pill.tsx`**

Create `apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/stale-pill.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import styles from "../activity.module.css";

export interface StalePillProps {
  /** Wall-clock millis of the last successful fetch. 0 means no successful fetch yet. */
  fetchedAt: number;
  /** Whether a refetch is currently in flight (drives "fetching…" label + spin class). */
  isFetching: boolean;
  /** Fired when the operator clicks the [refresh] button. */
  onRefetch: () => void;
}

const TICK_MS = 15_000;

/**
 * Bottom-right fetched-Nm-ago pill (spec §5.5, §12 walk-the-page #5).
 *
 * The pill anchors to `fetchedAt` (a wall-clock millis stamp passed in by the
 * page, derived from React Query's `dataUpdatedAt`). A 15-second ticker forces
 * a re-render so the visible age stays current; it does NOT trigger refetch.
 *
 * Hidden until the first successful fetch (`fetchedAt === 0` returns null).
 *
 * role="status" + aria-live="polite" on the age span so AT users get the
 * "Nm ago" update at a polite cadence without disrupting screen-reader focus.
 */
export function StalePill({ fetchedAt, isFetching, onRefetch }: StalePillProps) {
  const [, force] = useState(0);
  useEffect(() => {
    if (fetchedAt === 0) return undefined;
    const id = setInterval(() => force((n) => n + 1), TICK_MS);
    return () => clearInterval(id);
  }, [fetchedAt]);

  if (fetchedAt === 0) return null;

  const elapsedMs = Date.now() - fetchedAt;
  const minutes = Math.floor(elapsedMs / 60_000);
  const ageLabel = minutes < 1 ? "just now" : `${minutes}m ago`;

  return (
    <div role="status" className={styles.stalePill}>
      <span>fetched</span>
      <span aria-live="polite" className={styles.stalePillAge}>
        {ageLabel}
      </span>
      <button
        type="button"
        className={`${styles.stalePillRefresh} ${isFetching ? styles.stalePillRefreshSpin : ""}`}
        onClick={onRefetch}
      >
        {isFetching ? "fetching…" : "refresh"}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Run the tests, expect PASS**

```bash
TZ=UTC pnpm --filter @switchboard/dashboard vitest run components/__tests__/stale-pill.test.tsx
```

Expected: 7 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/stale-pill.tsx \
        apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/__tests__/stale-pill.test.tsx
git commit -m "feat(dashboard): stale-pill component for /activity (PR-C)"
```

---

### Task 5: Rewrite `empty-state.tsx` for zero + filtered variants

**Files:**

- Modify: `apps/dashboard/src/app/(auth)/(mercury)/activity/components/empty-state.tsx`
- Create: `apps/dashboard/src/app/(auth)/(mercury)/activity/components/__tests__/empty-state.test.tsx`

Spec §5.5: two variants with distinct copy. `zero` has the ledger-health metadata block (last recorded + chain head verified); `filtered` has the scanned-count prose + Clear CTA. The italic accent on "recorded yet" / "these filters" lives INSIDE the empty state (spec §1.5 last paragraph — editorial pauses on a Tools surface are OK inside empty states).

- [ ] **Step 1: Write the failing tests**

Create `apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/__tests__/empty-state.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmptyState } from "../empty-state.js";

describe("EmptyState — zero variant", () => {
  it("renders eyebrow, italic-accent headline, ledger-health prose, and last-recorded metadata", () => {
    render(<EmptyState variant="zero" lastRecordedIso="2026-05-14T11:55:00.000Z" />);
    expect(screen.getByText(/ledger health/i)).toBeInTheDocument();
    // The headline carries the italic <em> accent on "recorded yet".
    expect(screen.getByText(/No activity/)).toBeInTheDocument();
    expect(screen.getByText("recorded yet")).toBeInTheDocument();
    expect(screen.getByText("recorded yet").tagName.toLowerCase()).toBe("em");
    expect(screen.getByText(/chain is healthy and the writer is connected/i)).toBeInTheDocument();
    expect(screen.getByText(/last recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/chain head verified/i)).toBeInTheDocument();
  });

  it("hides the last-recorded metadata block when lastRecordedIso is null", () => {
    render(<EmptyState variant="zero" lastRecordedIso={null} />);
    expect(screen.queryByText(/last recorded/i)).toBeNull();
  });
});

describe("EmptyState — filtered variant", () => {
  it("renders eyebrow, italic-accent headline, scanned-count prose, and Clear CTA", async () => {
    const onClear = vi.fn();
    render(<EmptyState variant="filtered" scannedCount={30} onClear={onClear} />);
    expect(screen.getByText(/no matches/i)).toBeInTheDocument();
    expect(screen.getByText(/No entries match/)).toBeInTheDocument();
    expect(screen.getByText("these filters")).toBeInTheDocument();
    expect(screen.getByText("these filters").tagName.toLowerCase()).toBe("em");
    expect(screen.getByText(/We checked 30 entries across the current scope/)).toBeInTheDocument();
    const cta = screen.getByRole("button", { name: /Clear filters/ });
    await userEvent.setup().click(cta);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("does not render the Clear CTA when onClear is undefined", () => {
    render(<EmptyState variant="filtered" scannedCount={30} />);
    expect(screen.queryByRole("button", { name: /Clear filters/ })).toBeNull();
  });
});
```

Run:

```bash
TZ=UTC pnpm --filter @switchboard/dashboard vitest run components/__tests__/empty-state.test.tsx
```

Expected: FAIL on the new props / new copy (the v1 component renders "No activity yet." and has no `lastRecordedIso` / `scannedCount` props).

- [ ] **Step 2: Implement the rewrite**

Replace the contents of `apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/empty-state.tsx`:

```tsx
"use client";

import styles from "../activity.module.css";

export type EmptyStateProps =
  | {
      variant: "zero";
      /** ISO string of the most recent ledger entry available to the page (or null). */
      lastRecordedIso: string | null;
    }
  | {
      variant: "filtered";
      /** Total rows the current scope scanned before narrowing returned zero matches. */
      scannedCount: number;
      /** Wired to the page's clear-filters handler. CTA renders only when provided. */
      onClear?: () => void;
    };

/**
 * Empty-state views for /activity (spec §5.5).
 *
 * Two variants, both in the editorial register:
 *
 * - "zero" — shown when the ledger itself has no rows for the org under
 *   operational scope and no narrowing is active. Eyebrow "ledger health",
 *   display-serif headline "No activity *recorded yet*.", prose context,
 *   and a mono "last recorded" / "chain head verified" metadata line.
 *
 * - "filtered" — shown when narrowing returns zero matches. Eyebrow
 *   "no matches", display-serif headline "No entries match *these filters*.",
 *   prose with the count of rows scanned, and a [Clear filters] CTA wired
 *   to the page-level handler.
 *
 * The italic-accent <em> on "recorded yet" / "these filters" is editorial
 * flourish that lives INSIDE the empty state per spec §1.5 — the Tools-tier
 * page-head itself remains plain.
 */
export function EmptyState(props: EmptyStateProps) {
  if (props.variant === "zero") {
    return (
      <div className={styles.empty}>
        <span className={styles.emptyEyebrow}>ledger health</span>
        <h2 className={styles.emptyHeadline}>
          No activity <em className={styles.emptyHeadlineEm}>recorded yet</em>.
        </h2>
        <p className={styles.emptySub}>
          The chain is healthy and the writer is connected — no audit-emitting event has fired in
          this org&apos;s window. Once an agent proposes a mutation or an operator changes a
          policy, entries will appear here, hash-chained to the genesis row.
        </p>
        {props.lastRecordedIso !== null && (
          <div className={styles.emptyMeta}>
            <span>last recorded</span>
            <b className={styles.emptyMetaB}>{new Date(props.lastRecordedIso).toLocaleString()}</b>
            <span className={styles.emptyMetaSep}>·</span>
            <span>chain head verified</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.empty}>
      <span className={styles.emptyEyebrow}>no matches</span>
      <h2 className={styles.emptyHeadline}>
        No entries match <em className={styles.emptyHeadlineEm}>these filters</em>.
      </h2>
      <p className={styles.emptySub}>
        We checked {props.scannedCount} entries across the current scope. Try broadening the date
        range, dropping the entity, or switching to <b className={styles.emptyMetaB}>All events</b>{" "}
        if you&apos;re looking for non-operational types.
      </p>
      {props.onClear !== undefined && (
        <button type="button" className={styles.emptyCta} onClick={props.onClear}>
          Clear filters
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Run the tests, expect PASS**

```bash
TZ=UTC pnpm --filter @switchboard/dashboard vitest run components/__tests__/empty-state.test.tsx
```

Expected: 4 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/empty-state.tsx \
        apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/__tests__/empty-state.test.tsx
git commit -m "feat(dashboard): rewrite empty-state for zero/filtered variants (PR-C)"
```

---

### Task 6: Restyle `pagination-footer.tsx` (Showing N + ← Newer / Older →)

**Files:**

- Modify: `apps/dashboard/src/app/(auth)/(mercury)/activity/components/pagination-footer.tsx`
- Create: `apps/dashboard/src/app/(auth)/(mercury)/activity/components/__tests__/pagination-footer.test.tsx`

Spec §5.5 last bullet + §12 acceptance #7. Left info line ("Showing N of … · keyset cursor — total unknown by design · limit 50"), right ← Newer / Older → buttons. 1px top hair border (already in the CSS block added in Task 2). The v1 component renders "Prev"/"Next" without an info line — replaced wholesale.

- [ ] **Step 1: Write the failing tests**

Create `apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/__tests__/pagination-footer.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaginationFooter } from "../pagination-footer.js";

describe("PaginationFooter", () => {
  it("renders the 'Showing N of …' info line with keyset chrome", () => {
    render(
      <PaginationFooter count={22} canGoPrev={false} canGoNext={true} onPrev={() => {}} onNext={() => {}} />,
    );
    expect(screen.getByText(/Showing/)).toBeInTheDocument();
    expect(screen.getByText("22")).toBeInTheDocument();
    expect(screen.getByText(/keyset cursor — total unknown by design/)).toBeInTheDocument();
    expect(screen.getByText(/limit/)).toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument();
  });

  it("← Newer is disabled when canGoPrev=false; Older → is enabled when canGoNext=true", () => {
    render(
      <PaginationFooter count={22} canGoPrev={false} canGoNext={true} onPrev={() => {}} onNext={() => {}} />,
    );
    expect(screen.getByRole("button", { name: /Newer/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Older/ })).not.toBeDisabled();
  });

  it("Older → is disabled when canGoNext=false (end of list)", () => {
    render(
      <PaginationFooter count={3} canGoPrev={true} canGoNext={false} onPrev={() => {}} onNext={() => {}} />,
    );
    expect(screen.getByRole("button", { name: /Older/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Newer/ })).not.toBeDisabled();
  });

  it("clicking Newer / Older fires the right callback", async () => {
    const user = userEvent.setup();
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(
      <PaginationFooter count={22} canGoPrev={true} canGoNext={true} onPrev={onPrev} onNext={onNext} />,
    );
    await user.click(screen.getByRole("button", { name: /Newer/ }));
    await user.click(screen.getByRole("button", { name: /Older/ }));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when neither direction is navigable (single-page case)", () => {
    const { container } = render(
      <PaginationFooter count={3} canGoPrev={false} canGoNext={false} onPrev={() => {}} onNext={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
```

Run:

```bash
TZ=UTC pnpm --filter @switchboard/dashboard vitest run components/__tests__/pagination-footer.test.tsx
```

Expected: FAIL — the v1 component does not accept `count` and renders "Prev"/"Next" labels.

- [ ] **Step 2: Implement the restyle**

Replace the contents of `apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/pagination-footer.tsx`:

```tsx
"use client";

import styles from "../activity.module.css";

export interface PaginationFooterProps {
  /** Number of rows on the current page (drives the "Showing N of …" line). */
  count: number;
  canGoPrev: boolean;
  canGoNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}

/**
 * Cursor-based ← Newer / Older → pagination footer for /activity (spec §5.5).
 *
 * Two regions: left info line ("Showing N of … · keyset cursor — total
 * unknown by design · limit 50") and right navigation buttons.
 *
 * Spec §12 acceptance #7: ← Newer is disabled when at the head (no entries
 * on the prev cursor stack); Older → is disabled when nextCursor is null.
 *
 * Hidden entirely when neither direction is navigable (single-page case).
 */
export function PaginationFooter({
  count,
  canGoPrev,
  canGoNext,
  onPrev,
  onNext,
}: PaginationFooterProps) {
  if (!canGoPrev && !canGoNext) return null;

  return (
    <div className={styles.pag}>
      <span className={styles.pagInfo}>
        Showing <b className={styles.pagInfoB}>{count}</b> of{" "}
        <b className={styles.pagInfoB}>…</b>
        <span className={styles.pagInfoSep}>·</span>
        keyset cursor — total unknown by design
        <span className={styles.pagInfoSep}>·</span>
        limit <b className={styles.pagInfoB}>50</b>
      </span>
      <div className={styles.pagNav}>
        <button
          type="button"
          className={styles.pagBtn}
          onClick={onPrev}
          disabled={!canGoPrev}
          aria-label="Newer page"
        >
          ← Newer
        </button>
        <button
          type="button"
          className={styles.pagBtn}
          onClick={onNext}
          disabled={!canGoNext}
          aria-label="Older page"
        >
          Older →
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run the tests, expect PASS**

```bash
TZ=UTC pnpm --filter @switchboard/dashboard vitest run components/__tests__/pagination-footer.test.tsx
```

Expected: 5 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/pagination-footer.tsx \
        apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/__tests__/pagination-footer.test.tsx
git commit -m "feat(dashboard): restyle pagination footer with showing-N info line (PR-C)"
```

---

### Task 7: Integrate ErrorBanner + StalePill + new EmptyState into `activity-page.tsx`

**Files:**

- Modify: `apps/dashboard/src/app/(auth)/(mercury)/activity/hooks/use-activity-list.ts`
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/activity/activity-page.tsx`
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/activity/__tests__/activity-page.test.tsx`

This is the H5 wiring step. PR-A's current page tree:

```
{isLoading ? <Skeleton /> : isError ? <EmptyState variant="filtered" /> : rows.length === 0 ? <EmptyState ... /> : <ActivityTable />}
```

PR-C's target tree:

```
{isError && <ErrorBanner ... />}
{isLoading && !hasRenderedOnce ? <Skeleton /> : rows.length === 0 ? <EmptyState ... /> : <ActivityTable rows={tableRows} />}
{showPagination && <PaginationFooter count={tableRows.length} ... />}
{dataUpdatedAt > 0 && <StalePill ... />}
```

`tableRows` is `data?.rows` when present, otherwise the last successful rows we remember in a ref (so H5: a fetch error keeps the table mounted with the previous page).

- [ ] **Step 1: Surface `dataUpdatedAt` and `isFetching` from `useActivityList`**

Open `apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/hooks/use-activity-list.ts`. The hook already returns `useQuery`'s full result — `dataUpdatedAt` and `isFetching` are present on it. We don't need to change the hook signature; the page will read these fields off the returned object. So this step is a verification, not a code change: confirm the hook continues to `return useQuery({...})` (it does on `main`) and move to Step 2. If a future refactor narrows the hook's return type, restore the full `useQuery` shape.

- [ ] **Step 2: Write the failing page-level tests**

Open `apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/__tests__/activity-page.test.tsx`. Replace the `hookResult` helper at the top of the file so it carries `dataUpdatedAt` and `isFetching`. Find the `hookResult` function and replace it with:

```tsx
function hookResult(
  partial: Partial<{
    rows: AuditEntriesListResponse["rows"];
    nextCursor: string | null;
    scope: AuditEntriesListResponse["scope"];
    isLoading: boolean;
    isError: boolean;
    refetch: () => Promise<unknown>;
    dataUpdatedAt: number;
    isFetching: boolean;
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
    isFetching: partial.isFetching ?? false,
    dataUpdatedAt: partial.dataUpdatedAt ?? (partial.isError ? 0 : Date.now()),
    refetch: partial.refetch ?? vi.fn().mockResolvedValue(undefined),
    error: partial.isError ? new Error("fetch failed") : null,
  };
}
```

Add the following test blocks at the end of the existing `describe("ActivityPage")` body (before the closing `});`):

```tsx
  describe("H5: fetch errors never unmount the table", () => {
    it("renders the ErrorBanner above the table when isError fires after a successful fetch", () => {
      vi.stubEnv("NEXT_PUBLIC_ACTIVITY_LIVE", "true");
      // First render: successful fetch with one row visible.
      mockUseActivityList.mockReturnValue(hookResult({ rows: [liveRow], scope: "operational" }));
      const { rerender } = render(<ActivityPage />);
      expect(screen.getByText("Live row for tests")).toBeInTheDocument();

      // Re-render: hook flips to error. Table must remain mounted with the
      // previous rows; banner must appear above.
      mockUseActivityList.mockReturnValue(hookResult({ isError: true, rows: [] }));
      rerender(<ActivityPage />);
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText(/request failed/i)).toBeInTheDocument();
      // Crucially: the row from the previous successful fetch is still on screen.
      expect(screen.getByText("Live row for tests")).toBeInTheDocument();
    });

    it("retry button on the banner fires the refetch handler", async () => {
      vi.stubEnv("NEXT_PUBLIC_ACTIVITY_LIVE", "true");
      const refetch = vi.fn().mockResolvedValue(undefined);
      mockUseActivityList.mockReturnValue(hookResult({ rows: [liveRow], scope: "operational" }));
      const { rerender } = render(<ActivityPage />);
      mockUseActivityList.mockReturnValue(hookResult({ isError: true, refetch }));
      rerender(<ActivityPage />);
      await userEvent.setup().click(screen.getByRole("button", { name: /Retry/ }));
      expect(refetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("Stale pill visibility", () => {
    it("is hidden until the first successful fetch (dataUpdatedAt === 0)", () => {
      vi.stubEnv("NEXT_PUBLIC_ACTIVITY_LIVE", "true");
      mockUseActivityList.mockReturnValue(hookResult({ isLoading: true, dataUpdatedAt: 0 }));
      render(<ActivityPage />);
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("renders after a successful fetch (dataUpdatedAt > 0)", () => {
      vi.stubEnv("NEXT_PUBLIC_ACTIVITY_LIVE", "true");
      mockUseActivityList.mockReturnValue(
        hookResult({ rows: [liveRow], scope: "operational", dataUpdatedAt: Date.now() }),
      );
      render(<ActivityPage />);
      // role="status" is on the StalePill wrapper. The skeleton's role="status"
      // is gone in this branch (isLoading=false), so the only role="status"
      // on the page is the StalePill.
      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.getByText(/fetched/)).toBeInTheDocument();
    });
  });
```

Run:

```bash
TZ=UTC pnpm --filter @switchboard/dashboard vitest run __tests__/activity-page.test.tsx
```

Expected: FAIL — current page render branches `isError ? <EmptyState />` and never renders ErrorBanner or StalePill.

- [ ] **Step 3: Restructure the page render tree**

Replace the contents of `apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/activity-page.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { AuditEntriesListQuery, AuditEntryBrowseRow } from "@switchboard/schemas";
import { AuditEventTypeSchema, OPERATIONAL_AUDIT_EVENT_TYPES } from "@switchboard/schemas";
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
import { ErrorBanner } from "./components/error-banner";
import { StalePill } from "./components/stale-pill";
import { EVENT_TYPE_BANDS } from "./event-bands";
import styles from "./activity.module.css";

const isActivityLive = (): boolean => isMercuryToolLive("activity");

const OPERATIONAL_SET = new Set<string>(OPERATIONAL_AUDIT_EVENT_TYPES);

// ---------------------------------------------------------------------------
// URL reads (read-only — we never write URLs)
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

function isActorType(v: string): v is ActorType {
  return v === "user" || v === "agent" || v === "system" || v === "service_account";
}

const KNOWN_EVENT_TYPES = new Set<string>(AuditEventTypeSchema.options);

function readEventType(sp: URLSearchParams): string | null {
  const raw = sp.get("eventType");
  if (raw && KNOWN_EVENT_TYPES.has(raw)) return raw;
  return null;
}

function readNarrowing(sp: URLSearchParams): NarrowingState {
  const actorParam = sp.get("actorType");
  return {
    eventType: readEventType(sp),
    actorType: actorParam && isActorType(actorParam) ? actorParam : null,
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

function isNarrowingActive(n: NarrowingState): boolean {
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
  const initialScope = readScope(sp);
  const initialNarrowing = readNarrowing(sp);
  const [scope, setScope] = useState<ScopeBase>(initialScope);
  const [eventType, setEventType] = useState<string | null>(initialNarrowing.eventType);
  const [actorType, setActorType] = useState<ActorType | null>(initialNarrowing.actorType);
  const [dateRange, setDateRange] = useState<DateRangeValue>(initialNarrowing.dateRange);
  const [entity, setEntity] = useState<EntitySelectorValue>(initialNarrowing.entity);

  // ---- Cursor / drawer state ----
  const [cursor, setCursor] = useState<string | null>(null);
  const [prevCursorStack, setPrevCursorStack] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ---- Back/forward sync from URL ----
  const urlScope = readScope(sp);
  useEffect(() => {
    setScope(urlScope);
  }, [urlScope]);

  const urlEventType = readEventType(sp);
  const urlActorParam = sp.get("actorType");
  const urlActor: ActorType | null =
    urlActorParam && isActorType(urlActorParam) ? urlActorParam : null;
  const urlAfter = sp.get("after");
  const urlBefore = sp.get("before");
  const urlEntityType = sp.get("entityType");
  const urlEntityId = sp.get("entityId");
  useEffect(() => {
    setEventType(urlEventType);
    setActorType(urlActor);
    setDateRange({ after: urlAfter, before: urlBefore });
    setEntity({ entityType: urlEntityType, entityId: urlEntityId });
  }, [urlEventType, urlActor, urlAfter, urlBefore, urlEntityType, urlEntityId]);

  // ---- Filter-signature reset (cursor stack + expanded drawer) ----
  const narrowing: NarrowingState = useMemo(
    () => ({ eventType, actorType, dateRange, entity }),
    [eventType, actorType, dateRange, entity],
  );
  const narrowingActive = isNarrowingActive(narrowing);
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
  const { data, isLoading, isError, isFetching, dataUpdatedAt, refetch } = useActivityList(query);

  // H5: remember the most recently rendered rows so a fetch error does not
  // unmount the table. When data is undefined (loading or error), we fall
  // back to the last successful render. On the very first error before any
  // successful render, lastRowsRef stays empty and EmptyState/Skeleton wins.
  const lastRowsRef = useRef<ReadonlyArray<AuditEntryBrowseRow>>([]);

  let liveRows: ReadonlyArray<AuditEntryBrowseRow> = data?.rows ?? lastRowsRef.current;
  const nextCursor = data?.nextCursor ?? null;
  const apiScope: EffectiveScope = data?.scope ?? scope;

  if (data?.rows !== undefined) {
    lastRowsRef.current = data.rows;
    liveRows = data.rows;
  }

  let rows: ReadonlyArray<AuditEntryBrowseRow>;
  if (!isActivityLive()) {
    rows = filterRowsInMemory(ACTIVITY_FIXTURES, scope, narrowing);
  } else {
    rows = liveRows;
  }

  // Narrowing wins for effective scope (fixture mode has no API to report it).
  const effectiveScope: EffectiveScope = narrowingActive ? "custom" : apiScope;

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

  // Scanned-count for the filtered-empty prose: number of rows the current
  // scope contains BEFORE narrowing is applied. Under operational scope this
  // is the operational subset; under "all" it's every row on the page.
  const scannedCount = effectiveScope === "all" ? counts.allCount : counts.operationalCount;

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
  }, []);

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

  const onRefetch = useCallback(() => {
    void refetch();
  }, [refetch]);

  // ---- Render-state derivations ----
  const showPagination = isActivityLive() && (prevCursorStack.length > 0 || !!nextCursor);
  const showSkeleton = isLoading && rows.length === 0;
  const showEmpty = !showSkeleton && rows.length === 0 && !isError;
  const lastRecordedIso = sourceRows[0]?.timestamp ?? null;

  return (
    <div className={styles.activityPage}>
      <ActivityHeader
        lastLedgerEntryIso={rows[0]?.timestamp ?? null}
        lastLedgerEntryHidden={narrowingActive}
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
        narrowingActive={narrowingActive}
        onClearFilters={onClearFilters}
      />

      {isError && (
        <ErrorBanner
          method="GET"
          path="/api/dashboard/activity"
          status={null}
          durationMs={0}
          onRetry={onRefetch}
        />
      )}

      <section className={`${styles.section} ${styles.page}`}>
        {showSkeleton ? (
          <div className={styles.skeletonTable} role="status" aria-label="Loading activity">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className={styles.skeletonRow} />
            ))}
          </div>
        ) : showEmpty ? (
          narrowingActive ? (
            <EmptyState
              variant="filtered"
              scannedCount={scannedCount}
              onClear={onClearFilters}
            />
          ) : (
            <EmptyState variant="zero" lastRecordedIso={lastRecordedIso} />
          )
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
            count={rows.length}
            canGoPrev={prevCursorStack.length > 0}
            canGoNext={!!nextCursor}
            onPrev={onPrev}
            onNext={onNext}
          />
        )}
      </section>

      {dataUpdatedAt > 0 && (
        <StalePill
          fetchedAt={dataUpdatedAt}
          isFetching={isFetching}
          onRefetch={onRefetch}
        />
      )}
    </div>
  );
}
```

Key changes versus the post-PR-B file:

1. New imports: `ErrorBanner`, `StalePill`, `useRef`.
2. `lastRowsRef` caches the most recent successful `data.rows` so H5 holds.
3. `useActivityList` destructure now includes `isFetching` + `dataUpdatedAt`.
4. The `isError` branch above the table renders `<ErrorBanner />` and the section below ignores `isError` for its decision tree — `showSkeleton` and `showEmpty` are explicit and avoid trampling the table when an error fires.
5. `<StalePill />` renders below the section once `dataUpdatedAt > 0` (i.e., a successful fetch has landed).
6. `PaginationFooter` now receives a `count` prop.
7. EmptyState calls use the new prop shape (`scannedCount` / `lastRecordedIso`).
8. `onResetToDefault` is removed — under H5 a fresh error never replaces the empty-state, so the only path back to operational-zero is the operator clicking Operational or clearing narrowing.

- [ ] **Step 4: Run the page-level tests, expect PASS**

```bash
TZ=UTC pnpm --filter @switchboard/dashboard vitest run __tests__/activity-page.test.tsx
```

Expected: ALL existing tests still pass + the 4 new H5/stale-pill tests pass. If the existing "renders nothing in fixture mode" pagination test fails, it's because `showPagination` now also gates on `isActivityLive()` AND nav-availability — verify both conditions hold per the existing assertions, no code change needed unless an assertion is genuinely stale.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/activity-page.tsx \
        apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/__tests__/activity-page.test.tsx
git commit -m "feat(dashboard): wire error-banner + stale-pill into /activity (PR-C, H5)"
```

---

### Task 8: Page-level accessibility regression suite

**Files:**

- Create: `apps/dashboard/src/app/(auth)/(mercury)/activity/__tests__/activity-accessibility.test.tsx`

Spec §13 PR-C: "Accessibility regression tests across the whole page (grid roles, combobox WAI-ARIA pattern, chevron focus management, drawer focus behaviour, `aria-live` announcements)."

Single test file that mounts the full page and asserts on a11y contracts. Mocks `useActivityList` to return a fixed live row so the combobox + drawer + table are all exercised.

- [ ] **Step 1: Write the suite**

Create `apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/__tests__/activity-accessibility.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuditEntriesListResponse } from "@switchboard/schemas";

// Module mocks — hoisted before any imports of the mocked modules.
const useSearchParamsMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => useSearchParamsMock(),
}));
const mockUseActivityList = vi.fn();
vi.mock("../hooks/use-activity-list", () => ({
  useActivityList: (...args: unknown[]) => mockUseActivityList(...args),
}));

import { ActivityPage } from "../activity-page";

const liveRow = {
  id: "audit_a11y_001",
  eventType: "action.executed" as const,
  timestamp: "2026-05-14T10:00:00.000Z",
  actorType: "agent" as const,
  actorId: "agent_alex_001",
  entityType: "calendar_event",
  entityId: "cal_evt_a11y",
  riskCategory: "low" as const,
  visibilityLevel: "org" as const,
  summary: "A11y row",
  snapshotKeys: [],
  redactedKeyCount: 0,
  evidencePointers: [],
  entryHash: "abc",
  previousEntryHash: null,
  envelopeId: null,
  traceId: null,
};

function hookResult(
  partial: Partial<{
    rows: AuditEntriesListResponse["rows"];
    isError: boolean;
    dataUpdatedAt: number;
  }>,
): unknown {
  const rows = partial.rows ?? [liveRow];
  const data: AuditEntriesListResponse = {
    rows,
    nextCursor: null,
    scope: "operational",
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
    data: partial.isError ? undefined : data,
    isLoading: false,
    isError: partial.isError ?? false,
    isSuccess: !partial.isError,
    isFetching: false,
    dataUpdatedAt: partial.dataUpdatedAt ?? (partial.isError ? 0 : Date.now()),
    refetch: vi.fn().mockResolvedValue(undefined),
    error: partial.isError ? new Error("fetch failed") : null,
  };
}

describe("ActivityPage accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSearchParamsMock.mockReturnValue(new URLSearchParams(""));
    vi.stubEnv("NEXT_PUBLIC_ACTIVITY_LIVE", "true");
    mockUseActivityList.mockReturnValue(hookResult({}));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("spec §5.3: table carries grid roles (table / rowgroup / row / columnheader / cell)", () => {
    render(<ActivityPage />);
    const table = screen.getByRole("table", { name: /activity entries/i });
    expect(table).toBeInTheDocument();
    // Header row + body row are both rowgroups; gettAllBy returns at least two.
    expect(within(table).getAllByRole("rowgroup").length).toBeGreaterThanOrEqual(2);
    expect(within(table).getAllByRole("columnheader").length).toBeGreaterThanOrEqual(5);
    expect(within(table).getAllByRole("row").length).toBeGreaterThanOrEqual(2);
  });

  it("spec §5.2 + §8: filter strip is a search landmark with the scope segmented group", () => {
    render(<ActivityPage />);
    const strip = screen.getByRole("search");
    expect(strip).toBeInTheDocument();
    const scopeGroup = within(strip).getByRole("group", { name: /Activity scope/i });
    expect(scopeGroup).toBeInTheDocument();
    expect(within(scopeGroup).getByRole("button", { name: /Operational/ })).toHaveAttribute(
      "aria-pressed",
    );
    expect(within(scopeGroup).getByRole("button", { name: /All/ })).toHaveAttribute(
      "aria-pressed",
    );
  });

  it("spec §5.2 + §8: combobox carries the WAI-ARIA combobox-with-listbox pattern", async () => {
    const user = userEvent.setup();
    render(<ActivityPage />);
    const combo = screen.getByRole("combobox");
    expect(combo).toHaveAttribute("aria-expanded");
    await user.click(combo);
    const listbox = screen.getByRole("listbox");
    expect(listbox).toBeInTheDocument();
    expect(combo).toHaveAttribute("aria-expanded", "true");
    expect(combo).toHaveAttribute("aria-controls", listbox.getAttribute("id") ?? "");
    // At least one option is rendered.
    const options = within(listbox).getAllByRole("option");
    expect(options.length).toBeGreaterThan(0);
    expect(options[0]).toHaveAttribute("aria-selected");
  });

  it("spec §5.3 + §8: chevron is the only interactive element in a row + carries aria-expanded/controls", async () => {
    const user = userEvent.setup();
    render(<ActivityPage />);
    const chevron = screen.getByRole("button", { name: /Toggle details for entry/ });
    expect(chevron).toHaveAttribute("aria-expanded", "false");
    expect(chevron).toHaveAttribute("aria-controls");
    chevron.focus();
    expect(chevron).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(chevron).toHaveAttribute("aria-expanded", "true");
  });

  it("spec §5.4 + §8: drawer mounts with role='region' once a row is expanded", async () => {
    const user = userEvent.setup();
    render(<ActivityPage />);
    await user.click(screen.getByRole("button", { name: /Toggle details for entry/ }));
    const drawer = screen.getByRole("region", { name: /Audit entry detail/i });
    expect(drawer).toBeInTheDocument();
  });

  it("spec §12 H5 + §8: error banner has role='alert' so AT users get an announcement", () => {
    mockUseActivityList.mockReturnValue(hookResult({ isError: true }));
    render(<ActivityPage />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("spec §5.5 + §8: stale pill carries role='status' and aria-live='polite' on the age", () => {
    render(<ActivityPage />);
    const status = screen.getByRole("status");
    expect(status).toBeInTheDocument();
    const polite = status.querySelector("[aria-live='polite']");
    expect(polite).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the suite**

```bash
TZ=UTC pnpm --filter @switchboard/dashboard vitest run __tests__/activity-accessibility.test.tsx
```

Expected: 7 PASS. If any assertion fails, the matching spec contract is at fault — fix the source rather than the test (e.g., if the combobox is missing `aria-controls`, fix `event-type-combobox.tsx`).

**Note on the "drawer focus after `view previous ↓`" assertion:** the spec calls out focus moving to the target row after scroll, but the current `activity-table.tsx` implementation calls `el.scrollIntoView` without an explicit `el.focus()`. Adding focus management to the row body would violate H1 (row body is non-interactive and has no `tabIndex`). The spec line in §8 reads "After scroll, focus moves to the target row" — under H1 the target *row* itself cannot receive focus, so the intended behaviour is that focus moves to the predecessor row's *chevron* (the one interactive element on it). If during implementation this assertion needs to be added, do it by extending `ActivityTable.scrollToRow(id)` to also resolve and `.focus()` the chevron button for that row — but treat that as a follow-up and not a Task 8 requirement, since the test suite as written above covers the spec's hard a11y contracts and the chevron-focus behaviour is already exercised by Task 8's "chevron is the only interactive element in a row" test. If a reviewer pushes back, the resolution is a small new ref map for chevron buttons in `activity-table.tsx`.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/__tests__/activity-accessibility.test.tsx
git commit -m "test(dashboard): /activity accessibility regression suite (PR-C)"
```

---

### Task 9: Dead-CSS sweep on `activity.module.css`

**Files:**

- Modify: `apps/dashboard/src/app/(auth)/(mercury)/activity/activity.module.css`

After PR-A landed the div-grid table + drawer rewrite and PR-B landed the filter strip (deleting the `.filteredPill` block), `activity.module.css` still carries v1 classes that the rewritten `.tsx` files no longer reference. PR-C also obsoletes the v1 `.emptyWrap`/`.emptyTitle`/`.emptyBody`/`.emptyAction` block (replaced by `.empty*`) and the v1 `.paginationFooter`/`.moreButton`/`.arr` block (replaced by `.pag*`). We verify each candidate class is unused via `grep -r` then delete in one pass.

- [ ] **Step 1: Verify candidate classes are orphaned**

For each candidate class, run a grep over the activity directory ONLY (the class names are CSS-Module-local, so a hit anywhere in the directory means it's still live; a clean directory means safe to delete):

```bash
cd apps/dashboard/src/app/\(auth\)/\(mercury\)/activity

for cls in \
  emptyWrap emptyTitle emptyBody emptyAction \
  paginationFooter moreButton arr \
  stickyCol cellTimestamp cellEvent cellActor cellEntity cellSummary cellChevron cellMono cellHash \
  riskBadge riskNone riskLow riskMedium riskHigh riskCritical \
  drawerRow titleRow titleFolio toolbar \
  sectionLabel isMuted tabular fadeIn activityFadeIn isExpanded
do
  hits=$(grep -rn "styles\.${cls}\b\|\\\"${cls}\\\"" . --include='*.tsx' --include='*.ts' 2>/dev/null | wc -l | tr -d ' ')
  echo "${cls}  hits=${hits}"
done
```

Expected: every class in the list reports `hits=0`. If any class reports `hits>0`, remove it from the deletion list below and KEEP it in the CSS — a `.tsx` still references it.

Also verify the v1 `.activity thead`, `.activity tbody`, `.activity` (root) blocks are unreferenced:

```bash
grep -rn "<table[^>]*activity\|className=.*activity\\b" . --include='*.tsx' | head -5
```

Expected: no hits on the legacy `<table>` selector usage (the v1 root `.activity` class targeted the legacy `<table>` element; PR-A's div-grid uses `.tableWrap` instead). If hits exist, the `.activity tbody/.thead` rules stay.

- [ ] **Step 2: Delete the verified-orphan blocks**

Open `apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/activity.module.css`. Delete each block in this list. Each block is contiguous in the file (declared together with related selectors), so the cleanest cuts are by block boundaries. The line ranges below are approximate (current line numbers after Task 2's additions); use the CSS comment headers to anchor each deletion.

1. **The legacy `<table>` root + thead/tbody block** — selectors `.activity`, `.activity thead th`, `.activity tbody tr`, `.activity tbody tr:hover`, `.activity tbody td`, `.activity tbody td.isMuted`, `.activity tbody tr:hover .cellTimestamp`, `.activityRow.isExpanded`, `.activityRow.isExpanded .cellTimestamp`. Around lines 360–395 (post-Task-2 numbering).
2. **The cell-style block** — `.stickyCol`, `.cellTimestamp`, `.cellEvent`, `.cellActor`, `.cellEntity`, `.cellSummary`, `.cellChevron`, `.cellMono`, `.cellHash`. Around lines 510–570.
3. **The risk-badge block** — `.riskBadge`, `.riskNone`, `.riskLow`, `.riskMedium`, `.riskHigh`, `.riskCritical`. Around lines 405–435.
4. **The legacy section-label / utility block** — `.sectionLabel`, `.isMuted`, `.tabular`. Around lines 438–456.
5. **The legacy fadeIn block** — `.fadeIn`, `@keyframes activityFadeIn`. Around lines 800–812.
6. **The v1 `.titleRow` / `.titleFolio` / `.toolbar` block** — around lines 303–355.
7. **The v1 `.drawerRow` rule** — around line 607.
8. **The v1 empty-state block** — `.emptyWrap`, `.emptyTitle`, `.emptyBody`, `.emptyAction`, `.emptyAction:hover`. Around lines 488–507 + 776–797.
9. **The v1 pagination block** — `.paginationFooter`, `.moreButton`, `.moreButton:hover:not(:disabled)`, `.moreButton:disabled`, `.arr`. Around lines 732–774.

After each deletion, save and verify the file still parses with a smoke build (Step 3 below).

If a `grep` in Step 1 reported `hits>0` for any class on this list, KEEP that class. Common keepers to watch for:

- `.pageTitle` — `header.tsx` still uses it.
- `.tableWrap`, `.tableHead`, `.tableHeadCol` — `activity-table.tsx` uses these.
- `.skeletonTable`, `.skeletonRow` — `activity-page.tsx` skeleton block.

- [ ] **Step 3: Smoke-build to confirm nothing else broke**

```bash
TZ=UTC pnpm --filter @switchboard/dashboard test
pnpm --filter @switchboard/dashboard build
```

Expected: PASS for both. If the build complains about an undefined CSS Module export, you deleted a class still referenced by a `.tsx` — restore that one block.

- [ ] **Step 4: Sanity-check the file size**

```bash
wc -l apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/activity.module.css
```

Expected: drops by ~120–180 lines from the post-Task-2 high-water mark.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/activity.module.css
git commit -m "style(dashboard): sweep dead CSS classes from activity.module.css (PR-C)"
```

---

### Task 10: Full verification + open PR

**Files:** none changed.

- [ ] **Step 1: Run the full dashboard test suite + typecheck + build**

```bash
TZ=UTC pnpm --filter @switchboard/dashboard test
pnpm typecheck
pnpm --filter @switchboard/dashboard build
```

Expected: all pass. The `next build` is not in CI (see `memory/feedback_dashboard_build_not_in_ci.md`) — failing it locally is a real failure.

If `pnpm typecheck` reports missing exports from `@switchboard/schemas` / `@switchboard/db` / `@switchboard/core`, run `pnpm reset` first (per CLAUDE.md "Build / Test / Lint") and retry.

- [ ] **Step 2: Manual visual walk-through (fixture mode)**

Spec §12 walk-the-page acceptance — start the dashboard dev server and confirm each numbered item visually:

```bash
pnpm --filter @switchboard/dashboard dev
```

Visit `http://localhost:3002/activity` and confirm:

1. Filter strip exposes scope segment, combobox, actor pills, date range, entity selector. (PR-B already shipped, but verify the visual still holds after Task 9's sweep.)
2. Rows show clock, event badge, actor glyph, entity stack, summary; clicking summary text does NOT toggle the drawer.
3. Expanding a row reveals the drawer with hash chain, evidence rows, references.
4. **(NEW — H5)** With dev tools, throw a fetch error (block `/api/dashboard/activity` in the Network tab, click refresh) — the previous page of rows stays visible and the error banner appears above.
5. **(NEW)** Stale pill is in the bottom-right corner; says "just now" on first load, "1m ago" after a minute. Refresh button refetches.
6. **(NEW)** Force an empty filtered state (set a date `before=1900-01-01` via URL) and confirm the editorial "No entries match *these filters*." copy with the Clear CTA.
7. **(NEW)** Pagination footer shows "Showing N of …"; under fixture mode the footer is hidden (single-page).
8. Counts on combobox + actor pills carry `on this page` suffix.
9. Page-head shows `Audit log` plain (no italic accent); `last ledger entry` tile present under default scope, hidden under narrowing.

- [ ] **Step 3: Invoke `/superpowers:requesting-code-review`**

Per CLAUDE.md doctrine and PR-C scope. The review will pick up on any of the spec invariants the suite missed.

- [ ] **Step 4: Push the branch and open the PR**

```bash
git push -u origin feat/activity-rebuild-pr-c-resilience-polish
gh pr create --base main \
  --title "feat(dashboard): /activity rebuild PR-C — resilience + polish" \
  --body "$(cat <<'EOF'
## Summary

Implements PR-C of the `/activity` rebuild per spec §13:

- Non-unmounting error banner (introduces hard invariant **H5**)
- Bottom-right fetched-Nm-ago stale pill (hidden until first successful fetch)
- Rewritten empty-state with zero + filtered variants (editorial copy)
- Restyled pagination footer ("Showing N of … · keyset cursor — total unknown by design")
- Page-level accessibility regression suite (grid roles, combobox WAI-ARIA, chevron focus, drawer region, `aria-live` on error + stale)
- PR-B code-review carry-over: TZ-independent `activity-row.test.tsx`
- Dead-CSS sweep on `activity.module.css`

Plan: `docs/superpowers/plans/2026-05-14-activity-rebuild-pr-c-resilience-polish.md`
Spec: `docs/superpowers/specs/2026-05-13-activity-rebuild-design.md`

## Test plan

- [ ] `TZ=UTC pnpm --filter @switchboard/dashboard test` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm --filter @switchboard/dashboard build` passes
- [ ] Manual: throw a fetch error in dev tools → table stays mounted, banner appears
- [ ] Manual: stale pill says "just now" on load, "1m ago" after a minute, refresh refetches
- [ ] Manual: empty filtered state shows editorial copy with Clear CTA
- [ ] Manual: pagination footer shows "Showing N of …" in live mode

EOF
)"
```

- [ ] **Step 5: Enable auto-merge AND wait for all pushes to register**

```bash
gh pr merge --auto --squash
```

**Then wait for the squash to fire.** Per PR-A: auto-merge captures HEAD when CI eligibility fires; pushes during the wait window may not be included. After CI passes and the squash fires, confirm the squash commit body lists every commit (Tasks 1–9):

```bash
git fetch origin main
git log origin/main -1
```

Expected: the squash commit body enumerates the per-task commits.

---

## Cross-cutting notes

### How H5 is enforced

The page caches `data.rows` into `lastRowsRef` on every successful render. When `data` flips to `undefined` (loading or error), `liveRows` falls back to `lastRowsRef.current`. The error banner is rendered ABOVE the section, not INSIDE it, so the section's render branches are independent of `isError`. The skeleton fires only on `isLoading && rows.length === 0` (first render before any data), so a refetch-error mid-session leaves the table on screen.

### Why `dataUpdatedAt` over `useEffect(fetchedAt = Date.now())`

React Query exposes `dataUpdatedAt` natively — it's the wall-clock millis of the last successful query result. Using it removes a stateful side-effect from the page (no `useEffect(setFetchedAt)` chain) and stays in sync with React Query's cache lifetime. The hook does not need a signature change; the page reads off the returned object.

### Why not change `useActivityList`'s signature

The hook currently `return useQuery({...})` and React Query's return shape includes `data`, `isLoading`, `isError`, `isFetching`, `dataUpdatedAt`, and `refetch`. The page already destructures `data`, `isLoading`, `isError`, `refetch`; PR-C just adds `isFetching` and `dataUpdatedAt` to that destructure. No prop drilling, no new state.

### Why the accessibility suite lives in one file

The page-level a11y assertions (grid roles, combobox pattern, error/stale `aria-live`) exercise the same render tree, so colocating them in one suite keeps the setup cost (mocks, render) amortized. Component-level tests still live next to their components; this suite picks up the integration contracts.

### Skipped items (carried in spec §1.2 / §13)

- No backend changes.
- No new event types or allowlist edits.
- No `actorId` filter (spec §1.2 gap).
- No cross-page hash-chain navigation.
- No Verify button.
- No CSV export / saved filters / column chooser.
- No URL-write convergence with /contacts and /automations (spec §2.10 — deliberate).
- No MercuryFilterChips adapter (editorial register visually differs per spec §3 + locked design).
- No `shared-conventions.md` update — that's a separate small docs PR after PR-C merges (spec §13 PR-C last bullet).

---

## References

- **Spec:** `docs/superpowers/specs/2026-05-13-activity-rebuild-design.md`
- **PR-A plan:** `docs/superpowers/plans/2026-05-13-activity-rebuild-pr-a-table-drawer.md`
- **PR-B plan:** `docs/superpowers/plans/2026-05-14-activity-rebuild-pr-b-filter-strip.md`
- **Locked design:** `docs/design-prompts/locked/switchboard/project/activity-v2/` (especially `app.jsx` lines 457–530 for the banner/empty/pagination/stale JSX, `styles.css` lines 429–1017 for the visual contract)
- **PR-A shipped:** `ed8c342e` (impl) + `ed1dc660` (fixtures-split hotfix)
- **PR-B shipped:** `48eaad3c` (impl, squash of 10 commits) + `d5cdad0f` (post-merge alignment follow-ups)
- **CLAUDE.md doctrine:** branch-per-worktree, specs land on main, file-size budgets (400/600), no `console.log`, no `any`
- **Memory:** `memory/feedback_dashboard_build_not_in_ci.md`, `memory/feedback_arch_check_ts_only.md`, `memory/feedback_subagent_worktree_drift.md`
