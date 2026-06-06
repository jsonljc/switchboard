# Spec: Close the Revenue Loop on One Chain (Spec 1)

> Date: 2026-06-05 · Status: approved (shape) with prove/act milestone split · Review: incorporated 2026-06-06
> Strategy parent: `docs/audits/2026-06-05-receipted-bookings-architecture/receipted-bookings-architecture-map.md` (north star = the revenue loop)
> Design method: superpowers brainstorming → (this spec) → writing-plans. Informed by a 9-agent architect fan-out against `main`.

## 1. Goal

Make **"this paid $X visit came from this ad"** a provable, replay-proof fact, and let **Riley reallocate ad budget toward it through human approval**. The strategic target is the full loop (prove + act); the **execution is split into two demo milestones** so the first sales/WTP test does not depend on live Meta budget mutation:

- **Spec-1A — prove leg:** ad → WhatsApp → booking → deposit paid → *"this paid $X visit came from campaign Y."* (The first sellable artifact; run the WTP demo on this.)
- **Spec-1B — act leg:** Riley proposes a budget shift → human approves the exact frozen payload → the Meta budget actually changes → the outcome ledger scores **only** the executed action. (The moat; highest engineering risk.)
- **Spec-1C — architecture B append:** the existing-PMS clinic (calendar re-fetch) on the identical spine.

The owner's job this serves: *make more money, and know which spend produced it.* Proof is the trust signal and Riley's input; the moat is the **acting** loop — but proven paid-visit attribution is valuable and sellable on its own, before the act leg ships.

## 2. Confirmed scope decisions

- **Milestone split (prove then act).** The strategic loop stays intact, but Spec-1A (prove) ships and is WTP-tested **before** Spec-1B (act). Rationale: the doc itself flags the act leg as the only slice with no working Meta-mutation precedent and real ad-spend risk — do not block the first clinic demo on it. In Spec-1A, Riley still **produces** a recommendation; it just does not **execute** until Spec-1B.
- **A-first, B appended.** Architecture A (no-PMS, Switchboard owns the deposit) goes end-to-end across 1A+1B; architecture B (existing-PMS calendar re-fetch) is Spec-1C. B's paid/attribution path shares ~zero code with A, so the `Receipt`/port *seam* is parametrized from the start while the B *adapter* lands last.
- **Read surface before the act leg.** The owner-facing "paid visits by ad" surface (1A-6) ships in the prove milestone and is **decoupled** from Riley execution. (The original PR-7 conflated the read surface with feeding Riley's input; those split — read surface → 1A, reallocation-input wiring → 1B.)
- **Noop payment adapter first; live Stripe Connect is the immediate fast-follow** behind the same `PaymentPort`. Noop proves the mechanics without Stripe-Connect onboarding or a payment-ready pilot clinic.

## 3. In scope

1. **Heal the two-contact split** — one canonical E.164 normalizer in `@switchboard/schemas` (L1), called at `ctwa-adapter`, `instant-form-adapter`, `resolve-contact-identity`, and `lead-intake-store`, plus normalized `findByPhone`, so the CTWA Contact carrying attribution **is** the Contact a booking resolves against. The prove leg is null until this lands. (The campaign-id resolver is a small companion fix — `buildBookedConversionPayload` already reads `attribution.sourceCampaignId`.)
2. **Make the chain queryable** — pass `workTraceId` at `calendar-book` (omitted today, `calendar-book.ts:259`); add `WorkTrace.contactId` + `WorkTrace.conversationThreadId` (both added to `EXCLUDED_BASE` so the content hash is untouched — precedent: `injectedPatternIds`, verified at `work-trace-hash.ts:13,22`); stamp `ConversionRecord.bookingId` (column exists, `schema.prisma:2045`) on the booked event; add `LifecycleRevenueEvent.bookingId`.
3. **One `Receipt` primitive** — new model: `kind (calendar|payment)` + `tier (T1_FETCH_BACK > T2_PROVIDER_SIGNATURE > T3_ADMIN_AUDIT)` + a structured predicate `isPaidVisit → {paid, held, tier, basis, degraded}` (never a bare boolean). Prod-assert: a Noop/Local calendar provider can **never** mint above T3.
4. **No-PMS paid fact (architecture A)** — `PaymentPort` interface in L1 schemas (mirrors `CalendarProvider`); Noop adapter (1A-4) then Stripe Connect adapter (1A-4b) + per-org factory in `apps/api`; deposit-link issuance attached to a confirmed booking (co-located helper, not inlined into `calendar-book.ts`); a new **ingress-receiver** webhook route that **re-fetches the charge by id** (never trusts the webhook body amount) and writes `PaymentReceipt(verified, T1)` + `LifecycleRevenueEvent(verified=true, bookingId)` + a `purchased` OutboxEvent in one transaction, gated by a DB unique on `(organizationId, externalReference)`.
5. **Anti-fake hardening** — deterministic booked `eventId` (`evt_booked_${bookingId}`, replacing `randomUUID()` at `calendar-book.ts:342`); `origin (live|seed|demo)` on `Booking`/`ConversionRecord`/`LifecycleRevenueEvent` with the metric filtering `live`; external-timestamp windowing (PSP charge time / `Booking.startsAt`) instead of in-app `occurredAt`; force `operator.record_revenue` to `verified=false` + `recordedBy ∈ {owner,staff}`; gateway idempotency key from the provider message id, deduped at `PlatformIngress.submit`.
6. **Owner read surface (prove leg, decoupled)** — extend `GET /:orgId/revenue/by-campaign` to filter `verified=true` and join via `bookingId`; one "paid visits by ad" dashboard panel reusing `campaigns-section.tsx`. Depends only on verified paid data + the chain — **not** on Riley execution.
7. **Riley act-leg that EXECUTES (act milestone)** — a structured budget-delta producer in `ad-optimizer`; a new `adoptimizer.campaign.reallocate` workflow intent cloned from the proven `recommendation-handoff` contract + a seeded `require_approval(mandatory)` policy; `MetaAdsClient.getCampaign` + `updateCampaignBudget` (new; keep `updateCampaignStatus`'s ACTIVE-throw for pause); a read-modify-**re-read** executor returning an `ExecutionReceipt` persisted to `WorkTrace.executionOutputs`; outcome ledger re-keyed off `executedAt` (not bare `status='acted'`).
8. **Wire PAID value into the reallocation input (act milestone)** — `queryPaidValueCentsByCampaign` (cents, absent key = no value, never 0); prefer it for `trueRoas` (booked as labeled fallback) so Riley reallocates toward verified paid dollars.
9. **Existing-PMS paid path (architecture B, Spec-1C)** — implement `getBooking` via Google `events.get`; wire per-deployment Google OAuth in `calendar-provider-factory` (stored-but-unused today); `paid` maxes at `held` via calendar evidence, reaching `paid` only via human `operator.record_revenue` with an external PMS/POS reference (T3). Reuses the 1A+1B spine unchanged.

## 4. Out of scope (deferred, with reason)

- **Meta CAPI dispatch** for the paid event — the internal dashboard prove-leg does not need it; CAPI only improves Meta's own optimization, already env-gated off.
- **PMS attendance states** (`held`/`no_show`/`arrived` as queryable Booking statuses) — the loop is provable on `confirmed → paid`; deposit-paid is a stronger "visit happened" proxy than attendance. (May set `status='held'` on a verified deposit; do not add `no_show`.)
- **`Opportunity.estimatedValue` price-anchoring** — key the loop on the **real verified deposit amount**.
- **DuitNow (MY)** as a second adapter — PayNow rides the Stripe SG Connect adapter for Spec-1; DuitNow slots behind the same port later.
- **RFC3161 / S3-WORM anchoring, full line-item PSP-payout reconciliation, cryptographic non-repudiation** — a later "trust" spec. Spec-1 proves the loop with DB uniqueness + origin filtering + external-timestamp windowing + count-level reconciliation.
- **The in-skill guided-trust approval refactor** (`skill-executor.ts:550`) — route the new money/reallocation mutations through the **platform** `require_approval` path (which persists a lifecycle and resumes-to-execute). The in-skill refactor is its own later PR (and must then freeze the concrete booking tool-call, not the non-deterministic `alex.respond` turn).
- **`ApprovalLifecycle.respondedBy/approverPrincipalId`** — attribution already lands on `WorkTrace.approvalRespondedBy`; the dedicated column is SG/MY audit-trail hardening, scheduled separately.
- **Backfill/merge of existing split Contacts** — the partial-unique guardrail prevents new splits; the destructive one-shot merge of historical rows is its own operator-run, AuditLedger-recorded, dry-run-first migration.
- **Multi-org / batch / fan-out reallocation; restructure/consolidate/expand Riley actions.** One org, one chain, pause + budget-edit only.
- **Refund accounting beyond exclusion** — Spec-1 excludes refunded `externalReference`s from the count; full net-to-zero refund handling deferred.

## 5. Architecture

The loop hangs on **one spine, architecture-agnostic by construction**:

```
Contact (unified by canonical E.164)
  ← ConversationThread
    ← WorkTrace(contactId, conversationThreadId)
      ← Booking(workTraceId)
        ← Receipt(bookingId)
          ← ConversionRecord / LifecycleRevenueEvent(bookingId)
```

The **Booking row is the single common anchor**, so one SQL query reconstructs `ad → conversation → booking → paid` for both clinic types. The only differences are (i) the provenance of the receipt and (ii) the source of the paid signal — neither changes the join graph.

**ACT connects to PROVE through Riley:** the read side computes paid-value-per-campaign from `verified` Receipts; the act side reallocates Meta budget toward it — but only after a human approves an exact "daily budget X→Y cents" frozen card. The act leg is identical for both architectures (touches neither booking nor payment) and reads one normalized per-campaign economics field regardless of source.

**Parametrization lives in exactly one place** — a per-org discriminator (`no_pms | existing_pms`, an explicit `OrganizationConfig` field, **not** derived from `clinicType`) selects the mint path feeding the shared `Receipt`:

- **A (no-PMS):** `PaymentPort` issues a first-party deposit link on a confirmed booking; the PSP webhook re-fetches the charge and mints `PaymentReceipt(kind=payment, verified, T1)` → `isPaidVisit.paid=true`. Attribution is first-party.
- **B (existing-PMS):** `calendar-book` re-fetches the external event via `getBooking` and mints `CalendarReceipt(kind=calendar)` whose status maxes at `held` → `isPaidVisit.held=true, paid=false`; reaches `paid=true` only via human `operator.record_revenue` with an external ref (T3).

The structured verdict `{paid, held, tier, basis, degraded}` keeps this honest: the dashboard distinguishes "paid $X — deposit captured (A)" vs "paid $X — operator-confirmed against PMS ref (B)" vs "attended — calendar-confirmed, payment unverified." **Riley consumes only `paid:true` value**, so the same reallocation math serves both.

## 6. Components

| # | Component | Milestone | Layer / placement |
|---|---|---|---|
| C1 | Identity spine (E.164 + chain weld) | 1A | normalizer schemas (L1); call sites L2/L3; columns L4 |
| C2 | `Receipt` primitive + `isPaidVisit` + prod-assert | 1A | schemas (L1) type; predicate/store-iface core (L3); Prisma impl L4 |
| C3 | No-PMS payment (A): `PaymentPort` + Noop→Stripe + webhook + verified writer | 1A | port L1; adapters/factory/route/orchestration `apps/api` (L5) |
| C4 | Anti-fake hardening | 1A | L4/L5 write paths |
| C5 | Owner read surface ("paid visits by ad") | 1A | store L4; route L5; UI dashboard |
| C6 | Riley act-leg (reallocation that executes) | 1B | producer/client L2; submitter/executor/intent `apps/api` (L5) — ad-optimizer must NOT import core |
| C7 | Paid value → Riley input | 1B | store L4; analyzer L2 |
| C8 | Existing-PMS (B): `getBooking` re-fetch + per-deployment OAuth | 1C | calendar adapter core (L3); factory/OAuth L5 |

## 7. Data model changes (each migration in the same commit as its code)

- `Contact`: add `phoneE164 String?` + `@@index([organizationId, phoneE164])` + **partial unique** `(organizationId, phoneE164) WHERE phoneE164 IS NOT NULL` (raw SQL; precedent `20260603120000_booking_partial_unique_active`). Derive `phoneE164` in the store create/upsert so no caller can drift it.
- `WorkTrace`: add `contactId String?` + `conversationThreadId String?` + indexes; **add both names to `EXCLUDED_BASE` in `work-trace-hash.ts` in the same commit** (no `hashInputVersion` bump).
- `Booking`: add `origin String @default("live")`. (`workTraceId` exists; populate it.)
- `ConversionRecord`: add `origin String @default("live")` + `externalRef String? @unique`. (`bookingId` exists; populate it.)
- `LifecycleRevenueEvent`: add `bookingId String?` + index + `origin String @default("live")` + **partial unique** `(organizationId, externalReference) WHERE externalReference IS NOT NULL` (today no DB unique — replayable).
- `Receipt` (new): `id, organizationId, kind, tier, status (held|paid|void), bookingId?, opportunityId?, revenueEventId?, connectionId?, provider?, externalRef?, amount Int?, currency?, evidence Json (Zod-discriminated by kind, no any), capturedBy, verifiedAt?, workTraceId?, createdAt`. Indexes `(organizationId, bookingId)`, `(organizationId, kind, status)`; partial unique `(organizationId, kind, externalRef) WHERE externalRef IS NOT NULL`.
- `PendingActionRecord` (1B): add `executionWorkUnitId String?` + `executedAt DateTime?` + `@@index([organizationId, status, executedAt])`. Populate existing always-null `RecommendationOutcome.executableWorkUnitId`.
- `OrganizationConfig`: add `clinicArchitecture (no_pms | existing_pms)` — distinct from `clinicType`.

## 8. Supervised-approval model

- **Money & reallocation mutations** go through the **platform `require_approval` path** (`createGatedLifecycle` — persists a lifecycle, resumes-to-execute, `bindingHash` content-binding). The reallocation intent is `defaultMode:'workflow'`, **not** `system_auto_approved`, gated by a **seeded `require_approval(mandatory)` policy** (non-downgradeable; immune to the autonomy spend-relax, off by default anyway). The human approves an exact "daily budget X→Y cents" frozen payload.
- **Verified-payment writer** is a **new `payment.record_verified` intent registered `system_auto_approved`** — authority is the external PSP fetch-back, not human judgment. `operator.record_revenue` stays separate and demoted to `verified=false`.
- **Deposit-link issuance** is an idempotent external read riding on the already-approved booking — no new approval.

## 9. Anti-fake measures (each maps to a verified defect)

1. **Replay** — deterministic booked `eventId`; PSP charges deduped by global-unique `externalRef`.
2. **Fixture leakage** — `origin (live|seed|demo)`; seed scripts stamp `seed`; metric reads only `live`.
3. **Clock games** — weekly metric windows on **external** timestamps, never in-app `occurredAt`.
4. **Operator-forged revenue** — `operator.record_revenue` forced to `verified=false` + `recordedBy ∈ {owner,staff}`; only the PSP-webhook path sets `verified=true`; the trustworthy count reads only `verified=true`.
5. **Gateway double-execute** — idempotency key from the provider message id, deduped at `PlatformIngress.submit`.

## 10. PR sequence (feeds writing-plans)

### Spec-1A — prove leg (ship + WTP-test before the act leg)

1. **1A-1 Heal the two-contact split** (C1 pt1). L1 E.164 normalizer + four call sites + normalized `findByPhone` + `Contact.phoneE164` + partial-unique. *Ships: attribution non-null on the live CTWA path.* Deps: none. **Load-bearing — every downstream receipt is mis-attributed until this lands.**
2. **1A-2 Weld booking→WorkTrace→ConversionRecord** (C1 pt2). Pass `workTraceId`; `WorkTrace.contactId/conversationThreadId` + `EXCLUDED_BASE`; stamp `ConversionRecord.bookingId`; re-key gateway thread off resolved `contactId/org`. *Ships: one-query chain.* Deps: 1A-1.
3. **1A-3 `Receipt` primitive + `isPaidVisit` + prod-assert** (C2). Mint a `CalendarReceipt` in the confirm tx (T1 only on a real re-fetch; honest degradation). *Ships: the "is this real, how strongly" abstraction before money flows.* Deps: 1A-2.
4. **1A-4 No-PMS payment-port + Noop adapter + PSP webhook + verified writer** (C3, Noop). `PaymentPort` (L1); Noop adapter + factory; deposit-link helper; ingress-receiver webhook (fetch-back by id); `PaymentReceipt(verified,T1)` + `LifecycleRevenueEvent(verified=true,bookingId)` + `purchased` outbox in one tx; DB-unique `externalReference`. *Ships: first PAID-verified-attributed dollar (mechanics), replay-proof.* Deps: 1A-3, 1A-2.
   - **1A-4b Live Stripe Connect adapter** behind the same `PaymentPort`. *Ships: real money.* Deps: 1A-4.
5. **1A-5 Anti-fake hardening** (C4). Deterministic `eventId`; `origin` markers + seed stamping + metric filter; external-timestamp windowing; demote operator revenue; gateway idempotency key. *Ships: the paid number is trustworthy.* Deps: 1A-4.
6. **1A-6 Owner read surface "paid visits by ad"** (C5). Extend `by-campaign` route (filter `verified=true`, join `bookingId`) + dashboard panel. *Ships: the owner SEES "this paid $X came from campaign Y" — the first sellable artifact.* Deps: 1A-4, 1A-2 (NOT Riley).

**→ WTP GATE: run the Spec-1A demo with 10–15 SG/MY clinics before committing Spec-1B.** Riley may already show a *recommendation* (no execution) at this point.

### Spec-1B — act leg (the moat)

7. **1B-1 Riley reallocation that EXECUTES under approval** (C6). Structured budget-delta producer; `adoptimizer.campaign.reallocate` intent + builder + seeded mandatory policy; Meta `getCampaign`/`updateCampaignBudget` (keep ACTIVE-throw for pause); read-modify-re-read executor + `ExecutionReceipt`; ledger re-key off `executedAt`. *Ships: an approved reallocation actually changes the Meta budget; only executed actions scored.* Deps: 1A-5 — **de-risk the Meta mutation against a mock first (see §12).**
8. **1B-2 Wire PAID value into the reallocation input** (C7). `queryPaidValueCentsByCampaign`; prefer paid in `trueRoas`. *Ships: Riley reallocates toward verified paid dollars — the loop's literal ask.* Deps: 1B-1, 1A-4.
9. **1B-3 (optional, parallel) weekly proof projection + reconciliation-lite.** Durable `WeeklyPaidAttribution` cron (clone `creative-attribution.ts`), external-timestamp-windowed, origin-filtered, count-level drift check; kill-switch default off. *Ships: a durable citable weekly number.* Defer if 1A-6's read-time query suffices. Deps: 1A-5.

### Spec-1C — architecture B append

10. **1C-1 Existing-PMS calendar re-fetch** (C8). `getBooking` via `events.get`; per-deployment Google OAuth (user-delegated refresh-token path — distinct from the existing service-account JWT); discriminator; CalendarReceipt (held ceiling); paid via T3 record_revenue. *Ships: second architecture on the proven spine.* Deps: 1A + 1B.

## 11. Cross-cutting decisions (locked)

- Canonical phone storage = **additive `phoneE164`** (derive in the store).
- Conversation↔workTrace edge = **`WorkTrace.conversationThreadId`** (resolve thread id server-side at submit; land the gateway-thread re-key first).
- `WorkTrace` new columns in `EXCLUDED_BASE`, same commit, no `hashInputVersion` bump.
- `isPaidVisit` = **structured verdict**, never a bare boolean.
- `PaymentPort` interface in L1; orchestration + webhook in `apps/api` (not `apps/chat`).
- Verified-payment writer = **new `payment.record_verified`** (`system_auto_approved`); `operator.record_revenue` demoted.
- Riley reallocation = **new `adoptimizer.campaign.reallocate` workflow intent** (clone handoff), not an extension of `act_on_recommendation`.
- Money values flow as **minor units (cents)** end-to-end, normalized to major units exactly once at `trueRoas` (the gate's `spendAmount` is dollars) — **pin the unit boundary with a hard test** (a 100× bug destroys trust instantly).
- E.164 default = **SG/MY heuristics + refuse-to-guess** (return null rather than a wrong merge; wrong-merge is worse than no-merge).
- `ConversionStage` reuse **`purchased`** for a paid deposit (no enum blast radius).
- Discriminator = explicit `OrganizationConfig.clinicArchitecture`, not derived from `clinicType`.

## 12. Risks & de-risk order

**Riskiest: 1B-1 (Riley executes a real Meta budget change)** — the only leg with no working mutation precedent (no budget-write method; `updateCampaignStatus` dead and throws on ACTIVE), crosses the most layers (L2 producer → L5 submitter → L3 ingress/approval → L5 executor → L2 client), and a bug spends real ad money. **The milestone split removes this from the first WTP demo.** De-risk order within 1B:

0. Characterization test: `act_on_recommendation` today only flips status, no Meta call — pin before changing.
1. Build + test the idempotent Meta budget-update method against a **mocked** Graph API, in isolation, before any ingress wiring.
2. Stand up `RileyBudgetSubmitter` as a structural mirror of `RecommendationHandoffSubmitter` with a **no-op** executor first — prove the L2→L5→L3 path compiles and respects layers.
3. Add the structured budget-delta to `recommendation-sink`; assert it flows into the spend-threshold so approval triggers.
4. Route through `require_approval` with an idempotency key; approve→dispatch hits the client exactly once, replay is a no-op.
5. Re-key the outcome ledger off `executedAt` last.

Other risks (and watchouts confirmed in review): **1A-1 is the most load-bearing piece** — if the two-contact split survives, attribution is fake no matter how good the Receipt model is (sequenced first; verify on a real CTWA booking that `sourceCampaignId` is non-null before building the paid/read surfaces). **Money units** — cents end-to-end, normalized once at `trueRoas`; a 100× bug destroys trust (hard validator). **Noop adapter semantics** — the Noop/Local prod-assert (can never mint above T3) is essential and ships in the same PR as receipt minting. **Operator revenue demotion** is non-negotiable — only PSP fetch-back sets `verified=true`. Per-org credential population unverified (fail closed if no org-scoped Connection — never fall back to global env for a live write). File-size/layering hot spots (`platform-ingress.ts`, `skill-executor.ts` >600; `calendar-book.ts` ~440; `recommendation-sink.ts` ~493 — extract new files; ad-optimizer L2 must never import core).

## 13. Test strategy (strict TDD, test-first, co-located `*.test.ts`)

- **Identity:** normalizer unit matrix (`6591234567 → +6591234567`, idempotent `+`, SG 8-digit, MY 0-prefixed drop-0, junk → null never throws); the load-bearing unification regression (lead.intake Contact A then `resolve-contact-identity` with bare wa_id MUST return A, MUST NOT create); WorkTrace content-hash invariance with/without the new columns.
- **Chain:** `calendar-book` passes `workTraceId` (spy); strong-tier join `Booking.workTraceId → WorkTrace.workUnitId → contactId`; one-query chain proof for both architectures differing only in receipt-source label.
- **Receipt:** `isPaidVisit` verdict matrix (calendar-T1-held, calendar-T3-local degraded, payment-T1 paid, B held→T3 paid, void); the prod-assert (`NODE_ENV=production` + Noop/Local never mints above T3).
- **Payment A:** webhook rejects bad HMAC over raw body, refuses unresolvable org, never trusts body amount (asserts re-fetch), writes receipt+revenue+outbox in one tx, replay (same `externalReference`) is an idempotent no-op; `operator.record_revenue` with `recordedBy:'stripe'` rejected by the narrowed enum.
- **Anti-fake:** clock-game (two paid rows, same in-app time, different external time → only in-window external counts), replay (deterministic `eventId` collision → one row), fixture leakage (`origin=seed` excluded), gateway idempotency (same wamid twice → one booking).
- **Read surface:** `by-campaign` returns one line per paid visit (not an aggregate), `verified=true` only, org-isolated.
- **Act-leg (1B):** outcome-ledger gating (`status='acted'` + null `executedAt` excluded, with-receipt included); read-modify-re-read executor (post-change budget == requested; Meta error writes no receipt); `BUDGET_DRIFTED` fail-closed; real-gate routing (seeded mandatory parks even under-threshold, sharing the seed module so the test can't drift); frozen-payload binding (mutated parameter fails `bindingHash`); idempotency replay (one Meta edit per key); unit-boundary test (`50000c paid / $100 spend → 5.0x`, not 500x).
- **Paid input (1B):** `queryPaidValueCentsByCampaign` sums only `verified purchased>0` with non-null campaign in cents, absent campaign absent from the map (not 0).
- **Cross-cutting:** every Prisma mutation includes `organizationId` in WHERE via `updateMany` + `count===0` guard; cross-org webhook/recommendationId resolves to not-found and writes nothing; route-class headers validate (`ingress-receiver` for the PSP webhook, `read-only` for the paid-visits surface).
- Coverage gates: core 65/65/70/65, global 55/50/52/55.

## 14. Acceptance

**Spec-1A — paid-visit proof (the WTP demo):** a SG/MY no-PMS clinic runs a CTWA ad → WhatsApp → Alex books (booking carries the ad's campaign via the unified Contact) → a deposit link is paid → a `verified` `PaymentReceipt` is joined to the booking → the owner sees one line *"this paid $X visit came from campaign Y"* (windowed on the external charge timestamp, `origin=live`). **Replaying the charge, backdating it, leaking seed/demo data, or operator-typing fake revenue does not move the number.**

**Spec-1B — approved reallocation:** Riley proposes a budget shift, a human approves the exact frozen "X→Y cents" payload, the Meta budget actually changes, and **only the executed action is scored** by the outcome ledger.

**Spec-1C — architecture B:** an existing-PMS clinic produces a `held` `CalendarReceipt` from a real external-event re-fetch (and `paid` via T3 operator confirmation) on the identical spine, distinguished honestly in the read surface.

## 15. Branch/PR note

Per `CLAUDE.md` branch doctrine this spec lands on `main` via its own focused PR (authored in the `docs/close-the-revenue-loop` worktree under `.claude/worktrees/`). Each PR in §10 is a separate implementation PR consuming this spec; implementation worktrees run `pnpm worktree:init` at start (skipped here as this is docs authoring).
