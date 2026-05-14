# Alex Cockpit A.2 — Mission Popover + Cold-State Narrator

**Date:** 2026-05-14
**Parent spec:** [Alex Cockpit Home — Full Phase A Target Spec](../specs/2026-05-14-alex-cockpit-home-design.md) (§Implementation slices → A.2)
**Predecessor slice:** [A.1 Slice Brief](./2026-05-14-alex-cockpit-a1-slice-brief.md)
**Sibling spec:** [Riley Cockpit Home](../specs/2026-05-13-riley-cockpit-home-design.md)

---

## Slice goal

Make Alex's identity row tell the operator **what Alex is configured for** (mission popover) and **what's still missing** (Day-1 cold state narrator + setup checklist). Both surfaces are presentation layers over the same new aggregator endpoint — `GET /api/dashboard/agents/[agentId]/mission` — so they ship in the same slice.

A.2 proves the mission aggregator's shape supports both Alex and Riley (per the spec's frozen contract) without persisting narrator state. No KPI/ROI, no activity richness, no composer/palette, no schema migrations.

---

## What ships

### Backend (Fastify, `apps/api/src/routes/agent-home/`)

| File | Responsibility |
|------|----------------|
| `mission.ts` (new) | `GET /agents/:agentId/mission` aggregator returning `{ agentKey, displayName, mission: { role, pipeline, brand, channels[], rules \| null }, composerPlaceholder, commands, targets, setup[] }`. Alex-only at A.2; Riley returns 404 (Riley's own PR wires Riley's mission). Reads `AgentRoster` + `OrganizationConfig` + `Connection` rows + `ManagedChannel` rows. `rules` is `null` when `AgentRoster.config` doesn't carry `priceApprovalThreshold` or `refundEscalationFloor` (defensive read — neither key exists in DB today). `targets` is `null` for both fields at A.2 (A.3 wires them). `commands` is `[]` at A.2 (A.5 wires them). |
| `__tests__/mission.test.ts` | Connection-present and Connection-absent paths; ManagedChannel status mapping; missing `OrganizationConfig.name` fallback; 404 for non-Alex agents at A.2. |
| `bootstrap/routes.ts` (modified) | Register `missionRoute` under `/api/dashboard` next to `metricsRoute`. |

### Dashboard proxy (Next.js, `apps/dashboard/src/app/api/dashboard/agents/[agentId]/mission/`)

| File | Responsibility |
|------|----------------|
| `route.ts` (new) | Proxies `GET` to upstream Fastify `getMission(agentKey)` on `apiClient`. Mirror of `[agentId]/greeting/route.ts`. |
| `__tests__/route.test.ts` | 200 success / 401 unauth / 500 error paths via mocked apiClient. |

### API client (`apps/dashboard/src/lib/api-client/governance.ts`)

| Change | Responsibility |
|--------|----------------|
| Add `getMission(agentKey: string): Promise<MissionAggregatorResponse>` next to `getGreeting`. |

### Hook (`apps/dashboard/src/hooks/`)

| File | Responsibility |
|------|----------------|
| `use-agent-mission.ts` (new) | React Query hook keyed on `agentKey` + the `useHalt()` halted flag (refetches when halt toggles, per spec §3). 60 s refetch interval matches `use-agent-greeting.ts`. Returns `{ data, isLoading, isError }`. |
| `__tests__/use-agent-mission.test.tsx` | Hook fetches once on mount; refetches when halt flips; surfaces fetch errors. |

### Shared schemas (`apps/dashboard/src/lib/cockpit/`)

| File | Responsibility |
|------|----------------|
| `mission-types.ts` (new) | TS types for the wire shape: `MissionAggregatorResponse`, `MissionChannel`, `MissionChannelKind`, `MissionChannelStatus`, `MissionRules`, `MissionTargets`, `MissionSetupRow`. Local to the dashboard package — backend has its own Zod schema (see `mission.ts`). Spec §3 explicitly lists the shape; this file is the typed surface for the hook + popover + EmptyState. |
| `__tests__/mission-types.test.ts` | Compile-time type assertions via `expectTypeOf` (mirrors `types.test.ts`). |

### Identity prop extension (`apps/dashboard/src/components/cockpit/identity.tsx`)

Add two optional props — `onOpenMission?: () => void` and `missionInteractive?: boolean` — without breaking A.1's static call sites. When `missionInteractive` is true, the subtitle becomes a button that calls `onOpenMission` on click; otherwise it renders as plain text (A.1 default). The locked design specifies a subtle hover affordance (underline + `cursor-pointer`); no edit-pencil icon.

### New components (`apps/dashboard/src/components/cockpit/`)

| File | Responsibility |
|------|----------------|
| `mission-popover.tsx` | Floating popover anchored to the identity subtitle. Five rows (Role, Pipeline, Brand, Channels, Rules) rendered from `mission` view-model. `Channels` row renders one `<Dot>` per channel with `MissionChannelStatus` color. `Rules` row hides itself when `mission.rules` is `null`. Footer: "Edit configuration" link to `/settings`. Closes on outside-click + Escape. No edit affordances in the popover body. |
| `__tests__/mission-popover.test.tsx` | Renders all 5 rows from fixture; channel-dot color per status; `rules == null` hides Rules row; Escape closes; outside-click closes; Edit configuration link href. |
| `empty-state.tsx` | Narrator block (warm-paper card with avatar + 1–2 first-person lines + "NEXT MOVE" pill) above the 4-row setup checklist (`meta` / `inbox` / `cal` / `rules`). Renders **only** when the mission aggregator returns at least one un-done setup row AND no completed Day-1 has happened (heuristic: every `setup[].done === false`). Narrator copy is templated **client-side** from `mission.rules` (if `null`, uses the locked-design default thresholds `$89` / `$200`). `nextMove` is whichever setup row is `primary: true` and not yet `done`. Setup-row `onConnect` routes to `/setup?step={key}` deep links. Composer placeholder stays visible (existing A.1 behavior); KPI/activity slots do not render when EmptyState renders. |
| `__tests__/empty-state.test.tsx` | Renders narrator + 4 setup rows; primary highlight respects `setup[].primary`; thresholds template from `rules`; default thresholds when `rules == null`; row-click invokes `onConnect`; conditional render gated on `every(row => !row.done)`. |

### CockpitPage composition (`apps/dashboard/src/components/cockpit/cockpit-page.tsx`)

Modified to:
1. Call `useAgentMission(agentKey)` alongside the existing hooks.
2. Mount `<MissionPopover>` as a child of `<Identity>` with `onOpenMission` toggling local `open` state.
3. Pass `missionInteractive` to `<Identity>` only when `useAgentMission().data` is loaded successfully (no flicker into "clickable" while data is loading).
4. Render `<EmptyState>` between `<Identity>` and the approval block when mission data signals cold state. When EmptyState renders, the activity stream is **not** rendered. KPI slot remains empty (A.3 still).

---

## What does NOT ship at A.2

Explicit non-goals to keep PR scope tight:

- ❌ Riley mission wiring — Fastify `mission.ts` 404s on `riley`. Riley's slice adds its own derivation.
- ❌ KPI strip / ROI bar / `legacyTiles` / `legacyRoi` (A.3).
- ❌ `targets` echo from `AgentRoster.config` — aggregator returns `targets: { avgValueCents: null, targetCpbCents: null, roasSource: "deterministic" }` placeholder (A.3 wires actual reads).
- ❌ `commands` catalog and parser (A.5) — aggregator returns `commands: []`.
- ❌ `Approval.payload.kind` / `quote` / `quoteFrom` / `body` schema additions (A.5).
- ❌ Activity stream changes — translator stays as A.1.
- ❌ Composer NL parsing, `⌘K` palette, `Toast` Alex voice (A.5).
- ❌ Thread-preview reply box, `who` row affordances (A.4).
- ❌ Sprite avatars (out of Phase A).
- ❌ `narratorState` persistence column on `AgentRoster` (out of Phase A per spec §Backend §2). Narrator copy is templated client-side.
- ❌ `Approval.payload`, `RecommendationPresentation`, `OrganizationConfig` schema additions.
- ❌ `HaltProvider` re-rooting — provider stays mounted by `EditorialAuthShell` per A.1 lesson `project_console_halt_state_phase2_lift` (A.6 only).
- ❌ Status pill vocabulary change — `WORKING/IDLE/WAITING/HALTED` stays. `TALKING + liveCount` requires conversation-grain signals (later phase).
- ❌ Mission aggregator polling on `Connection`/`ManagedChannel`/config mutations — relies on React Query 60 s refetch + halt-toggle refetch.
- ❌ Server-side EmptyState gating — the dashboard decides whether to render EmptyState from the aggregator's `setup[]`. No new server-side flag.
- ❌ Editing inside the popover — every "Edit configuration" path routes to `/settings`. No inline edits.
- ❌ Deletion of any A.1 file. Same retirement gate (A.6) applies.

---

## Acceptance gates (slice-scoped)

From the parent spec's §Phase A acceptance criteria, the subset that applies to A.2:

1. **Mission popover (criterion 7):** subtitle on `/alex` becomes clickable once mission data loads; popover shows up to 5 rows (Role / Pipeline / Brand / Channels / Rules — `Rules` hidden when `null`). Channel rows render colored status dots. "Edit configuration" routes to `/settings`. Closes on outside-click and Escape. ✅
2. **Cold state narrator (criterion 2):** when no `Connection` rows for Meta Ads exist AND no completed setup is detected, `/alex` renders the narrator + 4-row setup checklist instead of the activity stream. Composer placeholder stays. Status pill = `IDLE`. ✅
3. **Backend aggregator (spec §Backend §3):** `GET /api/dashboard/agents/alex/mission` returns the documented shape with channel status dots correctly derived (Meta Ads from `Connection.status`; inbox from `ManagedChannel.status`; calendar TBD path returns `status: "off"`). Setup rows compute `done` from existing entities. `rules` is `null` when `AgentRoster.config` lacks the threshold keys. ✅
4. **Hook contract (spec §3):** `use-agent-mission.ts` refetches when `useHalt().halted` flips. 60 s base refetch interval. ✅
5. **Type contract preserved:** A.1's shell types are unchanged; new types in `mission-types.ts` are additive. Identity prop extension does not break A.1 static call sites (default behavior = A.1). ✅
6. `pnpm typecheck` + `pnpm lint` + `pnpm --filter @switchboard/dashboard test` + `pnpm --filter @switchboard/api test` + `pnpm --filter @switchboard/dashboard build` all green locally. (`next build` is not in CI per project memory.)

**Out of A.2 acceptance:** KPI tile assembly, ROI degraded fallback, approval body/quote, command palette, NL parsing, thread previews, status-pill `TALKING`. Those land in A.3–A.5.

---

## Risks specific to A.2

- **Empty `AgentRoster.config`.** No org has the new threshold keys today. `rules: null` is the common case at A.2 launch. **Mitigation:** Rules row hides itself when `mission.rules == null`; narrator falls back to locked-design default thresholds (`$89` / `$200`) so the copy reads cleanly even without persisted rules. Tests cover both branches.
- **Calendar `Connection.serviceId` ambiguity.** There is no canonical calendar `serviceId` in the codebase yet (no Google Calendar / Calendly integration shipped). **Mitigation:** A.2 returns `status: "off"` for the calendar channel until a calendar integration ships. The aggregator function is structured so adding a real path is a one-line change. Documented in the test fixture and in this brief.
- **EmptyState gating false-positives.** "No `Connection` rows + no completed setup" can fire for a tenant that is mid-onboarding. **Mitigation:** EmptyState rendering is gated on `every(setup[].done === false)` — i.e. **all four** setup rows must be incomplete. A tenant with a Meta Ads `Connection` but no inbox would see steady-state KPI slots (still empty at A.2) and the activity stream instead — not the narrator card. The aggregator's `setup[]` computation is the single source of truth.
- **Mission popover focus management.** Popover trap-focus + restore is fiddly. **Mitigation:** v1 uses a controlled `open` boolean owned by `cockpit-page.tsx`; Escape closes via global keydown listener; outside-click closes via a ref-bound document mousedown handler. Tab navigation is allowed to escape the popover (it is a disclosure, not a modal) — matches the locked design.
- **API client surface drift.** Adding `getMission` to `governance.ts` keeps the same file growing. **Mitigation:** acceptable here — the file is the per-org client used by all agent-home endpoints. Splitting is out of scope.
- **`mission-popover` size budget.** The popover renders 5 rows + footer in <250 lines — under the 400-line warn threshold (per `CLAUDE.md`).
- **Wire-vs-UI threshold defaults.** Spec quotes `$89` and "refunds" without a number, but locked-design narrator copy reads `pricing decisions over $89 and refunds`. **Mitigation:** UI defaults to `$89` for `priceApprovalThreshold` and `$200` for `refundEscalationFloor` when `rules == null` — matches the design file's copy. Tests assert exact strings.

---

## Verification before merge

1. `pnpm --filter @switchboard/api test` — all green; new `mission.test.ts` passes.
2. `pnpm --filter @switchboard/dashboard test` — new tests pass.
3. `pnpm typecheck` workspace-wide — clean.
4. `pnpm lint` workspace-wide — clean.
5. `pnpm --filter @switchboard/dashboard build` — succeeds locally (build is not in CI per memory; A.1 lesson `feedback_dashboard_no_js_on_any_import` applies: dashboard imports omit `.js` extensions).
6. Manual: `pnpm dev` → `/alex` with empty seed → narrator + 4 setup rows. Add a Meta Ads `Connection` row in DB → narrator disappears (or stays if other setup rows still incomplete; depends on gating). Click subtitle → popover opens; click outside → closes; Esc → closes.
7. Manual: `/riley` (logged in with Riley enabled) — page renders legacy block-based home unchanged; no mission popover; no narrator. Aggregator fetch for `riley` 404s — hook returns error, identity stays non-interactive.

---

## What comes after A.2

- **A.3 plan:** Port `legacyTiles` / `legacyRoi`, extend `metrics-alex.ts` with `target` + `avgValue`, add `getAgentTargets` helper, wire `targets` echo on the mission aggregator.
- **A.4 plan:** Decide extend-vs-new for the activity endpoint; ship `thread-preview.tsx` + activity row body/preview/replyable semantics; "Tell Alex about {firstName}" affordance.
- **A.5 plan:** Port `parseCommand`; ship `command-palette.tsx` + `composer.tsx`; wire approval-card primary buttons to `respondToApproval`; add `RecommendationPresentation.acceptToast` / `declineToast` schema; add `Approval.payload.kind` / `quote` / `quoteFrom` / `body`.
- **A.6 plan:** Deletion sweep after the cockpit has been stable through A.5 and Riley's cockpit has shipped.
