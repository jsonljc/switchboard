# Alex SG/MY Medspa — Phase 3: Conversation Lifecycle + Outcome Tagging

**Status:** Design draft 2026-05-12. Implementation plan to follow.
**Parent spec:** [`2026-05-10-alex-medspa-sg-my-design.md`](./2026-05-10-alex-medspa-sg-my-design.md) §Phasing (row 3), §Outcome tagging (lines 244–250).
**Prior phases:**

- 1a (#409) — Skill directory + governance types + BusinessFacts service-field
- 1b-1 (#429) — Deterministic safety gate
- 1b-2 (#431) — Claim classifier + substantiation tiers
- 1c (#435) — PDPA consent state + outbound gate
- 1d (in design) — WhatsApp 24h window gate + template registry

**Feature flag:** `alexMedspaSgMyGovernanceV1.lifecycleTagging` (default off)
**Surface:** `packages/schemas`, `packages/db`, `packages/core`, downstream consumer in Recommendations v1

---

## 1. Problem

The parent spec §Outcome tagging (line 245) calls for extending the existing `inquiry → qualified → booked` conversion bus with `stalled` and `escalated`, and using daily batch analysis to surface knowledge gaps, drop-off patterns, and objection-frequency-vs-booking signal.

The parent spec is **shallow on determination mechanics**. It names states but does not specify:

- How `qualified` is decided (operator? Alex? deterministic checklist? classifier?).
- Whether the system stores only the terminal label or the full transition path.
- What re-engagement does to a `stalled` conversation, and how attribution flows back to the 1d template that re-engaged it.
- How lifecycle interacts with the 1c consent gate and the 1d window gate when the lifecycle layer wants to send a re-engagement.
- Where the data lives — WorkTrace, a dedicated table, or both.

If we ship a thin `terminal-label-only` model, we lose the drop-off analysis the parent spec promises. "Most stalls happen right after price disclosure" requires the **path**, not just the endpoint. Conversely, an over-modelled state machine (e.g. `re_engaged` and `qualified_not_booked` as primary states) creates state explosion and overlap that pollutes the dashboard query surface without adding signal.

This spec resolves those gaps.

## 2. Goal

Ship a conversation-lifecycle layer that:

1. Maintains a per-conversation **current-state snapshot** for dashboard filtering.
2. Maintains an append-only **transition log** for analytics and attribution.
3. Determines mechanical states (`booked`, `escalated`, `stalled`) from events/timers — no model inference.
4. Determines `qualified` from a **schema-bound `QualificationSignals` sidecar** emitted by Alex during normal turns.
5. Treats `disqualified` as **operator-confirmed by default** — system proposes, operator confirms.
6. Routes any lifecycle-initiated outbound (re-engagement) through the existing **1c consent → 1d window/template** chain. Lifecycle never bypasses governance.
7. Feeds derived recommendations into the existing **Recommendations v1 surface** (PRs #356 / #357). No new dashboard.
8. Ships behind a feature flag, default off.

## 3. Non-goals

Explicitly **out of scope** for Phase 3:

- New dashboard surface for lifecycle (consume Recommendations v1 only).
- LLM-based qualification classifier as the primary path (sidecar first; classifier is a follow-up if sidecar quality is poor).
- Real-time auto-disqualification (operator confirmation required; pure spam/junk detection is a later refinement).
- Self-modifying skills — Alex does not edit its own SKILL.md based on lifecycle patterns. Operator-mediated only (parent spec §Pattern surfacing).
- Cross-conversation contact-level state (Phase 3 keys on conversation thread, not contact). A contact-level lifecycle aggregation can come later.
- Auto-pricing of re-engagement template sends. 1d's `costEstimateStatus: "not_priced_in_1d"` carries forward; cost gating remains a separate Phase 2 layer.
- Markets beyond SG/MY.
- Verticals beyond medspa.

## 4. Lifecycle model

### 4.1 Primary states (six)

```ts
type ConversationLifecycleState =
  | "active"        // initial; Alex or operator engaging
  | "qualified"     // QualificationSignals checklist threshold met
  | "stalled"       // ≥24h since last Alex outbound, no inbound from contact
  | "booked"        // booking integration emitted a calendar event
  | "disqualified"  // operator-confirmed not a viable lead
  | "escalated";    // handoff fired (governance verdict or operator takeover)
```

`re_engaged` and `qualified_not_booked` are **deliberately excluded** as primary states:

- **`re_engaged`** — has no stable snapshot meaning. Re-engagement is a transition event with attribution metadata (which template, which lag), not a state a conversation lives in. Modelled as a transition with `trigger: inbound_after_re_engagement_template`.
- **`qualified_not_booked`** — overlaps with `qualified`, `stalled`, and explicit-decline scenarios. Modelled as a derived segment over `qualificationStatus` + `bookingStatus` + `currentState`.

### 4.2 Snapshot fields

The snapshot carries the current state plus orthogonal attributes that survive state transitions:

```ts
type ConversationLifecycleSnapshot = {
  conversationThreadId: string;
  currentState: ConversationLifecycleState;
  qualificationStatus: "unknown" | "unqualified" | "qualified" | "proposed_disqualified";
  bookingStatus: "not_booked" | "booked";
  dropoffReason:
    | null
    | "no_reply"
    | "explicit_decline"
    | "price_objection"
    | "out_of_area"
    | "wrong_treatment"
    | "operator_marked_not_ready";
  lastTransitionAt: Date;     // when currentState last changed
  lastEvaluatedAt: Date;      // when lifecycle evaluator last considered this thread, even if no state change
  updatedAt: Date;
};
```

`lastTransitionAt` and `lastEvaluatedAt` are distinct on purpose. `lastTransitionAt` answers "when did this thread last move." `lastEvaluatedAt` answers "when did we last look." The cron sweep can skip threads with `lastEvaluatedAt > now - 1h` to avoid re-walking message history that hasn't changed; recommendation generators can flag stale snapshots; replay jobs can verify rebuild correctness by comparing reconstructed snapshot's `lastTransitionAt` to the live row.

If concurrency becomes an issue (multiple writers racing on the same snapshot), add `stateVersion: number` as an optimistic-locking field. Not in v1 — the per-thread write rate doesn't justify it.

Why orthogonal attributes vs more states: a `stalled` lead can simultaneously be `qualified` with a `price_objection` dropoff reason. Encoding that as a single state (`qualified_stalled_price_objection`) is state explosion. Encoding it as orthogonal attributes lets the dashboard answer "stalls clustered around price objections" with a one-line filter.

### 4.3 State precedence and terminality

States have explicit terminality semantics so that late or concurrent events do not fight each other:

| State | Terminality | Override rules |
|---|---|---|
| `booked` | Terminal by default | Only operator/integration may manually reopen (e.g. cancellation). Cron must never overwrite a `booked` row to `stalled` even if booking timestamp is older than 24h with no further inbound. |
| `disqualified` | Terminal until operator reverts | Operator dismissal of a confirmed disqualification reverts to the prior state (recorded as a transition). No automated path exits `disqualified`. |
| `escalated` | Operationally terminal for Alex automation; **not** terminal for the conversation | A `booked` event arriving on an `escalated` thread (operator closes a booking after takeover) **does** transition to `booked`. This is intentional: escalation stops Alex but does not end attribution. |
| `stalled` | Non-terminal | Re-opens on inbound (§5.4). |
| `qualified` | Non-terminal | Carried as `qualificationStatus` across `stalled`/`booked`/`escalated` transitions. |
| `active` | Non-terminal | Default. |

**Precedence ordering when multiple events race** (highest wins):

```
booked > disqualified > escalated > stalled > qualified > active
```

Concretely: if the cron sweep is mid-flight when a `BookingCreated` event arrives for a `qualified` thread, the booking writes `currentState = booked` and the cron's pending `stalled` write must be discarded for that thread (re-check `currentState` inside the cron's transaction before writing). Same for `escalated`-then-`booked` ordering — the booking always wins because `booked` is highest precedence.

The one exception is `escalated → booked`: this is allowed (and expected — operators close bookings after takeover) and is recorded as a transition rather than treated as a precedence violation.

### 4.4 Transition log

Append-only event log. One row per meaningful state change:

```ts
type ConversationLifecycleTransition = {
  id: string;
  organizationId: string;
  conversationThreadId: string;
  contactId: string;
  fromState: ConversationLifecycleState | null; // null for initial active
  toState: ConversationLifecycleState;
  trigger: ConversationLifecycleTrigger;
  evidence: Record<string, unknown>; // schema-bound per trigger; see §6
  actor: "system" | "alex" | "operator" | "integration";
  workTraceId: string | null; // pointer to canonical audit row when applicable
  occurredAt: Date;
};
```

Triggers are an enumerated set tied to the determination mechanics in §5:

```ts
type ConversationLifecycleTrigger =
  | "qualification_checklist_met"
  | "qualification_checklist_failed"
  | "timer_24h_no_inbound"
  | "inbound_after_stalled"
  | "inbound_after_re_engagement_template"
  | "booking_event_received"
  | "governance_verdict_escalate"
  | "operator_takeover"
  | "operator_confirmed_disqualification"
  | "operator_dismissed_disqualification"
  | "system_proposed_disqualification";
```

Re-engagement attribution is a **transition-log query**, not a state. To answer "did re-engagement template X drive a booking?":

```
find conversations where transitions contains:
  (toState='active', trigger='inbound_after_re_engagement_template',
   evidence.template_id='re_engagement_offer_sg_v1')
  AND currentState='booked'
```

## 5. Determination mechanics

### 5.1 Mechanical states (event/timer-driven, no inference)

| State | Trigger | Evidence captured |
|---|---|---|
| `booked` | Booking integration writes a calendar event linked to `contactId` | `booking_id`, `calendar_event_id`, `service_id` |
| `escalated` | (a) Governance emits `GovernanceVerdict.action='escalate'` (1b-1, 1b-2, 1c), or (b) operator takes over thread in dashboard | `verdict_id` + `verdict_reason`, or `operator_id` + `takeover_at` |
| `stalled` | Cron sweep: `last_alex_outbound_at` ≥ 24h ago AND no inbound since AND `currentState NOT IN ('booked', 'escalated', 'disqualified')` | `last_outbound_at`, `last_inbound_at`, `hours_since_outbound` |

Cron cadence: hourly. The 24h boundary doesn't need higher resolution; hourly bounds the worst-case "stalled by 25h, marked at 26h" gap to within an hour, which is acceptable for analytics and re-engagement-eligibility signal.

**Source of `last_alex_outbound_at` and `last_inbound_at`** — these are derived from `ConversationMessage` rows (filter by direction + actor), **not** from any WhatsApp-window field on `ConversationThread`. The 1d WhatsApp 24h window is keyed on `last inbound from contact` (the Meta service-window definition); lifecycle `stalled` is keyed on `last Alex outbound with no later inbound` (a different timestamp). Conflating the two would produce wrong stalled-eligibility signal — e.g. a conversation where the contact messaged Monday 9am and Alex replied Monday 9:05am has its WhatsApp window close Tuesday 9am but does not become lifecycle-`stalled` until Tuesday 9:05am.

For 3a, compute these fields from `ConversationMessage` query (no new column). If hourly cron pressure becomes a problem, denormalise onto the snapshot in a follow-up — premature otherwise.

### 5.2 `qualified` — `QualificationSignals` sidecar

Alex emits a structured sidecar alongside its normal response, schema-bound:

```ts
type QualificationSignals = {
  treatmentInterest: string | null;        // e.g. "HIFU"; resolved against BusinessFacts services
  preferredTimeWindow: string | null;       // free text from contact, e.g. "weekday evenings"
  serviceableMarket: "SG" | "MY" | "unknown" | "out_of_area";
  buyingIntent: "none" | "soft" | "strong";
  budgetAcknowledged: boolean | null;       // true if budget was discussed and acknowledged
  explicitDecline: boolean;                 // contact said no/not interested
  disqualifierCandidates: Array<{
    type: "out_of_area" | "wrong_treatment" | "age_gated" | "not_real_lead";
    evidence: string;                       // short quote or paraphrase
  }>;
};
```

**Why sidecar from Alex, not a separate post-hoc classifier:**
- Alex already needs treatment / availability / market to respond well — sidecar is near-zero extra cost.
- A second model pass adds latency and a separate eval surface.
- Sidecar is tightly schema-bound and validated; non-conforming sidecars fall back to `unknown` rather than corrupting state.

**Emission mechanism (decided):** extend `SkillExecutionResult` with an optional `qualificationSignals` field, mirroring the precedent 1d set with `intentClass`:

```ts
interface SkillExecutionResult {
  response: string;
  intentClass?: IntentClass;            // 1d
  qualificationSignals?: QualificationSignals;  // 3b
}
```

This avoids introducing a second skill-output channel. Output handling:

1. Parse `qualificationSignals` against the Zod schema.
2. **Valid** → persist to `WorkTrace` for the turn → lifecycle evaluator consumes → snapshot/transition update if the qualification rule passes.
3. **Invalid** → persist a validation-failure record to `WorkTrace` (same turn) → lifecycle does **not** update qualification → recommendation surfaces sidecar-quality issues if the failure rate exceeds a threshold.

Alex's prompt is updated in 3b to emit the sidecar; existing skills that do not emit it are unaffected (field is optional).

**Qualification rule (deterministic):**

```
qualified = treatmentInterest != null
        AND serviceableMarket IN ("SG", "MY")
        AND buyingIntent IN ("soft", "strong")
        AND explicitDecline == false
        AND disqualifierCandidates is empty
```

Budget acknowledgement is **observed, not required** — some flows don't discuss budget before booking. Budget signal is preserved on the snapshot for analysis (does requiring it correlate with booking rate?) without being a hard gate.

**Confidence tiers** (`qualified_low` / `qualified_medium` / `qualified_high`) are **deferred** — start with binary `qualified | unqualified`. Tiers can be added once we have labeled sidecars and outcomes to calibrate against.

### 5.3 `disqualified` — operator-confirmed only

The system never auto-applies `disqualified`. Two-step:

1. **System proposes.** When a sidecar surfaces a `disqualifierCandidates` entry, the system writes `qualificationStatus = "proposed_disqualified"` and emits a transition row with `trigger: "system_proposed_disqualification"`. `currentState` does **not** change. A recommendation appears on the operator dashboard ("Propose disqualifying — out_of_area, evidence: …").
2. **Operator confirms or dismisses.** Confirmation transitions `currentState → disqualified` with `trigger: "operator_confirmed_disqualification"`. Dismissal reverts `qualificationStatus` to its prior value with `trigger: "operator_dismissed_disqualification"`.

**Why:** disqualification is revenue-impacting. The cost of a false positive (silently throwing away a viable lead) is far higher than the cost of an operator click. Hard auto-disqualification (spam/junk) is a later refinement once operator-confirmation data calibrates the threshold.

### 5.4 Re-opening — preserves the same conversation thread

When a `stalled` conversation receives an inbound, it transitions back to `active` (or `qualified` if signals carry forward). **A new conversation is not created.** Two trigger variants distinguish attribution:

- `trigger: "inbound_after_re_engagement_template"` — there is an outbound 1d template send between the previous Alex outbound and this inbound, and the inbound landed within an attribution window (default 7 days). Evidence carries `template_id`, `outbound_message_id`, `response_lag_h`.
- `trigger: "inbound_after_stalled"` — no qualifying re-engagement template; the contact came back on their own.

This preserves the thread + qualification context while still letting attribution queries credit (or not credit) re-engagement templates for downstream bookings.

## 6. Triggering — hybrid event + cron

| Source | Mechanism | Example |
|---|---|---|
| Booking integration | Event on `BookingCreated` | → `currentState=booked` |
| Governance verdict | Hook on `GovernanceVerdict` write where `action='escalate'` | → `currentState=escalated` |
| Operator takeover | Event on `ConversationThread.assignedOperatorId` change | → `currentState=escalated` |
| Inbound message | Event on inbound; if `currentState=stalled`, evaluate re-engagement attribution window | → `currentState=active`, trigger variant per §5.4 |
| Sidecar emit | Event on Alex turn complete; evaluate qualification rule | → `currentState=qualified` if rule passes, else snapshot only |
| Operator confirm/dismiss disqualification | UI event | → `currentState=disqualified` or revert |
| 24h timer | Hourly cron sweep | → `currentState=stalled` for matching threads |

The cron is the **only** time-based path. Everything else is event-driven, which means the dashboard sees state changes within seconds of the underlying event rather than waiting for a daily batch (parent spec line 247 said "daily batch" — this spec narrows that to "cron for time-based only").

## 7. Storage

### 7.1 Two new Prisma models

```
model ConversationLifecycleSnapshot {
  conversationThreadId  String   @id
  organizationId        String
  contactId             String
  currentState          String   // ConversationLifecycleState
  qualificationStatus   String   // "unknown" | "unqualified" | "qualified" | "proposed_disqualified"
  bookingStatus         String   // "not_booked" | "booked"
  dropoffReason         String?
  lastTransitionAt      DateTime
  updatedAt             DateTime @updatedAt

  @@index([organizationId, currentState])
  @@index([organizationId, qualificationStatus, bookingStatus])
  @@index([organizationId, currentState, lastTransitionAt])
}

model ConversationLifecycleTransition {
  id                    String   @id @default(cuid())
  organizationId        String
  conversationThreadId  String
  contactId             String
  fromState             String?
  toState               String
  trigger               String
  evidence              Json
  actor                 String   // "system" | "alex" | "operator" | "integration"
  workTraceId           String?
  occurredAt            DateTime @default(now())

  @@index([organizationId, conversationThreadId, occurredAt])
  @@index([organizationId, toState, occurredAt])
  @@index([organizationId, trigger, occurredAt])
}
```

### 7.2 Why a dedicated table, not WorkTrace-only

WorkTrace is canonical persistence (CLAUDE.md §Core Invariants), but it is optimised for audit lineage, not analytics queries. Lifecycle queries — "all stalled leads," "qualified→stalled count this week," "stalled→booked conversion within 7 days of re-engagement" — need indexes the WorkTrace stream cannot afford. The compromise is a dedicated table with an **optional `workTraceId` pointer** for transitions that have a corresponding canonical audit entry (e.g. governance-driven `escalated`).

### 7.3 Snapshot maintenance

The transition write and snapshot upsert happen in the same DB transaction. The snapshot is recoverable from the transition log (replay), so it is a denormalised cache, not the source of truth.

### 7.4 Sidecar persistence

`QualificationSignals` is persisted on `WorkTrace` for the Alex turn that produced it (sidecar belongs to the audit lineage of the turn, not to lifecycle directly). Lifecycle reads the latest sidecar for a thread when re-evaluating qualification.

## 8. Interaction with 1c and 1d — governance is authoritative

A common failure mode would be: lifecycle decides "this lead is stalled and re-engagement is due" and fires a template directly, bypassing the consent and window gates. **This must not happen.**

The flow:

```
Phase 3 lifecycle           Existing governance chain
─────────────────           ─────────────────────────
"re-engagement due"  ──>   1c consent gate
                              ├─ MY: dataProcessingConsentStatus must == granted
                              └─ SG: messagingOptIn must hold
                              ↓
                           1d WhatsApp window gate
                              ├─ outside-window check
                              ├─ template registry lookup by intentClass
                              └─ allow / substitute / handoff verdict
                              ↓
                           adapter send-time checks
                              ↓
                           outbound dispatched (or blocked)
```

Lifecycle's role is to **request** an outbound action and tag it with `intentClass: "re-engagement-offer"` (hyphen form per 1d's `IntentClass` enum). The decision to send is governance's. If 1c blocks (e.g. consent revoked), the lifecycle gets back a `blocked` response and writes no transition; the conversation stays `stalled`. If 1d substitutes successfully, the eventual inbound (if any) writes the `inbound_after_re_engagement_template` transition.

This separation means a single doctrine: **only one outbound governance chain exists, and lifecycle is a caller, not a peer.**

## 9. Surfaces — Recommendations v1 only

Phase 3 ships **no new dashboard**. Derived signals feed into Recommendations v1 (PRs #356 / #357 already shipped, recorded in `project_recommendations_v1_shipped.md`) as new recommendation types:

| Recommendation type | Trigger query |
|---|---|
| Knowledge gap: topic | `escalated` transitions where `verdict_reason` clusters around an unknown topic |
| Drop-off: stage | `stalled` snapshots clustered by last sidecar's `treatmentInterest` or `dropoffReason` |
| Re-engagement effectiveness | Conversion rate of `inbound_after_re_engagement_template` → `booked` per template |
| Operator-disqualification load | Pending `proposed_disqualified` count exceeding threshold |

These are batch-computed (daily) into the recommendations queue. The lifecycle event/cron layer is real-time; the **recommendation generation** is batch, which keeps cost predictable.

## 10. Phasing within Phase 3

Phase 3 splits into three landings, each independently shippable behind a sub-flag of `alexMedspaSgMyGovernanceV1.lifecycleTagging`:

| Slice | Scope | Sub-flag |
|---|---|---|
| **3a** | Schemas + Prisma models + transition writer + mechanical state determination (`booked`, `escalated`, `stalled` cron) — no `qualified` yet | `lifecycleTagging.mechanical` |
| **3b** | `QualificationSignals` sidecar from Alex + qualification rule + snapshot updates + operator-confirmed disqualification flow | `lifecycleTagging.qualification` |
| **3c** | Recommendations v1 integration (knowledge-gap, drop-off, re-engagement-effectiveness, disqualification-load recommendation types) | `lifecycleTagging.recommendations` |

Sequencing: 3a unblocks 3b (writer must exist before sidecar consumes it). 3b unblocks 3c (qualification data is required for the most useful recommendations). 3a is independently useful: even without qualification, having mechanical lifecycle states + transition log gives operators a "show me all stalled leads" filter on existing surfaces and starts accumulating the data Phase 3c will analyse.

## 11. Test fixtures

| Slice | Fixture coverage |
|---|---|
| 3a | All mechanical transitions (`booked`, `escalated` from each verdict source, `stalled` cron); transition log is append-only and survives snapshot rebuild via replay; cron correctly excludes `booked`/`escalated`/`disqualified` from `stalled` candidates; re-opening from `stalled` writes the correct trigger variant per attribution window |
| 3b | Sidecar schema validation (malformed sidecar → `unknown`, never corrupts state); qualification rule passes/fails for matrix of signal combinations; sidecar persistence on WorkTrace; operator-confirm and operator-dismiss paths both write transitions and revert `qualificationStatus` correctly |
| 3c | Each recommendation type generates from canned fixture data; recommendations idempotent across batch runs; recommendation surfaces respect the `alexMedspaSgMyGovernanceV1` tenant scoping |

Cross-phase: 3a + 1d integration — re-engagement template substituted by 1d, eventual inbound, transition written with attribution metadata; 3b + 1c integration — proposed disqualification due to MY consent revocation surfaces correctly without auto-applying.

## 12. Open questions

1. **Re-engagement attribution window.** Default 7 days. Is that right for SG/MY medspa? Could be 14 or 30 — operator bookings often take a week or two of consideration. Worth checking with a design partner before launch.
2. **Contact-level aggregation.** Phase 3 keys on conversation thread. A single contact may have multiple threads (different inquiries over time). Whether lifecycle ever rolls up to contact level is deferred but worth a stub on the schema (contact-level snapshot view) so we don't repaint the storage layer later.
3. **Booking-integration coverage.** §5.1 assumes a booking integration emits `BookingCreated`. Today's coverage of integrations and their event surface is not audited; this spec assumes the integration story is solid by the time 3a lands.
4. **Cost/budget interaction with 1d.** Re-engagement templates are paid (parent 1d spec §1.1). Lifecycle requesting re-engagement at scale could meaningfully affect cost. Phase 2 cost-gating layer must read lifecycle's re-engagement-due signal and apply caps before the template fires. This is a Phase 2 concern but the data hand-off needs to be designed once Phase 2 begins.

## 13. Out of scope (reaffirmed)

- New dashboard surface (Recommendations v1 is the only consumer)
- LLM-based qualification (deferred until sidecar quality is measured)
- Auto-disqualification (operator-confirmed only)
- Self-modifying skills
- Contact-level lifecycle (thread-level only)
- Cost/budget gating of re-engagement (Phase 2)
- Confidence tiers for `qualified` (binary in v1)
- Markets beyond SG/MY, verticals beyond medspa
