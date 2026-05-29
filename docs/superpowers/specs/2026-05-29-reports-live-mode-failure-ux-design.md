# Reports Live-Mode Failure UX — Design (#472)

**Date:** 2026-05-29
**Issue:** #472 — "PR-R2: Reports live-mode failure-state UX (MANDATORY before `NEXT_PUBLIC_REPORTS_LIVE` flip)"
**Status:** Approved decisions captured; ready for implementation plan.

## Problem

`/reports` is the renewal checkpoint a paying customer ($300–600/mo) opens to judge value.
When `NEXT_PUBLIC_REPORTS_LIVE=true` and the proxy returns 500 (Fastify down, missing
`reportCacheStore`, transient Meta API error), the page renders **nothing useful below the
header** — a blank page. Today fixtures hide this; once the launch flag flips it becomes
operator-facing. This blocks the flag flip in any deploy environment.

## Root cause (verified)

The failure is entirely presentation-layer:

- `hooks/use-report-data.ts` is **correct**. In live mode it surfaces `data`, `isLoading`,
  `isFetching`, and `error` independently, and never falls back to fixtures
  (`use-report-data.test.tsx:96` already proves "surfaces fetch errors as `error` / no silent
  fallback to fixtures in live mode").
- `reports-page.tsx:25` destructures only `{ data: fx, isFetching, refresh }` — it **ignores
  `error` and `isLoading`**. The body is gated behind `{fx && (...)}` (`reports-page.tsx:79`),
  so when `fx` is `undefined` (error OR initial load in live mode) nothing renders.

So the same defect produces two blank states: initial-load blank and error blank.

## Decisions

- **Retry:** manual "Try again" button on the unavailable state (mirrors
  `components/inbox/inbox-error-state.tsx`). React Query auto-retry stays off, preserving the
  existing `retry: false` test default. No exponential-backoff machinery.
- **Scope:** full treatment of the defect — loading skeleton + error state + stale-cache banner.

## Design

### State machine (live mode)

The page renders `PageHead` + `FixtureModeBanner` at the top in **all** branches, then the body
branches **exhaustively over `{data, error}`** (NOT on `isLoading` — see the trap below):

| Condition         | Body renders                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| `!data && !error` | `<ReportsSkeleton/>` — loading / not-ready catch-all (initial load AND the keys-pending state)     |
| `!data && error`  | `<ReportsUnavailable onRetry/>` — calm "temporarily unavailable" + Try again                       |
| `data && error`   | full report **+** `<StaleDataBanner onRetry cacheAge/>` ("Couldn't refresh — showing last loaded") |
| `data && !error`  | full report (unchanged from today)                                                                 |

**Do not gate the skeleton on `isLoading`.** React Query's `enabled: false` pending state
(session/org keys unresolved) reports `isLoading === false` with `data` undefined and `error`
null, so an `isLoading` gate would leave a blank body — the exact #472 regression. Using
`!data && !error` as the skeleton catch-all makes the four branches exhaustive.

### Fixture mode is untouched — acceptance #3 holds by construction

In fixture mode the hook returns `{ data: <fixture>, isLoading: false, error: null }`, which can
only land in the `data && !error` branch. It can never reach skeleton / unavailable / stale.
Therefore **live mode never silently falls back to fixtures** — guaranteed by the hook's
existing branch, not by new page logic. A page-level regression test asserts the live error
branch shows the unavailable state and **not** fixture content.

### Components (each co-located with a `*.test.tsx`, per CLAUDE.md)

- `components/reports-unavailable.tsx` — mirrors `inbox-error-state.tsx`: `role="alert"`, calm
  eyebrow + prose, a secondary action button (`ds-action ds-action-secondary`) wired to
  `onRetry`. Never reuses empty-state copy (an error is an error).
- `components/reports-skeleton.tsx` — shimmer blocks matching the report's section rhythm
  (pull-quote / attribution / funnel / campaigns). No data dependency.
- `components/stale-data-banner.tsx` — mirrors `components/no-connection-banner.tsx` structure
  (`eyebrow` / `msg` / `cta`); shows `cacheAge` (already tracked in `reports-page.tsx`) and a
  retry cta.
- CSS added to the existing `reports.module.css`, matching its current class idiom
  (`.bannerNoconn` → `.bannerStale`, plus `.unavailable*` / `.skeleton*`). Reuses the file's
  existing token usage to avoid the HSL-triplet token-collision gotcha.

### Hook change (additive, minimal)

Expose `retry: () => Promise<void>` from `useReportData`, backed by React Query `refetch` (a
plain GET refetch, **not** the heavier POST `/refresh` recompute). In fixture mode `retry` is a
no-op (`async () => {}`), matching the existing fixture-mode `refresh` no-op. The return shape is
otherwise unchanged; `error`/`isLoading`/`data` already exist on the interface.

## Convention (issue cross-check item)

This PR **settles** the live-surface failure convention rather than reworking other surfaces:

- Convention: _calm "temporarily unavailable" state + manual retry + never silently fall back to
  fixtures_, visually/behaviorally aligned with `inbox-error-state.tsx`.
- `/activity` already has cursor-based pagination + dedicated empty states; `/approvals` (inbox)
  already has `inbox-error-state.tsx`. Reports adopting the same shape brings the third live
  surface into line. **Reworking `/activity` or `/approvals` is explicitly out of scope** (issue
  out-of-scope clause); documenting that Reports now conforms is the deliverable.

## Testing

**Page (`reports-page.test.tsx`):**

1. live + `isLoading` + no data → renders skeleton, not blank.
2. live + `error` + no data → renders unavailable state (not blank, no render crash).
3. live + `data` + `error` → renders report **and** stale banner.
4. retry button click → triggers a refetch (spy on hook `retry`).
5. fixture-mode regression → error/loading branches never render fixture report content.

**Hook (`use-report-data.test.tsx`):** add a test that `retry()` triggers a refetch in live mode
and is a safe no-op in fixture mode.

**New components:** unit tests for `reports-unavailable`, `reports-skeleton`, `stale-data-banner`
(render + retry callback fires).

## Non-goals / out of scope

- Re-enabling fixtures behind the flag for "graceful degradation" (plan forbade this).
- Changing how the Fastify route reports errors — the route contract is fine.
- Reworking `/activity` or `/approvals` failure UX (convention documented, not re-implemented).
- Org/session context resolution for `ORG_PLACEHOLDER` (tracked separately, spec §10.7).

## Architecture / layering

All changes live in `apps/dashboard` (Layer 5). No `@switchboard/*` cross-layer touch, no schema,
no migration. ~5 files + tests. Dashboard import convention (no `.js` extension) followed.
