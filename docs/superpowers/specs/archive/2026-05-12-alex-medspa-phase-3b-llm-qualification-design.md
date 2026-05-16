# Alex SG/MY Medspa — Phase 3b: LLM Qualification Sidecar + Operator-Confirmed Disqualification

**Status:** Design draft 2026-05-12. Implementation plan to follow.
**Parent spec:** [`2026-05-12-alex-medspa-phase-3-conversation-lifecycle-design.md`](./2026-05-12-alex-medspa-phase-3-conversation-lifecycle-design.md) — see §5.2 (qualification sidecar), §5.3 (operator-confirmed disqualification), §10 (Phase 3b slice).
**Prior phase (this initiative):** Phase 3a — mechanical lifecycle (`booked`, `escalated`, `stalled`), schemas + Prisma models + writer + hooks + cron. Merged 2026-05-12.
**Feature flag:** `alexMedspaSgMyGovernanceV1.lifecycleTagging.qualification` (sub-flag of `lifecycleTagging`; default off).
**Surface:** `packages/schemas`, `packages/db`, `packages/core`, `apps/api`, `apps/dashboard`, `skills/alex`.

---

## 1. Problem

Phase 3a established the mechanical lifecycle but leaves `qualified` / `disqualified` / `proposed_disqualified` unreachable: the runtime allowlist rejects them, `qualificationStatus` is always written as `"unknown"`, and Alex emits no qualification signal.

The parent Phase 3 spec §5.2/§5.3 prescribes the approach: Alex emits a structured `QualificationSignals` sidecar on each turn; a deterministic rule decides `qualified`; disqualification is two-step (system proposes, operator confirms/dismisses). This spec specifies the implementation surface, the exact sidecar protocol, the operator confirm/dismiss workflow, and the snapshot transition rules that prevent qualification thrash.

The two highest risks the design must protect against:

1. **Signal thrash** — a later, less informative turn must not overwrite an already-qualified status. A `qualified` lead asking "what time again?" emits a thin sidecar; the rule must not regress that lead to `unqualified`.
2. **Vague sidecar parsing** — free-floating JSON in Alex's response is ambiguous. A strict delimiter format, single trailing block, persisted raw on failure, is the only viable contract.

## 2. Goal

Ship the LLM-driven qualification layer that:

1. Extends `SkillExecutionResult` with an optional `qualificationSignals` field (precedent: 1d's `intentClass`).
2. Defines a strict trailing `<qualification_signals>{...}</qualification_signals>` sidecar protocol in Alex's response; parser strips the block from the user-visible response and validates the JSON against a Zod schema.
3. Persists the raw sidecar (and validation status) on `WorkTrace` for audit lineage.
4. Evaluates qualification per turn with a deterministic rule; updates `ConversationLifecycleSnapshot.qualificationStatus` and writes a `ConversationLifecycleTransition` when state actually advances.
5. Surfaces system-proposed disqualifications for operator review on the existing `/operator` page; confirm/dismiss endpoints terminate or revert.
6. Expands the runtime allowlist on `LifecycleWriter` from a single mechanical mode to a capability-aware union (`mechanical`, `qualification`), enabled per-org via sub-flags.
7. Stays observation-only — qualification does **not** gate outbound sends. Outbound continues through the 1c consent + 1d window/template chain unchanged.
8. Defaults the sub-flag off; rollout per-org.

## 3. Non-goals

Explicitly out of scope:

- Recommendations v1 integration (knowledge-gap, drop-off, re-engagement effectiveness, disqualification load) — Phase 3c.
- Outbound gating by `qualified` status (qualification is observation; spec §5.2).
- Auto-disqualification (operator-confirmed only; spec §5.3). Spam/junk auto-flag is a later refinement.
- Confidence tiers for `qualified` (`qualified_low/medium/high`) — binary v1; defer until labeled data exists.
- Contact-level lifecycle rollups (thread-level only; spec §13).
- Self-modifying skills.
- Markets beyond SG/MY; verticals beyond medspa.
- Phase 3a's five deferred hook seats (5a–5e). Each lands as a separate small PR to main per branch doctrine.

## 4. Sidecar protocol

### 4.1 Format

Alex emits a single trailing block, separated from prose by one or more blank lines:

```
<qualification_signals>
{
  "treatmentInterest": "HIFU",
  "preferredTimeWindow": "weekday evenings",
  "serviceableMarket": "SG",
  "buyingIntent": "soft",
  "budgetAcknowledged": null,
  "explicitDecline": false,
  "disqualifierCandidates": []
}
</qualification_signals>
```

### 4.2 Parser rules (strict)

The parser is part of `SkillExecutor` post-LLM-output handling. Rules applied in order:

1. Count occurrences of `<qualification_signals>` opening tags in the raw response.
2. If **count > 1**: treat the whole sidecar attempt as invalid. Strip every block from the user-visible response (so contacts never see protocol leakage). Persist raw under `WorkTrace.qualificationSignals` with `validationStatus: "multiple_blocks"`. Lifecycle evaluator is **not** invoked.
3. If **count == 0**: no sidecar attempt. Persist `null` (column stays NULL). Lifecycle not invoked.
4. If **count == 1**: strip the block from the user-visible response and attempt to JSON-parse + Zod-validate the contents.
   - JSON-malformed → persist raw + `validationStatus: "malformed_json"`. Lifecycle not invoked.
   - Zod-validation fails → persist raw + `validationStatus: "schema_mismatch"` plus error details. Lifecycle not invoked.
   - Validates → persist the structured object + `validationStatus: "ok"`. Lifecycle evaluator runs.

The user-visible response never contains the sidecar block, regardless of validation outcome (the block is always stripped if a `<qualification_signals>` opening tag is found — incomplete/malformed blocks still get cut from the visible response, so contacts never see protocol leakage).

### 4.2.1 "Partial" sidecar — what counts

The spec uses "partial sidecar" in §5.2's non-trivial-sidecar rule. To avoid ambiguity:

- **Partial-but-valid**: every *required* key is present, with values that may be `null` (where the schema allows), `"unknown"`, `"none"`, `false`, or an empty list. This passes Zod validation and proceeds to the monotonic-guard / rule-evaluation path. Example: `{ treatmentInterest: null, preferredTimeWindow: null, serviceableMarket: "unknown", buyingIntent: "none", budgetAcknowledged: null, explicitDecline: false, disqualifierCandidates: [] }`.
- **Missing required keys**: any required field absent from the object → `validationStatus: "schema_mismatch"`. Example: `{ treatmentInterest: "HIFU" }` fails (every other required key is missing).

Only the first shape ever reaches the lifecycle evaluator. The second shape is persisted with validation error details on `WorkTrace` and never invoked downstream.

### 4.3 `QualificationSignals` Zod schema

```ts
const QualificationSignalsSchema = z.object({
  treatmentInterest: z.string().nullable(),
  preferredTimeWindow: z.string().nullable(),
  serviceableMarket: z.enum(["SG", "MY", "unknown", "out_of_area"]),
  buyingIntent: z.enum(["none", "soft", "strong"]),
  budgetAcknowledged: z.boolean().nullable(),
  explicitDecline: z.boolean(),
  disqualifierCandidates: z
    .array(
      z.object({
        type: z.enum(["out_of_area", "wrong_treatment", "age_gated", "not_real_lead"]),
        evidence: z.string().min(1).max(280),
      }),
    )
    .max(4),
});
```

Width capped to 4 disqualifier candidates per turn — a defensive bound. Evidence quote capped at 280 chars; bounded to prevent prompt-injection bloat.

### 4.4 Persistence on WorkTrace

New column on `WorkTrace`:

```
qualificationSignals  String? @db.Text  // JSON: { validationStatus, payload?, errorDetails? }
```

Encoded shape:

```ts
type WorkTraceQualificationSignals =
  | { validationStatus: "ok"; payload: QualificationSignals }
  | { validationStatus: "multiple_blocks"; raw: string }
  | { validationStatus: "malformed_json"; raw: string }
  | { validationStatus: "schema_mismatch"; raw: string; zodError: unknown };
```

Operational queues (pending disqualifications, qualified leads) **must not** scan WorkTrace JSON. They query `ConversationLifecycleSnapshot` and `ConversationLifecycleTransition` directly. WorkTrace's role is audit lineage only.

## 5. Qualification evaluation

### 5.1 Determination rule (deterministic)

Mirrors parent spec §5.2:

```
qualified = treatmentInterest resolves to a BusinessFacts service or alias
        AND serviceableMarket IN ("SG", "MY")
        AND buyingIntent IN ("soft", "strong")
        AND explicitDecline == false
        AND disqualifierCandidates is empty
```

**Critical addition (this spec):** `treatmentInterest` must resolve to a known service in `BusinessFacts.services` (case-insensitive equality on `service.name` and `service.aliases[]`). A raw free-text `treatmentInterest` like "laser miracle fat removal" that does not bind to a service is **not sufficient** to mark `qualified`. Unresolved treatment names leave `qualificationStatus` at its prior value and are surfaced (in 3c) as a knowledge-gap recommendation.

`budgetAcknowledged` is observed on the snapshot for analytics but not required.

### 5.2 Snapshot mutation rules (monotonic-ish)

Qualification status moves with these allowed transitions; any other write is a no-op (snapshot unchanged):

| From                    | To                      | Trigger                                | Allowed |
|-------------------------|-------------------------|----------------------------------------|---------|
| `unknown`               | `qualified`             | rule passes                            | Yes |
| `unqualified`           | `qualified`             | rule passes                            | Yes |
| `unknown`               | `unqualified`           | sidecar present, rule fails *(see note)* | Yes |
| `qualified`             | `unqualified`           | any                                    | **No** |
| `qualified`             | `qualified`             | re-affirmed                            | Yes (no-op) |
| any                     | `proposed_disqualified` | `disqualifierCandidates` non-empty     | Yes *(see §5.3)* |
| `proposed_disqualified` | anything from sidecar   | normal sidecar                         | **No** |
| `proposed_disqualified` | prior status            | operator dismiss                       | Yes |
| `proposed_disqualified` | terminal `disqualified` | operator confirm                       | Yes (advances `currentState`) |

Note on `unknown → unqualified`: only allowed when the sidecar is **non-trivial**, defined as: at least one of the following holds — `treatmentInterest != null`, `serviceableMarket != "unknown"`, `buyingIntent != "none"`, `budgetAcknowledged != null`, `explicitDecline == true`, or `disqualifierCandidates` non-empty. A sidecar where every signal field is empty/`null`/default does **not** flip `unknown → unqualified` (treats it as "agent considered qualification but had nothing to report this turn").

`qualified` is non-terminal as a snapshot `currentState`; the snapshot's `qualificationStatus` carries across subsequent mechanical transitions (`stalled`, `booked`, `escalated`) per parent spec §4.3. This spec does not change that carry behavior.

### 5.3 System-proposed disqualification

When a turn's sidecar has at least one `disqualifierCandidates` entry:

- Write a `ConversationLifecycleTransition` with `trigger: "system_proposed_disqualification"`, `actor: "alex"`, evidence carrying:
  ```ts
  {
    candidateType: "out_of_area" | "wrong_treatment" | "age_gated" | "not_real_lead",
    evidenceQuote: string,           // from the sidecar
    priorQualificationStatus: "unknown" | "unqualified" | "qualified",
    workTraceId: string,             // pointer to the turn
  }
  ```
- Update the snapshot's `qualificationStatus` to `"proposed_disqualified"`. **`currentState` does not change.**
- Multiple candidates in one sidecar: write one transition with all candidates in evidence (`candidates: [...]` array; `candidateType` field omitted for the multi-candidate shape). Operator confirms or dismisses the whole proposal, not per-candidate.

Storing `priorQualificationStatus` in the proposal's transition evidence is load-bearing: it enables deterministic restore on operator dismiss without needing a separate "prior status" column on the snapshot.

### 5.4 Operator confirm / dismiss

**Confirm** allowed when:
- `qualificationStatus == "proposed_disqualified"` **and**
- `currentState NOT IN ("booked", "disqualified")`

Confirm allowed from `currentState` of `active`, `qualified`, `stalled`, or `escalated`. The `escalated` case is intentional: escalation indicates human is already engaged; a confirmed disqualification on an escalated thread is valid.

On confirm: write a transition `toState = "disqualified"`, `trigger = "operator_confirmed_disqualification"`, `actor = "operator"`, evidence carries `operatorId`, `confirmedAt`, and a pointer to the originating `system_proposed_disqualification` transition id. Snapshot updates: `currentState = "disqualified"`, `qualificationStatus` stays `"proposed_disqualified"`.

The `qualificationStatus` is intentionally left at `proposed_disqualified` after confirm rather than redefined. Two reasons: (a) the parent spec §4.2 enum has no `disqualified` qualificationStatus value, and adding one is a schema change we don't need; (b) `currentState = disqualified` is the canonical operator-confirmed terminal signal, while `qualificationStatus` records the system's surfaced verdict — they answer different questions and stay in their lanes. Queries asking "is this thread disqualified?" read `currentState`. Queries asking "did the system propose this?" read `qualificationStatus`.

**Dismiss** allowed when:
- `qualificationStatus == "proposed_disqualified"`

On dismiss: write a transition with `trigger = "operator_dismissed_disqualification"`, `actor = "operator"`, evidence carries `operatorId`, `dismissedAt`. Snapshot's `qualificationStatus` reverts to `priorQualificationStatus` (read from the most recent `system_proposed_disqualification` transition's evidence). `currentState` unchanged.

**Conflict responses:** API returns 409 with a structured payload (`{ reason: "already_booked" | "already_disqualified" | "not_proposed" }`) when the precondition fails. Idempotent confirm — a second confirm against a thread already `disqualified` returns 200 with `{ alreadyApplied: true }`, not 409 (the operator's intent matches the world).

## 6. LifecycleWriter — capability-aware

### 6.1 Capabilities

```ts
type LifecycleWriteCapability = "mechanical" | "qualification";
```

Renames the 3a `THREE_A_ALLOWED_STATES/TRIGGERS` constants to `MECHANICAL_ALLOWED_STATES/TRIGGERS` and adds `QUALIFICATION_ALLOWED_STATES/TRIGGERS`. The writer no longer references "3a" / "3b" by name.

Allowed sets:

```ts
const MECHANICAL_ALLOWED_STATES = new Set(["active", "stalled", "booked", "escalated"]);
const MECHANICAL_ALLOWED_TRIGGERS = new Set([
  "timer_24h_no_inbound",
  "inbound_after_stalled",
  "inbound_after_re_engagement_template",
  "booking_event_received",
  "governance_verdict_escalate",
  "operator_takeover",
]);

const QUALIFICATION_ALLOWED_STATES = new Set(["qualified", "disqualified"]);
const QUALIFICATION_ALLOWED_TRIGGERS = new Set([
  "qualification_checklist_met",
  "qualification_checklist_failed",
  "system_proposed_disqualification",
  "operator_confirmed_disqualification",
  "operator_dismissed_disqualification",
]);
```

`proposed_disqualified` is **not** a `currentState` value — it is a `qualificationStatus` value. The writer's state allowlist does not include it. The writer accepts a `proposedDisqualificationUpdate` input shape that mutates `qualificationStatus` only (see §6.3).

### 6.2 Capability resolution

`LifecycleConfigResolver` reads `lifecycleTagging.mechanical.mode` and `lifecycleTagging.qualification.mode` per-org from `GovernanceConfigResolver` and yields a `Set<LifecycleWriteCapability>`. Both flags default off; both can be enabled independently — but qualification implies mechanical at the resolver level (qualification depends on the snapshot existing, which mechanical bootstraps; if qualification is on and mechanical is off, the resolver logs `console.warn` and treats mechanical as on for the org).

The capability set is consulted per call; not cached at process start (per 3a's hardening note).

### 6.3 Writer interface changes

`LifecycleWriter` exposes two methods after 3b:

```ts
recordTransition(input: RecordTransitionInput): Promise<void>;  // currentState advances
updateQualificationStatus(input: UpdateQualificationInput): Promise<void>;  // qualificationStatus only
```

`updateQualificationStatus` is the seat for `proposed_disqualified` writes. It still writes a transition row (audit trail) but does not advance `currentState`. Internally both methods share the precedence + transaction machinery.

Both methods take the caller's effective `capabilities: Set<LifecycleWriteCapability>` (resolved by the bootstrap layer per org) and refuse to write values outside the allowed union. The error is loud — `LifecyclePrecedenceViolation` or a new `LifecycleCapabilityDenied` — never silent.

### 6.4 Monotonic guards inside the writer

Inside the transaction, after re-reading the existing snapshot, the writer applies the §5.2 monotonic table. If the proposed mutation would violate it (e.g. `qualified → unqualified`), the writer **silently no-ops** the qualification mutation but may still proceed with `currentState` advancement (the caller might be doing both).

Why silent here vs loud at capability gate: monotonic violations are **expected** behavior under thin sidecars on already-qualified threads (signal noise, not bugs). Capability violations are **caller bugs** (a 3a code path emitting 3b states) and need to fail loudly.

## 7. Event hook + bootstrap wiring

Two new hooks register in `apps/api/src/bootstrap/lifecycle.ts` (alongside 3a's five seats):

| Hook | Trigger | Action |
|---|---|---|
| `qualification-evaluation-hook` | `SkillExecutor` completes an Alex turn that produced a validated sidecar (`validationStatus: "ok"`) | Run rule. If `qualified`: `recordTransition({ toState: "qualified", trigger: "qualification_checklist_met" })`. If `disqualifierCandidates` non-empty: `updateQualificationStatus({ to: "proposed_disqualified", trigger: "system_proposed_disqualification", evidence })`. Else: no-op. |
| `disqualification-resolution-hook` | Operator confirm/dismiss API call | Confirm → `recordTransition({ toState: "disqualified", trigger: "operator_confirmed_disqualification" })`. Dismiss → `updateQualificationStatus({ to: priorStatus, trigger: "operator_dismissed_disqualification" })`. |

The qualification-evaluation-hook fires from `SkillExecutor` post-output handling (single integration point, no scatter across handlers).

### 7.1 Exactly what the sub-flag gates

The `lifecycleTagging.qualification` flag is **not** a master switch on sidecar handling. It gates only the lifecycle mutation and operator surface. The full breakdown:

| Behavior | Flag off | Flag on |
|---|---|---|
| `SkillExecutor` parses `<qualification_signals>` block | **Always** | Always |
| Sidecar block stripped from user-visible response | **Always** | Always |
| `WorkTrace.qualificationSignals` audit persistence (raw + validationStatus) | **Always** | Always |
| Lifecycle evaluator runs (rule, monotonic guard) | No (skipped) | Yes |
| Snapshot `qualificationStatus` mutated | No | Yes |
| `ConversationLifecycleTransition` rows written for qualification triggers | No | Yes |
| `system_proposed_disqualification` transitions written | No | Yes |
| Operator confirm/dismiss API routes registered | No (return 404) | Yes |
| `/operator` proposed-disqualifications panel rendered | No (hidden) | Yes |

Why parse/strip always: a flag flip is a config event, not a code deploy. If parsing were gated, then turning the flag on would suddenly start stripping tags from Alex's output — and during the off window, any sidecar tags Alex emitted (because the prompt update is decoupled from the runtime flag) would leak into the customer-facing response. Always-parse-always-strip is the only way to keep the customer surface clean across flag transitions.

Why audit persistence always: WorkTrace is the canonical audit lineage. We want a record of what Alex emitted regardless of whether the lifecycle layer chose to react to it (operationally useful when investigating "why didn't this lead get qualified" after a flag flip).

The disqualification-resolution-hook is invoked synchronously from the Fastify route handler under `apps/api/src/routes/lifecycle-disqualifications.ts`. No async event bus.

## 8. API surface

New routes under `apps/api/src/routes/lifecycle-disqualifications.ts`:

```
GET  /api/dashboard/lifecycle/disqualifications/pending
       → { items: PendingDisqualification[] }
       → org-scoped; reads ConversationLifecycleSnapshot
         WHERE organizationId = req.org
           AND qualificationStatus = 'proposed_disqualified'
           AND currentState != 'disqualified'                  -- see §8.1
         JOIN latest 'system_proposed_disqualification' transition for evidence

POST /api/dashboard/lifecycle/disqualifications/:threadId/confirm
       Body: { operatorNote?: string }
       → 200 { result: "confirmed" | "already_applied" }
       → 409 { reason: "already_booked" | "already_disqualified" }
       → 404 if no proposed disqualification for threadId

POST /api/dashboard/lifecycle/disqualifications/:threadId/dismiss
       Body: { operatorNote?: string }
       → 200 { result: "dismissed", restoredStatus: "unknown" | "unqualified" | "qualified" }
       → 409 { reason: "not_proposed" }
```

Auth: existing dashboard auth + org scoping. Audit: each mutation writes a `WorkTrace` row with `actorType: "operator"`, `intent: "lifecycle.disqualification.confirm" | "lifecycle.disqualification.dismiss"`, and a pointer to the resulting transition id.

Idempotency (tightened): confirm endpoint is idempotent **only when the thread's terminal `disqualified` state has a proposal lineage** — i.e. its history contains a `system_proposed_disqualification` transition. Then a repeat confirm returns 200 with `already_applied: true`. If `currentState == "disqualified"` but no `system_proposed_disqualification` transition exists in the thread's history (theoretically possible if a future phase introduces another path to terminal disqualified — auto-spam, mass-disqualify, etc.), confirm returns 409 with `reason: "already_disqualified"` instead. This avoids letting an operator silently "approve" a disqualification that was applied for an unrelated reason.

In 3b's own surface, every path to `currentState = disqualified` is the `operator_confirmed_disqualification` path, which requires a prior `system_proposed_disqualification` — so all 3b-disqualified threads have proposal lineage and repeat confirms return `already_applied`. The lineage gate is forward-compatible armour for later phases.

Dismiss is not idempotent (after dismissal, the state has moved on; a second dismiss returns 409 `not_proposed`).

### 8.1 Query doctrine — `currentState` is the source of truth for terminal disqualification

After operator confirm, the snapshot has `currentState = "disqualified"` and `qualificationStatus = "proposed_disqualified"` (per §5.4). This split-state can confuse downstream readers. Two doctrine rules avoid bugs:

- **"Is this thread disqualified?"** → read `currentState == "disqualified"`. **Never** infer disqualification from `qualificationStatus` alone.
- **"Is there a pending proposal awaiting operator action?"** → read `qualificationStatus == "proposed_disqualified" AND currentState != "disqualified"`. The second clause is load-bearing: without it, the pending queue would continue to include threads the operator has already confirmed.

These rules apply to any consumer — the pending-list API route above, future Recommendations v1 surfaces, ad-hoc analytics queries. The plan should include a small lint comment / helper function (e.g. `isPendingDisqualification(snapshot)`) so consumers don't reimplement the predicate inconsistently.

## 9. Dashboard UI surface

Embedded panel on the existing `/operator` page — no new top-level route in the editorial nav, no new Mercury Tools entry.

```
/operator
  ├── Existing operator queue
  └── Proposed disqualifications panel  (NEW, behind qualification sub-flag)
       ┌─────────────────────────────────────────────────────────────────────┐
       │ Proposed disqualifications · 4 pending                               │
       │ ─────────────────────────────────────────────────────────────────── │
       │  Thread             Candidate         Evidence            Actions   │
       │  Sarah Tan (HIFU)   wrong_treatment   "doesn't do fa..."   [Confirm]│
       │                                                            [Dismiss]│
       │  ...                                                                 │
       └─────────────────────────────────────────────────────────────────────┘
```

Implementation detail (not a product destination): the panel may be implemented as a Server Component fetching from `/api/dashboard/lifecycle/disqualifications/pending`, or as a nested route segment (`/operator/(panels)/disqualifications`) for code organization. Either is acceptable as long as the user-visible affordance is a panel on `/operator`, not a separate page.

Empty state ("No proposed disqualifications"): the panel collapses to a single-line muted note. Loading state: skeleton rows.

Behavior on Confirm/Dismiss click: optimistic update, mutation via React Query, revalidate on success. On 409, surface a one-line toast ("This thread was already booked — proposal dismissed automatically") and refresh the queue.

Recommendations v1 integration (a richer surface — disqualification load alerts, knowledge-gap recommendations, drop-off clusters) is **out of scope** for 3b. 3c picks it up.

## 10. Alex skill changes

### 10.1 SKILL.md update

`skills/alex/SKILL.md` gains a new section documenting the sidecar contract — exact tag format, schema, when to emit (every turn unless the response is purely a tool-call), how to indicate "not enough information yet" (emit the block with most fields `null` / `"unknown"` rather than omitting the block; this lets the system see the agent considered qualification).

Output guidance enforces: sidecar block always appears at the end, separated from the user prose by a blank line. Never two blocks. Never inside markdown code fences.

### 10.2 System prompt addition

A short prompt fragment (under the existing skill prompt assembly) instructs Alex to emit `<qualification_signals>{...}</qualification_signals>` per the schema. This addition is **declarative, not prescriptive** about content: it tells Alex what fields to populate, not what verdict to reach (the rule is deterministic and lives in code).

### 10.3 Regulatory references

`skills/alex/references/regulatory/sg-rules.md` and `my-rules.md` each get a brief "Phase 3b observation" note: qualification signals are observed, never block outbound, and operator-confirmed disqualification is the only path to `disqualified`. These are documentation for operators reviewing the skill — not load-bearing logic.

## 11. Storage

### 11.1 WorkTrace migration

Single new column:

```sql
ALTER TABLE "WorkTrace" ADD COLUMN "qualificationSignals" TEXT;
```

Backfills as `NULL` for existing rows. No data migration; existing turns predate 3b.

### 11.2 No new lifecycle tables

3b adds zero new tables. Snapshot, transition, and the WorkTrace column already accommodate the design.

### 11.3 Index considerations

The pending-disqualifications query is:

```
SELECT * FROM ConversationLifecycleSnapshot
WHERE organizationId = ? AND qualificationStatus = 'proposed_disqualified'
ORDER BY updatedAt DESC
LIMIT 50;
```

3a already created `@@index([organizationId, qualificationStatus, bookingStatus])` on `ConversationLifecycleSnapshot` (see parent spec §7.1) which covers this query. No new index needed.

## 12. Interaction with prior phases — unchanged contracts

- **1c (PDPA consent gate)** — qualification is observation; consent gates outbound only. A `qualified` lead with revoked consent still cannot receive outbound; this is correct.
- **1d (WhatsApp window + template registry)** — re-engagement of `qualified-and-stalled` leads goes through 1d unchanged. 3b adds no shortcut.
- **3a (mechanical lifecycle)** — `qualificationStatus` is now meaningfully populated on writes; the carry-across-mechanical-transitions behavior from parent spec §4.3 was already implemented and tested in 3a (a `qualified → stalled` transition preserves `qualificationStatus = "qualified"`).
- **Governance verdict chain** — qualification has no governance-verdict hook. It is not a mutating action; it is observation.

Single doctrine maintained: lifecycle is a caller of governance for outbound, never a peer.

## 13. Test fixtures

Module-level:

- `QualificationSignalsSchema` round-trips, including the bounded `disqualifierCandidates` size and evidence-string length.
- Sidecar parser: zero / one / multiple block cases; malformed JSON; schema mismatch; well-formed; sidecar inside markdown code fence (rejected — must be at top level); sidecar followed by trailing whitespace (accepted).
- Treatment resolver against a mock `BusinessFacts.services`: exact match, alias match, case-insensitive, unresolved free text (returns null → qualification cannot mark qualified).
- Rule evaluator: matrix of signal combinations covering each rule clause.
- Monotonic guard: `qualified → unqualified` no-op; `proposed_disqualified` not overwritten by thin sidecar; `unknown → unqualified` requires non-trivial sidecar.
- Capability gate: writer with `{mechanical}` only rejects qualification writes loudly; writer with `{mechanical, qualification}` accepts both.
- WorkTrace persistence: each `validationStatus` shape round-trips through the Prisma store.
- API: pending list excludes non-proposed; confirm idempotency; dismiss restore-from-evidence; 409 cases for confirm-on-booked and dismiss-on-not-proposed.
- Dashboard: panel renders with fixture data; mutations fire; optimistic update + revalidate.

Integration:

- Extends 3a's lifecycle integration test. New paths covered:
  - `active → qualified` via sidecar
  - `qualified → stalled → active → booked` with `qualificationStatus` carried through
  - `active → qualificationStatus: proposed_disqualified` (currentState stays active) → operator confirm → `disqualified` terminal
  - `qualified → proposed_disqualified` → operator dismiss → `qualified` restored
  - `proposed_disqualified` + concurrent `booking_event_received` → snapshot becomes `booked`; subsequent operator confirm returns 409
- Cross-phase with 1c: `qualified` lead becomes consent-revoked → outbound still blocked by 1c, lifecycle is unaffected.
- Capability flag-off: `qualification` flag off → hooks no-op even with valid sidecars; WorkTrace persistence still runs (audit only).

## 14. Phasing within Phase 3b

3b is small enough to ship as a single feature branch with subagent-driven implementation against task groups. Rough task ordering:

1. Schemas (`QualificationSignalsSchema`, `SkillExecutionResult` extension, sub-flag config)
2. WorkTrace column + migration
3. Sidecar parser + persistence on `SkillExecutor`
4. Capability-aware `LifecycleWriter` refactor (rename constants, add `updateQualificationStatus`)
5. Rule evaluator + treatment resolver
6. Event hooks (qualification-evaluation, disqualification-resolution)
7. Bootstrap wiring + sub-flag plumbing
8. API routes
9. Dashboard panel
10. Skill prompt + SKILL.md + regulatory reference updates
11. Integration test
12. Documentation pass

Each task group ends at a green test gate. Implementation plan (forthcoming) splits these into discrete subagent-executable steps with explicit task boundaries per `superpowers:subagent-driven-development`.

## 15. Open questions

1. **Treatment alias source.** §5.1 requires `treatmentInterest` to resolve to a BusinessFacts service or alias. The current `BusinessFacts.services` shape includes a `name` but may not have an `aliases[]` field — this needs verification in the implementation plan's pre-flight. If aliases don't yet exist, 3b either adds the field (small schema delta) or matches on `name` only with a follow-up to add aliases once knowledge-gap recommendations surface unresolved names.
2. **Multi-candidate evidence shape.** §5.3 proposes a single transition for multi-candidate sidecars with a `candidates: [...]` array. Alternative: one transition per candidate. Single-transition is simpler operationally (one Confirm/Dismiss action covers them all) and is the default — but worth verifying with a design partner that bundling reads naturally on the operator surface.
3. **WorkTrace.qualificationSignals shape evolution.** v1 stores the structured payload + validationStatus in a single JSON column. If 3c needs aggregate queries over invalid-sidecar rates, denormalizing `validationStatus` to its own column may be warranted — defer until 3c quantifies the need.
4. **Operator confirm note retention.** §8 accepts an optional `operatorNote: string` on confirm/dismiss. The note is stored on the resulting transition's evidence. Whether it surfaces back in any UI (e.g. tooltip on terminal-state threads) is a 3c surface concern.

## 16. Out of scope (reaffirmed)

- Recommendations v1 integration (knowledge-gap, drop-off, re-engagement effectiveness, disqualification load) — Phase 3c
- Outbound gating by qualified status (observation-only)
- Auto-disqualification (operator-confirmed only)
- Confidence tiers for qualified (binary v1)
- Contact-level lifecycle (thread-level only)
- Self-modifying skills
- Phase 3a deferred hook seats (separate small PRs)
- Markets beyond SG/MY; verticals beyond medspa
