# Tier 3 - "The loop closes" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read [`2026-06-10-riley-remediation-00-overview.md`](./2026-06-10-riley-remediation-00-overview.md) first for the shared guardrails, the answered open decisions, and the cross-slice integration review - they are not repeated here.

**Goal:** Close Riley's revenue loop. Today the moat ("acts, measures the act, gets better, and feeds the creative agent") is wired but inert: the booked-value the trueROAS / corroborated arm needs is always `0`, operator verdicts are discarded instead of learned-from, the enriched outcome ledger is write-only into judgment, and Riley's diagnosis never reaches Mira as data. This tier ships the _missing producers_ for already-built consumers, and the _missing consumers_ for already-built producers, each with a test that runs from the real producer's default output.

**Architecture:** Five PRs, ordered so the highest-leverage producer lands first. PR 3.1 stamps `Opportunity.estimatedValue` at the live creators so a `booked` ConversionRecord carries a real value (un-darkens trueROAS + the corroborated arm + CAPI dispatchability in one move). PR 3.2 turns the discarded operator approve/reject verdicts into a bounded, abstaining per-org confidence modifier (the first learning wire). PR 3.3 threads Riley's diagnosis into the Mira brief payload AS DATA and flips the enrichment flag default-on. PR 3.4 feeds the enriched outcome ledger back into the arbitration / pause-floor input (the IMPROVE-leg consumer for the attribution cron) and is the consumer half of D9-5. PR 3.5 preps attribution coverage for `shift_budget_to_source` behind its hard Spec-1B dependency. Two still-missing flywheel edges (D6-4, D6-5/D1-3) close the doc as design stubs, post-pilot stretch.

**Tech Stack:** TypeScript, Zod (packages/schemas), Vitest. Core engine (`packages/ad-optimizer`, `packages/core/src/recommendations`), the booking tool (`packages/core/src/skill-runtime`), the DB store layer (`packages/db`), and the API workflow seams (`apps/api`). No new env var except the flag-default change in PR 3.3 (already allowlisted as `MIRA_HANDOFF_BRIEF_ENRICHMENT_ENABLED`).

**Blocked-by (overview §5):** Tier 0 PR 0.5 (D6-1 response-aware submitter) and Tier 0 PR 0.3 (the provisioning seeder). D3-1's value is only _meaningful_ once a pilot org books (Tier 0 makes a pilot org bookable), but D3-1's code has no Tier-0 code dependency and can be built in a parallel worktree. The learning consumers (PR 3.2 / PR 3.4) are independent of Tier 0 code.

---

## Verified findings (this tier)

Status legend matches the overview: **CONFIRMED** = plan as written · **PARTIAL** = core claim holds, audit text drifted (correction noted) · **CONFIRMED-with-correction** = verified at file:line, one cite in the audit text was wrong and is fixed below.

| #                     | Status                              | Pinned location (re-verified on `main`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Plan owner                                           |
| --------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| D3-1                  | CONFIRMED                           | stamp `packages/core/src/skill-runtime/tools/calendar-book.ts:375` (`value: estimatedValue ?? 0`), read off Opportunity `:255-259`; creators omit value `calendar-book.ts:261`, `packages/core/src/skill-runtime/builders/alex.ts:69`, `apps/api/src/bootstrap/skill-mode.ts:320-327` and `:756-764`; store plumbs it `packages/db/src/stores/prisma-opportunity-store.ts:64` (input `:21`); only the dev seed writes it `packages/db/prisma/seed-dev-data.ts:87`; queries filter `value:{gt:0}` `packages/db/src/stores/prisma-conversion-record-store.ts:238,276,326`; corroboration rejects sparse at `packages/core/src/recommendations/outcome-corroboration.ts:166-171` | PR 3.1                                               |
| D7-2                  | CONFIRMED-with-correction           | verdict stored `packages/db/src/recommendation-store.ts:219-279` (`applyAct`, `toStatus`); the verdict statuses are **`acted` (approve/accept) vs `dismissed` (reject)**, NOT `approved`/`rejected` (`packages/schemas/src/recommendations.ts:7-15` enum; mapping `packages/core/src/recommendations/act.ts:34-46`: `primary`/`secondary`→`acted`, `dismiss`→`dismissed`); confidence hardcoded `packages/ad-optimizer/src/recommendation-engine.ts:241(0.85)`, `:254(0.7)`, `:415(0.9/0.75)`, `:100(0.8)`, `source-reallocation.ts:196(0.6)`                                                                                                                                 | PR 3.2                                               |
| D6-3                  | PARTIAL (flag path exists)          | default synth `apps/api/src/services/workflows/handoff-brief-enrichment.ts:42`; flag-on forwards `{actionType,campaignId,rationale,evidence}` `:46-54`; final draft payload still strips to 3 fields `apps/api/src/services/workflows/recommendation-handoff-workflow.ts:79-87`; schema `packages/schemas/src/creative-concept-draft.ts:20-24` only `productDescription`/`targetAudience`/`valueContext`; flag `.env.example:354`                                                                                                                                                                                                                                             | PR 3.3                                               |
| D7-1                  | CONFIRMED                           | sole reader is the cockpit feed `apps/api/src/bootstrap/routes.ts:150-168`; decision input `packages/ad-optimizer/src/campaign-decision.ts:47-91` has no outcome field; row carries the signal `packages/core/src/recommendations/outcome-attribution-types.ts:197-199` (`causalStrength`, `trustDelta`)                                                                                                                                                                                                                                                                                                                                                                      | PR 3.4                                               |
| D9-5                  | CONFIRMED (subsumed)                | cron flag-off `apps/api/src/bootstrap/inngest.ts:951` (`RILEY_OUTCOME_ATTRIBUTION_ENABLED`); gate `apps/api/src/services/cron/riley-outcome-attribution.ts:49-52`; write-only `packages/core/src/recommendations/outcome-attribution.ts:372` (`outcomeStore.insert`)                                                                                                                                                                                                                                                                                                                                                                                                          | PR 3.4 (consumer) + Tier 0 PR 0.6 (flag)             |
| D7-5                  | PARTIAL (list drift; Spec-1B-gated) | `packages/core/src/recommendations/outcome-attribution-config.ts:3` = `["pause","refresh_creative"]` (audit said `review_budget` - **wrong, corrected**); `shift_budget_to_source` emitted advisory-only `packages/ad-optimizer/src/analyzers/source-reallocation.ts:190-213`, enum `packages/schemas/src/ad-optimizer.ts:27`; corroboration pause-only `outcome-corroboration.ts:124-127`; linkage to replicate `packages/db/src/recommendation-store.ts:303-339` (`markActedByExecution`), wired by `apps/api/src/bootstrap/riley-pause-executor.ts:17-34`                                                                                                                  | PR 3.5 (prep only; act-leg executability is Spec-1B) |
| D6-4 (stretch)        | CONFIRMED (out of full scope)       | Mira→Riley creative-attribution learn-back dark + Mira-only; flag `CREATIVE_ATTRIBUTION_ENABLED` `.env.example:340`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Design stub                                          |
| D6-5 / D1-3 (stretch) | CONFIRMED (out of full scope)       | `lead_quality_*` diagnoses computed, consumed by nothing (Riley→Alex junk-lead signal)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Design stub                                          |

**One cite correction discovered:** the overview table's D7-5 row already flagged the `review_budget`→`["pause","refresh_creative"]` drift; this plan additionally pins the line numbers the audit FINDINGS omitted (`outcome-attribution-config.ts:3`, `source-reallocation.ts:190-213`). No new status changes: D6-3 and D7-5 remain PARTIAL exactly as the overview records them.

---

## File structure (what each PR creates/modifies)

- **PR 3.1** - `packages/core/src/skill-runtime/booking-value.ts` (new - pure service→value resolver), `packages/core/src/skill-runtime/tools/calendar-book.ts` (stamp at create), `packages/core/src/skill-runtime/builders/alex.ts`, `apps/api/src/bootstrap/skill-mode.ts` (×2 creators feed the resolver), co-located `booking-value.test.ts`, and a real-output integration test `packages/core/src/skill-runtime/tools/__tests__/calendar-book-booked-value.test.ts`.
- **PR 3.2** - `packages/ad-optimizer/src/confidence-modifier.ts` (new - bounded, abstaining modifier), `packages/ad-optimizer/src/recommendation-engine.ts` (apply the modifier at `makeRec`), `packages/ad-optimizer/src/campaign-decision.ts` (thread an optional `confidenceModifier` input), `packages/db/src/recommendation-store.ts` (new `aggregateApprovalRateByKind` reader), `apps/api/src/bootstrap/inngest.ts` (wire the aggregate into the audit deps), co-located tests.
- **PR 3.3** - `packages/schemas/src/creative-concept-draft.ts` (additive `rileyDiagnosis` field), `apps/api/src/services/workflows/recommendation-handoff-workflow.ts:79-87` (thread the field), `apps/api/src/services/workflows/handoff-brief-enrichment.ts` (carry the diagnosis through the candidate), `.env.example:354` + the flag reader (default-on), tests.
- **PR 3.4** - `packages/ad-optimizer/src/outcome-readback.ts` (new - bounded, abstaining outcome→adjustment), `packages/ad-optimizer/src/campaign-decision.ts` (optional `outcomeSignal` input field), `packages/core/src/recommendations/outcome-attribution-types.ts` (export the reader contract), `packages/db/src/stores/prisma-recommendation-outcome-store.ts` (aggregate reader for the decision path), `apps/api/src/bootstrap/inngest.ts` (wire reader into audit deps; the flag flip itself is Tier 0 PR 0.6), tests.
- **PR 3.5** - `packages/core/src/recommendations/outcome-attribution-config.ts` (config + linkage shape prep for `shift_budget_to_source`, behind a documented Spec-1B gate), `outcome-corroboration.ts` (note-only; no behavior change), a design-altitude test that asserts the _prep_ shape without claiming the action is executable.

---

## PR 3.1 - Stamp `Opportunity.estimatedValue` so a booking carries a real value (do first; un-darkens everything)

**Why first:** This is the single highest-leverage delta in the tier and a **Spec-1A delta, not greenfield**. The booked-value chain is already built (slice 4d): `queryBookedValueCentsByCampaign` is the trueROAS numerator (`audit-runner.ts:122-130`), `getBookedStatsForOrgWindow` is the corroboration second-estimate (`prisma-conversion-record-store.ts:316`), and both filter `value:{gt:0}`. The only missing piece is a producer that writes `Opportunity.estimatedValue` at opportunity creation; the booking tool already reads it (`calendar-book.ts:255-259`) and stamps it onto the `booked` ConversionRecord (`:375`). With no writer, every production `booked` row is `value:0`, so it is invisible to the `gt:0` queries → `trueRoas` stays `null` and `deriveCorroboration` rejects `sparse_bookings` (`outcome-corroboration.ts:166-171`). One producer un-darkens trueROAS, the corroborated arm, and CAPI dispatchability (a `value:0` conversion is a degenerate CAPI payload).

**The producer:** a per-service price lookup. The playbook already carries `services: [{ id, name, price? }]` (`packages/schemas/src/playbook.ts:27-37`), persisted via `PrismaBusinessFactsStore`. The booking tool's creators take the service id/name; resolve the matching playbook service's `price` (major units) → cents, and pass it as `estimatedValue`. Honor the producer-with-consumer rule (overview §6): **test from the booking tool's REAL output**, not a seeded ConversionRecord (overview integration-seam #4).

**Honesty rule (the abstain):** a service with no `price`, a missing playbook, or a non-finite price MUST resolve to `null` (absence), never a fabricated `0` or a guessed default. A `null` flows through unchanged to today's `value: estimatedValue ?? 0` and the row stays correctly invisible - the system must never invent a value it does not have (`feedback_nan_blind_comparison_gates`; the corroboration predicate's own "never certify from a 0-booking window" rule made symmetric on the producer side).

**Files:**

- Create: `packages/core/src/skill-runtime/booking-value.ts`, `packages/core/src/skill-runtime/booking-value.test.ts`
- Create: `packages/core/src/skill-runtime/tools/__tests__/calendar-book-booked-value.test.ts`
- Modify: `packages/core/src/skill-runtime/tools/calendar-book.ts` (creator path `:261`), `packages/core/src/skill-runtime/builders/alex.ts:69`, `apps/api/src/bootstrap/skill-mode.ts:320-327` and `:756-764` (the two live `opportunityStore.create` wrappers)

- [ ] **Step 1: Write the failing unit test** - `packages/core/src/skill-runtime/booking-value.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { resolveBookedValueCents } from "./booking-value.js";

describe("resolveBookedValueCents", () => {
  const services = [
    { id: "svc_botox", name: "Botox", price: 450 }, // major units (dollars)
    { id: "svc_consult", name: "Consult" }, // no price
  ];

  it("resolves a priced service to cents (major -> minor)", () => {
    expect(resolveBookedValueCents({ serviceId: "svc_botox", services })).toBe(45000);
  });

  it("matches by name when id is the service name (alex/skill-mode pass name as id)", () => {
    expect(resolveBookedValueCents({ serviceId: "Botox", services })).toBe(45000);
  });

  it("ABSTAINS (null) for a service with no price, never a fabricated 0", () => {
    expect(resolveBookedValueCents({ serviceId: "svc_consult", services })).toBeNull();
  });

  it("ABSTAINS (null) when the service is not in the playbook", () => {
    expect(resolveBookedValueCents({ serviceId: "svc_unknown", services })).toBeNull();
  });

  it("ABSTAINS (null) when there is no playbook / empty services", () => {
    expect(resolveBookedValueCents({ serviceId: "svc_botox", services: [] })).toBeNull();
    expect(resolveBookedValueCents({ serviceId: "svc_botox", services: undefined })).toBeNull();
  });

  it("ABSTAINS (null) on a non-finite or non-positive price (no NaN slips through)", () => {
    expect(
      resolveBookedValueCents({ serviceId: "x", services: [{ id: "x", name: "X", price: NaN }] }),
    ).toBeNull();
    expect(
      resolveBookedValueCents({ serviceId: "x", services: [{ id: "x", name: "X", price: 0 }] }),
    ).toBeNull();
    expect(
      resolveBookedValueCents({ serviceId: "x", services: [{ id: "x", name: "X", price: -5 }] }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** - `pnpm --filter @switchboard/core test booking-value` → FAIL: `resolveBookedValueCents` not found.

- [ ] **Step 3: Implement the resolver** - `packages/core/src/skill-runtime/booking-value.ts`

```ts
import type { PlaybookService } from "@switchboard/schemas";

export interface ResolveBookedValueInput {
  /** The booking's service token. The booking tool passes the playbook service id; the
   * alex/skill-mode creators pass the service NAME as the id, so match on either. */
  serviceId: string;
  services: Pick<PlaybookService, "id" | "name" | "price">[] | undefined;
}

/**
 * Resolve a booking's estimated value in CENTS from the org playbook's per-service price.
 * The single producer that un-darkens trueROAS + the corroborated arm (Riley v3 slice 4d).
 *
 * ABSTAINS (returns null) on every uncertain input: no playbook, no matching service, a
 * service with no price, or a non-finite / non-positive price. Absence flows through the
 * booking tool's existing `value: estimatedValue ?? 0` unchanged, leaving the booked row
 * correctly invisible to the `value:{gt:0}` queries. NEVER fabricates a value: a guessed
 * default would poison trueROAS and certify a corroboration that did not happen
 * (feedback_nan_blind_comparison_gates).
 */
export function resolveBookedValueCents(input: ResolveBookedValueInput): number | null {
  const services = input.services;
  if (!services || services.length === 0) return null;
  const match =
    services.find((s) => s.id === input.serviceId) ??
    services.find((s) => s.name === input.serviceId);
  if (!match || match.price === undefined || match.price === null) return null;
  if (!Number.isFinite(match.price) || match.price <= 0) return null;
  return Math.round(match.price * 100);
}
```

- [ ] **Step 4: Wire the resolver into the three live creators.** Each creator already has the org's services available through the same `BusinessFacts`/playbook the synthesis reads (`builders/alex.ts:36` `services`; the skill-mode wrappers resolve org context). Thread the resolved cents as `estimatedValue` on `opportunityStore.create`:
  - `calendar-book.ts:261` - the `else` branch that creates a new opportunity. Pass `estimatedValue: resolveBookedValueCents({ serviceId: input.service, services })`. (The `existing` branch at `:259` already reads `existing.estimatedValue`; no change.)
  - `builders/alex.ts:69` - add `estimatedValue: resolveBookedValueCents({ serviceId: "general-inquiry", services })` (will abstain to `null` for the generic inquiry, which is correct: a general inquiry has no priced service).
  - `apps/api/src/bootstrap/skill-mode.ts:320-327` and `:756-764` - the two `opportunityStore.create` wrappers. Resolve `services` from the org's playbook (same source these handlers already use for context) and pass `estimatedValue`.

  Keep the resolver a pure function the creators call; do NOT push the price lookup into the store (the store stays a dumb plumb at `prisma-opportunity-store.ts:64`).

- [ ] **Step 5: Write the real-output integration test** - `packages/core/src/skill-runtime/tools/__tests__/calendar-book-booked-value.test.ts`. Drive the **real booking tool** with a fake opportunity/booking/outbox store and a priced playbook service, then assert the `booked` outbox payload's `value` is the stamped cents (not `0`), AND assert that an unpriced service yields `value:0` (honest absence). This is integration-seam #4 - the producer's real output, not a hand-built ConversionRecord.

```ts
// Pseudocode shape - mirror the existing calendar-book tool test harness.
it("stamps the playbook price (cents) onto the booked conversion payload", async () => {
  const outbox: Array<Record<string, unknown>> = [];
  const tool = makeCalendarBookTool({
    services: [{ id: "svc_botox", name: "Botox", price: 450 }],
    opportunityStore: {
      findActiveByContact: async () => null,
      create: async (i) => ({ id: "opp_1", ...i }),
    },
    runTransaction: makeTxCapturingOutbox(outbox),
    /* ...rest of the verified deps... */
  });
  await tool.handlers["booking.create"]!(
    { service: "svc_botox", slotStart, slotEnd, calendarId },
    ctx,
  );
  const booked = outbox.find((e) => e["type"] === "booked");
  expect((booked!["payload"] as { value: number }).value).toBe(45000); // NOT 0
});

it("stamps value:0 (honest absence) when the service has no playbook price", async () => {
  const outbox: Array<Record<string, unknown>> = [];
  const tool = makeCalendarBookTool({
    services: [{ id: "svc_consult", name: "Consult" }] /* ... */,
  });
  await tool.handlers["booking.create"]!(
    { service: "svc_consult", slotStart, slotEnd, calendarId },
    ctx,
  );
  const booked = outbox.find((e) => e["type"] === "booked");
  expect((booked!["payload"] as { value: number }).value).toBe(0);
});
```

- [ ] **Step 6: Run tests + typecheck** - `pnpm --filter @switchboard/core test booking-value calendar-book-booked-value` → PASS; `pnpm typecheck`. Run `pnpm --filter @switchboard/api test` too (skill-mode wrappers changed - `feedback_store_tightening_gate_needs_app_tests` applies to any creator-signature touch).

- [ ] **Step 7: Eval guard** - booked value feeds the trueROAS numerator the engine reports. Confirm the `evals/riley-recommendation` suite stays green (it does not assert trueROAS today, but the engine path is touched indirectly via the audit-runner numerator; re-run to be safe). If a fixture asserts `trueRoas: null` on a priced campaign, update it to reflect the now-populated value.

- [ ] **Step 8: Commit** - `git commit -m "feat(core): stamp opportunity estimated value from playbook price so bookings carry true value"`

**Acceptance:** a real booking for a priced service produces a `booked` ConversionRecord with `value > 0` that flows through `queryBookedValueCentsByCampaign` (trueROAS non-null) and `getBookedStatsForOrgWindow` (so `deriveCorroboration` can reach its agreement test instead of rejecting `sparse_bookings`); an unpriced service stays `value:0` (honest absence). **Closes D3-1. Integration-review seam #4 (overview §7).** Maps to overview integration-seam #4.

---

## PR 3.2 - Operator approval-rate confidence modifier (the first learning wire; before D7-1)

**Why now:** This is the lightest "gets better over time" proof and is **pilot-window-eligible, not pilot-blocking** (overview decision #5). Operator approve/reject verdicts are _stored_ (`applyAct` writes `toStatus` at `recommendation-store.ts:219-279`) but discarded as a learning substrate: rec confidence is hardcoded per-cause constants (`recommendation-engine.ts:241`=0.85 creative*fatigue, `:254`=0.7 audience_saturation, `:415`=0.9/0.75 signal-health, `:100`=0.8 add_creative; `source-reallocation.ts:196`=0.6). This PR aggregates the per-org approval rate \_by action kind* into a bounded confidence modifier fed into the engine. Do it **before** D7-1 (PR 3.4): it is simpler, its substrate already accrues with zero new plumbing, and it proves the learning seam end-to-end on the cheapest data.

**Status correction (verified on `main`):** the operator verdict is NOT recorded as `approved`/`rejected`. The recommendation status enum (`packages/schemas/src/recommendations.ts:7-15`) is `["pending","acted","dismissed","confirmed","dismissed_by_undo","expired"]`; `act.ts:34-46` maps the operator's `primary`/`secondary` action → **`acted`** (the approve/accept verdict) and `dismiss` → **`dismissed`** (the reject verdict). The "approval rate" this PR learns from is therefore `acted / (acted + dismissed)` per kind. All test code and the store reader below use `acted`/`dismissed`.

**The honesty contract (non-negotiable, overview §6):** the modifier must **abstain on sparse data, never fabricate**. Below a minimum sample floor per kind it returns a neutral `1.0` (no adjustment). It must be **bounded** so one bad streak cannot drive confidence to absurdity. Every external number is `Number.isFinite`-guarded before any comparison (`feedback_nan_blind_comparison_gates` - the exact class caught fabricating "corroborated" in #939).

**Files:**

- Create: `packages/ad-optimizer/src/confidence-modifier.ts`, `packages/ad-optimizer/src/confidence-modifier.test.ts`
- Modify: `packages/ad-optimizer/src/recommendation-engine.ts` (apply at `makeRec`), `packages/ad-optimizer/src/campaign-decision.ts` (thread optional input)
- Modify: `packages/db/src/recommendation-store.ts` (new `aggregateApprovalRateByKind` reader), `packages/db/src/recommendation-store.test.ts`
- Modify: `apps/api/src/bootstrap/inngest.ts` (wire the aggregate into audit deps)

- [ ] **Step 1: Write the failing modifier test** - `packages/ad-optimizer/src/confidence-modifier.test.ts`

```ts
import { describe, it, expect } from "vitest";
import {
  confidenceModifierForKind,
  applyConfidenceModifier,
  MIN_VERDICTS_FOR_MODIFIER,
} from "./confidence-modifier.js";

describe("confidenceModifierForKind", () => {
  it("ABSTAINS (1.0) below the min-sample floor", () => {
    expect(
      confidenceModifierForKind({ approved: 1, rejected: 0 }), // 1 verdict < floor
    ).toBe(1.0);
    expect(confidenceModifierForKind({ approved: 0, rejected: 0 })).toBe(1.0);
  });

  it("nudges UP for a high approval rate over enough samples, bounded", () => {
    const m = confidenceModifierForKind({ approved: 18, rejected: 2 }); // 90% over 20
    expect(m).toBeGreaterThan(1.0);
    expect(m).toBeLessThanOrEqual(1.15); // bounded ceiling
  });

  it("nudges DOWN for a low approval rate, bounded by a floor", () => {
    const m = confidenceModifierForKind({ approved: 3, rejected: 17 }); // 15% over 20
    expect(m).toBeLessThan(1.0);
    expect(m).toBeGreaterThanOrEqual(0.85); // bounded floor
  });

  it("ABSTAINS (1.0) on non-finite counts, never a NaN modifier", () => {
    expect(confidenceModifierForKind({ approved: NaN, rejected: 5 })).toBe(1.0);
    expect(confidenceModifierForKind({ approved: 5, rejected: Infinity })).toBe(1.0);
  });
});

describe("applyConfidenceModifier", () => {
  it("scales a confidence and clamps to [0,1]", () => {
    expect(applyConfidenceModifier(0.7, 1.1)).toBeCloseTo(0.77, 5);
    expect(applyConfidenceModifier(0.95, 1.15)).toBe(1); // clamped, never > 1
    expect(applyConfidenceModifier(0.5, 1.0)).toBe(0.5); // identity on abstain
  });

  it("is identity when the modifier is the abstain value", () => {
    expect(applyConfidenceModifier(0.85, 1.0)).toBe(0.85);
  });
});

it("exports a sane floor constant", () => {
  expect(MIN_VERDICTS_FOR_MODIFIER).toBeGreaterThanOrEqual(5);
});
```

- [ ] **Step 2: Run test to verify it fails** - `pnpm --filter @switchboard/ad-optimizer test confidence-modifier` → FAIL: module not found.

- [ ] **Step 3: Implement the modifier** - `packages/ad-optimizer/src/confidence-modifier.ts`

```ts
/** Minimum verdicts (approved + rejected) for an action kind before history may move
 * confidence at all. Below this, the modifier abstains (1.0). Echoes the repo's
 * MIN_SOURCE_BOOKINGS = 3 discipline: a couple of verdicts is not a signal. */
export const MIN_VERDICTS_FOR_MODIFIER = 8;

const MODIFIER_CEILING = 1.15;
const MODIFIER_FLOOR = 0.85;
/** Neutral pivot: a 50% approval rate moves nothing. */
const PIVOT_RATE = 0.5;
/** How hard the rate deviation pulls the modifier (gentle by design). */
const SENSITIVITY = 0.3;

export interface KindVerdictCounts {
  approved: number;
  rejected: number;
}

/**
 * A bounded, abstaining confidence modifier from an org's operator approve/reject history
 * for a single action kind. This is Riley's first learning wire (D7-2): the verdicts
 * applyAct already stores become a gentle prior on the next cycle's confidence.
 *
 * ABSTAINS (returns 1.0) below MIN_VERDICTS_FOR_MODIFIER and on any non-finite count: a
 * sparse or malformed history must never fabricate a signal (feedback_nan_blind_comparison_gates).
 * BOUNDED to [MODIFIER_FLOOR, MODIFIER_CEILING] so a single bad streak cannot collapse or
 * inflate confidence.
 */
export function confidenceModifierForKind(counts: KindVerdictCounts): number {
  const { approved, rejected } = counts;
  if (!Number.isFinite(approved) || !Number.isFinite(rejected)) return 1.0;
  const total = approved + rejected;
  if (total < MIN_VERDICTS_FOR_MODIFIER) return 1.0;
  const rate = approved / total;
  const raw = 1 + (rate - PIVOT_RATE) * SENSITIVITY * 2;
  return Math.min(MODIFIER_CEILING, Math.max(MODIFIER_FLOOR, raw));
}

/** Scale a base confidence by a modifier, clamped to [0,1]. Identity when modifier is 1.0. */
export function applyConfidenceModifier(confidence: number, modifier: number): number {
  if (!Number.isFinite(confidence) || !Number.isFinite(modifier)) return confidence;
  return Math.min(1, Math.max(0, confidence * modifier));
}
```

- [ ] **Step 4: Thread the modifier into the engine.** Add an optional `confidenceModifierByKind?: (action: RecommendationOutput["action"]) => number` to `RecommendationInput` (default: `() => 1.0`). In `makeRec` (`recommendation-engine.ts:63-85`), wrap the confidence: `confidence: applyConfidenceModifier(confidence, modifier(action))`. Because every rec funnels through `makeRec`, this is the single application point (no per-cause edits - the hardcoded constants stay as the _base_, the modifier is the _learned prior_ applied once). Forward the function from `decideForCampaign` → `generateRecommendations` (the `campaign-decision.ts:148-164` call site), gated optional so existing callers/tests are unaffected.

- [ ] **Step 5: Write the failing store-reader test** - `packages/db/src/recommendation-store.test.ts` (mirror `prisma-workflow-store.test.ts`; CI has no Postgres). Assert `aggregateApprovalRateByKind(orgId)` groups resolved recommendation rows by action kind and returns `{ approved, rejected }` counts (mapping DB status `acted`→approved, `dismissed`→rejected), scoped to the org, only over resolved (`resolvedAt not null`) recommendation-intent rows. The map's field names (`approved`/`rejected`) are the modifier's semantic count names; the DB statuses are `acted`/`dismissed`.

```ts
it("aggregates resolved verdicts by action kind (acted->approved, dismissed->rejected), org-scoped", async () => {
  const prisma = makeMockPrisma([
    rec({ org: "org_1", action: "pause", status: "acted" }),
    rec({ org: "org_1", action: "pause", status: "dismissed" }),
    rec({ org: "org_1", action: "refresh_creative", status: "acted" }),
    rec({ org: "org_2", action: "pause", status: "acted" }), // other org excluded
    rec({ org: "org_1", action: "pause", status: "pending" }), // unresolved excluded
  ]);
  const store = new PrismaRecommendationStore(prisma);
  const agg = await store.aggregateApprovalRateByKind("org_1");
  expect(agg.get("pause")).toEqual({ approved: 1, rejected: 1 });
  expect(agg.get("refresh_creative")).toEqual({ approved: 1, rejected: 0 });
});
```

- [ ] **Step 6: Implement `aggregateApprovalRateByKind`** in `recommendation-store.ts` - a `groupBy` over `pendingActionRecord` filtered by `organizationId`, `intent startsWith RECOMMENDATION_INTENT_PREFIX`, `resolvedAt not null`, status in `["acted","dismissed"]` (the verdict statuses; `confirmed`/`dismissed_by_undo`/`expired` are NOT operator approve/reject verdicts and are excluded), grouped by the action kind (read from `parameters.__recommendation.action` or the equivalent stored field - **verify the exact path at execution time**; the action is on the recommendation params, see `RecommendationParams.__recommendation`). Map `acted`→`approved` count, `dismissed`→`rejected` count. Return `Map<string, { approved, rejected }>`. Org-scoped read; no mutation, so no route-allowlist concern.

- [ ] **Step 7: Wire into the audit deps** - in `apps/api/src/bootstrap/inngest.ts`, build the per-org aggregate once per audit run and pass `confidenceModifierByKind: (action) => confidenceModifierForKind(agg.get(action) ?? { approved: 0, rejected: 0 })` into the decision path. Cache the aggregate for the run (one read per org, not per campaign).

- [ ] **Step 8: Run tests + typecheck + eval.** `pnpm --filter @switchboard/ad-optimizer test confidence-modifier`, `pnpm --filter @switchboard/db test recommendation-store`, `pnpm --filter @switchboard/api test`, `pnpm typecheck`. **Engine-touching → extend `evals/riley-recommendation`** (overview §6): add a fixture proving (a) abstain at sparse history leaves the hardcoded confidence unchanged, and (b) a high-approval history nudges it up within bounds. Keep the suite green (28/28 today, CI-blocking).

- [ ] **Step 9: Commit** - `git commit -m "feat(ad-optimizer): bounded approval-rate confidence modifier (first riley learning wire)"`

**Acceptance:** a fresh org's recs use the unchanged hardcoded confidence (abstain on no history); an org with a strong approve/reject history by kind sees confidence nudged within `[0.85x, 1.15x]`; sparse or malformed history never moves it. **Closes D7-2.**

---

## PR 3.3 - Diagnosis-carrying Mira brief + enrichment flag default-on (D6-3, the PARTIAL)

**Why:** The Mira handoff strips Riley's diagnosis. Today, default (flag `MIRA_HANDOFF_BRIEF_ENRICHMENT_ENABLED` off) the brief is a generic org-level synthesis (`handoff-brief-enrichment.ts:42`). The flag-gated path **already** forwards `{actionType, campaignId, rationale, evidence}` into Mira's brain compose (`:46-54`) - so half of D6-3 ships. But the **final draft payload still strips the structured fields**: `recommendation-handoff-workflow.ts:79-87` reduces the brief to `productDescription`/`targetAudience`/`valueContext`, and the schema `creative-concept-draft.ts:20-24` has no place for Riley's campaign/evidence/performance context. So Mira receives Riley's diagnosis only as LLM prose (if the flag is on), never as structured data the creative pipeline can route on. Acknowledge the flag-gated half already exists; this PR closes the **data** seam and flips the flag default-on once the data flows.

**Files:**

- Modify: `packages/schemas/src/creative-concept-draft.ts` (additive optional `rileyDiagnosis`), `packages/schemas/src/creative-concept-draft.test.ts`
- Modify: `apps/api/src/services/workflows/recommendation-handoff-workflow.ts:79-87` (thread the field through the child payload), `apps/api/src/services/workflows/handoff-brief-enrichment.ts` (return the diagnosis alongside the brief so the workflow can attach it)
- Modify: `.env.example:354` (default-on) + the flag reader, `scripts/env-allowlist.local-readiness.json` (already present - verify, do not re-add)

- [ ] **Step 1: Write the failing schema test** - `creative-concept-draft.test.ts`. Assert the additive field round-trips and stays optional (no existing producer breaks).

```ts
import { CreativeConceptDraftInput } from "./creative-concept-draft.js";

it("accepts an optional structured rileyDiagnosis (additive, Safe evolution)", () => {
  const parsed = CreativeConceptDraftInput.parse({
    productDescription: "Botox touch-ups",
    targetAudience: "returning aesthetic clients",
    rileyDiagnosis: {
      campaignId: "camp_1",
      actionType: "refresh_creative",
      diagnosis: "creative_fatigue",
      evidence: { clicks: 1200, conversions: 14, days: 14 },
    },
  });
  expect(parsed.rileyDiagnosis?.campaignId).toBe("camp_1");
});

it("still parses without rileyDiagnosis (back-compat)", () => {
  expect(
    CreativeConceptDraftInput.parse({ productDescription: "x", targetAudience: "y" })
      .rileyDiagnosis,
  ).toBeUndefined();
});
```

- [ ] **Step 2: Verify fail** - `pnpm --filter @switchboard/schemas test creative-concept-draft` → FAIL: unknown key stripped / field absent.

- [ ] **Step 3: Add the schema field** - `creative-concept-draft.ts`:

```ts
export const RileyDiagnosisContext = z.object({
  campaignId: z.string().min(1),
  actionType: z.string().min(1),
  diagnosis: z.string().optional(),
  evidence: z.object({ clicks: z.number(), conversions: z.number(), days: z.number() }).optional(),
});
export type RileyDiagnosisContext = z.infer<typeof RileyDiagnosisContext>;

export const CreativeConceptDraftInput = z.object({
  productDescription: z.string().min(1),
  targetAudience: z.string().min(1),
  valueContext: CreativeConceptDraftValueContext.optional(),
  // D6-3: Riley's structured diagnosis reaches Mira AS DATA, not just LLM prose. Additive +
  // optional (Safe evolution; matches the valueContext precedent). The creative pipeline may
  // route on campaignId/actionType without re-parsing the brain's free text.
  rileyDiagnosis: RileyDiagnosisContext.optional(),
});
```

- [ ] **Step 4: Failing workflow test** - `recommendation-handoff-workflow.test.ts`. Assert that when the workflow has Riley's `{campaignId, actionType, evidence}` (it already receives `input.actionType`, `input.evidence`, `input.recommendationId`, and the campaign on the work unit), the child `creative.concept.draft` submit carries a `rileyDiagnosis`, not just the three brief fields.

```ts
it("threads Riley's diagnosis into the child draft payload as structured data", async () => {
  const submitChild = vi
    .fn()
    .mockResolvedValue({ ok: true, result: { outcome: "completed", outputs: { jobId: "job_1" } } });
  await runHandoffWorkflow({
    input: {
      recommendationId: "rec_1",
      actionType: "refresh_creative",
      evidence: { clicks: 1200, conversions: 14, days: 14 },
    },
    workUnit: {
      /* ...campaignId on params, valid brief... */
    },
    services: { submitChildWork: submitChild },
  });
  const payload = submitChild.mock.calls[0]![0].parameters as {
    brief: { rileyDiagnosis?: { campaignId: string } };
  };
  expect(payload.brief.rileyDiagnosis?.campaignId).toBe(/* the work unit campaign */);
});
```

- [ ] **Step 5: Thread the field** - at `recommendation-handoff-workflow.ts:79-87`, add `rileyDiagnosis` to the `brief` object from `input.actionType` + `input.evidence` + the campaignId already on the work unit + the diagnosis label the enrichment path computes. Keep the existing three fields. In `handoff-brief-enrichment.ts`, the `resolveHandoffBrief` return is currently `{ productDescription, targetAudience }`; the _candidate_ already carries `{ actionType, campaignId, evidence }` (`HandoffBriefCandidate` at `:6-13`), so the workflow already has the data without changing the enrichment return - attach `rileyDiagnosis` from the candidate at the workflow layer. (If preferred, widen `resolveHandoffBrief`'s return to surface the diagnosis; either is acceptable, the workflow-layer attach is the smaller diff.)

- [ ] **Step 6: Flip the flag default-on** - once the data flows, change `.env.example:354` `MIRA_HANDOFF_BRIEF_ENRICHMENT_ENABLED` default to `true` and update the reader's default so a fresh deploy gets enrichment. **Coordinate with Tier 0 PR 0.6:** the flag-flip runbook lists this flag flipping with Tier 3 D6-3 - this PR is what makes that flip safe (the data path now exists), so update the runbook entry's prerequisite to "shipped" when this lands. Note the flag is already allowlisted (`feedback_new_env_var_needs_allowlist` - verify, do not duplicate).

- [ ] **Step 7: Run tests + typecheck + format.** `pnpm --filter @switchboard/schemas test`, `pnpm --filter @switchboard/api test recommendation-handoff handoff-brief-enrichment`, `pnpm typecheck`, `pnpm format:check`. The schema is Layer-1; rebuild order matters - run `pnpm reset` if downstream typecheck complains about the new export (`feedback_reset_vs_build`).

- [ ] **Step 8: Commit** - `git commit -m "feat: thread riley diagnosis into mira brief as data; enrichment flag default-on"`

**Acceptance:** a Riley→Mira handoff carries `{campaignId, actionType, diagnosis, evidence}` into the `creative.concept.draft` child as structured data (not only as brain prose); the enrichment flag defaults on; existing producers that omit `rileyDiagnosis` still parse. **Closes D6-3.** Cross-ref Tier 0 PR 0.6 flag plan.

---

## PR 3.4 - Outcome readback into the decision (D7-1 + D9-5; the IMPROVE consumer)

**Why (and why after D7-2):** The enriched outcome ledger is **write-only into judgment**. The attribution engine writes a `RileyOutcomeRow` with `causalStrength` + `trustDelta` (`outcome-attribution.ts:372`; row shape `outcome-attribution-types.ts:197-199`), but the **only reader is the cockpit feed** (`routes.ts:150-168`) - `CampaignDecisionInput` (`campaign-decision.ts:47-91`) has no outcome field, so last cycle's measured outcomes never inform this cycle's arbitration. This PR feeds the outcome `trustDelta` / causal-strength back into the decision's arbitration / pause-floor input as a **bounded, abstaining** signal. It is the IMPROVE-leg consumer that pairs with **D9-5**: the attribution cron (`riley-outcome-attribution.ts`) is the _producer_ that is flag-off and display-only; **D7-1 is its missing consumer**. Frame D9-5 as "wire the consumer (this PR) + flip the flag (Tier 0 PR 0.6)", not separate net-new work. Sequence after D7-2 because D7-2 proves the learning seam on cheaper data first and this one is larger.

**Strict honesty (overview §6, and the `trustDelta` contract itself):** `TrustDelta` is documented as "never fed back into recommendation scoring (that switch is Phase-C)" (`outcome-attribution-types.ts:32-38`). This PR **is** that Phase-C switch, and it must honor the same bar: the readback only ever applies a **bounded nudge**, **abstains** when the ledger is sparse / the row is non-renderable / the causal strength is merely `directional` with no corroboration, and `Number.isFinite`-guards every numeric. `corroborated` may move trust; a bare `directional` row with visibility flags must not. It NEVER treats `corroborated` as causal proof (the row's own invariant). Map this to overview integration-seam #4's spirit: a producer→consumer pair pinned by a `safeParse(producerOutput)` test.

**Files:**

- Create: `packages/ad-optimizer/src/outcome-readback.ts`, `packages/ad-optimizer/src/outcome-readback.test.ts`
- Modify: `packages/ad-optimizer/src/campaign-decision.ts` (optional `outcomeSignal?` input + apply it to the pause-floor / arbitration), `campaign-decision.test.ts`
- Modify: `packages/db/src/stores/prisma-recommendation-outcome-store.ts` (add a decision-facing aggregate reader, e.g. `aggregateOutcomeSignalByKind(orgId)`), its test
- Modify: `apps/api/src/bootstrap/inngest.ts` (wire reader into audit deps; the **flag flip** is Tier 0 PR 0.6)

- [ ] **Step 1: Write the failing readback test** - `outcome-readback.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { outcomeAdjustmentForKind, MIN_OUTCOMES_FOR_READBACK } from "./outcome-readback.js";

describe("outcomeAdjustmentForKind", () => {
  it("ABSTAINS (neutral) below the min-outcome floor", () => {
    expect(
      outcomeAdjustmentForKind({ trustUp: 1, trustDown: 0, corroborated: 0, total: 1 }),
    ).toEqual({ confidenceMultiplier: 1.0, abstained: true });
  });

  it("ABSTAINS when no row is corroborated (directional-only must not move trust)", () => {
    const adj = outcomeAdjustmentForKind({ trustUp: 6, trustDown: 0, corroborated: 0, total: 6 });
    expect(adj.abstained).toBe(true);
    expect(adj.confidenceMultiplier).toBe(1.0);
  });

  it("nudges UP, bounded, when corroborated outcomes trend favorable", () => {
    const adj = outcomeAdjustmentForKind({ trustUp: 8, trustDown: 1, corroborated: 6, total: 10 });
    expect(adj.confidenceMultiplier).toBeGreaterThan(1.0);
    expect(adj.confidenceMultiplier).toBeLessThanOrEqual(1.1); // tighter than approval-rate: outcomes are scarcer
  });

  it("nudges DOWN, bounded, when corroborated outcomes trend unfavorable", () => {
    const adj = outcomeAdjustmentForKind({ trustUp: 1, trustDown: 8, corroborated: 6, total: 10 });
    expect(adj.confidenceMultiplier).toBeLessThan(1.0);
    expect(adj.confidenceMultiplier).toBeGreaterThanOrEqual(0.9);
  });

  it("ABSTAINS on non-finite inputs, never NaN", () => {
    expect(
      outcomeAdjustmentForKind({ trustUp: NaN, trustDown: 0, corroborated: 1, total: 1 }),
    ).toEqual({ confidenceMultiplier: 1.0, abstained: true });
  });
});

it("min-outcome floor is at least the corroboration min-bookings discipline", () => {
  expect(MIN_OUTCOMES_FOR_READBACK).toBeGreaterThanOrEqual(3);
});
```

- [ ] **Step 2: Verify fail** - `pnpm --filter @switchboard/ad-optimizer test outcome-readback` → FAIL: module not found.

- [ ] **Step 3: Implement the readback** - `packages/ad-optimizer/src/outcome-readback.ts`. A pure function from aggregated outcome counts (per action kind) to a `{ confidenceMultiplier, abstained }` adjustment. Abstain unless `corroborated >= MIN_OUTCOMES_FOR_READBACK`; bound to a tighter band than the approval-rate modifier (outcomes are scarcer and noisier); `Number.isFinite`-guard everything. Document that `directional`-only history is deliberately unjudgeable (it mirrors `deriveCorroboration`'s refusal to certify from weak evidence).

- [ ] **Step 4: Failing decision-input test** - `campaign-decision.test.ts`. Add an optional `outcomeSignal?: { confidenceMultiplier: number }` (resolved upstream per kind) to `CampaignDecisionInput`; assert it scales the pause-floor / surviving-rec confidence, and that omitting it (back-compat) changes nothing.

- [ ] **Step 5: Apply in `decideForCampaign`** - fold `outcomeSignal.confidenceMultiplier` into the same `applyConfidenceModifier` clamp from PR 3.2 (reuse it - do NOT introduce a second scaling path). The composition is `base * approvalModifier * outcomeMultiplier`, each bounded and each abstaining to `1.0`, clamped to `[0,1]`. Keep it an input field (overview's "bounded + abstaining" instruction); the engine stays deterministic.

- [ ] **Step 6: Implement the store reader** - `aggregateOutcomeSignalByKind(orgId)` on `PrismaRecommendationOutcomeStore`: group the org's outcome rows by action kind, count `trustDelta` up/down and `causalStrength === "corroborated"`, return the per-kind counts the readback consumes. Read-only; org-scoped.

- [ ] **Step 7: Wire into audit deps + pin the seam** - in `inngest.ts`, build the per-org outcome aggregate once per run and pass the resolved `outcomeSignal` per kind into the decision path (alongside PR 3.2's modifier). **Pin the producer→consumer seam** with a `safeParse`-style test: take a **real** `RileyOutcomeRow` from the attribution engine's output (not a hand-built row), run it through the store aggregate → readback → decision, and assert the decision consumes it without shape mismatch (overview §7 discipline). The **flag flip** (`RILEY_OUTCOME_ATTRIBUTION_ENABLED`) that turns the producer on is Tier 0 PR 0.6 - note in the runbook that the consumer now exists, satisfying D9-5's "producer→consumer IMPROVE pair".

- [ ] **Step 8: Run tests + typecheck + eval.** Engine-touching → extend `evals/riley-recommendation` with an outcome-readback fixture (abstain on directional-only; bounded nudge on corroborated history). Keep green.

- [ ] **Step 9: Commit** - `git commit -m "feat(ad-optimizer): feed corroborated outcome ledger back into the decision (d7-1 improve consumer)"`

**Acceptance:** last cycle's _corroborated_ outcomes apply a bounded nudge to this cycle's confidence/pause-floor; a sparse or directional-only ledger abstains; the producer (attribution cron) now has its IMPROVE-leg consumer, so flipping `RILEY_OUTCOME_ATTRIBUTION_ENABLED` (Tier 0 PR 0.6) closes a real loop. **Closes D7-1; completes D9-5 (consumer half; flag is Tier 0).**

---

## PR 3.5 - Attribution-coverage prep for `shift_budget_to_source` (Spec-1B-gated; prep only)

**Why (and why prep-only):** D7-5 is PARTIAL with a list-drift correction: `V1_ATTRIBUTABLE_KINDS = ["pause","refresh_creative"]` (`outcome-attribution-config.ts:3`; the audit text's `review_budget` was wrong). The genuinely uncovered action is `shift_budget_to_source` - the north-star money move (`schemas/src/ad-optimizer.ts:27`), emitted **advisory-only** by `source-reallocation.ts:190-213` (it is a recommendation with steps for a human, never an executed Meta write). Attribution and corroboration are pause-centric (`outcome-corroboration.ts:124-127` is `pause`-only by design). **But `shift_budget_to_source` is not executable until Spec-1B** (overview decision #4 gates Spec-1B behind Tier 5). So this PR does **prep, not activation**: it stages the attribution config + the executed-action linkage shape so that the day Spec-1B makes the action executable, attribution coverage is a config flip plus a wiring of the _existing_ `markActedByExecution` pattern, not a re-design. **Do NOT re-plan pause attribution** (slice-4f shipped it via `recommendation-store.ts:303-339` + `riley-pause-executor.ts:17-34`).

**Files:**

- Modify: `packages/core/src/recommendations/outcome-attribution-config.ts` (add the `shift_budget_to_source` KIND_CONFIG entry **behind a documented gate**, and a `SPEC_1B_PENDING_KINDS` constant so coverage is explicit but not yet live), its test
- Note-only (no behavior change): `outcome-corroboration.ts` - document that source-reallocation corroboration follows the same booked-value-side estimate, deferred with pause's `refresh_creative` deferral until the action executes
- Reference (do not modify): `recommendation-store.ts:303-339` (`markActedByExecution`), `riley-pause-executor.ts:17-34` (the linkage to replicate for the eventual source-reallocation executor)

- [ ] **Step 1: Write the prep-shape test** - `outcome-attribution-config.test.ts` (extend). Assert the _intent_ without claiming executability:

```ts
import {
  V1_ATTRIBUTABLE_KINDS,
  SPEC_1B_PENDING_KINDS,
  isAttributableKind,
  KIND_CONFIG_PENDING,
} from "./outcome-attribution-config.js";

it("does NOT yet attribute shift_budget_to_source (not executable until Spec-1B)", () => {
  expect(V1_ATTRIBUTABLE_KINDS).toEqual(["pause", "refresh_creative"]);
  expect(isAttributableKind("shift_budget_to_source")).toBe(false);
});

it("stages shift_budget_to_source as a Spec-1B-pending kind with a config shape ready", () => {
  expect(SPEC_1B_PENDING_KINDS).toContain("shift_budget_to_source");
  // The config shape exists so activation is a list move, not a redesign.
  expect(KIND_CONFIG_PENDING["shift_budget_to_source"]).toMatchObject({
    primaryMetric: expect.any(String),
    favorableDirection: expect.any(String),
    windowDays: expect.any(Number),
  });
});
```

- [ ] **Step 2: Verify fail** - `pnpm --filter @switchboard/core test outcome-attribution-config` → FAIL: `SPEC_1B_PENDING_KINDS` / `KIND_CONFIG_PENDING` not exported.

- [ ] **Step 3: Implement the staged config** - add to `outcome-attribution-config.ts`:

```ts
/**
 * Kinds whose attribution is DESIGNED but inert until Spec-1B makes the action executable.
 * shift_budget_to_source is the north-star money move (source-reallocation.ts), today emitted
 * advisory-only - there is no executed Meta write to anchor an attribution window on. Staged
 * here so that when Spec-1B ships an executor (replicating the pause executor's
 * markActedByExecution linkage, riley-pause-executor.ts), enabling attribution is moving this
 * kind into V1_ATTRIBUTABLE_KINDS + wiring the executor's markActedByExecution call, NOT a
 * redesign. HARD DEPENDENCY: no activation until Tier 5 is green and a Spec-1B executor exists.
 */
export const SPEC_1B_PENDING_KINDS = ["shift_budget_to_source"] as const;

/** The attribution shape shift_budget_to_source WILL use once executable. Not read by any live
 * path: a config blueprint, validated by tests so it cannot rot before Spec-1B consumes it. */
export const KIND_CONFIG_PENDING = {
  shift_budget_to_source: {
    windowDays: 14,
    confidence: "low" as const,
    primaryMetric: "spend" as const, // attribute on the budget actually moved
    favorableDirection: "up" as const, // trueROAS of the destination source should rise
    noiseFloorPct: 10,
  },
} as const;
```

- [ ] **Step 4: Document the corroboration deferral** - add a comment block near `outcome-corroboration.ts:124-127` recording that source-reallocation's booked-value corroboration is deferred alongside `refresh_creative` until the action executes (it would otherwise re-state pause's per-campaign sparsity problem at the source level). **No behavior change.**

- [ ] **Step 5: Document the activation checklist** - a short comment (or a `docs/superpowers/specs`-adjacent note IF the Spec-1B spec is being amended in Tier 5) listing the exact activation steps: (1) Spec-1B ships a `shift_budget_to_source` executor that calls `markActedByExecution` with the executed work unit (mirror `riley-pause-executor.ts:26-33`); (2) move `shift_budget_to_source` from `SPEC_1B_PENDING_KINDS` into `V1_ATTRIBUTABLE_KINDS`; (3) merge `KIND_CONFIG_PENDING` into `KIND_CONFIG`; (4) extend the corroboration predicate if the booked-value second-estimate is wanted at source granularity. Cross-ref overview decision #4 (Spec-1B gate) and the Tier-5 D4-6 blast-radius contract.

- [ ] **Step 6: Run tests + typecheck.** `pnpm --filter @switchboard/core test outcome-attribution-config`, `pnpm typecheck`. No eval change (no live engine path touched).

- [ ] **Step 7: Commit** - `git commit -m "chore(core): stage shift_budget_to_source attribution config behind spec-1b gate"`

**Acceptance:** the north-star action has a validated attribution-config blueprint and a documented one-list-move activation path, with `isAttributableKind` still correctly excluding it (it is not executable yet); pause attribution is untouched. **Addresses D7-5 (prep half); activation is explicitly Spec-1B-dependent.**

---

## Still-missing flywheel edges (design stubs - post-pilot stretch, NOT a task breakdown)

These are the two remaining unbuilt edges of the flywheel. Per overview §2 (out-of-scope boundary) and the prompt, they get a design stub only, not a full TDD breakdown.

- **D6-4 - Mira → Riley creative-attribution learn-back (dark, Mira-only).** Today creative performance is Mira-internal; Riley never learns which _creative_ its `refresh_creative` / handoff produced moved the needle. The seam: when an outcome row attributes a lift to a campaign whose creative came from a Mira handoff (the handoff already carries `recommendationId` + now `rileyDiagnosis` after PR 3.3), emit a creative-attribution signal back to Riley keyed on the originating recommendation. **The consumer that needs building:** a Riley-side reader that folds "creative X from handoff Y outperformed" into the confidence prior for the _creative-producing_ action kinds (`refresh_creative`, `add_creative`), reusing PR 3.4's bounded/abstaining readback shape. Gated by `CREATIVE_ATTRIBUTION_ENABLED` (`.env.example:340`, default off). Stretch: it needs the full D3-1→D7-1 loop live first (a creative lift is only measurable once booked value flows), so it is strictly downstream of this tier.

- **D6-5 / D1-3 - Riley → Alex junk-lead signal (computed, consumed by nothing).** Riley already computes `lead_quality_*` diagnoses, but nothing consumes them: Alex never learns that the leads a campaign sends are junk, so it keeps booking (or trying to book) low-intent leads from a source Riley already knows is bad. **The seam:** surface the `lead_quality_*` diagnosis as a per-source/per-campaign quality signal Alex can read at qualification time. **The consumer that needs building:** an Alex-side qualification input that de-prioritizes or flags leads attributed to a Riley-flagged low-quality source, closing the "Riley sees the junk → Alex stops chasing it" edge. This is an Alex-product decision (the qualification policy is owned by the Alex capability-audit plan); Riley's side is just exposing the already-computed signal. Stretch: it crosses the Riley/Alex agent boundary and needs the Alex qualification surface designed first.

---

## Tier 3 dependencies & sequencing

- **PR 3.1 first** - it is the producer that un-darkens trueROAS, the corroborated arm, and CAPI dispatchability; every later learning signal (PR 3.4's readback especially) is more meaningful once real booked value flows. No Tier-0 _code_ dependency; build in parallel, but its value lands once a pilot org books (Tier 0).
- **PR 3.2 second** - the lightest learning wire; independent of Tier 0 code; pilot-window-eligible (overview decision #5). Establishes the `applyConfidenceModifier` clamp PR 3.4 reuses.
- **PR 3.3** - independent; the data-seam + flag flip; coordinate the flag entry with Tier 0 PR 0.6.
- **PR 3.4** - after PR 3.2 (reuses the clamp) and conceptually after PR 3.1 (a `corroborated` row requires booked value). Consumer half of D9-5; the flag that turns its producer on is Tier 0 PR 0.6.
- **PR 3.5** - anytime; prep-only, Spec-1B-gated; no activation until Tier 5 is green (overview decision #4).
- **Blocked-by (overview §5):** Tier 0 PR 0.5 (D6-1 submitter) and PR 0.3 (seeder) for the handoff path PR 3.3 exercises; the learning consumers (PR 3.2 / PR 3.4) do not block on Tier 0.
- **Exit criteria for Tier 3:** a real booking writes `value > 0`; an org with operator verdict history sees bounded confidence movement; a Riley→Mira handoff carries structured diagnosis; a corroborated outcome history applies a bounded nudge to the next decision; `shift_budget_to_source` has a validated, gated attribution blueprint. The cross-slice integration pass (overview §7) re-pins seam #4 from the booking tool's real output.

## Self-review (per writing-plans)

- **Spec coverage:** every Tier-3 finding in the overview table maps to a PR (D3-1→3.1, D7-2→3.2, D6-3→3.3, D7-1+D9-5→3.4, D7-5→3.5) plus the two stretch stubs (D6-4, D6-5/D1-3). Proportional fidelity honored: full TDD with real test code for D3-1/D7-2/D6-3; design-altitude breakdown (files + interface + acceptance + test strategy + dependency) for D7-1/D9-5/D7-5; design stub only for D6-4/D6-5.
- **Producer-with-consumer (overview §6):** PR 3.1 is the inverse case the prompt flagged - the consumers (trueROAS query, corroboration, CAPI) already exist and the producer is missing, so the test drives the **real booking tool's output** through them (integration-seam #4), not a seeded ConversionRecord. PR 3.4 pins the real `RileyOutcomeRow` → consumer seam with a `safeParse`-style test.
- **Abstain-not-fabricate / `Number.isFinite` floors:** every learning signal (PR 3.1 value resolver, PR 3.2 confidence modifier, PR 3.4 outcome readback) returns a neutral/absent value on sparse or non-finite input, is bounded, and never invents a number (`feedback_nan_blind_comparison_gates`). Each carries an explicit min-sample floor.
- **Cross-refs:** Tier 0 PR 0.5 (D6-1 submitter) and PR 0.6 (flag flips, esp. `RILEY_OUTCOME_ATTRIBUTION_ENABLED` for D9-5 and `MIRA_HANDOFF_BRIEF_ENRICHMENT_ENABLED` for D6-3) named at the PRs that depend on them. Spec-1B gate (overview decision #4) named at PR 3.5.
- **Hygiene:** no em-dashes; ESM `.js` import extensions; new schema export → rebuild-order note (`pnpm reset`); engine-touching PRs (3.2, 3.4) extend `evals/riley-recommendation`; creator-signature touches (3.1) run `--filter api test`.
- **Type consistency:** `resolveBookedValueCents`, `confidenceModifierForKind` / `applyConfidenceModifier`, `aggregateApprovalRateByKind`, `outcomeAdjustmentForKind` / `aggregateOutcomeSignalByKind`, and the staged `SPEC_1B_PENDING_KINDS` / `KIND_CONFIG_PENDING` names are used consistently across PRs. The single `applyConfidenceModifier` clamp is reused by both learning wires (no second scaling path).
- **Open risk flagged for execution:** confirm at execution time (a) the exact stored path of a recommendation's action kind for `aggregateApprovalRateByKind` (PR 3.2 Step 6 - it is on the recommendation params, but the precise key needs a grep), (b) that the two skill-mode creators have the org playbook services in scope at the `opportunityStore.create` call (PR 3.1 Step 4 - they resolve org context already, but verify the services are threaded), and (c) that `PrismaRecommendationOutcomeStore` exposes (or can cheaply add) a kind-grouped aggregate without an over-fetch (PR 3.4 Step 6).
