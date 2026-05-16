# Alex Cockpit Home — Full Phase A Target Spec

**Date:** 2026-05-14
**Status:** North-star design spec — describes the full Phase A target, not the first PR. Implementation is sliced A.1–A.6 (see §Implementation slices). Each slice gets its own plan doc.
**Design source:** Claude Design bundle `agent-home-v3/Alex Home v2.html` (locked at `docs/design-prompts/locked/MANIFEST.md`; entrypoint SHA `b2d26468…f24625`)
**Sibling spec:** [Riley Cockpit Home](./2026-05-13-riley-cockpit-home-design.md) — same shell, different data
**Wave:** 2 (Alex Home v2 / Riley Home v2) — see `2026-05-14-post-wave-2-launch-roadmap-design.md`

---

## Summary

Alex's agent-home page becomes the **conversation cockpit** — a one-column dashboard surfacing live SDR work: identity + status pill, four KPI tiles (`bookings · leads · qualified % · spend`), a `return-on-spend` ROI bar with break-even tick and CPB comparator, an approval block for pricing/refund/escalation decisions, a per-thread activity stream with inline thread previews, and a structured-pending-action composer + `⌘K` palette driving Alex's standing rules and per-thread actions.

This spec is the **shell-owner** of the cockpit family. Riley's spec already exists and depends on the shell components defined here. Alex consumes the shell from the same code that Riley does (`apps/dashboard/src/components/cockpit/*`); the per-agent inputs come from `alex-config.*` + `metrics-alex.*` + the activity translator's Alex branch.

The full target replaces today's `EditorialAuthShell + AgentHomeClient` for `agentKey === "alex"` with a cockpit composition reading from `metrics-alex.ts`, `pipeline-alex.ts`, `use-agent-greeting`, `use-agent-wins`, `usePendingApprovals`, and the conversation lifecycle store. The existing block-based home is retired **at the end of Phase A (slice A.6)**, after the cockpit composition has been operating in production and zero-reference cleanup has been verified — not bundled with the introduction of the new shell.

### How to read this document

This is the **target** spec. It describes the Phase A finish line. The first PR (slice A.1) intentionally ships a much smaller surface — only what's needed to compose a recognizable Alex cockpit on top of existing data. Backend extensions, the command palette, the mission API, KPI/ROI, narrator persistence, and old-component deletion each land in later slices. See §Implementation slices for the precise per-slice contents.

## Implementation slices

Phase A ships across six PRs. Each slice has its own plan doc under `docs/superpowers/plans/`. Slice content below is binding — anything inside the spec body that contradicts the slice boundary defers to the slice boundary.

### A.1 — Shell + basic Alex cockpit composition (this spec's first PR)

**Ships:**

- Shared cockpit shell skeleton under `apps/dashboard/src/components/cockpit/`:
  - `tokens.ts` (page-local color/spacing tokens)
  - `kind-meta.ts` (activity kind labels/colors — Alex kinds only at A.1; Riley kinds added later by Riley spec)
  - `types.ts` (`CockpitStatus`, `ApprovalView`, `ActivityRow`, `ThreadMessage`)
  - `topbar.tsx`, `identity.tsx`, `status-pill.tsx`
  - `approval-block.tsx` + `approval-card.tsx`
  - `activity-stream.tsx` + `activity-row.tsx`
  - `cockpit-page.tsx` orchestration
- `apps/dashboard/src/lib/cockpit/` helpers used at A.1:
  - `alex-config.ts` (accent, mission defaults rendered statically — no popover yet)
  - `decision-to-approval-view.ts` (Adapter from existing `usePendingApprovals` shape → `ApprovalView`)
  - `activity-kind-map.ts` (lifecycle/audit event → `ActivityKind`)
- `apps/dashboard/src/hooks/use-cockpit-status.ts` (Alex-only branch; `WORKING / WAITING / IDLE / HALTED` derivation from existing hooks)
- `CockpitPage` consumes the existing `HaltProvider` via `useHalt()` — provider stays mounted in `EditorialAuthShell` at A.1. **No re-rooting.** Re-rooting is A.6, when the legacy shell is removed.
- `apps/dashboard/src/app/(auth)/[agentKey]/cockpit-client.tsx` rendering the new shell **only when `agentKey === "alex"`**; `agentKey !== "alex"` falls through to the existing `AgentHomeClient`
- Tests for: status derivation (4 states), Decision→ApprovalView adapter (per kind), activity-kind map (per event source), shell components (snapshot + interaction)

**Does not ship at A.1:**

- KPI strip / ROI bar / metrics endpoint changes
- Mission popover / mission aggregator API
- Command palette / NL parser / composer (the composer slot in `cockpit-page.tsx` renders an inert placeholder at A.1)
- Activity endpoint changes / `ActivityRow.preview` / inline thread preview / reply box
- `Approval.payload` schema additions
- `RecommendationPresentation` toast fields
- `AgentRoster.config` additions (no new fields read or written)
- `narratorState` persistence (cold-state copy is hard-coded deterministic in A.1)
- Sprite system, pixel avatars
- Old `components/agent-home/*-block.tsx` deletion
- Riley wiring of any kind
- New API routes, new Prisma migrations

**Status vocabulary at A.1:** `WORKING / WAITING / IDLE / HALTED`. `WORKING` is the activity-row proxy ("there's been Alex activity in the last N minutes"). `TALKING` (which implies live-conversation truth) is **deferred to a later slice** that has clean access to `activeConversations` + `lastOutboundDraftAt`. Don't ship `TALKING` until the conversation-grain backend signals are present.

### A.2 — Mission popover + role/config disclosure + cold-state narrator

**Ships:** `GET /api/dashboard/agents/[agentId]/mission` aggregator, `use-agent-mission.ts` hook, `mission-popover.tsx`, clickable subtitle on the identity row, role/pipeline/brand/channels/rules rows, "Edit configuration" → `/settings` deep link, channel status dots.

**Also ships in A.2** (mission and cold-state are both "what Alex is configured for" surfaces): `empty-state.tsx` rendering the locked-design narrator block + 4-row setup checklist. Narrator copy is **client-side templated** from the mission aggregator's data (no `narratorState` persistence — see §Backend changes §2). Setup-row `onConnect` handlers route to `/setup?step={key}` deep links. EmptyState renders when the mission aggregator returns no `Connection` rows AND no completed setup; otherwise the steady-state composition takes over. At A.1, before EmptyState ships, the cold state shows the bare cockpit (empty activity stream's "Nothing here yet" + `IDLE` pill); this is acceptable interim behavior since the only path to A.1 cold state is a brand-new tenant with no operators yet using the route.

### A.3 — KPI strip + ROI bar

**Ships:** `kpi-strip.tsx`, `kpi.tile.tsx`, `roi-bar.tsx`, legacy-shape adapter (`legacy-shapes.ts` with `legacyTiles` / `legacyRoi`), `metrics-alex.ts` extension to echo `target` / `avgValue` / `spend`, `AgentRoster.config` helper for `avgValueCents` / `targetCpbCents` (`packages/core/src/agent-home/targets.ts`), degraded ROI states, collapsed-KPI-when-approval-open behavior.

### A.4 — Activity richness + thread previews

**Ships:** either the new `GET /api/dashboard/agents/[agentId]/activity` endpoint or an extension of the existing `/api/dashboard/agents/activity` (plan decides), `ActivityRow` superset (`body` / `preview` / `who` / `replyable` / `tag`), inline `thread-preview.tsx`, reply box routing to `/contacts/[id]`, "Tell Alex about {firstName}" affordance, activity filters (`all` / `booked` / `escalations`).

### A.5 — Composer + command palette

**Ships:** `parse-command.ts` (TypeScript port of `commands.jsx:7`), `command-palette.tsx`, `composer.tsx` with staging + Confirm/Undo, `⌘K` keyboard shortcut, Alex command catalog, pause/resume/halt wired to local `HaltProvider`, settings/contact deep links for rule/handoff/context commands, stubbed `brief` / `followup`, `toastVoice` voice for action confirmations.

### A.6 — Retirement + cleanup

**Ships** (only after Alex cockpit has been stable in production through A.5):

- Delete `components/agent-home/agent-block-boundary.tsx`, `greeting-block.tsx`, `needs-you-block.tsx`, `wins-block.tsx`, `metrics-block.tsx`, `pipeline-block.tsx`, `prose-segments.tsx`, `sparkline.tsx`, `fixture-folio-badge.tsx`, `portrait/`
- Delete `agent-home-client.tsx` (replaced by `cockpit-client.tsx` per-agent branching)
- Remove the `agentKey === "alex" ? <CockpitPage /> : <LegacyAgentHomeClient />` branch (after Riley cockpit ships per its own spec)
- Audit `/team` imports — if `/team` consumes any of the deleted blocks, refactor `/team` first in a precursor PR
- Delete any hooks that no consumer references after the above

**Gate:** every deletion is preceded by a grep across the repo proving zero references. No "delete and hope" sweeps.

---

This section is the **authoritative inventory** of what Alex does in the codebase as of 2026-05-14. The cockpit's job is to surface this work to operators — every capability below maps to at least one cockpit element (KPI tile, approval card, activity row, mission row, or thread preview).

### Conversation lifecycle states Alex moves contacts through

From `packages/core/src/conversation-lifecycle/constants.ts` + `packages/schemas/src/conversation-lifecycle.ts`:

| State                      | Capability    | Reachable via triggers                                                     | Cockpit treatment                                                             |
| -------------------------- | ------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `active`                   | mechanical    | inbound message arrives; lifecycle re-opens after re-engagement            | Activity rows `replied` / `qualified` / `sent`; status `TALKING` when ≥1 live |
| `stalled`                  | mechanical    | `timer_24h_no_inbound`                                                     | Activity row `passed` (silent) or no row; pipeline counts only                |
| `booked`                   | mechanical    | `booking_event_received`                                                   | Activity row `booked`; KPI `bookings`                                         |
| `escalated`                | mechanical    | `governance_verdict_escalate`, `operator_takeover`                         | Activity row `escalated` (`TO YOU`)                                           |
| `qualified`                | qualification | `qualification_checklist_met`                                              | Activity row `qualified`; KPI `qualified %`                                   |
| `disqualified`             | qualification | `operator_confirmed_disqualification`                                      | Activity row `passed`; pipeline `dropped` count                               |
| `proposed_disqualified` \* | qualification | `system_proposed_disqualification` (qualificationStatus, not currentState) | **Approval card** — operator confirms/dismisses                               |

\* `proposed_disqualified` is a `qualificationStatus`, not a `currentState`. The cockpit treats any contact with `qualificationStatus === "proposed_disqualified"` as an Alex-emitted approval candidate; confirmation flows through the same approval path as pricing/refund asks (see §Approval block).

### Tools Alex invokes (audited surfaces)

From `packages/core/src/skill-runtime/tools/`:

| Tool                      | Purpose                                              | Cockpit relevance                                                                  |
| ------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `calendar-book`           | Hold/confirm a consultation slot                     | Activity row `booked`; powers KPI `bookings`                                       |
| `crm-query`               | Read contact/opportunity history                     | Invisible — informs Alex's replies; not surfaced as its own row                    |
| `crm-write`               | Update contact stage / opportunity status / notes    | Surfaces only when state advances (`qualified`/`booked`); raw writes are invisible |
| `escalate`                | Hand a thread to the operator's inbox                | Activity row `escalated`; status pill stays `TALKING` until the operator picks up  |
| `web-scanner`             | Pull org/listing data during onboarding              | Surfaces in `EmptyState` setup row hints — not on steady-state cockpit             |
| `booking-failure-handler` | Roll back a calendar-book that the provider rejected | Activity row `escalated` with body `"Booking failed — needs you"`                  |

All tool invocations enter through `PlatformIngress.submit()` and produce `WorkTrace` rows. The cockpit reads from **persisted `Audit` / `WorkTrace` / `ConversationLifecycle` rows only** — it never inspects skill-executor state mid-flight. This is the same contract Riley honors.

### Approval-emitting paths (what becomes a card)

Alex emits approvals through `skill-runtime` `pendingApproval()` (see `packages/core/src/skill-runtime/tool-result.ts:54`) and through the qualification hook (`system_proposed_disqualification`). All persist into the `Approval` table with `bindingHash`, `riskCategory`, `summary`, and a routing payload. The cockpit reads from `usePendingApprovals()` (already exists at `apps/dashboard/src/app/(auth)/(mercury)/approvals/hooks/use-approvals.ts`).

| Approval source                                          | When                                                                                  | Card kind       | Risk category surfaced                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------- | --------------------------------------------------- |
| Pricing reply over org's `priceApprovalThreshold`        | Alex drafts a reply that includes a discount/founder rate above the per-org threshold | `pricing`       | `low` / `medium` / `high` from `riskCategory`       |
| Refund / cancellation thread                             | Inbound `STOP`-adjacent / refund language hits the deterministic gate                 | `refund`        | `high`                                              |
| Escalated thread the operator still needs to acknowledge | `escalate` tool fired but no operator ack yet                                         | `escalation`    | from gate verdict                                   |
| Proposed disqualification awaiting confirm               | `system_proposed_disqualification` written; not yet operator-confirmed                | `qualification` | `low` (re-routable)                                 |
| Claim-classifier flagged a medical/regulatory claim      | Alex drafts language the classifier marks unsafe                                      | `regulatory`    | `critical` (medical) / `high` (regulatory adjacent) |
| Deterministic-safety-gate blocked draft                  | Draft violated a deterministic rule (e.g. price floor, claim list)                    | `safety-gate`   | from gate                                           |

The cockpit's `approval[]` array is the union of these sources, scoped to `agentKey === "alex"` (i.e. `Approval.actorId` resolves to an Alex skill execution). Sort order: `urgency = immediate` first (escalations / refund / regulatory), then `this_week` (pricing / qualification), then `next_cycle` (none for Alex today). Within a band: most-recent first.

### Standing rules / configuration the cockpit reflects

From `AgentRoster.config` (JSON) + `OrganizationProfile`:

| Rule                           | Source                                      | Cockpit surface                                                       |
| ------------------------------ | ------------------------------------------- | --------------------------------------------------------------------- |
| Price approval threshold ($)   | `AgentRoster.config.priceApprovalThreshold` | Mission popover `RULES` row; command `Raise approval threshold to $N` |
| Quiet hours window             | `AgentRoster.config.quietHours`             | Mission popover; `IDLE` status pill during the window                 |
| Refund escalation floor ($)    | `AgentRoster.config.refundEscalationFloor`  | Activity body copy for refund escalations                             |
| Founder-rate offer enabled     | `AgentRoster.config.founderRateEnabled`     | Command `Stop offering the founder rate`                              |
| Booking calendar provider      | `AgentRoster.config.calendar.providerId`    | Mission popover `CHANNELS` row, with status dot                       |
| Re-engagement template enabled | `AgentRoster.config.reEngagementTemplate`   | Activity row `connected` ("Pulled overnight leads")                   |

These are **rendered, not edited** in v1 — clicking the mission subtitle opens the popover; the "Edit configuration" button routes to `/settings`. No inline editing in the popover (matches the locked design).

### Targets the cockpit needs

For the ROI bar and KPI tiles, Alex needs two numbers stored per-org:

- `targetCpbCents` — cost-per-booking target (e.g. $30)
- `avgValueCents` — average booking value used to compute return on spend (e.g. $179)

These are the **same two fields Riley needs** (`avgValueCents` + `targetCpbCents` per the Riley spec §Persistence). They live in the same place. Final placement decided in the plan (§Backend changes §1) — either two nullable columns on `AgentRoster`, or two keys under `AgentRoster.config`.

### Data-plane capabilities (backend, not directly cockpit-visible)

Documented so the cockpit doesn't accidentally re-surface them:

| Capability                         | File / module                                                       | Cockpit relevance                                       |
| ---------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------- |
| Conversation compounding           | `ConversationCompoundingService` (knowledgeStore-wired)             | Feeds Alex's context; cockpit shows the outcome only    |
| Outcome-informed context injection | `packages/core/src/agent-infra` (PR-3, #461)                        | Same — invisible to operator                            |
| Qualification rule evaluator       | `conversation-lifecycle/qualification/*`                            | Triggers `qualified`/`proposed_disqualified` rows       |
| Disqualification resolver          | `conversation-lifecycle/qualification/disqualification-resolver.ts` | Creates qualification approval cards                    |
| Deterministic safety gate          | `skill-runtime/hooks/deterministic-safety-gate.ts`                  | Creates `safety-gate` approval cards                    |
| Claim classifier                   | `skill-runtime/hooks/claim-classifier.ts`                           | Creates `regulatory` approval cards (med-spa Phase 1b2) |
| Re-engagement attributor           | `conversation-lifecycle/re-engagement-attributor.ts`                | Drives `connected` activity rows                        |
| Lifecycle config resolver          | `conversation-lifecycle/lifecycle-config-resolver.ts`               | Surfaces in mission popover indirectly                  |
| Phase 3 mechanical lifecycle       | shipped (#442)                                                      | All activity row kinds are derived from this            |
| Phase 3b LLM qualification         | spec'd (#443); ship state per branch                                | Powers `proposed_disqualified` approvals                |

## Scope (full Phase A target)

The list below is the **Phase A finish line**, not the contents of any single PR. Slice boundaries are in §Implementation slices.

In scope across A.1–A.6:

- **Shared cockpit shell** under `apps/dashboard/src/components/cockpit/` and `apps/dashboard/src/app/(auth)/[agentKey]/`. Components are written agent-agnostic and consumed by both Alex and Riley.
- Alex-specific data plumbing: KPI tiles, ROI bar, approval cards (pricing/refund/qualification/regulatory/safety-gate/escalation), activity rows, mission popover, status pill, composer placeholder + commands.
- Backend additions: `GET /api/dashboard/agents/[agentId]/mission` aggregator response (A.2); extension of `GET /api/dashboard/agents/[agentId]/metrics` with `tiles[]` + `roi` shapes (A.3); activity endpoint shape decision (A.4).
- Schema extensions: `RecommendationPresentationSchema` gains optional `acceptToast` + `declineToast` (A.5; consumed by Riley; defined here because the shell honors both for parity).
- Status-pill vocabulary — see §Status pill vocabulary. A.1 ships `IDLE / WORKING / WAITING / HALTED`; the live-conversation `TALKING` variant lands in a later phase when the backend signals are clean.
- Retirement of the existing block components (`GreetingBlock`, `WinsBlock`, `NeedsYouBlock`, `MetricsBlock`, `PipelineBlock`) for the `/[agentKey]` route — **only at A.6**, after zero-reference verification. No bundling with the introduction of the new shell.
- Composer NL parser (`parseCommand` from `commands.jsx`) ported to TypeScript at `apps/dashboard/src/lib/cockpit/parse-command.ts`. Catalog of Alex commands shipped at `apps/dashboard/src/lib/cockpit/alex-commands.ts` (A.5).
- `⌘K` command palette as a shared shell component (A.5).

Out of scope:

- Riley's data wiring (covered by the Riley spec; depends on shell shipping first).
- Mira tab content. `tabs` shows `Mira` as `muted: true`; the tab is rendered greyed and not clickable in v1. Mira Home v3 lands in Wave 4 (per the launch roadmap).
- The pixel-avatar sprite system from the locked design (`sprite.jsx` / `sprites.jsx` / `riley-sprites.jsx`). v1 ships a static SVG mark (the `Mark` component from `cockpit.jsx`) plus an initial-letter fallback frame. Sprite animations are deferred polish ramp; the shell exposes `state="idle"|"draft"|"sleep"` props so sprites can land later without changing call sites.
- ROI bar `crm` source for Alex. Alex's ROI bar uses `bookings × avgValueCents / spend` (per `legacyRoi()` in `cockpit.jsx`). CRM-confirmed revenue is Riley territory (true ROAS) — Alex's "consultation value" is a deterministic computation, not a CRM lookup.
- Editing standing rules from the mission popover (clicking "Edit configuration" routes to `/settings`).
- Inline-reply send-as-me wire-through. Activity rows expand to show a thread preview + reply box (per locked design), but the reply box is **not wired to send** in v1 — pressing "Send as me" routes to `/contacts/[id]` with the thread open. Inline send is a polish ramp; the UI is built so wiring is a one-handler swap.
- "Tell Alex about {Name}" context-write button on activity rows. Routes to a `/contacts/[id]?note=open` deep link in v1; no inline note-write API call.
- Day-1 empty-state setup-task wiring beyond what `/setup` already does. The cockpit's `EmptyState` is rendered when `data.narrator` is present; the four setup rows (`meta` / `inbox` / `cal` / `rules`) link to `/setup` deep links — they do not re-implement onboarding logic.
- Toast voice deviation from `alex-config.jsx`'s `toastVoice(action)`. Production code copies the function verbatim into TypeScript.

## Source-of-truth files (locked design)

The implementation must match the design files in the bundle. Component boundaries are already drawn:

| Shell component (in `cockpit.jsx`) | Alex input                                      | Spec section         |
| ---------------------------------- | ----------------------------------------------- | -------------------- |
| `Topbar`                           | `tabs` from `AGENT.tabs`                        | §Identity row        |
| `Identity` / `MissionPopover`      | `AGENT.mission`                                 | §Identity row        |
| `KPIStrip` / `KPI` / `ROIBar`      | `STATES[k].kpis` (legacy schema; see §KPIs)     | §KPI strip, §ROI bar |
| `ApprovalBlock` / `ApprovalCard`   | `STATES[k].approval` (object or array)          | §Approval block      |
| `ActivityStream` / `ActivityRow`   | `STATES[k].activity[]` + `ThreadPreview`        | §Activity stream     |
| `Composer` / `Toast`               | `AGENT.composerPlaceholder`, `AGENT.toastVoice` | §Composer            |
| `EmptyState`                       | `STATES.empty.narrator` + `setup[]`             | §Day-1 empty state   |
| `CommandPalette`                   | `window.COMMANDS` + `parseCommand`              | §Composer            |

`alex-config.jsx`, `data.jsx`, and `commands.jsx` are the **canonical reference** for Alex's data shape. Production code must produce data conforming to those shapes (renamed where helpful for TypeScript clarity, but structurally identical).

The shell's existing `legacyTiles()` / `legacyRoi()` adapters in `cockpit.jsx:327` already translate Alex's flat KPI schema (`{ booked, leads, qualifiedPct, spend, avgValue, target, bookedDelta, leadsDelta, qualifiedDelta }`) into the explicit `tiles[]` + `roi` shape Riley uses. Production code keeps this adapter so Alex's backend can keep emitting the flat shape during v1 — no churn in `metrics-alex.ts`'s output beyond adding `target` + `avgValue` fields.

## Visual tokens

From `alex-config.jsx`:

```ts
ALEX_ACCENT = {
  base: "#B8782E", // warm amber
  deep: "#7C4F1C",
  soft: "#F1E2C2",
  paper: "#FBF1D6",
};
```

Shared across both agents (in `cockpit.jsx`):

```ts
T = {
  bg: "#FAF8F2",
  paper: "#FFFFFF",
  ink: "#0E0C0A",
  ink2: "#3A332B",
  ink3: "#6B6052",
  ink4: "#A39786",
  ink5: "#C8BEAE",
  hair: "rgba(14,12,10,0.08)",
  hairSoft: "rgba(14,12,10,0.04)",
  amber: "#B8782E",
  amberDeep: "#7C4F1C",
  amberSoft: "#F1E2C2",
  amberPaper: "#FBF1D6",
  green: "#3F7A36",
  red: "#A03A2E",
  blue: "#3A5A80",
};
```

Alex's accent is identical to the shared `amber` family — pricing/approval surfaces, the ROI bar fill, and the agent's chip avatar all read warm amber. Green = positive trend / booked; red = halt / escalation / risk; blue = leads-in / cross-platform signals.

**Token register:** these are page-local cockpit tokens. They do **not** promote to globals as `--sw-*` or `--mercury-*` — the cockpit is its own editorial surface with its own warm-paper palette, distinct from the Mercury Tools tier. The shared-conventions doc (wave 1.5, `docs/design-prompts/shared-conventions.md`) ratifies this split. If a future surface needs the same warm-paper tokens, promote them then; v1 keeps them in `cockpit/tokens.ts`.

**Fonts.** Body: Inter (already loaded via `next/font` in `app/layout.tsx`). Tabular numerics: JetBrains Mono — used for KPI values, status pill labels, mission popover keys, activity row timestamps and kind chips, ROI bar scale labels, and the "Ask Alex" composer prefix. Both fonts are already in the dashboard's `next/font` setup; no new fonts.

## Status pill vocabulary

The cockpit ships two distinct vocabularies depending on slice:

**A.1 vocabulary (ships first):**

```ts
export type CockpitStatusA1 =
  | "IDLE"
  | "WORKING" // activity-row proxy — recent Alex work, source-agnostic
  | "WAITING"
  | "HALTED";
```

| Status    | Color           | Pulses | Alex meaning (A.1)                                                                                                                 |
| --------- | --------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `WORKING` | green `#3F7A36` | yes    | At least one Alex-attributed activity row in the last N minutes (configurable; default 15). Sourced from existing activity stream. |
| `WAITING` | amber `#B8782E` | yes    | One or more `Approval` rows with `status = "pending"` and actor resolving to Alex.                                                 |
| `IDLE`    | grey `#A39786`  | no     | Neither condition above; or inside configured quiet hours.                                                                         |
| `HALTED`  | red `#A03A2E`   | no     | `HaltProvider.halted === true`.                                                                                                    |

A.1 derives `WORKING` from the **activity-row recency** signal — the same data the cockpit's activity stream is rendering. No new backend, no conversation-grain query.

**Later-phase vocabulary (`TALKING`):**

```ts
export type CockpitStatusFull =
  | "IDLE"
  | "TALKING" // live-conversation truth — ≥1 active conversation
  | "WAITING"
  | "WATCHING" // Riley
  | "REVIEWING" // Riley
  | "HALTED";
```

`TALKING` replaces `WORKING` once the cockpit has clean access to `activeConversations` (count of `ConversationLifecycle.currentState === "active"`) and `lastOutboundDraftAt`. This requires either an extension to the mission/metrics endpoints or a dedicated conversation-grain query. Whichever slice ships that backend signal **also** flips the status pill from `WORKING` to `TALKING` — they ship together. Until then, the pill is `WORKING`, full stop.

The shell's exported type at `apps/dashboard/src/components/cockpit/types.ts` is the union of both vocabularies so callers don't churn at the cutover:

```ts
export type CockpitStatus =
  | "IDLE"
  | "WORKING"
  | "TALKING"
  | "WAITING"
  | "WATCHING"
  | "REVIEWING"
  | "HALTED";
```

`WATCHING` and `REVIEWING` are Riley-specific and never returned by Alex's derivation.

### Derivation (A.1)

Runs client-side in `apps/dashboard/src/hooks/use-cockpit-status.ts`:

```ts
function deriveAlexStatusA1(input: {
  halted: boolean;
  pendingApprovals: number; // from usePendingApprovals(), scoped to Alex actor
  recentActivityAt: Date | null; // most recent Alex activity row's timestamp
  inQuietHours: boolean;
  now: Date;
}): CockpitStatusA1 {
  if (input.halted) return "HALTED";
  if (input.pendingApprovals > 0) return "WAITING";
  if (
    input.recentActivityAt &&
    input.now.getTime() - input.recentActivityAt.getTime() < 15 * 60_000
  ) {
    return "WORKING";
  }
  if (input.inQuietHours) return "IDLE";
  return "IDLE";
}
```

Pulse rules: `statusPulse: (key, halted) => !halted && (key === "WORKING" || key === "WAITING")`.

### Derivation (later phase, with conversation-grain signals)

Replaces the `WORKING` branch:

```ts
if (input.activeConversations > 0) return "TALKING";
```

`activeConversations` and `lastOutboundDraftAt` come from the slice that wires them up. Do not ship this branch without those signals.

## Identity row + mission popover

```
[avatar warm amber] Alex  [● TALKING · 3]
                    SDR · Consultations pipeline · {org.displayName}   (clickable)

                    "Talking to three people. Two warm. One on pricing —
                    covered by your standing rule."
```

The third element on the status line (`· 3`) is `data.liveCount` — the number of `active` conversations. Surfaces only when `liveCount > 0`. Riley does not emit this field.

**A.1 note:** This identity row shows the **Phase A final** target. A.1 renders the same row with `WORKING` instead of `TALKING`, and **does not render `liveCount`** — A.1 has no conversation-grain backend signal to count active conversations. `TALKING · liveCount` lights up only when the slice that wires `activeConversations` + `lastOutboundDraftAt` ships (see §Status pill vocabulary). Subtitle is rendered as static text at A.1, becomes clickable at A.2 with the mission popover.

Mission popover rows (`mission.rows`) for Alex:

| Eyebrow    | Value                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------- |
| `ROLE`     | `SDR · qualify inbound leads, book consultations`                                            |
| `PIPELINE` | `Consultations pipeline · single funnel`                                                     |
| `BRAND`    | `{org.displayName} · {org.tagline ?? "—"}`                                                   |
| `CHANNELS` | `Meta Ads · {org.displayName} inbox · consultation calendar` (with status dots if available) |
| `RULES`    | `Pricing approvals over ${threshold} · refunds over ${refundFloor}`                          |

The locked design ships 4 rows; this spec adds a `RULES` row (5th) to disclose Alex's per-org thresholds — symmetric with Riley's `TARGETS` row. The shell supports variable-length `mission.rows` (verified by reading `cockpit.jsx:996` — `AG.mission.rows.map((row, i) => ...)` accepts any length).

Status dots on `CHANNELS`:

- Meta Ads: from `Connection` row `status` (`connected` → ok green, `degraded` → amber, otherwise `disconnected` → grey)
- Inbox / calendar: from `ManagedChannel.status` (`active` → ok, `error` → amber, otherwise grey)

The "Edit configuration" button at the popover footer routes to `/settings`. No inline edit.

## KPI strip

Four tiles in order: **bookings · leads worked · qualified · ad spend**, with the ROI bar below.

Tile schema (shared with Riley):

```ts
export type KpiTile = {
  label: string;
  value: number | string; // "—" when unavailable
  unit?: string; // "%", "×", etc.
  trend?: string; // "+2 vs last", "best Mon"
  unavailable?: boolean;
  hint?: string; // "Connect Meta Ads"
};
```

### Cold state (`IDLE` / empty)

When `data.narrator` is present, the cockpit renders `EmptyState` instead of the KPI strip + activity stream — no `tiles[]` evaluated. The narrator block (warm-paper card with agent voice + "next move" pill) and the 4-row setup checklist are the entire body. Composer is enabled but contextual chips are empty.

### Steady state (live)

```ts
tiles = [
  { label: "bookings", value: 9, trend: "+3" }, // KPI 1 — Alex's hero
  { label: "leads worked", value: 47, trend: "+12" },
  { label: "qualified", value: 28, unit: "%", trend: "+4 pts" },
  { label: "ad spend", value: "$214" }, // unit omitted; value is pre-formatted
];
```

Range eyebrow: `This week · {weekStartShort} — {weekEndShort}` (`metrics-alex.ts` already produces a `week` window).

### Backend mapping

| Tile         | Source                                                                       | Currently live?                                                       |
| ------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| bookings     | `metrics-alex.buildAlexMetricsViewModel().heroValue`                         | yes                                                                   |
| leads worked | `metrics-alex.leads` (conversion count, type `lead`, this week)              | yes                                                                   |
| qualified %  | Derived: `bookings / leads` × 100 (already computed at `metrics-alex.ts:57`) | yes                                                                   |
| ad spend     | From Meta insights (`meta-campaign-insights-provider`) summed over week      | no — falls back to `unavailable: true` with hint `"Connect Meta Ads"` |

`metrics-alex.ts` keeps emitting today's flat `MetricsViewModel` (it ships `{ heroValue, stats, spark, subprose }`). The shell's `legacyTiles()` adapter (`cockpit.jsx:327`) is ported to TypeScript at `apps/dashboard/src/lib/cockpit/legacy-shapes.ts` and converts the flat shape to `tiles[]`. **Production cost:** zero changes to `metrics-alex.ts`; one new adapter file.

ROI bar (see §ROI bar) needs `avgValue` + `target` — these are new on the metrics endpoint (see §Backend changes §3).

Trend deltas (`+2`, `+12`, `+4 pts`, `best Mon`):

- Numeric deltas come from `metrics-alex` comparing `heroValue` to the previous week's count (already computed as `heroPrev` at `metrics-alex.ts:25`).
- `"best Mon"`-style superlatives are a polish ramp — v1 ships numeric only.

## ROI bar

Layout (shell-provided, `cockpit.jsx:450`):

```
[● return on spend] $214 spent · $1,611 in consultation value ─────[━━━●━━━━]──── 6× spend
                    $0        break-even                                  $24 per booking · target $30
```

Schema (shared):

```ts
export type RoiBar =
  | {
      degraded: true;
      degradedHint: string; // "Set avg booking value to see return on spend"
      label?: string;
      comparator: { value: string; target: string; onTarget?: false };
    }
  | {
      label: string; // "return on spend"
      leftMeta: string; // "$214 spent"
      rightMeta: { value: string; suffix: string }; // { value: "$1,611", suffix: " in consultation value" }
      fillPct: number; // 0..100
      breakEvenPct: number; // (1 / 6) * 100 ≈ 16.67
      breakEvenLabel: string; // "break-even"
      scaleLeft: string; // "$0"
      scaleRight: string; // "6× spend"
      comparator: { value: string; target: string; onTarget: boolean };
    };
```

### Math (Alex)

- Track scale: 0× to 6× spend (Alex; Riley uses 0×–4× ROAS — the shell honors both via explicit `fillPct` + `scaleLeft` + `scaleRight`).
- `earned = bookings × avgValueCents`
- `ratio = earned / spend` (capped at 6× for `fillPct`)
- `fillPct = (min(ratio, 6) / 6) × 100`
- `breakEvenPct = (1 / 6) × 100 ≈ 16.67`
- `cpb = spend / bookings` (rounded to whole dollars)
- `comparator.value = "$" + cpb + " per booking"` (omit `per booking` suffix when `compact === true`)
- `comparator.target = "target $" + target`
- `comparator.onTarget = cpb !== null && cpb <= target` — flips the comparator pill green

`legacyRoi()` from `cockpit.jsx:335` already implements this verbatim; production code copies it to TypeScript.

### Degraded path

When `avgValueCents` is null OR `spend` is unavailable, render the degraded form: dashed top border, no bar track, comparator pill only with degraded hint. Two distinct hints:

- `spend` unavailable: `"Connect Meta Ads to see return on spend"`
- `avgValueCents` null: `"Set average booking value to see return on spend"`

When both are unavailable, prefer the Meta Ads hint (the more proximate setup step).

## Approval block

`ApprovalBlock` (already in `cockpit.jsx:521`) accepts a single object or an array; the production type aligns to the array form:

```ts
export type ApprovalView = {
  id: string; // Approval.id
  kind: AlexApprovalKind; // "pricing" | "refund" | "qualification" | "regulatory" | "safety-gate" | "escalation"
  urgency: "immediate" | "this_week" | "next_cycle";
  askedAt: string; // "4 min ago" (via relative-age util)
  title: string; // Card eyebrow + display title
  body?: string; // Operator-language description; Alex's first-person narration
  quote?: string; // Inbound-message excerpt that triggered the approval
  quoteFrom?: string; // "Jordan F. · 11:53"
  campaign?: never; // Riley-only; Alex omits
  risk?: string; // "$680 at risk" / "above $50 threshold"
  primary: string; // CTA primary label, e.g. "Accept & send"
  secondary: string; // "Decline"
  tertiaryLabel?: string; // "Open thread" / "Edit reply"
  presentation: { primaryLabel: string; dismissLabel: string };
  primaryAction:
    | { kind: "respond"; bindingHash: string; verdict: "accept" | "deny" }
    | { kind: "internal"; intent: string; parameters: Record<string, unknown> }; // for non-binding cards
  acceptToast?: string; // optional; falls back to AGENT.toastVoice
  declineToast?: string;
};
```

### Card variants (one per kind)

The shell renders all six from the same `ApprovalCard` component — difference is data, not layout. Visual identity comes from the eyebrow (urgency-driven) and the body copy.

| Kind            | Eyebrow               | Typical title                           | Quote source                                | Primary CTA              | Notes                                                 |
| --------------- | --------------------- | --------------------------------------- | ------------------------------------------- | ------------------------ | ----------------------------------------------------- |
| `pricing`       | **NEEDS YOU** (amber) | "Send Jordan the founding-member rate?" | Inbound message that asked for the discount | Accept & send            | Routes through `respondToApproval`; risk = $ at stake |
| `refund`        | **IMMEDIATE** (red)   | "Refund request from {Name}"            | Inbound message                             | Open thread (handoff)    | Always escalates to operator inbox; binary verdict    |
| `qualification` | THIS WEEK (amber)     | "Mark {Name} as disqualified?"          | Last operator-visible inbound (or none)     | Confirm disqualification | Triggers `operator_confirmed_disqualification`        |
| `regulatory`    | **IMMEDIATE** (red)   | "Medical claim flagged in draft"        | Draft text (the unsafe claim)               | Edit reply               | claim-classifier; high/critical risk                  |
| `safety-gate`   | **IMMEDIATE** (red)   | "Deterministic gate blocked this reply" | Draft text (the violation)                  | Edit reply               | deterministic-safety-gate; blocks send                |
| `escalation`    | **TO YOU** (red)      | "{Name} thread waiting for you"         | Last 1–3 messages                           | Open thread              | `escalate` tool fired; no `bindingHash`               |

### Card sort order

```
immediate (refund / regulatory / safety-gate / escalation) → this_week (pricing / qualification) → next_cycle (none for Alex)
```

Within an `immediate` band, sort by `createdAt` desc (most-recent first). Within `this_week`, sort by `riskCategory` (high → medium → low), then `createdAt` desc.

### KPI strip collapse on open approvals

Per the locked design (`cockpit.jsx:1093`), the KPI strip collapses to a single-line summary when at least one unresolved approval is present:

```
THIS WEEK  9 bookings · $24 each · +3
                                        Open report →
```

This is a shell behavior (`collapsed={hasOpenApproval}`) — Alex doesn't need to opt in. Same behavior governs Riley's strip.

### Action wiring

```ts
async function onResolve(verdict: "accept" | "decline", card: ApprovalView): Promise<void> {
  if (card.primaryAction.kind === "respond") {
    await respondToApproval({ bindingHash: card.primaryAction.bindingHash, verdict });
  } else if (card.primaryAction.kind === "internal") {
    await runInternalIntent(card.primaryAction.intent, card.primaryAction.parameters);
  }
  // Optimistic hide handled in shell via approvalResolved Set; toast emitted from acceptToast/declineToast or AGENT.toastVoice
}
```

The shell already manages optimistic hide and toast emission (`cockpit.jsx:1098`). Production code provides the `onResolve` callback that calls `respondToApproval` from the existing `useRespondToApproval()` hook at `apps/dashboard/src/app/(auth)/(mercury)/approvals/hooks/use-approvals.ts:100`.

### Empty state

When `approvals[]` is empty, the block is omitted entirely. The KPI strip uncollapses. No "no approvals" placeholder card.

### `quote` provenance

For `pricing` and `refund` cards: the inbound message that triggered the threshold breach. Stored in `Approval.payload.quote` (new field — see §Schema extensions §2). For `regulatory` / `safety-gate`: the **outbound draft** that the classifier or gate blocked (also `Approval.payload.quote`, with `quoteFrom: "Alex (draft)"`). For `escalation`: the last 1–3 inbound messages, joined.

## Activity stream

The translator at `apps/dashboard/src/hooks/use-agent-activity.ts` already exists and emits `TranslatedAction[]`. This spec extends it to emit the cockpit's richer row shape, which is a superset of the current shape:

```ts
export type ActivityRow = {
  time: string; // "11:58", "Fri", "—" for cold state
  kind: ActivityKind;
  head: string; // One-line summary
  body?: string; // Multi-line detail (rendered on expand)
  who?: string; // Contact display name (drives "Tell Alex about Jordan" affordance)
  preview?: ThreadMessage[]; // Inline thread preview on expand — Alex only
  replyable?: boolean; // Defaults true when `who` and `preview` both present
  tag?: string; // "+12" badge for batch rows
};

export type ThreadMessage = { from: string; text: string };
```

### Activity kinds (Alex)

The shared `KIND_META` table in `cockpit.jsx:26` already enumerates Alex's kinds. Production code ports it to TypeScript at `apps/dashboard/src/lib/cockpit/kind-meta.ts`:

| Kind        | Label       | Color     | Pulses |
| ----------- | ----------- | --------- | ------ |
| `booked`    | `BOOKED`    | amberDeep | no     |
| `qualified` | `QUALIFIED` | amber     | no     |
| `replied`   | `REPLIED`   | ink2      | no     |
| `sent`      | `SENT`      | ink3      | no     |
| `started`   | `STARTED`   | ink3      | no     |
| `connected` | `LEADS IN`  | blue      | no     |
| `waiting`   | `WAITING`   | amberDeep | no     |
| `escalated` | `TO YOU`    | red       | no     |
| `passed`    | `PASSED`    | ink4      | no     |

### Translator rules (Alex)

The translator reads `AuditEntry` rows + `ConversationLifecycle` state transitions and maps:

| Event source                                     | Activity kind | Head template                                | Body source                     |
| ------------------------------------------------ | ------------- | -------------------------------------------- | ------------------------------- |
| `Booking.create` audit                           | `booked`      | `"{contactName} confirmed {service} {when}"` | `"Calendar held. {note ?? ''}"` |
| Lifecycle `qualified` (qualification capability) | `qualified`   | `"{contactName} {qualifier}"`                | Last inbound excerpt            |
| Outbound message with state `active`             | `replied`     | `"{contactName} {topic}"`                    | Reply summary                   |
| Outbound batch (`re_engagement_template`)        | `sent`        | `"Morning batch · {N} follow-ups"`           | Template name + filter          |
| Day-1 / cron `system.daily_scan_started`         | `started`     | `"Daily run begins"`                         | Quiet-hours window              |
| `meta-leads-ingester` daily pull                 | `connected`   | `"Pulled {N} new leads from {source}"`       | Campaign + CTR                  |
| `Approval.create` (with Alex actor)              | `waiting`     | `"Awaiting your call on {topic}"`            | Quote excerpt                   |
| `escalate` tool                                  | `escalated`   | `"{topic} from {contactName} → your inbox"`  | Threshold reason + note         |
| Lifecycle `disqualified` / out-of-region close   | `passed`      | `"{contactName} — {reason}"`                 | —                               |

Where a `preview: ThreadMessage[]` is available (from the last 3–4 messages of the conversation), the translator includes it. Pulled from `MessageStore.recent(conversationId, 4)`. The shell renders the inline preview + reply box on row expand.

### Filters

Steady state: `["all", "booked", "escalations"]` (per `cockpit.jsx:613`). `all` shows everything. `booked` filters to `kind === "booked"`. `escalations` filters to `kind === "escalated" || kind === "waiting"`. Filter state is shell-managed.

Cold state: `["all"]` only.

### Cold-state rows

When `data.narrator` is present, the activity stream is replaced by `EmptyState` — no rows. Once setup completes, the steady-state stream takes over.

## Composer

The shell-provided composer (`cockpit.jsx:841`) is parameterized by `AGENT.composerPlaceholder`, `AGENT.toastVoice`, and a `COMMANDS[]` catalog reachable via `⌘K`.

### Alex's contributions

```ts
ALEX_COMPOSER_PLACEHOLDER =
  'Tell Alex what to do — "pause an hour", "follow up with Maya tonight"…';

ALEX_COMMANDS = [
  { id: "pause-1h", label: "Pause Alex for 1 hour", group: "control" },
  { id: "pause-3pm", label: "Pause until 3 PM", group: "control" },
  { id: "resume", label: "Resume Alex", group: "control" },
  { id: "halt", label: "Halt — stop everything", group: "control" },
  { id: "brief-noon", label: "Brief me at noon", group: "control" },
  { id: "brief-eod", label: "Brief me at end of day", group: "control" },
  { id: "fu-named", label: "Follow up with {contact} tonight", group: "thread" }, // template; resolved from open thread
  { id: "reply-named", label: "Reply to {contact} myself", group: "thread" },
  { id: "hold-named", label: "Hold {contact}, don't send anything", group: "thread" },
  { id: "stop-founder", label: "Stop offering the founder rate", group: "rules" },
  { id: "raise-rule", label: "Raise approval threshold to $99", group: "rules" },
  { id: "open-settings", label: "Open settings", group: "nav" },
  { id: "open-rules", label: "Open standing rules", group: "nav" },
  { id: "open-meta", label: "Open Meta Ads campaigns", group: "nav" },
];
```

### NL parsing rules (port to TypeScript)

The `parseCommand(raw)` function from `commands.jsx:7` ports verbatim to `apps/dashboard/src/lib/cockpit/parse-command.ts`. Pattern matchers:

| Pattern                     | Returns                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------- |
| `pause (for) N (min         | m                                                                                             | h                                                                             | hour                                                                                     | hours)` | `{ kind: "pause", icon: "⏸", label: "pause · Nh", detail: "until HH:MM AM" }` |
| `pause until <when>`        | `{ kind: "pause", icon: "⏸", label: "pause", detail: "until <when>" }`                        |
| `pause` / `pause alex`      | `{ kind: "pause", icon: "⏸", label: "pause", detail: "until you resume" }`                    |
| `resume` / `unpause` / `go` | `{ kind: "resume", icon: "▶", label: "resume", detail: "pick up where I left off" }`          |
| `halt` / `stop`             | `{ kind: "halt", icon: "⏹", label: "halt", detail: "stop everything now" }`                   |
| `(fu                        | follow up) (with) <name> [<when>]`                                                            | `{ kind: "followup", icon: "↻", label: "follow up · Name", detail: "today" }` |
| `brief (me) (at) <time>`    | `{ kind: "brief", icon: "☼", label: "brief me", detail: "at <time>" }`                        |
| `(stop                      | don't) (offer(ing)                                                                            | sending) <thing>`                                                             | `{ kind: "rule", icon: "⊘", label: "rule change", detail: "stop offering <thing>" }`     |
| `(reply to                  | i'll reply to                                                                                 | let me reply to) <name>`                                                      | `{ kind: "handoff", icon: "✎", label: "handoff · Name", detail: "you take the thread" }` |
| `tell alex about <name>`    | `{ kind: "context", icon: "ⓘ", label: "context · Name", detail: "add a note to the thread" }` |
| anything else               | `{ kind: "instruction", icon: "→", label: "instruction", detail: "<truncated to 60>" }`       |

Wired into the composer's "stage → confirm" flow per the locked design: typing stages a chip, Enter confirms.

### Action dispatch (`runAction`)

Most parsed actions are local-state-only in v1 (pause/resume/halt operate the local `HaltProvider`; rules and handoffs route to settings/contacts respectively). Wired actions for v1:

| `action.kind` | v1 behavior                                                                             |
| ------------- | --------------------------------------------------------------------------------------- |
| `pause`       | Sets `HaltProvider.halted = true` for the parsed duration; toast "Paused — …"           |
| `resume`      | Sets `HaltProvider.halted = false`; toast                                               |
| `halt`        | Sets `HaltProvider.halted = true` with no auto-resume; toast                            |
| `brief`       | Stub: records intent locally, toasts. Scheduled-brief delivery is post-v1 (no cron yet) |
| `rule`        | Routes to `/settings?focus=rules`; toast confirms the navigation                        |
| `handoff`     | Routes to `/contacts/[id]?takeover=true` for the matched contact; toast                 |
| `context`     | Routes to `/contacts/[id]?note=open` for the matched contact; toast                     |
| `followup`    | Stub: records intent; toast. Scheduled follow-ups land alongside `brief` cron.          |
| `command`     | Generic toast "On it — {label}". Specific commands route per their `id`.                |
| `instruction` | No backend; toast as `"Got it. Acting on \"{detail}\"."`                                |

Per-`id` overrides for the `command` group:

- `pause-1h` / `pause-3pm` / `resume` / `halt`: dispatch synthetic `parseCommand` of the equivalent natural-language string.
- `brief-noon` / `brief-eod`: stub + toast.
- `stop-founder`: routes to `/settings?focus=rules` with `founderRateEnabled` deep-link param.
- `raise-rule`: routes to `/settings?focus=rules&priceApprovalThreshold=99`.
- `open-settings` / `open-rules` / `open-meta`: navigation only.
- `fu-named` / `reply-named` / `hold-named` are dynamic — only enabled when there is an open thread context (e.g. an expanded activity row); the palette filters them out otherwise.

Backend wiring of `brief` and scheduled `followup` is **deliberately deferred** — the cockpit ships a complete UI for them so the cron + delivery code can land independently without a second design pass.

### Toast voice

Lift `toastVoice(action)` from `alex-config.jsx:41` verbatim into `apps/dashboard/src/lib/cockpit/alex-toast-voice.ts`. The shell calls `AGENT.toastVoice(action)` and surfaces the returned string. Custom `acceptToast` / `declineToast` on individual approvals (see §Schema extensions §3) override the default.

## Day-1 empty state

When `data.narrator` is present (no `Connection` rows, no completed setup), the cockpit renders `EmptyState` (`cockpit.jsx:767`) instead of the KPI strip + activity stream. Two stacked blocks:

1. **Narrator block** — warm-paper card with Alex's avatar + 1–2 first-person lines + a "NEXT MOVE" pill.
2. **Setup checklist** — 4 rows: `meta` (Connect Meta Ads, primary), `inbox` (Connect your inbox), `cal` (Connect consultation calendar), `rules` (Review pricing & escalation — pre-checked from onboarding).

Narrator copy is generated **client-side** from existing data (no new persistence — see §Backend changes §2). Default copy ships in the locked design:

```
eyebrow: "Alex · 8 min ago"
lines:
  "I'm set up and quiet. Connect Meta Ads and I'll pull the first leads in under a minute."
  "So Alex can qualify inbound leads and book consultations under your standing rules. I'll only interrupt you for pricing decisions over $89 and refunds."
nextMove: "Pull overnight leads from Meta Ads"
```

The `$89` and refund/escalation thresholds are templated from `AgentRoster.config` so the narrator references the operator's actual rules.

Setup row `onConnect` handlers route to `/setup?step={key}` deep links. No new onboarding logic — `EmptyState` is a presentation layer over the existing `/setup` wizard.

Composer remains enabled during cold state; contextual suggestion chips are empty.

## Backend changes

### 1. Persistence: `AgentRoster` target fields

Add storage for `avgValueCents` + `targetCpbCents` — used by Alex (booking value + cost-per-booking) and Riley (lead value + cost-per-lead). Same fields, different semantics per `agentRole`. Two paths the plan picks between:

**(a) Two nullable columns on `AgentRoster`:**

```prisma
model AgentRoster {
  // ...existing fields
  avgValueCents   Int?
  targetCpbCents  Int?
}
```

Pros: typed, indexable, migrations cleanly versioned, drift-checkable.
Cons: schema churn for a value most orgs initially leave null.

**(b) Two keys under `AgentRoster.config` (JSON):**

Pros: no migration; aligns with `priceApprovalThreshold` / `refundEscalationFloor` already living in `config`.
Cons: untyped at the storage layer; reads require defensive parsing.

**Recommendation:** **(b)** for symmetry with existing `config` knobs. Riley's spec is intentionally non-committal; this spec recommends `config`. Plan decides definitively.

### 2. Day-1 narrator state — **deferred out of Phase A**

The locked design's `EmptyState` block reads a narrator object (`{ eyebrow, lines[], nextMove, setup[] }`). Earlier drafts of this spec proposed persisting this as `AgentRoster.narratorState` (JSON column) populated by a server-side builder that rebuilds on `Connection` / `ManagedChannel` / config changes.

**This persistence is out of Phase A.** The cost (new column, new builder, new invalidation triggers) is high for a surface most operators see once. v1 instead derives narrator content **deterministically on the client** from the data the cockpit already has:

- `setup[].done` flags: computed from existing `Connection` rows (Meta Ads), `ManagedChannel` rows (inbox), and the calendar provider on `AgentRoster.config`.
- `lines[]`: rendered from a small client-side template that interpolates `config.priceApprovalThreshold` and `config.refundEscalationFloor`. No server round-trip beyond what the mission aggregator (A.2) already returns.
- `nextMove`: derived from whichever setup row is `primary: true` and not yet `done`.

If the templated copy proves insufficient — operators report the cold state feels generic — a follow-up spec adds the persistent narrator. Until then, the cockpit's cold state is a presentation layer over already-available data, with no new persistence surface.

### 3. API: mission aggregator

`GET /api/dashboard/agents/[agentId]/mission` returns:

```ts
{
  agentKey: AgentKey;
  displayName: string;             // AgentRoster.displayName
  mission: {
    role: string;                  // "SDR · qualify inbound leads, book consultations"
    pipeline: string;              // "Consultations pipeline · single funnel"
    brand: string;                 // org.displayName + (tagline ?? "—")
    channels: Array<{
      kind: "meta-ads" | "whatsapp" | "telegram" | "slack" | "calendar";
      label: string;
      status: "ok" | "warn" | "off";
    }>;
    rules: { priceApprovalThreshold: number; refundEscalationFloor: number } | null;
  };
  composerPlaceholder: string;
  commands: Command[];
  targets: {
    avgValueCents: number | null;
    targetCpbCents: number | null;
    roasSource: "deterministic" | "crm"; // alex → "deterministic"; riley → "crm"|"meta"
  };
  setup: Array<{
    key: "meta" | "inbox" | "cal" | "rules";
    done: boolean;
    primary?: boolean;
  }>; // populated by A.2 so EmptyState renders without re-deriving across Connection / ManagedChannel / config
  scoringCron?: { hourUtc: number; description: string }; // Riley-only; absent for Alex
}
```

One aggregator, agent-key-aware. Channel sources branch on agent role: Alex reads `ManagedChannel` + `Connection` (for Meta Ads); Riley reads `Connection` (for Meta Ads) and ignores `ManagedChannel`. The aggregator owns the branching so the dashboard hook is uniform.

`use-agent-mission.ts` (new): React Query hook keyed on agent ID; refetch on focus + on `HaltProvider` change.

### 4. API: metrics extension

`GET /api/dashboard/agents/[agentId]/metrics` already returns `MetricsViewModel`. Extend the response to include the new shapes (additive — keeps existing consumers working):

```ts
{
  ...existingMetricsViewModel,
  targets: { avgValueCents: number | null; targetCpbCents: number | null };
  tiles?: KpiTile[];     // Riley emits; Alex omits (legacy adapter on client)
  roi?: RoiBar;          // Riley emits; Alex omits (legacy adapter on client)
}
```

For Alex, `tiles` and `roi` are derived **on the client** via the ported `legacyTiles()` / `legacyRoi()` adapters from the existing flat shape. This keeps the backend single-purpose during v1.

Alex's `metrics-alex.ts` gains:

- `targetCpbCents` echo from `AgentRoster.config.targetCpbCents` (or column).
- `avgValueCents` echo from `AgentRoster.config.avgValueCents`.
- `spendCents` from `meta-campaign-insights-provider` (degrades to `null` when no `Connection`).

`buildAlexMetricsViewModel` returns the existing flat shape plus `{ target, avgValue, spend }` — the keys the locked design's `legacyRoi()` already reads.

### 5. API: activity stream

The cockpit's activity stream reads more than the existing `/api/dashboard/agents/activity` returns (it needs message previews + body copy + per-row tags). Two paths:

**(a) Extend the existing endpoint** with `?agentKey=alex&limit=N` filtering and an `expandPreview=true` query that joins the last 3–4 messages per row. Backwards-compatible.

**(b) New per-agent endpoint** `GET /api/dashboard/agents/[agentId]/activity?limit=N`. Cleaner; co-located with `mission` + `metrics` + `wins` + `pipeline`. Cost: more code.

**Recommendation:** **(b)**. Per-agent endpoints already exist for the four sibling data shapes; activity is the missing one. Plan-stage decision.

The translator at `apps/dashboard/src/hooks/use-agent-activity.ts` is rewritten to consume the new shape and emit `ActivityRow[]` (superset of today's `TranslatedAction[]`). The current `TranslatedAction` consumers (none outside agent-home, per a quick repo audit) are migrated at once.

### 6. Schema: `RecommendationPresentation` toast fields

Today's `RecommendationPresentationSchema` (in `packages/schemas/src/recommendations.ts`) carries `primaryLabel`, `secondaryLabel`, `dismissLabel`, `dataLines`. Add optional:

```ts
acceptToast: z.string().optional();
declineToast: z.string().optional();
```

Consumed by Riley's approval cards (per the Riley spec §Schema). Defined here because the cockpit shell uses the same toast lookup for both Alex's `Approval`-sourced cards and Riley's `Recommendation`-sourced cards — symmetry across the union type.

### 7. Schema: `Approval.payload.quote` / `quoteFrom`

Today's `Approval` schema persists a `summary` string + `payload: Json`. The cockpit needs:

```ts
Approval.payload = {
  ...existing,
  quote?: string;        // Inbound message or draft text that triggered the approval
  quoteFrom?: string;    // "Jordan F. · 11:53" or "Alex (draft)"
  body?: string;         // Operator-language description, first-person voice
};
```

These are **optional** — older approvals without them fall back to `summary` for both title and body, with no quote rendered. The skill-runtime `pendingApproval(...)` factory grows two optional args; the deterministic-gate and claim-classifier emit them when available.

### 8. No new DB tables

Everything above is column / JSON-field additions on existing tables.

## Shared cockpit shell — full Phase A file inventory

This section lists the **full Phase A finish line** of files under `apps/dashboard/src/`. Each file is assigned to a slice. A.1's actual file subset is listed in §A.1 file subset below.

```
components/cockpit/
  tokens.ts                  // A.1 — page-local color tokens
  kind-meta.ts               // A.1 (Alex kinds); Riley PR extends
  types.ts                   // A.1 — shared shell types (CockpitStatus, ApprovalView, ActivityRow, ThreadMessage); extended at A.2/A.3
  dot.tsx                    // A.1 — <Dot> primitive
  status-pill.tsx            // A.1 — <StatusPill>
  topbar.tsx                 // A.1 — <Topbar onOpenPalette compact />
  identity.tsx               // A.1 — <Identity statusKey halted subtitle line onHalt onEditMission compact />
  approval-block.tsx         // A.1 — array-tolerant <ApprovalBlock>
  approval-card.tsx          // A.1 — <ApprovalCard>
  activity-stream.tsx        // A.1 — <ActivityStream filter setFilter compact />
  activity-row.tsx           // A.1 — <ActivityRow> (collapsed-only at A.1)
  composer-placeholder.tsx   // A.1 — inert placeholder bar
  cockpit-page.tsx           // A.1 — top-level composition
  mission-popover.tsx        // A.2 — clickable subtitle target
  empty-state.tsx            // A.2 — Day-1 narrator + setup checklist
  kpi-strip.tsx              // A.3 — <KPIStrip> + <KPI> + collapsedHeadline
  roi-bar.tsx                // A.3 — <ROIBar>
  thread-preview.tsx         // A.4 — inline thread preview on activity-row expand
  composer.tsx               // A.5 — <Composer> with NL staging
  command-palette.tsx        // A.5 — <CommandPalette open onClose onRun />
  toast.tsx                  // A.5 — <Toast> (Alex voice)

lib/cockpit/
  alex-config.ts             // A.1 — accent, statusColor, statusPulse, animState, tabs, missionSubtitle
  decision-to-approval-view.ts // A.1 — PendingApproval → ApprovalView adapter
  activity-kind-map.ts       // A.1 — TranslatedAction → ActivityRow adapter
  relative-age.ts            // A.1 — client-side relative-age formatter
  legacy-shapes.ts           // A.3 — legacyTiles + legacyRoi ported
  alex-commands.ts           // A.5 — ALEX_COMMANDS catalog
  parse-command.ts           // A.5 — parseCommand(raw) ported from commands.jsx
  alex-toast-voice.ts        // A.5 — toastVoice(action) port
  targets.ts                 // A.3 — getAgentTargets(roster) config-or-column reader

hooks/
  use-cockpit-status.ts      // A.1 — deriveAlexStatusA1 + useCockpitStatusAlex
  use-agent-mission.ts       // A.2 — GET /api/dashboard/agents/[agentId]/mission
  (existing use-agent-metrics, use-agent-activity, use-agent-pipeline keep working;
   activity rewritten at A.4; metrics extended at A.3)

app/(auth)/[agentKey]/
  page.tsx                   // unchanged at A.1 (continues to wrap in EditorialAuthShell)
  agent-home-client.tsx      // A.1 — branches to CockpitPage for alex, LegacyAgentHomeClient otherwise
  legacy-agent-home-client.tsx // A.1 — verbatim copy of today's body; deleted at A.6
```

### A.1 file subset

The files **A.1 alone creates** (everything else above lands in later slices):

```
components/cockpit/
  tokens.ts, kind-meta.ts, types.ts, dot.tsx, status-pill.tsx, topbar.tsx,
  identity.tsx, approval-block.tsx, approval-card.tsx, activity-stream.tsx,
  activity-row.tsx, composer-placeholder.tsx, cockpit-page.tsx
lib/cockpit/
  alex-config.ts, decision-to-approval-view.ts, activity-kind-map.ts, relative-age.ts
hooks/
  use-cockpit-status.ts
app/(auth)/[agentKey]/
  agent-home-client.tsx (modified), legacy-agent-home-client.tsx (created)
```

### Candidate deletion list for A.6 cleanup

These files are **not deleted at A.1**. A.6 runs the deletion sweep after the cockpit has been stable in production through A.5 and after Riley's cockpit has shipped per its own spec. Each deletion is preceded by zero-reference verification.

```
components/agent-home/agent-block-boundary.tsx       (no other consumers expected post-A.5)
components/agent-home/greeting-block.tsx
components/agent-home/needs-you-block.tsx
components/agent-home/wins-block.tsx
components/agent-home/metrics-block.tsx
components/agent-home/pipeline-block.tsx
components/agent-home/prose-segments.tsx
components/agent-home/sparkline.tsx
components/agent-home/fixture-folio-badge.tsx
components/agent-home/portrait/                       (sprite system stub)
app/(auth)/[agentKey]/legacy-agent-home-client.tsx   (deleted after Riley cockpit ships)
```

If `/team`'s roster cards re-use any of the above (audit during A.6 plan), the `/team` refactor is a precursor PR to A.6 — not a bundled change.

## Dependencies + sequencing

This spec is the **shell-owner** half of the cockpit family. The Riley spec already exists at `docs/superpowers/specs/2026-05-13-riley-cockpit-home-design.md` and lists its dependency on the shell. Three implementation paths (the Riley spec calls this out; this spec re-affirms):

**Path A — Shell-first (recommended; chosen).** Land the shell with Alex's data wiring first. Land Riley's data wiring on top. The Alex spec is the lead; the Riley spec is the consumer. Both agents validate the same shell.

**Path B — Big-bang.** Single PR shipping both Alex and Riley simultaneously. Higher review surface, no benefit unless one half is blocked.

**Path C — Riley standalone now, refactor later.** Riley-only page bypassing the shell; rewritten when the shell ships. Throws away work. Only justified if Riley must ship before Alex's shell can be built.

**Chosen path: A**, sliced. The implementation plan for Alex sequences:

- **A.1:** Ship the shared cockpit shell (shell-owner files) + the smallest Alex composition that demonstrates the shell — identity, status pill, approval block (reading existing `usePendingApprovals`), activity stream (existing translator's row shape, no new endpoint). Old block components stay put. No backend changes. No schema changes. No command palette. No KPI/ROI. Per-agent branch: `agentKey === "alex" ? <CockpitPage /> : <LegacyAgentHomeClient />`.
- **A.2–A.5:** Land the remaining surface — mission popover (A.2), KPI/ROI (A.3), activity richness (A.4), composer + palette (A.5). Each gets its own plan and PR.
- **A.6:** Retire the legacy block components after zero-reference verification. Remove the per-agent branch after Riley's cockpit ships per its own spec.

The shell's type surface (array-tolerant `ApprovalBlock`, explicit `tiles[]` + `roi` schema for Riley, `ApprovalView` union accommodating both agents' `kind` enums) is **frozen at A.1** even though Alex doesn't exercise all of it yet. This is the contract that lets the Riley wiring land later without re-opening A.1's components. If a Riley use case can't be encoded with A.1's prop types, **A.1 fixes the types before merging** — not after Riley starts wiring.

## Out-of-scope deferrals (call-outs)

- **Pixel-sprite avatars.** Locked design ships sprite-based animated avatars (`sprite.jsx`, `sprites.jsx`, `riley-sprites.jsx`). v1 uses a static `<Mark />` SVG and an initial-letter frame. Sprites are a polish ramp.
- **Inline-reply send.** The thread-preview reply box collects text but routes to `/contacts/[id]` on submit instead of sending. One-line wire-through when the backend handler lands.
- **`brief` / `followup` scheduled delivery.** UI is complete; backend cron is post-v1.
- **`/team` migration.** This spec retires `/[agentKey]` block components but leaves `/team` (which may import them) on the existing roster card pattern. If `/team` imports any of the deleted blocks, it gets refactored to its own dedicated components in the same PR — but the design of `/team` itself is not in scope here.
- **Mira tab.** Tab renders muted; no body content. Wave 4 (Mira Home v3) owns the design.
- **CRM-confirmed booking value for Alex.** Alex computes `earned` deterministically from `bookings × avgValueCents`. CRM closed-won is Riley's true-ROAS path.
- **Mobile-specific affordances.** The shell's `compact` prop already handles ≤640px layouts via the locked design. No bespoke mobile-only UI in v1.
- **Polish: chip avatars, command-palette grouping nuances, sparkline previews.** All on the polish ramp.

## Acceptance criteria

### Phase A final acceptance criteria

This is the **Phase A finish line** — not what A.1 has to pass. Each slice's plan carries the subset that applies to its scope. A.1's specific list is in §A.1 acceptance criteria below.

1. Visiting `/alex` (logged in, with `alex` enabled) renders the cockpit shell parameterized by Alex's config: amber accent, Alex tab active, Riley tab inactive, Mira tab muted, status pill in one of `IDLE / TALKING / WAITING / HALTED`.
2. **Cold state:** no `Connection` rows for Meta Ads, no completed setup. Status=`IDLE`. `EmptyState` renders with narrator + 4-row setup checklist. KPI strip and activity stream do not render. Composer enabled but suggestion chips empty.
3. **Steady state (no approvals):** at least one Meta Ads `Connection`, ≥1 booking this week. Status=`TALKING` if `activeConversations > 0`, else `IDLE`. KPI strip shows 4 tiles (bookings/leads/qualified/spend) with trend deltas; `spend` shows unavailable hint if Meta insights aren't wired. ROI bar shows fill + CPB comparator; degrades cleanly when `avgValue` is null.
4. **Steady state (with approvals):** at least one pending Alex `Approval`. Status=`WAITING`. KPI strip collapses to single-line summary. ApprovalBlock renders one card per pending row, sorted `immediate → this_week`, then by `createdAt` desc within `immediate` and by `riskCategory` then `createdAt` within `this_week`.
5. **All 6 approval kinds** render correctly when present (pricing / refund / qualification / regulatory / safety-gate / escalation). Each gets the urgency-colored eyebrow + correct primary CTA copy + correct `body` / `quote` / `quoteFrom` provenance.
6. **Action wiring:** clicking an approval's primary button calls `respondToApproval({ bindingHash, verdict })` for `kind: "respond"` cards; calls the appropriate internal intent for `kind: "internal"` cards. Card hides optimistically; toast emits from `acceptToast`/`declineToast` if set, otherwise `AGENT.toastVoice`.
7. **Mission popover:** subtitle is clickable; popover shows 5 rows (Role / Pipeline / Brand / Channels / Rules) with channel status dots (Meta Ads + inbox + calendar). "Edit configuration" routes to `/settings`.
8. **`⌘K` palette:** opens on Cmd/Ctrl+K and on the topbar `Tell Alex…` button; lists Alex's commands grouped (`Control Alex` / `Per thread` / `Standing rules` / `Navigate`); free-form text is parsed via `parseCommand` and surfaced as a "From your text" highlighted row.
9. **Composer NL parser:** all 10 `parseCommand` patterns return the right `kind` + `label` + `detail`. Tested with the fixtures inside the parser file.
10. **Composer staging:** typing + Enter stages a chip; Confirm dispatches `runAction`; Undo clears. While a chip is staged, the input is disabled and reads `"Confirm or undo the action above…"`.
11. **Activity stream:** rows render with `time` + kind chip + `head`; expand to show `body` + `preview` thread + reply box (when applicable). Reply box's "Send as me" routes to `/contacts/[id]`; "Ask Alex to draft" routes to `/contacts/[id]?ask=draft`. "Tell Alex about {firstName}" affordance appears only when `who` is set.
12. **Activity filters:** `all` / `booked` / `escalations` work as specified (steady state); cold state shows `all` only with synthetic rows.
13. **Halt:** clicking `⏸ Halt` flips `HaltProvider.halted`, status pill turns red and reads `HALTED`, composer disables, button label flips to `▶ Resume`. Halt state is consistent with the existing `HaltProvider` (no parallel state machine).
14. **Retirement (A.6 only):** the existing `apps/dashboard/src/app/(auth)/[agentKey]/agent-home-client.tsx` and the `components/agent-home/*-block.tsx` files are deleted after zero-reference verification. Not bundled with the introduction of the new shell at A.1.
15. **Riley's route:** `/riley` continues to render the existing block-based home via the same `[agentKey]` page until the Riley spec's cockpit PR lands. The page's branching is `agentKey === "alex" ? <CockpitPage /> : <LegacyAgentHomeClient />` until Riley's cockpit ships, then both branches collapse and the legacy client is deleted at A.6.
16. Type-check, lint, and tests pass. New tests cover: Alex status derivation (all 4 A.1 states); KPI tile assembly (cold + steady); ROI degraded fallback (both hints); legacy adapter math; approval mapping for each of the 6 kinds; activity translator for each event source; `parseCommand` for each of the 10 patterns; mission aggregator for both `Connection`-present and `Connection`-absent paths; status-pill pulse rules.

### A.1 acceptance criteria

A.1 is the only thing the first PR has to pass. Every item from the Phase A list above that isn't here is **deferred** — do not attempt to satisfy it at A.1.

1. **Routing:** `/alex` renders `<CockpitPage>`; `/riley` and `/mira` continue to render `<LegacyAgentHomeClient>`. Per-agent branch lives in `agent-home-client.tsx`. The branching test asserts both paths.
2. **Status pill vocabulary:** A.1 supports `IDLE / WORKING / WAITING / HALTED` only. `TALKING`, `WATCHING`, `REVIEWING` are typed but unreachable from Alex's derivation at A.1. No `liveCount` rendered.
3. **No A.2–A.5 surfaces:** no KPI strip, no ROI bar, no mission popover, no `⌘K` palette, no composer NL parser, no `EmptyState`, no inline thread previews. KPI slot is an empty `<div />`; composer is an inert placeholder bar; activity rows are collapsed-only.
4. **Approval block:** renders from the existing `usePendingApprovals()` via the `decisionToApprovalView` adapter. Each row in the response surfaces as an `ApprovalCard` with the wire `summary` as the title, the `riskCategory`-derived urgency, and the `bindingHash` carried in `primaryAction`. **A.1 buttons are visually present but inert** — `respondToApproval` wiring lands at A.5 alongside the composer/palette work. The card layout is final; only the click handler is stubbed.
5. **Activity stream:** renders from the existing `useAgentActivity()` translator via the `activity-kind-map` adapter. Filter buttons (`all` / `booked` / `escalations`) switch state. Empty placeholder reads "Nothing here yet." when no rows match.
6. **Halt:** clicking the Halt button toggles `HaltProvider.halted` via the existing `useHalt()` hook (the provider remains mounted by `EditorialAuthShell`); status pill becomes `HALTED` (red, no pulse); composer placeholder switches to halted copy; button label flips to `▶ Resume`. **A.1 does NOT re-root `HaltProvider`** — the existing `EditorialAuthShell` continues to wrap the page and own the provider. Re-rooting is deferred to A.6 when the legacy shell goes away.
7. **No backend / schema changes:** no new API routes, no Prisma migrations, no `AgentRoster.config` field additions, no `Approval.payload` schema additions, no `RecommendationPresentation` toast fields.
8. **No deletions:** `components/agent-home/*-block.tsx` files remain; `agent-home-client.tsx`'s old body is moved verbatim to `legacy-agent-home-client.tsx`, not deleted. Deletion sweep is A.6.
9. **Type contract frozen:** shell prop types accommodate both Alex's and Riley's `ApprovalView` / `ActivityRow` shapes per the type sketch in §Appendix, even though Alex doesn't exercise all of it. A Riley-shaped `ApprovalView` fixture round-trips through `ApprovalCard` rendering in tests.
10. **Tests cover:** status derivation (all 4 A.1 states + pulse rules), `decisionToApprovalView` mapping (each `riskCategory` → urgency), `activity-kind-map` (each event source → kind), shell component snapshot + interaction tests, Halt-button toggle within `<CockpitPage>` (asserts handler calls `useHalt().setHalted`, status pill turns `HALTED`).
11. `pnpm typecheck` + `pnpm lint` + `pnpm --filter @switchboard/dashboard test` + `pnpm --filter @switchboard/dashboard build` all green locally. (`next build` is not in CI per project memory.)

## Risks

- **Shell scope creep.** Two real users of the shell (Alex + Riley) means small disagreements about the shell's API become expensive. Mitigation: PR-1 ships the shell with **both agents' input shapes typed**, even though only Alex consumes it at PR-1 time. Riley's spec is frozen first; the shell's prop types must satisfy Riley's spec exactly. If a Riley use case can't be encoded with PR-1's prop types, PR-1 fixes the types before merging — not after Riley starts wiring.
- **Approval payload schema drift.** Adding `quote` / `quoteFrom` / `body` to `Approval.payload` is a soft schema change (JSON column). Older approvals without them must render cleanly via the `summary` fallback. Tests must cover both shapes.
- **`AgentRoster.config` vs columns.** Picking `config` (JSON) over columns saves a migration but means every reader needs defensive parsing. Mitigation: a `getAgentTargets(roster): { avgValueCents: number | null; targetCpbCents: number | null }` helper at `packages/core/src/agent-home/targets.ts` is the only path to read these fields. Direct `roster.config.targetCpbCents` access in `metrics-alex` / `metrics-riley` is disallowed by lint convention.
- **Activity translator superset migration.** Today's `TranslatedAction` has fewer fields than `ActivityRow`. If `TranslatedAction` is consumed outside agent-home, the migration is wider than this PR can absorb. **Verification step in plan:** repo audit for `TranslatedAction` consumers; if >0 outside agent-home, decide whether to bridge or extend.
- **`HaltProvider` placement.** `HaltProvider` lives in `EditorialAuthShell`. The Phase A finish line replaces `EditorialAuthShell` for `/[agentKey]` routes, at which point `CockpitPage` would need to render its own `HaltProvider`. **At A.1 this is not in scope** — `page.tsx` continues to wrap the cockpit in `EditorialAuthShell`, and `CockpitPage` consumes the existing provider via `useHalt()`. Re-rooting happens at A.6 when the legacy shell is removed. The C2a lift already made the provider page-scoped, so re-rooting at A.6 is mechanically safe.
- **`Mark` brand logo.** The locked design's `<Mark />` SVG (eyes + smile) is the only brand presence in the topbar. Wave 1.5's shared-conventions doc may want this promoted to a shared component. v1 keeps it local; plan-stage decision.

## Open questions (defer to plan)

1. **`AgentRoster.config` vs columns** for `avgValueCents` / `targetCpbCents` (above).
2. **Activity endpoint shape** — extend existing or add per-agent (above §Backend §5).
3. **`brief` / `followup` scheduling backend** — defer to a follow-up spec? In v1 they stub and toast; the cron + delivery code is its own workstream.
4. **Mission popover "Edit configuration" target** — `/settings` is the default. If the future `/settings` rebuild reshuffles routes, this targets `/settings#rules` or equivalent.
5. **`/team` block usage audit** — does `/team` import any of the agent-home blocks marked for deletion? If yes, PR-1 needs a refactor budget for `/team`.
6. **Sprite system port** — if we ever ship the pixel-avatar sprites from the locked design, do they live in the shell or per-agent? Recommendation: per-agent (`apps/dashboard/src/components/cockpit/sprites/{alex,riley}.tsx`). Not in v1.

---

## Appendix: shell prop type sketch

For the plan's reference — the shell's exported types:

```ts
// apps/dashboard/src/components/cockpit/types.ts
export type CockpitStatus =
  | "IDLE"
  | "WORKING"
  | "TALKING"
  | "WAITING"
  | "WATCHING"
  | "REVIEWING"
  | "HALTED";

export interface MissionViewModel {
  subtitle: string;
  title: string;
  rows: Array<[string, string, ("ok" | "warn" | "off")?]>;
}

export interface KpiTile {
  label: string;
  value: number | string;
  unit?: string;
  trend?: string;
  unavailable?: boolean;
  hint?: string;
}

export interface RoiBarFull {
  label: string;
  leftMeta: string;
  rightMeta: { value: string; suffix: string };
  fillPct: number;
  breakEvenPct: number;
  breakEvenLabel: string;
  scaleLeft: string;
  scaleRight: string;
  comparator: { value: string; target: string; onTarget: boolean };
}

export interface RoiBarDegraded {
  degraded: true;
  degradedHint: string;
  label?: string;
  comparator: { value: string; target: string; onTarget?: false };
}

export type RoiBar = RoiBarFull | RoiBarDegraded;

export interface CockpitKpiData {
  range: string;
  tiles?: KpiTile[]; // explicit shape (Riley)
  roi?: RoiBar; // explicit shape (Riley)
  // legacy flat shape (Alex) — adapter on client
  booked?: number;
  bookedDelta?: string;
  leads?: number;
  leadsDelta?: string;
  qualifiedPct?: number;
  qualifiedDelta?: string;
  spend?: number;
  avgValue?: number;
  target?: number;
}

export interface ApprovalViewBase {
  id: string;
  urgency: "immediate" | "this_week" | "next_cycle";
  askedAt: string;
  title: string;
  body?: string;
  quote?: string;
  quoteFrom?: string;
  risk?: string;
  presentation: { primaryLabel: string; dismissLabel: string };
  primary: string;
  secondary: string;
  tertiaryLabel?: string;
  acceptToast?: string;
  declineToast?: string;
}

export type AlexApprovalView = ApprovalViewBase & {
  kind: "pricing" | "refund" | "qualification" | "regulatory" | "safety-gate" | "escalation";
  primaryAction:
    | { kind: "respond"; bindingHash: string; verdict: "accept" | "deny" }
    | { kind: "internal"; intent: string; parameters: Record<string, unknown> };
};

export type RileyApprovalView = ApprovalViewBase & {
  kind:
    | "pause"
    | "scale"
    | "refresh_creative"
    | "restructure"
    | "shift_budget_to_source"
    | "switch_optimization_event"
    | "harden_capi_attribution"
    | "hold"
    | "add_creative"
    | "review_budget"
    | "signal_health_group";
  campaign:
    | { kind: "campaign"; name: string; id: string }
    | { kind: "account"; pixelId: string; breaches: number };
  confidence: number;
  learningPhaseImpact: "no impact" | "will reset learning";
  reversible: boolean;
  primaryAction:
    | { kind: "internal"; intent: string; parameters: Record<string, unknown> }
    | { kind: "external"; url: string; service: "meta" | "google" };
};

export type ApprovalView = AlexApprovalView | RileyApprovalView;

export interface ActivityRow {
  time: string;
  kind: ActivityKind;
  head: string;
  body?: string;
  who?: string;
  preview?: Array<{ from: string; text: string }>;
  replyable?: boolean;
  tag?: string;
}

export type ActivityKind =
  // Alex
  | "booked"
  | "qualified"
  | "replied"
  | "sent"
  | "started"
  | "connected"
  | "waiting"
  | "escalated"
  | "passed"
  // Riley
  | "watching"
  | "reviewing"
  | "paused"
  | "scaled"
  | "rotated"
  | "shifted"
  | "restructured"
  | "alert";
```

The shell exports these from `apps/dashboard/src/components/cockpit/types.ts`; per-agent code imports them. No duplicate type definitions anywhere.
