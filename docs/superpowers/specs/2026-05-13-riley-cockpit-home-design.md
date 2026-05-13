# Riley Cockpit Home — Design Spec

**Date:** 2026-05-13
**Status:** Spec — ready for implementation plan
**Design source:** Claude Design bundle `agent-home-v3/Riley Home v2.html` (handoff URL: `tGetKbcep-UWOCK_zJGtcw`)
**Sibling spec:** Alex cockpit shell (architecture described inline below; not yet captured as its own spec)

---

## Summary

Riley's agent-home page becomes the **ad-optimizer cockpit** — a one-column dashboard surfacing live ad performance, a ROAS bar, an approval queue for `pause / reduce_budget / scale / rotate_creative / shift_budget_to_source` recommendations, and a vertical activity stream. It is the **sibling** of Alex's cockpit: identical shell, identical layout, identical type ramp; only data, copy, and accent color differ.

The page replaces today's `EditorialAuthShell + AgentHomeClient` for `agentKey === "riley"` once the cockpit shell ships. Pre-existing data (`metrics-riley.ts`, `pipeline-riley.ts`, recommendations system) feeds Riley-specific view models with minimal new backend.

## Riley capability inventory (what the cockpit must surface)

This section is the **authoritative inventory** of what Riley does in the codebase as of 2026-05-13. The cockpit's job is to surface this work to operators — every capability below maps to at least one cockpit element (KPI tile, approval card, activity row, or mission row).

### Recommendation actions Riley emits

From `packages/ad-optimizer/src/recommendation-engine.ts`. All flow through the same `Recommendation` table with `intent = "recommendation.<action>"`.

| Action                     | Trigger                                                      | Urgency       | Confidence | Reversible | Learning-phase | Cockpit treatment                               |
|----------------------------|--------------------------------------------------------------|---------------|------------|------------|----------------|-------------------------------------------------|
| `add_creative`             | CPA > 2× target, daily, ≥7 days                              | this_week     | 0.80       | yes        | resets         | Approval card (campaign-level)                  |
| `pause`                    | CPA > 3× target, daily, ≥7 days                              | immediate     | 0.90       | yes        | no impact      | Approval card · sort top                        |
| `review_budget`            | CPA > 2× target, weekly snapshot                             | this_week     | 0.65       | n/a        | no impact      | Approval card · "Review" framing (no action)    |
| `scale`                    | CPA < 0.8× target, no breach, no diagnoses                   | this_week     | 0.70       | yes        | no impact      | Approval card · positive framing                |
| `refresh_creative`         | `creative_fatigue` OR `audience_saturation` diagnosis        | this_week     | 0.70–0.85  | yes        | resets         | Approval card · triggers Mira PCD               |
| `restructure`              | `audience_saturation` diagnosis                              | next_cycle    | 0.65       | no         | resets         | Approval card · "Expand targeting" framing      |
| `shift_budget_to_source`   | Source comparison: one source ≥ 2× trueROAS of another       | this_week     | 0.60       | partial    | no impact      | Approval card · two-source visual               |
| `switch_optimization_event`| `ctwa_drive_by_clickers` diagnosis (CTWA campaigns only)     | this_week     | 0.75       | yes        | resets         | Approval card · "Switch event" framing          |
| `harden_capi_attribution`  | `capiAttributionStale` flag (no Schedule events in 7+ days)  | this_week     | 0.70       | n/a        | no impact      | Approval card · plumbing fix                    |
| `hold`                     | `landing_page_drop` diagnosis                                | this_week     | 0.75       | n/a        | no impact      | Approval card · advisory only                   |
| `fix_signal_health`        | Pixel / CAPI / dedup / freshness breach (4 sub-kinds)        | immediate or this_week | 0.75–0.90 | n/a   | no impact      | **Account-level card** — see §Signal-health    |

Notes:

- The Claude Design mockup uses `rotate_creative` as a label; the engine emits `refresh_creative`. Production must use `refresh_creative` as the intent and persist `presentation.primaryLabel = "Refresh creative"` (or whatever copy the engine writes). The cockpit displays `presentation.primaryLabel` verbatim — no hard-coded "Rotate" string.
- `review_budget` is a **review signal**, not an executable action. Its `presentation.primaryLabel` is "Review in Ads Manager" (open external) — no internal mutation. The cockpit renders it as an approval card with an "Open Meta Ads →" primary action and a "Dismiss" secondary.
- Reversibility (`pause`, `reduce_budget`) drives an "Undo within 1h" affordance on the toast that appears after Approve. Implemented per the existing `actOnRecommendation` undo flow.

### Diagnoses Riley produces (drive recommendation generation)

From `packages/ad-optimizer/src/metric-diagnostician.ts` and `funnel-detector.ts`:

| Diagnosis pattern            | Meaning                                          | Surfaces as                       |
|------------------------------|--------------------------------------------------|------------------------------------|
| `creative_fatigue`           | CTR declining over fresh-creative window         | `refresh_creative` rec            |
| `audience_saturation`        | Frequency rising, CTR/CPM trending wrong         | `refresh_creative` or `restructure` rec |
| `landing_page_drop`          | Click→lead conversion dropped                    | `hold` rec                        |
| `ctwa_drive_by_clickers`     | High click volume, low chat depth (CTWA)         | `switch_optimization_event` rec   |

Diagnoses themselves are NOT directly surfaced in the cockpit — they're upstream of recommendations. The approval card's `humanSummary` quotes the diagnosis evidence ("CTR down 38% over 5 days; same creative live 14 days") rather than naming the diagnosis pattern.

### Signal-health breaches (account-level)

From `packages/ad-optimizer/src/signal-health-checker.ts`:

| Breach signal            | Severity (critical/warning) | Estimated impact (copy)                                                  |
|--------------------------|-----------------------------|--------------------------------------------------------------------------|
| `pixel_dead`             | critical                    | Pixel is dead — Meta cannot deliver or measure ads without signal        |
| `server_to_browser_low`  | warning                     | Server-to-browser ratio is below target — missing CAPI signal            |
| `dedup_low`              | warning                     | Browser and CAPI events are not deduplicating — double-counting          |
| `freshness_stale`        | warning                     | CAPI server events are stale — Meta's optimizer cannot react             |
| `da_check_failed`        | n/a (no remediation)        | Suppressed — no recommendation emitted                                   |

These recs use `SIGNAL_HEALTH_CAMPAIGN_ID_PREFIX = "signal:"` on the `campaignId` field. The cockpit **groups all signal-health recs into a single account-level approval card** instead of one per breach — see §Signal-health card.

### Data-plane capabilities (backend, not directly cockpit-visible)

Documented so the cockpit doesn't accidentally re-surface them as features:

| Capability                       | File / module                                | Cockpit relevance                         |
|----------------------------------|----------------------------------------------|--------------------------------------------|
| Meta CTWA lead ingestion         | `meta-leads-ingester`                        | Drives `leads` KPI tile                    |
| Daily campaign insights pull     | `meta-campaign-insights-provider`            | Drives `spend` / `CPL` KPI tiles + recs    |
| Daily report insights pull       | `meta-report-insights-provider`              | Weekly trend evidence in `humanSummary`    |
| CAPI conversion dispatch         | `meta-capi-dispatcher` / `meta-capi-client`  | Health monitored via signal-health recs    |
| Google offline conversion dispatch | `google-offline-dispatcher`                | Multi-platform support (post-launch)       |
| CRM data ingestion               | `crm-data-provider`                          | Powers **true ROAS** (CRM closed-won vs Meta-reported) |
| Source attribution comparison    | `analyzers/source-comparator`                | Drives `shift_budget_to_source` recs       |
| Spend attribution                | `analyzers/spend-attributor`                 | Pre-condition for source-shift recs        |
| Period comparison                | `period-comparator`                          | Powers KPI tile deltas (week-over-week)    |
| Learning-phase guard             | `learning-phase-guard`                       | Blocks dangerous recs during FB learning   |
| Trend engine                     | `trend-engine`                               | Multi-period regression signals            |
| Saturation detector              | `saturation-detector`                        | Emits `audience_saturation` diagnosis      |
| Funnel detector / analyzer       | `funnel-detector` / `funnel-analyzer`        | Emits `landing_page_drop`, `ctwa_drive_by_clickers` |
| Daily audit run                  | `audit-runner`                               | The 7am UTC cron that produces all of the above |
| Recommendation sink              | `recommendation-sink`                        | Persists recs into the `Recommendation` table |

The cockpit reads from the **persisted Recommendation table only** — it never re-runs analyzers or talks to Meta directly. This is the contract.

### True ROAS vs reported ROAS

Riley distinguishes two ROAS values:

- **Reported ROAS** — Meta's claimed return, computed from `purchase_value / spend` in Meta insights.
- **True ROAS** — CRM-confirmed closed-won revenue / spend. This is the number the operator cares about.

The cockpit's ROI bar uses **true ROAS when CRM data is connected**, otherwise reported ROAS. The mission popover should disclose which mode is active (`Targets · target CPL $25 · ROAS from CRM` or `… · ROAS from Meta`). The KPI tile's source is the same.

For v1, default to reported ROAS (most orgs won't have CRM wired). The CRM-connected variant is a polish ramp.

### Riley's autonomy posture (v1)

**Advisory only.** Every action Riley takes flows through operator approval. The cockpit has no autonomous-execution toggle in v1. This is deliberate: Riley emits recs, operator approves, executor (downstream of approval) calls Meta. Drift from this posture is a doctrine change, not a cockpit feature.

The mission popover should reflect this explicitly: `ROLE: Ad optimizer · score, recommend, never act without your approval`.

---

## Scope

In scope:

- Riley-specific data plumbing into the shared cockpit shell (KPI tiles, ROI bar, approval cards, activity rows, mission popover, status pill).
- Backend additions Riley needs: per-org `avgValueCents` + `targetCpbCents` storage on `AgentRoster`, `/api/dashboard/agents/[agentId]/mission` aggregator response, extension of `/api/dashboard/agents/[agentId]/metrics` with target/value fields.
- Status pill vocabulary extension: add `WATCHING` and `REVIEWING` to the shared `CockpitStatus` union.
- Activity-row translator rules for Riley's intents.

Out of scope:

- The cockpit shell itself (`CockpitAuthShell`, `topbar`, `identity`, `kpi-strip`, `roi-bar`, `approval-block`, `activity-stream`, `status-pill`, `dot`, `mission-popover`, `tokens`). These are stated **dependencies** on the Alex cockpit shell workstream. The Alex cockpit Claude Design lives at `agent-home-v3/Alex Home v2.html` in the same bundle.
- Mira (creative) cockpit data — Mira is launch+30; tab is rendered muted only.
- Multi-platform ad sources (Google Ads, TikTok). Riley v1 is Meta Ads only.
- Riley's own NL composer parsing rules. The composer is part of the shared shell; Riley contributes a `composerPlaceholder` string and command catalog only.
- Mobile-specific affordances beyond what the shell already provides.

## Source-of-truth files (Claude Design)

The implementation must match the design files in the bundle. Component boundaries are already drawn:

| Shell component (in `cockpit.jsx`) | Riley input        | Spec section |
|------------------------------------|--------------------|--------------|
| `Topbar`                           | tabs from `AGENT.tabs` | §Identity |
| `Identity` / `MissionPopover`      | `AGENT.mission`        | §Identity |
| `KPIStrip` / `KPI` / `ROIBar`      | `STATES[k].kpis` (`tiles[]`, `roi`) | §KPIs, §ROI |
| `ApprovalBlock` / `ApprovalCard`   | `STATES[k].approval[]` (array) | §Approvals |
| `ActivityStream` / `ActivityRow`   | `STATES[k].activity[]` | §Activity |
| `Composer` / `Toast`               | `AGENT.composerPlaceholder`, `AGENT.toastVoice` | §Composer |

`riley-config.jsx` and `riley-data.jsx` are the **canonical reference** for Riley's data shape. Production code must produce data conforming to those shapes (renamed where helpful for TypeScript clarity, but structurally identical).

## Visual tokens

From `riley-config.jsx`:

```ts
RILEY_ACCENT = {
  base:  "#B86C50", // warm clay   hsl(15 45% 50%)
  deep:  "#7E4533",
  soft:  "#ECD4C8",
  paper: "#F6E7DE",
};
```

Shared with Alex (in `cockpit.jsx`):

```ts
T = {
  bg: "#FAF8F2",
  paper: "#FFFFFF",
  ink: "#0E0C0A", ink2: "#3A332B", ink3: "#6B6052", ink4: "#A39786", ink5: "#C8BEAE",
  hair: "rgba(14,12,10,0.08)", hairSoft: "rgba(14,12,10,0.04)",
  amber: "#B8782E", amberDeep: "#7C4F1C", amberSoft: "#F1E2C2", amberPaper: "#FBF1D6",
  green: "#3F7A36", red: "#A03A2E", blue: "#3A5A80",
};
```

Riley's accent is applied to: avatar frame, ROI bar fill, campaign source dot on approval cards, sender label color on activity rows. Everywhere else (amber for approvals, green for positive trend, red for halt/risk) is shared.

## Identity row + mission popover

```
[avatar warm clay] Riley  [● WATCHING]
                  Optimizing Meta Ads for {org displayName}  (clickable)
```

Status pill states (full set Riley uses):

| Status     | Color           | Pulses | When |
|------------|-----------------|--------|------|
| `WATCHING` | green `#3F7A36` | no     | Connected, no pending review, no pending approval. Steady state. |
| `REVIEWING`| amber `#B8782E` | yes    | A recommendation was emitted in the last 60s and is still being scored. Transient. |
| `WAITING`  | amber `#B8782E` | no     | One or more recommendations with `status = "pending"`. |
| `IDLE`     | grey `#A39786`  | no     | No Meta Ads `Connection` row, or no active campaigns. |
| `HALTED`   | red `#A03A2E`   | no     | Operator HaltProvider active. |

Status derivation runs client-side in `use-derived-status.ts`:

```ts
function deriveRileyStatus(input: {
  halted: boolean;
  pendingApprovals: number;
  recentDecisionAt: Date | null;   // most recent recommendation emit
  scoringRunActiveAt: Date | null; // last `system.scoring_run_in_progress` ping (Inngest)
  hasActiveCampaign: boolean;
  now: Date;
}): CockpitStatus {
  if (input.halted) return "HALTED";
  if (!input.hasActiveCampaign) return "IDLE";
  if (input.pendingApprovals > 0) return "WAITING";
  if (input.scoringRunActiveAt && input.now.getTime() - input.scoringRunActiveAt.getTime() < 5 * 60_000) {
    return "REVIEWING";
  }
  if (input.recentDecisionAt && input.now.getTime() - input.recentDecisionAt.getTime() < 60_000) {
    return "REVIEWING";
  }
  return "WATCHING";
}
```

**Scoring cadence.** Riley runs a daily audit at **07:00 UTC** (`packages/ad-optimizer/src/inngest-functions.ts`, the `audit-runner` cron). REVIEWING surfaces during this window plus any ad-hoc re-scoring trigger. Outside the window, REVIEWING is rare — most page loads will see WATCHING or WAITING.

Mission popover rows (data only; same component as Alex):

| Eyebrow    | Value                                                  |
|------------|--------------------------------------------------------|
| `ROLE`     | `Ad optimizer · score, recommend, never act without your approval` |
| `PIPELINE` | `Ad sets · all campaigns · scored daily 07:00 UTC`     |
| `BRAND`    | `{org.displayName} · {org.tagline ?? "—"}`             |
| `CHANNELS` | `Meta Ads` with status dot (`ok` / `degraded` / `disconnected` derived from `Connection.status`); if Google Ads is connected, second pill |
| `TARGETS`  | `target CPL ${targetCpb} · avg lead value ${avgValue} · ROAS from {CRM,Meta}` |

`mission.rows[3]` is the first row in the system to carry a connection-state dot — the shell already supports a third element on the row tuple (`["CHANNELS", "Meta Ads", "ok"]`).

The TARGETS row is new — Alex's mission popover has 4 rows; Riley adds a 5th to disclose targets and ROAS provenance. The shell supports variable-length `mission.rows`. If no `crm-data-provider` `Connection` exists, ROAS source reads `Meta` and the row gets a subtle "Connect CRM for true ROAS" affordance.

## KPI strip

Four tiles (in order): **leads · spend · CPL · ROAS**.

Tile schema:

```ts
type KpiTile = {
  label: string;
  value: number | string; // "—" for unavailable
  unit?: string;          // "%", "×", etc.
  trend?: string;         // "+9 vs last", "−$3 vs last"
  unavailable?: boolean;
  hint?: string;          // "Connect Meta Ads" / "Set avg lead value"
};
```

### Cold state (Meta not connected)

All four tiles render `unavailable: true` with `value: "—"` and a dashed-underline CTA. Leads/spend/CPL share hint `"Connect Meta Ads"`; ROAS uses `"Set avg lead value"`.

### Steady state (live)

```ts
tiles = [
  { label: "leads", value: 47,      trend: "+9 vs last" },
  { label: "spend", value: "$684" },
  { label: "CPL",   value: "$28",   trend: "−$3 vs last" },  // unit "" intentionally
  { label: "ROAS",  value: 1.6,     unit: "×", trend: "+0.2 vs last" },
];
```

Range eyebrow: `This week · {weekStartShort} — {weekEndShort}` (formatted in `metrics-riley.ts`).

### Backend mapping

| Tile  | Source                                                                 | Currently live? |
|-------|------------------------------------------------------------------------|-----------------|
| leads | `metrics-riley.buildRileyMetricsViewModel().hero.value`                | yes             |
| spend | Sum of `spend_micros` over week from `meta-campaign-insights-provider`  | no — flagged `unavailableSources: ["ad-platform-spend"]` |
| CPL   | Derived: `spend / leads` (or `cpa` from insights)                      | no              |
| ROAS  | Derived: `(leads × avgValueCents) / spend`                             | no              |

Spend, CPL, ROAS becoming live requires:

1. **Meta Ads `Connection` exists** for the org (already supported).
2. `meta-campaign-insights-provider` daily run populates spend/cpa per campaign (`recommendation-engine.ts` already takes these as inputs — provider exists; needs wiring into the metrics path).
3. ROAS additionally requires `AgentRoster.avgValueCents` to be set (new field — see §Migration).

`metrics-riley.ts` is the single boundary: it returns `tiles[]` shaped above. The cockpit doesn't compute anything itself.

## ROI bar

Layout (shell-provided):

```
[● return on ad spend] $684 spent ─────[━━━━━━━━━━●━━━━━━━━━━━]──── $1,094 in lead value
                       0×                 1× break-even                              4× spend

                                                          CPL $28  vs  target $25
```

Schema:

```ts
type RoiBar =
  | { degraded: true; degradedHint: string; comparator: { value: string; target: string; onTarget?: false } }
  | {
      label: string;             // "return on ad spend"
      leftMeta: string;          // "$684 spent"
      rightMeta: { value: string; suffix: string };
      fillPct: number;           // 0..100
      breakEvenPct: number;
      breakEvenLabel: string;    // "1× break-even"
      scaleLeft: string;         // "0×"
      scaleRight: string;        // "4× spend"
      comparator: { value: string; target: string; onTarget: boolean };
    };
```

### Math

- Track scale: 0× to 4× ROAS (Riley); Alex uses 0× to 6× spend. The shell already handles both via explicit `fillPct` / `scaleLeft` / `scaleRight`.
- `fillPct = (roas / 4) * 100`, capped at 100.
- `breakEvenPct = (1 / 4) * 100 = 25`.
- `comparator.value = "CPL $" + cpl`, `comparator.target = "target $" + targetCpb`.
- `comparator.onTarget = cpl <= targetCpb` — flips comparator pill green.

### Degraded path

When `avgValueCents` is null OR `spend` is unavailable, render the degraded form: dashed top border, single comparator pill centered, hint copy `"Connect Meta Ads to see ROAS"` or `"Set average lead value to see ROAS"`. No bar track.

## Approval block

`ApprovalBlock` takes an **array** of approvals (`approval[]`); the card stack already renders. Alex passes a single-element array; Riley passes 0..N. The cockpit's `data.approval` field becomes `ApprovalView[] | null`.

```ts
type ApprovalView = {
  id: string;                       // Recommendation.id (or synthesized "signal:<pixelId>" for grouped)
  kind: RileyActionKind;            // "pause" | "scale" | "refresh_creative" | ... | "signal_health_group"
  urgency: "immediate" | "this_week" | "next_cycle";
  askedAt: string;                  // "7 min ago" (formatted in view-model via relative-age util)
  title: string;                    // Card eyebrow, e.g. "Pause adset"
  campaign:
    | { kind: "campaign"; name: string; id: string }
    | { kind: "account";  pixelId: string; breaches: number }; // signal-health group
  quote: string;                    // The persisted `humanSummary` (or bulleted list for signal-health group)
  risk?: string;                    // "$680 at risk" (negative recs) / "Upside: ~6 extra leads/wk" (scale recs) — derived
  confidence: number;               // 0.0–1.0; surfaced as a subtle dot indicator
  learningPhaseImpact: "no impact" | "will reset learning";
  reversible: boolean;              // pause + reduce_budget = true; others false
  primary: string;                  // RecommendationInput.presentation.primaryLabel
  secondary: string;                // RecommendationInput.presentation.dismissLabel
  presentation: { primaryLabel: string; dismissLabel: string };
  primaryAction:
    | { kind: "internal";  intent: string; parameters: Record<string, unknown> }
    | { kind: "external";  url: string; service: "meta" | "google" }; // review_budget / fix_signal_health / harden_capi_attribution
  acceptToast: string;
  declineToast: string;
};
```

### Card variants (one per action)

Every recommendation action gets a card variant. The shell renders all 11 from the same `ApprovalCard` component — the difference is data, not layout. Visual identity comes from the `eyebrow` color (urgency-driven) and the `kindIcon` (action-driven).

| Action                       | Eyebrow / urgency        | Title                    | Quote source (`humanSummary`)                                         | Primary CTA                  |
|------------------------------|--------------------------|--------------------------|-----------------------------------------------------------------------|------------------------------|
| `pause`                      | **IMMEDIATE** (red)      | Pause adset              | "Campaign is critically over target CPA — pause to stop financial loss" | Pause adset                  |
| `review_budget`              | THIS WEEK (amber)        | Review budget            | "Campaign appears above target CPA (Nx)…"                              | Open in Ads Manager (external) |
| `scale`                      | THIS WEEK (green)        | Scale +$N/day            | "Campaign is performing well under target CPA — scale by up to 20%"   | Scale +N%                    |
| `refresh_creative`           | THIS WEEK (amber)        | Refresh creative         | "Fatigued creatives are reducing engagement — new creative will restore performance" | Refresh creative (queues Mira) |
| `restructure`                | NEXT CYCLE (ink3)        | Expand targeting         | "Audience is saturated — expanding targeting will find new reach"     | Create expanded ad set       |
| `shift_budget_to_source`     | THIS WEEK (blue)         | Shift budget             | "{to} trueRoas is Nx {from} — consider shifting budget"               | Shift to {to}                |
| `switch_optimization_event`  | THIS WEEK (amber)        | Switch event             | "Optimizing on chat starts is attracting low-intent clickers — switch to a deeper event" | Switch to Schedule           |
| `harden_capi_attribution`    | THIS WEEK (red)          | Fix CAPI                 | "No CAPI Schedule events received in 7+ days — Meta cannot optimize without signal" | Open CAPI settings           |
| `hold`                       | THIS WEEK (amber)        | Hold spend               | "Landing page issues are driving up costs — fix before increasing spend" | Hold budget changes          |
| `add_creative`               | THIS WEEK (amber)        | Add creative + reduce    | "CPA significantly above target — add fresh creatives and reduce budget" | Approve plan                 |
| `fix_signal_health` (group)  | **IMMEDIATE** (red) or THIS WEEK | Fix tracking signal | One row per breach: pixel_dead / server_to_browser_low / dedup_low / freshness_stale | Open Events Manager (external) |

### Sort order

Cards stack with `urgency = "immediate"` first, then `this_week`, then `next_cycle`. Within an urgency band, sort by `dollarsAtRisk` descending. The shell's `ApprovalBlock` already iterates an array — the view-model performs the sort once before rendering.

### Learning-phase warning

Recs with `learningPhaseImpact: "will reset learning"` carry a subtle footer line on the card: `⚠ Approving will reset Meta's learning phase (~3–5 days re-learning).` Recs with `learningPhaseImpact: "no impact"` show no footer. This data is on the persisted `RecommendationOutput` already.

### Signal-health card (account-level grouping)

Recommendations with `campaignId` matching `^signal:` are **not** per-campaign — they're per-pixel. The cockpit groups all signal-health recs for the same pixel into one card:

```
┌─ SIGNAL HEALTH · IMMEDIATE ────────────────────────────┐
│  Pixel 1234567890 · 3 breaches                         │
│                                                         │
│  • Pixel is dead — check website installation          │
│  • Server-to-browser ratio is below target             │
│  • CAPI server events are stale                        │
│                                                         │
│  [Open Events Manager →]   [Dismiss all]               │
└─────────────────────────────────────────────────────────┘
```

The view-model's responsibility: collapse `Recommendation` rows where `campaignId.startsWith("signal:")` into one synthesized `ApprovalView` whose `quote` lists each breach as a bullet. Dismiss-all calls `actOnRecommendation` for each row in the group.

### Riley card examples (mirroring `riley-data.jsx`)

The original mockup shows the three highest-frequency action variants:

1. **Pause adset** — _Spring Sale — Awareness_ — `"CPL $42 vs $25 target for 3 days. Spend $680 at risk this week."` — `[Pause adset] [Decline]`
2. **Refresh creative** — _Retargeting — Hot_ — `"CTR down 38% over 5 days; same creative live 14 days. Three fresh variants ready in your library."` — `[Refresh creative] [Decline]` (mockup label says "Rotate"; production uses engine label "Refresh")
3. **Scale budget** — _Lookalike 1%_ — `"ROAS 3.2× sustained for 7 days; running under your daily cap. Suggest +$40/day."` — `[Scale +$40/day] [Decline]`

### Source mapping

The Riley `Recommendation` table already persists exactly the fields the cockpit needs:

- `humanSummary` → `quote`
- `presentation.primaryLabel` / `presentation.dismissLabel` → `primary` / `secondary` and the `presentation` echo
- `dollarsAtRisk` → `risk` (`$X at risk` for negative-action recs; for `scale` recs, the engine should populate a positive-framing risk note like `"Upside: ~6 extra leads/wk"` — out of scope for v1 if not yet emitted; fallback shows blank)
- `targetEntities.campaignName` → `campaign.name`
- `createdAt` → `askedAt` (rendered via `relativeAge` util that already exists in `packages/core/src/agent-home/relative-age.ts`)

### Action wiring

Primary tap → `POST /api/dashboard/recommendations/:id/act { action: "primary" }` (uses existing `actOnRecommendation` flow). Secondary tap → `{ action: "dismiss" }`. Optimistic UI hides the card on tap; toast appears from `presentation.acceptToast` / `presentation.declineToast` (these are NOT in the persisted `RecommendationPresentationSchema` today — see §Schema extensions).

### Empty / cold-state behavior

When `approval[]` is empty, the block is omitted entirely. When `IDLE`, no block at all.

## Activity stream

The translator (`apps/dashboard/src/hooks/use-agent-activity.ts`, existing) emits rows of shape:

```ts
type ActivityRow = {
  time: string;       // "11:58", "Fri", "—" for cold state
  kind: ActivityKind; // see table below
  head: string;
  body: string;
  who?: string;
  preview?: ThreadMessage[]; // not used by Riley
  tag?: string;
};
```

### Riley activity kinds

| Kind           | Label          | Color       | Pulses |
|----------------|----------------|-------------|--------|
| `watching`     | `WATCHING`     | green       | no     |
| `reviewing`    | `REVIEWING`    | amberDeep   | yes    |
| `paused`       | `PAUSED`       | ink3        | no     |
| `scaled`       | `SCALED`       | green       | no     |
| `rotated`      | `ROTATED`      | blue        | no     |
| `shifted`      | `SHIFTED`      | blue        | no     |
| `restructured` | `RESTRUCTURED` | blue        | no     |
| `started`      | `STARTED`      | ink3        | no     |
| `alert`        | `ALERT`        | red         | no     |

These kinds are defined once in the shell's `KIND_META` table (already present in `cockpit.jsx`). Adding Riley kinds expands the table by 9 entries; Alex kinds remain unaffected.

### Translator rules

The existing `use-agent-activity` translator's per-agent branch grows Riley intent → row mappings. **Source `head` and `body` from `humanSummary` + `parameters` on the persisted recommendation** rather than reinventing copy — keeps the shell agnostic to ad-platform vocabulary.

| Recommendation intent / decision intent       | Status pending (`status: pending`) | Status acted (`status: acted`) |
|------------------------------------------------|------------------------------------|---------------------------------|
| `recommendation.pause`                         | WAITING                            | PAUSED                          |
| `recommendation.reduce_budget`                 | WAITING                            | SCALED (down)                   |
| `recommendation.scale`                         | WAITING                            | SCALED (up)                     |
| `recommendation.refresh_creative`              | WAITING                            | ROTATED                         |
| `recommendation.restructure`                   | WAITING                            | RESTRUCTURED                    |
| `recommendation.shift_budget_to_source`        | WAITING                            | SHIFTED                         |
| `recommendation.review_budget`                 | WAITING                            | (terminal via dismiss/confirm)  |
| `recommendation.add_creative`                  | WAITING                            | ROTATED                         |
| `recommendation.switch_optimization_event`     | WAITING                            | RESTRUCTURED                    |
| `recommendation.harden_capi_attribution`       | WAITING                            | (terminal via external action)  |
| `recommendation.hold`                          | WAITING                            | PAUSED                          |
| `recommendation.fix_signal_health`             | ALERT (collapsed into one row)     | (terminal via external action)  |
| `signal.connection_health_degraded`            | —                                  | ALERT                           |
| `signal.capi_attribution_stale`                | —                                  | ALERT                           |
| `signal.learning_phase_active`                 | —                                  | STARTED ("learning, 3–5 days")  |
| `signal.crm_data_disconnected`                 | —                                  | ALERT (degrades ROAS to reported) |
| `system.scoring_run_in_progress`               | REVIEWING                          | —                               |
| `system.daily_scan_started`                    | —                                  | STARTED                         |
| `system.daily_scan_completed`                  | —                                  | STARTED                         |

Note: there's existing intent-vocabulary drift in the codebase — `pipeline-riley.ts` uses `recommendation.pause_adset` while `packages/schemas/src/recommendations.ts` shows `recommendation.ad_set_pause` as a test fixture, and `recommendation-engine.ts` emits action-name primitives (`pause`, `scale`, ...). The translator must accept the union of all three vocabularies; vocabulary alignment is tracked separately (out of scope here).

### Cold-state rows

When no `Connection` exists, the translator emits synthetic onboarding rows (no DB write):

```ts
[
  { time: "—", kind: "alert",   head: "Connect Meta Ads to begin",      body: "..." },
  { time: "—", kind: "alert",   head: "Set average lead value",         body: "..." },
  { time: "—", kind: "started", head: "Standing rules loaded",          body: "..." },
]
```

### Filters

Steady state: `["all", "approvals", "changes"]`. Cold state: `["all"]` only. Filter state is shell-managed (per Alex's pattern).

## Composer

The shell-provided composer is parameterized by `AGENT.composerPlaceholder` and a `COMMANDS[]` catalog reachable via ⌘K. Riley contributes:

```ts
RILEY_COMPOSER_PLACEHOLDER =
  `Tell Riley what to do — "pause the Cold Interests adset", "raise daily budget to $200"…`;

RILEY_COMMANDS = [
  { id: "pause-spring",  label: "Pause Spring Sale ad sets",       group: "control" },
  { id: "pause-1h",      label: "Pause Riley for 1 hour",          group: "control" },
  { id: "resume",        label: "Resume Riley",                    group: "control" },
  { id: "brief-eod",     label: "Brief me at end of day",          group: "control" },
  { id: "scale-lal",     label: "Scale Lookalike 1% by $40/day",   group: "thread" },
  { id: "rotate-retar",  label: "Rotate Retargeting creative",     group: "thread" },
  { id: "cpl-30",        label: "Raise target CPL to $30",         group: "rules" },
  { id: "no-scale",      label: "Stop auto-scaling ad sets",       group: "rules" },
  { id: "open-meta",     label: "Open Meta Ads campaigns",         group: "nav" },
  { id: "open-rules",    label: "Open standing rules",             group: "nav" },
  { id: "open-targets",  label: "Open targets · CPL · lead value", group: "nav" },
];
```

Toast voice (per-action):

```ts
function rileyToast(action) {
  switch (action.kind) {
    case "pause":   return `Paused — ${action.detail}.`;
    case "resume":  return `Back on. Resuming the scan.`;
    case "halt":    return `Halted. No changes will be made until you resume.`;
    case "rule":    return `Rule updated — ${action.detail}.`;
    case "brief":   return `I'll brief you ${action.detail}.`;
    case "command": return `On it — ${action.label.toLowerCase()}.`;
    default:        return `Got it. Acting on "${action.detail || action.label}".`;
  }
}
```

NL-parsing rules for the composer are part of the shared shell; Riley exposes its command vocabulary only.

## Backend changes

### 1. Persistence: `AgentRoster` target fields

Add two nullable Int columns (cents):

```prisma
model AgentRoster {
  // ... existing fields
  avgValueCents   Int?
  targetCpbCents  Int?
}
```

These are **per-agent, per-org** and serve both Alex (cost-per-booking, avg booking value) and Riley (target CPL, avg lead value). Same columns, different semantics per `agentRole`. The architecture description in the original prompt called these `avgValueCents` + `targetCpbCents` on `AgentRosterEntry`; the actual model name is `AgentRoster`. Storing on `AgentRoster.config` (JSON) is the alternate path — pick one in the plan.

### 2. API: mission aggregator

`GET /api/dashboard/agents/[agentId]/mission` returns:

```ts
{
  agentKey: AgentKey;
  displayName: string;        // AgentRoster.displayName
  mission: {
    role: string;             // hardcoded per agentRole, e.g. "Ad optimizer · score, pause, scale, rotate"
    pipeline: string;         // e.g. "Ad sets · all campaigns"
    brand: string;            // org.displayName + tagline
    channels: Array<{ kind: "meta-ads" | "whatsapp" | "telegram" | ...; label: string; status: "ok" | "degraded" | "disconnected" }>;
  };
  composerPlaceholder: string;
  commands: Command[];
  targets: {
    avgValueCents: number | null;
    targetCpbCents: number | null;
    roasSource: "crm" | "meta"; // crm when crm-data-provider Connection exists, else meta
  };
  scoringCron: { hourUtc: number; description: string }; // { hourUtc: 7, description: "Scored daily at 07:00 UTC" } for Riley
}
```

One aggregator, agent-key-aware. Channels source depends on agent: Riley reads `Connection` rows (Meta Ads); Alex reads `ManagedChannel` rows (WhatsApp/Telegram/Slack). The aggregator owns this branching so the dashboard hook is uniform.

### 3. API: metrics extension

`GET /api/dashboard/agents/[agentId]/metrics` already returns `MetricsViewModel`. Extend to include:

```ts
{
  ...existing,
  targets: { avgValueCents: number | null; targetCpbCents: number | null };
  tiles: KpiTile[];      // NEW: 4-tile shape per §KPIs
  roi: RoiBar;           // NEW: explicit ROI shape per §ROI bar
}
```

Riley's branch in `buildRileyMetricsViewModel` produces `tiles` + `roi`. Alex's branch keeps emitting today's flat schema; the dashboard's `legacyTiles` / `legacyRoi` adapters (already present in `cockpit.jsx` design source) handle the conversion.

### 4. Schema: `RecommendationPresentation` toast fields

Today's `RecommendationPresentationSchema` carries `primaryLabel`, `secondaryLabel`, `dismissLabel`, `dataLines`. Add optional:

```ts
acceptToast: z.string().optional();
declineToast: z.string().optional();
```

These are first-person toast lines emitted by the recommendation engine (`recommendation-engine.ts` already has the context to write them). If absent, the cockpit falls back to the agent's generic `toastVoice` defaults.

### 5. No new DB tables for Riley's activity stream

The activity stream is derived from existing tables: `Recommendation` rows (pending + acted), `AuditEntry` rows (executed actions), and `Connection.status` changes. The translator does the read.

## Dependencies

Riley Home depends on the **Alex cockpit shell** being built in production. Shell components Riley does not own:

- `apps/dashboard/src/components/cockpit/` — `topbar.tsx`, `identity.tsx`, `mission-popover.tsx`, `kpi-strip.tsx`, `roi-bar.tsx`, `approval-block.tsx`, `activity-stream.tsx`, `status-pill.tsx`, `dot.tsx`, `tokens.ts`
- `apps/dashboard/src/components/layout/cockpit-auth-shell.tsx`
- `apps/dashboard/src/app/(auth)/[agentKey]/cockpit-client.tsx`
- `apps/dashboard/src/hooks/use-agent-mission.ts`
- `apps/dashboard/src/hooks/use-derived-status.ts` (Riley + Alex branches both land in the same hook)
- `apps/dashboard/src/lib/cockpit/types.ts` — `CockpitStatus`, `MissionViewModel`, `KpiTile`, `RoiBar`, `ApprovalView`, `ActivityRow`

Three implementation paths (resolve in the plan):

**Path A — Shell-first (recommended).** Land the shell with Alex's data wiring in PR-1. Land Riley's data wiring on top in PR-2. Clean separation; both agents validate the same shell.

**Path B — Riley + shell together.** One large PR. Higher risk, no benefit unless Alex shipping is blocked.

**Path C — Riley standalone now, refactor later.** A Riley-only page that bypasses the shared shell, gets rewritten when the shell ships. Throws away ~2–3 days of work. Only justified if Riley Home must ship before Alex shell can be built.

Recommendation is **Path A**, with this Riley spec frozen first so Alex shell PRs can be shaped to satisfy it.

## Out-of-scope deferrals (call-outs)

- **Multi-platform channel rows.** `mission.channels` is typed as an array but Riley v1 emits only Meta Ads.
- **Per-platform breakdown UI** (Google Ads, TikTok). Post-launch.
- **Creative thumbnails on approval cards.** Adds image plumbing; defer.
- **Bulk approve/decline.** Single-card actions only.
- **Autonomous-execution toggle** ("let Riley pause without asking"). Riley is advisory-only for v1.
- **REVIEWING window tuning.** 60s is a guess; revisit once we observe how often it actually surfaces.

## Acceptance criteria

1. Visiting `/riley` (logged in, with `riley` enabled) renders the cockpit shell parameterized by Riley's config: clay accent, Riley tab active, status pill in one of `WATCHING / REVIEWING / WAITING / IDLE / HALTED`.
2. **Cold state:** no Meta Ads `Connection`. Status=`IDLE`. KPI strip shows 4 unavailable tiles. ROI bar in degraded mode. Approval block hidden. Activity stream shows the 3 synthetic onboarding rows.
3. **Steady state:** Connection present, ≥1 acted decision in last 7d, 2+ pending recommendations. Status=`WAITING`. KPIs live (leads from `metrics-riley`, others from Meta insights). ROI bar shows ROAS fill + CPL comparator. Approval cards render with `humanSummary` as the quote and `presentation.primaryLabel` as the primary CTA.
4. **All 11 recommendation action variants** render correctly when present: pause, review_budget, scale, refresh_creative, restructure, shift_budget_to_source, switch_optimization_event, harden_capi_attribution, hold, add_creative, fix_signal_health. Each gets the urgency eyebrow + primary CTA + learning-phase footer (when applicable) from the persisted Recommendation.
5. **Signal-health grouping**: multiple `signal:`-prefixed Recommendation rows for the same pixel collapse into one account-level card with a bulleted breach list. Dismiss-all calls `actOnRecommendation` for each underlying row.
6. **Sort order**: cards stack immediate > this_week > next_cycle, with `dollarsAtRisk` desc within each band. Verified with a state that mixes urgencies.
7. **Reversibility affordance**: approving a `pause` or `reduce_budget` rec surfaces a 1-hour Undo affordance on the resulting toast (per existing `actOnRecommendation` undo flow).
8. **External-action cards** (`review_budget`, `fix_signal_health`, `harden_capi_attribution`) open the external Meta URL via `primaryAction.url` and dismiss the card on click (no internal mutation).
9. Clicking an internal-action approval's primary button calls `actOnRecommendation`, optimistically hides the card, and emits the toast from `presentation.acceptToast` (or fallback).
10. Mission subtitle is clickable; popover shows 5 rows (Role / Pipeline / Brand / Channels / Targets) with connection-status dots and the ROAS source disclosure.
11. ⌘K opens the palette pre-populated with Riley's commands.
12. **REVIEWING state surfaces during the 07:00 UTC daily scoring window** (verified via integration test that backdates `scoringRunActiveAt`).
13. The diff between `Riley Home v2.html` and `Alex Home v2.html` in the design bundle is honored: production code has **no Riley-specific layout code** outside `riley-config.*` / `metrics-riley.*` / activity translator branch. Layout/structure lives in the shared cockpit components.
14. Type-check, lint, and tests pass. New tests cover: Riley's status derivation (all 5 states), KPI tile assembly (cold + steady), ROI degraded fallback, approval mapping for each of the 11 action variants, signal-health grouping, urgency sort order, and external-action handling.

## Risks

- **Alex shell scope creep.** Riley needs `ApprovalBlock` to accept arrays and `KPIStrip` to accept explicit `tiles[]` + `roi` instead of Alex's legacy flat shape. The design source already parameterizes both — but the production shell must do the same. If the Alex shell PR ships with hard-coded Alex shapes, Riley becomes a refactor instead of a wiring task.
- **Meta-side data availability.** Spend / CPL / ROAS all depend on the Meta insights pipeline emitting daily numbers. The provider exists (`meta-campaign-insights-provider`) but isn't wired into `metrics-riley.ts` today. Riley's KPIs gracefully degrade to "unavailable," so this is a polish/feature ramp, not a blocker.
- **`targets` field placement.** Storing `avgValueCents`/`targetCpbCents` on `AgentRoster` columns vs `AgentRoster.config` is a small fork in the road. Columns make migrations cleaner; config keeps the schema flat. Plan-stage decision.
- **Intent vocabulary drift.** Three vocabularies in the codebase today. The translator absorbs all three; one-way reconciliation is a follow-up PR.

## Open questions

None — all design decisions captured above are resolvable from the Claude Design bundle and the backend reality. Outstanding items (column vs config storage; Meta insights wiring) are plan-stage choices, not spec gaps.
