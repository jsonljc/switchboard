# Riley Cockpit — Wave A Slicing Design

**Date:** 2026-05-14
**Status:** Spec — ready for B.1 implementation plan via writing-plans
**Parent spec:** [Riley Cockpit Home — Design Spec](./2026-05-13-riley-cockpit-home-design.md) (locked target)
**Sibling spec:** [Riley Agent-Infra Parity — Wave B](./2026-05-14-riley-agent-infra-parity-design.md) (post-cockpit doctrine workstream)
**Alex parallel:** [Alex Cockpit Home Design](./2026-05-14-alex-cockpit-home-design.md) (Phase A target) + [A.1 slice brief](../plans/2026-05-14-alex-cockpit-a1-slice-brief.md)

---

## Summary

Converts the locked Riley cockpit target spec into a shippable **Wave A** sequence. Three PRs (B.1, B.2, B.3) deliver Riley's cockpit on top of the shared cockpit shell that Alex's Phase A workstream is building. **Riley stays advisory-only on its current `Recommendation + AuditEntry` substrate**; closing the operational-doctrine gap (WorkTrace mirror, PlatformIngress route, outcome attribution, learning memory, governance hook unification, unified approval lifecycle) is the **Wave B** workstream tracked in the sibling parity spec.

The load-bearing constraint of Wave A is the **adapter boundary**: cockpit UI consumes view-models only; only adapter files may know about `Recommendation` + `AuditEntry`. When Wave B mirrors recommendations into `WorkTrace`, the substrate swap touches adapter files only — UI does not change.

---

## Decision: Approach B — Riley cockpit vertical slice

Three slicing approaches were considered. The locked decision is **Approach B**: a vertical slice that ships Riley's core operator loop first (B.1), then layers performance context (B.2), then voice + polish (B.3).

| | A — Mirror Alex A.1–A.6 | **B — Vertical slice (locked)** | C — Backend-first |
|---|---|---|---|
| PRs | 6 | 3 | 1 backend + 4–5 frontend |
| First user-visible value | B.4 (approvals) | **B.1** (approvals + activity from day one) | After backend + first frontend slice |
| Adapter discipline | Diffuse across 6 PRs | Concentrated in B.1 review | Explicit but no end-to-end proof until frontend ships |
| Risk | High PR overhead, low value-per-PR | B.1 is larger; mitigated by ruthless scope discipline | Backend ships without end-to-end validation |

**Why B wins:** approval cards are the actual Riley product (operators care about "what does Riley want me to approve and why," not KPI decoration). Concentrating the adapter boundary in B.1 lets a single review enforce the architectural rule. Slice cadence tracks Alex naturally — B.1 piggybacks on Alex A.1; B.2 lands when A.2+A.3 land; B.3 lands when A.5 lands.

---

## Hard rule (load-bearing)

**Cockpit UI consumes view-models only. Only adapter files may know about `Recommendation` + `AuditEntry`.**

This is the rule that makes the Wave B substrate swap a layer-3 change, not a UI rewrite. Enforcement is described in §Adapter contract.

The rule's corollary, for B.3 specifically: *"The Riley composer is a bounded operator surface, not an execution path. In B.3, commands may navigate, focus existing approval cards, summarize cockpit state, or control local cockpit affordances. Any command that would create a new mutation path, bypass approval cards, or require PlatformIngress / ExecutableWorkUnit semantics is deferred to Wave B."*

---

## Slice B.1 — Riley cockpit core loop

**Single question B.1 answers:** *Can an operator open `/riley` and understand what needs approval and what Riley has recently done?*

### What ships

- **Page wiring.** `/riley` route consumes the shared cockpit shell. `agent-home-client.tsx` adds `if (agentKey === "riley") return <CockpitPage agentKey="riley" />` alongside Alex's branch. Mira continues to render the legacy block-based home.
- **`riley-config.ts`.** Accent (warm clay), tabs, `statusPulse`, `statusColor`. Mission subtitle is a static string in B.1 (popover deferred to B.2).
- **Riley `KIND_META` extension** (`kind-meta-riley.ts`). Adds 9 Riley activity kinds to the shell's table: `watching`, `reviewing`, `paused`, `scaled`, `rotated`, `shifted`, `restructured`, `started`, `alert`. Alex kinds remain unaffected.
- **Status union extension.** `CockpitStatus` already includes `WATCHING` + `REVIEWING` from Alex A.1's shell types. B.1 wires 4 of the 5 Riley states (see §Status pill).
- **Adapter layer** (the architecturally load-bearing files — see §Adapter contract):
  - `recommendation-to-approval-view.ts`
  - `signal-health-grouper.ts`
  - `riley-activity-translator.ts`
  - `riley-status-deriver.ts`
  - `cold-state-activity-rows.ts`
- **Cockpit hooks** (`use-riley-approvals.ts`, `use-riley-status.ts`). Existing `use-agent-activity.ts` is extended via a Riley branch that calls the translator (no duplicate hook).
- **Approval cards.** All 11 recommendation action variants render from fixtures: `pause`, `review_budget`, `scale`, `refresh_creative`, `restructure`, `shift_budget_to_source`, `switch_optimization_event`, `harden_capi_attribution`, `hold`, `add_creative`, `fix_signal_health`. Signal-health rows are grouped per pixel into one account-level card; the card has only an external "Open Events Manager →" primary action in B.1 (no "Dismiss all" — see §Signal-health card).
- **Activity stream.** Riley intents translated to rows via the per-agent translator branch. Cold-state synthetic onboarding rows when no Meta Ads `Connection` exists.
- **Empty / loading / error states** for the hooks.
- **ComposerPlaceholder shell slot** renders in inert placeholder mode only. No command parsing, no palette, no submit behavior.
- **Tests** — fixtures-first; adapter unit tests; cross-agent view-model contract test extension; page-level integration tests (cold / steady / halted).

### What does NOT ship at B.1

- ❌ Mission popover and the `onOpenMission` / `missionInteractive` shell props (Alex A.2 introduces those; Riley B.2 consumes)
- ❌ KPI strip + ROI bar (B.2)
- ❌ `/api/dashboard/agents/[agentId]/mission` aggregator route (B.2)
- ❌ `/api/dashboard/agents/[agentId]/metrics` extension with `tiles[]` + `roi` + `targets` (B.2)
- ❌ `AgentRoster.avgValueCents` + `targetCpbCents` migration (B.2)
- ❌ Command palette / composer behavior / NL parsing (B.3)
- ❌ `RecommendationPresentation.acceptToast` + `declineToast` schema extension (B.3)
- ❌ Riley `toastVoice()` function (B.3)
- ❌ `REVIEWING` status state (deferred — no signal source today)
- ❌ Any direct UI reference to `Recommendation`, `AuditEntry`, Prisma types (enforced by adapter rule)
- ❌ Wave B doctrine work of any kind (WorkTrace mirror, PlatformIngress route, ExecutableWorkUnit, outcome attribution, learning memory, governance hook unification)
- ❌ New bulk-mutation paths (signal-health "Dismiss all" specifically is excluded — see §Signal-health card)
- ❌ Backend changes of any kind — B.1 is pure dashboard

### Dependencies

- **Alex A.1 must merge first.** B.1 consumes the shell components A.1 ships: `CockpitPage`, `Topbar`, `Identity`, `StatusPill`, `Dot`, `ApprovalBlock`, `ApprovalCard`, `ActivityStream`, `ActivityRow`, `ComposerPlaceholder`. A.1 explicitly types the shell to Riley's spec (per A.1 slice brief §Risks) so the boundary verifies at A.1 merge time.
- **No backend dependencies.** B.1 reads from existing dashboard hooks (`useRecommendations`, `useAgentActivity`, `useHalt`, existing `Connection` query) and renders.

### B.1 acceptance criteria

1. Visiting `/riley` while logged in renders the cockpit shell parameterized by Riley's config: clay accent, Riley tab active, Alex tab inactive, Mira tab muted.
2. **Cold state** (no Meta Ads `Connection` row): status pill `IDLE`. Approval block absent. Activity stream renders 3 synthetic onboarding rows. `ComposerPlaceholder` slot visible and inert. KPI/ROI region absent (no DOM slot — B.2 inserts it; a code comment marks the insertion point).
3. **Steady state** (`Connection` present, ≥1 pending `Recommendation`): status pill `WAITING` (amber, no pulse). Approval cards stack with `urgency = "immediate"` first, then `this_week`, then `next_cycle`; within band sorted by `dollarsAtRisk` descending. Each card renders its `humanSummary` as quote and `presentation.primaryLabel` as primary CTA.
4. **Steady state without approvals** (`Connection` present, no pending recs, recent activity within last 15 min): status pill `WATCHING` (green, no pulse). Activity stream renders rows from the translator.
5. **Status precedence:** `Connection` absence takes precedence over pending recommendation rows. B.1 treats orphaned pending recs (no connection) as non-actionable until a connection exists — status pill stays `IDLE`, approval block stays hidden.
6. **All 11 recommendation action variants** render correctly from fixtures.
7. **Signal-health grouping:** multiple `signal:`-prefixed `Recommendation` rows for the same pixel collapse into one account-level `ApprovalView` with `campaign.kind = "account"`, bulleted breach list in `quote`. **No "Dismiss all" button in B.1.**
8. **External-action cards** (`review_budget`, `fix_signal_health`, `harden_capi_attribution`) open the Meta URL via `primaryAction.url`. Card dismissal may reuse the existing external-action dismissal behavior only if already present; B.1 must not introduce new resolution semantics for external actions. Specifically for `fix_signal_health`, opening Events Manager does not mean the issue is fixed.
9. **Internal-action cards:** primary CTA calls `actOnRecommendation`; optimistic UI hides the card; existing toast fires (Riley voice ships in B.3).
10. **Reversibility affordance:** B.1 does not design a new undo flow; it verifies Riley approval cards preserve the existing `actOnRecommendation` undo path (1-hour Undo on `pause` recs).
11. **Halt:** clicking Halt flips `HaltProvider.halted`; status pill turns red and reads `HALTED`; composer placeholder shows the halted copy.
12. **Activity stream** renders Riley-kind rows for the 9 kinds defined; cold-state synthetic rows shown only when no `Connection` exists.
13. **Per-agent branching:** `/alex` continues to render Alex's cockpit (A.1); `/riley` renders Riley's cockpit; `/mira` continues to render the legacy block-based home.
14. **Adapter boundary holds:** the grep smoke check (§Adapter contract) returns zero matches in `components/cockpit/**` and no direct db/schema imports in `hooks/use-riley-*.ts`.
15. **ESLint passes** with the new `no-restricted-imports` rule active.
16. Type-check, lint, dashboard `next build` (per memory: not in CI; run locally) all clean.
17. Tests cover: each of the 5 adapters (unit), the cross-agent view-model contract test extended to all 11 Riley variants, page-render integration tests (cold / steady / halted), the multi-row signal-health grouping scenario.

### Risks specific to B.1

1. **Adapter boundary leak.** Reviewer fatigue or hot-fix could import `Recommendation` directly into a UI component. **Mitigation:** ESLint enforcement (load-bearing) + pre-merge grep + PR template checkbox.
2. **Riley-shaped `ApprovalView` exposes a gap in Alex A.1's shell types.** A.1 attempted to anticipate Riley shapes but may have missed a field (e.g., `campaign: account` variant for signal-health). **Mitigation:** the cross-agent view-model contract test runs at A.1 merge time; B.1 extends that test to cover all 11 Riley variants. If a gap is found, the fix is in the shell, not in Riley adapters.
3. **Three-vocabulary intent drift** in the codebase: `recommendation.pause` (action primitive) / `recommendation.pause_adset` (`pipeline-riley.ts`) / `recommendation.ad_set_pause` (`packages/schemas/src/recommendations.ts` test fixture). **Mitigation:** the translator absorbs all three; tests cover each form. Vocabulary alignment is tracked as a follow-up, out of B.1.
4. **Signal-health rendering before grouping ships.** If signal-health recs exist in seed data and the grouper has a bug, the approval block could spam N cards. **Mitigation:** B.1 explicitly tests the multi-row signal-health scenario; if grouping fails, the test fails before the page renders.
5. **`WATCHING` window edge.** Status flips between `WATCHING` and `IDLE` based on the 15-minute recent-activity window. **Mitigation:** same `useNow(60_000)` pattern Alex A.1 uses; tests at the boundary minute.
6. **Shell prop optionality.** B.1 ships before A.2, so the shell's `Identity` component's `onOpenMission` / `missionInteractive` props must remain optional (per A.1 slice brief §What does NOT ship at A.1). If A.1 marked them required, Riley B.1 cannot compose. **Mitigation:** verified against the A.1 slice brief; flagged if A.1 PR drifts.

---

## Slice B.2 — Mission + performance context

### Dependencies

- **Alex A.2 must merge first** (mission popover component + `useAgentMission` hook + mission row schema).
- **Alex A.3 must merge first** (KPI strip + ROI bar components + `legacyTiles` / `legacyRoi` adapters for Alex's flat shape).

### What ships

- **Mission popover.** Subtitle becomes clickable; popover shows 5 rows (Role / Pipeline / Brand / Channels / Targets). Channels row carries a connection-status dot driven by `Connection.status` (Meta Ads). Targets row discloses ROAS source (`Meta` if no CRM Connection, `CRM` if `crm-data-provider` Connection present).
- **`/api/dashboard/agents/[agentId]/mission` aggregator** — agent-key-aware (Riley reads `Connection` rows; Alex reads `ManagedChannel` rows). One aggregator, branching by `agentKey`.
- **`useAgentMission()` hook** (consumed by both Alex and Riley; lands in Alex's A.2 conceptually but Riley B.2 verifies it returns Riley-shaped mission data).
- **`AgentRoster.avgValueCents` + `targetCpbCents` columns** — Prisma migration via `migrate diff --from-url --to-schema-datamodel --script` + `migrate deploy` (per memory feedback: `migrate dev` blocks on TTY warning prompts in agent sessions). Decision: **columns over `config` JSON** for typed access, easier check-drift, future schema discoverability.
- **`/api/dashboard/agents/[agentId]/metrics` extension** — adds `tiles[]` + `roi` + `targets` fields. Riley's branch in `metrics-riley.ts` produces these natively. Alex's branch keeps emitting today's flat shape; Alex A.3 ships `legacyTiles` / `legacyRoi` adapters to convert.
- **KPI strip rendering for Riley.** 4 tiles (leads / spend / CPL / Reported ROAS) with cold-state degraded path (`"—"` + hint).
- **ROI bar rendering for Riley.** ROAS fill, break-even mark, CPL-vs-target comparator. Degraded path when `avgValueCents` is null or `spend` unavailable.

### B.2 acceptance criteria

1. Mission popover opens from clickable subtitle on Identity row; 5 rows render in the documented order.
2. Channels row carries a `Connection.status`-driven dot: `ok` / `degraded` / `disconnected`.
3. Targets row discloses ROAS source explicitly: `"target CPL $X · avg lead value $Y · ROAS from Meta"` (or `… ROAS from CRM` when a `crm-data-provider` Connection exists).
4. `AgentRoster.avgValueCents` + `targetCpbCents` columns exist via migration; `pnpm db:check-drift` passes.
5. KPI strip renders 4 tiles with cold-state degraded path; tile labels use "Reported ROAS" (not "ROAS") to make the metric source explicit.
6. ROI bar renders with fill, break-even mark, CPL-vs-target comparator; degraded path when `avgValueCents` is null or spend unavailable.
7. **Honest impact-language guardrail.** All KPI/ROI labels must distinguish reported account metrics from Riley-attributed outcomes. No copy in B.2 claims Riley improved metrics. Allowed: estimated `dollarsAtRisk` (pre-decision), reported metrics from Meta or CRM, connection health. Causal attribution to Riley's actions is reserved for Wave B outcome attribution.
8. Type-check, lint, tests, dashboard `next build` clean.

### Plan-stage choice (resolved here, ratified by writing-plans)

The Riley target spec offered two paths for cockpit ROAS+CPL:
- **(a)** Extend `/api/dashboard/roi` (existing funnel endpoint feeding `/reports`).
- **(b) — recommended** Put cockpit ROAS+CPL on `/api/dashboard/agents/[agentId]/metrics`.

**Decision:** Path (b). Keeps `/api/dashboard/roi` focused on `/reports` funnel queries; gives the cockpit a surface-specific endpoint shape; no coupling between cockpit perf and reports query patterns. The cockpit hook count stays at 2 (mission + metrics).

---

## Slice B.3 — Riley voice + cockpit polish

### Dependencies

- **Alex A.5 must merge first** (command palette + composer + toast infrastructure).

### What ships

- **Riley accent applied uniformly** — avatar frame, ROI bar fill, source dots on approval cards, sender label color on activity rows.
- **Command palette** pre-populated with `RILEY_COMMANDS` (the spec's catalog).
- **Composer placeholder** — `RILEY_COMPOSER_PLACEHOLDER` ("Tell Riley what to do — pause the Cold Interests adset, raise daily budget to $200…").
- **`RecommendationPresentation.acceptToast` + `declineToast`** — optional Zod fields on `packages/schemas/src/recommendations.ts`. Recommendation engine populates them where it has context. Cockpit toasts read them, fallback to generic Riley voice.
- **`rileyToast()`** voice function — first-person toast lines ("Paused — Cold Interests adset.", "Back on. Resuming the scan.", etc.).
- **Final empty / error copy pass** — tone consistency with Alex.
- **Visual fit pass** — token consistency, type ramp, vertical rhythm against Alex cockpit.

### Composer constraint (locked, verbatim)

> The Riley composer is a bounded operator surface, not an execution path. In B.3, commands may navigate, focus existing approval cards, summarize cockpit state, or control local cockpit affordances. Any command that would create a new mutation path, bypass approval cards, or require PlatformIngress / ExecutableWorkUnit semantics is deferred to Wave B.

#### Allowed in B.3

- **Navigation** — `open-meta`, `open-rules`, `open-targets`
- **Cockpit-local control** — `pause-1h`, `resume` (operate on `HaltProvider`, no Riley action execution)
- **Briefing / explanation** — `brief-eod`, `cpl-30`, "show me why", "summarize open recommendations"
- **CTA routing** — `rotate-retar` focuses or opens the existing approval card; `scale-lal` routes the operator to the existing approval card's CTA; **the composer does not execute the mutation itself**

#### Deferred to Wave B

- "Pause this ad set" directly mutates Meta state
- "Scale budget to $200" directly creates an execution unit
- "Approve all" bypasses approval lifecycle
- "Rotate creative" triggers executor mutation
- Anything that should become `PlatformIngress` → `ApprovalLifecycle` → `ExecutableWorkUnit` → `ExecutionAttempt`

### B.3 acceptance criteria

1. Riley accent applied uniformly per the design source.
2. Command palette pre-populated with `RILEY_COMMANDS`; ⌘K opens it; commands are grouped (control / thread / rules / nav).
3. **Composer constraint enforced** — code review verifies every command in the catalog matches the Allowed-in-B.3 list above; deferred commands are explicitly absent.
4. `RecommendationPresentation.acceptToast` + `declineToast` schema fields ship as optional; engine populates them where context exists; cockpit toasts use them with fallback to `rileyToast()` generic voice.
5. Final empty / error copy reviewed for tone consistency with Alex.
6. Type-check, lint, tests, dashboard `next build` clean.

---

## Adapter contract (the load-bearing piece)

### Five-layer architecture

```
┌─────────────────────────────────────────────────────────────┐
│ 5. UI components (cockpit shell)                            │
│    <ApprovalCard data={ApprovalView}/>                      │
│    <ActivityStream data={ActivityRow[]}/>                   │
│    <StatusPill statusKey={CockpitStatus}/>                  │
│    — ZERO imports of Recommendation / AuditEntry / Prisma   │
├─────────────────────────────────────────────────────────────┤
│ 4. Cockpit hooks (consume substrate + apply adapters)       │
│    useRileyApprovals()  → ApprovalView[]                    │
│    useRileyStatus()     → CockpitStatus                     │
│    useAgentActivity()   → ActivityRow[]   (existing, branch │
│                          extended for Riley)                │
├─────────────────────────────────────────────────────────────┤
│ 3. Adapter layer (THE BOUNDARY — only files allowed to      │
│    import Recommendation / AuditEntry / db types)           │
│    recommendation-to-approval-view.ts                       │
│    signal-health-grouper.ts                                 │
│    riley-activity-translator.ts                             │
│    riley-status-deriver.ts                                  │
│    cold-state-activity-rows.ts                              │
├─────────────────────────────────────────────────────────────┤
│ 2. Existing dashboard hooks (return raw rows)               │
│    useRecommendations() → Recommendation[]                  │
│    useAgentActivity()   → AuditEntry-derived raw rows       │
│    useHalt()            → halt state                        │
│    (existing connection query)                              │
├─────────────────────────────────────────────────────────────┤
│ 1. Substrate (today: Recommendation + AuditEntry tables;    │
│    Wave B: + WorkTrace mirror)                              │
└─────────────────────────────────────────────────────────────┘
```

**Wave B swap mechanism:** when WorkTrace mirror lands (Wave B), layer 3 adapters change their source from `Recommendation` rows to `WorkTrace` rows. Layers 4 and 5 do not change. The cockpit UI is source-agnostic by construction.

### File layout (new in B.1)

```
apps/dashboard/src/lib/cockpit/riley/
  recommendation-to-approval-view.ts        # 11 action variants → ApprovalView
  signal-health-grouper.ts                  # signal:* rows → 1 grouped ApprovalView
  riley-activity-translator.ts              # raw activity rows → Riley ActivityRow
  riley-status-deriver.ts                   # halt + approvals + connection + activity → CockpitStatus
  cold-state-activity-rows.ts               # synthetic onboarding rows (no connection)
  kind-meta-riley.ts                        # 9 Riley activity kinds (extends shell KIND_META)
  riley-config.ts                           # accent, tabs, statusPulse, statusColor, mission row stubs
  __fixtures__/
    riley-recommendation-fixtures.ts        # one fixture per action variant + signal-health scenario
    riley-activity-fixtures.ts              # one fixture per Riley activity kind
  __tests__/
    recommendation-to-approval-view.test.ts
    signal-health-grouper.test.ts
    riley-activity-translator.test.ts
    riley-status-deriver.test.ts

apps/dashboard/src/hooks/
  use-riley-approvals.ts                    # useRecommendations + adapter → ApprovalView[]
  use-riley-status.ts                       # useHalt + connection + recs + activity → CockpitStatus
  # use-agent-activity.ts is EXTENDED (existing file), not duplicated; Riley branch calls translator
```

### View-model contract

These types live in `apps/dashboard/src/components/cockpit/types.ts` (shared with Alex, already shipped by Alex A.1). B.1 verifies sufficiency for Riley shapes; any extension is in the shell, not in Riley files.

```ts
export type CockpitStatus = "IDLE" | "WORKING" | "WAITING" | "HALTED" | "WATCHING" | "REVIEWING";
// REVIEWING is shipped as a type but not derivation-wired in B.1 — see §Status pill.

export type ApprovalView = {
  id: string;
  kind: ApprovalKind;                      // union of Alex + Riley kinds
  urgency: "immediate" | "this_week" | "next_cycle";
  askedAt: string;
  title: string;
  campaign:
    | { kind: "campaign"; name: string; id: string }
    | { kind: "account";  pixelId: string; breaches: number }
    | null;                                // null for Alex bookings; required for Riley
  quote: string;
  risk?: string;
  confidence?: number;
  learningPhaseImpact?: "no impact" | "will reset learning";
  reversible: boolean;
  primary: string;
  secondary: string;
  presentation: { primaryLabel: string; dismissLabel: string };
  primaryAction:
    | { kind: "internal"; intent: string; parameters: Record<string, unknown> }
    | { kind: "external"; url: string; service: "meta" | "google" };
  acceptToast?: string;                    // wired in B.3
  declineToast?: string;
};

export type ActivityRow = {
  time: string;
  kind: ActivityKind;                      // shell union grows by 9 entries in B.1
  head: string;
  body: string;
  who?: string;
  tag?: string;
  // No preview/body/replyable for Riley rows (those are Alex A.4 concerns)
};
```

### Enforcement (two layers)

**1. ESLint `no-restricted-imports`** (load-bearing). Add to `apps/dashboard/.eslintrc.js`:

```js
{
  "files": [
    "apps/dashboard/src/components/cockpit/**/*.{ts,tsx}",
    "apps/dashboard/src/hooks/use-riley-*.ts",
    "apps/dashboard/src/app/(auth)/[agentKey]/**/*.{ts,tsx}"
  ],
  "rules": {
    "no-restricted-imports": ["error", {
      "patterns": [
        { "group": ["@switchboard/db/*", "@prisma/*"],
          "message": "Cockpit UI/hooks may not import db or Prisma types. Use view-models from lib/cockpit/types or adapter outputs." },
        { "group": ["@switchboard/schemas/recommendations*", "@switchboard/schemas/audit*"],
          "message": "Cockpit UI/hooks may not import Recommendation or AuditEntry schemas directly. Use ApprovalView / ActivityRow view-models." }
      ]
    }]
  }
}
```

Files under `apps/dashboard/src/lib/cockpit/riley/**` are exempt from the rule (this is where the substrate types legitimately live).

The rule reads, in plain English: **Riley cockpit hooks may orchestrate raw-data hooks and adapters, but may not import database, Prisma, Recommendation, or AuditEntry types directly.**

**2. Code review discipline.** PR template adds a checklist line: *"No new imports of `Recommendation` / `AuditEntry` / Prisma types from `components/cockpit/**` or `hooks/use-riley-*`. Adapter files only."*

### Pre-merge grep smoke check

A review gate, not the only enforcement:

```bash
rg "Recommendation|AuditEntry|@switchboard/db|@prisma" \
   apps/dashboard/src/components/cockpit \
   apps/dashboard/src/hooks
```

**Expected:**
- Zero matches in `components/cockpit/**`.
- No direct db/schema/Prisma type imports in `hooks/use-riley-*.ts`.
- Matches are allowed only in `lib/cockpit/riley/**`.
- Matches in tests/fixtures are acceptable if explicitly scoped to fixture or adapter test files.

If the grep returns matches outside the allowed locations, the adapter boundary has leaked — fix before merge.

### Adapter responsibilities (B.1)

| Adapter | Input | Output | Key transforms |
|---|---|---|---|
| `recommendation-to-approval-view.ts` | `Recommendation` row | `ApprovalView` | Map 11 actions to titles/eyebrows/urgency; `humanSummary → quote`; `presentation.primaryLabel → primary`; `dollarsAtRisk → risk`; reversibility flag; `createdAt → askedAt` via existing `relativeAge` util in `packages/core/src/agent-home/relative-age.ts` |
| `signal-health-grouper.ts` | `Recommendation[]` filtered by `campaignId.startsWith("signal:")` | one synthesized `ApprovalView` per pixel | Group by pixel; bullet-list breaches in `quote`; set `campaign.kind = "account"`; **primary action is external (Open Events Manager); no "Dismiss all" button in B.1** |
| `riley-activity-translator.ts` | raw activity rows from existing `use-agent-activity` translator | `ActivityRow[]` with Riley kinds | Map intent + status → `ActivityKind` per the target spec's translator table; absorb three-vocabulary drift (`recommendation.pause` / `recommendation.pause_adset` / `recommendation.ad_set_pause`) |
| `riley-status-deriver.ts` | `{ halted, hasActiveCampaign, pendingApprovals, recentActivityAt, now }` | `CockpitStatus` | Order: `HALTED` → `IDLE` (no connection / no active campaign) → `WAITING` (pending recs, connection present) → `WATCHING` (steady, recent activity). **Connection absence takes precedence over pending recommendation rows.** `REVIEWING` deferred — see §Status pill |
| `cold-state-activity-rows.ts` | `boolean hasConnection` | `ActivityRow[]` | When no connection: 3 synthetic onboarding rows (no DB write) — `Connect Meta Ads to begin`, `Set average lead value`, `Standing rules loaded` |

### Test contract

- **Fixtures-first.** `__fixtures__/riley-recommendation-fixtures.ts` exports one fixture per action variant plus a multi-row signal-health scenario. All adapter tests pull from the same fixtures.
- **Adapter unit tests.** Pure-function tests, no React; verify each input → output mapping.
- **View-model contract test (cross-agent).** Required by Alex A.1: `approval-card.test.tsx` includes a fixture-based render test using a Riley-shaped `ApprovalView`. Riley B.1 extends to cover all 11 variants + the grouped account-level card.
- **Page-level integration tests.** `/riley` renders cold (no connection → 3 synthetic rows), steady (≥1 pending rec → cards render), halted (HaltProvider on → red pill + halted state).
- **Wave B swap-readiness check** (review gate). Reviewer imagines a future PR replacing `useRecommendations()` underneath the adapter with a new `useWorkTraceDecisions()`. If any UI file would need to change, the adapter boundary leaked.

---

## Signal-health card (no hidden bulk-mutation path)

The target spec calls for grouping `signal:`-prefixed `Recommendation` rows for a pixel into one account-level approval card. B.1 ships this **with no hidden fan-out**:

- The grouped card may represent N underlying recommendation rows, but its primary/secondary actions must not silently fan out into N `actOnRecommendation` mutations.
- **B.1 primary action:** `Open Events Manager →` (external, no internal mutation).
- **B.1 secondary action:** none. "Dismiss all" is excluded from B.1.
- Underlying signal-health recs auto-resolve when the daily cron observes the breach cleared (existing engine behavior; no cockpit work needed).
- Per-breach operator-visible dismissal (if needed) waits for a future affordance where the operator expands the group into rows and dismisses each one through the existing single-row `actOnRecommendation` path.

This keeps B.1 from sneaking in a mini-PlatformIngress problem and preserves the Wave B doctrine line: any new bulk execution semantics is a doctrine concern, not a cockpit concern.

---

## Status pill (B.1 derivation)

B.1 wires **4 of the 5 states** from the target Riley spec:

| State | B.1 derivation | Wired? |
|---|---|---|
| `HALTED` | `useHalt().halted === true` | ✅ |
| `IDLE` | no `Connection` row for Meta Ads OR no active campaign | ✅ |
| `WAITING` | `Connection` present AND ≥1 `Recommendation` with `status = "pending"` | ✅ |
| `WATCHING` | `Connection` present, no pending recs, recent activity within last 15 min | ✅ |
| `REVIEWING` | requires `system.scoring_run_in_progress` audit signal — **not emitted today** (verified by `rg "scoring_run_in_progress" packages/ apps/`) | ⏸ deferred |

**Precedence rule.** `Connection` absence takes precedence over pending recommendation rows. B.1 treats orphaned pending recs as non-actionable until a connection exists.

**`REVIEWING` deferral rationale.** Wiring it requires backend instrumentation (Inngest functions emit a "scoring run started/finished" audit event when the 08:00 UTC `ad-optimizer-daily-check` cron runs). That instrumentation is unrelated to the cockpit UI and the 60-second display window is speculative. B.1 ships `WATCHING` whenever `REVIEWING` would have shown. `REVIEWING` lands in B.2 (if backend instrumentation is cheap) or as a future micro-slice; decision deferred to the writing-plans step.

---

## Backend changes by slice

| Change | Where | Slice |
|---|---|---|
| `AgentRoster.avgValueCents` + `targetCpbCents` columns | Prisma migration via `migrate diff --from-url --to-schema-datamodel --script` + `migrate deploy` | **B.2** |
| `/api/dashboard/agents/[agentId]/mission` aggregator route | new Fastify route in `apps/api/` | **B.2** |
| `/api/dashboard/agents/[agentId]/metrics` extension with `tiles[]` + `roi` + `targets` | extend existing route | **B.2** |
| `RecommendationPresentation.acceptToast` + `declineToast` optional fields | Zod schema in `packages/schemas/src/recommendations.ts` | **B.3** |
| Inngest instrumentation for `system.scoring_run_in_progress` audit event | `packages/ad-optimizer/src/inngest-functions.ts` | **deferred** (potentially a B.2 micro-slice) |
| WorkTrace mirror, PlatformIngress route, ExecutableWorkUnit materialization, outcome attribution, learning memory, governance hook unification, unified approval lifecycle | core platform | **Wave B** (sibling parity spec) |

**B.1 ships ZERO backend changes.** Pure UI + adapter work on existing substrate. This is deliberate — it bounds B.1's review surface to dashboard files only and makes the substrate-replacement contract verifiable from the dashboard side alone.

---

## Plan-stage decisions ratified by this spec

The Riley target spec carried a few open plan-stage choices. This slicing spec resolves them:

1. **`AgentRoster` storage:** Columns over `config` JSON (typed access, easier check-drift).
2. **Cockpit ROAS/CPL endpoint:** Add to `/api/dashboard/agents/[agentId]/metrics`, not `/api/dashboard/roi`. Decouples cockpit from reports query patterns.
3. **`REVIEWING` deferred** — no signal source today; revisit in B.2.
4. **Signal-health card** — grouped in B.1, but no "Dismiss all" until per-row operator-visible flow exists.
5. **Composer scope** — bounded operator affordance in B.3; new mutation paths deferred to Wave B.
6. **Reversibility affordance** — verified, not redesigned, in B.1.

---

## Out-of-scope deferrals (Wave A)

These items appear in the target Riley spec but are explicitly out of Wave A:

- **Multi-platform channel rows** — `mission.channels` typed as array but Riley v1 emits only Meta Ads.
- **Google Ads / TikTok per-platform breakdown** — post-launch.
- **Creative thumbnails on approval cards** — image plumbing; defer.
- **Bulk approve/decline operator UX** — Wave B doctrine concern.
- **Autonomous-execution toggle** — Riley is advisory-only for v1.
- **`REVIEWING` window tuning** — 60s is a guess; deferred until observable.
- **WorkTrace mirror / outcome attribution / learning memory / governance hook unification** — Wave B.

---

## Open items for writing-plans

The B.1 implementation plan should resolve:

1. **Test framework choice for adapter tests.** Match dashboard convention (vitest) — confirmed default.
2. **Cross-agent contract test file location.** Whether to extend Alex's existing `approval-card.test.tsx` or create a sibling Riley-specific contract test. Recommendation: extend in place to keep one source of truth.
3. **`riley-config.ts` mission row stubs.** The static subtitle for B.1 — should it be the full Alex-style "Optimizing Meta Ads for {org displayName}" or a simpler "Riley · Ad optimizer" until B.2's popover lands? Cosmetic; decide at plan time.
4. **`useRileyStatus` polling cadence.** Default to `useNow(60_000)` (1-minute resolution) per Alex A.1's pattern; verify at plan time.

---

## What comes after Wave A

- **Wave B — Riley agent-infra parity** (sibling spec `2026-05-14-riley-agent-infra-parity-design.md`). Doctrine workstream: WorkTrace mirror, PlatformIngress route, ExecutableWorkUnit materialization, outcome attribution, learning memory, governance hook unification, unified approval lifecycle. Slicing is a future brainstorm, not in this spec.
- **Operator-visible per-row signal-health dismissal.** Future affordance; depends on either Wave A polish bandwidth or Wave B unified-lifecycle work.
- **`REVIEWING` state wiring.** Either a B.2 micro-slice (if cheap) or post-launch.
