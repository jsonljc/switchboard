# Riley Cockpit B.1 — Core Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Riley cockpit core operator loop at `/riley`: approval cards (all 11 action variants + signal-health grouping), activity stream, status pill, halt control, on top of the shared cockpit shell Alex A.1 ships. Zero backend changes. Adapter boundary load-bearing.

**Architecture:** Five-layer adapter architecture — substrate (`Recommendation` + `AuditEntry`) → existing dashboard hooks → Riley adapter layer (5 pure-function files under `apps/dashboard/src/lib/cockpit/riley/`) → cockpit hooks (`use-riley-approvals`, `use-riley-status`, extended `use-agent-activity`) → UI components from Alex A.1's shell. UI components and cockpit hooks must NOT import `Recommendation` / `AuditEntry` / `@switchboard/db` / `@prisma`. Enforcement: ESLint `no-restricted-imports` rule scoped to `components/cockpit/**`, `hooks/use-riley-*.ts`, `app/(auth)/alex/**`, and `app/(auth)/riley/**` (adapter files under `lib/cockpit/riley/**` are exempt). Pre-merge grep smoke check as review gate. When Wave B mirrors recommendations into `WorkTrace`, only the adapter layer changes — the cockpit UI is source-agnostic by construction.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript (ESM, `.js` extensions in relative imports per `CLAUDE.md`), Vitest + `@testing-library/react`, Tailwind for layout primitives only. The cockpit shell already exists on main (`apps/dashboard/src/components/cockpit/types.ts` shipped via Alex A.1's type-only landing); the rest of the shell components land when Alex A.1 merges.

**Parent specs:**
- [`docs/superpowers/specs/2026-05-14-riley-cockpit-wave-a-slicing-design.md`](../specs/2026-05-14-riley-cockpit-wave-a-slicing-design.md) — Wave A slicing (B.1 / B.2 / B.3 scope + adapter contract). **Authoritative.**
- [`docs/superpowers/specs/2026-05-13-riley-cockpit-home-design.md`](../specs/2026-05-13-riley-cockpit-home-design.md) — Riley cockpit target spec (data shapes, copy, 11 action variants, translator rules, accent).
- [`docs/superpowers/specs/2026-05-14-riley-agent-infra-parity-design.md`](../specs/2026-05-14-riley-agent-infra-parity-design.md) — Wave B doctrine sibling spec (out of scope for B.1; informs what's deferred).

**Sibling plan (precondition):** Alex A.1 implementation — [`docs/superpowers/plans/2026-05-14-alex-cockpit-a1-implementation.md`](./2026-05-14-alex-cockpit-a1-implementation.md). **Riley B.1 cannot execute until Alex A.1 has merged.** B.1's first action (after worktree creation) is the precondition check below.

> **The Wave A slicing spec is authoritative.** If anything in this implementation plan appears to expand B.1's scope beyond the slicing spec — new files, new behaviors, new mutation paths, new bulk affordances — the slicing spec wins and the conflicting text in this plan is wrong. Resolve in favor of the slicing spec and flag the discrepancy.

---

## Precondition: Alex A.1 must have merged to `main`

The plan assumes the Alex A.1 cockpit shell components are present on `main`. Specifically, **before starting Task 1**, verify:

```bash
ls apps/dashboard/src/components/cockpit/
```

Expected files (all must exist):

```
__tests__/                  # Alex A.1 component tests
activity-row.tsx
activity-stream.tsx
approval-block.tsx
approval-card.tsx
cockpit-page.tsx
composer-placeholder.tsx
dot.tsx
identity.tsx
kind-meta.ts                # contains KIND_META table (Alex kinds at A.1 merge time)
status-pill.tsx
tokens.ts
topbar.tsx
types.ts                    # ALREADY on main per audit; contains Riley types
```

And:

```bash
ls apps/dashboard/src/lib/cockpit/
```

Expected:

```
alex-config.ts
legacy-pending-approval-to-approval-view.ts
activity-kind-map.ts
relative-age.ts
```

And:

```bash
cat apps/dashboard/src/app/\(auth\)/alex/page.tsx | head -5
```

Expected: imports `CockpitPage` from `@/components/cockpit/cockpit-page` and renders `<CockpitPage />` directly (route-level branching introduced when A.1 was rebased onto the post-#468 explicit-route structure).

And:

```bash
cat apps/dashboard/src/app/\(auth\)/riley/page.tsx | head -5
```

Expected: imports `AgentHomeShell` and renders `<AgentHomeShell agentKey="riley" />`. **B.1 changes this to render `<RileyCockpitPage />` instead** (see Task 16).

If any of the above are missing, Alex A.1 has not merged. **Stop. Wait for A.1 to merge.** Riley B.1 cannot execute against a half-merged shell.

> **Route-architecture note.** PR #468 (merged before A.1) deleted the dynamic `[agentKey]/` route and replaced it with explicit `/alex/`, `/riley/`, `/mira/` directories. A.1's merge into main adapted by moving its per-agent branching from a single `agent-home-client.tsx` to route-level: `/alex/page.tsx` renders `<CockpitPage />`; non-Alex routes continue to render the legacy `AgentHomeShell`. Riley B.1 follows the same route-level pattern.

---

## Codebase audit (10 claims verified against current `main` before plan was written)

| # | Claim | Verdict | Notes for the implementer |
|---|---|---|---|
| 1 | Alex A.1 shell components | ⚠ Partial pre-merge | `types.ts` is already on main (verified — contains `RileyApprovalView`, `RileyApprovalKind` with 11 variants, `ActivityKind` with all 9 Riley kinds). Other shell components ship at A.1 merge. **Riley B.1 reuses types.ts, does not modify it.** |
| 2 | `useRecommendations()` | ✅ | `apps/dashboard/src/hooks/use-recommendations.ts:13`. Returns `UseQueryResult<{ recommendations: RecommendationApiRow[] }>`. |
| 2 | `useRecommendationAction(recommendationId)` | ✅ | `apps/dashboard/src/hooks/use-recommendation-action.ts:8`. **Per-recommendation hook.** Returns `{ primary, secondary, dismiss, confirm, undo, isPending, error }`. Each method: `(note?: string) => Promise<unknown>`. |
| 2 | `useAgentActivity()` | ✅ | `apps/dashboard/src/hooks/use-agent-activity.ts:71`. Returns `UseQueryResult<{ roster, states, actions: TranslatedAction[] }>`. |
| 2 | `useHalt()` | ✅ | `apps/dashboard/src/components/layout/halt/halt-context.tsx:58`. Returns `{ halted, setHalted, toggleHalt }`. |
| 2 | `useAgentGreeting()` | ✅ | `apps/dashboard/src/hooks/use-agent-greeting.ts:22`. Returns `{ data: GreetingViewModel, isLoading, isError, error }`. |
| 3 | `Recommendation` schema fields | ⚠ Nested | `id`, `intent`, `status`, `humanSummary`, `presentation` (with `primaryLabel`/`secondaryLabel`/`dismissLabel`), `dollarsAtRisk`, `targetEntities`, `createdAt`, `confidence` are top-level. **`campaignId`, `learningPhaseImpact`, `reversible` live in `parameters.__recommendation`** — adapter must extract via nested access. |
| 4 | `Connection` table / Meta Ads check | ✅ | `packages/db/prisma/schema.prisma:196-215`. Filter by `serviceId === "meta-ads"`. `useConnections()` hook at `apps/dashboard/src/hooks/use-connections.ts:21` returns `{ connections: Connection[] }`. |
| 5 | `relativeAge` utility | ✅ | `packages/core/src/agent-home/relative-age.ts` — `formatRelativeAge(occurredAt: Date, now: Date, timezone: string): string`. Already imported by dashboard (`apps/dashboard/src/app/(auth)/(mercury)/contacts/components/format.ts`). Re-importable client-side. |
| 6 | Three-vocabulary intent drift | ✅ | Engine primitives (`recommendation-engine.ts`): `"pause"`, `"scale"`, etc. Schema enum (`packages/schemas/src/ad-optimizer.ts:16-31`): 13 actions. Pipeline-prefix intents (`recommendation.pause_adset`, `recommendation.ad_set_pause`) appear in fixtures / pipeline code. **Translator must accept all three.** |
| 7 | External-action dismissal | ⚠ Two-tap today | `actOnRecommendation` (`packages/core/src/recommendations/act.ts:48-108`) does NOT auto-dismiss when an external URL is clicked. Operator must separately call dismiss. **B.1 preserves this two-tap flow** — does not introduce auto-dismiss. Slicing spec §4 acceptance criterion 8 explicitly accommodates this. |
| 8 | `actOnRecommendation` undo | ✅ | `undoableUntil` field set by `emit.ts:7,44`. **24-hour window** (`ONE_DAY_MS`) for `surface === "shadow_action"`, `null` for `queue`. `useRecommendationAction(id).undo(note?)` invokes; status responses include `"undo_window_closed"` / `"already_terminal"` / `"expired"` / `"ok"`. **Toast is caller responsibility** — cockpit B.1 surfaces existing toast wiring without redesign. |
| 9 | Page branching | ✅ (post-#468 + post-A.1) | PR #468 deleted `[agentKey]/page.tsx` and introduced explicit `/alex/page.tsx`, `/riley/page.tsx`, `/mira/page.tsx`. A.1 (after rebase) modified `/alex/page.tsx` to render `<CockpitPage />` directly. **B.1 modifies `/riley/page.tsx` to render `<RileyCockpitPage />` directly** (a new Riley composition created in B.1). `<AgentHomeShell agentKey="riley" />` rendering is removed from `/riley/page.tsx`; the shell stays in the codebase for `/mira/` only. |
| 10 | ESLint config | ✅ | Root `.eslintrc.json`. Uses `"overrides"` key with file globs + `no-restricted-imports`. Existing pattern at `.eslintrc.json:48-62` shows the rule shape. B.1 adds a new override block. |

**Three adjustments propagated into this plan:**

1. Adapter extracts Riley-specific fields from `Recommendation.parameters.__recommendation` (not top-level columns).
2. Plan preserves the existing 24-hour undo window without claiming "1 hour" anywhere.
3. External-action dismissal stays two-tap; plan does not introduce auto-dismiss on external link click.

---

## File Structure

### Created files

| Path | Responsibility |
|---|---|
| `apps/dashboard/src/lib/cockpit/riley/riley-config.ts` | `RILEY_ACCENT`, `RILEY_TABS`, `statusPulse(statusKey)`, `statusColor(statusKey)`, static `RILEY_MISSION_SUBTITLE`. Mission popover rows + commands + composerPlaceholder + toastVoice are **NOT** here (B.2 / B.3). |
| `apps/dashboard/src/lib/cockpit/riley/kind-meta-riley.ts` | `RILEY_KIND_META` table — 9 Riley activity kinds (`watching`, `reviewing`, `paused`, `scaled`, `rotated`, `shifted`, `restructured`, `started`, `alert`). Each entry: `{ label, color, pulse }`. Merged into shell's `KIND_META` at composition time. |
| `apps/dashboard/src/lib/cockpit/riley/__fixtures__/riley-recommendation-fixtures.ts` | One `RecommendationApiRow`-shaped fixture per action variant (11 variants × 1 fixture = 11 fixtures) plus a multi-row signal-health scenario (3 rows for one pixel). All adapter tests pull from these. |
| `apps/dashboard/src/lib/cockpit/riley/__fixtures__/riley-activity-fixtures.ts` | One `TranslatedAction`-shaped fixture per Riley activity kind (9 fixtures). Plus cold-state (no connection) scenario fixture. |
| `apps/dashboard/src/lib/cockpit/riley/recommendation-to-approval-view.ts` | Pure orchestrator: `mapRecommendationsToApprovalViews(rows: RecommendationApiRow[]): RileyApprovalView[]`. Partitions signal-health rows, calls grouper, maps singles per-action, concatenates, sorts by urgency + `dollarsAtRisk` desc. Extracts nested fields from `parameters.__recommendation`. |
| `apps/dashboard/src/lib/cockpit/riley/signal-health-grouper.ts` | Pure function: `groupSignalHealthByPixel(rows: RecommendationApiRow[]): RileyApprovalView[]`. Collapses rows where `parameters.__recommendation.campaignId.startsWith("signal:")` by pixel into one `campaign: { kind: "account" }` view-model. **No "Dismiss all" button in B.1** — primary action is external (Open Events Manager). |
| `apps/dashboard/src/lib/cockpit/riley/riley-activity-translator.ts` | Pure function: `translateRileyActivity(actions: TranslatedAction[]): ActivityRow[]`. Maps intent + status → `ActivityKind` per Riley target spec's translator table. Absorbs three-vocabulary drift (`recommendation.pause` / `recommendation.pause_adset` / `recommendation.ad_set_pause`). |
| `apps/dashboard/src/lib/cockpit/riley/cold-state-activity-rows.ts` | Pure function: `coldStateActivityRows(): ActivityRow[]`. Three synthetic onboarding rows when no Meta Ads `Connection` exists. No DB write. |
| `apps/dashboard/src/lib/cockpit/riley/riley-status-deriver.ts` | Pure function: `deriveRileyStatus(input): CockpitStatus`. Order: `HALTED` → `IDLE` (no connection / no active campaign) → `WAITING` (pending recs, connection present) → `WATCHING` (steady). **Connection precedence:** absence of Meta Ads connection takes precedence over pending recommendation rows. `REVIEWING` deferred — derivation absent. |
| `apps/dashboard/src/hooks/use-riley-approvals.ts` | Hook: `useRileyApprovals(): { approvals: RileyApprovalView[]; isLoading; isError }`. Wraps `useRecommendations()`, filters to Riley intents (`agentKey === "riley"` or `intent.startsWith("recommendation.")`), passes through adapter. Returns view-models only. |
| `apps/dashboard/src/hooks/use-riley-status.ts` | Hook: `useRileyStatus(): CockpitStatus`. Composes `useHalt()` + `useConnections()` + `useRecommendations()` + recent-activity poll, passes through deriver. **Uses `useNow(60_000)` from `@/app/(auth)/(mercury)/approvals/hooks/use-now.js`** (existing pre-A.1 hook on main) for 1-minute ticking on the WATCHING/IDLE 15-minute boundary; `now` is included in the `useMemo` dependency array so the status flips when the window expires without a parent re-render. |
| `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx` | Riley composition of the shell — parallel to Alex's `cockpit-page.tsx`, not a modification of it. Imports the shell primitives (`Topbar`, `Identity`, `ApprovalBlock`, `ActivityStream`, `ComposerPlaceholder`, `T`) + Riley config + Riley hooks. Renders `<RileyCockpitPage />` with no props. A.1's `cockpit-page.tsx` is unchanged. |
| `apps/dashboard/src/lib/cockpit/riley/__tests__/riley-config.test.ts` | Verifies accent, tabs, status helpers. |
| `apps/dashboard/src/lib/cockpit/riley/__tests__/kind-meta-riley.test.ts` | Verifies all 9 kinds have `{ label, color, pulse }` entries. |
| `apps/dashboard/src/lib/cockpit/riley/__tests__/recommendation-to-approval-view.test.ts` | Describe.each over 11 action variants; verifies title/urgency/quote/primary CTA/risk extraction. |
| `apps/dashboard/src/lib/cockpit/riley/__tests__/signal-health-grouper.test.ts` | Verifies 3-row signal-health collapse to 1 view-model; `campaign.kind === "account"`; bulleted breach list in quote; external primary action only. |
| `apps/dashboard/src/lib/cockpit/riley/__tests__/riley-activity-translator.test.ts` | Describe.each over 9 Riley activity kinds; three-vocabulary intent drift accepted; unknown intent falls back gracefully. |
| `apps/dashboard/src/lib/cockpit/riley/__tests__/cold-state-activity-rows.test.ts` | Verifies exactly 3 synthetic rows with expected heads/bodies. |
| `apps/dashboard/src/lib/cockpit/riley/__tests__/riley-status-deriver.test.ts` | All 4 wired states (HALTED, IDLE, WAITING, WATCHING). Connection precedence rule. 15-minute WATCHING boundary. |
| `apps/dashboard/src/hooks/__tests__/use-riley-approvals.test.tsx` | Hook returns view-models, hides raw `Recommendation` rows, handles loading + error. |
| `apps/dashboard/src/hooks/__tests__/use-riley-status.test.tsx` | Hook composition: halt + connection + approvals + activity → `CockpitStatus`. |
| `apps/dashboard/src/app/(auth)/riley/__tests__/page.test.tsx` | **Modified** (this file already exists from #468 — testing `AgentHomeShell` rendering). B.1 replaces its body with cockpit assertions: mocks `RileyCockpitPage` and asserts the page renders it when Riley is enabled. The route-gate test (`notFound()` when Riley not enabled) is preserved. |
| `apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx` | New component-level integration test for `RileyCockpitPage`: cold state (no connection) + steady state (≥1 pending rec) + halted. Mocks Riley hooks. |

### Modified files

| Path | Change |
|---|---|
| `apps/dashboard/src/hooks/use-agent-activity.ts` | **Add a new named export `useRileyActivity()` at the bottom of the file. Do NOT modify the existing `useAgentActivity()` return shape — Alex and any other consumers continue to use it unchanged.** The new export composes `useAgentActivity()` + `useConnections()` + the Riley translator + cold-state synthetic rows, and returns Riley-shaped `ActivityRow[]`. |
| `apps/dashboard/src/app/(auth)/riley/page.tsx` | Replace `<AgentHomeShell agentKey="riley" />` with `<RileyCockpitPage />`. Replace the `AgentHomeShell` import with `RileyCockpitPage`. The route gate (`notFound()` if Riley not enabled) is preserved. |
| `apps/dashboard/src/components/cockpit/__tests__/approval-card.test.tsx` | Extend Alex A.1's fixture-based render test with all 11 Riley action variants + the grouped account-level `signal_health_group` card. |
| `.eslintrc.json` | Add new `overrides` block: `no-restricted-imports` rule scoped to `apps/dashboard/src/components/cockpit/**`, `apps/dashboard/src/hooks/use-riley-*.ts`, `apps/dashboard/src/app/(auth)/alex/**`, and `apps/dashboard/src/app/(auth)/riley/**`. Adapter files under `apps/dashboard/src/lib/cockpit/riley/**` are NOT in the scope (i.e., not restricted). |

### Files NOT touched (architectural boundary verification)

| Path | Reason |
|---|---|
| `apps/dashboard/src/components/cockpit/*.tsx` | Shell components shipped by Alex A.1 — Riley B.1 consumes them unchanged. |
| `apps/dashboard/src/components/cockpit/types.ts` | Already on main with full Riley types. Reused, not modified. |
| `apps/dashboard/src/lib/cockpit/alex-config.ts` | Alex's config — Riley has its own under `lib/cockpit/riley/`. |
| `packages/schemas/src/recommendations.ts` | `acceptToast` / `declineToast` schema additions are B.3, not B.1. |
| `packages/db/prisma/schema.prisma` | Zero backend changes in B.1. |
| `apps/api/**` | Zero backend changes in B.1. |
| `packages/ad-optimizer/**` | Riley engine unchanged. B.1 reads from the existing recommendation pipeline. |

---

## Cross-task references

These are referenced by multiple tasks. Defined once here.

**Path constants:**

- Riley adapter root: `apps/dashboard/src/lib/cockpit/riley/`
- Riley adapter tests: `apps/dashboard/src/lib/cockpit/riley/__tests__/`
- Riley fixtures: `apps/dashboard/src/lib/cockpit/riley/__fixtures__/`
- Test runner (whole package): `pnpm --filter @switchboard/dashboard test`
- Test runner (single file): `pnpm --filter @switchboard/dashboard test -- <path>`
- Type checker: `pnpm typecheck`
- Lint: `pnpm lint`
- Dashboard build (not in CI; run locally before merge): `pnpm --filter @switchboard/dashboard build`

**Pre-flight (run once, after the precondition gate, before Task 1):**

```bash
git worktree add -b feat/riley-cockpit-b1 /Users/jasonli/switchboard/.worktrees/riley-cockpit-b1 main
cd /Users/jasonli/switchboard/.worktrees/riley-cockpit-b1
pnpm worktree:init
```

Expected: `.env` copied, dev ports cleared, `pnpm db:migrate` runs (or skips if Postgres unreachable — fine for this UI-only branch).

After worktree creation, **verify the precondition gate** (Alex A.1 merged):

```bash
ls apps/dashboard/src/components/cockpit/cockpit-page.tsx apps/dashboard/src/components/cockpit/approval-card.tsx apps/dashboard/src/components/cockpit/activity-stream.tsx
ls apps/dashboard/src/lib/cockpit/alex-config.ts
```

All four files must exist. If not, stop and wait for Alex A.1.

**Recommendation row shape (used by every adapter task):**

Verified against `apps/dashboard/src/hooks/use-recommendations.ts` and `apps/dashboard/src/lib/api-client-types.ts`. The `RecommendationApiRow` carries:

```ts
type RecommendationApiRow = {
  id: string;
  intent: string;                      // e.g., "recommendation.pause"
  agentKey: "alex" | "riley";
  humanSummary: string;
  dollarsAtRisk: number;
  confidence: number;
  status: "pending" | "acted" | "dismissed" | "confirmed" | "dismissed_by_undo" | "expired";
  presentation: {
    primaryLabel: string;
    secondaryLabel: string;
    dismissLabel: string;
    dataLines?: string[];
  };
  targetEntities: {
    campaignName?: string;
    adSetName?: string;
    pixelId?: string;
    // ... other Meta entity refs
  };
  parameters: {
    __recommendation?: {
      campaignId: string;              // "signal:<pixelId>" for signal-health rows
      learningPhaseImpact: "no impact" | "will reset learning";
      reversible: boolean;
      action: string;                  // engine primitive: "pause", "scale", etc.
      urgency: "immediate" | "this_week" | "next_cycle";
      // ... other Riley-specific fields
    };
    [other: string]: unknown;
  };
  createdAt: string;                   // ISO date
  undoableUntil: string | null;        // ISO date; set by emit.ts ONE_DAY_MS for shadow_action surface
};
```

**Important:** the adapter must extract `campaignId`, `learningPhaseImpact`, `reversible`, `action`, `urgency` from `parameters.__recommendation`, not from top-level. If `parameters.__recommendation` is missing on a row, the adapter treats it as a degenerate / non-Riley row and filters it out.

---

## Logical commit boundaries

Each boundary is one squash-merge commit. Tasks within a boundary stage independently; the boundary's final task contains the commit.

1. **Boundary 1 — Foundations (config + kind meta + fixtures).** Tasks 1–4. Commit: `feat(riley-cockpit): foundations — config, kind meta, fixtures (B.1)`.
2. **Boundary 2 — Pure adapters.** Tasks 5–9. Commit: `feat(riley-cockpit): adapters — approval views, signal-health grouping, activity, cold state, status (B.1)`.
3. **Boundary 3 — Cockpit hooks.** Tasks 10–12. Commit: `feat(riley-cockpit): hooks — useRileyApprovals, useRileyStatus, use-agent-activity Riley branch (B.1)`.
4. **Boundary 4 — Boundary enforcement + cross-agent contract.** Tasks 13–15. Commit: `feat(riley-cockpit): ESLint boundary + cross-agent contract test (B.1)`.
5. **Boundary 5 — Page wiring + integration.** Tasks 16–17. Commit: `feat(riley-cockpit): /riley page wiring + integration tests (B.1)`.

---

## Boundary 1: Foundations

### Task 1: `riley-config.ts`

**Files:**
- Create: `apps/dashboard/src/lib/cockpit/riley/riley-config.ts`
- Test: `apps/dashboard/src/lib/cockpit/riley/__tests__/riley-config.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/dashboard/src/lib/cockpit/riley/__tests__/riley-config.test.ts
import { describe, it, expect } from "vitest";
import { RILEY_ACCENT, RILEY_TABS, RILEY_MISSION_SUBTITLE, statusColor, statusPulse } from "../riley-config.js";

describe("riley-config", () => {
  it("RILEY_ACCENT carries the four warm-clay tokens from the Riley target spec", () => {
    expect(RILEY_ACCENT).toEqual({
      base: "#B86C50",
      deep: "#7E4533",
      soft: "#ECD4C8",
      paper: "#F6E7DE",
    });
  });

  it("RILEY_TABS orders Alex / Riley / Mira with Riley active", () => {
    expect(RILEY_TABS).toEqual([
      { key: "alex", label: "Alex", state: "inactive" },
      { key: "riley", label: "Riley", state: "active" },
      { key: "mira", label: "Mira", state: "muted" },
    ]);
  });

  it("RILEY_MISSION_SUBTITLE is a plain string in B.1 (popover deferred to B.2)", () => {
    expect(typeof RILEY_MISSION_SUBTITLE).toBe("string");
    expect(RILEY_MISSION_SUBTITLE.length).toBeGreaterThan(0);
  });

  it("statusColor maps WATCHING to green, WAITING to amber, IDLE to grey, HALTED to red", () => {
    expect(statusColor("WATCHING")).toBe("#3F7A36");
    expect(statusColor("WAITING")).toBe("#B8782E");
    expect(statusColor("IDLE")).toBe("#A39786");
    expect(statusColor("HALTED")).toBe("#A03A2E");
  });

  it("statusPulse does NOT pulse on WAITING in B.1 (REVIEWING is the only pulse case; deferred)", () => {
    // Per slicing spec B.1 acceptance criterion 3: "WAITING (amber, no pulse)".
    // REVIEWING is the only state that would pulse, and it is not wired in B.1.
    expect(statusPulse("WAITING")).toBe(false);
    expect(statusPulse("WATCHING")).toBe(false);
    expect(statusPulse("IDLE")).toBe(false);
    expect(statusPulse("HALTED")).toBe(false);
    expect(statusPulse("REVIEWING")).toBe(true); // type-level only in B.1
  });
});
```

- [ ] **Step 2: Run test, expect FAIL ("Cannot find module")**

```bash
pnpm --filter @switchboard/dashboard test -- src/lib/cockpit/riley/__tests__/riley-config.test.ts
```

Expected: `Cannot find module '../riley-config.js'` or similar.

- [ ] **Step 3: Implement**

```ts
// apps/dashboard/src/lib/cockpit/riley/riley-config.ts
import type { CockpitStatus } from "@/components/cockpit/types.js";

export const RILEY_ACCENT = {
  base: "#B86C50",
  deep: "#7E4533",
  soft: "#ECD4C8",
  paper: "#F6E7DE",
} as const;

export const RILEY_TABS = [
  { key: "alex" as const, label: "Alex", state: "inactive" as const },
  { key: "riley" as const, label: "Riley", state: "active" as const },
  { key: "mira" as const, label: "Mira", state: "muted" as const },
];

export const RILEY_MISSION_SUBTITLE = "Optimizing Meta Ads";

export function statusColor(statusKey: CockpitStatus): string {
  switch (statusKey) {
    case "WATCHING":  return "#3F7A36"; // green
    case "REVIEWING": return "#B8782E"; // amber (REVIEWING is type-only in B.1)
    case "WAITING":   return "#B8782E"; // amber
    case "HALTED":    return "#A03A2E"; // red
    default:          return "#A39786"; // grey (ink4) — IDLE/WORKING and any future states fall through
  }
}

// REVIEWING is the only state that pulses. WAITING is amber-but-static per
// slicing spec B.1 acceptance criterion 3. REVIEWING is type-shipped but
// not derivation-wired in B.1 (no signal source today), so in practice no
// B.1 status pulses. The function still correctly handles REVIEWING for
// when B.2 (or a micro-slice) wires the derivation.
export function statusPulse(statusKey: CockpitStatus): boolean {
  return statusKey === "REVIEWING";
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/lib/cockpit/riley/__tests__/riley-config.test.ts
```

Expected: 5 passing.

- [ ] **Step 5: Stage (commit deferred to boundary 1 end)**

```bash
git add apps/dashboard/src/lib/cockpit/riley/riley-config.ts apps/dashboard/src/lib/cockpit/riley/__tests__/riley-config.test.ts
```

---

### Task 2: `kind-meta-riley.ts`

**Files:**
- Create: `apps/dashboard/src/lib/cockpit/riley/kind-meta-riley.ts`
- Test: `apps/dashboard/src/lib/cockpit/riley/__tests__/kind-meta-riley.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/dashboard/src/lib/cockpit/riley/__tests__/kind-meta-riley.test.ts
import { describe, it, expect } from "vitest";
import { RILEY_KIND_META } from "../kind-meta-riley.js";

const RILEY_KINDS = [
  "watching",
  "reviewing",
  "paused",
  "scaled",
  "rotated",
  "shifted",
  "restructured",
  "started",
  "alert",
] as const;

describe("RILEY_KIND_META", () => {
  it("includes all 9 Riley activity kinds", () => {
    for (const k of RILEY_KINDS) {
      expect(RILEY_KIND_META).toHaveProperty(k);
    }
  });

  it("each kind entry has { label, color, pulse }", () => {
    for (const k of RILEY_KINDS) {
      const entry = RILEY_KIND_META[k];
      expect(entry).toHaveProperty("label");
      expect(entry).toHaveProperty("color");
      expect(entry).toHaveProperty("pulse");
      expect(typeof entry.label).toBe("string");
      expect(typeof entry.color).toBe("string");
      expect(typeof entry.pulse).toBe("boolean");
    }
  });

  it("reviewing pulses; others do not", () => {
    expect(RILEY_KIND_META.reviewing.pulse).toBe(true);
    expect(RILEY_KIND_META.watching.pulse).toBe(false);
    expect(RILEY_KIND_META.paused.pulse).toBe(false);
    expect(RILEY_KIND_META.alert.pulse).toBe(false);
  });

  it("labels are uppercase per the spec", () => {
    expect(RILEY_KIND_META.watching.label).toBe("WATCHING");
    expect(RILEY_KIND_META.scaled.label).toBe("SCALED");
    expect(RILEY_KIND_META.alert.label).toBe("ALERT");
  });

  it("alert is red; watching/scaled are green; paused/started are ink3", () => {
    expect(RILEY_KIND_META.alert.color).toBe("#A03A2E");
    expect(RILEY_KIND_META.watching.color).toBe("#3F7A36");
    expect(RILEY_KIND_META.scaled.color).toBe("#3F7A36");
    expect(RILEY_KIND_META.paused.color).toBe("#6B6052");
    expect(RILEY_KIND_META.started.color).toBe("#6B6052");
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- src/lib/cockpit/riley/__tests__/kind-meta-riley.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement**

```ts
// apps/dashboard/src/lib/cockpit/riley/kind-meta-riley.ts
import type { ActivityKind } from "@/components/cockpit/types.js";

type RileyActivityKind = Extract<
  ActivityKind,
  "watching" | "reviewing" | "paused" | "scaled" | "rotated" | "shifted" | "restructured" | "started" | "alert"
>;

interface KindMetaEntry {
  label: string;
  color: string;
  pulse: boolean;
}

export const RILEY_KIND_META: Record<RileyActivityKind, KindMetaEntry> = {
  watching:     { label: "WATCHING",     color: "#3F7A36", pulse: false }, // green
  reviewing:    { label: "REVIEWING",    color: "#7C4F1C", pulse: true  }, // amberDeep
  paused:       { label: "PAUSED",       color: "#6B6052", pulse: false }, // ink3
  scaled:       { label: "SCALED",       color: "#3F7A36", pulse: false }, // green
  rotated:      { label: "ROTATED",      color: "#3A5A80", pulse: false }, // blue
  shifted:      { label: "SHIFTED",      color: "#3A5A80", pulse: false }, // blue
  restructured: { label: "RESTRUCTURED", color: "#3A5A80", pulse: false }, // blue
  started:      { label: "STARTED",      color: "#6B6052", pulse: false }, // ink3
  alert:        { label: "ALERT",        color: "#A03A2E", pulse: false }, // red
};
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/lib/cockpit/riley/__tests__/kind-meta-riley.test.ts
```

Expected: 5 passing.

- [ ] **Step 5: Stage**

```bash
git add apps/dashboard/src/lib/cockpit/riley/kind-meta-riley.ts apps/dashboard/src/lib/cockpit/riley/__tests__/kind-meta-riley.test.ts
```

---

### Task 3: `riley-recommendation-fixtures.ts`

**Files:**
- Create: `apps/dashboard/src/lib/cockpit/riley/__fixtures__/riley-recommendation-fixtures.ts`

Fixtures are test data — no separate test file. Tasks 5+ verify adapters against this data.

- [ ] **Step 1: Implement**

```ts
// apps/dashboard/src/lib/cockpit/riley/__fixtures__/riley-recommendation-fixtures.ts
//
// One fixture per Riley action variant + a multi-row signal-health scenario.
// All adapter tests pull from these. Shape matches RecommendationApiRow from
// apps/dashboard/src/lib/api-client-types.ts and use-recommendations.ts.
//
// NOTE: Riley-specific fields (campaignId, learningPhaseImpact, reversible,
// action, urgency) live in parameters.__recommendation per the verified
// schema audit.

import type { RecommendationApiRow } from "@/lib/api-client-types.js";

function baseRow(overrides: Partial<RecommendationApiRow>): RecommendationApiRow {
  return {
    id: "rec_base",
    intent: "recommendation.pause",
    agentKey: "riley",
    humanSummary: "",
    dollarsAtRisk: 0,
    confidence: 0.8,
    status: "pending",
    presentation: { primaryLabel: "", secondaryLabel: "", dismissLabel: "Decline" },
    targetEntities: {},
    parameters: {
      __recommendation: {
        campaignId: "camp_001",
        learningPhaseImpact: "no impact",
        reversible: false,
        action: "pause",
        urgency: "immediate",
      },
    },
    createdAt: "2026-05-14T10:00:00.000Z",
    undoableUntil: null,
    ...overrides,
  };
}

export const pauseFixture = baseRow({
  id: "rec_pause_01",
  intent: "recommendation.pause",
  humanSummary: "CPL $42 vs $25 target for 3 days. Spend $680 at risk this week.",
  dollarsAtRisk: 680,
  confidence: 0.9,
  presentation: { primaryLabel: "Pause adset", secondaryLabel: "Decline", dismissLabel: "Decline" },
  targetEntities: { campaignName: "Spring Sale — Awareness", adSetName: "Cold Interests" },
  parameters: {
    __recommendation: {
      campaignId: "camp_spring",
      learningPhaseImpact: "no impact",
      reversible: true,
      action: "pause",
      urgency: "immediate",
    },
  },
});

export const scaleFixture = baseRow({
  id: "rec_scale_01",
  intent: "recommendation.scale",
  humanSummary: "ROAS 3.2× sustained for 7 days; running under your daily cap. Suggest +$40/day.",
  dollarsAtRisk: 0,
  confidence: 0.7,
  presentation: { primaryLabel: "Scale +$40/day", secondaryLabel: "Decline", dismissLabel: "Decline" },
  targetEntities: { campaignName: "Lookalike 1%" },
  parameters: {
    __recommendation: {
      campaignId: "camp_lal1",
      learningPhaseImpact: "no impact",
      reversible: true,
      action: "scale",
      urgency: "this_week",
    },
  },
});

export const refreshCreativeFixture = baseRow({
  id: "rec_refresh_01",
  intent: "recommendation.refresh_creative",
  humanSummary: "CTR down 38% over 5 days; same creative live 14 days. Three fresh variants ready.",
  dollarsAtRisk: 220,
  confidence: 0.85,
  presentation: { primaryLabel: "Refresh creative", secondaryLabel: "Decline", dismissLabel: "Decline" },
  targetEntities: { campaignName: "Retargeting — Hot" },
  parameters: {
    __recommendation: {
      campaignId: "camp_retar",
      learningPhaseImpact: "will reset learning",
      reversible: false,
      action: "refresh_creative",
      urgency: "this_week",
    },
  },
});

export const restructureFixture = baseRow({
  id: "rec_restructure_01",
  intent: "recommendation.restructure",
  humanSummary: "Audience is saturated — expanding targeting will find new reach.",
  dollarsAtRisk: 150,
  confidence: 0.65,
  presentation: { primaryLabel: "Create expanded ad set", secondaryLabel: "Decline", dismissLabel: "Decline" },
  targetEntities: { campaignName: "Lookalike 1%" },
  parameters: {
    __recommendation: {
      campaignId: "camp_lal1",
      learningPhaseImpact: "will reset learning",
      reversible: false,
      action: "restructure",
      urgency: "next_cycle",
    },
  },
});

export const shiftBudgetFixture = baseRow({
  id: "rec_shift_01",
  intent: "recommendation.shift_budget_to_source",
  humanSummary: "Google trueROAS is 2.4× Meta — consider shifting budget.",
  dollarsAtRisk: 0,
  confidence: 0.6,
  presentation: { primaryLabel: "Shift to Google", secondaryLabel: "Decline", dismissLabel: "Decline" },
  targetEntities: { campaignName: "Multi-source · Hot" },
  parameters: {
    __recommendation: {
      campaignId: "camp_multi",
      learningPhaseImpact: "no impact",
      reversible: false,
      action: "shift_budget_to_source",
      urgency: "this_week",
    },
  },
});

export const switchEventFixture = baseRow({
  id: "rec_switch_01",
  intent: "recommendation.switch_optimization_event",
  humanSummary: "Optimizing on chat starts is attracting low-intent clickers — switch to Schedule.",
  dollarsAtRisk: 90,
  confidence: 0.75,
  presentation: { primaryLabel: "Switch to Schedule", secondaryLabel: "Decline", dismissLabel: "Decline" },
  targetEntities: { campaignName: "CTWA · Cold" },
  parameters: {
    __recommendation: {
      campaignId: "camp_ctwa",
      learningPhaseImpact: "will reset learning",
      reversible: false,
      action: "switch_optimization_event",
      urgency: "this_week",
    },
  },
});

export const hardenCapiFixture = baseRow({
  id: "rec_capi_01",
  intent: "recommendation.harden_capi_attribution",
  humanSummary: "No CAPI Schedule events received in 7+ days — Meta cannot optimize without signal.",
  dollarsAtRisk: 0,
  confidence: 0.7,
  presentation: { primaryLabel: "Open CAPI settings", secondaryLabel: "Decline", dismissLabel: "Decline" },
  targetEntities: { campaignName: "Account-wide" },
  parameters: {
    __recommendation: {
      campaignId: "account_capi",
      learningPhaseImpact: "no impact",
      reversible: false,
      action: "harden_capi_attribution",
      urgency: "this_week",
      externalUrl: "https://business.facebook.com/events_manager2/list/pixel/CAPI_SETUP",
    },
  },
});

export const holdFixture = baseRow({
  id: "rec_hold_01",
  intent: "recommendation.hold",
  humanSummary: "Landing page issues are driving up costs — fix before increasing spend.",
  dollarsAtRisk: 110,
  confidence: 0.75,
  presentation: { primaryLabel: "Hold budget changes", secondaryLabel: "Decline", dismissLabel: "Decline" },
  targetEntities: { campaignName: "Spring Sale — Awareness" },
  parameters: {
    __recommendation: {
      campaignId: "camp_spring",
      learningPhaseImpact: "no impact",
      reversible: false,
      action: "hold",
      urgency: "this_week",
    },
  },
});

export const addCreativeFixture = baseRow({
  id: "rec_addc_01",
  intent: "recommendation.add_creative",
  humanSummary: "CPA significantly above target — add fresh creatives and reduce budget.",
  dollarsAtRisk: 480,
  confidence: 0.8,
  presentation: { primaryLabel: "Approve plan", secondaryLabel: "Decline", dismissLabel: "Decline" },
  targetEntities: { campaignName: "Retargeting — Cold" },
  parameters: {
    __recommendation: {
      campaignId: "camp_retar_cold",
      learningPhaseImpact: "will reset learning",
      reversible: false,
      action: "add_creative",
      urgency: "this_week",
    },
  },
});

export const reviewBudgetFixture = baseRow({
  id: "rec_review_01",
  intent: "recommendation.review_budget",
  humanSummary: "Campaign appears above target CPA (1.8×). Review in Ads Manager.",
  dollarsAtRisk: 0,
  confidence: 0.65,
  presentation: { primaryLabel: "Open in Ads Manager", secondaryLabel: "Decline", dismissLabel: "Decline" },
  targetEntities: { campaignName: "Spring Sale — Awareness" },
  parameters: {
    __recommendation: {
      campaignId: "camp_spring",
      learningPhaseImpact: "no impact",
      reversible: false,
      action: "review_budget",
      urgency: "this_week",
      externalUrl: "https://business.facebook.com/adsmanager/manage/campaigns?act=000",
    },
  },
});

// Signal-health: three rows for the same pixel — adapter must collapse to one card
export const signalHealthFixtures: RecommendationApiRow[] = [
  baseRow({
    id: "rec_sh_pixel_dead",
    intent: "recommendation.fix_signal_health",
    humanSummary: "Pixel is dead — check website installation.",
    presentation: { primaryLabel: "Open Events Manager", secondaryLabel: "", dismissLabel: "Decline" },
    targetEntities: { pixelId: "1234567890" },
    parameters: {
      __recommendation: {
        campaignId: "signal:1234567890",
        learningPhaseImpact: "no impact",
        reversible: false,
        action: "fix_signal_health",
        urgency: "immediate",
        breach: "pixel_dead",
        externalUrl: "https://business.facebook.com/events_manager2/list/pixel/1234567890",
      },
    },
  }),
  baseRow({
    id: "rec_sh_s2b_low",
    intent: "recommendation.fix_signal_health",
    humanSummary: "Server-to-browser ratio is below target — missing CAPI signal.",
    presentation: { primaryLabel: "Open Events Manager", secondaryLabel: "", dismissLabel: "Decline" },
    targetEntities: { pixelId: "1234567890" },
    parameters: {
      __recommendation: {
        campaignId: "signal:1234567890",
        learningPhaseImpact: "no impact",
        reversible: false,
        action: "fix_signal_health",
        urgency: "this_week",
        breach: "server_to_browser_low",
      },
    },
  }),
  baseRow({
    id: "rec_sh_freshness",
    intent: "recommendation.fix_signal_health",
    humanSummary: "CAPI server events are stale — Meta's optimizer cannot react.",
    presentation: { primaryLabel: "Open Events Manager", secondaryLabel: "", dismissLabel: "Decline" },
    targetEntities: { pixelId: "1234567890" },
    parameters: {
      __recommendation: {
        campaignId: "signal:1234567890",
        learningPhaseImpact: "no impact",
        reversible: false,
        action: "fix_signal_health",
        urgency: "this_week",
        breach: "freshness_stale",
      },
    },
  }),
];

export const ALL_RILEY_FIXTURES = [
  pauseFixture,
  scaleFixture,
  refreshCreativeFixture,
  restructureFixture,
  shiftBudgetFixture,
  switchEventFixture,
  hardenCapiFixture,
  holdFixture,
  addCreativeFixture,
  reviewBudgetFixture,
  ...signalHealthFixtures,
];
```

- [ ] **Step 2: Verify the fixture file compiles (typecheck)**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: clean. If the import `RecommendationApiRow` doesn't resolve, check `apps/dashboard/src/lib/api-client-types.ts` for the actual exported name and adjust the import.

- [ ] **Step 3: Stage**

```bash
git add apps/dashboard/src/lib/cockpit/riley/__fixtures__/riley-recommendation-fixtures.ts
```

---

### Task 4: `riley-activity-fixtures.ts`

**Files:**
- Create: `apps/dashboard/src/lib/cockpit/riley/__fixtures__/riley-activity-fixtures.ts`

- [ ] **Step 1: Implement**

```ts
// apps/dashboard/src/lib/cockpit/riley/__fixtures__/riley-activity-fixtures.ts
//
// One fixture per Riley activity kind. Shape matches TranslatedAction returned
// by use-agent-activity (apps/dashboard/src/hooks/use-agent-activity.ts).
//
// Confirm shape against `TranslatedAction` export from that file before using.

import type { TranslatedAction } from "@/hooks/use-agent-activity.js";

function base(overrides: Partial<TranslatedAction>): TranslatedAction {
  return {
    id: "act_base",
    occurredAt: "2026-05-14T10:00:00.000Z",
    eventType: "system.daily_scan_started",
    intent: "system.daily_scan_started",
    summary: "",
    agentKey: "riley",
    actorKind: "system",
    actorId: "ad-optimizer",
    status: "ok",
    ...overrides,
  };
}

export const watchingFixture = base({
  id: "act_watching",
  eventType: "system.daily_scan_completed",
  intent: "system.daily_scan_completed",
  summary: "Daily scan complete — 14 campaigns reviewed.",
});

export const reviewingFixture = base({
  id: "act_reviewing",
  eventType: "system.scoring_run_in_progress",
  intent: "system.scoring_run_in_progress",
  summary: "Scoring run in progress.",
});

export const pausedFixture = base({
  id: "act_paused",
  eventType: "recommendation.pause",
  intent: "recommendation.pause",
  summary: "Paused Cold Interests adset (Spring Sale).",
  status: "acted",
});

export const scaledFixture = base({
  id: "act_scaled",
  eventType: "recommendation.scale",
  intent: "recommendation.scale",
  summary: "Scaled Lookalike 1% by $40/day.",
  status: "acted",
});

export const rotatedFixture = base({
  id: "act_rotated",
  eventType: "recommendation.refresh_creative",
  intent: "recommendation.refresh_creative",
  summary: "Refreshed Retargeting creative.",
  status: "acted",
});

export const shiftedFixture = base({
  id: "act_shifted",
  eventType: "recommendation.shift_budget_to_source",
  intent: "recommendation.shift_budget_to_source",
  summary: "Shifted budget to Google.",
  status: "acted",
});

export const restructuredFixture = base({
  id: "act_restructured",
  eventType: "recommendation.restructure",
  intent: "recommendation.restructure",
  summary: "Expanded targeting on Lookalike 1%.",
  status: "acted",
});

export const startedFixture = base({
  id: "act_started",
  eventType: "signal.learning_phase_active",
  intent: "signal.learning_phase_active",
  summary: "Learning phase active — 3–5 days.",
  status: "ok",
});

export const alertFixture = base({
  id: "act_alert",
  eventType: "signal.connection_health_degraded",
  intent: "signal.connection_health_degraded",
  summary: "Pixel signal degraded.",
  status: "warn",
});

// Three-vocabulary drift coverage — same semantic event, different intents
export const vocabularyDriftFixtures: TranslatedAction[] = [
  base({ id: "act_vocab_1", intent: "recommendation.pause",      summary: "v1: pause", status: "acted" }),
  base({ id: "act_vocab_2", intent: "recommendation.pause_adset", summary: "v2: pause_adset", status: "acted" }),
  base({ id: "act_vocab_3", intent: "recommendation.ad_set_pause", summary: "v3: ad_set_pause", status: "acted" }),
];

export const ALL_RILEY_ACTIVITY_FIXTURES = [
  watchingFixture,
  reviewingFixture,
  pausedFixture,
  scaledFixture,
  rotatedFixture,
  shiftedFixture,
  restructuredFixture,
  startedFixture,
  alertFixture,
];
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

If `TranslatedAction` doesn't resolve, check the actual export from `use-agent-activity.ts` and adjust. The fixture shape may need to be loosened if the dashboard's `TranslatedAction` type is internal — in that case, define a local `RileyActivityFixture` interface with the same fields.

- [ ] **Step 3: Stage and commit boundary 1**

```bash
git add apps/dashboard/src/lib/cockpit/riley/__fixtures__/riley-activity-fixtures.ts
git commit -m "$(cat <<'EOF'
feat(riley-cockpit): foundations — config, kind meta, fixtures (B.1)

- riley-config.ts: accent, tabs, status helpers (mission popover and
  composer config deferred to B.2/B.3 per slicing spec)
- kind-meta-riley.ts: 9 Riley activity kinds with label/color/pulse
- __fixtures__/: per-action-variant Recommendation fixtures (11
  variants + 3-row signal-health scenario) and per-kind activity
  fixtures (9 kinds + 3-row three-vocabulary-drift scenario)

All Riley-specific fields (campaignId, learningPhaseImpact, reversible,
action, urgency) are nested in parameters.__recommendation per the
verified Recommendation schema audit.

Adapter tests in boundary 2 pull from these fixtures.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Boundary 2: Pure adapters

### Task 5: `recommendation-to-approval-view.ts`

**Files:**
- Create: `apps/dashboard/src/lib/cockpit/riley/recommendation-to-approval-view.ts`
- Test: `apps/dashboard/src/lib/cockpit/riley/__tests__/recommendation-to-approval-view.test.ts`

This is the largest adapter. It handles 10 single-row variants (the 11th, `signal_health_group`, comes from the grouper in Task 6, wired together by the orchestrator). The test uses `describe.each` over the fixtures.

- [ ] **Step 1: Write failing test**

```ts
// apps/dashboard/src/lib/cockpit/riley/__tests__/recommendation-to-approval-view.test.ts
import { describe, it, expect } from "vitest";
import { recommendationToApprovalView } from "../recommendation-to-approval-view.js";
import {
  pauseFixture,
  scaleFixture,
  refreshCreativeFixture,
  restructureFixture,
  shiftBudgetFixture,
  switchEventFixture,
  hardenCapiFixture,
  holdFixture,
  addCreativeFixture,
  reviewBudgetFixture,
} from "../__fixtures__/riley-recommendation-fixtures.js";
import type { RecommendationApiRow } from "@/lib/api-client-types.js";

const SINGLE_ROW_FIXTURES: Array<[string, RecommendationApiRow, { kind: string; urgency: string }]> = [
  ["pause",                       pauseFixture,           { kind: "pause",                       urgency: "immediate" }],
  ["scale",                       scaleFixture,           { kind: "scale",                       urgency: "this_week" }],
  ["refresh_creative",            refreshCreativeFixture, { kind: "refresh_creative",            urgency: "this_week" }],
  ["restructure",                 restructureFixture,     { kind: "restructure",                 urgency: "next_cycle" }],
  ["shift_budget_to_source",      shiftBudgetFixture,     { kind: "shift_budget_to_source",      urgency: "this_week" }],
  ["switch_optimization_event",   switchEventFixture,     { kind: "switch_optimization_event",   urgency: "this_week" }],
  ["harden_capi_attribution",     hardenCapiFixture,      { kind: "harden_capi_attribution",     urgency: "this_week" }],
  ["hold",                        holdFixture,            { kind: "hold",                        urgency: "this_week" }],
  ["add_creative",                addCreativeFixture,     { kind: "add_creative",                urgency: "this_week" }],
  ["review_budget",               reviewBudgetFixture,    { kind: "review_budget",               urgency: "this_week" }],
];

describe("recommendationToApprovalView", () => {
  describe.each(SINGLE_ROW_FIXTURES)("variant: %s", (_name, fixture, expected) => {
    const view = recommendationToApprovalView(fixture);

    it("produces a view-model with the expected kind", () => {
      expect(view).not.toBeNull();
      expect(view!.kind).toBe(expected.kind);
    });

    it("urgency matches the fixture's __recommendation.urgency", () => {
      expect(view!.urgency).toBe(expected.urgency);
    });

    it("quote equals fixture.humanSummary verbatim", () => {
      expect(view!.quote).toBe(fixture.humanSummary);
    });

    it("primary CTA equals presentation.primaryLabel verbatim", () => {
      expect(view!.primary).toBe(fixture.presentation.primaryLabel);
    });

    it("askedAt is a non-empty relative-age string", () => {
      expect(typeof view!.askedAt).toBe("string");
      expect(view!.askedAt.length).toBeGreaterThan(0);
    });

    it("preserves confidence and learningPhaseImpact from __recommendation", () => {
      expect(view!.confidence).toBe(fixture.confidence);
      expect(view!.learningPhaseImpact).toBe(fixture.parameters.__recommendation!.learningPhaseImpact);
    });

    it("reversible flag flows from __recommendation", () => {
      expect(view!.reversible).toBe(fixture.parameters.__recommendation!.reversible);
    });
  });

  it("returns null for a row missing __recommendation (defensive)", () => {
    const malformed = { ...pauseFixture, parameters: {} } as RecommendationApiRow;
    expect(recommendationToApprovalView(malformed)).toBeNull();
  });

  it("risk field is set for negative-action recs (pause, hold)", () => {
    expect(recommendationToApprovalView(pauseFixture)!.risk).toMatch(/\$680/);
    expect(recommendationToApprovalView(holdFixture)!.risk).toMatch(/\$110/);
  });

  it("scale rec has no $-risk (positive framing)", () => {
    const view = recommendationToApprovalView(scaleFixture)!;
    expect(view.risk === undefined || !view.risk.includes("at risk")).toBe(true);
  });

  it("external-action recs (review_budget, harden_capi_attribution) carry primaryAction.kind === 'external'", () => {
    expect(recommendationToApprovalView(reviewBudgetFixture)!.primaryAction.kind).toBe("external");
    expect(recommendationToApprovalView(hardenCapiFixture)!.primaryAction.kind).toBe("external");
  });

  it("internal-action recs carry primaryAction.kind === 'internal' with intent + parameters", () => {
    const view = recommendationToApprovalView(pauseFixture)!;
    expect(view.primaryAction.kind).toBe("internal");
    if (view.primaryAction.kind === "internal") {
      expect(view.primaryAction.intent).toBe("recommendation.pause");
    }
  });

  it("campaign carries kind === 'campaign' with name + id from targetEntities", () => {
    const view = recommendationToApprovalView(pauseFixture)!;
    expect(view.campaign.kind).toBe("campaign");
    if (view.campaign.kind === "campaign") {
      expect(view.campaign.name).toBe("Spring Sale — Awareness");
    }
  });

  it("orchestrator mapRecommendationsToApprovalViews sorts immediate before this_week before next_cycle", async () => {
    const { mapRecommendationsToApprovalViews } = await import("../recommendation-to-approval-view.js");
    const mixed = [restructureFixture, scaleFixture, pauseFixture];
    const sorted = mapRecommendationsToApprovalViews(mixed);
    expect(sorted.map((v) => v.urgency)).toEqual(["immediate", "this_week", "next_cycle"]);
  });

  it("within urgency band, sorts by dollarsAtRisk descending", async () => {
    const { mapRecommendationsToApprovalViews } = await import("../recommendation-to-approval-view.js");
    const sorted = mapRecommendationsToApprovalViews([refreshCreativeFixture, holdFixture, addCreativeFixture]);
    // All three are this_week; addCreative ($480) > refresh ($220) > hold ($110)
    expect(sorted.map((v) => v.id)).toEqual(["rec_addc_01", "rec_refresh_01", "rec_hold_01"]);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- src/lib/cockpit/riley/__tests__/recommendation-to-approval-view.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement**

```ts
// apps/dashboard/src/lib/cockpit/riley/recommendation-to-approval-view.ts
import type { RecommendationApiRow } from "@/lib/api-client-types.js";
import type { RileyApprovalView, RileyApprovalKind, ApprovalUrgency } from "@/components/cockpit/types.js";
import { formatRelativeAge } from "@switchboard/core/agent-home/relative-age.js";
import { groupSignalHealthByPixel } from "./signal-health-grouper.js";

interface RileyRecParams {
  campaignId: string;
  learningPhaseImpact: "no impact" | "will reset learning";
  reversible: boolean;
  action: string;
  urgency: ApprovalUrgency;
  externalUrl?: string;
  breach?: string;
}

function extractRileyParams(row: RecommendationApiRow): RileyRecParams | null {
  const p = row.parameters?.__recommendation as RileyRecParams | undefined;
  if (!p || !p.campaignId || !p.action || !p.urgency) return null;
  return p;
}

const KIND_FROM_ACTION: Record<string, RileyApprovalKind> = {
  pause: "pause",
  scale: "scale",
  refresh_creative: "refresh_creative",
  restructure: "restructure",
  shift_budget_to_source: "shift_budget_to_source",
  switch_optimization_event: "switch_optimization_event",
  harden_capi_attribution: "harden_capi_attribution",
  hold: "hold",
  add_creative: "add_creative",
  review_budget: "review_budget",
};

const EXTERNAL_ACTIONS = new Set(["review_budget", "harden_capi_attribution"]);

function titleForAction(action: string): string {
  switch (action) {
    case "pause":                     return "Pause adset";
    case "scale":                     return "Scale budget";
    case "refresh_creative":          return "Refresh creative";
    case "restructure":               return "Expand targeting";
    case "shift_budget_to_source":    return "Shift budget";
    case "switch_optimization_event": return "Switch event";
    case "harden_capi_attribution":   return "Fix CAPI";
    case "hold":                      return "Hold spend";
    case "add_creative":              return "Add creative + reduce";
    case "review_budget":             return "Review budget";
    default:                          return action;
  }
}

function riskFromDollars(row: RecommendationApiRow, action: string): string | undefined {
  if (action === "scale") return undefined;
  if (!row.dollarsAtRisk || row.dollarsAtRisk <= 0) return undefined;
  return `$${row.dollarsAtRisk} at risk`;
}

export function recommendationToApprovalView(row: RecommendationApiRow): RileyApprovalView | null {
  const params = extractRileyParams(row);
  if (!params) return null;

  // Signal-health rows are NOT single-row views; they are grouped by the
  // orchestrator below. Return null so a stray single signal:* row does not
  // render as a per-campaign card.
  if (params.campaignId.startsWith("signal:")) return null;

  const kind = KIND_FROM_ACTION[params.action];
  if (!kind) return null;

  const isExternal = EXTERNAL_ACTIONS.has(params.action);
  const primaryAction = isExternal
    ? ({
        kind: "external" as const,
        url: params.externalUrl ?? "https://business.facebook.com/",
        service: "meta" as const,
      })
    : ({
        kind: "internal" as const,
        intent: row.intent,
        parameters: row.parameters,
      });

  const campaignName = row.targetEntities?.campaignName ?? "Unknown campaign";

  return {
    id: row.id,
    kind,
    urgency: params.urgency,
    askedAt: formatRelativeAge(new Date(row.createdAt), new Date(), "UTC"),
    title: titleForAction(params.action),
    quote: row.humanSummary,
    risk: riskFromDollars(row, params.action),
    confidence: row.confidence,
    learningPhaseImpact: params.learningPhaseImpact,
    reversible: params.reversible,
    presentation: {
      primaryLabel: row.presentation.primaryLabel,
      dismissLabel: row.presentation.dismissLabel,
    },
    primary: row.presentation.primaryLabel,
    secondary: row.presentation.dismissLabel,
    primaryAction,
    campaign: { kind: "campaign", name: campaignName, id: params.campaignId },
  };
}

const URGENCY_ORDER: Record<ApprovalUrgency, number> = {
  immediate: 0,
  this_week: 1,
  next_cycle: 2,
};

export function mapRecommendationsToApprovalViews(rows: RecommendationApiRow[]): RileyApprovalView[] {
  const signalHealthRows = rows.filter((r) => {
    const p = extractRileyParams(r);
    return p?.campaignId.startsWith("signal:") ?? false;
  });
  const otherRows = rows.filter((r) => !signalHealthRows.includes(r));

  const single = otherRows
    .map(recommendationToApprovalView)
    .filter((v): v is RileyApprovalView => v !== null);

  const grouped = groupSignalHealthByPixel(signalHealthRows);

  const all = [...single, ...grouped];

  all.sort((a, b) => {
    const u = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency];
    if (u !== 0) return u;
    const ra = a.risk ? parseInt(a.risk.replace(/[^0-9]/g, ""), 10) : 0;
    const rb = b.risk ? parseInt(b.risk.replace(/[^0-9]/g, ""), 10) : 0;
    return rb - ra;
  });

  return all;
}
```

- [ ] **Step 4: Run test, expect PASS (after Task 6 implements `groupSignalHealthByPixel`)**

Implement Task 6 first if `signal-health-grouper.ts` doesn't exist yet. Or comment out the `groupSignalHealthByPixel` import and orchestrator path temporarily, get single-row tests green, then re-enable after Task 6.

```bash
pnpm --filter @switchboard/dashboard test -- src/lib/cockpit/riley/__tests__/recommendation-to-approval-view.test.ts
```

- [ ] **Step 5: Stage**

```bash
git add apps/dashboard/src/lib/cockpit/riley/recommendation-to-approval-view.ts apps/dashboard/src/lib/cockpit/riley/__tests__/recommendation-to-approval-view.test.ts
```

---

### Task 6: `signal-health-grouper.ts`

**Files:**
- Create: `apps/dashboard/src/lib/cockpit/riley/signal-health-grouper.ts`
- Test: `apps/dashboard/src/lib/cockpit/riley/__tests__/signal-health-grouper.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/dashboard/src/lib/cockpit/riley/__tests__/signal-health-grouper.test.ts
import { describe, it, expect } from "vitest";
import { groupSignalHealthByPixel } from "../signal-health-grouper.js";
import { signalHealthFixtures } from "../__fixtures__/riley-recommendation-fixtures.js";

describe("groupSignalHealthByPixel", () => {
  it("collapses 3 rows for the same pixel into 1 view-model", () => {
    const grouped = groupSignalHealthByPixel(signalHealthFixtures);
    expect(grouped).toHaveLength(1);
  });

  it("synthesized view-model uses campaign.kind === 'account'", () => {
    const [view] = groupSignalHealthByPixel(signalHealthFixtures);
    expect(view.campaign.kind).toBe("account");
  });

  it("carries the pixelId and breach count", () => {
    const [view] = groupSignalHealthByPixel(signalHealthFixtures);
    if (view.campaign.kind === "account") {
      expect(view.campaign.pixelId).toBe("1234567890");
      expect(view.campaign.breaches).toBe(3);
    }
  });

  it("quote is a bulleted breach list", () => {
    const [view] = groupSignalHealthByPixel(signalHealthFixtures);
    expect(view.quote).toContain("•");
    expect(view.quote).toContain("Pixel is dead");
    expect(view.quote).toContain("Server-to-browser");
    expect(view.quote).toContain("stale");
  });

  it("kind is 'signal_health_group'", () => {
    const [view] = groupSignalHealthByPixel(signalHealthFixtures);
    expect(view.kind).toBe("signal_health_group");
  });

  it("urgency is 'immediate' if any breach is immediate; otherwise 'this_week'", () => {
    const [view] = groupSignalHealthByPixel(signalHealthFixtures);
    // signalHealthFixtures has one 'immediate' (pixel_dead) and two 'this_week'
    expect(view.urgency).toBe("immediate");
  });

  it("primaryAction is external with Meta Events Manager URL", () => {
    const [view] = groupSignalHealthByPixel(signalHealthFixtures);
    expect(view.primaryAction.kind).toBe("external");
    if (view.primaryAction.kind === "external") {
      expect(view.primaryAction.service).toBe("meta");
      expect(view.primaryAction.url).toContain("events_manager");
    }
  });

  it("no 'Dismiss all' affordance in B.1 — secondary label is empty or 'Decline' but presentation.dismissLabel does NOT say 'Dismiss all'", () => {
    const [view] = groupSignalHealthByPixel(signalHealthFixtures);
    expect(view.presentation.dismissLabel.toLowerCase()).not.toContain("dismiss all");
  });

  it("returns empty array when given no signal-health rows", () => {
    expect(groupSignalHealthByPixel([])).toEqual([]);
  });

  it("groups rows from different pixels independently (2 pixels → 2 view-models)", () => {
    const otherPixel = {
      ...signalHealthFixtures[0],
      id: "rec_other_pixel",
      targetEntities: { pixelId: "9876543210" },
      parameters: {
        __recommendation: {
          ...signalHealthFixtures[0].parameters.__recommendation!,
          campaignId: "signal:9876543210",
        },
      },
    };
    const grouped = groupSignalHealthByPixel([...signalHealthFixtures, otherPixel]);
    expect(grouped).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- src/lib/cockpit/riley/__tests__/signal-health-grouper.test.ts
```

- [ ] **Step 3: Implement**

```ts
// apps/dashboard/src/lib/cockpit/riley/signal-health-grouper.ts
import type { RecommendationApiRow } from "@/lib/api-client-types.js";
import type { RileyApprovalView, ApprovalUrgency } from "@/components/cockpit/types.js";
import { formatRelativeAge } from "@switchboard/core/agent-home/relative-age.js";

interface RileyRecParams {
  campaignId: string;
  urgency: ApprovalUrgency;
  externalUrl?: string;
  breach?: string;
}

const URGENCY_ORDER: Record<ApprovalUrgency, number> = {
  immediate: 0,
  this_week: 1,
  next_cycle: 2,
};

const META_EVENTS_MANAGER_FALLBACK = "https://business.facebook.com/events_manager2/list/pixel/";

export function groupSignalHealthByPixel(rows: RecommendationApiRow[]): RileyApprovalView[] {
  // Group rows by pixelId. Each group becomes one ApprovalView with
  // campaign.kind === "account".
  const byPixel = new Map<string, RecommendationApiRow[]>();
  for (const row of rows) {
    const pixelId = row.targetEntities?.pixelId;
    if (!pixelId) continue;
    const params = row.parameters?.__recommendation as RileyRecParams | undefined;
    if (!params?.campaignId.startsWith("signal:")) continue;
    const list = byPixel.get(pixelId) ?? [];
    list.push(row);
    byPixel.set(pixelId, list);
  }

  const views: RileyApprovalView[] = [];
  for (const [pixelId, group] of byPixel) {
    // Most-urgent breach in the group dictates the card urgency
    const urgencies = group.map((r) => (r.parameters?.__recommendation as RileyRecParams)?.urgency).filter(Boolean);
    const urgency = urgencies.sort((a, b) => URGENCY_ORDER[a] - URGENCY_ORDER[b])[0] ?? "this_week";

    const earliestCreated = group
      .map((r) => new Date(r.createdAt).getTime())
      .reduce((a, b) => Math.min(a, b), Number.MAX_SAFE_INTEGER);

    const quoteLines = group.map((r) => `• ${r.humanSummary}`).join("\n");

    // Find an external URL on any of the group's rows; fallback to Events Manager root
    const externalUrl =
      group.find((r) => (r.parameters?.__recommendation as RileyRecParams)?.externalUrl)
        ?.parameters?.__recommendation as RileyRecParams | undefined;
    const url = externalUrl?.externalUrl ?? `${META_EVENTS_MANAGER_FALLBACK}${pixelId}`;

    views.push({
      id: `signal_health_group:${pixelId}`,
      kind: "signal_health_group",
      urgency,
      askedAt: formatRelativeAge(new Date(earliestCreated), new Date(), "UTC"),
      title: `Fix tracking signal — pixel ${pixelId}`,
      quote: quoteLines,
      confidence: 0.9,
      learningPhaseImpact: "no impact",
      reversible: false,
      presentation: {
        primaryLabel: "Open Events Manager",
        dismissLabel: "Decline",
      },
      primary: "Open Events Manager",
      secondary: "Decline",
      primaryAction: { kind: "external", url, service: "meta" },
      campaign: { kind: "account", pixelId, breaches: group.length },
    });
  }

  return views;
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/lib/cockpit/riley/__tests__/signal-health-grouper.test.ts
```

- [ ] **Step 5: Re-run Task 5's test (now that the grouper is implemented)**

```bash
pnpm --filter @switchboard/dashboard test -- src/lib/cockpit/riley/__tests__/recommendation-to-approval-view.test.ts
```

Expected: all PASS (including the orchestrator-level tests).

- [ ] **Step 6: Stage**

```bash
git add apps/dashboard/src/lib/cockpit/riley/signal-health-grouper.ts apps/dashboard/src/lib/cockpit/riley/__tests__/signal-health-grouper.test.ts
```

---

### Task 7: `riley-activity-translator.ts`

**Files:**
- Create: `apps/dashboard/src/lib/cockpit/riley/riley-activity-translator.ts`
- Test: `apps/dashboard/src/lib/cockpit/riley/__tests__/riley-activity-translator.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/dashboard/src/lib/cockpit/riley/__tests__/riley-activity-translator.test.ts
import { describe, it, expect } from "vitest";
import { translateRileyActivity } from "../riley-activity-translator.js";
import {
  watchingFixture,
  reviewingFixture,
  pausedFixture,
  scaledFixture,
  rotatedFixture,
  shiftedFixture,
  restructuredFixture,
  startedFixture,
  alertFixture,
  vocabularyDriftFixtures,
} from "../__fixtures__/riley-activity-fixtures.js";

describe("translateRileyActivity", () => {
  it("watching: system.daily_scan_completed → kind 'watching'", () => {
    const [row] = translateRileyActivity([watchingFixture]);
    expect(row.kind).toBe("watching");
  });

  it("reviewing: system.scoring_run_in_progress → kind 'reviewing'", () => {
    const [row] = translateRileyActivity([reviewingFixture]);
    expect(row.kind).toBe("reviewing");
  });

  it("paused: recommendation.pause + status='acted' → kind 'paused'", () => {
    const [row] = translateRileyActivity([pausedFixture]);
    expect(row.kind).toBe("paused");
  });

  it("scaled: recommendation.scale + status='acted' → kind 'scaled'", () => {
    const [row] = translateRileyActivity([scaledFixture]);
    expect(row.kind).toBe("scaled");
  });

  it("rotated: recommendation.refresh_creative + status='acted' → kind 'rotated'", () => {
    const [row] = translateRileyActivity([rotatedFixture]);
    expect(row.kind).toBe("rotated");
  });

  it("shifted: recommendation.shift_budget_to_source + status='acted' → kind 'shifted'", () => {
    const [row] = translateRileyActivity([shiftedFixture]);
    expect(row.kind).toBe("shifted");
  });

  it("restructured: recommendation.restructure + status='acted' → kind 'restructured'", () => {
    const [row] = translateRileyActivity([restructuredFixture]);
    expect(row.kind).toBe("restructured");
  });

  it("started: signal.learning_phase_active → kind 'started'", () => {
    const [row] = translateRileyActivity([startedFixture]);
    expect(row.kind).toBe("started");
  });

  it("alert: signal.connection_health_degraded → kind 'alert'", () => {
    const [row] = translateRileyActivity([alertFixture]);
    expect(row.kind).toBe("alert");
  });

  it("three-vocabulary intent drift: all three pause variants map to 'paused'", () => {
    const rows = translateRileyActivity(vocabularyDriftFixtures);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.kind).toBe("paused");
    }
  });

  it("unknown intent falls back to 'watching' (graceful degradation)", () => {
    const unknown = { ...watchingFixture, intent: "garbage.event.unknown" };
    const [row] = translateRileyActivity([unknown]);
    expect(row.kind).toBe("watching");
  });

  it("head and body are populated from summary", () => {
    const [row] = translateRileyActivity([pausedFixture]);
    expect(row.head.length).toBeGreaterThan(0);
    expect(row.body?.length ?? 0).toBeGreaterThanOrEqual(0);
  });

  it("time is a relative-age string", () => {
    const [row] = translateRileyActivity([pausedFixture]);
    expect(typeof row.time).toBe("string");
    expect(row.time.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- src/lib/cockpit/riley/__tests__/riley-activity-translator.test.ts
```

- [ ] **Step 3: Implement**

```ts
// apps/dashboard/src/lib/cockpit/riley/riley-activity-translator.ts
import type { ActivityRow, ActivityKind } from "@/components/cockpit/types.js";
import type { TranslatedAction } from "@/hooks/use-agent-activity.js";
import { formatRelativeAge } from "@switchboard/core/agent-home/relative-age.js";

// Normalize the three vocabularies into a canonical action token.
function normalizeIntent(intent: string): string {
  return intent
    .replace(/^recommendation\./, "")
    .replace(/_adset$/, "")
    .replace(/^ad_set_/, "")
    .replace(/_/g, "_");
}

function deriveKind(intent: string, status: string | undefined): ActivityKind {
  // System events
  if (intent.startsWith("system.scoring")) return "reviewing";
  if (intent.startsWith("system.daily_scan")) return "watching";

  // Signal events
  if (intent === "signal.learning_phase_active") return "started";
  if (
    intent === "signal.connection_health_degraded" ||
    intent === "signal.capi_attribution_stale" ||
    intent === "signal.crm_data_disconnected"
  ) {
    return "alert";
  }

  // Acted recommendations (three-vocabulary normalization)
  const action = normalizeIntent(intent);
  if (status !== "acted") {
    return "watching";
  }
  switch (action) {
    case "pause":                     return "paused";
    case "reduce_budget":             return "scaled";
    case "scale":                     return "scaled";
    case "refresh_creative":          return "rotated";
    case "add_creative":              return "rotated";
    case "restructure":               return "restructured";
    case "switch_optimization_event": return "restructured";
    case "shift_budget_to_source":    return "shifted";
    case "hold":                      return "paused";
    case "fix_signal_health":         return "alert";
    default:                          return "watching";
  }
}

export function translateRileyActivity(actions: TranslatedAction[]): ActivityRow[] {
  return actions.map((a) => ({
    time: formatRelativeAge(new Date(a.occurredAt), new Date(), "UTC"),
    kind: deriveKind(a.intent, a.status),
    head: a.summary || a.intent,
    body: undefined,
  }));
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/lib/cockpit/riley/__tests__/riley-activity-translator.test.ts
```

- [ ] **Step 5: Stage**

```bash
git add apps/dashboard/src/lib/cockpit/riley/riley-activity-translator.ts apps/dashboard/src/lib/cockpit/riley/__tests__/riley-activity-translator.test.ts
```

---

### Task 8: `cold-state-activity-rows.ts`

**Files:**
- Create: `apps/dashboard/src/lib/cockpit/riley/cold-state-activity-rows.ts`
- Test: `apps/dashboard/src/lib/cockpit/riley/__tests__/cold-state-activity-rows.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/dashboard/src/lib/cockpit/riley/__tests__/cold-state-activity-rows.test.ts
import { describe, it, expect } from "vitest";
import { coldStateActivityRows } from "../cold-state-activity-rows.js";

describe("coldStateActivityRows", () => {
  it("returns exactly 3 synthetic rows", () => {
    expect(coldStateActivityRows()).toHaveLength(3);
  });

  it("first row prompts Meta Ads connection", () => {
    const [row] = coldStateActivityRows();
    expect(row.kind).toBe("alert");
    expect(row.head).toMatch(/Connect Meta Ads/i);
    expect(row.time).toBe("—");
  });

  it("second row prompts setting average lead value", () => {
    const [, row] = coldStateActivityRows();
    expect(row.head).toMatch(/lead value/i);
    expect(row.time).toBe("—");
  });

  it("third row signals standing rules loaded", () => {
    const [, , row] = coldStateActivityRows();
    expect(row.kind).toBe("started");
    expect(row.head).toMatch(/rules/i);
    expect(row.time).toBe("—");
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- src/lib/cockpit/riley/__tests__/cold-state-activity-rows.test.ts
```

- [ ] **Step 3: Implement**

```ts
// apps/dashboard/src/lib/cockpit/riley/cold-state-activity-rows.ts
import type { ActivityRow } from "@/components/cockpit/types.js";

export function coldStateActivityRows(): ActivityRow[] {
  return [
    {
      time: "—",
      kind: "alert",
      head: "Connect Meta Ads to begin",
      body: "Riley needs your Meta Ads account to start scoring campaigns.",
    },
    {
      time: "—",
      kind: "alert",
      head: "Set average lead value",
      body: "Riley uses this to compute ROAS and recommend scale/pause actions.",
    },
    {
      time: "—",
      kind: "started",
      head: "Standing rules loaded",
      body: "Riley will run a daily scan once Meta Ads is connected.",
    },
  ];
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/lib/cockpit/riley/__tests__/cold-state-activity-rows.test.ts
```

- [ ] **Step 5: Stage**

```bash
git add apps/dashboard/src/lib/cockpit/riley/cold-state-activity-rows.ts apps/dashboard/src/lib/cockpit/riley/__tests__/cold-state-activity-rows.test.ts
```

---

### Task 9: `riley-status-deriver.ts`

**Files:**
- Create: `apps/dashboard/src/lib/cockpit/riley/riley-status-deriver.ts`
- Test: `apps/dashboard/src/lib/cockpit/riley/__tests__/riley-status-deriver.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/dashboard/src/lib/cockpit/riley/__tests__/riley-status-deriver.test.ts
import { describe, it, expect } from "vitest";
import { deriveRileyStatus } from "../riley-status-deriver.js";

const now = new Date("2026-05-14T12:00:00.000Z");
const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60_000 + 1_000);
const sixteenMinutesAgo = new Date(now.getTime() - 16 * 60_000);

describe("deriveRileyStatus", () => {
  it("HALTED takes precedence over everything", () => {
    expect(
      deriveRileyStatus({
        halted: true,
        hasMetaConnection: true,
        hasActiveCampaign: true,
        pendingApprovals: 5,
        recentActivityAt: fifteenMinutesAgo,
        now,
      }),
    ).toBe("HALTED");
  });

  it("IDLE when no Meta Ads Connection (even if pending recs exist)", () => {
    // CONNECTION PRECEDENCE: this is the rule the slicing spec calls out.
    expect(
      deriveRileyStatus({
        halted: false,
        hasMetaConnection: false,
        hasActiveCampaign: false,
        pendingApprovals: 3,
        recentActivityAt: fifteenMinutesAgo,
        now,
      }),
    ).toBe("IDLE");
  });

  it("IDLE when Connection exists but no active campaigns", () => {
    expect(
      deriveRileyStatus({
        halted: false,
        hasMetaConnection: true,
        hasActiveCampaign: false,
        pendingApprovals: 0,
        recentActivityAt: null,
        now,
      }),
    ).toBe("IDLE");
  });

  it("WAITING when Connection + active campaign + pending recs", () => {
    expect(
      deriveRileyStatus({
        halted: false,
        hasMetaConnection: true,
        hasActiveCampaign: true,
        pendingApprovals: 2,
        recentActivityAt: fifteenMinutesAgo,
        now,
      }),
    ).toBe("WAITING");
  });

  it("WATCHING when Connection + active campaign + no pending + recent activity within 15min", () => {
    expect(
      deriveRileyStatus({
        halted: false,
        hasMetaConnection: true,
        hasActiveCampaign: true,
        pendingApprovals: 0,
        recentActivityAt: fifteenMinutesAgo,
        now,
      }),
    ).toBe("WATCHING");
  });

  it("IDLE when Connection + active campaign + no pending + activity older than 15min", () => {
    expect(
      deriveRileyStatus({
        halted: false,
        hasMetaConnection: true,
        hasActiveCampaign: true,
        pendingApprovals: 0,
        recentActivityAt: sixteenMinutesAgo,
        now,
      }),
    ).toBe("IDLE");
  });

  it("IDLE when Connection + active campaign + no pending + no activity at all", () => {
    expect(
      deriveRileyStatus({
        halted: false,
        hasMetaConnection: true,
        hasActiveCampaign: true,
        pendingApprovals: 0,
        recentActivityAt: null,
        now,
      }),
    ).toBe("IDLE");
  });

  it("does not return REVIEWING in B.1 (deferred — no signal source)", () => {
    // Even if scoringRunActiveAt were passed in (it is not — see signature),
    // B.1 does not derive REVIEWING. This test guards against accidental
    // re-introduction.
    const result = deriveRileyStatus({
      halted: false,
      hasMetaConnection: true,
      hasActiveCampaign: true,
      pendingApprovals: 0,
      recentActivityAt: fifteenMinutesAgo,
      now,
    });
    expect(result).not.toBe("REVIEWING");
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- src/lib/cockpit/riley/__tests__/riley-status-deriver.test.ts
```

- [ ] **Step 3: Implement**

```ts
// apps/dashboard/src/lib/cockpit/riley/riley-status-deriver.ts
import type { CockpitStatus } from "@/components/cockpit/types.js";

const WATCHING_WINDOW_MS = 15 * 60 * 1000;

export interface RileyStatusInput {
  halted: boolean;
  hasMetaConnection: boolean;
  hasActiveCampaign: boolean;
  pendingApprovals: number;
  recentActivityAt: Date | null;
  now: Date;
}

/**
 * Riley status derivation for B.1.
 *
 * Order (precedence top-to-bottom):
 *   1. HALTED — operator halt is active
 *   2. IDLE   — no Meta Ads Connection (takes precedence over pending recs)
 *   3. IDLE   — Connection exists but no active campaign
 *   4. WAITING — pending recommendations on a connected, active account
 *   5. WATCHING — connected, active, no pending recs, recent activity (<15min)
 *   6. IDLE   — fallback
 *
 * REVIEWING is deferred in B.1 (no signal source today — verified by
 * `rg "scoring_run_in_progress" packages/ apps/` returning empty).
 */
export function deriveRileyStatus(input: RileyStatusInput): CockpitStatus {
  if (input.halted) return "HALTED";
  if (!input.hasMetaConnection) return "IDLE";
  if (!input.hasActiveCampaign) return "IDLE";
  if (input.pendingApprovals > 0) return "WAITING";
  if (input.recentActivityAt) {
    const ageMs = input.now.getTime() - input.recentActivityAt.getTime();
    if (ageMs < WATCHING_WINDOW_MS) return "WATCHING";
  }
  return "IDLE";
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/lib/cockpit/riley/__tests__/riley-status-deriver.test.ts
```

- [ ] **Step 5: Stage and commit boundary 2**

```bash
git add apps/dashboard/src/lib/cockpit/riley/riley-status-deriver.ts apps/dashboard/src/lib/cockpit/riley/__tests__/riley-status-deriver.test.ts
git commit -m "$(cat <<'EOF'
feat(riley-cockpit): adapters — approval views, signal-health grouping, activity, cold state, status (B.1)

Five pure-function adapter files under lib/cockpit/riley/:

- recommendation-to-approval-view.ts: maps each of 10 single-row
  Riley actions to a RileyApprovalView; orchestrator partitions
  signal:* rows, dispatches grouping, sorts by urgency + dollarsAtRisk
- signal-health-grouper.ts: collapses signal:*-prefixed rows for a
  pixel into one campaign.kind === "account" view-model; primary
  action is external (Open Events Manager); NO "Dismiss all" button
  (no hidden bulk-mutation path in B.1)
- riley-activity-translator.ts: TranslatedAction[] → ActivityRow[]
  with 9 Riley kinds; absorbs three-vocabulary intent drift
  (recommendation.pause / .pause_adset / .ad_set_pause); unknown
  intents fall back gracefully to "watching"
- cold-state-activity-rows.ts: 3 synthetic onboarding rows when no
  Meta Ads Connection
- riley-status-deriver.ts: HALTED → IDLE → WAITING → WATCHING; the
  connection-absence-precedence rule from the slicing spec means
  orphaned pending recs (no connection) stay IDLE; REVIEWING
  deferred (no signal source today)

All adapters extract Riley-specific fields from
parameters.__recommendation (campaignId, learningPhaseImpact,
reversible, action, urgency), not from top-level columns. Schema
audit confirmed this is the actual storage shape.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Boundary 3: Cockpit hooks

### Task 10: `use-riley-approvals.ts`

**Files:**
- Create: `apps/dashboard/src/hooks/use-riley-approvals.ts`
- Test: `apps/dashboard/src/hooks/__tests__/use-riley-approvals.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/dashboard/src/hooks/__tests__/use-riley-approvals.test.tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useRileyApprovals } from "../use-riley-approvals.js";
import {
  pauseFixture,
  scaleFixture,
  signalHealthFixtures,
} from "@/lib/cockpit/riley/__fixtures__/riley-recommendation-fixtures.js";

vi.mock("../use-recommendations.js", () => ({
  useRecommendations: () => ({
    data: { recommendations: [pauseFixture, scaleFixture, ...signalHealthFixtures] },
    isLoading: false,
    isError: false,
  }),
}));

function wrap({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useRileyApprovals", () => {
  it("returns view-models, not raw Recommendation rows", () => {
    const { result } = renderHook(() => useRileyApprovals(), { wrapper: wrap });
    expect(result.current.approvals).toBeDefined();
    expect(Array.isArray(result.current.approvals)).toBe(true);
    // View-models have `kind` and `urgency`; raw rows have `intent` and `humanSummary`.
    // The view-models must NOT carry `humanSummary` (quote is the only translation).
    for (const v of result.current.approvals) {
      expect("kind" in v).toBe(true);
      expect("urgency" in v).toBe(true);
      expect("humanSummary" in v).toBe(false);
    }
  });

  it("collapses 3 signal-health rows + 2 single-action recs into 3 cards", () => {
    const { result } = renderHook(() => useRileyApprovals(), { wrapper: wrap });
    // 2 single-action (pause + scale) + 1 grouped signal-health card = 3
    expect(result.current.approvals).toHaveLength(3);
  });

  it("isLoading / isError are exposed", () => {
    const { result } = renderHook(() => useRileyApprovals(), { wrapper: wrap });
    expect(typeof result.current.isLoading).toBe("boolean");
    expect(typeof result.current.isError).toBe("boolean");
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- src/hooks/__tests__/use-riley-approvals.test.tsx
```

- [ ] **Step 3: Implement**

```ts
// apps/dashboard/src/hooks/use-riley-approvals.ts
//
// Cockpit hook — composes useRecommendations + the Riley adapter.
// Returns view-models only. No Recommendation / AuditEntry types leak through.
//
// Per the Wave A slicing spec: this file MUST NOT import @switchboard/db,
// @prisma, or @switchboard/schemas/recommendations. ESLint enforces.

import { useMemo } from "react";
import { useRecommendations } from "./use-recommendations.js";
import { mapRecommendationsToApprovalViews } from "@/lib/cockpit/riley/recommendation-to-approval-view.js";
import type { RileyApprovalView } from "@/components/cockpit/types.js";

export function useRileyApprovals(): {
  approvals: RileyApprovalView[];
  isLoading: boolean;
  isError: boolean;
} {
  const query = useRecommendations();
  const approvals = useMemo(() => {
    const rows = query.data?.recommendations ?? [];
    // Filter to Riley-attributable rows. We use agentKey === "riley" since
    // the existing hook already returns mixed-agent data.
    const rileyRows = rows.filter((r) => r.agentKey === "riley");
    return mapRecommendationsToApprovalViews(rileyRows);
  }, [query.data]);

  return {
    approvals,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/hooks/__tests__/use-riley-approvals.test.tsx
```

- [ ] **Step 5: Stage**

```bash
git add apps/dashboard/src/hooks/use-riley-approvals.ts apps/dashboard/src/hooks/__tests__/use-riley-approvals.test.tsx
```

---

### Task 11: `use-riley-status.ts`

**Files:**
- Create: `apps/dashboard/src/hooks/use-riley-status.ts`
- Test: `apps/dashboard/src/hooks/__tests__/use-riley-status.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/dashboard/src/hooks/__tests__/use-riley-status.test.tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useRileyStatus } from "../use-riley-status.js";
import { pauseFixture } from "@/lib/cockpit/riley/__fixtures__/riley-recommendation-fixtures.js";

const haltState = { halted: false };
vi.mock("@/components/layout/halt/halt-context.js", () => ({
  useHalt: () => ({ halted: haltState.halted, setHalted: () => {}, toggleHalt: () => {} }),
}));

const connectionsState = { rows: [{ serviceId: "meta-ads", status: "connected" }] as unknown[] };
vi.mock("../use-connections.js", () => ({
  useConnections: () => ({
    data: { connections: connectionsState.rows },
    isLoading: false,
    isError: false,
  }),
}));

const recsState = { rows: [pauseFixture] as unknown[] };
vi.mock("../use-recommendations.js", () => ({
  useRecommendations: () => ({
    data: { recommendations: recsState.rows },
    isLoading: false,
    isError: false,
  }),
}));

const activityState = { lastAt: new Date("2026-05-14T11:59:00.000Z") };
vi.mock("../use-agent-activity.js", () => ({
  useAgentActivity: () => ({
    data: { actions: [{ occurredAt: activityState.lastAt.toISOString() }] },
    isLoading: false,
    isError: false,
  }),
}));

function wrap({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useRileyStatus", () => {
  it("HALTED when useHalt().halted is true", () => {
    haltState.halted = true;
    const { result } = renderHook(() => useRileyStatus(), { wrapper: wrap });
    expect(result.current).toBe("HALTED");
    haltState.halted = false;
  });

  it("IDLE when no Meta Ads Connection (even with pending recs)", () => {
    connectionsState.rows = [];
    const { result } = renderHook(() => useRileyStatus(), { wrapper: wrap });
    expect(result.current).toBe("IDLE");
    connectionsState.rows = [{ serviceId: "meta-ads", status: "connected" }];
  });

  it("WAITING with Connection + pending recs", () => {
    const { result } = renderHook(() => useRileyStatus(), { wrapper: wrap });
    expect(result.current).toBe("WAITING");
  });

  it("WATCHING when Connection + no pending recs + recent activity", () => {
    recsState.rows = [];
    const { result } = renderHook(() => useRileyStatus(), { wrapper: wrap });
    expect(result.current).toBe("WATCHING");
    recsState.rows = [pauseFixture];
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- src/hooks/__tests__/use-riley-status.test.tsx
```

- [ ] **Step 3: Implement**

```ts
// apps/dashboard/src/hooks/use-riley-status.ts
//
// Composes halt + connection + recommendations + activity into a CockpitStatus.
// View-model output only. ESLint enforces the boundary.
//
// `useNow(60_000)` ticks at 1-minute resolution so the WATCHING → IDLE
// transition fires when the 15-minute activity window expires, even if
// no other prop changes. `now` is in the memo deps to force recompute.

import { useMemo } from "react";
import { useHalt } from "@/components/layout/halt/halt-context.js";
import { useConnections } from "./use-connections.js";
import { useRecommendations } from "./use-recommendations.js";
import { useAgentActivity } from "./use-agent-activity.js";
import { useNow } from "@/app/(auth)/(mercury)/approvals/hooks/use-now.js";
import { deriveRileyStatus } from "@/lib/cockpit/riley/riley-status-deriver.js";
import type { CockpitStatus } from "@/components/cockpit/types.js";

export function useRileyStatus(): CockpitStatus {
  const { halted } = useHalt();
  const connectionsQuery = useConnections();
  const recsQuery = useRecommendations();
  const activityQuery = useAgentActivity(1);
  const now = useNow(60_000);

  return useMemo(() => {
    const hasMetaConnection = (connectionsQuery.data?.connections ?? []).some(
      (c) => c.serviceId === "meta-ads",
    );
    // B.1 treats "has any Meta connection" as "has active campaign" because
    // we don't have campaign-level data without B.2's metrics extension.
    // This is intentional under-derivation, not a bug; it means WATCHING vs
    // IDLE distinction is coarser in B.1 than in the target spec.
    const hasActiveCampaign = hasMetaConnection;

    const pendingRileyRecs = (recsQuery.data?.recommendations ?? []).filter(
      (r) => r.agentKey === "riley" && r.status === "pending",
    ).length;

    const actions = activityQuery.data?.actions ?? [];
    const rileyActions = actions.filter((a) => a.agentKey === "riley");
    const mostRecent = rileyActions
      .map((a) => new Date(a.occurredAt).getTime())
      .reduce((a, b) => Math.max(a, b), 0);

    return deriveRileyStatus({
      halted,
      hasMetaConnection,
      hasActiveCampaign,
      pendingApprovals: pendingRileyRecs,
      recentActivityAt: mostRecent > 0 ? new Date(mostRecent) : null,
      now,
    });
  }, [
    halted,
    connectionsQuery.data,
    recsQuery.data,
    activityQuery.data,
    now,
  ]);
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/hooks/__tests__/use-riley-status.test.tsx
```

- [ ] **Step 5: Stage**

```bash
git add apps/dashboard/src/hooks/use-riley-status.ts apps/dashboard/src/hooks/__tests__/use-riley-status.test.tsx
```

---

### Task 12: Add `useRileyActivity` named export to `use-agent-activity.ts`

**Files:**
- Modify: `apps/dashboard/src/hooks/use-agent-activity.ts` — **append a new named export. The existing `useAgentActivity()` function is NOT changed (signature, return shape, internals all preserved).** Alex and legacy consumers continue to use it unchanged.
- Test: add `apps/dashboard/src/hooks/__tests__/use-riley-activity.test.tsx` (new file).

The existing `useAgentActivity()` returns `{ roster, states, actions: TranslatedAction[] }` — raw rows. The Riley cockpit needs `ActivityRow[]` with cold-state fallback. We add a sibling `useRileyActivity()` export that:

1. Calls the existing `useAgentActivity(1)` for raw actions.
2. Calls `useConnections()` to check for a Meta Ads connection.
3. If no connection: returns 3 synthetic cold-state rows.
4. Otherwise: filters to Riley actions and runs them through `translateRileyActivity()`.

**Append (do not replace):**

```ts
// At the bottom of apps/dashboard/src/hooks/use-agent-activity.ts (NEW EXPORT, not replacement)

import { translateRileyActivity } from "@/lib/cockpit/riley/riley-activity-translator.js";
import { coldStateActivityRows } from "@/lib/cockpit/riley/cold-state-activity-rows.js";
import { useConnections } from "./use-connections.js";
import type { ActivityRow } from "@/components/cockpit/types.js";

export function useRileyActivity(): { rows: ActivityRow[]; isLoading: boolean; isError: boolean } {
  const base = useAgentActivity(1);
  const connectionsQuery = useConnections();

  const hasMetaConnection = (connectionsQuery.data?.connections ?? []).some(
    (c) => c.serviceId === "meta-ads",
  );

  if (!hasMetaConnection) {
    return { rows: coldStateActivityRows(), isLoading: false, isError: false };
  }

  const rileyActions = (base.data?.actions ?? []).filter((a) => a.agentKey === "riley");
  return {
    rows: translateRileyActivity(rileyActions),
    isLoading: base.isLoading || connectionsQuery.isLoading,
    isError: base.isError || connectionsQuery.isError,
  };
}
```

- [ ] **Step 1: Read the existing hook**

```bash
cat apps/dashboard/src/hooks/use-agent-activity.ts
```

Confirm the shape of `TranslatedAction` and the existing return type.

- [ ] **Step 2: Write failing test**

```tsx
// apps/dashboard/src/hooks/__tests__/use-riley-activity.test.tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useRileyActivity } from "../use-agent-activity.js";
import { pausedFixture, watchingFixture } from "@/lib/cockpit/riley/__fixtures__/riley-activity-fixtures.js";

const connState = { rows: [{ serviceId: "meta-ads", status: "connected" }] as unknown[] };
vi.mock("../use-connections.js", () => ({
  useConnections: () => ({
    data: { connections: connState.rows },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("@tanstack/react-query", async (orig) => {
  const actual = await orig<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: () => ({
      data: { actions: [pausedFixture, watchingFixture], roster: [], states: [] },
      isLoading: false,
      isError: false,
    }),
  };
});

function wrap({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useRileyActivity", () => {
  it("returns ActivityRow[] when Meta Ads is connected", () => {
    const { result } = renderHook(() => useRileyActivity(), { wrapper: wrap });
    expect(result.current.rows.length).toBeGreaterThanOrEqual(2);
    for (const r of result.current.rows) {
      expect("kind" in r).toBe(true);
      expect("head" in r).toBe(true);
    }
  });

  it("returns 3 cold-state synthetic rows when no Meta connection", () => {
    connState.rows = [];
    const { result } = renderHook(() => useRileyActivity(), { wrapper: wrap });
    expect(result.current.rows).toHaveLength(3);
    expect(result.current.rows[0].head).toMatch(/Connect Meta Ads/i);
    connState.rows = [{ serviceId: "meta-ads", status: "connected" }];
  });
});
```

- [ ] **Step 3: Run test, expect FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- src/hooks/__tests__/use-riley-activity.test.tsx
```

- [ ] **Step 4: Add the `useRileyActivity` export to `use-agent-activity.ts`**

Append the implementation above to the bottom of the existing file. Do not modify any existing exports.

- [ ] **Step 5: Run test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/hooks/__tests__/use-riley-activity.test.tsx
```

- [ ] **Step 6: Stage and commit boundary 3**

```bash
git add apps/dashboard/src/hooks/use-agent-activity.ts apps/dashboard/src/hooks/__tests__/use-riley-activity.test.tsx
git commit -m "$(cat <<'EOF'
feat(riley-cockpit): hooks — useRileyApprovals, useRileyStatus, useRileyActivity (B.1)

Three cockpit hooks compose existing dashboard hooks (useRecommendations,
useHalt, useConnections, useAgentActivity) with the Riley adapter layer
and return view-models only.

- useRileyApprovals: useRecommendations + mapRecommendationsToApprovalViews
  → RileyApprovalView[]. Filters to agentKey === "riley". Signal-health
  rows collapse to one card per pixel.
- useRileyStatus: useHalt + useConnections + useRecommendations +
  useAgentActivity → CockpitStatus. Encodes the connection-precedence
  rule (no Meta connection → IDLE regardless of pending rec rows).
- useRileyActivity: appended to use-agent-activity.ts as a new export.
  Returns cold-state synthetic rows when no Meta connection; otherwise
  filters to Riley actions and translates via translateRileyActivity.

None of these hooks import @switchboard/db, @prisma, or recommendation
schemas. Per the slicing spec's adapter contract: only files under
lib/cockpit/riley/ are allowed to touch the substrate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Boundary 4: ESLint boundary + cross-agent contract test

### Task 13: ESLint `no-restricted-imports` patch

**Files:**
- Modify: `.eslintrc.json` (root)

- [ ] **Step 1: Read the current root `.eslintrc.json`**

```bash
cat .eslintrc.json | head -100
```

Find the `"overrides"` array. The new Riley cockpit boundary override block is appended.

- [ ] **Step 2: Add the override block**

Append to the `"overrides"` array in `.eslintrc.json`:

```json
{
  "files": [
    "apps/dashboard/src/components/cockpit/**/*.ts",
    "apps/dashboard/src/components/cockpit/**/*.tsx",
    "apps/dashboard/src/hooks/use-riley-*.ts",
    "apps/dashboard/src/app/(auth)/alex/**/*.ts",
    "apps/dashboard/src/app/(auth)/alex/**/*.tsx",
    "apps/dashboard/src/app/(auth)/riley/**/*.ts",
    "apps/dashboard/src/app/(auth)/riley/**/*.tsx"
  ],
  "excludedFiles": [
    "**/__tests__/**",
    "**/__fixtures__/**",
    "**/*.test.ts",
    "**/*.test.tsx"
  ],
  "rules": {
    "no-restricted-imports": [
      "error",
      {
        "patterns": [
          {
            "group": ["@switchboard/db", "@switchboard/db/*", "@prisma/*"],
            "message": "Cockpit UI/hooks may not import db or Prisma types. Use view-models from @/components/cockpit/types or adapter outputs from @/lib/cockpit/riley."
          },
          {
            "group": [
              "@switchboard/schemas/recommendations",
              "@switchboard/schemas/recommendations/*",
              "@switchboard/schemas/audit",
              "@switchboard/schemas/audit/*"
            ],
            "message": "Cockpit UI/hooks may not import Recommendation or AuditEntry schemas directly. Use ApprovalView / ActivityRow view-models."
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 3: Verify lint runs clean**

```bash
pnpm lint
```

Expected: no new errors from the override. If anything in the cockpit dirs accidentally imports a restricted module, this command will surface it — fix before continuing.

- [ ] **Step 4: Negative test — write a temp file that violates the rule, verify lint catches it**

```bash
cat > apps/dashboard/src/components/cockpit/__temp_lint_check.ts <<'EOF'
import type { Recommendation } from "@switchboard/db/types";
export const x: Recommendation | null = null;
EOF
pnpm lint apps/dashboard/src/components/cockpit/__temp_lint_check.ts
```

Expected: lint error containing "Cockpit UI/hooks may not import db or Prisma types". Then clean up:

```bash
rm apps/dashboard/src/components/cockpit/__temp_lint_check.ts
```

- [ ] **Step 5: Stage**

```bash
git add .eslintrc.json
```

---

### Task 14: Cross-agent contract test extension

**Files:**
- Modify: `apps/dashboard/src/components/cockpit/__tests__/approval-card.test.tsx`

Alex A.1 ships a fixture-based render test that asserts the shared `<ApprovalCard>` component renders correctly for Alex shapes. Per Alex A.1's slice brief §Risks (mitigation 1): "Build a fixture-based render test in `approval-card.test.tsx` that round-trips a Riley-shaped `ApprovalView` so the shell is exercised by both shapes at A.1 merge time."

Riley B.1 extends this test to cover **all 11 Riley action variants** + the grouped account-level card.

- [ ] **Step 1: Read the existing test file (shipped by Alex A.1)**

```bash
cat apps/dashboard/src/components/cockpit/__tests__/approval-card.test.tsx
```

Confirm: the existing test imports `<ApprovalCard>` from `../approval-card.js` and renders it with Alex-shaped fixtures.

- [ ] **Step 2: Add Riley fixture import and per-variant render assertions**

Append to the existing test file:

```tsx
// --- B.1 Riley cross-agent contract extension ---

import { mapRecommendationsToApprovalViews } from "@/lib/cockpit/riley/recommendation-to-approval-view.js";
import {
  pauseFixture,
  scaleFixture,
  refreshCreativeFixture,
  restructureFixture,
  shiftBudgetFixture,
  switchEventFixture,
  hardenCapiFixture,
  holdFixture,
  addCreativeFixture,
  reviewBudgetFixture,
  signalHealthFixtures,
} from "@/lib/cockpit/riley/__fixtures__/riley-recommendation-fixtures.js";
import type { RileyApprovalView } from "../types.js";

const RILEY_SINGLES = [
  { name: "pause",                     fixture: pauseFixture },
  { name: "scale",                     fixture: scaleFixture },
  { name: "refresh_creative",          fixture: refreshCreativeFixture },
  { name: "restructure",               fixture: restructureFixture },
  { name: "shift_budget_to_source",    fixture: shiftBudgetFixture },
  { name: "switch_optimization_event", fixture: switchEventFixture },
  { name: "harden_capi_attribution",   fixture: hardenCapiFixture },
  { name: "hold",                      fixture: holdFixture },
  { name: "add_creative",              fixture: addCreativeFixture },
  { name: "review_budget",             fixture: reviewBudgetFixture },
];

describe("ApprovalCard — Riley shape (B.1 cross-agent contract)", () => {
  it.each(RILEY_SINGLES)("renders Riley variant: $name", ({ fixture }) => {
    const [view] = mapRecommendationsToApprovalViews([fixture]);
    const onResolve = vi.fn();
    render(<ApprovalCard data={view as RileyApprovalView} idx={0} total={1} onResolve={onResolve} />);
    expect(screen.getByText(view.primary)).toBeInTheDocument();
    expect(screen.getByText(view.quote)).toBeInTheDocument();
  });

  it("renders the grouped signal_health_group card (account-level)", () => {
    const views = mapRecommendationsToApprovalViews(signalHealthFixtures);
    expect(views).toHaveLength(1);
    const onResolve = vi.fn();
    render(<ApprovalCard data={views[0] as RileyApprovalView} idx={0} total={1} onResolve={onResolve} />);
    expect(screen.getByText("Open Events Manager")).toBeInTheDocument();
    // No "Dismiss all" button in B.1
    expect(screen.queryByText(/dismiss all/i)).not.toBeInTheDocument();
  });

  it("Riley external-action variants render external CTAs (review_budget, harden_capi_attribution)", () => {
    const externalVariants = [reviewBudgetFixture, hardenCapiFixture];
    for (const f of externalVariants) {
      const [view] = mapRecommendationsToApprovalViews([f]);
      expect(view.primaryAction.kind).toBe("external");
    }
  });
});
```

- [ ] **Step 3: Run the test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/approval-card.test.tsx
```

Expected: original Alex tests still pass + 12 new Riley tests pass.

- [ ] **Step 4: Stage**

```bash
git add apps/dashboard/src/components/cockpit/__tests__/approval-card.test.tsx
```

---

### Task 15: Pre-merge grep smoke check (procedural — no code)

This task is a gate, not an implementation. It verifies the boundary held across boundaries 1–4.

- [ ] **Step 1: Run the smoke check**

```bash
rg "Recommendation|AuditEntry|@switchboard/db|@prisma" \
   apps/dashboard/src/components/cockpit \
   apps/dashboard/src/hooks
```

**Expected output:**

- **Zero matches in `apps/dashboard/src/components/cockpit/**`** (any `.ts` or `.tsx` file). Test files under `__tests__/` may match if they reference Riley fixture *imports* by path — review case-by-case. Test files referencing `RecommendationApiRow` only as a *type* via the fixture file are acceptable, but no direct imports of `@switchboard/db` / `@prisma` / `@switchboard/schemas/recommendations` are permitted.
- **No direct db/schema/Prisma imports in `apps/dashboard/src/hooks/use-riley-*.ts`**. Matches in those files containing the word "Recommendation" only in JSDoc comments or type annotations referencing adapter outputs are acceptable.
- **Adapter imports are verified separately by reviewing `apps/dashboard/src/lib/cockpit/riley/**`.** All `Recommendation` / `AuditEntry` / Prisma imports must live there (and only there).

- [ ] **Step 2: If any unexpected match is found, fix before commit**

If a UI component or `use-riley-*` hook imports a restricted type, the boundary leaked. The fix is to move the import to an adapter file and pass the view-model down instead. Re-run the smoke check until clean.

- [ ] **Step 3: Commit boundary 4**

```bash
git commit -m "$(cat <<'EOF'
feat(riley-cockpit): ESLint boundary + cross-agent contract test (B.1)

Two pieces lock the adapter discipline that makes the Wave B substrate
swap a layer-3 change rather than a UI rewrite:

- .eslintrc.json: new no-restricted-imports override scoped to
  components/cockpit/**, hooks/use-riley-*.ts, and
  app/(auth)/{alex,riley}/**. Bans imports from @switchboard/db,
  @prisma, and schemas/recommendations|audit. Test and fixture files
  exempt. Adapter files under lib/cockpit/riley/** are exempt.
- approval-card.test.tsx: extends Alex A.1's fixture-based contract
  test with all 11 Riley action variants (10 single-row + 1 grouped
  signal_health_group). Verifies the shared shell component renders
  Riley shapes correctly. Also asserts the grouped card has no
  "Dismiss all" affordance (no hidden bulk-mutation path in B.1).

Pre-merge grep smoke check (boundary verification) returns clean:
zero Recommendation/AuditEntry/db/Prisma imports in cockpit
components or use-riley-* hooks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Boundary 5: Page wiring + integration

### Task 16: Create `RileyCockpitPage` and swap `/riley/page.tsx` to use it

**Architectural decision** (locked, surfaced by codebase audit on post-#468 / post-A.1 main):

Alex A.1 shipped `cockpit-page.tsx` as a **hardcoded Alex composition** (imports `ALEX_CONFIG`, calls `useAgentGreeting("alex")`, filters `agentRole === "alex"`, uses `useCockpitStatusAlex`). It is not parameterized. Two ways forward for B.1:

- **Option A — Parameterize `CockpitPage`** to accept `agentKey?: AgentKey` and switch config + hooks internally. Modifies A.1's shipped file. Higher risk of regression for Alex; more reviewer scrutiny on a shared shell file.
- **Option B (locked) — Create a parallel `RileyCockpitPage`** that composes the same shell primitives (`Topbar`, `Identity`, `ApprovalBlock`, `ActivityStream`, `ComposerPlaceholder`, `T`) with Riley's hooks/config/adapters. A.1's `cockpit-page.tsx` is not touched. Symmetric structure: two compositions, both consuming the same primitives, each owns its agent's wiring.

Option B is chosen because: (a) it preserves A.1's shipped composition untouched, (b) it aligns with the adapter discipline (Riley's composition uses Riley's hooks), (c) the file count grows by one `.tsx` (under the 400-line warn / 600-line error budget per memory), and (d) future Mira composition would follow the same symmetric pattern.

**Files:**
- Create: `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx`
- Modify: `apps/dashboard/src/app/(auth)/riley/page.tsx`

- [ ] **Step 1: Read A.1's `cockpit-page.tsx` as the structural reference**

```bash
cat apps/dashboard/src/components/cockpit/cockpit-page.tsx
```

The Riley composition follows the same shape: hook calls, view-model mapping, status derivation, rendering Topbar + Identity + ApprovalBlock + ActivityStream + ComposerPlaceholder. The differences are: which hooks (Riley's), which config (Riley's), which adapters (already wrapped inside the Riley hooks). The render JSX is structurally identical.

- [ ] **Step 2: Write failing test for `RileyCockpitPage`**

```tsx
// apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { RileyCockpitPage } from "../riley-cockpit-page.js";

const haltState = { halted: false };
vi.mock("@/components/layout/halt/halt-context", () => ({
  useHalt: () => ({ halted: haltState.halted, setHalted: vi.fn(), toggleHalt: vi.fn() }),
  HaltProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const rileyApprovalsState = { approvals: [] as unknown[] };
vi.mock("@/hooks/use-riley-approvals", () => ({
  useRileyApprovals: () => ({
    approvals: rileyApprovalsState.approvals,
    isLoading: false,
    isError: false,
  }),
}));

const rileyStatusState = { status: "IDLE" };
vi.mock("@/hooks/use-riley-status", () => ({
  useRileyStatus: () => rileyStatusState.status,
}));

const rileyActivityState = { rows: [] as unknown[] };
vi.mock("@/hooks/use-agent-activity", async (orig) => {
  const actual = await orig<typeof import("@/hooks/use-agent-activity.js")>();
  return {
    ...actual,
    useRileyActivity: () => ({ rows: rileyActivityState.rows, isLoading: false, isError: false }),
  };
});

function wrap(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe("RileyCockpitPage", () => {
  it("renders Topbar with Riley tab active", () => {
    wrap(<RileyCockpitPage />);
    const tabs = screen.getAllByText("Riley");
    expect(tabs.length).toBeGreaterThanOrEqual(1);
  });

  it("renders IDLE status pill in cold state", () => {
    wrap(<RileyCockpitPage />);
    expect(screen.getByText(/IDLE/i)).toBeInTheDocument();
  });

  it("renders HALTED state when halt is active", () => {
    haltState.halted = true;
    rileyStatusState.status = "HALTED";
    wrap(<RileyCockpitPage />);
    expect(screen.getByText(/HALTED/i)).toBeInTheDocument();
    haltState.halted = false;
    rileyStatusState.status = "IDLE";
  });
});
```

- [ ] **Step 3: Run test, expect FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/riley-cockpit-page.test.tsx
```

Expected: module not found.

- [ ] **Step 4: Implement `RileyCockpitPage`**

```tsx
// apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx
"use client";

import { useState } from "react";
import { T } from "./tokens.js";
import { Topbar } from "./topbar.js";
import { Identity } from "./identity.js";
import { ApprovalBlock } from "./approval-block.js";
import { ActivityStream, type ActivityFilter } from "./activity-stream.js";
import { ComposerPlaceholder } from "./composer-placeholder.js";
import {
  RILEY_ACCENT,
  RILEY_TABS,
  RILEY_MISSION_SUBTITLE,
  statusColor,
  statusPulse,
} from "@/lib/cockpit/riley/riley-config.js";
import { RILEY_KIND_META } from "@/lib/cockpit/riley/kind-meta-riley.js";
import { useRileyApprovals } from "@/hooks/use-riley-approvals.js";
import { useRileyStatus } from "@/hooks/use-riley-status.js";
import { useRileyActivity } from "@/hooks/use-agent-activity.js";
import { useHalt } from "@/components/layout/halt/halt-context.js";

export function RileyCockpitPage() {
  const haltCtx = useHalt();
  const { approvals } = useRileyApprovals();
  const statusKey = useRileyStatus();
  const { rows: activityRows } = useRileyActivity();
  const [filter, setFilter] = useState<ActivityFilter>("all");

  return (
    <div style={{ background: T.bg, color: T.ink, minHeight: "100vh" }}>
      <Topbar tabs={RILEY_TABS} paletteEnabled={false} compact />
      <Identity
        statusKey={statusKey}
        halted={haltCtx.halted}
        subtitle={RILEY_MISSION_SUBTITLE}
        accent={RILEY_ACCENT}
        statusColor={statusColor(statusKey)}
        statusPulse={statusPulse(statusKey)}
        onHaltToggle={haltCtx.toggleHalt}
      />
      <ApprovalBlock data={approvals} compact />
      <ActivityStream
        data={activityRows}
        filter={filter}
        setFilter={setFilter}
        kindMeta={RILEY_KIND_META}
        compact
      />
      <ComposerPlaceholder
        text={
          haltCtx.halted
            ? "Riley is halted — resume to take operator commands."
            : "Tell Riley what to do — coming soon."
        }
      />
    </div>
  );
}
```

**Verify the prop names against the actual Alex `cockpit-page.tsx`** before locking — the Topbar / Identity / ApprovalBlock / ActivityStream / ComposerPlaceholder prop signatures are owned by Alex A.1. If A.1 passes props differently (e.g., `tabs` is read from config inside `Topbar` rather than passed as a prop, or `Identity` doesn't accept `accent`), adjust the implementation to match A.1's contract. The test verifies render output, not prop wire shape.

- [ ] **Step 5: Run test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/riley-cockpit-page.test.tsx
```

If the test fails because of prop mismatch against A.1's shell components, adjust `riley-cockpit-page.tsx` until it passes. Do not modify the shell components.

- [ ] **Step 6: Read and modify `/riley/page.tsx`**

```bash
cat apps/dashboard/src/app/\(auth\)/riley/page.tsx
```

Expected current contents (per post-#468 / post-A.1 main):

```tsx
import { notFound } from "next/navigation";
import { fetchEnabledAgentsServer } from "@/lib/api-client/agents-server";
import { EditorialAuthShell } from "@/components/layout/editorial-auth-shell";
import { AgentHomeShell } from "@/components/agent-home/agent-home-shell";

export default async function RileyPage() {
  const enabled = await fetchEnabledAgentsServer();
  if (!enabled.includes("riley")) notFound();

  return (
    <EditorialAuthShell>
      <AgentHomeShell agentKey="riley" />
    </EditorialAuthShell>
  );
}
```

Replace the `AgentHomeShell` import + usage with `RileyCockpitPage`:

```tsx
import { notFound } from "next/navigation";
import { fetchEnabledAgentsServer } from "@/lib/api-client/agents-server";
import { EditorialAuthShell } from "@/components/layout/editorial-auth-shell";
import { RileyCockpitPage } from "@/components/cockpit/riley-cockpit-page";

export default async function RileyPage() {
  const enabled = await fetchEnabledAgentsServer();
  if (!enabled.includes("riley")) notFound();

  return (
    <EditorialAuthShell>
      <RileyCockpitPage />
    </EditorialAuthShell>
  );
}
```

The route gate (`notFound()`) is preserved exactly.

- [ ] **Step 7: Update `/riley/__tests__/page.test.tsx`**

The existing test (created by #468 + #468's test file) asserts `AgentHomeShell` is rendered. Update it to assert `RileyCockpitPage` instead, mirroring how A.1's `/alex/__tests__/page.test.tsx` was updated to mock `CockpitPage`.

```tsx
// apps/dashboard/src/app/(auth)/riley/__tests__/page.test.tsx
import { afterEach, describe, expect, it, vi } from "vitest";

const { notFoundFn, fetchEnabledFn } = vi.hoisted(() => {
  const notFoundFn = vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  });
  const fetchEnabledFn = vi.fn(async () => ["alex", "riley"]);
  return { notFoundFn, fetchEnabledFn };
});

vi.mock("next/navigation", () => ({ notFound: notFoundFn }));
vi.mock("@/lib/api-client/agents-server", () => ({
  fetchEnabledAgentsServer: fetchEnabledFn,
}));
vi.mock("@/components/layout/editorial-auth-shell", () => ({
  EditorialAuthShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/cockpit/riley-cockpit-page", () => ({
  RileyCockpitPage: () => <div data-testid="riley-cockpit-page">riley-cockpit</div>,
}));

import RileyPage from "../page";

describe("RileyPage server gate", () => {
  afterEach(() => {
    notFoundFn.mockClear();
    fetchEnabledFn.mockReset();
    fetchEnabledFn.mockImplementation(async () => ["alex", "riley"]);
  });

  it("renders RileyCockpitPage when riley is enabled", async () => {
    const tree = await RileyPage();
    const { render, screen } = await import("@testing-library/react");
    render(tree);
    expect(screen.getByTestId("riley-cockpit-page")).toBeInTheDocument();
  });

  it("notFound() when riley is not enabled", async () => {
    fetchEnabledFn.mockImplementation(async () => ["alex"]);
    await expect(RileyPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
```

- [ ] **Step 8: Type-check + run both test files**

```bash
pnpm typecheck
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/riley-cockpit-page.test.tsx src/app/\(auth\)/riley/__tests__/page.test.tsx
```

Expected: clean typecheck + both test files green.

**Thin integration rule** (carried forward from the slicing spec). Page-layer files (`apps/dashboard/src/app/(auth)/{alex,riley}/page.tsx`, the cockpit composition files `cockpit-page.tsx` and `riley-cockpit-page.tsx`) may import:

- Config files (`alex-config.ts`, `riley-config.ts`) — values, not substrate
- Cockpit hooks (`useRileyApprovals`, `useRileyStatus`, `useRileyActivity`, `usePendingApprovals`, etc.) — return view-models
- Shell primitive components (`Topbar`, `Identity`, `ApprovalBlock`, `ActivityStream`, `ComposerPlaceholder`, `Dot`, `StatusPill`)
- View-model types from `components/cockpit/types.js`
- `RILEY_KIND_META` table from `lib/cockpit/riley/kind-meta-riley.js` (kind metadata, not substrate)

Page-layer + composition files MUST NOT import:

- `@switchboard/db` / `@prisma/**`
- `@switchboard/schemas/recommendations` / `@switchboard/schemas/audit`
- Anything from `lib/cockpit/riley/**` other than `riley-config.ts` and `kind-meta-riley.ts` (the data adapters stay behind the hook layer)

The ESLint rule from Task 13 enforces the first two bans. The third (no direct adapter imports from composition files) is enforced by review + the grep smoke check in Task 15.

- [ ] **Step 9: Stage**

```bash
git add apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx \
        apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx \
        apps/dashboard/src/app/\(auth\)/riley/page.tsx \
        apps/dashboard/src/app/\(auth\)/riley/__tests__/page.test.tsx
```

---

### Task 17: Page-level steady/cold integration sweep

Task 16's `RileyCockpitPage` component test (Step 2's `riley-cockpit-page.test.tsx`) covers IDLE / HALTED + Riley tab. Task 17 adds the **steady-state + cold-state + signal-health-grouped** end-to-end coverage at the component level. The route-level page test (`/riley/__tests__/page.test.tsx`) stays minimal — it only verifies the route gate and that the right composition is invoked. The component-level test in this task verifies the cockpit's behavior under real data shapes.

**Files:**
- Extend: `apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx` (the file created by Task 16)

- [ ] **Step 1: Add steady-state + cold-state + signal-health assertions to the existing test**

Append to the test file from Task 16:

```tsx
// --- B.1 Task 17: end-to-end coverage ---

import {
  pauseFixture,
  signalHealthFixtures,
} from "@/lib/cockpit/riley/__fixtures__/riley-recommendation-fixtures.js";
import { mapRecommendationsToApprovalViews } from "@/lib/cockpit/riley/recommendation-to-approval-view.js";
import { coldStateActivityRows } from "@/lib/cockpit/riley/cold-state-activity-rows.js";

describe("RileyCockpitPage — data-driven states", () => {
  it("cold state: no Meta connection → 3 synthetic onboarding rows surface", () => {
    rileyActivityState.rows = coldStateActivityRows();
    rileyStatusState.status = "IDLE";
    wrap(<RileyCockpitPage />);
    expect(screen.getByText(/Connect Meta Ads to begin/i)).toBeInTheDocument();
    expect(screen.getByText(/Set average lead value/i)).toBeInTheDocument();
    expect(screen.getByText(/Standing rules loaded/i)).toBeInTheDocument();
    rileyActivityState.rows = [];
  });

  it("steady state: 1 pending pause rec → WAITING pill + Pause card", () => {
    rileyApprovalsState.approvals = mapRecommendationsToApprovalViews([pauseFixture]);
    rileyStatusState.status = "WAITING";
    wrap(<RileyCockpitPage />);
    expect(screen.getByText(/WAITING/i)).toBeInTheDocument();
    expect(screen.getByText(/Pause adset/i)).toBeInTheDocument();
    expect(screen.getByText(pauseFixture.humanSummary)).toBeInTheDocument();
    rileyApprovalsState.approvals = [];
    rileyStatusState.status = "IDLE";
  });

  it("signal-health: 3 raw rows → 1 grouped account-level card; no 'Dismiss all' button", () => {
    rileyApprovalsState.approvals = mapRecommendationsToApprovalViews(signalHealthFixtures);
    rileyStatusState.status = "WAITING";
    wrap(<RileyCockpitPage />);
    expect(screen.getByText(/Open Events Manager/i)).toBeInTheDocument();
    expect(screen.queryByText(/Dismiss all/i)).not.toBeInTheDocument();
    rileyApprovalsState.approvals = [];
    rileyStatusState.status = "IDLE";
  });

  it("composer placeholder text changes when halted", () => {
    haltState.halted = true;
    rileyStatusState.status = "HALTED";
    wrap(<RileyCockpitPage />);
    expect(screen.getByText(/Riley is halted/i)).toBeInTheDocument();
    haltState.halted = false;
    rileyStatusState.status = "IDLE";
  });
});
```

- [ ] **Step 2: Run the extended test**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/riley-cockpit-page.test.tsx
```

Expected: all describe blocks (Task 16's three tests + Task 17's four tests) pass = 7 tests total.

- [ ] **Step 3: Adjust selectors if needed**

If the composer placeholder copy or any UI string doesn't match expectations, fix the `RileyCockpitPage` composition or the test selector — whichever is wrong. Status pill text, tab labels, halt button labels are owned by Alex A.1's shell — match them exactly. The Riley composer text is owned by `RileyCockpitPage` (Task 16, Step 4) — adjust the test or the component string for consistency.

- [ ] **Step 4: Stage and commit boundary 5 (the final B.1 commit)**

```bash
git add apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx
git commit -m "$(cat <<'EOF'
feat(riley-cockpit): /riley page wiring + integration tests (B.1)

- riley-cockpit-page.tsx: new Riley composition of the shell,
  parallel to Alex's cockpit-page.tsx. Imports the same primitives
  (Topbar, Identity, ApprovalBlock, ActivityStream,
  ComposerPlaceholder) and wires them with Riley config + Riley
  hooks (useRileyApprovals, useRileyStatus, useRileyActivity).
  Does not modify A.1's cockpit-page.tsx. Symmetric structure for
  future Mira composition.
- /riley/page.tsx: replaces <AgentHomeShell agentKey="riley" /> with
  <RileyCockpitPage />. Route gate (notFound() when Riley not
  enabled) preserved exactly. Matches the route-level branching
  pattern A.1 introduced for /alex.
- /riley/__tests__/page.test.tsx: mocks RileyCockpitPage and asserts
  the page renders it when Riley is enabled. Route-gate test
  preserved.
- riley-cockpit-page.test.tsx: 7 tests covering IDLE / HALTED /
  WAITING + Riley tab active, cold-state synthetic rows, signal-
  health grouped card with no "Dismiss all" button, halted composer
  copy.

B.1 ships zero backend changes. Adapter boundary holds: grep smoke
check returns clean. ESLint no-restricted-imports active. Cross-
agent contract test covers all 11 Riley variants + grouped signal-
health card. AgentHomeShell stays in the codebase for /mira/, which
continues to render legacy blocks.

Wave A boundary B.1 / B.2 / B.3 sequence per slicing spec
2026-05-14-riley-cockpit-wave-a-slicing-design.md. B.2 (mission +
KPI + ROI) waits for Alex A.2/A.3; B.3 (palette + composer + voice)
waits for Alex A.5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Verification before merge

Run all of these in order from the worktree root. Each must pass before pushing.

```bash
# 1. Type-check
pnpm typecheck
```
Expected: clean. No new errors.

```bash
# 2. Lint
pnpm lint
```
Expected: clean. No new errors. Verifies the new `no-restricted-imports` rule does not catch any of our own code.

```bash
# 3. Dashboard tests
pnpm --filter @switchboard/dashboard test
```
Expected: all suites green, including the new Riley adapter / hook / page tests, and the existing Alex tests (which must not regress).

```bash
# 4. Dashboard build (not in CI — per memory feedback)
pnpm --filter @switchboard/dashboard build
```
Expected: clean. Catches .js-extension regressions that lint/typecheck miss.

```bash
# 5. Pre-merge grep smoke check (THE BOUNDARY GATE)
rg "Recommendation|AuditEntry|@switchboard/db|@prisma" \
   apps/dashboard/src/components/cockpit \
   apps/dashboard/src/hooks
```

**Expected output:**
- **Zero matches in `apps/dashboard/src/components/cockpit/**`.**
- **No direct db/schema/Prisma imports in `apps/dashboard/src/hooks/use-riley-*.ts`.**
- **Adapter imports are verified separately by reviewing `apps/dashboard/src/lib/cockpit/riley/**`.**

If the grep returns matches outside those allowed locations, **the adapter boundary has leaked.** Fix before merge. This is the canonical Wave A invariant — if it holds, the Wave B substrate swap is a layer-3 change. If it doesn't, the cockpit is locked to the current `Recommendation + AuditEntry` substrate and Wave B becomes a rewrite.

```bash
# 6. Manual smoke (dev)
pnpm dev
# Navigate to http://localhost:3002/riley
```

Verify by hand:
- `/riley` route renders.
- With no Meta Ads `Connection` in the seed data: status pill `IDLE`, 3 synthetic activity rows visible, no approval block, composer placeholder visible.
- With a Meta Ads `Connection` + a seeded pending `Recommendation` for Riley: status pill `WAITING`, approval card renders with the rec's `humanSummary` as quote and `presentation.primaryLabel` as primary CTA.
- Halt button toggles `HaltProvider`; pill turns red and reads `HALTED`.
- `/alex` continues to render Alex's cockpit (no regression).
- `/mira` continues to render the legacy block-based home (no regression).

---

## Risks (carried from the slicing spec)

1. **Adapter boundary leak.** Mitigation: ESLint `no-restricted-imports` (load-bearing) + pre-merge grep + PR template checkbox. Boundary 4 ships the enforcement; boundary 5 verifies it holds end-to-end.
2. **Riley-shaped `ApprovalView` exposes a gap in Alex A.1's shell types.** Mitigation: types are already on main and carry the full Riley shape (verified by audit). Cross-agent contract test in Task 14 exercises all 11 variants — if a gap is found, the fix is in the shell, not in Riley adapters.
3. **Three-vocabulary intent drift.** Mitigation: translator absorbs all three; tests cover each form (Task 7).
4. **Signal-health rendering before grouping ships.** Mitigation: Task 5's orchestrator filters `signal:*` rows out of the single-row path before they reach single-row mapping; Task 6's grouper is exercised by Task 14's integration test.
5. **`WATCHING` window edge.** Mitigation: 15-minute window verified in Task 9's deriver tests at the minute boundary.
6. **Shell prop optionality (Alex A.2 props).** B.1 ships before A.2 (mission popover). The shell's `Identity` component's `onOpenMission` / `missionInteractive` props must remain optional. Verified against Alex A.1 slice brief; flagged if A.1 PR drifts.
7. **`useRileyActivity` mocking complexity in tests.** The hook composes 4 sources (halt, connections, recommendations, activity). Tests in Task 11 mock each at the hook layer. If the mocks drift from the real hook signatures, tests pass but production breaks. Mitigation: the manual smoke (verification step 6) catches integration drift.

---

## Out-of-scope reminders (do not slip)

If during implementation any of the following look tempting, **stop and defer to B.2 / B.3 / Wave B**:

- ❌ Mission popover or `onOpenMission` wiring → B.2
- ❌ KPI tile rendering or `tiles[]` shape → B.2
- ❌ ROI bar or ROAS math → B.2
- ❌ Any `/api/dashboard/agents/[agentId]/mission` route work → B.2
- ❌ Any `/api/dashboard/agents/[agentId]/metrics` extension → B.2
- ❌ `AgentRoster.avgValueCents` / `targetCpbCents` migration → B.2
- ❌ Command palette or composer behavior → B.3
- ❌ `RecommendationPresentation.acceptToast` / `declineToast` schema fields → B.3
- ❌ Riley `toastVoice` function or per-action toast copy → B.3
- ❌ `REVIEWING` status state derivation → deferred (no signal source today)
- ❌ "Dismiss all" button on signal-health grouped card → deferred (no hidden bulk-mutation path)
- ❌ Auto-dismiss on external-action link click → not introduced (preserves existing two-tap)
- ❌ Any new undo flow design → preserves existing `actOnRecommendation` undo path
- ❌ `WorkTrace` mirror or `PlatformIngress` route changes → Wave B
- ❌ `learning-phase-guard` refactor to `SkillHook` → Wave B
- ❌ Outcome attribution or learning memory work → Wave B
- ❌ Causal-language UI copy ("Riley saved you $X") → Wave B (B.2's honest-impact-language guardrail also enforces)

---

## What comes after B.1

- **Alex A.2 + A.3 merge** → unblocks Riley B.2 (mission popover + KPI strip + ROI bar). Plan authored separately when A.2/A.3 land.
- **Alex A.5 merge** → unblocks Riley B.3 (palette + composer + voice + final polish). Plan authored separately when A.5 lands.
- **Wave B brainstorm** → produces slicing for `WorkTrace mirror, PlatformIngress route, outcome attribution, learning memory, governance hook unification, unified approval lifecycle` per the parity spec `2026-05-14-riley-agent-infra-parity-design.md`. Independent of B.2 / B.3.
