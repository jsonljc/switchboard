# Riley Cockpit B.2a — Mission Popover (mission-only split of B.2)

**Date:** 2026-05-15
**Parent spec:** [Riley Cockpit — Wave A Slicing Design](../specs/2026-05-14-riley-cockpit-wave-a-slicing-design.md) (§Slice B.2)
**Target spec:** [Riley Cockpit Home — Design Spec](../specs/2026-05-13-riley-cockpit-home-design.md) (§Mission popover, §Riley capability inventory)
**Predecessor slice:** Riley B.1 — `feat(riley-cockpit): B.1 — core operator loop at /riley` (#488, squash `5ef3910a`)
**Sibling slice:** Alex Cockpit A.2 — `feat(cockpit): A.2 mission popover + Day-1 narrator` (#485, squash `67eb0618`)

---

## Why B.2 is split

The Wave A slicing spec scopes B.2 as **mission popover + KPI strip + ROI bar** in a single PR. KPI strip + ROI bar both depend on Alex A.3 shipping the `<KPIStrip>` / `<ROIBar>` shell components and the `legacyTiles` / `legacyRoi` adapters that convert today's flat `/api/dashboard/agents/[agentId]/metrics` shape to the tile/ROI view-model. Alex A.3 has not merged.

B.2a ships the mission popover wiring for Riley **only** — the part of B.2 that has no A.3 dependency. The KPI strip + ROI bar + `AgentRoster.avgValueCents`/`targetCpbCents` migration + `/metrics` extension move to **B.2b**, opened once Alex A.3 lands.

This split is consistent with the slicing spec's load-bearing constraint (the adapter boundary) — B.2a does not touch any KPI or ROI surface and does not add any new substrate.

---

## Slice goal

Make Riley's identity row tell the operator **what Riley is configured for**: a clickable mission subtitle that opens the existing `<MissionPopover>` (shipped by Alex A.2) with Riley-shaped mission rows. Backend gains a `buildRileyMissionResponse` branch in the existing `mission.ts` aggregator; the `agentId !== "alex"` 404 short-circuit is removed.

A.2 proved the aggregator shape supports both Alex and Riley without persisting narrator state. B.2a is the Riley side of that contract.

---

## What ships

### Backend (Fastify, `apps/api/src/routes/agent-home/mission.ts`)

| Change                                                      | Responsibility                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildRileyMissionResponse(inputs)` (new exported function) | Mirror of `buildAlexMissionResponse`. Reads `AgentRoster` + `OrganizationConfig` + `Connection` rows (Meta Ads + optional `crm-data-provider`). Does **not** read `ManagedChannel` (those are Alex's inbox surface; Riley's only channel is Meta Ads). Returns the same `MissionAggregatorResponse` shape with `agentKey: "riley"`.                                 |
| Riley 404 removed                                           | Replace `if (agentId !== "alex") return reply.code(404)…` with a branch: `if (agentId === "alex") build Alex; else if (agentId === "riley") build Riley`. The `ALEX_RILEY_ONLY` whitelist already permits both.                                                                                                                                                     |
| Riley constants                                             | `RILEY_ROLE = "Ad optimizer · score, recommend, never act without your approval"`, `RILEY_PIPELINE = "Ad sets · all campaigns"`, `RILEY_COMPOSER_PLACEHOLDER = "Tell Riley what to do — coming soon"` (the live Riley voice placeholder lands in B.3).                                                                                                              |
| `__tests__/mission.test.ts` extension                       | Add a Riley `describe` block covering: cold (no connections), Meta-connected (`status: "ok"`), Meta-degraded (`status: "warn"`), CRM provider present (`roasSource: "crm"`), targets set in `roster.config` (`avgValueCents`/`targetCpbCents` non-null), missing `OrganizationConfig.name` fallback, and the precondition that `mission.rules` is `null` for Riley. |

#### Riley aggregator output (locked at the spec level)

```ts
{
  agentKey: "riley",
  displayName: roster.displayName,              // typically "Riley"
  mission: {
    role: "Ad optimizer · score, recommend, never act without your approval",
    pipeline: "Ad sets · all campaigns",
    brand: `${orgName || "(unnamed organization)"} · —`,
    channels: [
      { kind: "meta-ads", label: "Meta Ads", status: <mapConnectionStatus(metaConnection?.status)> },
    ],
    rules: null,                                // Riley has no priceApproval/refund rules
  },
  composerPlaceholder: "Tell Riley what to do — coming soon",
  commands: [],
  targets: {
    avgValueCents:  <readNumberKey(roster.config, "avgValueCents")>,
    targetCpbCents: <readNumberKey(roster.config, "targetCpbCents")>,
    roasSource: <crmProviderConnected ? "crm" : "deterministic">,
  },
  setup: [
    { key: "meta",  done: !!metaConnection },
    { key: "rules", done: avgValueCents !== null && targetCpbCents !== null },
  ],
}
```

Notes:

- **Targets read from `AgentRoster.config` JSON, not from typed columns.** The `AgentRoster.avgValueCents` + `targetCpbCents` migration is part of B.2b alongside the KPI/ROI consumers that justify it. In B.2a, the targets row is fed from `roster.config` exactly as Alex's `priceApprovalThreshold` / `refundEscalationFloor` rules are.
- **`roasSource` enum** uses the wire shape's existing `"deterministic" | "crm"` union, not the target spec's prose "ROAS from Meta / CRM" string. The popover renders the human label client-side.
- **`channels` array** ships one row (`meta-ads`). Multi-platform breakdown (Google/TikTok) is target-spec post-launch.
- **`setup` array** is returned but **NOT consumed in B.2a** — Riley does not render the Day-1 `<EmptyState>` narrator. Riley's cold-state experience is the synthetic activity rows from B.1 (`cold-state-activity-rows.ts`). Rendering both would conflict. The aggregator still returns `setup` for shape parity with Alex and for B.2b/future consumers.

### Dashboard wiring (`apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx`)

Modified to mirror `cockpit-page.tsx` (Alex) for the mission popover only — **no Day-1 narrator branch**:

1. Call `useAgentMission("riley")` next to the existing Riley hooks.
2. Add local `missionOpen` state.
3. Wrap `<Identity>` in a `position: relative` div (same as Alex) and mount `<MissionPopover>` as a sibling, conditionally on `mission.data`.
4. Pass `missionInteractive={!!mission.data}` and `onOpenMission={() => setMissionOpen(o => !o)}` to `<Identity>`.
5. **Keep** the existing `subtitle={RILEY_MISSION_SUBTITLE}` static prop for the visible label — the popover shows full rows, the subtitle stays "Optimizing Meta Ads".
6. **No `<EmptyState>` branch.** The B.1 activity stream + synthetic cold-state rows are preserved unchanged.
7. **No KPI/ROI region.** The B.1 page already has no DOM slot there; B.2a adds none.

`apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx` test (`__tests__/riley-cockpit-page.test.tsx`) gains popover-open and popover-closed assertions. Existing B.1 test cases (cold / steady / halted) stay green.

### Tests added

| File                                                                          | New cases                                                                                                                                                                  |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/routes/agent-home/__tests__/mission.test.ts`                    | 7 Riley cases (see backend table above).                                                                                                                                   |
| `apps/api/src/routes/agent-home/__tests__/mission.test.ts`                    | Remove or invert the existing "404 for non-Alex agents at A.2" case — Riley now returns 200. Mira still 404s (Mira is not in `ALEX_RILEY_ONLY`).                           |
| `apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx` | Popover toggles via subtitle click; popover renders Riley-shaped 5 rows from fixture; `mission.data === undefined` keeps subtitle non-interactive (existing B.1 behavior). |

### No changes to

- `apps/dashboard/src/components/cockpit/mission-popover.tsx` — agent-agnostic from A.2; renders Riley shapes correctly.
- `apps/dashboard/src/components/cockpit/empty-state.tsx` — unused by Riley in B.2a.
- `apps/dashboard/src/hooks/use-agent-mission.ts` — takes `agentKey` parameter; supports Riley as-is.
- `apps/dashboard/src/lib/cockpit/mission-types.ts` — `MissionAggregatorResponse.agentKey` is already `"alex" | "riley"`.
- `apps/dashboard/src/lib/api-client/governance.ts` — `getMission(agentKey)` is agent-key-parameterized.
- `apps/dashboard/src/app/api/dashboard/agents/[agentId]/mission/route.ts` — proxy forwards any agentKey upstream.
- Any file under `apps/dashboard/src/lib/cockpit/riley/**` (adapter boundary unchanged).
- `riley-config.ts` — `RILEY_MISSION_SUBTITLE` stays the static "Optimizing Meta Ads" string. The popover doesn't replace it.

---

## What does NOT ship at B.2a

Explicit non-goals — these move to B.2b or later:

- ❌ **KPI strip** (`<KPIStrip>`) — depends on Alex A.3.
- ❌ **ROI bar** (`<ROIBar>`) — depends on Alex A.3.
- ❌ **`/api/dashboard/agents/[agentId]/metrics` extension** with `tiles[]` + `roi` + `targets` — depends on A.3's `legacyTiles`/`legacyRoi` shape decision.
- ❌ **`AgentRoster.avgValueCents` + `targetCpbCents` columns migration** — schema cost only justified once typed-access consumers ship. Deferred to B.2b.
- ❌ **`metrics-riley.ts` typed extension** — same reason.
- ❌ **Day-1 `<EmptyState>` narrator for Riley** — Riley's cold-state is handled by B.1's synthetic activity rows. The aggregator returns `setup[]` for shape parity but the Riley page does not render the narrator.
- ❌ **Inngest `system.scoring_run_in_progress` audit instrumentation** — `REVIEWING` status wiring stays deferred per slicing spec §Status pill.
- ❌ **Anything in B.3** — Riley accent application, command palette `RILEY_COMMANDS`, composer parsing, Riley toast voice, `RecommendationPresentation.acceptToast`/`declineToast` schema extension.
- ❌ **Anything in Wave B** — WorkTrace mirror, PlatformIngress route, outcome attribution, learning memory, governance hook unification.
- ❌ **New mutation paths.** B.2a is pure read; no `actOnRecommendation` invocations are added.

---

## Adapter-boundary invariant

The B.1 load-bearing rule still applies and is verified for B.2a:

> Cockpit UI consumes view-models only. Only files under `apps/dashboard/src/lib/cockpit/riley/**` may import `Recommendation` / `AuditEntry` / `@switchboard/db` / `@prisma` / `@switchboard/schemas/{recommendations,audit}`.

B.2a adds **no new** imports to `components/cockpit/` or `hooks/use-riley-*`. The `useAgentMission` hook is already exempt from the rule (it consumes a typed wire shape from `lib/cockpit/mission-types.ts`, not Prisma).

Pre-merge grep check stays the same as B.1:

```bash
rg "Recommendation|AuditEntry|@switchboard/db|@prisma" \
   apps/dashboard/src/components/cockpit \
   apps/dashboard/src/hooks
```

Expected: zero new matches outside `lib/cockpit/riley/**`.

---

## Dependencies

- ✅ Alex A.2 merged (PR #485, `67eb0618`) — `MissionPopover`, `useAgentMission`, `mission-types.ts`, aggregator route, dashboard proxy route all live on main.
- ✅ Riley B.1 merged (PR #488, `5ef3910a`) — `RileyCockpitPage`, `RILEY_MISSION_SUBTITLE`, `RILEY_TABS`, Riley adapters live on main.
- ⚠ Riley target spec + slicing spec + parity spec + B.1 plan **not yet on main** — they currently live on the `docs/riley-cockpit-home-spec` branch. Per CLAUDE.md doctrine those should land first. The B.2a plan's spec links assume those docs are merged before B.2a opens for review.
- ❌ Alex A.3 — **does not block B.2a**. A.3 is a precondition for B.2b only.

---

## Backend changes by slice (refresher)

| Change                                                                                            | Slice                 |
| ------------------------------------------------------------------------------------------------- | --------------------- |
| `buildRileyMissionResponse` + remove Riley 404                                                    | **B.2a** (this slice) |
| `AgentRoster.avgValueCents` + `targetCpbCents` columns Prisma migration                           | **B.2b** (after A.3)  |
| `/api/dashboard/agents/[agentId]/metrics` extension with `tiles[]` + `roi` + `targets`            | **B.2b**              |
| `RecommendationPresentation.acceptToast` + `declineToast` optional fields                         | **B.3**               |
| WorkTrace mirror, PlatformIngress route, ExecutableWorkUnit, outcome attribution, learning memory | **Wave B**            |

---

## Risks specific to B.2a

1. **Targets in `config` JSON vs typed columns.** B.2a reads `avgValueCents` / `targetCpbCents` from `AgentRoster.config` JSON. B.2b will introduce typed columns. The aggregator must read from columns once they exist. **Mitigation:** B.2b plan explicitly includes a one-line aggregator change (`readNumberKey(roster.config, "avgValueCents")` → `roster.avgValueCents`) alongside the migration; the popover view-model shape does not change.

2. **`roasSource` source detection.** Detecting `crm-data-provider` via a `Connection` row is the contract the target spec implies, but the precise `serviceId` string for the CRM data provider is not yet locked (no production CRM Connection exists in seed data today). **Mitigation:** B.2a defaults to `"deterministic"` and matches `serviceId === "crm-data-provider"` as the trigger for `"crm"`. If a different `serviceId` ends up being used in production, the constant is in one place (mission.ts) and easy to swap.

3. **Mira `/mira` route impact.** `ALEX_RILEY_ONLY` already excludes Mira (404). Verify the route test still passes for Mira after removing the Riley short-circuit.

4. **CockpitPage Day-1 narrator divergence.** Alex's cockpit-page.tsx conditionally renders `<EmptyState>` or `<ActivityStream>` based on `shouldRenderEmptyState(mission.data.setup)`. Riley's page bypasses this branch. The reviewer should verify the divergence is intentional and the spec rationale (B.1 synthetic rows already handle Riley cold state) is in the PR description. **Mitigation:** documented in this brief; called out in PR template.

5. **Branch hygiene.** Specs and the B.1 plan are still on `docs/riley-cockpit-home-spec` rather than main. If that branch's PR has not opened by the time B.2a is ready for review, this PR's spec links will dangle. **Mitigation:** open the spec-docs PR first or bundle the docs into a separate doc-only PR ahead of B.2a.

---

## Test contract

- Aggregator unit tests (Vitest under `apps/api/src/routes/agent-home/__tests__/mission.test.ts`) — 7 Riley cases listed above. Mocks Prisma like the existing Alex cases.
- Page-level integration test (`apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx`) — popover toggle, popover row count, non-interactive subtitle when mission data is loading.
- View-model contract: existing `mission-types.test.ts` already type-asserts the wire shape; B.2a adds no new types.
- `pnpm typecheck`, `pnpm lint`, `pnpm test --filter @switchboard/api --filter @switchboard/dashboard`, `pnpm --filter @switchboard/dashboard build` all clean.

---

## What comes after B.2a

- **B.2b** — KPI strip + ROI bar + `AgentRoster` migration + `/metrics` extension. Plan written when Alex A.3 lands.
- **B.3** — Riley voice + composer + palette + accent application.
- **Wave B** — doctrine workstream tracked in `2026-05-14-riley-agent-infra-parity-design.md`.
