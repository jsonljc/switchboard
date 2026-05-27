# Alex Cockpit A.1 — Shell + Basic Cockpit Composition

**Date:** 2026-05-14
**Parent spec:** [Alex Cockpit Home — Full Phase A Target Spec](../specs/2026-05-14-alex-cockpit-home-design.md) (§Implementation slices)
**Sibling spec:** [Riley Cockpit Home](../specs/2026-05-13-riley-cockpit-home-design.md)

---

## Slice goal

Ship the shared cockpit shell and the smallest Alex composition that renders a recognizable cockpit at `/alex`, **using only data sources that already exist**. No new API routes. No Prisma migrations. No schema changes. No metrics changes. No activity-endpoint changes. No command palette. No KPI/ROI. No mission popover. No narrator persistence. No old-component deletion. No Riley wiring.

A.1 proves the shell is the right shape and lets the rest of Phase A land without re-opening these components.

---

## What ships

### Shell components (new files under `apps/dashboard/src/components/cockpit/`)

| File                       | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----------------------------------------------------------------------------------------- |
| `tokens.ts`                | Page-local color tokens (`T = { bg, paper, ink, ink2..ink5, hair, hairSoft, amber*, green, red, blue }`). Not promoted to globals — see spec §Visual tokens.                                                                                                                                                                                                                                                                                                                                                                                                               |
| `kind-meta.ts`             | `KIND_META` table — **Alex kinds only** at A.1 (`booked / qualified / replied / sent / started / connected / waiting / escalated / passed`). Riley kinds added by Riley's PR.                                                                                                                                                                                                                                                                                                                                                                                              |
| `types.ts`                 | `CockpitStatus`, `ApprovalView` (union accommodating Riley's kinds even though A.1 doesn't exercise them), `ActivityRow` (A.1 subset — no `preview`/`body`/`replyable` semantics wired yet), `ThreadMessage` exported for later slices.                                                                                                                                                                                                                                                                                                                                    |
| `topbar.tsx`               | `<Topbar paletteEnabled={false} compact />` — renders `<Mark />`, "Switchboard" wordmark, tabs from `alex-config`, "Tell Alex…" affordance rendered **disabled** (`disabled` + `aria-disabled`; no click handler, no keyboard shortcut). The palette lands at A.5 when `paletteEnabled` flips to true.                                                                                                                                                                                                                                                                     |
| `identity.tsx`             | `<Identity statusKey halted subtitle line onHaltToggle compact />` — avatar frame, name, status pill, **subtitle is plain non-interactive text at A.1** (no `onEditMission`, no edit-pencil affordance). Optional `line` (greeting copy from existing `useAgentGreeting`). Halt button. A.2 extends with `onOpenMission?` + `missionInteractive?` to make the subtitle a popover trigger; A.1 does not include either prop.                                                                                                                                                |
| `status-pill.tsx`          | `<StatusPill statusKey halted />` — single dot + label, pulse driven by `alex-config.statusPulse`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `dot.tsx`                  | `<Dot color pulse size />` — primitive reused by status pill and channel dots later.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `approval-block.tsx`       | `<ApprovalBlock data onResolve variant compact />` — array-tolerant; renders `<ApprovalCard>` per item.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `approval-card.tsx`        | `<ApprovalCard data idx total onResolve variant compact />` — eyebrow + title + body + quote + risk + primary/secondary buttons.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `activity-stream.tsx`      | `<ActivityStream data filter setFilter openSet toggleOpen variant compact />` — today's filter set (`all` / `booked` / `escalations`); rows are collapsed-only at A.1 (no expand-to-preview).                                                                                                                                                                                                                                                                                                                                                                              |
| `activity-row.tsx`         | `<ActivityRow item open toggle variant compact />` — collapsed-only render at A.1; the expand state and `ThreadPreview` are wired but the body/preview rendering is gated behind a feature check (`row.body                                                                                                                                                                                                                                                                                                                                                                |     | row.preview`) which is always false at A.1. Lays groundwork for A.4 without rendering it. |
| `composer-placeholder.tsx` | Static placeholder bar at the bottom of the page reading `Tell Alex what to do — coming soon`. Inert. Replaced by the real composer at A.5.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `cockpit-page.tsx`         | Top-level composition: `<Topbar/><Identity/><ApprovalBlock/>?<ActivityStream/><composer-placeholder/>`. **No KPI/ROI DOM slot** — A.3 inserts `<KPIStrip>` between `<Identity>` and `<ApprovalBlock>` when it ships; A.1 simply doesn't render that region. A code comment marks the insertion point so A.3 isn't ambiguous. `HaltProvider` is NOT re-rooted at A.1 — the existing provider in `EditorialAuthShell` continues to wrap the page; `CockpitPage` consumes it via `useHalt()`. Re-rooting is deferred to A.6 when `EditorialAuthShell` is removed for `/alex`. |

### Helpers (new files under `apps/dashboard/src/lib/cockpit/`)

| File                                          | Responsibility                                                                                                                                                                                                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `alex-config.ts`                              | `ALEX_ACCENT`, `ALEX_MISSION_SUBTITLE` (static at A.1; popover at A.2), `statusColor`, `statusPulse`, `animState`, `tabs`. Ported from `alex-config.jsx` minus mission rows + commands + composer placeholder + toastVoice (those land later).            |
| `legacy-pending-approval-to-approval-view.ts` | Adapter: `(approval: PendingApproval) => ApprovalView`. Reads `usePendingApprovals()` (existing hook in `app/(auth)/(mercury)/approvals/hooks/use-approvals.ts`); maps `riskCategory`, `bindingHash`, `summary`, `createdAt` into the shell's view-model. |
| `activity-kind-map.ts`                        | Adapter: `(translatedAction: TranslatedAction) => ActivityRow`. Reads the existing `useAgentActivity` output and maps `eventType` → cockpit `ActivityKind`. No new translator events; no new event sources.                                               |
| `relative-age.ts` (or reuse)                  | Used by both adapters above. Verify the existing one at `packages/core/src/agent-home/relative-age.ts` is the right call — if it doesn't ship to the dashboard already, ship a small client-side equivalent at this path.                                 |

### Hooks (new files under `apps/dashboard/src/hooks/`)

| File                    | Responsibility                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `use-cockpit-status.ts` | Derives `CockpitStatusA1` from `useHalt()` + `usePendingApprovals()` + `useAgentActivity()` (most-recent row's timestamp). Pure derivation. |

### Page wiring

`apps/dashboard/src/app/(auth)/[agentKey]/page.tsx` is unchanged.

`apps/dashboard/src/app/(auth)/[agentKey]/agent-home-client.tsx` adds per-agent branching:

```tsx
"use client";

import type { AgentKey } from "@switchboard/schemas";
import { CockpitPage } from "@/components/cockpit/cockpit-page";
import { LegacyAgentHomeClient } from "./legacy-agent-home-client"; // renamed copy of today's file

export function AgentHomeClient({ agentKey }: { agentKey: AgentKey }) {
  if (agentKey === "alex") return <CockpitPage agentKey={agentKey} />;
  return <LegacyAgentHomeClient agentKey={agentKey} />;
}
```

The old client body moves to `legacy-agent-home-client.tsx`. Riley + Mira keep their existing pages. The `LegacyAgentHomeClient` import is deleted at A.6.

`HaltProvider` placement: the existing `EditorialAuthShell` (which wraps the page in `page.tsx`) already mounts `HaltProvider`. The cockpit page does **not** re-mount it. `CockpitPage` calls `useHalt()` from the existing provider. **Re-rooting** is not in A.1's scope despite being on the parent-spec's list — it's only needed if `EditorialAuthShell` is replaced wholesale (it is not at A.1). The cockpit renders inside the editorial shell at A.1; the shell-replacement happens at A.6 when the legacy code is deleted.

### Data sources (all existing — no new endpoints)

| Cockpit slot                | Data source (existing)                                                    | Shape mapping                                       |
| --------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------- |
| Identity name + accent      | `alex-config.ts` (static)                                                 | direct                                              |
| Identity status pill        | `useHalt() + usePendingApprovals() + useAgentActivity()`                  | `use-cockpit-status` derivation                     |
| Identity `line` (one-liner) | `useAgentGreeting(agentKey)` (`/api/dashboard/agents/[agentId]/greeting`) | first `subprose` segment of the greeting view-model |
| Approval block              | `usePendingApprovals()` (Mercury approvals hook)                          | `legacy-pending-approval-to-approval-view.ts`       |
| Activity stream             | `useAgentActivity(days=1)` (existing)                                     | `activity-kind-map.ts`                              |
| KPI strip slot              | empty                                                                     | reserved for A.3                                    |
| Composer slot               | inert placeholder                                                         | reserved for A.5                                    |

### Tests (new)

| File                                                                                        | Coverage                                                                                                                            |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `apps/dashboard/src/hooks/__tests__/use-cockpit-status.test.tsx`                            | All 4 A.1 states: `HALTED`, `WAITING`, `WORKING`, `IDLE`; pulse rules.                                                              |
| `apps/dashboard/src/lib/cockpit/__tests__/legacy-pending-approval-to-approval-view.test.ts` | Each `riskCategory` → urgency mapping; missing-field defaults; binding-hash carry.                                                  |
| `apps/dashboard/src/lib/cockpit/__tests__/activity-kind-map.test.ts`                        | Each existing `eventType` → `ActivityKind`; unknown event falls back gracefully.                                                    |
| `apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx`                     | Snapshot + interaction: renders for `agentKey="alex"`; `IDLE` cold state; `WAITING` with one pending approval; Halt button toggles. |
| `apps/dashboard/src/components/cockpit/__tests__/approval-card.test.tsx`                    | Renders all 6 Alex approval `kind` values from fixtures; primary/secondary handlers fire.                                           |
| `apps/dashboard/src/components/cockpit/__tests__/activity-stream.test.tsx`                  | Renders rows from a translated-actions fixture; filter buttons switch state.                                                        |
| `apps/dashboard/src/app/(auth)/[agentKey]/__tests__/agent-home-client.test.tsx`             | Branches: `alex` → `CockpitPage`; `riley` → `LegacyAgentHomeClient`.                                                                |

---

## What does NOT ship at A.1

Drop-down list of explicit non-goals to prevent scope creep mid-PR:

- ❌ `kpi-strip.tsx`, `kpi.tile.tsx`, `roi-bar.tsx` (A.3)
- ❌ `legacy-shapes.ts`, `legacyTiles`, `legacyRoi` (A.3)
- ❌ `mission-popover.tsx` (A.2)
- ❌ `empty-state.tsx` — Day-1 narrator + setup checklist (A.2; cold state at A.1 is the bare cockpit with the activity stream's empty placeholder)
- ❌ `/api/dashboard/agents/[agentId]/mission` route (A.2)
- ❌ `use-agent-mission.ts` hook (A.2)
- ❌ `command-palette.tsx`, `parse-command.ts`, `composer.tsx` (A.5)
- ❌ `toast.tsx` Alex voice (A.5; A.1 has no toast surface)
- ❌ `thread-preview.tsx`, reply-box routing (A.4)
- ❌ `ActivityRow.preview` / `body` / `replyable` semantics rendered (A.4)
- ❌ New or extended activity endpoint (A.4)
- ❌ `metrics-alex.ts` changes (A.3)
- ❌ `Approval.payload.quote / quoteFrom / body` schema additions (A.5)
- ❌ `RecommendationPresentation.acceptToast / declineToast` (A.5)
- ❌ `AgentRoster.config.avgValueCents / targetCpbCents / narratorState` (A.3 / out-of-Phase-A)
- ❌ Server-side narrator builder (out of Phase A)
- ❌ Sprite avatars / pixel art (out of Phase A)
- ❌ Riley wiring of any kind (Riley's own PR)
- ❌ Deletion of `components/agent-home/*-block.tsx` (A.6)
- ❌ Deletion of `agent-home-client.tsx` (A.6)
- ❌ `/team` refactor (A.6 precursor, if needed)
- ❌ `TALKING` status pill state — A.1 uses `WORKING` instead. `TALKING` lands with the conversation-grain backend signals it requires.

---

## Implementation order (within A.1)

Each step should be a separate commit, in this order, with TDD per step:

1. **Types + tokens.** `types.ts` + `tokens.ts` + `kind-meta.ts`. No components yet; tests just validate the type shapes compile.
2. **`alex-config.ts`.** Pure static config; one test verifying tabs/accent/statusColor.
3. **Adapter: `legacy-pending-approval-to-approval-view.ts`.** Pure function; tests for each `riskCategory` mapping.
4. **Adapter: `activity-kind-map.ts`.** Pure function; tests for each event source.
5. **Status hook: `use-cockpit-status.ts`.** Pure derivation; tests for all 4 states.
6. **Primitive components:** `dot.tsx`, `status-pill.tsx`. Render-only; snapshot tests.
7. **Topbar.** Renders tabs + brand; tests for tab states.
8. **Identity.** Composes status pill + name + line + subtitle (static) + halt button; tests cover halted/non-halted state.
9. **Approval card + block.** Renders single + multi-card; resolve handler called with `(verdict, idx)`.
10. **Activity row + stream.** Renders rows; filter buttons change state; rows are non-expandable at A.1.
11. **Composer placeholder.** Static bar.
12. **`cockpit-page.tsx`.** Composes the above; reads from the existing hooks; passes the right view-models down.
13. **Page branching.** Update `agent-home-client.tsx` to branch on `agentKey === "alex"`; copy the old body to `legacy-agent-home-client.tsx`.
14. **Page test.** Branching test.

---

## Acceptance gates (slice-scoped)

From the parent spec's §Acceptance criteria, the subset that applies to A.1:

1. Visiting `/alex` renders the cockpit: amber accent, Alex tab active, Riley tab inactive, Mira tab muted, status pill one of `IDLE / WORKING / WAITING / HALTED`. ✅
2. Cold state (no pending approvals, no recent activity, not halted): status pill `IDLE`. KPI slot empty. Approval block absent. Activity stream renders rows from `useAgentActivity` or the empty placeholder. Composer placeholder visible and inert. ✅
3. Steady state (≥1 pending Alex approval): status pill `WAITING` (amber, pulses). Approval block renders one card per pending approval, sorted by urgency derived from `riskCategory`. ✅
4. **Steady state without approvals:** status pill `WORKING` whenever an Alex activity row exists in the last 15 minutes; otherwise `IDLE`. ✅
5. **Approval card kinds:** each of the 6 kinds renders correctly from fixtures; primary/secondary handlers fire. ✅
6. **Halt:** clicking Halt flips `HaltProvider.halted`; status pill turns red and reads `HALTED`; composer placeholder shows the halted copy. ✅
7. **Per-agent branching:** `/riley` and `/mira` continue to render the legacy block-based home; only `/alex` renders the new cockpit. ✅
8. Type-check, lint, tests pass.

**Out of A.1 acceptance:** mission popover, KPI/ROI behavior, command palette, NL parsing, thread previews, reply-box routing, toast voice. Those tests land in their respective slice plans.

---

## Risks specific to A.1

- **Shell prop types under-served by A.1 use cases.** A.1 only exercises a subset of the prop surface (no `tiles[]`, no `roi`, no `preview`, no `acceptToast`). Risk: the types ship under-constrained and Riley's later wiring discovers gaps. **Mitigation:** type the shell to **Riley's spec** at A.1, not just Alex's A.1 usage. Build a fixture-based render test in `approval-card.test.tsx` that round-trips a Riley-shaped `ApprovalView` so the shell is exercised by both shapes at A.1 merge time.
- **Status flicker between `WORKING` and `IDLE`.** A 15-minute activity window means the pill flips back to `IDLE` exactly 15 minutes after the last row arrives. **Mitigation:** the derivation hook uses `useNow(60_000)` (1-minute resolution) — re-renders at the resolution that matters for the transition. Don't poll faster; doesn't matter.
- **`legacy-agent-home-client.tsx` import becoming stale.** Moving the file to a new path requires no behavior change; the test for the legacy branch should be the same test currently at `apps/dashboard/src/app/(auth)/[agentKey]/__tests__/agent-home-client.test.tsx`, retargeted. **Mitigation:** copy the file verbatim with a renamed export; one diff entry per test file's import update.
- **`useAgentGreeting`'s `subprose` shape.** The greeting hook returns prose segments with multiple kinds (text + link). The identity `line` slot in the cockpit is plain text. **Mitigation:** the adapter flattens segments to text; if the greeting has structured content the cockpit needs (e.g. inline links to settings), that lands at A.2 with the mission popover.

---

## Verification before merge

1. `pnpm typecheck` clean.
2. `pnpm lint` clean.
3. `pnpm --filter @switchboard/dashboard test` green for the new test files (per memory: dashboard `next build` is not in CI — also run `pnpm --filter @switchboard/dashboard build` locally before merging).
4. Manual: `pnpm dev` → `/alex` renders the cockpit; `/riley` renders legacy.
5. Manual: trigger a pending approval via seed/fixture; pill turns `WAITING`; card renders.
6. Manual: pull the halt button; pill turns `HALTED`; placeholder shows halted copy.
7. Grep verification: no new imports of the old `agent-home/*-block.tsx` files from the new cockpit code.

---

## What comes after A.1

- **A.2 plan** authors `use-agent-mission.ts`, the aggregator route, and the popover.
- **A.3 plan** ports `legacyTiles` / `legacyRoi` and extends `metrics-alex.ts`.
- **A.4 plan** decides extend-vs-new for the activity endpoint and ships the thread-preview UI.
- **A.5 plan** ports `parseCommand`, ships the palette + composer.
- **A.6 plan** does the deletion sweep after Riley's cockpit lands.

Each gets a separate doc under `docs/superpowers/plans/` in the same `docs/alex-cockpit-*` branch family.
