# Riley Phase B — Revenue-Truth Measurement Foundation — Design

- **Date:** 2026-06-02
- **Status:** Design approved (brainstorming). Implementation plan to follow via writing-plans.
- **Author:** Jason + Claude
- **Parent arc:** `docs/superpowers/specs/2026-06-02-riley-autonomous-ad-operator-design.md` (§9 "Phase B", §12 seam table). This spec implements the **measurement substrate only** of Phase B — explicitly _not_ the optimizer engine, which a parallel session owns.
- **Audit basis:** `docs/audits/2026-06-02-riley-improvement-audit/FINDINGS.md` (Tiers 2 & 5) + `domains/D3-attribution-targeting.md`.

---

## §0 — Thesis and the one-sentence invariant

Booked-customer revenue exists in our CRM, but the event leaving the system today carries `value: 0` and no identity — so it can be neither reconciled against Meta nor dispatched to the Conversions API. This slice makes a booked customer **measurable end-to-end**: stamp the booked event with real identity + value, carry that truth intact through the publisher, let CAPI dispatch it when env-enabled, and replace the reconciliation stub so drift stops being a lie.

The governing invariant, to be quoted in code review and pinned beside the mapper:

> **A booked event must preserve customer match keys, source attribution, value, and currency exactly as known at booking time; unknown fields are explicit `null`, never inferred.**

This is **measurement plumbing only.** No optimizer, no campaign mutation, no attribution-projection expansion, no per-campaign recommendations, no `PlatformIngress` execution path. The single outbound effect is CAPI dispatch, already env-gated and on the Meta-App-Review critical path — wiring + dispatchability, **never a production flip.**

---

## §1 — Components

### Component 1 — Booked-event stamping (the keystone)

**File:** `packages/core/src/skill-runtime/tools/calendar-book.ts` (`booking.create`, outbox write at ~`:296-314`).

Today the `booked` outbox payload is `{type, contactId, organizationId, value: 0, occurredAt, source, metadata:{bookingId, opportunityId, service, slot…}}`. The `ConversionEvent` schema (`packages/schemas/src/conversion.ts`) already defines every field we need.

**1a. Widen the tool's dependency subsets (back-compatible).**

- `contactStore.findById` return subset: `{name?, email?}` → `{name?, email?, phone?, attribution?}`, where `attribution` is typed `AttributionChain | null` (imported from `@switchboard/schemas`). The real `PrismaContactStore.findById` already returns the full row (no `select`), so this is a no-op at the call site. Optional fields keep test doubles valid.
- `opportunityStore.findActiveByContact` return: `{id}` → `{id, estimatedValue?: number | null}`, to surface the per-opportunity value. (`create` stays `{id}` — a freshly created opportunity has `estimatedValue = null`.)

**1b. A defensive mapper — do not inline the field logic.**

New module `packages/core/src/skill-runtime/tools/booked-conversion-payload.ts` (co-located test). Exposes a named type and a pure function:

```ts
/** The attribution/identity surface stamped onto a `booked` outbox event.
 *  INVARIANT: known-but-missing fields are explicit null, never inferred. */
export interface BookedConversionPayload {
  sourceCampaignId: string | null;
  sourceAdId: string | null;
  customer: { email: string | null; phone: string | null };
  attribution: { fbclid: string | null; lead_id: string | null };
}

export function buildBookedConversionPayload(contact: {
  email?: string | null;
  phone?: string | null;
  attribution?: AttributionChain | null;
}): BookedConversionPayload;
```

This is the **one place** that encodes the casing/history quirks:

- `attribution.lead_id ← contact.attribution.leadgen_id` (the schema field is `leadgen_id`, optional).
- `attribution.fbclid ← contact.attribution.fbclid` (nullable in the schema).
- `customer.{email,phone} ← contact.{email,phone}` — **independent of attribution.** An organic contact (no `attribution`) with an email still carries that email; only the `attribution`-derived fields go null.
- **`sourceAdSetId` is deliberately dropped.** It is _not_ in the persisted `AttributionChainSchema` (only `sourceCampaignId`/`sourceAdId` are) and is read by no consumer in scope (the CAPI dispatcher ignores ad-set granularity; reconciliation keys on campaign). Add it only when a consumer needs it.

**1c. Value + currency (units-correct — see §2).**

- `value ← opportunity.estimatedValue ?? 0`, stamped **verbatim in cents** (the system-wide money unit). No stamp-time division — that would corrupt `funnelByOrg`'s revenue sum (§2).
- `currency ← deps.defaultCurrency` — a new injected tool dependency, default `"SGD"`, wired at bootstrap. Kept as a visible, grep-able dependency rather than a hardcoded literal buried in stamping code, so per-org currency is a trivial later swap.

**1d. The stamped payload** (top-level fields are what the publisher whitelist already carries; `customer`/`attribution`/`currency` are newly carried per Component 2):

```
{ type:"booked", contactId, organizationId,
  value,                       // cents, verbatim
  currency,                    // injected default
  sourceCampaignId, sourceAdId,// from mapper (explicit null when absent)
  customer: { email, phone },  // from mapper (explicit null)
  attribution: { fbclid, lead_id }, // from mapper (explicit null)
  occurredAt, source:"calendar-book",
  metadata: { bookingId, opportunityId, service, slotStart, slotEnd } }  // unchanged; NO PII added here
```

### Component 2 — Publisher carry-through

**File:** `packages/core/src/events/outbox-publisher.ts` (`publishBatch`, the payload→`ConversionEvent` reconstruction at `:32-45`).

The publisher reconstructs the `ConversionEvent` from the outbox payload via an explicit **field whitelist**. Today it carries `value, sourceAdId, sourceCampaignId, metadata` (top-level) but **drops `currency`, `customer`, `attribution`, `actionSource`, `accountId`.** Without carrying them, Component 1's stamp is silently discarded before any consumer sees it — the exact "computed-then-discarded" failure this arc exists to kill.

Extend the reconstruction additively to carry: `currency`, `customer`, `attribution`, `actionSource`, `accountId`.

**null vs undefined — intentional boundary (tested both ways):**

- **Outbox payload (producer side):** explicit `null` for known-but-missing measurement fields (`customer: {email: null, phone: null}` when the contact has neither).
- **Reconstruction (publisher side):** preserve explicit `null` when the payload key is _present and null_ ("we looked, there is no attribution"); yield `undefined` only when the payload key is _absent_ ("this event predates the field" — an older emitter). These are not the same for reconciliation/debugging, so the publisher must not coerce one into the other.

### Component 3 — Real reconciliation

**File:** `apps/api/src/bootstrap/inngest.ts` (`runReconciliation`, the stub at `:408-418`).

Replace the hardcoded `{overallStatus:"healthy", checks:[]}` with the real `ReconciliationRunner` (`packages/core/src/attribution/reconciliation-runner.ts`), wired to existing stores:

- `bookingStore.countConfirmed` (`prisma-booking-store.ts:57`)
- `conversionRecordStore.countByType` (`prisma-conversion-record-store.ts:145`)
- `opportunityStore.countByStage` (`prisma-opportunity-store.ts:163`)
- `reconciliationStore.save` (`prisma-reconciliation-store.ts`)

The runner's `ReconciliationReport` output shape already matches the cron's expected return envelope (`{organizationId, overallStatus, checks, dateRangeFrom, dateRangeTo}`). **`ReconciliationRunner` is not exported from the core barrel** (`packages/core/src/index.ts`) — add the export. Reuse already-instantiated stores in the bootstrap where present; otherwise construct from `app.prisma`.

This produces real CRM↔Meta drift — the signal the parallel engine session's measurement-trust gate (Gate 1) consumes.

### Component 4 — CAPI dispatchability (no production flip)

The `MetaCAPIDispatcher` is **already wired** behind `META_PIXEL_ID && META_CAPI_ACCESS_TOKEN` in `conversion-bus-bootstrap.ts:53-87` — so "CAPI-on" needs no new bus wiring. Component 1 is what makes booked events _dispatchable_:

- `canDispatch` returns true given **any one** strong key — `lead_id || fbclid || email || phone` (`meta-capi-dispatcher.ts:33-41`, OR-logic, not all-of). So an email-only contact dispatches; a phone-only contact dispatches; a `leadgen_id`-only contact dispatches.
- For medspa instant-form / CTWA leads, **`fbclid` is not captured upstream** (the Meta lead webhook + Graph lead object don't expose it; only `email`, `phone`, `leadgen_id`, `sourceCampaignId`, `sourceAdId` land in `Contact.attribution`). EMQ therefore rides **email + phone + lead_id**; `fbclid` is threaded faithfully for the web-pixel contacts that do carry it.

The one code change here is the value-units normalization (§2): `normalizeConversionValue(cents → major)` applied inside `MetaCAPIDispatcher` when building `custom_data.value`. (This is the single deviation from "item 3 is test-only" — flagged in §6.)

---

## §2 — Value units (verified, not hand-waved)

`Opportunity.estimatedValue` is a Prisma `Int?` → `number | null`, **stored in cents.** Proof: `apps/dashboard/.../contacts/components/format.ts:1` ("estimatedValue + revenueTotal are stored in CENTS"), `fallback-handler.ts:145` divides by 100 for display, fixtures assert `estimatedValue: 168000 // = S$1,680`. So stamping `value = estimatedValue` directly would tell Meta a booking is worth **$120,000 instead of $1,200**.

The whole conversion system uses cents, not just `estimatedValue`:

- The existing `purchased` `ConversionEvent` emits `value: params.amount` where `amount = LifecycleRevenueEvent.amount` (cents).
- `funnelByOrg` / `funnelByCampaign` do `_sum: { value }` across **all** event types — so `ConversionRecord.value` is summed as cents.
- Ad spend (the trueROAS denominator) is **major units** (`parseFloat(insights.spend) → "100.00"`).

**Decision:** keep value in **cents internally** (funnel-safe; consistent with every other money field) and convert to **major units at the single external Meta boundary.**

- `ConversionEvent.value` carries cents. Add a one-line unit doc-comment to the schema field.
- `booking.create` stamps `value = estimatedValue ?? 0` (cents), no division.
- `normalizeConversionValue(valueInMinorUnits: number): number` (→ major units, `/100`) is applied **only** inside `MetaCAPIDispatcher` when building `custom_data.value`. This corrects the booked path _and_ the latent `purchased` path uniformly, at the one place that must speak Meta's major-unit dialect.

Test asserts the round-trip: `estimatedValue = 320000` (cents) → outbox/event `value = 320000` → CAPI `custom_data.value = 3200`, `currency` present; and `funnelByOrg` sums remain cents-coherent.

---

## §3 — Persistence contract (the A-vs-B decision, made explicit)

`ConversionRecord` has columns for `value` (Float), `sourceAdId`, `sourceCampaignId`, plus a `metadata` JSON — but **no columns** for customer/attribution match keys.

- **Revenue-truth fields** (`value`, `sourceCampaignId`, `sourceAdId`) → **persisted** via the existing `record()` columns. Good for trueROAS/reconciliation. No schema change.
- **CAPI match keys** (`email`, `phone`, `fbclid`, `lead_id`) → **bus-only (deliberately not persisted).** They live in structured `event.customer` / `event.attribution`, which `record()` has no columns for and therefore drops automatically. We do **not** route them into `metadata` — doing so would create a _new plaintext-PII-at-rest_ surface. The live CAPI consumer reads them off the bus and hashes (`em`/`ph`) at send time.

No Prisma migration is required for this slice. (`ReconciliationReport` model already exists.)

---

## §4 — Data flow

```
Meta lead ─► Contact.attribution + Contact.{email,phone}        (existing capture)
                       │
booking.create ─► reads contact + opportunity
                ─► buildBookedConversionPayload(contact) + value(cents)+currency
                ─► outbox `booked` payload (explicit nulls)
                       │
OutboxPublisher ─► reconstructs FULL ConversionEvent (carries customer/attribution/currency)
                       │
            ConversionBus ──► ConversionRecordStore.record()  (value/campaign/ad persisted; match keys dropped)
                          └─► MetaCAPIDispatcher (env-gated): canDispatch? → hash em/ph, lead_id,
                                                              custom_data.value = normalize(cents)

(separate) reconciliation cron ─► ReconciliationRunner ─► CRM-vs-Meta drift report (real counts)
```

---

## §5 — Testing strategy (TDD, co-located `*.test.ts`)

- **`calendar-book.test.ts`** — (a) attributed contact: payload carries `sourceCampaignId, sourceAdId, customer.email, customer.phone, attribution.fbclid, attribution.lead_id, value(cents), currency`; (b) organic contact (no attribution) **with** email/phone: `sourceCampaignId:null, sourceAdId:null, attribution:{fbclid:null, lead_id:null}, customer:{email, phone}` still populated, `value:0, currency:"SGD"`; (c) `value` derives from `estimatedValue` (cents, verbatim).
- **`booked-conversion-payload.test.ts`** — mapper: `leadgen_id → lead_id`, explicit nulls, customer independent of attribution.
- **`outbox-publisher.test.ts`** — (a) new payload with `customer:{email:null,phone:null}` reconstructs with those nulls preserved; (b) **legacy** payload with no `customer`/`attribution` keys reconstructs successfully (those fields `undefined`, not dropped-erroneously); (c) existing top-level fields unaffected.
- **`meta-capi-dispatcher.test.ts`** — dispatch matrix: `email+phone+lead_id` → dispatchable; `email`-only → dispatchable; `phone`-only → dispatchable; `lead_id`-only → dispatchable; no customer + no attribution → **not** dispatchable. Outbound body asserts `user_data.em`, `user_data.ph`, `user_data.lead_id`, `custom_data.value` (major units via `normalizeConversionValue`), `custom_data.currency`; and that raw email/phone are **never** sent unhashed.
- **API reconciliation test** — assert the report is produced **from** mocked store counts (e.g. `countConfirmed=10`, `countByType("booked")=8`, `countByStage("booked")=9` → checks/drift reflect those numbers), proving the stub is gone — not merely `overallStatus:"healthy"`.

**Integration-risk checks for Component 3:** (1) return envelope matches what the cron consumes; (2) runner does not throw if a store count fails unless that is already its contract; (3) `reconciliationStore.save` is safe for repeated cron runs.

---

## §6 — Implementation order & scope notes

Order (TDD — failing test first, then implement):

1. Failing `calendar-book` tests (attributed + organic).
2. Contact/opportunity subset widening + `buildBookedConversionPayload` + payload stamping.
3. Failing `outbox-publisher` carry-through tests (incl. legacy back-compat).
4. Publisher whitelist expansion.
5. CAPI dispatchability test + `normalizeConversionValue` in `MetaCAPIDispatcher`.
6. Replace reconciliation stub with `ReconciliationRunner` (+ core-barrel export).
7. API/cron reconciliation test (real store-backed counts).
8. Verify no optimizer/ad-mutation files changed; `pnpm test` + `typecheck` + `arch:check` + `format:check`.

**Files touched:** `calendar-book.ts`, `booked-conversion-payload.ts` (new), `outbox-publisher.ts`, `meta-capi-dispatcher.ts`, `inngest.ts` (reconciliation region only), `conversion.ts` (one unit doc-comment), `core/src/index.ts` (barrel export), + their co-located tests, + the api bootstrap wiring of `defaultCurrency` into the calendar-book tool deps.

**Scope deviation flagged for review:** the approved design framed item 3 as test-only. The verified units constraint (§2) means item 3 now includes a **small real change to `meta-capi-dispatcher.ts`** (the `normalizeConversionValue` at `custom_data`). It is squarely the CAPI component and 0-diff on every live branch, but it is a code change, not just a test.

---

## §7 — Parallel-safety (a sibling Riley engine session is live)

Verified against `origin/main` and every active worktree branch:

- The engine session (`feat/riley-phase-a-abstention-floor`, `docs/riley-phase-a-planning`) owns `ad-optimizer/*` (campaign-decision, audit-runner, recommendation-engine, learning-phase-guard, evidence-floor, denominator-step-change, meta-campaign-insights-provider, evals/), `metrics-riley.ts`, the `byCampaign` projection, and `capiAttributionStale` wiring. **This slice touches none of them.**
- Both Riley branches show an identical _stale_ `calendar-book.ts` delta confined to the unrelated `slots.query` handler (main is ahead there); the booked-event region is byte-identical to main.
- `work-trace-bypass-guard` edits `inngest.ts` only at lines ~252 & ~548 — not the reconciliation stub (~408-418).
- `outbox-publisher.ts`, `reconciliation-runner.ts`, `conversion-record-store.ts`, `conversion.ts`, `meta-capi-dispatcher.ts`, `ad-optimizer-config.ts` are 0-diff on every live branch.

---

## §8 — Non-goals (out of scope, by design)

No `PlatformIngress` execution path; no campaign writes; no `MetaAdsClient` mutation; no per-campaign `byCampaign` projection; no rate-aware significance / lead-volume floor / economics-derived target config; no `capiAttributionStale` engine wiring; **no CAPI production enablement** (env-gated, gated on Meta App Review); no schema migration; no change to the `purchased`-event producer (`revenue.ts`) beyond the shared dispatcher's units fix.

---

## §9 — Open questions (resolve in writing-plans)

1. Exact bootstrap wiring point for `defaultCurrency` into the calendar-book tool deps (and whether the api bootstrap already resolves an org currency cheaply — if so, prefer it over the constant default).
2. Whether any already-instantiated booking/opportunity/conversion-record stores exist in the inngest bootstrap to reuse, vs. constructing fresh from `app.prisma`.
3. Confirm the `purchased`-path units fix in `MetaCAPIDispatcher` doesn't disturb an existing dispatcher test that asserts verbatim `value` (update it to assert normalized major units if so).
