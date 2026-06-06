# Close the Revenue Loop — Spec-1A (Prove Leg) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "this paid $X visit came from campaign Y" a provable, replay-proof fact for one no-PMS clinic chain — the first sellable artifact and the WTP demo, before the act leg (Spec-1B).

**Architecture:** One spine — Contact (unified by canonical E.164) <- ConversationThread <- WorkTrace(contactId, conversationThreadId) <- Booking(workTraceId) <- Receipt(bookingId) <- ConversionRecord/LifecycleRevenueEvent(bookingId). Architecture A (no-PMS): a verified PSP PaymentReceipt makes the paid visit a first-party fact. Calendar receipts are BOOKED (not held); only a verified payment is PAID; Noop/Local providers can never mint production-countable evidence. Riley act-leg and architecture B are out of this plan (Spec-1B/1C).

**Tech Stack:** TypeScript ESM monorepo (pnpm, Turborepo), Prisma/Postgres, vitest, Fastify (apps/api), Next.js (apps/dashboard).

Spec: `docs/superpowers/specs/2026-06-05-close-the-revenue-loop-design.md`. Sequence is strict: **1A-0 (live-path preflight) precedes all**, then 1A-1 (load-bearing identity unification). Run `pnpm worktree:init` in the implementation worktree before starting. Revised 2026-06-06 per design review: added 1A-0 preflight; split the payment PR into 1A-4a/b/c/d; Noop is never production-countable; calendar=booked not held; E.164 refuses to guess; explicit seed origin; honest attribution labels.

---

## File map (all PRs)

| PR | Action | Path | Responsibility |
|---|---|---|---|
| 1A-0 | modify | `/Users/jasonli/switchboard/packages/core/src/platform/skill-intent-registrar.ts` | Live skill-intent registrar (barrel-exported, called at skill-mode.ts:149). FIX: in addition to registering each skill's declared `skill.intent` (unchanged — load-bearing for mira's creative.brief.compose cron), ALSO register `${skill.slug}.respond` when it differs from skill.intent, so ChannelGateway's `${skillSlug}.respond` submission (channel-gateway.ts:313) resolves at PlatformIngress lookup instead of returning intent_not_found. Both registrations share the same derived mutationClass/budgetClass and allow the gateway's `chat` trigger. |
| 1A-0 | create | `/Users/jasonli/switchboard/packages/core/src/platform/skill-intent-registrar.respond.test.ts` | Regression test encoding the gateway↔registrar contract: feeding a SkillDefinition with intent `alex.run` and slug `alex` to the LIVE registrar must register BOTH `alex.run` (preserved) AND `alex.respond` (the exact intent + `chat` trigger the gateway submits), with the .respond executor bound to the slug. Also asserts a 3-part intent (mira: slug `creative`, intent `creative.brief.compose`) preserves the declared intent and adds `creative.respond` with no duplicate-registration throw. |
| 1A-0 | create | `/Users/jasonli/switchboard/packages/core/src/platform/__tests__/managed-inbound-intent-smoke.test.ts` | CI-safe managed-inbound smoke over the REAL skills/alex/SKILL.md (loadSkill) through the REAL registrar into a REAL IntentRegistry, asserting the EXACT lookup + trigger validation PlatformIngress.submit performs for the gateway's submission: lookup('alex.respond') is defined (not intent_not_found) and validateTrigger('alex.respond','chat') is true. Pins that an inbound managed message reaches a registered skill intent without booting Anthropic/Postgres. |
| 1A-0 | create | `/Users/jasonli/switchboard/packages/core/src/intents/__tests__/lead-intake-intent-registration.smoke.test.ts` | Regression pin for the CTWA path (part d): asserts the `lead.intake` intent the ctwa-adapter emits is registered as a workflow intent with the triggers the adapter-originated submit uses, so ctwa-adapter → lead.intake → PlatformIngress cannot silently regress to intent_not_found. Mirrors the registration shape used at contained-workflows.ts:401 against a real IntentRegistry. |
| 1A-1 | create | `packages/schemas/src/phone.ts` | Canonical E.164 helpers (L1, no deps): isE164(value) boolean guard reusing the ^\+[1-9]\d{6,14}$ pattern; normalizeToE164(raw, region?) that strips spaces/dashes/parens, keeps already-+ numbers, infers +65 for SG 8-digit [89]xxxxxxx when region is 'SG' or undefined, infers +60 for a 0-prefixed MY national number ONLY when region==='MY', and returns null for ambiguous/junk/0-prefixed-without-region inputs (never throws). |
| 1A-1 | create | `packages/schemas/src/phone.test.ts` | Co-located unit matrix for normalizeToE164/isE164: already-+ idempotent; 6591234567→+6591234567; SG 8-digit→+65; 0-prefixed MY WITHOUT region→null; 0-prefixed WITH region 'MY'→+60; spaces/dashes/parens stripped; junk→null without throwing. |
| 1A-1 | modify | `packages/schemas/src/index.ts` | Barrel-export the new ./phone.js module so consumers import normalizeToE164/isE164 from @switchboard/schemas. |
| 1A-1 | modify | `packages/schemas/src/lifecycle.ts` | Add phoneE164: z.string().nullable().optional() to ContactSchema so the Contact type (z.infer) carries the new stored column and mapRowToContact can return it. |
| 1A-1 | modify | `packages/ad-optimizer/src/lead-intake/ctwa-adapter.ts` | Replace the startsWith('+') phone normalization (line 54) with normalizeToE164(msg.from, opts.region); add optional region?: 'SG'|'MY' to the builder opts and to CtwaAdapterDeps, threaded into buildCtwaIntake; keep idempotencyKey keyed on the normalized phone; if normalization returns null, fall back to the prior +-prefixed behavior so a non-SG bare number still ingests. |
| 1A-1 | modify | `packages/ad-optimizer/src/lead-intake/ctwa-adapter.test.ts` | Add region-threading cases: SG bare 8-digit normalizes to +65; an explicit region:'MY' on a 0-prefixed number normalizes to +60; existing +-prefixed cases stay green. |
| 1A-1 | modify | `packages/ad-optimizer/src/lead-intake/instant-form-adapter.ts` | Replace the local normalizePhone helper (lines 25-28) with normalizeToE164 threaded with an optional region from InstantFormAdapterDeps/opts; preserve the null-when-no-identifier contract. |
| 1A-1 | modify | `packages/ad-optimizer/src/lead-intake/instant-form-adapter.test.ts` | Add a case proving normalizeToE164 is used (bare SG 8-digit phone field → +65) and that an un-normalizable phone still yields a contact when an email is present. |
| 1A-1 | modify | `packages/core/src/channel-gateway/resolve-contact-identity.ts` | Add optional region?: 'SG'|'MY' to resolveContactIdentity args; normalize the wa_id (sessionId) via normalizeToE164 before findByPhone AND before create, falling back to the raw sessionId when normalization returns null; return the normalized phone. |
| 1A-1 | modify | `packages/core/src/channel-gateway/resolve-contact-identity.test.ts` | Add the load-bearing case: a bare wa_id '6591234567' calls findByPhone with the NORMALIZED '+6591234567' (so it resolves an existing +-stored contact) and does NOT create a second contact. |
| 1A-1 | modify | `packages/core/src/channel-gateway/channel-gateway.ts` | At the resolveContactIdentity call site (line 218) pass region: undefined (no market signal available on DeploymentResolverResult today) — explicit, documenting the refuse-to-guess default. |
| 1A-1 | modify | `packages/db/src/stores/prisma-contact-store.ts` | Derive phoneE164 = normalizeToE164(input.phone) in create() and write it to the create data; in findByPhone() normalize the incoming phone and query the phoneE164 COLUMN (falling back to a raw-phone exact match when normalization returns null); add phoneE164 to mapRowToContact's row param type and returned object. |
| 1A-1 | modify | `packages/db/src/stores/__tests__/prisma-contact-store.test.ts` | Mock-Prisma tests: create() writes the derived phoneE164; findByPhone('+65 9123 4567') queries { organizationId, phoneE164: '+6591234567' }; findByPhone of an un-normalizable value falls back to a raw phone query; mapRowToContact surfaces phoneE164. |
| 1A-1 | modify | `packages/db/src/stores/lead-intake-store.ts` | Derive phoneE164 = normalizeToE164(input.phone) in upsertContact's create branch (leave the no-op update branch untouched) so the CTWA Contact stores the canonical column the gateway later matches on. |
| 1A-1 | create | `packages/db/src/stores/__tests__/prisma-lead-intake-store-phone.test.ts` | Mock-Prisma unit test (the existing lead-intake-store.test.ts is a DATABASE_URL-gated integration test; add a co-located mocked-Prisma unit test) asserting upsertContact's create data includes the derived phoneE164 and the update branch is untouched. |
| 1A-1 | modify | `packages/db/prisma/schema.prisma` | Add phoneE164 String? to the Contact model (after the phone field, ~line 1745) and @@index([organizationId, phoneE164]); the partial unique is added via raw SQL migration, not in-schema. |
| 1A-1 | create | `packages/db/prisma/migrations/20260606000000_contact_phone_e164/migration.sql` | Same-commit migration: ALTER TABLE add phoneE164 column; CREATE INDEX on (organizationId, phoneE164); CREATE UNIQUE INDEX partial on (organizationId, phoneE164) WHERE phoneE164 IS NOT NULL — mirroring 20260603120000_booking_partial_unique_active. |
| 1A-2 | modify | `/Users/jasonli/switchboard/packages/core/src/skill-runtime/tools/calendar-book.ts` | Part (a): pass workTraceId: ctx.workUnitId ?? null into the bookingStore.create(...) call (line 259) so the booking row records the WorkTrace that produced it. The create-input type already declares workTraceId (line 29). |
| 1A-2 | modify | `/Users/jasonli/switchboard/packages/core/src/skill-runtime/tools/calendar-book.test.ts` | Part (a) test: assert booking.create is invoked with workTraceId equal to ctx.workUnitId; assert it is null when ctx.workUnitId is absent. |
| 1A-2 | modify | `/Users/jasonli/switchboard/packages/core/src/platform/work-trace.ts` | Part (b): add optional lineage fields contactId?: string and conversationThreadId?: string to the WorkTrace interface (index/lineage columns, not execution inputs). |
| 1A-2 | modify | `/Users/jasonli/switchboard/packages/core/src/platform/work-trace-hash.ts` | Part (b): add 'contactId' and 'conversationThreadId' to EXCLUDED_BASE (line 13-23) so they are omitted from the canonical hash input — content hash stays byte-identical with/without the columns. No hashInputVersion bump (precedent injectedPatternIds). |
| 1A-2 | modify | `/Users/jasonli/switchboard/packages/core/src/platform/__tests__/work-trace-hash.test.ts` | Part (b) tests: (1) changing top-level WorkTrace.contactId / conversationThreadId does NOT change the hash (mirror injectedPatternIds test at line 71-75); (2) a trace WITH the columns hashes identical to the same trace WITHOUT them; (3) changing parameters.contactId (trusted bag) DOES change the hash; (4) update V2 excluded-set length assertion from 5 to 7 (line 68) and add the two names to the arrayContaining check at line 57-66. |
| 1A-2 | modify | `/Users/jasonli/switchboard/packages/core/src/platform/canonical-request.ts` | Part (b): add optional contactId?: string and conversationThreadId?: string to CanonicalSubmitRequest so callers (gateway/api) can supply resolved lineage at submit. |
| 1A-2 | modify | `/Users/jasonli/switchboard/packages/core/src/platform/work-unit.ts` | Part (b): add contactId?: string and conversationThreadId?: string to WorkUnit; copy them from the request in normalizeWorkUnit. |
| 1A-2 | modify | `/Users/jasonli/switchboard/packages/core/src/platform/__tests__/work-unit.test.ts` | Part (b) test: normalizeWorkUnit carries contactId + conversationThreadId from the request onto the WorkUnit; both undefined when absent. |
| 1A-2 | modify | `/Users/jasonli/switchboard/packages/core/src/platform/work-trace-recorder.ts` | Part (b): map workUnit.contactId / workUnit.conversationThreadId onto the returned WorkTrace in both buildWorkTrace and buildClaimTrace. |
| 1A-2 | modify | `/Users/jasonli/switchboard/packages/core/src/platform/__tests__/work-trace-recorder.test.ts` | Part (b) test: buildWorkTrace and buildClaimTrace copy contactId + conversationThreadId from the WorkUnit onto the WorkTrace. |
| 1A-2 | modify | `/Users/jasonli/switchboard/packages/db/prisma/schema.prisma` | Part (b): add contactId String? and conversationThreadId String? to model WorkTrace (after injectedPatternIds, before Timestamps block, ~line 1958) plus @@index([organizationId, contactId]) and @@index([organizationId, conversationThreadId]) (in the index block ~line 1971-1975). |
| 1A-2 | create | `/Users/jasonli/switchboard/packages/db/prisma/migrations/20260606120000_worktrace_lineage_columns/migration.sql` | Part (b): hand-authored SQL ALTER TABLE "WorkTrace" ADD COLUMN "contactId" TEXT, ADD COLUMN "conversationThreadId" TEXT; CREATE INDEX for (organizationId, contactId) and (organizationId, conversationThreadId). Mirrors 20260604200000_recommendation_outcome_enrichment column-add format. Same commit as schema + EXCLUDED_BASE change. |
| 1A-2 | modify | `/Users/jasonli/switchboard/packages/db/src/stores/prisma-work-trace-store.ts` | Part (b): in buildWorkTraceCreateData (line 233-285) write contactId: trace.contactId ?? null and conversationThreadId: trace.conversationThreadId ?? null; in mapRowToTrace (line 418-485) read row.contactId ?? undefined and row.conversationThreadId ?? undefined. |
| 1A-2 | modify | `/Users/jasonli/switchboard/packages/db/src/stores/__tests__/prisma-work-trace-store.test.ts` | Part (b) test: persist() forwards contactId + conversationThreadId into workTrace.create data; a round-trip (persist data shape → mapRowToTrace) preserves both. If no such test file exists, create it mirroring prisma-workflow-store.test.ts mock-Prisma factory. |
| 1A-2 | modify | `/Users/jasonli/switchboard/packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts` | Part (c) VERIFY-ONLY: no edit needed if green; this file already asserts bookingId is extracted from metadata (line 44). Listed so the executor runs it as the (c) proof. |
| 1A-2 | modify | `/Users/jasonli/switchboard/packages/core/src/channel-gateway/types.ts` | Part (d): extend GatewayConversationStore.getOrCreateBySession (line 181-189) with an optional 4th param identity?: { organizationId: string; contactId: string | null } so the gateway can pass the resolver-provided lineage to the thread key. |
| 1A-2 | modify | `/Users/jasonli/switchboard/apps/chat/src/gateway/gateway-conversation-store.ts` | Part (d): accept the optional identity param; key the thread off identity.contactId / identity.organizationId when present, falling back to the literal contactId='visitor-'+sessionId and orgId='gateway' ONLY when no resolvable contact (identity absent or contactId null). |
| 1A-2 | modify | `/Users/jasonli/switchboard/packages/core/src/channel-gateway/channel-gateway.ts` | Part (d): hoist the resolveContactIdentity call (currently at line 216-224, step 4c) to BEFORE the main getOrCreateBySession call (line 190-194, step 3); pass { organizationId: resolved.organizationId, contactId: identity.contactId } into getOrCreateBySession. The inactive-deployment call (line 154-158) passes no identity (legitimate fallback — no org/contact resolved there). |
| 1A-2 | modify | `/Users/jasonli/switchboard/apps/chat/src/gateway/__tests__/gateway-conversation-store.test.ts` | Part (d) test: getOrCreateBySession keys the thread off identity.contactId/organizationId when provided, and falls back to visitor-/gateway literals when identity is absent or contactId is null. Create the test file if it does not yet exist, mirroring the apps/chat mock-Prisma pattern. |
| 1A-3 | create | `packages/schemas/src/receipt.ts` | L1 Zod source of truth: ReceiptKindSchema (calendar|payment), ReceiptTierSchema (T1_FETCH_BACK|T2_PROVIDER_SIGNATURE|T3_ADMIN_AUDIT), ReceiptStatusSchema (booked|held|paid|void), ReceiptEvidenceSchema (z.discriminatedUnion('kind', [calendar evidence, payment evidence]) — no any), ReceiptSchema (id, organizationId, kind, tier, status, bookingId?, opportunityId?, revenueEventId?, connectionId?, provider?, externalRef?, amount?, currency?, evidence, capturedBy, verifiedAt?, workTraceId?, createdAt) and inferred types; PaidVisitVerdict type {paid:boolean, held:boolean, tier:ReceiptTier, basis:string, degraded:boolean}; RECEIPT_TIER_RANK map + clampTierForUntrustedProvider() pure helper enforcing 'never above T3' (used by both the mint helper and its prod-assert test). |
| 1A-3 | create | `packages/schemas/src/receipt.test.ts` | Co-located schema tests: ReceiptSchema accepts a valid calendar receipt (status booked) and a valid payment receipt (status paid); evidence discriminated union rejects a calendar receipt carrying payment-shaped evidence (and vice-versa); status enum rejects 'partial'; clampTierForUntrustedProvider clamps T1/T2→T3 and leaves T3 as T3. |
| 1A-3 | modify | `packages/schemas/src/index.ts` | Append `export * from "./receipt.js";` after the calendar export (index.ts:127) so Receipt types are reachable from @switchboard/schemas. |
| 1A-3 | create | `packages/core/src/receipts/is-paid-visit.ts` | L3 pure predicate isPaidVisit(receipt): PaidVisitVerdict — STRUCTURED verdict, never a bare boolean. calendar+status='booked' → {paid:false, held:false, basis:'calendar_confirmed', tier, degraded:false}; calendar+status='held' → {paid:false, held:true, basis:'calendar_confirmed'}; payment+status='paid'+provider!=='noop'+tier===T1 → {paid:true, held:false, basis:'payment_verified', degraded:false}; payment+provider==='noop' → {paid:false, degraded:true, basis:'payment_degraded'} (NOT production-countable); status='void' → {paid:false, held:false, basis:'void'}. Plus isProductionCountable(verdict, env) helper that excludes degraded verdicts when env is production (R1). |
| 1A-3 | create | `packages/core/src/receipts/is-paid-visit.test.ts` | Co-located verdict MATRIX: calendar-booked→not paid/not held; calendar-held→held not paid; payment-T1-live→paid; noop-payment→degraded & not production-countable; void→neither; asserts the return is the structured object (never boolean). |
| 1A-3 | create | `packages/core/src/receipts/receipt-store.ts` | L3 ReceiptStore interface (structural-match pattern; mirrors lifecycle/revenue-store.ts): MintReceiptInput type, ReceiptStore.mint(input, tx?: StoreTransactionContext): Promise<Receipt>, findByBooking(orgId, bookingId): Promise<Receipt[]>. Re-uses StoreTransactionContext=unknown from lifecycle (re-declared locally to keep core internal deps minimal, matching revenue-store.ts). |
| 1A-3 | create | `packages/core/src/receipts/mint-calendar-receipt.ts` | L3 co-located helper buildCalendarReceiptData({bookingId, organizationId, opportunityId, workTraceId, externalRef, provider, isProduction, requestedTier}): returns the receipt-create payload with status='booked', kind='calendar', basis evidence calendar_confirmed, tier = clampTierForUntrustedProvider applied when the provider is untrusted (Noop/Local) so production can never store above T3. Pure data-builder so it is unit-testable WITHOUT a DB and is the prod-assert seam. |
| 1A-3 | create | `packages/core/src/receipts/mint-calendar-receipt.test.ts` | Co-located: builds a booked CalendarReceipt (status==='booked' NOT 'held'); PROD-ASSERT (R1): isProduction=true + untrusted provider + requestedTier T1 → result tier === 'T3_ADMIN_AUDIT'; trusted provider + real re-fetch keeps requested tier. |
| 1A-3 | create | `packages/core/src/receipts/index.ts` | Barrel re-exporting is-paid-visit, receipt-store iface, mint-calendar-receipt from the new receipts subdir. |
| 1A-3 | modify | `packages/core/src/index.ts` | Add `export * from "./receipts/index.js";` so isPaidVisit, ReceiptStore, and the mint helper are reachable from @switchboard/core. |
| 1A-3 | modify | `packages/core/src/skill-runtime/tools/calendar-book.ts` | Extend the TransactionFn tx type (calendar-book.ts:70-83) with a `receipt: { create(args:{data:Record<string,unknown>}):Promise<unknown> }` member; add receiptStore-less mint INSIDE the existing confirm tx (calendar-book.ts:343-394) by calling buildCalendarReceiptData(...) and tx.receipt.create({data}); add to CalendarBookToolDeps the injected `receiptTierForProvider:(p:CalendarProvider)=>ReceiptTier` resolver and `isProduction:boolean` so core never reads process.env. Keep the file under 400 lines by delegating payload construction to mint-calendar-receipt.ts (no inline logic). |
| 1A-3 | modify | `packages/core/src/skill-runtime/tools/calendar-book.test.ts` | Add a spy assertion that the confirm tx calls tx.receipt.create with status:'booked' and the clamped tier; extend the existing mock tx + deps (mirroring the file's current factory) with receipt.create, receiptTierForProvider, isProduction. |
| 1A-3 | create | `packages/db/src/stores/prisma-receipt-store.ts` | L4 PrismaReceiptStore (mirrors prisma-revenue-store.ts:57): mint(input, tx?) → client.receipt.create with a generated id; findByBooking(orgId, bookingId) org-scoped; a mapRowToReceipt mapper (mirrors :268). Class duplicates the ReceiptStore iface locally with the 'structural match with @switchboard/core' comment (precedent prisma-revenue-store.ts:6). |
| 1A-3 | create | `packages/db/src/stores/__tests__/prisma-receipt-store.test.ts` | L4 MOCKED-Prisma tests (CI has no Postgres; mirrors prisma-revenue-store.test.ts + prisma-workflow-store.test.ts): mint uses tx client when tx passed / this.prisma otherwise; findByBooking scopes where to {organizationId, bookingId}; mapper round-trips status='booked'. |
| 1A-3 | modify | `packages/db/src/index.ts` | Add `export { PrismaReceiptStore } from "./stores/prisma-receipt-store.js";` after the PrismaRevenueStore export (index.ts:73). |
| 1A-3 | modify | `packages/db/prisma/schema.prisma` | Add the Receipt model (after ConversionRecord, ~schema.prisma:2054) with fields per §7, @@index([organizationId, bookingId]) and @@index([organizationId, kind, status]); add a sync comment that the partial-unique (organizationId, kind, externalRef) WHERE externalRef IS NOT NULL lives in raw SQL (Prisma 6 limitation, mirroring Booking model comment :2004-2006). |
| 1A-3 | create | `packages/db/prisma/migrations/20260606120000_add_receipt/migration.sql` | Same-commit migration: CREATE TABLE "Receipt" (mirroring 20260602093000 style) + CREATE INDEX for the two composite indexes + raw-SQL CREATE UNIQUE INDEX ... WHERE "externalRef" IS NOT NULL (mirroring 20260603120000_booking_partial_unique_active). |
| 1A-4a | create | `packages/schemas/src/payment.ts` | L1 PaymentPort interface (createDepositLink, retrievePayment only) + Zod schemas/types: DepositLinkInputSchema/DepositLinkInput, DepositLinkSchema/DepositLink, PaymentStatusSchema, VerifiedPaymentSchema/VerifiedPayment (carries provider, amountCents, currency, status). Mirrors calendar.ts. No @switchboard/* imports. |
| 1A-4a | create | `packages/schemas/src/payment.test.ts` | Co-located Zod unit tests: VerifiedPaymentSchema validates a provider='noop' degraded payment; rejects negative amountCents; DepositLinkSchema requires url+externalReference+amountCents; status enum = booked|held|paid|void rejected vs payment status pending|paid|failed|refunded. |
| 1A-4a | modify | `packages/schemas/src/index.ts` | Add barrel re-export `export * from "./payment.js";` mirroring the existing `export * from "./calendar.js";`. |
| 1A-4a | modify | `packages/schemas/package.json` | Add the `"./payment"` subpath export block (types+import to ./dist/payment.*) mirroring the existing `"./calendar"` block. |
| 1A-4a | create | `apps/api/src/bootstrap/noop-payment-adapter.ts` | NoopPaymentAdapter implements PaymentPort: createDepositLink fabricates deterministic externalReference `noop_pay_${input.bookingId}` + a deterministic url; retrievePayment returns VerifiedPayment{provider:'noop', status:'paid', amountCents, currency} (R1 DEGRADED) or null. Exports isNoopPaymentAdapter guard. Mirrors noop-calendar-provider.ts. |
| 1A-4a | create | `apps/api/src/bootstrap/noop-payment-adapter.test.ts` | Co-located tests: createDepositLink is DETERMINISTIC per bookingId (same ref twice); externalReference === `noop_pay_<bookingId>`; retrievePayment returns provider='noop'; isNoopPaymentAdapter true for instance, false for a plain object. |
| 1A-4a | create | `apps/api/src/bootstrap/payment-port-factory.ts` | Per-org payment-port factory: createPaymentPortFactory(deps) -> (orgId)=>Promise<PaymentPort> with the same memoization+reject-eviction+ORG_ID_REQUIRED shape as calendar-provider-factory.ts; returns NoopPaymentAdapter when no Stripe env present (Stripe adapter is PR 1A-4b). |
| 1A-4a | create | `apps/api/src/bootstrap/__tests__/payment-port-factory.test.ts` | Tests mirror calendar-provider-factory.test.ts: rejects ORG_ID_REQUIRED on empty/whitespace orgId; returns NoopPaymentAdapter when no env; memoizes per orgId (same Promise); independent per orgId; rejected construction cleared from cache. |
| 1A-4a | create | `packages/core/src/skill-runtime/tools/deposit-link.ts` | L3 factory-with-context deposit-link tool (createDepositLinkToolFactory). effectCategory:'read', idempotent:true (idempotent external read, no new approval). Sources orgId from ctx, bookingId from params; injected findById(orgId,bookingId) + injected PaymentPort; fails MISSING_BOOKING / BOOKING_NOT_CONFIRMED; returns ok({url, externalReference, amountCents}). Co-located so calendar-book.ts is untouched. |
| 1A-4a | create | `packages/core/src/skill-runtime/tools/deposit-link.test.ts` | Co-located tool tests: factory id; happy path returns ok with deterministic externalReference; MISSING_BOOKING when findById returns null; BOOKING_NOT_CONFIRMED when status!=='confirmed'; orgId comes from ctx not params (passes a malicious params.orgId, asserts findById called with ctx.orgId); idempotent (two calls -> same externalReference). |
| 1A-4a | modify | `packages/core/src/skill-runtime/tools/index.ts` | Re-export the new tool: `export { createDepositLinkToolFactory } from "./deposit-link.js";` + `export type { DepositLinkToolFactory } from "./deposit-link.js";` mirroring the calendar-book/escalate lines. |
| 1A-4b | modify | `packages/schemas/src/lifecycle.ts` | Add `bookingId: z.string().nullable().optional()` to LifecycleRevenueEventSchema (after the externalReference line at lifecycle.ts:176) so the typed LifecycleRevenueEvent carries the booking weld. |
| 1A-4b | modify | `packages/core/src/lifecycle/revenue-store.ts` | Add `bookingId?: string | null` to the RecordRevenueInput interface (after externalReference at revenue-store.ts:22) — the structural store contract core exposes. |
| 1A-4b | modify | `packages/db/prisma/schema.prisma` | Add `bookingId String?` to model LifecycleRevenueEvent (after externalReference at schema.prisma:1841), add `@@index([organizationId, bookingId])`, and a sync comment pointing at the raw-SQL partial-unique migration. |
| 1A-4b | create | `packages/db/prisma/migrations/20260606130000_lre_booking_and_external_ref_unique/migration.sql` | Same-commit migration: ADD COLUMN bookingId, CREATE INDEX on (organizationId, bookingId), and RAW-SQL CREATE UNIQUE INDEX on (organizationId, externalReference) WHERE externalReference IS NOT NULL (mirrors 20260603120000_booking_partial_unique_active). |
| 1A-4b | modify | `packages/db/src/stores/prisma-revenue-store.ts` | Forward + map bookingId: add `bookingId?: string | null` to the local RecordRevenueInput (line 22), add `bookingId: input.bookingId ?? null` to the create data block (line 87), and add `bookingId` to the mapRowToRevenueEvent param type + returned object (lines 278/295). |
| 1A-4b | modify | `packages/db/src/stores/__tests__/prisma-revenue-store.test.ts` | Add a failing-first test that bookingId is forwarded into prisma.lifecycleRevenueEvent.create and round-trips through the mapper; add `bookingId: null` to the makeRevenueEvent default row so the mapper has the field to read. |
| 1A-4b | create | `apps/api/src/payments/resolve-payment-tier.ts` | Pure, db-free `resolvePaymentReceiptTier(provider)` -> {tier, verified, degraded}: provider==='noop' -> {T3_ADMIN_AUDIT, verified:false, degraded:true}; any real PSP provider -> {T1_FETCH_BACK, verified:true, degraded:false}. The R1 honest-degradation gate, independently unit-testable. |
| 1A-4b | create | `apps/api/src/payments/resolve-payment-tier.test.ts` | Co-located unit matrix: noop -> T3 + verified:false + degraded:true; stripe -> T1 + verified:true + degraded:false; asserts a noop payment can never resolve to T1 (R1). |
| 1A-4b | create | `apps/api/src/routes/operator-intents-schemas-payment.ts` | Zod RecordVerifiedPaymentParametersSchema (org-free; contactId, opportunityId, bookingId, amountCents int positive, currency len3 default SGD, externalReference required (replay key), provider default 'noop', connectionId optional, sourceCampaignId/sourceAdId nullable). Separate file so operator-intents-schemas.ts stays small. |
| 1A-4b | create | `apps/api/src/bootstrap/operator-intents/record-verified-payment.ts` | buildRecordVerifiedPaymentHandler(receiptWriter, revenueStore, outboxWriter, runInTransaction): OperatorMutationHandler + the ReceiptWriter seam (forwards a full CreateReceiptInput to 1A-3's ReceiptStore) + RECORD_VERIFIED_PAYMENT_INTENT const. Writes payment Receipt + LifecycleRevenueEvent(bookingId) + purchased outbox in one tx; tier/verified derived via resolvePaymentReceiptTier (R1). Mirrors revenue.ts. |
| 1A-4b | create | `apps/api/src/bootstrap/operator-intents/record-verified-payment.test.ts` | Handler unit tests: one-tx (same tx arg to all three writes) with parsed amountCents; replay re-issues the same outbox eventId; a provider='noop' payment writes T3 + verified=false (never T1) and an org-scoping assertion that organizationId flows from the WorkUnit into all writes. |
| 1A-4b | modify | `apps/api/src/bootstrap/operator-intents.ts` | Register the new intent: import/re-export buildRecordVerifiedPaymentHandler + RECORD_VERIFIED_PAYMENT_INTENT + ReceiptWriter; add receiptWriter? to OperatorIntentsBootstrapDeps; when receiptWriter+revenueStore+outboxWriter+runInTransaction present, handlers.set(...) + registerOperatorIntent(...) (system_auto_approved); bump the intentCount tally. |
| 1A-4b | modify | `apps/api/src/app.ts` | Bootstrap binding: pass a `receiptWriter` into the existing bootstrapOperatorIntents({...}) call (app.ts:764-778) that forwards a CreateReceiptInput to `new PrismaReceiptStore(prismaClient).record(input, tx as never)` (PrismaReceiptStore is 1A-3's export). This is the only seam touching 1A-3's Receipt model. |
| 1A-4b | create | `apps/api/src/bootstrap/operator-intents/__tests__/record-verified-payment.integration.test.ts` | Postgres-gated (describe.skipIf(!DATABASE_URL)) replay-proof proof: drive the handler twice with the SAME externalReference against a real $transaction + PrismaRevenueStore + PrismaReceiptStore + PrismaOutboxStore; assert exactly one LifecycleRevenueEvent row, one Receipt row, one outbox row (the partial-unique no-op the unit test cannot prove). |
| 1A-4c | create | `apps/api/src/routes/payments-webhook.ts` | New ingress-receiver Fastify plugin. Header `// @route-class: ingress-receiver`. Exports verifyPaymentWebhookSignature (HMAC-SHA256 over rawBody, fail-closed) and paymentsWebhookRoutes. POST /payments/webhook: rawBody:true; verify signature with STRIPE_WEBHOOK_SECRET -> 401 on failure; parse providerMessageId + connectedAccountId from body AFTER verify; resolve org via Connection(serviceId:'stripe', externalAccountId) -> 200 skip if unresolvable; obtain per-org PaymentPort via app.paymentPortFactory(orgId) -> retrievePayment(chargeId) re-fetch -> 503 if factory absent; submit payment.record_verified via app.platformIngress with idempotencyKey=`psp-${providerMessageId}` and parameters carrying the RE-FETCHED amountCents/currency/provider (never the body amount). |
| 1A-4c | create | `apps/api/src/routes/__tests__/payments-webhook.test.ts` | Co-located tests. Standalone Fastify (mirror ad-optimizer-signature.test.ts): rejects missing/forged HMAC over rawBody (401); fails closed with no STRIPE_WEBHOOK_SECRET (401); refuses unresolvable org (no platformIngress.submit call, 200 skip); asserts retrievePayment is called with the charge id and the submitted parameters.amountCents equals the RE-FETCHED amount NOT the (different) body amount; replay (same provider message id) routes through ingress with the same idempotencyKey and the fake ingress dedups to one effective record. |
| 1A-4c | create | `apps/api/src/types/payments-fastify.d.ts` | Module augmentation: declare module "fastify" { interface FastifyInstance { paymentPortFactory?: (orgId: string) => Promise<import("@switchboard/schemas").PaymentPort>; } }. Mirrors types/recommendations-fastify.d.ts. The actual app.decorate("paymentPortFactory", ...) is wired by 1A-4a; this file only types the seam so the route compiles. |
| 1A-4c | modify | `apps/api/src/bootstrap/routes.ts` | Import paymentsWebhookRoutes and register it with prefix "/api/webhooks" (a prefix already public in billing-guard) so the live path is /api/webhooks/payments/webhook. Placed beside the existing webhooksRoutes registration (routes.ts:215). |
| 1A-4c | modify | `apps/api/src/middleware/auth.ts` | Add the payments webhook to the preHandler auth-bypass list (auth.ts:121-138): a PSP sends no Authorization header, so `request.url === "/api/webhooks/payments/webhook"` must short-circuit before the Bearer check, exactly like "/api/billing/webhook" at line 129. Exact path, never a prefix. |
| 1A-4c | modify | `apps/api/src/middleware/billing-guard.ts` | No code change required — "/api/webhooks" is already a PUBLIC_PREFIX (billing-guard.ts:27), so the new /api/webhooks/payments/webhook POST already bypasses the entitlement gate. Listed here only to document the verified dependency; do not edit unless the registration prefix changes. |
| 1A-4c | modify | `.agent/tools/route-allowlist.yaml` | Add an entry for apps/api/src/routes/payments-webhook.ts with a one-line reason: it IS a PlatformIngress entry point (calls app.platformIngress.submit) but the 2-hop import scan misses the dynamic resolution through @switchboard/core/platform — identical justification to the ad-optimizer.ts entry at line 141. |
| 1A-4d | create | `apps/api/src/payments/stripe-connect-payment-adapter.ts` | StripeConnectPaymentAdapter class implementing PaymentPort (only createDepositLink + retrievePayment) + exported StripeConnectClient narrow type (exactly checkout.sessions.create / paymentIntents.retrieve / webhooks.constructEvent, no any) + exported module-level mapPaymentIntentStatus + exported standalone verifyConnectWebhookSignature seam. createDepositLink = a Connect destination-charge Checkout Session with stripeAccount option + deterministic idempotencyKey deposit_${bookingId}. retrievePayment = paymentIntents.retrieve returning the Stripe-side amount/currency/status (never a body amount), null on resource_missing. |
| 1A-4d | create | `apps/api/src/payments/stripe-connect-payment-adapter.test.ts` | Co-located unit tests with an injected fake Stripe client (vi.fn, no network): createDepositLink builds a destination charge on the connected account and returns url + payment_intent id as externalReference; re-issue reuses the identical idempotencyKey deposit_${bookingId}; retrievePayment returns the AUTHORITATIVE Stripe amount/currency (not a body amount) + status mapping matrix (succeeded->verified, processing/requires_*->pending, canceled->failed) + null on resource_missing; verifyConnectWebhookSignature returns the constructed event on a good signature and rethrows on a tampered one using the per-org Connect secret. |
| 1A-4d | create | `apps/api/src/payments/stripe-connect-credentials.ts` | Pure fail-closed parser parseStripeConnectCredentials(decrypted: Record<string, unknown>) -> { connectedAccountId, secretKey, webhookSecret } | null. Returns null unless ALL three are non-empty strings, so the factory can never build a live-money adapter from partial creds. No deps. |
| 1A-4d | create | `apps/api/src/payments/stripe-connect-credentials.test.ts` | Co-located unit tests for the credential parser: full creds parse (extra keys ignored); each missing / blank / non-string field yields null; empty object yields null. |
| 1A-4d | modify | `apps/api/src/bootstrap/payment-port-factory.ts` | Extend the 1A-4a per-org factory: add optional injectable decryptCredentials + stripeClientFactory deps (defaulting to @switchboard/db decryptCredentials and a real new Stripe(secretKey,{apiVersion}) constructor); query the org's connected stripe Connection (findFirst where organizationId + serviceId:'stripe' + status:'connected'), decrypt + parse fail-closed, and on full creds return a StripeConnectPaymentAdapter built from the PER-ORG secret; otherwise keep the existing Noop return. Preserve the per-org cache + ORG_ID_REQUIRED scaffolding untouched. |
| 1A-4d | modify | `apps/api/src/bootstrap/__tests__/payment-port-factory.test.ts` | Add a 'Stripe Connect selection' describe block (keeping the 1A-4a Noop tests intact): factory returns a StripeConnectPaymentAdapter (not Noop) for a connected stripe Connection with full creds; returns Noop when no stripe Connection; returns Noop when creds are partial (fail-closed); the Connection query filters by organizationId for cross-org isolation; the injected stripeClientFactory is called with the per-org secretKey. |
| 1A-5 | modify | `packages/db/prisma/schema.prisma` | Add `origin String @default("live")` to model Booking (after workTraceId, line ~1998), model ConversionRecord (after bookingId, line ~2045), and model LifecycleRevenueEvent (after sourceAdId, line ~1844). Columns only; the backfill of existing rows lives in the raw-SQL migration in the same commit. |
| 1A-5 | create | `packages/db/prisma/migrations/20260606090000_revenue_origin_marker/migration.sql` | Raw-SQL migration (same commit as schema.prisma): ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'live' to Booking, ConversionRecord, LifecycleRevenueEvent, then UPDATE each table SET origin='live' WHERE origin IS NULL to backfill pre-existing rows explicitly (defense-in-depth; the DEFAULT already covers new+existing on Postgres, the UPDATE documents intent and is a no-op if empty). Mirrors the ADD COLUMN format of 20260604200000_recommendation_outcome_enrichment. |
| 1A-5 | modify | `packages/db/src/stores/prisma-conversion-record-store.ts` | (a) Add optional `origin?: "live"|"seed"|"demo"` to RecordInput (line ~31) and write `origin: event.origin ?? "live"` in the create branch of record() (line ~55) so live writers are stamped without threading origin through every caller. (b) Add `origin: "live"` to the WHERE of queryBookedValueCentsByCampaign (line ~232) and queryBookedStatsByCampaign (line ~269) so seed/demo booked rows are excluded from the trustworthy metric. |
| 1A-5 | modify | `packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts` | Add tests: record() defaults origin to 'live' when omitted and passes through an explicit 'seed'; queryBookedValueCentsByCampaign and queryBookedStatsByCampaign include `origin:"live"` in the groupBy WHERE (fixture-leakage exclusion). Extend the existing makePrisma mock unchanged (groupBy/upsert already present). |
| 1A-5 | create | `packages/db/src/seed/__tests__/seed-origin-stamp.guard.test.ts` | Grep-guard (R4): statically scan every seed file under packages/db/prisma/seed*.ts and packages/db/src/seed/*.ts; for each that contains a `.booking.`/`.conversionRecord.`/`.lifecycleRevenueEvent.` create/upsert/createMany call, assert the same file also contains an `origin:` literal. Today no seed creates these models so the guard passes vacuously; it red-flags the first future seed factory that forgets origin. |
| 1A-5 | modify | `packages/core/src/skill-runtime/tools/calendar-book.ts` | Replace `const eventId = randomUUID();` (line 342) with `const eventId = \`evt_booked_${booking.id}\`;` and drop the now-unused `randomUUID` import (line 1). Change the booked outbox payload `occurredAt` (line 367) from `new Date().toISOString()` to `new Date(input.slotStart).toISOString()` so the conversion record windows on the external booking start, not the in-app write clock. |
| 1A-5 | modify | `packages/core/src/skill-runtime/tools/calendar-book.test.ts` | Add to the existing 'booking.create conversion stamping' describe (uses buildToolWithCapture which already captures the outbox payload): assert the booked outbox eventId is deterministic (`evt_booked_bk_1`, not random) by capturing args.data.eventId, and assert payload.occurredAt equals the external input.slotStart (clock-game: not the wall clock). File already has /* eslint-disable max-lines */ and is excluded from arch-check (test file). |
| 1A-5 | modify | `apps/api/src/routes/operator-intents-schemas.ts` | Narrow RecordRevenueParametersSchema.recordedBy (line 89) from z.enum(["owner","staff","stripe","integration"]) to z.enum(["owner","staff"]).default("owner") so an operator can never self-assert a stripe/integration (verified-looking) source. The wide schemas-package RecordedBySchema and store unions are untouched (PSP path needs stripe). |
| 1A-5 | modify | `apps/api/src/bootstrap/operator-intents/revenue.ts` | Pass `verified: false` explicitly to revenueStore.record (in the input object around line 39-50) so only the PSP fetch-back path (later PR) can set verified=true; an accidental future edit can't silently flip operator-recorded revenue to verified. Also stamp the outbox `occurredAt` honestly (leave as write-time — operator path has no external charge time; verified:false already excludes it from the trustworthy count). |
| 1A-5 | modify | `apps/api/src/bootstrap/operator-intents/__tests__/revenue.test.ts` | Add a test asserting revenueStore.record is called with `verified: false` (objectContaining) for an owner-recorded payment; and a schema test asserting RecordRevenueParametersSchema rejects recordedBy:'stripe' / 'integration' (safeParse success=false) while accepting owner/staff. |
| 1A-5 | modify | `packages/db/src/stores/prisma-revenue-store.ts` | Add `origin: "live"` to the WHERE of sumByCampaign (line ~150) so seed/demo LifecycleRevenueEvent rows are excluded from the owner-facing by-campaign read surface. (sumByOrg and revenueWithFirstTouch left for their own slice; the prove-leg read surface is by-campaign.) |
| 1A-5 | modify | `packages/db/src/stores/__tests__/prisma-revenue-store.test.ts` | Add a test asserting sumByCampaign's groupBy WHERE includes `origin:"live"` (mock groupBy, inspect mock.calls[0][0].where.origin). Mirror the existing makePrisma mock in this file (add lifecycleRevenueEvent.groupBy if not already mocked). |
| 1A-5 | modify | `packages/core/src/channel-gateway/types.ts` | Add optional `providerMessageId?: string` to IncomingChannelMessage (after `text`, line ~205) with a doc comment: stable provider message id (WhatsApp wamid, Telegram message_id). When present, the gateway derives the ingress idempotencyKey from it so a redelivered webhook dedups at PlatformIngress.submit. |
| 1A-5 | modify | `packages/core/src/channel-gateway/channel-gateway.ts` | In handleIncoming's CanonicalSubmitRequest build (lines 311-332), set `idempotencyKey` from the provider message id when present: `...(message.providerMessageId ? { idempotencyKey: \`${resolved.organizationId}:${message.channel}:${message.providerMessageId}\` } : {})`. The org+channel prefix keeps the key org-scoped (PlatformIngress.getByIdempotencyKey is org-scoped at line 120-123). No other behavior changes. |
| 1A-5 | modify | `packages/core/src/channel-gateway/__tests__/channel-gateway.test.ts` | Add tests: (a) when message.providerMessageId is set, platformIngress.submit receives a request whose idempotencyKey is `org-1:web_widget:<wamid>`; (b) two handleIncoming calls with the SAME providerMessageId both pass the SAME idempotencyKey to submit (gateway-level same-wamid dedup proof — submit's trace-store dedup is unit-tested in platform-ingress); (c) when providerMessageId is absent, the submitted request has no idempotencyKey (backward compat). Reuse createMockConfig (submit is already a spy). |
| 1A-5 | modify | `apps/chat/src/routes/managed-webhook.ts` | Thread the wamid into the gateway: pass `providerMessageId: rawMessageId ?? undefined` into the handleIncoming message object (the message object built at lines 173-181; rawMessageId is already extracted at line 158 via gatewayEntry.adapter.extractMessageId). This wires the real producer so the idempotency key is populated in production. |
| 1A-6 | modify | `/Users/jasonli/switchboard/packages/schemas/src/reports/v1.ts` | Add the L1 shared types: `AttributionBasis` union (ctwa_captured | campaign_missing | copied_from_contact) and the `PaidVisitRow` interface (bookingId, amountMajor:number, currency, campaignId:string|null, campaignName:string|null, attributionBasis, paidAt:string). Auto-exported via the existing barrel re-export. |
| 1A-6 | modify | `/Users/jasonli/switchboard/packages/db/src/stores/prisma-revenue-store.ts` | Add `paidVisitsByCampaign({orgId, from, to, isProduction})` returning one row per verified PAID LifecycleRevenueEvent in CENTS (amountCents:number), joined to ConversionRecord via bookingId for sourceCampaignId + derived attributionBasis; excludes provider='noop'/non-T1 receipts and requires origin='live' when isProduction. Returns raw cents — performs NO cents→major division. |
| 1A-6 | modify | `/Users/jasonli/switchboard/packages/db/src/stores/__tests__/prisma-revenue-store.test.ts` | Add a `paidVisitsByCampaign` describe block (mocked Prisma): one row per paid visit, verified=true only, Noop/origin!=live excluded in production but kept when not production, org-isolated WHERE on both findMany calls, honest attributionBasis (ctwa_captured vs campaign_missing), and that the store returns raw cents (no division). |
| 1A-6 | modify | `/Users/jasonli/switchboard/apps/api/src/routes/revenue.ts` | Extend GET /:orgId/revenue/by-campaign: when `?detail=paid-visits`, call store.paidVisitsByCampaign(...) and return `{ paidVisits: PaidVisitRow[] }`, converting amountCents→amountMajor (÷100) EXACTLY ONCE in the mapper; default (no detail) behavior unchanged. Passes isProduction = process.env.NODE_ENV === 'production'. |
| 1A-6 | modify | `/Users/jasonli/switchboard/apps/api/src/routes/__tests__/revenue.test.ts` | Add the cents→major unit-boundary mapper test (50000 cents → amountMajor 500, asserting the exact ÷100 conversion done once and never 100x) plus an attributionBasis pass-through assertion for the route's row mapper. |
| 1A-6 | create | `/Users/jasonli/switchboard/apps/dashboard/src/lib/api-client/dashboard.ts.paid-visits-method` | (Logical change inside dashboard.ts) Add `getPaidVisitsByCampaign(orgId, params:{from:string; to:string}): Promise<{paidVisits: PaidVisitRow[]}>` calling `this.request('/api/${orgId}/revenue/by-campaign?detail=paid-visits&from=..&to=..')`. NOTE: this is a modify of api-client/dashboard.ts, not a new file. |
| 1A-6 | create | `/Users/jasonli/switchboard/apps/dashboard/src/app/api/dashboard/revenue/paid-visits/route.ts` | Dashboard→API proxy GET: requireSession → getApiClient → client.getPaidVisitsByCampaign(session.organizationId, {from,to from searchParams}) → NextResponse.json; proxyError(401 on Unauthorized else 500). Read-only. |
| 1A-6 | create | `/Users/jasonli/switchboard/apps/dashboard/src/app/api/dashboard/revenue/paid-visits/__tests__/route.test.ts` | Proxy test (vi.mock session + getApiClient): 401 when unauthenticated, 200 happy path forwarding rows, and that orgId comes from session not the query string. |
| 1A-6 | create | `/Users/jasonli/switchboard/apps/dashboard/src/components/results/paid-visits-section.tsx` | Read-only panel: renders each PaidVisitRow as 'Paid S$X visit linked to campaign Y via CTWA attribution' (fmtSGD withCents:always) for ctwa_captured, and 'Paid S$X visit — campaign not captured' for campaign_missing; calm empty-state; NEVER 'proven came from', NEVER blank-as-attributed. |
| 1A-6 | create | `/Users/jasonli/switchboard/apps/dashboard/src/components/results/paid-visits-section.test.tsx` | Component test: one line per paid visit, honest copy ('linked to campaign … via CTWA attribution', never 'proven'), campaign_missing renders the honest fallback (not blank/0), money shows S$ + cents (no bare $), empty-state renders. |

---
## 1A-0 — fix(core): register {slug}.respond so managed inbound reaches the skill executor (live-path preflight)

**Goal:** Phase 0 preflight for "close the revenue loop": prove the managed inbound chain (WhatsApp/web → ChannelGateway → PlatformIngress → skill executor) and the CTWA chain (ctwa-adapter → lead.intake → PlatformIngress) actually resolve before any prove-leg code is built. A defect is confirmed in main: ChannelGateway submits `${resolved.skillSlug}.respond` (packages/core/src/channel-gateway/channel-gateway.ts:313, e.g. `alex.respond`), but the LIVE registrar exported from `@switchboard/core/platform` (packages/core/src/platform/skill-intent-registrar.ts, re-exported at platform/index.ts:124, called at apps/api/src/bootstrap/skill-mode.ts:149 with the array `[alexSkill, miraSkill]`) registers `skill.intent` = `alex.run` (from skills/alex/SKILL.md:4, parsed at skill-loader.ts:37,259), never `alex.respond`. PlatformIngress.submit looks the intent up at platform-ingress.ts:163 and returns `intent_not_found` for an unregistered intent, so every managed inbound message would die before the executor. A second registrar (packages/core/src/platform/register-skill-intents.ts) DOES register `${slug}.respond` but has NO live caller (its only importer is its own .test.ts). Mira's `skill.intent` = `creative.brief.compose` HAS live callers (apps/api/src/services/workflows/mira-self-brief-request.ts:46), so the existing `skill.intent` registration is load-bearing and must be preserved. FIX (minimal): make the live `skill-intent-registrar.registerSkillIntents` ALSO register `${slug}.respond` (in addition to, never instead of, the declared `skill.intent`), so the gateway's submission resolves. Then pin three regression/smoke tests so the seam can never silently break again. No schema change. The CTWA → lead.intake path is already correctly registered (apps/api/src/bootstrap/contained-workflows.ts:401, allowedTriggers ["internal","api"]) and is pinned, not fixed.

**File structure:**

| Action | Path | Responsibility |
|---|---|---|
| modify | `/Users/jasonli/switchboard/packages/core/src/platform/skill-intent-registrar.ts` | Live skill-intent registrar (barrel-exported, called at skill-mode.ts:149). FIX: in addition to registering each skill's declared `skill.intent` (unchanged — load-bearing for mira's creative.brief.compose cron), ALSO register `${skill.slug}.respond` when it differs from skill.intent, so ChannelGateway's `${skillSlug}.respond` submission (channel-gateway.ts:313) resolves at PlatformIngress lookup instead of returning intent_not_found. Both registrations share the same derived mutationClass/budgetClass and allow the gateway's `chat` trigger. |
| create | `/Users/jasonli/switchboard/packages/core/src/platform/skill-intent-registrar.respond.test.ts` | Regression test encoding the gateway↔registrar contract: feeding a SkillDefinition with intent `alex.run` and slug `alex` to the LIVE registrar must register BOTH `alex.run` (preserved) AND `alex.respond` (the exact intent + `chat` trigger the gateway submits), with the .respond executor bound to the slug. Also asserts a 3-part intent (mira: slug `creative`, intent `creative.brief.compose`) preserves the declared intent and adds `creative.respond` with no duplicate-registration throw. |
| create | `/Users/jasonli/switchboard/packages/core/src/platform/__tests__/managed-inbound-intent-smoke.test.ts` | CI-safe managed-inbound smoke over the REAL skills/alex/SKILL.md (loadSkill) through the REAL registrar into a REAL IntentRegistry, asserting the EXACT lookup + trigger validation PlatformIngress.submit performs for the gateway's submission: lookup('alex.respond') is defined (not intent_not_found) and validateTrigger('alex.respond','chat') is true. Pins that an inbound managed message reaches a registered skill intent without booting Anthropic/Postgres. |
| create | `/Users/jasonli/switchboard/packages/core/src/intents/__tests__/lead-intake-intent-registration.smoke.test.ts` | Regression pin for the CTWA path (part d): asserts the `lead.intake` intent the ctwa-adapter emits is registered as a workflow intent with the triggers the adapter-originated submit uses, so ctwa-adapter → lead.intake → PlatformIngress cannot silently regress to intent_not_found. Mirrors the registration shape used at contained-workflows.ts:401 against a real IntentRegistry. |

**Notes:** VERIFIED FACTS (file:line):
- Bug seam: channel-gateway.ts:313 submits `intent: `${resolved.skillSlug}.respond``; resolved.skillSlug for the managed deployment is the deployment's skill slug (e.g. "alex" — see channel-gateway.test.ts:19 mock `skillSlug: "alex"`). trigger is "chat" (channel-gateway.ts:323).
- Live registrar: platform/index.ts:124 `export { registerSkillIntents } from "./skill-intent-registrar.js";`. skill-mode.ts:98 imports it from "@switchboard/core/platform"; skill-mode.ts:149 calls `registerSkillIntents(intentRegistry, [alexSkill, miraSkill])` (ARRAY). skill-intent-registrar.ts:23-25 iterates skills, `if (!skill.intent) continue;` then registers `intent: skill.intent`. So it registers alex.run + creative.brief.compose, NOT *.respond.
- Dead registrar: register-skill-intents.ts:9 registers `${slug}.respond` but grep confirms its ONLY non-dist importer is register-skill-intents.test.ts:2. NOT exported from the barrel.
- SKILL.md intents: skills/alex/SKILL.md:4 `intent: alex.run`; skills/mira/SKILL.md:4 `intent: creative.brief.compose`. Parsed by skill-loader.ts:37 (`intent: z.string().optional()`) and :259.
- Mira live caller: mira-self-brief-request.ts:46 submits `intent: "creative.brief.compose"` — DO NOT drop skill.intent registration.
- Ingress lookup: platform-ingress.ts:163 `const registration = intentRegistry.lookup(request.intent); if (!registration) return { ok:false, error: { type:"intent_not_found", ... } }`. Trigger validated at ~platform-ingress.ts:191 via intentRegistry.validateTrigger.
- IntentRegistry API (intent-registry.ts): register() THROWS on duplicate intent (line 8-10); lookup(); validateTrigger(); listIntents() returns sorted keys (line 35); size getter.
- IntentRegistration shape (intent-registration.ts:35-50): intent, defaultMode, allowedModes, executor, parameterSchema, mutationClass, budgetClass, approvalPolicy, approvalMode?, idempotent, allowedTriggers, timeoutMs, retryable.
- Existing registrar test: platform/__tests__/skill-intent-registrar.test.ts (makeSkill helper at line 6-20 returns full SkillDefinition with intent "sales-pipeline.run"; uses real IntentRegistry).
- Real-file test idiom: skill-runtime/mira-skill.test.ts:8 `const SKILLS_DIR = new URL("../../../../skills", import.meta.url).pathname;` then loadSkill("alex"/"mira", SKILLS_DIR). From platform/__tests__/ the correct relative path is FIVE dot-dot: `new URL("../../../../../skills", import.meta.url).pathname` (verified by os.path.normpath → /Users/jasonli/switchboard/skills). loadSkill is exported from skill-runtime barrel (skill-runtime/index.ts:1) and directly from ./skill-loader.js.
- Existing bootstrap test gap: apps/api/src/bootstrap/__tests__/skill-mode-governance.test.ts mocks registerSkillIntents (line 106 `registerSkillIntents: vi.fn()`) and passes `intentRegistry: {} as never` (line 241), so NOTHING currently asserts the real registrar produces an intent the gateway can find.
- CTWA path (part d): ctwa-adapter.ts:103 emits `intent: "lead.intake"` (ad-optimizer L2, decoupled from core); buildCtwaIngressSubmitRequest (apps/chat/src/gateway/ctwa-ingress-request.ts:25) passes `intent: req.intent` through; submitted at apps/chat/src/main.ts:181. `lead.intake` is registered as a workflow at contained-workflows.ts:401 with allowedTriggers ["internal","api"]. Already wired — pin only.

DECISION on part (b) "REAL bootstrap smoke": fully booting bootstrapSkillMode requires ANTHROPIC_API_KEY (skill-mode.ts:128-130 throws without it), a real PrismaClient, and ~20 DB stores — CI has NO Postgres (per CLAUDE.md). A full-boot integration test is NOT CI-safe and is out of scope for a preflight. The CI-safe equivalent that still exercises the REAL seam end-to-end is to run the REAL `registerSkillIntents` over the REAL `loadSkill("alex", SKILLS_DIR)` into a REAL IntentRegistry, then assert the EXACT lookup + trigger-validation PlatformIngress performs (lookup("alex.respond") defined AND validateTrigger("alex.respond","chat") true). This is the "managed-inbound smoke" proving the gateway's intent is reachable without 503/intent_not_found. Documented as such in the test header.

LAYERING: all changes are within packages/core (L3) and its tests; one regression test reads skills/*.md via filesystem (same as existing mira-skill.test.ts, no new dep). No ad-optimizer→core import introduced. The dead register-skill-intents.ts is left untouched (deleting it risks build-typechecks-dead-files surprises and is out of scope; a follow-up may remove it).

CONVENTIONAL COMMITS: lowercase subjects (commitlint subject-case). All commits are `fix(core): ...` or `test(core): ...`.

RUN COMMANDS: this repo runs vitest per-package. Single-file: `pnpm --filter @switchboard/core test -- src/platform/skill-intent-registrar.respond.test.ts` (vitest accepts a path filter after `--`). The package "test" script is `vitest run` (packages/core/package.json:121). Run `pnpm --filter @switchboard/core typecheck` and the focused test before each commit; run full `pnpm --filter @switchboard/core test` once at the end. No DB/Postgres needed for any test here.

ORDER: Task 1 first writes the failing regression that encodes the gateway↔registrar contract (proves the bug), Task 1 then fixes the registrar (makes it pass). Task 2 pins the real-SKILL.md managed-inbound smoke. Task 3 pins the CTWA lead.intake path (already-correct, regression-only).

#### Task 1: Task 1 — Failing regression that encodes the gateway↔registrar contract, then fix the live registrar to register {slug}.respond

**Files:**
- Create: `/Users/jasonli/switchboard/packages/core/src/platform/skill-intent-registrar.respond.test.ts`
- Modify: `/Users/jasonli/switchboard/packages/core/src/platform/skill-intent-registrar.ts`
- Test: `/Users/jasonli/switchboard/packages/core/src/platform/skill-intent-registrar.respond.test.ts`

- [ ] **Step 1: Open packages/core/src/platform/__tests__/skill-intent-registrar.test.ts and confirm the existing makeSkill helper shape (line 6-20: returns a full SkillDefinition with name, slug, version, description, author, parameters, tools, body, context, intent) and that it imports the LIVE registrar `from "../skill-intent-registrar.js"` and the real `IntentRegistry from "../intent-registry.js"`. You will reuse the same import paths but from a sibling file at the package root (one directory up from __tests__), so the relative paths are `./skill-intent-registrar.js`, `./intent-registry.js`, and the type from `../skill-runtime/types.js`.**

Run: `cat /Users/jasonli/switchboard/packages/core/src/platform/__tests__/skill-intent-registrar.test.ts`
Expected: Confirms makeSkill returns a complete SkillDefinition with an `intent` field, uses real IntentRegistry, and the registrar import path. (Read-only verification step.)

- [ ] **Step 2: Create the failing regression test packages/core/src/platform/skill-intent-registrar.respond.test.ts. It encodes the exact contract the ChannelGateway depends on: the LIVE registrar must register `${slug}.respond` (the intent gateway submits at channel-gateway.ts:313) in addition to the declared skill.intent. Because main only registers skill.intent (alex.run), the `lookup("alex.respond")` assertions FAIL today. Note: this file lives at the package root (packages/core/src/platform/), so relative imports use a single `./` for siblings and `../skill-runtime/types.js` for the type.**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { IntentRegistry } from "./intent-registry.js";
import { registerSkillIntents } from "./skill-intent-registrar.js";
import type { SkillDefinition } from "../skill-runtime/types.js";

function makeSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    name: "Alex",
    slug: "alex",
    version: "1.0.0",
    description: "Frontline conversion agent",
    author: "test",
    parameters: [],
    tools: ["crm-write"],
    body: "You are Alex",
    context: [],
    intent: "alex.run",
    ...overrides,
  };
}

describe("registerSkillIntents — gateway respond contract", () => {
  let registry: IntentRegistry;

  beforeEach(() => {
    registry = new IntentRegistry();
  });

  it("registers the {slug}.respond intent the ChannelGateway submits (channel-gateway.ts:313)", () => {
    registerSkillIntents(registry, [makeSkill()]);
    // The gateway submits `${resolved.skillSlug}.respond`; PlatformIngress.submit
    // (platform-ingress.ts:163) returns intent_not_found if this is undefined.
    expect(registry.lookup("alex.respond")).toBeDefined();
  });

  it("keeps the declared skill.intent registered (load-bearing for non-gateway callers)", () => {
    registerSkillIntents(registry, [makeSkill()]);
    // alex.run / creative.brief.compose have live submit callers — must not be dropped.
    expect(registry.lookup("alex.run")).toBeDefined();
  });

  it("allows the gateway 'chat' trigger on the respond intent", () => {
    registerSkillIntents(registry, [makeSkill()]);
    // channel-gateway.ts:323 submits trigger: "chat"; validateTrigger gates it at submit.
    expect(registry.validateTrigger("alex.respond", "chat")).toBe(true);
  });

  it("binds the respond executor to the skill slug", () => {
    registerSkillIntents(registry, [makeSkill({ slug: "alex" })]);
    expect(registry.lookup("alex.respond")?.executor).toEqual({
      mode: "skill",
      skillSlug: "alex",
    });
  });

  it("adds {slug}.respond alongside a 3-part declared intent without a duplicate throw (mira)", () => {
    // skills/mira/SKILL.md: slug "creative", intent "creative.brief.compose".
    expect(() =>
      registerSkillIntents(registry, [
        makeSkill({
          name: "Mira",
          slug: "creative",
          intent: "creative.brief.compose",
          tools: [],
        }),
      ]),
    ).not.toThrow();
    expect(registry.lookup("creative.brief.compose")).toBeDefined();
    expect(registry.lookup("creative.respond")).toBeDefined();
  });

  it("does not double-register when a skill's declared intent already ends in .respond", () => {
    // Guards the equality short-circuit: IntentRegistry.register throws on a dup
    // (intent-registry.ts:8-10), so registering {slug}.respond must be skipped
    // when skill.intent === `${slug}.respond`.
    expect(() =>
      registerSkillIntents(registry, [makeSkill({ slug: "echo", intent: "echo.respond" })]),
    ).not.toThrow();
    expect(registry.lookup("echo.respond")).toBeDefined();
  });
});

```

- [ ] **Step 3: Run the new test and confirm it FAILS on the .respond assertions (proving the main-branch bug). The `alex.run` and 'does not double-register' cases should pass; the `alex.respond` / `creative.respond` / chat-trigger / executor cases should fail because the live registrar registers only skill.intent today.**

Run: `pnpm --filter @switchboard/core test -- src/platform/skill-intent-registrar.respond.test.ts`
Expected: FAIL: assertions `registry.lookup("alex.respond")` toBeDefined, `validateTrigger("alex.respond","chat")` toBe true, the executor toEqual, and `creative.respond` toBeDefined all fail (received undefined / false). This is the confirmed intent_not_found defect.

- [ ] **Step 4: Open the live registrar packages/core/src/platform/skill-intent-registrar.ts and read the loop body (lines 23-48) so the next edit inserts the .respond registration immediately after the existing `registry.register(registration)` call, reusing the same derived `mutationClass`, `budgetClass`, `approvalPolicy`, and the `idempotent/allowedTriggers/timeoutMs/retryable` fields already in scope.**

Run: `cat /Users/jasonli/switchboard/packages/core/src/platform/skill-intent-registrar.ts`
Expected: Confirms the loop computes mutationClass/budgetClass/approvalPolicy and builds one `registration` object with intent: skill.intent, then calls registry.register(registration). allowedTriggers already includes "chat" (line 41).

- [ ] **Step 5: Apply the FIX: in skill-intent-registrar.ts, immediately after the existing `registry.register(registration);` line (currently line 46), add a second registration for `${skill.slug}.respond` — but only when it differs from the declared intent (IntentRegistry.register throws on a duplicate). The respond registration mirrors the declared one in every derived field and binds the executor to the same slug. Use Edit to replace the single `registry.register(registration);` line with the block below.**

```ts
    registry.register(registration);

    // The managed inbound chain (ChannelGateway.handleIncoming → PlatformIngress)
    // submits `${resolved.skillSlug}.respond` (channel-gateway.ts:313, trigger
    // "chat"). The declared skill.intent (e.g. "alex.run") is kept for cron/API
    // callers (e.g. mira's "creative.brief.compose"), but without an explicit
    // `${slug}.respond` registration that inbound submit returns intent_not_found
    // (platform-ingress.ts:163). Register it too, skipping the duplicate when the
    // declared intent already is `${slug}.respond` (IntentRegistry.register throws
    // on a repeat — intent-registry.ts:8-10).
    const respondIntent = `${skill.slug}.respond`;
    if (respondIntent !== skill.intent) {
      registry.register({
        ...registration,
        intent: respondIntent,
      });
    }
```

- [ ] **Step 6: Re-run the focused test; it must now PASS in full (the .respond intent, chat trigger, executor binding, the mira 3-part case, and the duplicate-guard case).**

Run: `pnpm --filter @switchboard/core test -- src/platform/skill-intent-registrar.respond.test.ts`
Expected: PASS: all cases green, including `registry.lookup("alex.respond")` defined, `validateTrigger("alex.respond","chat")` true, executor `{ mode: "skill", skillSlug: "alex" }`, and `creative.respond` defined with no throw.

- [ ] **Step 7: Run the pre-existing registrar test to confirm the fix did not regress the declared-intent behavior (this file asserts skill.intent registration and counts registry.size, which now also includes the .respond entries — verify it still passes; it only asserts presence/values of the .run intents and never asserts an exact total size, so it remains green).**

Run: `pnpm --filter @switchboard/core test -- src/platform/__tests__/skill-intent-registrar.test.ts`
Expected: PASS: existing assertions (lookup of *.run intents, mutationClass/budgetClass derivation, executor/defaultMode/allowedTriggers) remain green.

- [ ] **Step 8: Typecheck the core package to confirm no type errors from the spread-based second registration.**

Run: `pnpm --filter @switchboard/core typecheck`
Expected: No type errors (exit 0).

- [ ] **Step 9: Commit the failing-test-then-fix as one focused change (test file + registrar fix).**

Run: `git add packages/core/src/platform/skill-intent-registrar.ts packages/core/src/platform/skill-intent-registrar.respond.test.ts && git commit -m "fix(core): register {slug}.respond so managed inbound resolves at ingress"`
Expected: One commit created on the implementation branch; lowercase conventional-commit subject accepted by commitlint.


#### Task 2: Task 2 — Managed-inbound smoke over the REAL skills/alex/SKILL.md asserting the gateway's intent resolves at the ingress lookup

**Files:**
- Create: `/Users/jasonli/switchboard/packages/core/src/platform/__tests__/managed-inbound-intent-smoke.test.ts`
- Test: `/Users/jasonli/switchboard/packages/core/src/platform/__tests__/managed-inbound-intent-smoke.test.ts`

- [ ] **Step 1: Confirm the real-file test idiom and the correct relative skills path FROM packages/core/src/platform/__tests__/. The existing skill-runtime/mira-skill.test.ts:8 uses `new URL("../../../../skills", import.meta.url)` from packages/core/src/skill-runtime/. The new test sits one directory deeper (platform/__tests__), so it needs FIVE `..` segments: `../../../../../skills`. Verify loadSkill is importable from the skill-runtime barrel.**

Run: `node -e "console.log(require('path').normalize('/Users/jasonli/switchboard/packages/core/src/platform/__tests__/' + '../../../../../skills'))"; grep -n "loadSkill" /Users/jasonli/switchboard/packages/core/src/skill-runtime/index.ts`
Expected: Prints /Users/jasonli/switchboard/skills, and grep shows `export { loadSkill } from "./skill-loader.js";` (line 1).

- [ ] **Step 2: Create the managed-inbound smoke test. It boots NO Anthropic and NO Postgres: it loads the REAL skills/alex/SKILL.md via loadSkill, runs the REAL registrar into a REAL IntentRegistry, then asserts the EXACT two operations PlatformIngress.submit performs for the gateway's request — lookup('alex.respond') is defined (platform-ingress.ts:163, the intent_not_found gate) and validateTrigger('alex.respond','chat') is true (the trigger gate at ~platform-ingress.ts:191). The header documents why this is the CI-safe stand-in for a full bootstrap smoke. Imports from the __tests__ directory use `../` for platform siblings and the skill-runtime barrel for loadSkill.**

```ts
import { describe, it, expect } from "vitest";
import { IntentRegistry } from "../intent-registry.js";
import { registerSkillIntents } from "../skill-intent-registrar.js";
import { loadSkill } from "../../skill-runtime/skill-loader.js";

// Managed-inbound smoke (Phase 0 preflight). A full bootstrapSkillMode() boot
// needs ANTHROPIC_API_KEY (skill-mode.ts:128) + a real PrismaClient + ~20 DB
// stores, and CI has no Postgres — so this exercises the SAME seam without a
// boot: the REAL skills/alex/SKILL.md → the REAL registrar → a REAL
// IntentRegistry, then the EXACT lookup + trigger checks PlatformIngress.submit
// runs for the ChannelGateway request (channel-gateway.ts:313 submits
// `${skillSlug}.respond`, trigger "chat"; platform-ingress.ts:163 returns
// intent_not_found when the lookup is undefined). If this red, managed inbound
// is dead at ingress.
const SKILLS_DIR = new URL("../../../../../skills", import.meta.url).pathname;

describe("managed inbound: real alex SKILL.md resolves the gateway's respond intent", () => {
  it("loads alex.run from the real SKILL.md frontmatter", () => {
    const alex = loadSkill("alex", SKILLS_DIR);
    expect(alex.slug).toBe("alex");
    expect(alex.intent).toBe("alex.run");
  });

  it("registers an intent the ChannelGateway's submit can find (no intent_not_found)", () => {
    const registry = new IntentRegistry();
    registerSkillIntents(registry, [loadSkill("alex", SKILLS_DIR)]);

    // The gateway builds `intent: `${resolved.skillSlug}.respond`` for the
    // "alex" deployment → "alex.respond".
    const gatewayIntent = "alex.respond";
    expect(registry.lookup(gatewayIntent)).toBeDefined();
    expect(registry.validateTrigger(gatewayIntent, "chat")).toBe(true);
  });
});

```

- [ ] **Step 3: Run the smoke test. It must PASS now that Task 1 registers {slug}.respond (and proves the real alex SKILL.md frontmatter still declares alex.run).**

Run: `pnpm --filter @switchboard/core test -- src/platform/__tests__/managed-inbound-intent-smoke.test.ts`
Expected: PASS: alex.intent === "alex.run"; lookup("alex.respond") defined; validateTrigger("alex.respond","chat") true.

- [ ] **Step 4: Sanity-check that the smoke would have caught the original bug: temporarily nothing to edit — instead confirm the assertion targets the post-fix registrar by re-reading that the test imports `../skill-intent-registrar.js` (the live/barrel one), NOT `register-skill-intents.js` (the dead one). This guards against a future author pinning the wrong registrar.**

Run: `grep -n "skill-intent-registrar\|register-skill-intents" /Users/jasonli/switchboard/packages/core/src/platform/__tests__/managed-inbound-intent-smoke.test.ts`
Expected: Shows the import is `../skill-intent-registrar.js` only; no reference to the dead `register-skill-intents.js`.

- [ ] **Step 5: Commit the managed-inbound smoke.**

Run: `git add packages/core/src/platform/__tests__/managed-inbound-intent-smoke.test.ts && git commit -m "test(core): smoke real alex SKILL.md reaches a registered respond intent"`
Expected: One commit created; lowercase conventional-commit subject.


#### Task 3: Task 3 — Regression-pin the CTWA → lead.intake path (already wired) so it cannot silently regress to intent_not_found

**Files:**
- Create: `/Users/jasonli/switchboard/packages/core/src/intents/__tests__/lead-intake-intent-registration.smoke.test.ts`
- Test: `/Users/jasonli/switchboard/packages/core/src/intents/__tests__/lead-intake-intent-registration.smoke.test.ts`

- [ ] **Step 1: Confirm the CTWA path's intent and its registration shape. The ad-optimizer CTWA adapter emits `intent: "lead.intake"` (packages/ad-optimizer/src/lead-intake/ctwa-adapter.ts:103), threaded unchanged through buildCtwaIngressSubmitRequest (apps/chat/src/gateway/ctwa-ingress-request.ts:25) and submitted at apps/chat/src/main.ts:181. The intent is registered as a workflow at apps/api/src/bootstrap/contained-workflows.ts:401 with allowedTriggers ['internal','api']. Verify these two facts before pinning.**

Run: `grep -n 'intent: "lead.intake"' /Users/jasonli/switchboard/packages/ad-optimizer/src/lead-intake/ctwa-adapter.ts; sed -n '400,406p' /Users/jasonli/switchboard/apps/api/src/bootstrap/contained-workflows.ts`
Expected: ctwa-adapter.ts:103 shows `intent: "lead.intake"`; contained-workflows.ts shows the lead.intake registration block with workflowId "lead.intake" and allowedTriggers ["internal","api"].

- [ ] **Step 2: Confirm the packages/core/src/intents directory exists and check whether it already has a __tests__ folder; if not, the new test path creates it. (Co-located test policy: this pins the contract for the lead.intake intent that core's lead-intake workflow handler serves.)**

Run: `ls -d /Users/jasonli/switchboard/packages/core/src/intents /Users/jasonli/switchboard/packages/core/src/intents/__tests__ 2>&1`
Expected: intents/ exists; __tests__ may or may not exist (an error for the second path is fine — the create step makes it).

- [ ] **Step 3: Create the CTWA lead.intake regression pin. It does NOT import app code (layering: core must not import apps); it instead builds a real IntentRegistry, registers the SAME shape the bootstrap uses for lead.intake (a workflow intent with triggers ['internal','api']), and asserts that the intent the ctwa-adapter emits resolves and accepts the adapter-originated trigger — so a rename of either side surfaces here as a red test rather than a silent intent_not_found in production. The CTWA submit rides trigger 'internal'/'api' (adapter-originated, not 'chat').**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { IntentRegistry } from "../../platform/intent-registry.js";

// CTWA path regression pin (Phase 0 preflight, spec part d). The ad-optimizer
// CTWA adapter emits `intent: "lead.intake"` (ctwa-adapter.ts:103), threaded
// through buildCtwaIngressSubmitRequest (ctwa-ingress-request.ts:25) to
// PlatformIngress (apps/chat/src/main.ts:181). lead.intake is registered as a
// workflow at contained-workflows.ts:401 with allowedTriggers ["internal","api"].
// This pins the contract WITHOUT importing app code (core must not import apps):
// it registers the identical shape and proves the emitted intent + adapter
// trigger resolve, so a rename on either side reds here instead of returning
// intent_not_found at ingress in production.
const CTWA_EMITTED_INTENT = "lead.intake";

describe("CTWA lead.intake intent registration contract", () => {
  let registry: IntentRegistry;

  beforeEach(() => {
    registry = new IntentRegistry();
    // Mirror of the bootstrap registration (contained-workflows.ts:401).
    registry.register({
      intent: "lead.intake",
      defaultMode: "workflow",
      allowedModes: ["workflow"],
      executor: { mode: "workflow", workflowId: "lead.intake" },
      parameterSchema: {},
      mutationClass: "write",
      budgetClass: "standard",
      approvalPolicy: "none",
      idempotent: false,
      allowedTriggers: ["internal", "api"],
      timeoutMs: 30_000,
      retryable: false,
    });
  });

  it("resolves the exact intent the CTWA adapter emits", () => {
    expect(registry.lookup(CTWA_EMITTED_INTENT)).toBeDefined();
  });

  it("accepts the adapter-originated triggers (internal/api), not chat", () => {
    expect(registry.validateTrigger(CTWA_EMITTED_INTENT, "internal")).toBe(true);
    expect(registry.validateTrigger(CTWA_EMITTED_INTENT, "api")).toBe(true);
    expect(registry.validateTrigger(CTWA_EMITTED_INTENT, "chat")).toBe(false);
  });
});

```

- [ ] **Step 4: Run the CTWA pin. It must PASS (this path is already correctly wired; the test only freezes the contract).**

Run: `pnpm --filter @switchboard/core test -- src/intents/__tests__/lead-intake-intent-registration.smoke.test.ts`
Expected: PASS: lookup("lead.intake") defined; internal/api triggers true; chat trigger false.

- [ ] **Step 5: Confirm the Trigger type accepts the string literals used ('internal','api','chat') by typechecking the package (the IntentRegistration.allowedTriggers field is Trigger[] from platform/types.ts; if 'internal' were not a valid Trigger the registration object would not typecheck).**

Run: `pnpm --filter @switchboard/core typecheck`
Expected: No type errors (exit 0), confirming 'internal'/'api'/'chat' are valid Trigger members and the registration shape matches IntentRegistration.

- [ ] **Step 6: Commit the CTWA regression pin.**

Run: `git add packages/core/src/intents/__tests__/lead-intake-intent-registration.smoke.test.ts && git commit -m "test(core): pin ctwa lead.intake intent registration contract"`
Expected: One commit created; lowercase conventional-commit subject.


#### Task 4: Task 4 — Full core test + typecheck gate (verification before completion)

**Files:**
- Test: `/Users/jasonli/switchboard/packages/core/src/platform/skill-intent-registrar.respond.test.ts`
- Test: `/Users/jasonli/switchboard/packages/core/src/platform/__tests__/managed-inbound-intent-smoke.test.ts`
- Test: `/Users/jasonli/switchboard/packages/core/src/intents/__tests__/lead-intake-intent-registration.smoke.test.ts`

- [ ] **Step 1: Run the entire core package test suite to confirm the registrar change did not regress any other consumer of registerSkillIntents or the IntentRegistry (no co-located test asserts an exact registry total that the extra .respond entries would break — verified for the existing skill-intent-registrar.test.ts in Task 1, this gate covers the rest of the package).**

Run: `pnpm --filter @switchboard/core test`
Expected: All core tests PASS (including the three new files and the pre-existing skill-intent-registrar.test.ts and register-skill-intents.test.ts).

- [ ] **Step 2: Run the core typecheck as the final gate.**

Run: `pnpm --filter @switchboard/core typecheck`
Expected: No type errors (exit 0).

- [ ] **Step 3: Verify branch context before any push (CLAUDE.md branch doctrine; agent sessions can drift worktrees). Confirm the active branch is the close-the-revenue-loop implementation branch and the three commits are present.**

Run: `git branch --show-current && git log --oneline -3`
Expected: Active branch is the intended implementation branch (not main); the last three commits are the fix(core) and two test(core) commits from Tasks 1-3.


---

## 1A-1 — feat(schemas,core,db,ad-optimizer): heal the two-contact split via canonical E.164 identity

**Goal:** Make the CTWA Contact that carries ad attribution be the exact same Contact a WhatsApp booking resolves against, by introducing one canonical E.164 normalizer in @switchboard/schemas (L1), calling it at the four phone-touch sites (ctwa-adapter, instant-form-adapter, resolve-contact-identity, lead-intake-store / prisma-contact-store), deriving a stored Contact.phoneE164 column, and matching findByPhone against that canonical column. Per R3 the normalizer refuses to guess: a 0-prefixed national number with no explicit region returns null (a wrong merge is worse than no merge); SG 8-digit [89]xxxxxxx defaults to +65 (pilot shape) when region is SG or undefined; MY 0-prefixed national maps to +60 only when region==='MY' is explicit. The load-bearing outcome: attribution is no longer fake on the live CTWA path — every downstream receipt in Spec-1 is mis-attributed until this lands.

**File structure:**

| Action | Path | Responsibility |
|---|---|---|
| create | `packages/schemas/src/phone.ts` | Canonical E.164 helpers (L1, no deps): isE164(value) boolean guard reusing the ^\+[1-9]\d{6,14}$ pattern; normalizeToE164(raw, region?) that strips spaces/dashes/parens, keeps already-+ numbers, infers +65 for SG 8-digit [89]xxxxxxx when region is 'SG' or undefined, infers +60 for a 0-prefixed MY national number ONLY when region==='MY', and returns null for ambiguous/junk/0-prefixed-without-region inputs (never throws). |
| create | `packages/schemas/src/phone.test.ts` | Co-located unit matrix for normalizeToE164/isE164: already-+ idempotent; 6591234567→+6591234567; SG 8-digit→+65; 0-prefixed MY WITHOUT region→null; 0-prefixed WITH region 'MY'→+60; spaces/dashes/parens stripped; junk→null without throwing. |
| modify | `packages/schemas/src/index.ts` | Barrel-export the new ./phone.js module so consumers import normalizeToE164/isE164 from @switchboard/schemas. |
| modify | `packages/schemas/src/lifecycle.ts` | Add phoneE164: z.string().nullable().optional() to ContactSchema so the Contact type (z.infer) carries the new stored column and mapRowToContact can return it. |
| modify | `packages/ad-optimizer/src/lead-intake/ctwa-adapter.ts` | Replace the startsWith('+') phone normalization (line 54) with normalizeToE164(msg.from, opts.region); add optional region?: 'SG'|'MY' to the builder opts and to CtwaAdapterDeps, threaded into buildCtwaIntake; keep idempotencyKey keyed on the normalized phone; if normalization returns null, fall back to the prior +-prefixed behavior so a non-SG bare number still ingests. |
| modify | `packages/ad-optimizer/src/lead-intake/ctwa-adapter.test.ts` | Add region-threading cases: SG bare 8-digit normalizes to +65; an explicit region:'MY' on a 0-prefixed number normalizes to +60; existing +-prefixed cases stay green. |
| modify | `packages/ad-optimizer/src/lead-intake/instant-form-adapter.ts` | Replace the local normalizePhone helper (lines 25-28) with normalizeToE164 threaded with an optional region from InstantFormAdapterDeps/opts; preserve the null-when-no-identifier contract. |
| modify | `packages/ad-optimizer/src/lead-intake/instant-form-adapter.test.ts` | Add a case proving normalizeToE164 is used (bare SG 8-digit phone field → +65) and that an un-normalizable phone still yields a contact when an email is present. |
| modify | `packages/core/src/channel-gateway/resolve-contact-identity.ts` | Add optional region?: 'SG'|'MY' to resolveContactIdentity args; normalize the wa_id (sessionId) via normalizeToE164 before findByPhone AND before create, falling back to the raw sessionId when normalization returns null; return the normalized phone. |
| modify | `packages/core/src/channel-gateway/resolve-contact-identity.test.ts` | Add the load-bearing case: a bare wa_id '6591234567' calls findByPhone with the NORMALIZED '+6591234567' (so it resolves an existing +-stored contact) and does NOT create a second contact. |
| modify | `packages/core/src/channel-gateway/channel-gateway.ts` | At the resolveContactIdentity call site (line 218) pass region: undefined (no market signal available on DeploymentResolverResult today) — explicit, documenting the refuse-to-guess default. |
| modify | `packages/db/src/stores/prisma-contact-store.ts` | Derive phoneE164 = normalizeToE164(input.phone) in create() and write it to the create data; in findByPhone() normalize the incoming phone and query the phoneE164 COLUMN (falling back to a raw-phone exact match when normalization returns null); add phoneE164 to mapRowToContact's row param type and returned object. |
| modify | `packages/db/src/stores/__tests__/prisma-contact-store.test.ts` | Mock-Prisma tests: create() writes the derived phoneE164; findByPhone('+65 9123 4567') queries { organizationId, phoneE164: '+6591234567' }; findByPhone of an un-normalizable value falls back to a raw phone query; mapRowToContact surfaces phoneE164. |
| modify | `packages/db/src/stores/lead-intake-store.ts` | Derive phoneE164 = normalizeToE164(input.phone) in upsertContact's create branch (leave the no-op update branch untouched) so the CTWA Contact stores the canonical column the gateway later matches on. |
| create | `packages/db/src/stores/__tests__/prisma-lead-intake-store-phone.test.ts` | Mock-Prisma unit test (the existing lead-intake-store.test.ts is a DATABASE_URL-gated integration test; add a co-located mocked-Prisma unit test) asserting upsertContact's create data includes the derived phoneE164 and the update branch is untouched. |
| modify | `packages/db/prisma/schema.prisma` | Add phoneE164 String? to the Contact model (after the phone field, ~line 1745) and @@index([organizationId, phoneE164]); the partial unique is added via raw SQL migration, not in-schema. |
| create | `packages/db/prisma/migrations/20260606000000_contact_phone_e164/migration.sql` | Same-commit migration: ALTER TABLE add phoneE164 column; CREATE INDEX on (organizationId, phoneE164); CREATE UNIQUE INDEX partial on (organizationId, phoneE164) WHERE phoneE164 IS NOT NULL — mirroring 20260603120000_booking_partial_unique_active. |

**Notes:** VERIFIED against the repo (file:line cited inline in steps). Key design facts I confirmed before writing:
- The E.164 regex `^\+[1-9]\d{6,14}$` already exists at packages/schemas/src/whatsapp-template-create.ts:3 (named `E164`); the new phone.ts reuses the identical pattern (do NOT import it cross-file — it is a private const there; redefine the same literal in phone.ts so the new module is self-contained at L1).
- The `Contact` TS type is `z.infer<typeof ContactSchema>` at packages/schemas/src/lifecycle.ts:102-125. `mapRowToContact` (prisma-contact-store.ts:380-422) returns `Contact`, so `phoneE164` MUST be added to `ContactSchema` (optional, nullable) or the mapper's return type won't compile. This is a type-only addition; storage stays additive.
- REFUSE-TO-GUESS placement (R3): the normalizer's hard contract is that an 8-digit number is ONLY treated as SG when it matches `^[89]\d{7}$` (SG mobile shape) AND region is SG-or-undefined; a 0-prefixed number is ONLY +60 when region==='MY'. Everything else ambiguous → null. This is why a bare MY mobile without region cannot be merged.
- CRITICAL design choice for findByPhone (prisma-contact-store.ts:128-138): it must (a) normalize the incoming phone via normalizeToE164, and (b) query against the new `phoneE164` COLUMN, not the raw `phone` column. Reason: the load-bearing regression — lead.intake stores Contact A with phone="+6591234567"/phoneE164="+6591234567"; the gateway later calls resolveContactIdentity with a BARE wa_id "6591234567". Only normalize-then-match-on-phoneE164 makes the bare id resolve to A. If normalizeToE164 returns null (un-normalizable input), fall back to the legacy raw-`phone` exact match so non-E.164 channels keep working.
- The market/region signal is NOT available at the resolveContactIdentity call site today (channel-gateway.ts:218 — `resolved: DeploymentResolverResult` has no market/jurisdiction field; deployment-resolver.ts:8-22). Per the spec ("use the deployment/channel market if available, else undefined") the correct in-scope move is to thread an OPTIONAL `region?` param and pass `undefined` at the gateway call site. SG 8-digit still resolves (region undefined → +65 for SG shape); ambiguous 0-prefixed still refuses. Threading real market is a later wiring task and out of scope for 1A-1.
- ctwa-adapter.ts (L2, ad-optimizer) and instant-form-adapter.ts (L2) import ONLY @switchboard/schemas — confirmed they may import the new phone.ts (layering schemas→ad-optimizer is legal; ad-optimizer must NOT import core, and phone.ts is L1 so this is safe). They currently normalize via `startsWith("+")` (ctwa-adapter.ts:54, instant-form-adapter.ts:25-28); replace with normalizeToE164 threaded with an optional region (undefined today).
- Migration: latest existing is 20260604233000; new dir = 20260606000000_contact_phone_e164. Partial unique is RAW SQL (Prisma 6 cannot express it in-schema) — mirror 20260603120000_booking_partial_unique_active exactly. Schema change + migration in the SAME commit (CLAUDE.md). `prisma migrate dev` needs a TTY (memory gotcha) — hand-write migration.sql; run `pnpm db:generate` so the Prisma client/TS knows `phoneE164`. DB tests MOCK Prisma (CI has no Postgres) — mirror prisma-workflow-store.test.ts / the existing prisma-contact-store.test.ts mock factory.
- Every Prisma mutation already includes organizationId in WHERE via updateMany+count===0 in this store; 1A-1 only touches create/upsert/findFirst (reads) and adds a column — no new mutating method, so no new count===0 guard needed.
- Test commands use the package-local vitest binary (packages/*/node_modules/.bin/vitest confirmed present); `pnpm --filter <pkg> exec vitest run <path>` is the exact single-file form.
DEFERRED with reason: backfill/merge of EXISTING split Contacts is explicitly out of scope (spec §4 + §10 note) — the partial-unique guardrail only prevents NEW splits; historical merge is a separate dry-run-first operator migration. The campaign-id resolver is already wired (ctwa-adapter.ts:87-100 reads resolveCampaignId) and buildBookedConversionPayload already reads attribution.sourceCampaignId — no change needed here (spec §3.1).

#### Task 1: Task 1 — Canonical E.164 normalizer in schemas (L1) with refuse-to-guess matrix

**Files:**
- Create: `packages/schemas/src/phone.ts`
- Create: `packages/schemas/src/phone.test.ts`
- Modify: `packages/schemas/src/index.ts`
- Test: `packages/schemas/src/phone.test.ts`

- [ ] **Step 1: Write the failing test FIRST. Create packages/schemas/src/phone.test.ts with the full normalizer matrix from spec §13 plus the R3 refuse-to-guess cases. This mirrors the existing schemas test style (describe/it/expect from vitest, import from ./phone.js) seen at packages/schemas/src/lead-intake.test.ts:1-2.**

```ts
import { describe, it, expect } from "vitest";
import { normalizeToE164, isE164 } from "./phone.js";

describe("isE164", () => {
  it("accepts a valid E.164 number", () => {
    expect(isE164("+6591234567")).toBe(true);
  });
  it("rejects a number without a leading +", () => {
    expect(isE164("6591234567")).toBe(false);
  });
  it("rejects a number starting +0", () => {
    expect(isE164("+0591234567")).toBe(false);
  });
});

describe("normalizeToE164", () => {
  it("keeps an already-+ E.164 number unchanged", () => {
    expect(normalizeToE164("+6591234567")).toBe("+6591234567");
  });
  it("is idempotent on a + number with spaces and dashes", () => {
    expect(normalizeToE164("+65 9123-4567")).toBe("+6591234567");
  });
  it("strips parens, spaces, and dashes from a + number", () => {
    expect(normalizeToE164("+(65) 9123 4567")).toBe("+6591234567");
  });
  it("infers +65 for an SG 8-digit mobile when region is undefined (pilot default)", () => {
    expect(normalizeToE164("91234567")).toBe("+6591234567");
  });
  it("infers +65 for an SG 8-digit mobile when region is 'SG'", () => {
    expect(normalizeToE164("81234567", "SG")).toBe("+6581234567");
  });
  it("REFUSES to guess: a 0-prefixed national number with NO region returns null (not +60)", () => {
    expect(normalizeToE164("0123456789")).toBeNull();
  });
  it("infers +60 for a 0-prefixed MY national number ONLY when region is explicitly 'MY'", () => {
    expect(normalizeToE164("0123456789", "MY")).toBe("+60123456789");
  });
  it("returns null for junk input and never throws", () => {
    expect(normalizeToE164("not-a-phone")).toBeNull();
    expect(normalizeToE164("")).toBeNull();
    expect(normalizeToE164("   ")).toBeNull();
  });
  it("does not treat a 7-digit number as an SG mobile (wrong length)", () => {
    expect(normalizeToE164("1234567")).toBeNull();
  });
});

```

- [ ] **Step 2: Run the test and confirm it FAILS (module not found — phone.ts does not exist yet).**

Run: `pnpm --filter @switchboard/schemas exec vitest run src/phone.test.ts`
Expected: FAIL — Cannot find module './phone.js' (or 'normalizeToE164 is not a function'). Zero tests pass.

- [ ] **Step 3: Now write the minimal real implementation. Create packages/schemas/src/phone.ts. Reuse the exact E.164 pattern from packages/schemas/src/whatsapp-template-create.ts:3 (redefined locally so this L1 module stays self-contained). The refuse-to-guess logic (R3): strip non-+/digit chars; already-+ → validate; SG 8-digit [89]xxxxxxx → +65 when region is SG or undefined; 0-prefixed national → +60 ONLY when region==='MY'; everything else → null.**

```ts
/** Canonical E.164 phone helpers. Layer-1 (no @switchboard/* imports). */

/** Same pattern as whatsapp-template-create.ts:3 — E.164: + then 7..15 digits, first digit 1-9. */
const E164 = /^\+[1-9]\d{6,14}$/;

/** True when `value` is already a valid E.164 string. */
export function isE164(value: string): boolean {
  return E164.test(value);
}

/** SG mobile (and 8/9-prefixed) local number: exactly 8 digits starting 8 or 9. */
const SG_8_DIGIT = /^[89]\d{7}$/;
/** MY national number written with a trunk 0 prefix, e.g. 0123456789. */
const MY_TRUNK_ZERO = /^0\d{8,10}$/;

/**
 * Normalize a raw phone string to E.164, or return null when it cannot be
 * normalized WITHOUT guessing a country (a wrong merge is worse than no merge).
 *
 * - Already-`+` numbers are validated and returned (spaces/dashes/parens stripped).
 * - An SG 8-digit mobile ([89]xxxxxxx) maps to +65 when `region` is 'SG' or
 *   undefined (SG is the pilot default for THIS shape only).
 * - A 0-prefixed national number maps to +60 ONLY when `region` is explicitly 'MY'.
 * - Anything else (ambiguous, 0-prefixed without a region, junk) → null.
 *
 * Never throws.
 */
export function normalizeToE164(
  raw: string | null | undefined,
  region?: "SG" | "MY",
): string | null {
  if (!raw) return null;
  // Strip spaces, dashes, and parentheses; keep a leading + and digits.
  const cleaned = raw.replace(/[\s\-()]/g, "");
  if (cleaned === "") return null;

  if (cleaned.startsWith("+")) {
    return E164.test(cleaned) ? cleaned : null;
  }

  // MY trunk-zero national number: only with an explicit MY region signal.
  if (region === "MY" && MY_TRUNK_ZERO.test(cleaned)) {
    const candidate = `+60${cleaned.slice(1)}`;
    return E164.test(candidate) ? candidate : null;
  }

  // SG 8-digit mobile: pilot default for this shape when region is SG or absent.
  if ((region === "SG" || region === undefined) && SG_8_DIGIT.test(cleaned)) {
    const candidate = `+65${cleaned}`;
    return E164.test(candidate) ? candidate : null;
  }

  // Refuse to guess.
  return null;
}

```

- [ ] **Step 4: Add the barrel export. In packages/schemas/src/index.ts, add the phone export next to the other module exports (the file already exports e.g. ./contacts.js at line 68 and ./whatsapp-template-create.js at line 185).**

```ts
export * from "./phone.js";
```

- [ ] **Step 5: Run the test again and confirm it PASSES.**

Run: `pnpm --filter @switchboard/schemas exec vitest run src/phone.test.ts`
Expected: PASS — all isE164 and normalizeToE164 cases green (including the 0-prefixed-no-region → null and explicit-MY → +60 cases).

- [ ] **Step 6: Commit (schema/type addition + helper in one commit; conventional-commit lowercase subject per CLAUDE.md).**

Run: `git add packages/schemas/src/phone.ts packages/schemas/src/phone.test.ts packages/schemas/src/index.ts && git commit -m "feat(schemas): canonical e.164 normalizer with refuse-to-guess defaults"`
Expected: Commit succeeds; commitlint accepts the lowercase subject.


#### Task 2: Task 2 — Add phoneE164 to ContactSchema (type) so the Contact type carries the new column

**Files:**
- Modify: `packages/schemas/src/lifecycle.ts`
- Test: `packages/schemas/src/phone.test.ts`

- [ ] **Step 1: Add phoneE164 to ContactSchema so the inferred Contact type (used by mapRowToContact in the DB store) includes the field. Edit packages/schemas/src/lifecycle.ts — insert the new field directly after the existing `phone:` line (lifecycle.ts:106).**

```ts
  phone: z.string().nullable().optional(),
  phoneE164: z.string().nullable().optional(),
```

- [ ] **Step 2: Typecheck the schemas package to confirm the schema still compiles (no test needed — this is a pure type-surface addition; the field is exercised by Task 7's DB tests).**

Run: `pnpm --filter @switchboard/schemas typecheck`
Expected: PASS — no TypeScript errors; the Contact type now includes phoneE164?: string | null.

- [ ] **Step 3: Commit.**

Run: `git add packages/schemas/src/lifecycle.ts && git commit -m "feat(schemas): add phoneE164 to contact type"`
Expected: Commit succeeds.


#### Task 3: Task 3 — Thread region + normalizeToE164 through the CTWA adapter (L2)

**Files:**
- Modify: `packages/ad-optimizer/src/lead-intake/ctwa-adapter.ts`
- Modify: `packages/ad-optimizer/src/lead-intake/ctwa-adapter.test.ts`
- Test: `packages/ad-optimizer/src/lead-intake/ctwa-adapter.test.ts`

- [ ] **Step 1: Write the failing tests FIRST. Append cases to packages/ad-optimizer/src/lead-intake/ctwa-adapter.test.ts proving normalizeToE164 is used: a bare SG 8-digit `from` becomes +65, and an explicit region:'MY' on a 0-prefixed number becomes +60. The existing makeMessage helper (ctwa-adapter.test.ts:4-14) and buildCtwaIntake import (line 2) are reused.**

```ts
  it("normalizes a bare SG 8-digit phone to +65 via the canonical normalizer", () => {
    const intake = buildCtwaIntake(makeMessage({ from: "91234567" }), {
      now: () => new Date("2026-04-26T00:00:00Z"),
    });
    expect(intake).not.toBeNull();
    expect(intake!.contact.phone).toBe("+6591234567");
    expect(intake!.idempotencyKey).toBe("+6591234567:ARxx_abc");
  });

  it("normalizes a 0-prefixed MY number to +60 when region 'MY' is threaded", () => {
    const intake = buildCtwaIntake(makeMessage({ from: "0123456789" }), {
      now: () => new Date("2026-04-26T00:00:00Z"),
      region: "MY",
    });
    expect(intake).not.toBeNull();
    expect(intake!.contact.phone).toBe("+60123456789");
  });
```

- [ ] **Step 2: Run the new tests and confirm they FAIL (region is not yet an accepted opt; a bare 0-prefixed number currently becomes the wrong `+0123456789`).**

Run: `pnpm --filter @switchboard/ad-optimizer exec vitest run src/lead-intake/ctwa-adapter.test.ts`
Expected: FAIL — the SG case still yields the old `+91234567` (current startsWith('+') logic) and/or the `region` opt is a TS error; the MY case fails.

- [ ] **Step 3: Update the builder. In packages/ad-optimizer/src/lead-intake/ctwa-adapter.ts: import normalizeToE164; add optional region to the builder opts; replace the startsWith('+') line (ctwa-adapter.ts:54) with a normalize-then-fallback. Keep the null-fallback so a non-SG bare number (region absent) still ingests with a + prefix rather than dropping the lead.**

```ts
import type { LeadIntake } from "@switchboard/schemas";
import { normalizeToE164 } from "@switchboard/schemas";
```

- [ ] **Step 4: Replace the phone normalization and opts type inside buildCtwaIntake. Change the opts signature to accept region, and replace line 54.**

```ts
export function buildCtwaIntake(
  msg: ParsedWhatsappMessage,
  opts: { now: () => Date; region?: "SG" | "MY" },
): LeadIntake | null {
  const stringOrUndefined = (v: unknown): string | undefined =>
    typeof v === "string" && v ? v : undefined;

  const ctwaClid = stringOrUndefined(msg.metadata["ctwaClid"]);
  if (!ctwaClid) return null;

  const normalizedPhone =
    normalizeToE164(msg.from, opts.region) ??
    (msg.from.startsWith("+") ? msg.from : `+${msg.from}`);
```

- [ ] **Step 5: Thread region through CtwaAdapterDeps and the ingest() call so the adapter passes its configured region into the builder. Update the deps interface (ctwa-adapter.ts:34-38) and the buildCtwaIntake call inside ingest (ctwa-adapter.ts:84).**

```ts
export interface CtwaAdapterDeps {
  ingress: IngressLike;
  now: () => Date;
  region?: "SG" | "MY";
  resolveCampaignId?: (adId: string) => Promise<string | null>;
}
```

- [ ] **Step 6: Update the ingest() body to pass region into buildCtwaIntake (replace the existing `const intake = buildCtwaIntake(msg, { now: this.deps.now });` at ctwa-adapter.ts:84).**

```ts
    const intake = buildCtwaIntake(msg, { now: this.deps.now, region: this.deps.region });
```

- [ ] **Step 7: Run the adapter tests and confirm they PASS (new cases green; all pre-existing cases still green).**

Run: `pnpm --filter @switchboard/ad-optimizer exec vitest run src/lead-intake/ctwa-adapter.test.ts`
Expected: PASS — SG 8-digit → +6591234567, MY 0-prefixed-with-region → +60123456789, and the existing + / bare-+ / campaign-resolver cases remain green.

- [ ] **Step 8: Confirm ad-optimizer still respects layering (must NOT import core) and typechecks.**

Run: `pnpm --filter @switchboard/ad-optimizer typecheck`
Expected: PASS — no type errors; the only new import is @switchboard/schemas (L1), so the L2 no-core rule holds.

- [ ] **Step 9: Commit.**

Run: `git add packages/ad-optimizer/src/lead-intake/ctwa-adapter.ts packages/ad-optimizer/src/lead-intake/ctwa-adapter.test.ts && git commit -m "feat(ad-optimizer): normalize ctwa phone via canonical e.164 with region"`
Expected: Commit succeeds.


#### Task 4: Task 4 — Use the canonical normalizer in the Instant Form adapter (L2)

**Files:**
- Modify: `packages/ad-optimizer/src/lead-intake/instant-form-adapter.ts`
- Modify: `packages/ad-optimizer/src/lead-intake/instant-form-adapter.test.ts`
- Test: `packages/ad-optimizer/src/lead-intake/instant-form-adapter.test.ts`

- [ ] **Step 1: Write the failing test FIRST. Read packages/ad-optimizer/src/lead-intake/instant-form-adapter.test.ts to match its makeLead/buildInstantFormIntake helpers, then append a case: a bare SG 8-digit phone field normalizes to +65, and an un-normalizable phone still yields a contact when email is present. Use the buildInstantFormIntake export (instant-form-adapter.ts:36).**

```ts
  it("normalizes a bare SG 8-digit phone field to +65 via the canonical normalizer", () => {
    const intake = buildInstantFormIntake(
      {
        leadgenId: "lg-1",
        organizationId: "o1",
        deploymentId: "d1",
        fieldData: [{ name: "phone_number", values: ["91234567"] }],
      },
      { now: () => new Date("2026-04-26T00:00:00Z") },
    );
    expect(intake).not.toBeNull();
    expect(intake!.contact.phone).toBe("+6591234567");
  });

  it("still ingests when phone is un-normalizable but an email is present", () => {
    const intake = buildInstantFormIntake(
      {
        leadgenId: "lg-2",
        organizationId: "o1",
        deploymentId: "d1",
        fieldData: [
          { name: "phone_number", values: ["not-a-phone"] },
          { name: "email", values: ["a@b.com"] },
        ],
      },
      { now: () => new Date("2026-04-26T00:00:00Z") },
    );
    expect(intake).not.toBeNull();
    expect(intake!.contact.email).toBe("a@b.com");
    expect(intake!.contact.phone).toBeUndefined();
  });
```

- [ ] **Step 2: Run and confirm FAIL (current normalizePhone helper at instant-form-adapter.ts:25-28 turns '91234567' into the wrong '+91234567', and 'not-a-phone' into '+not-a-phone' rather than dropping it).**

Run: `pnpm --filter @switchboard/ad-optimizer exec vitest run src/lead-intake/instant-form-adapter.test.ts`
Expected: FAIL — phone is '+91234567' not '+6591234567'; the un-normalizable case yields '+not-a-phone' instead of undefined.

- [ ] **Step 3: Replace the local normalizePhone helper with the canonical normalizer. In packages/ad-optimizer/src/lead-intake/instant-form-adapter.ts add the import and delete the old helper (instant-form-adapter.ts:25-28), routing through normalizeToE164 with an optional region from opts; when normalization returns null, drop the phone (so a bad phone never produces a junk contact identifier).**

```ts
import type { LeadIntake } from "@switchboard/schemas";
import { normalizeToE164 } from "@switchboard/schemas";
import type { IngressLike } from "./ctwa-adapter.js";
```

- [ ] **Step 4: Replace the normalizePhone helper (instant-form-adapter.ts:25-28) and update its use inside buildInstantFormIntake (instant-form-adapter.ts:41) to thread region from opts.**

```ts
const normalizePhone = (
  raw: string | undefined,
  region?: "SG" | "MY",
): string | undefined => normalizeToE164(raw, region) ?? undefined;
```

- [ ] **Step 5: Update the buildInstantFormIntake opts to accept region and pass it into normalizePhone (replace the `const phone = normalizePhone(fieldValue(lead, "phone_number"));` line at instant-form-adapter.ts:41 and the opts type at line 38).**

```ts
export function buildInstantFormIntake(
  lead: InstantFormLead,
  opts: { now: () => Date; region?: "SG" | "MY" },
): LeadIntake | null {
  const email = fieldValue(lead, "email");
  const phone = normalizePhone(fieldValue(lead, "phone_number"), opts.region);
  const name = fieldValue(lead, "full_name");
```

- [ ] **Step 6: Run the tests and confirm PASS (new cases green, existing cases green).**

Run: `pnpm --filter @switchboard/ad-optimizer exec vitest run src/lead-intake/instant-form-adapter.test.ts`
Expected: PASS — SG 8-digit → +6591234567; un-normalizable phone dropped (contact.phone undefined) while email-only ingest still works.

- [ ] **Step 7: Commit.**

Run: `git add packages/ad-optimizer/src/lead-intake/instant-form-adapter.ts packages/ad-optimizer/src/lead-intake/instant-form-adapter.test.ts && git commit -m "feat(ad-optimizer): normalize instant-form phone via canonical e.164"`
Expected: Commit succeeds.


#### Task 5: Task 5 — Normalize the wa_id in resolve-contact-identity (L3) — the load-bearing unification fix

**Files:**
- Modify: `packages/core/src/channel-gateway/resolve-contact-identity.ts`
- Modify: `packages/core/src/channel-gateway/resolve-contact-identity.test.ts`
- Modify: `packages/core/src/channel-gateway/channel-gateway.ts`
- Test: `packages/core/src/channel-gateway/resolve-contact-identity.test.ts`

- [ ] **Step 1: Write the failing regression test FIRST. Append to packages/core/src/channel-gateway/resolve-contact-identity.test.ts the load-bearing case: a BARE wa_id '6591234567' must call findByPhone with the NORMALIZED '+6591234567' (so it resolves the +-stored CTWA Contact) and must NOT create a second contact. Reuse the existing makeStore helper (resolve-contact-identity.test.ts:5-11).**

```ts
  it("normalizes a bare wa_id before lookup so it resolves an existing +-stored contact (no second contact)", async () => {
    const store = makeStore({
      findByPhone: vi.fn().mockResolvedValue({ id: "ctwa-contact-id" }),
    });
    const result = await resolveContactIdentity({
      channel: "whatsapp",
      sessionId: "6591234567",
      organizationId: "org-1",
      contactStore: store,
    });

    expect(store.findByPhone).toHaveBeenCalledWith("org-1", "+6591234567");
    expect(store.create).not.toHaveBeenCalled();
    expect(result).toEqual({
      contactId: "ctwa-contact-id",
      phone: "+6591234567",
      channel: "whatsapp",
    });
  });
```

- [ ] **Step 2: Run and confirm FAIL (today resolve-contact-identity.ts:21 uses the raw sessionId, so findByPhone is called with '6591234567', not '+6591234567').**

Run: `pnpm --filter @switchboard/core exec vitest run src/channel-gateway/resolve-contact-identity.test.ts`
Expected: FAIL — findByPhone was called with '6591234567' but expected '+6591234567'.

- [ ] **Step 3: Update resolve-contact-identity.ts: import normalizeToE164; add an optional region param; normalize the wa_id before lookup AND before create, falling back to the raw sessionId when normalization returns null (so a non-normalizable id still behaves as before). Replace the body of resolveContactIdentity (resolve-contact-identity.ts:9-36).**

```ts
import { normalizeToE164 } from "@switchboard/schemas";
import type { GatewayContactStore } from "./types.js";

export interface ResolvedContactIdentity {
  contactId: string | null;
  phone: string | null;
  channel: string;
}

export async function resolveContactIdentity(args: {
  channel: string;
  sessionId: string;
  organizationId: string;
  contactStore: GatewayContactStore;
  region?: "SG" | "MY";
}): Promise<ResolvedContactIdentity> {
  const { channel, sessionId, organizationId, contactStore, region } = args;

  if (channel !== "whatsapp") {
    return { contactId: null, phone: null, channel };
  }

  // Normalize the WhatsApp wa_id to canonical E.164 so a bare id resolves the
  // same Contact a +-stored CTWA lead created. Fall back to the raw id when the
  // number cannot be normalized without guessing a country (refuse-to-guess).
  const phone = normalizeToE164(sessionId, region) ?? sessionId;
  const existing = await contactStore.findByPhone(organizationId, phone);
  if (existing) {
    return { contactId: existing.id, phone, channel };
  }

  const created = await contactStore.create({
    organizationId,
    phone,
    primaryChannel: "whatsapp",
    source: "whatsapp_inbound",
    messagingOptIn: true,
    messagingOptInSource: "organic_inbound",
  });
  return { contactId: created.id, phone, channel };
}
```

- [ ] **Step 4: Pass region: undefined at the channel-gateway call site (DeploymentResolverResult carries no market today; channel-gateway.ts:218-223). This documents the refuse-to-guess default explicitly. Edit the resolveContactIdentity({...}) object at channel-gateway.ts to add the region line.**

```ts
      ? await resolveContactIdentity({
          channel: message.channel,
          sessionId: message.sessionId,
          organizationId: resolved.organizationId,
          contactStore: this.config.contactStore,
          region: undefined,
        })
```

- [ ] **Step 5: Run the resolve-contact-identity tests and confirm PASS (regression case green; the pre-existing '+6599999999' new-phone and existing-phone cases still green because a + number normalizes to itself).**

Run: `pnpm --filter @switchboard/core exec vitest run src/channel-gateway/resolve-contact-identity.test.ts`
Expected: PASS — bare-wa_id case resolves +6591234567 with no create; all prior cases green.

- [ ] **Step 6: Typecheck core to confirm the new schemas import and the optional region param compile within L3.**

Run: `pnpm --filter @switchboard/core typecheck`
Expected: PASS — no type errors.

- [ ] **Step 7: Commit.**

Run: `git add packages/core/src/channel-gateway/resolve-contact-identity.ts packages/core/src/channel-gateway/resolve-contact-identity.test.ts packages/core/src/channel-gateway/channel-gateway.ts && git commit -m "feat(core): normalize whatsapp wa_id to canonical e.164 before contact resolve"`
Expected: Commit succeeds.


#### Task 6: Task 6 — Contact.phoneE164 column + index + raw-SQL partial unique (schema + migration, same commit)

**Files:**
- Create: `packages/db/prisma/migrations/20260606000000_contact_phone_e164/migration.sql`
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add the column and the plain index to the Contact model in packages/db/prisma/schema.prisma. Insert phoneE164 right after the existing `phone String?` line (schema.prisma:1745).**

```ts
  phone                String?
  phoneE164            String?
```

- [ ] **Step 2: Add the index alongside the other Contact @@index lines (schema.prisma:1788-1795). Insert after the existing @@index([organizationId, phone]).**

```ts
  @@index([organizationId, phone])
  @@index([organizationId, phoneE164])
```

- [ ] **Step 3: Hand-write the migration SQL (prisma migrate dev needs a TTY — do not run it; mirror the raw partial-unique pattern in packages/db/prisma/migrations/20260603120000_booking_partial_unique_active/migration.sql). Create packages/db/prisma/migrations/20260606000000_contact_phone_e164/migration.sql.**

```ts
-- Spec-1A-1: canonical E.164 identity. Add the derived `phoneE164` column,
-- a lookup index, and a PARTIAL unique on (organizationId, phoneE164) that only
-- applies when phoneE164 IS NOT NULL (Prisma 6 cannot express a partial unique
-- in-schema; mirrors 20260603120000_booking_partial_unique_active).
ALTER TABLE "Contact" ADD COLUMN "phoneE164" TEXT;

CREATE INDEX "Contact_organizationId_phoneE164_idx"
  ON "Contact" ("organizationId", "phoneE164");

CREATE UNIQUE INDEX "Contact_org_phoneE164_unique"
  ON "Contact" ("organizationId", "phoneE164")
  WHERE "phoneE164" IS NOT NULL;
```

- [ ] **Step 4: Regenerate the Prisma client so TypeScript knows the phoneE164 field (db tests mock Prisma and need no live DB; this only updates the generated client types).**

Run: `pnpm db:generate`
Expected: PASS — Prisma client regenerates; the Contact delegate now accepts/returns phoneE164. No migration is applied (no DB needed).

- [ ] **Step 5: Confirm the schema change compiles by typechecking the db package (the store edits land in Task 7; this step just proves the generated client + schema are consistent).**

Run: `pnpm --filter @switchboard/db typecheck`
Expected: PASS — no type errors from the new column.

- [ ] **Step 6: Commit the schema and its migration TOGETHER (CLAUDE.md: schema change + migration in the same commit).**

Run: `git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260606000000_contact_phone_e164/migration.sql && git commit -m "feat(db): add contact phoneE164 column with index and partial unique"`
Expected: Commit succeeds; both schema.prisma and migration.sql are in the one commit.


#### Task 7: Task 7 — Derive + match phoneE164 in PrismaContactStore (create + findByPhone)

**Files:**
- Modify: `packages/db/src/stores/prisma-contact-store.ts`
- Modify: `packages/db/src/stores/__tests__/prisma-contact-store.test.ts`
- Test: `packages/db/src/stores/__tests__/prisma-contact-store.test.ts`

- [ ] **Step 1: Write the failing tests FIRST. Append to packages/db/src/stores/__tests__/prisma-contact-store.test.ts (which already mocks Prisma via makeMockPrisma at lines 7-18 and uses makeContact at 20-43): (a) create() writes a derived phoneE164; (b) findByPhone normalizes the input and queries the phoneE164 column; (c) an un-normalizable findByPhone falls back to a raw phone query; (d) mapRowToContact surfaces phoneE164.**

```ts
  describe("phoneE164 derivation", () => {
    it("create derives and persists phoneE164 from the input phone", async () => {
      prisma.contact.create.mockResolvedValue(makeContact({ phone: "+6591234567" }));
      await store.create({
        organizationId: "org-1",
        phone: "+6591234567",
        primaryChannel: "whatsapp",
      });
      expect(prisma.contact.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ phoneE164: "+6591234567" }),
      });
    });

    it("create derives +65 for a bare SG 8-digit phone", async () => {
      prisma.contact.create.mockResolvedValue(makeContact({ phone: "91234567" }));
      await store.create({
        organizationId: "org-1",
        phone: "91234567",
        primaryChannel: "whatsapp",
      });
      expect(prisma.contact.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ phoneE164: "+6591234567" }),
      });
    });

    it("create writes phoneE164: null when the phone cannot be normalized", async () => {
      prisma.contact.create.mockResolvedValue(makeContact({ phone: "not-a-phone" }));
      await store.create({
        organizationId: "org-1",
        phone: "not-a-phone",
        primaryChannel: "whatsapp",
      });
      expect(prisma.contact.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ phoneE164: null }),
      });
    });

    it("findByPhone normalizes the input and queries the phoneE164 column", async () => {
      await store.findByPhone("org-1", "+65 9123 4567");
      expect(prisma.contact.findFirst).toHaveBeenCalledWith({
        where: { organizationId: "org-1", phoneE164: "+6591234567" },
      });
    });

    it("findByPhone falls back to a raw phone match when the input cannot be normalized", async () => {
      await store.findByPhone("org-1", "telegram-handle");
      expect(prisma.contact.findFirst).toHaveBeenCalledWith({
        where: { organizationId: "org-1", phone: "telegram-handle" },
      });
    });

    it("mapRowToContact surfaces phoneE164", async () => {
      prisma.contact.findFirst.mockResolvedValue(makeContact({ phoneE164: "+6591234567" }));
      const result = await store.findById("org-1", "contact-1");
      expect(result!.phoneE164).toBe("+6591234567");
    });
  });
```

- [ ] **Step 2: Add phoneE164 to the makeContact factory default so the new mapRow assertion and existing factory consumers stay consistent. Edit the makeContact return object (prisma-contact-store.test.ts:20-43) to include phoneE164 next to phone.**

```ts
    phone: "+6591234567",
    phoneE164: "+6591234567",
```

- [ ] **Step 3: Run the tests and confirm FAIL (create does not yet set phoneE164; findByPhone still queries the raw `phone` column; mapRowToContact does not return phoneE164).**

Run: `pnpm --filter @switchboard/db exec vitest run src/stores/__tests__/prisma-contact-store.test.ts`
Expected: FAIL — create data lacks phoneE164; findByPhone where-clause uses `phone` not `phoneE164`; result.phoneE164 is undefined.

- [ ] **Step 4: Implement in packages/db/src/stores/prisma-contact-store.ts. Add the import (top of file, next to the existing @switchboard/schemas import at line 4-9).**

```ts
import { normalizeToE164 } from "@switchboard/schemas";
```

- [ ] **Step 5: In create() (prisma-contact-store.ts:85-114), derive phoneE164 and add it to the create data. Insert the derivation after `const messagingOptIn = ...` (line 88) and add the field to the data object next to `phone:` (line 95).**

```ts
    const messagingOptIn = input.messagingOptIn ?? false;
    const phoneE164 = normalizeToE164(input.phone ?? null);
```

- [ ] **Step 6: Add the phoneE164 field to the create data object (insert directly after the `phone: input.phone ?? null,` line at prisma-contact-store.ts:95).**

```ts
        phone: input.phone ?? null,
        phoneE164,
```

- [ ] **Step 7: Rewrite findByPhone (prisma-contact-store.ts:128-138) to normalize the input and match on the phoneE164 column, falling back to a raw-phone exact match when normalization returns null.**

```ts
  async findByPhone(orgId: string, phone: string): Promise<Contact | null> {
    const e164 = normalizeToE164(phone);
    const row = await this.prisma.contact.findFirst({
      where: e164
        ? { organizationId: orgId, phoneE164: e164 }
        : { organizationId: orgId, phone },
    });

    if (!row) return null;
    return mapRowToContact(row);
  }
```

- [ ] **Step 8: Add phoneE164 to mapRowToContact: extend the row param type (prisma-contact-store.ts:380-400) with `phoneE164?: string | null;` next to `phone`, and add it to the returned object (prisma-contact-store.ts:401-421) next to `phone`.**

```ts
  phone: string | null;
  phoneE164?: string | null;
```

- [ ] **Step 9: Add phoneE164 to the mapRowToContact return object (insert after the `phone: row.phone,` line in the return at prisma-contact-store.ts:404).**

```ts
    phone: row.phone,
    phoneE164: row.phoneE164 ?? null,
```

- [ ] **Step 10: Run the tests and confirm PASS (new phoneE164 cases green; all pre-existing PrismaContactStore tests still green — note findByPhone's old test at lines 223-244 asserts a `+65...` number, which now normalizes to itself and queries phoneE164; update that pre-existing assertion in the same file to expect the phoneE164 where-clause).**

```ts
  describe("findByPhone", () => {
    it("returns null when no contact with phone exists", async () => {
      const result = await store.findByPhone("org-1", "+6599999999");

      expect(result).toBeNull();
      expect(prisma.contact.findFirst).toHaveBeenCalledWith({
        where: { organizationId: "org-1", phoneE164: "+6599999999" },
      });
    });
```

- [ ] **Step 11: Re-run the full PrismaContactStore test file and confirm PASS (including the updated pre-existing findByPhone assertion).**

Run: `pnpm --filter @switchboard/db exec vitest run src/stores/__tests__/prisma-contact-store.test.ts`
Expected: PASS — all PrismaContactStore tests green, including phoneE164 derivation, normalized findByPhone, raw fallback, and mapRow surfacing.

- [ ] **Step 12: Commit.**

Run: `git add packages/db/src/stores/prisma-contact-store.ts packages/db/src/stores/__tests__/prisma-contact-store.test.ts && git commit -m "feat(db): derive phoneE164 on contact create and match it in findByPhone"`
Expected: Commit succeeds.


#### Task 8: Task 8 — Derive phoneE164 in PrismaLeadIntakeStore.upsertContact (CTWA write path)

**Files:**
- Create: `packages/db/src/stores/__tests__/prisma-lead-intake-store-phone.test.ts`
- Modify: `packages/db/src/stores/lead-intake-store.ts`
- Test: `packages/db/src/stores/__tests__/prisma-lead-intake-store-phone.test.ts`

- [ ] **Step 1: Write the failing test FIRST. The existing lead-intake-store.test.ts (packages/db/src/stores/__tests__/lead-intake-store.test.ts:13) is DATABASE_URL-gated integration; add a NEW co-located mocked-Prisma unit test so CI (no Postgres) exercises the derivation. Mirror the mock style of prisma-contact-store.test.ts (vi.fn upsert). Create packages/db/src/stores/__tests__/prisma-lead-intake-store-phone.test.ts.**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaLeadIntakeStore } from "../lead-intake-store.js";

function makeMockPrisma() {
  return {
    contact: {
      upsert: vi.fn().mockResolvedValue({ id: "contact-1" }),
    },
    activityLog: {
      create: vi.fn().mockResolvedValue({ id: "activity-1" }),
    },
  };
}

describe("PrismaLeadIntakeStore.upsertContact phoneE164", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let store: PrismaLeadIntakeStore;

  beforeEach(() => {
    prisma = makeMockPrisma();
    store = new PrismaLeadIntakeStore(prisma as never);
  });

  it("derives phoneE164 into the create branch and leaves the update branch untouched", async () => {
    await store.upsertContact({
      organizationId: "org-1",
      deploymentId: "dep-1",
      phone: "+6591234567",
      sourceType: "ctwa",
      attribution: { ctwa_clid: "abc" },
      idempotencyKey: "+6591234567:abc",
    });

    const call = prisma.contact.upsert.mock.calls[0]![0] as {
      create: { phoneE164: string | null };
      update: Record<string, unknown>;
    };
    expect(call.create.phoneE164).toBe("+6591234567");
    expect(call.update).not.toHaveProperty("phoneE164");
  });

  it("derives +65 for a bare SG 8-digit phone", async () => {
    await store.upsertContact({
      organizationId: "org-1",
      deploymentId: "dep-1",
      phone: "91234567",
      sourceType: "ctwa",
      attribution: {},
      idempotencyKey: "k1",
    });
    const call = prisma.contact.upsert.mock.calls[0]![0] as {
      create: { phoneE164: string | null };
    };
    expect(call.create.phoneE164).toBe("+6591234567");
  });

  it("writes phoneE164: null when the phone cannot be normalized", async () => {
    await store.upsertContact({
      organizationId: "org-1",
      deploymentId: "dep-1",
      phone: undefined,
      sourceType: "instant_form",
      attribution: {},
      idempotencyKey: "k2",
    });
    const call = prisma.contact.upsert.mock.calls[0]![0] as {
      create: { phoneE164: string | null };
    };
    expect(call.create.phoneE164).toBeNull();
  });
});

```

- [ ] **Step 2: Run and confirm FAIL (upsert create data has no phoneE164 today).**

Run: `pnpm --filter @switchboard/db exec vitest run src/stores/__tests__/prisma-lead-intake-store-phone.test.ts`
Expected: FAIL — call.create.phoneE164 is undefined (expected '+6591234567' / null).

- [ ] **Step 3: Implement in packages/db/src/stores/lead-intake-store.ts. Add the import at the top of the file (next to the existing imports at lines 1-2).**

```ts
import type { LeadIntakeStore } from "@switchboard/core";
import { normalizeToE164 } from "@switchboard/schemas";
import type { PrismaDbClient } from "../prisma-db.js";
```

- [ ] **Step 4: Derive phoneE164 in upsertContact and add it to the create branch only (leave the no-op update branch untouched). Insert the derivation after `const messagingOptIn = ...` (lead-intake-store.ts:72) and add the field to the create object next to `phone:` (lead-intake-store.ts:83).**

```ts
    const messagingOptIn = input.messagingOptIn ?? false;
    const phoneE164 = normalizeToE164(input.phone ?? null);
```

- [ ] **Step 5: Add phoneE164 to the upsert create object (insert directly after the `phone: input.phone ?? null,` line at lead-intake-store.ts:83).**

```ts
        phone: input.phone ?? null,
        phoneE164,
```

- [ ] **Step 6: Run the new test and confirm PASS.**

Run: `pnpm --filter @switchboard/db exec vitest run src/stores/__tests__/prisma-lead-intake-store-phone.test.ts`
Expected: PASS — create.phoneE164 derived (+6591234567 / null); update branch has no phoneE164 key.

- [ ] **Step 7: Commit.**

Run: `git add packages/db/src/stores/lead-intake-store.ts packages/db/src/stores/__tests__/prisma-lead-intake-store-phone.test.ts && git commit -m "feat(db): derive phoneE164 on lead-intake upsert create branch"`
Expected: Commit succeeds.


#### Task 9: Task 9 — Full-suite verification + typecheck across all touched layers

**Files:**
- Test: `packages/schemas/src/phone.test.ts`
- Test: `packages/ad-optimizer/src/lead-intake/ctwa-adapter.test.ts`
- Test: `packages/ad-optimizer/src/lead-intake/instant-form-adapter.test.ts`
- Test: `packages/core/src/channel-gateway/resolve-contact-identity.test.ts`
- Test: `packages/db/src/stores/__tests__/prisma-contact-store.test.ts`
- Test: `packages/db/src/stores/__tests__/prisma-lead-intake-store-phone.test.ts`

- [ ] **Step 1: Run the schemas + ad-optimizer + core + db package test suites together to catch any regression the per-file runs missed (e.g. a consumer of buildCtwaIntake/buildInstantFormIntake/resolveContactIdentity whose opts signature changed).**

Run: `pnpm --filter @switchboard/schemas --filter @switchboard/ad-optimizer --filter @switchboard/core --filter @switchboard/db test`
Expected: PASS — all four package suites green. (If a pre-existing caller of buildCtwaIntake/buildInstantFormIntake passes opts without region, it still compiles because region is optional.)

- [ ] **Step 2: Typecheck the whole workspace (per CLAUDE.md, run before any push; if it reports missing @switchboard/schemas exports run `pnpm reset` first, then re-run — stale lower-layer dist artifacts cause false alarms).**

Run: `pnpm typecheck`
Expected: PASS — no type errors across schemas, ad-optimizer, core, db, and apps (apps pick up the new optional params transparently).

- [ ] **Step 3: Run lint + prettier check (CI lint runs prettier; local lint does not — memory gotcha) so the PR is format-clean.**

Run: `pnpm lint && pnpm format:check`
Expected: PASS — no lint errors; prettier reports all touched files already formatted.

- [ ] **Step 4: Confirm the branch context matches the work before finishing (CLAUDE.md: verify branch before commit), then push.**

Run: `git branch --show-current && git status --short`
Expected: On the 1A-1 implementation branch (NOT main); working tree clean (all changes committed across Tasks 1-8).


---

## 1A-2 — Weld booking → WorkTrace → ConversionRecord (chain spine)

**Goal:** Make the revenue chain queryable in one SQL join. (a) Pass workTraceId from the trusted skill context into the booking row at booking.create. (b) Add lineage columns WorkTrace.contactId + WorkTrace.conversationThreadId (both added to EXCLUDED_BASE in the SAME commit so the content hash is byte-identical — no hashInputVersion bump), thread them request→WorkUnit→WorkTrace at submit, and persist/read them in the Prisma store. (c) Verify the already-wired ConversionRecord.bookingId stamping (no new code). (d) Re-key the gateway conversation thread off the resolver-provided contactId/org instead of the literal 'visitor-'+sessionId / 'gateway', keeping the literal ONLY as the in-resolver fallback for a session with no resolvable contact. DEPENDS ON 1A-1 (which makes resolveContactIdentity.findByPhone canonical-E.164). Verified file:line — calendar-book.ts:259 (booking create missing workTraceId), calendar-book.ts:342 (eventId), BookingStoreSubset.create declares workTraceId?:string|null at calendar-book.ts:29, prisma-booking-store.ts:62 already persists workTraceId, skill-request-context.ts:14-17 + types.ts:414 (ctx.workUnitId), work-trace-hash.ts:13-23 EXCLUDED_BASE (precedent injectedPatternIds:22), work-trace.ts:6-96 WorkTrace type, schema.prisma:1908-1976 WorkTrace model + indexes, prisma-work-trace-store.ts:233-285 buildWorkTraceCreateData + 418-485 mapRowToTrace, canonical-request.ts:20-33 CanonicalSubmitRequest, work-unit.ts:11-48 WorkUnit + normalizeWorkUnit, work-trace-recorder.ts:87-119/143-170 buildWorkTrace/buildClaimTrace, channel-gateway.ts:154-158 (inactive path) + 190-194 (main call) + 216-224 (resolveContactIdentity already wired), gateway-conversation-store.ts:23-24 (literals), prisma-conversion-record-store.ts:50-51/65 (bookingId ALREADY extracted from metadata) with existing test prisma-conversion-record-store.test.ts:44, calendar-book.ts:370 (OutboxEvent payload metadata.bookingId ALREADY set).

**File structure:**

| Action | Path | Responsibility |
|---|---|---|
| modify | `/Users/jasonli/switchboard/packages/core/src/skill-runtime/tools/calendar-book.ts` | Part (a): pass workTraceId: ctx.workUnitId ?? null into the bookingStore.create(...) call (line 259) so the booking row records the WorkTrace that produced it. The create-input type already declares workTraceId (line 29). |
| modify | `/Users/jasonli/switchboard/packages/core/src/skill-runtime/tools/calendar-book.test.ts` | Part (a) test: assert booking.create is invoked with workTraceId equal to ctx.workUnitId; assert it is null when ctx.workUnitId is absent. |
| modify | `/Users/jasonli/switchboard/packages/core/src/platform/work-trace.ts` | Part (b): add optional lineage fields contactId?: string and conversationThreadId?: string to the WorkTrace interface (index/lineage columns, not execution inputs). |
| modify | `/Users/jasonli/switchboard/packages/core/src/platform/work-trace-hash.ts` | Part (b): add 'contactId' and 'conversationThreadId' to EXCLUDED_BASE (line 13-23) so they are omitted from the canonical hash input — content hash stays byte-identical with/without the columns. No hashInputVersion bump (precedent injectedPatternIds). |
| modify | `/Users/jasonli/switchboard/packages/core/src/platform/__tests__/work-trace-hash.test.ts` | Part (b) tests: (1) changing top-level WorkTrace.contactId / conversationThreadId does NOT change the hash (mirror injectedPatternIds test at line 71-75); (2) a trace WITH the columns hashes identical to the same trace WITHOUT them; (3) changing parameters.contactId (trusted bag) DOES change the hash; (4) update V2 excluded-set length assertion from 5 to 7 (line 68) and add the two names to the arrayContaining check at line 57-66. |
| modify | `/Users/jasonli/switchboard/packages/core/src/platform/canonical-request.ts` | Part (b): add optional contactId?: string and conversationThreadId?: string to CanonicalSubmitRequest so callers (gateway/api) can supply resolved lineage at submit. |
| modify | `/Users/jasonli/switchboard/packages/core/src/platform/work-unit.ts` | Part (b): add contactId?: string and conversationThreadId?: string to WorkUnit; copy them from the request in normalizeWorkUnit. |
| modify | `/Users/jasonli/switchboard/packages/core/src/platform/__tests__/work-unit.test.ts` | Part (b) test: normalizeWorkUnit carries contactId + conversationThreadId from the request onto the WorkUnit; both undefined when absent. |
| modify | `/Users/jasonli/switchboard/packages/core/src/platform/work-trace-recorder.ts` | Part (b): map workUnit.contactId / workUnit.conversationThreadId onto the returned WorkTrace in both buildWorkTrace and buildClaimTrace. |
| modify | `/Users/jasonli/switchboard/packages/core/src/platform/__tests__/work-trace-recorder.test.ts` | Part (b) test: buildWorkTrace and buildClaimTrace copy contactId + conversationThreadId from the WorkUnit onto the WorkTrace. |
| modify | `/Users/jasonli/switchboard/packages/db/prisma/schema.prisma` | Part (b): add contactId String? and conversationThreadId String? to model WorkTrace (after injectedPatternIds, before Timestamps block, ~line 1958) plus @@index([organizationId, contactId]) and @@index([organizationId, conversationThreadId]) (in the index block ~line 1971-1975). |
| create | `/Users/jasonli/switchboard/packages/db/prisma/migrations/20260606120000_worktrace_lineage_columns/migration.sql` | Part (b): hand-authored SQL ALTER TABLE "WorkTrace" ADD COLUMN "contactId" TEXT, ADD COLUMN "conversationThreadId" TEXT; CREATE INDEX for (organizationId, contactId) and (organizationId, conversationThreadId). Mirrors 20260604200000_recommendation_outcome_enrichment column-add format. Same commit as schema + EXCLUDED_BASE change. |
| modify | `/Users/jasonli/switchboard/packages/db/src/stores/prisma-work-trace-store.ts` | Part (b): in buildWorkTraceCreateData (line 233-285) write contactId: trace.contactId ?? null and conversationThreadId: trace.conversationThreadId ?? null; in mapRowToTrace (line 418-485) read row.contactId ?? undefined and row.conversationThreadId ?? undefined. |
| modify | `/Users/jasonli/switchboard/packages/db/src/stores/__tests__/prisma-work-trace-store.test.ts` | Part (b) test: persist() forwards contactId + conversationThreadId into workTrace.create data; a round-trip (persist data shape → mapRowToTrace) preserves both. If no such test file exists, create it mirroring prisma-workflow-store.test.ts mock-Prisma factory. |
| modify | `/Users/jasonli/switchboard/packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts` | Part (c) VERIFY-ONLY: no edit needed if green; this file already asserts bookingId is extracted from metadata (line 44). Listed so the executor runs it as the (c) proof. |
| modify | `/Users/jasonli/switchboard/packages/core/src/channel-gateway/types.ts` | Part (d): extend GatewayConversationStore.getOrCreateBySession (line 181-189) with an optional 4th param identity?: { organizationId: string; contactId: string | null } so the gateway can pass the resolver-provided lineage to the thread key. |
| modify | `/Users/jasonli/switchboard/apps/chat/src/gateway/gateway-conversation-store.ts` | Part (d): accept the optional identity param; key the thread off identity.contactId / identity.organizationId when present, falling back to the literal contactId='visitor-'+sessionId and orgId='gateway' ONLY when no resolvable contact (identity absent or contactId null). |
| modify | `/Users/jasonli/switchboard/packages/core/src/channel-gateway/channel-gateway.ts` | Part (d): hoist the resolveContactIdentity call (currently at line 216-224, step 4c) to BEFORE the main getOrCreateBySession call (line 190-194, step 3); pass { organizationId: resolved.organizationId, contactId: identity.contactId } into getOrCreateBySession. The inactive-deployment call (line 154-158) passes no identity (legitimate fallback — no org/contact resolved there). |
| modify | `/Users/jasonli/switchboard/apps/chat/src/gateway/__tests__/gateway-conversation-store.test.ts` | Part (d) test: getOrCreateBySession keys the thread off identity.contactId/organizationId when provided, and falls back to visitor-/gateway literals when identity is absent or contactId is null. Create the test file if it does not yet exist, mirroring the apps/chat mock-Prisma pattern. |

**Notes:** CRITICAL — part (c) IS ALREADY IMPLEMENTED on main (audit-blockers-already-done gotcha). calendar-book.ts:370 stamps metadata.bookingId on the booked OutboxEvent payload; prisma-conversion-record-store.ts:50-51,65 extracts metadata.bookingId into the indexed bookingId column; prisma-conversion-record-store.test.ts:44 already asserts it. Task 4 is VERIFY-ONLY (run the existing test, confirm green). Do NOT write redundant code for (c).

CONTENT-HASH INVARIANCE is the load-bearing invariant of this PR. buildWorkTraceHashInput (work-trace-hash.ts:67-82) iterates Object.entries(trace) and includes every key not in the excluded set. Adding contactId/conversationThreadId to the WorkTrace type WITHOUT adding them to EXCLUDED_BASE would silently change the contentHash of every new row vs every pre-migration row and break integrity verification. Therefore the type change (Task 2) and the EXCLUDED_BASE change (Task 3) MUST land in the same commit, and Task 3's failing test is what proves invariance. No hashInputVersion bump (precedent injectedPatternIds at work-trace-hash.ts:22 — same EXCLUDED_BASE treatment, no version bump).

TRUSTED-BAG vs LINEAGE distinction (pinned by Task 3 tests): parameters (a hashed top-level WorkTrace field) carries the trusted execution bag including parameters.contactId — changing it MUST change the hash (it is the executed input). The NEW top-level WorkTrace.contactId is a LINEAGE/index column (EXCLUDED_BASE) — changing it MUST NOT change the hash. Both tests are mandatory.

R3 (E.164 refuse-to-guess), R1/R2 (receipt tiers/Noop), R4 (seed origin), R5 (attributionBasis) are NOT in this PR's surface — they belong to 1A-1/1A-3/1A-4/1A-5/1A-6. This PR touches only the chain weld + lineage columns + gateway thread key.

Migrations are hand-authored SQL (prisma migrate dev needs TTY — gotcha). Mirror the column-add+index format of 20260604200000_recommendation_outcome_enrichment; no partial-unique needed here (plain nullable columns + plain indexes). Schema change + migration in the SAME commit (CLAUDE.md). Run pnpm db:check-drift before committing if Postgres is available; CI validates the migration.

DB tests MOCK Prisma (CI has no Postgres) — mirror prisma-workflow-store.test.ts / prisma-booking-store.test.ts mock-factory pattern. vitest single-file: pnpm --filter <pkg> test <path-substring> (vitest run forwards the substring as an include filter; config include is src/**/*.test.ts).

Layering: all (a)/(b) code is in core (L3) + db (L4); (d) interface in core (L3), impl in apps/chat (L5). No ad-optimizer involvement, no new cross-layer imports. WorkTrace is exported from @switchboard/core/platform (platform/index.ts:41); the db store already imports WorkTrace from there.

DEPENDENCY on 1A-1: Task 5 (gateway re-key) relies on resolveContactIdentity (packages/core/src/channel-gateway/resolve-contact-identity.ts) being canonical-E.164 aware. That resolver already EXISTS and is already wired into ChannelGateway at channel-gateway.ts:216-224; 1A-1 only upgrades its findByPhone. This PR does NOT modify the resolver — it threads the resolver's output into the conversation store. If 1A-1 has not landed, the re-key still functions (it just keys off whatever contactId the pre-1A-1 resolver returns); the canonical-merge correctness is 1A-1's responsibility.

GATEWAY signature change ripples to core test mocks (channel-gateway-approval.test.ts:17/94/122/148/177, channel-gateway-opt-out.test.ts:41, runtime-first-response.test.ts:307) — they use vi.fn().mockResolvedValue(...) which ignore extra args, so they keep compiling. The only REAL caller is ChannelGateway (channel-gateway.ts:154 inactive path + :190 main path); both are updated in Task 5.

#### Task 1: Task 1 — Part (a): pass workTraceId from trusted context into the booking row

**Files:**
- Modify: `/Users/jasonli/switchboard/packages/core/src/skill-runtime/tools/calendar-book.ts`
- Modify: `/Users/jasonli/switchboard/packages/core/src/skill-runtime/tools/calendar-book.test.ts`
- Test: `/Users/jasonli/switchboard/packages/core/src/skill-runtime/tools/calendar-book.test.ts`

- [ ] **Step 1: Add a FAILING test asserting booking.create receives workTraceId from ctx.workUnitId. Open packages/core/src/skill-runtime/tools/calendar-book.test.ts and insert this test right after the existing test at line 435 (the 'uses ctx.contactId' test). It builds the tool with a ctx carrying workUnitId and asserts the store create call includes it.**

```ts
  it("booking.create passes ctx.workUnitId as workTraceId on the booking row", async () => {
    const toolWithWu = factory({ ...TRUSTED_CTX, contactId: "ct_1", workUnitId: "wu_book_1" });
    bookingStore.create.mockResolvedValue({ id: "bk_1" });
    opportunityStore.findActiveByContact.mockResolvedValue({ id: "opp_1" });
    calendarProvider.createBooking.mockResolvedValue({ calendarEventId: "gcal_1" });
    await toolWithWu.operations["booking.create"]!.execute({
      service: "botox",
      slotStart: "2026-06-01T10:00:00Z",
      slotEnd: "2026-06-01T10:30:00Z",
      calendarId: "primary",
    });
    expect(bookingStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ workTraceId: "wu_book_1" }),
    );
  });

  it("booking.create passes workTraceId null when ctx.workUnitId is absent", async () => {
    bookingStore.create.mockResolvedValue({ id: "bk_1" });
    opportunityStore.findActiveByContact.mockResolvedValue({ id: "opp_1" });
    calendarProvider.createBooking.mockResolvedValue({ calendarEventId: "gcal_1" });
    await tool.operations["booking.create"]!.execute({
      service: "botox",
      slotStart: "2026-06-01T10:00:00Z",
      slotEnd: "2026-06-01T10:30:00Z",
      calendarId: "primary",
    });
    expect(bookingStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ workTraceId: null }),
    );
  });
```

- [ ] **Step 2: Run the new tests and confirm they FAIL (the create call does not yet include workTraceId, so objectContaining({ workTraceId: ... }) does not match).**

Run: `pnpm --filter @switchboard/core test calendar-book`
Expected: FAIL — both new assertions report the booking.create call was made without a workTraceId property (received object omits workTraceId).

- [ ] **Step 3: Implement the minimal change: add workTraceId to the bookingStore.create(...) object literal in calendar-book.ts (the call beginning at line 259). The create-input type already declares workTraceId?: string | null (line 29), so no type change is needed. Add it as the last property after attendeeEmail.**

```ts
            booking = await deps.bookingStore.create({
              organizationId: orgId,
              contactId,
              opportunityId,
              service: input.service,
              startsAt: new Date(input.slotStart),
              endsAt: new Date(input.slotEnd),
              attendeeName,
              attendeeEmail,
              workTraceId: ctx.workUnitId ?? null,
            });
```

- [ ] **Step 4: Re-run the tests and confirm they PASS, and that the existing booking.create tests (which use objectContaining and do not assert workTraceId) still pass.**

Run: `pnpm --filter @switchboard/core test calendar-book`
Expected: PASS — all calendar-book tests green, including the two new workTraceId assertions.

- [ ] **Step 5: Commit part (a).**

Run: `git add packages/core/src/skill-runtime/tools/calendar-book.ts packages/core/src/skill-runtime/tools/calendar-book.test.ts && git commit -m "feat(core): pass workTraceId from skill context into booking row"`
Expected: Commit created on the implementation branch (lowercase conventional-commit subject).


#### Task 2: Task 2 — Part (b): add lineage fields to the WorkTrace type

**Files:**
- Modify: `/Users/jasonli/switchboard/packages/core/src/platform/work-trace.ts`

- [ ] **Step 1: Add the two optional lineage fields to the WorkTrace interface in packages/core/src/platform/work-trace.ts. Place them immediately after the injectedPatternIds field (the last field, ending at line 95, before the closing brace at line 96). These are index/lineage columns — NOT execution inputs.**

```ts
  /**
   * Lineage column (Spec-1A chain weld): the Contact this work unit acted on.
   * In EXCLUDED_BASE (work-trace-hash.ts) — an index/lineage field, never part
   * of trace integrity (it is downstream-derivable from parameters, never the
   * executed input). Populated at submit from the resolved contact identity.
   */
  contactId?: string;
  /**
   * Lineage column (Spec-1A chain weld): the ConversationThread this work unit
   * ran inside. In EXCLUDED_BASE — index/lineage only, never hashed. Populated
   * at submit from the server-resolved thread id.
   */
  conversationThreadId?: string;
```

- [ ] **Step 2: Confirm the package still type-checks with the new fields (no consumer requires them yet because they are optional). This is a type-only step with no test of its own — the invariance proof lands in Task 3.**

Run: `pnpm --filter @switchboard/core typecheck`
Expected: PASS — no type errors; the two optional fields compile.

- [ ] **Step 3: Do NOT commit yet. Task 2 (type) and Task 3 (EXCLUDED_BASE) MUST land in the same commit so the content hash never changes. Proceed to Task 3.**

Run: `git status --short`
Expected: work-trace.ts shown as modified and staged-or-unstaged; no commit yet.


#### Task 3: Task 3 — Part (b): exclude the lineage columns from the content hash (invariance + bag-vs-lineage proof)

**Files:**
- Modify: `/Users/jasonli/switchboard/packages/core/src/platform/work-trace-hash.ts`
- Modify: `/Users/jasonli/switchboard/packages/core/src/platform/__tests__/work-trace-hash.test.ts`
- Test: `/Users/jasonli/switchboard/packages/core/src/platform/__tests__/work-trace-hash.test.ts`

- [ ] **Step 1: Add FAILING tests that pin (1) content-hash invariance for the two new columns, (2) a trace with the columns hashes identical to one without, (3) the trusted-bag-vs-lineage distinction: changing parameters.contactId (hashed) changes the hash but changing top-level WorkTrace.contactId (excluded) does not. Insert these inside the existing 'work-trace-hash' describe block in packages/core/src/platform/__tests__/work-trace-hash.test.ts, right after the injectedPatternIds exclusion test (line 71-75).**

```ts
  it("changing WorkTrace.contactId does not change the hash (lineage column — excluded)", () => {
    const a = baseTrace({ contactId: "ct_a" });
    const b = baseTrace({ contactId: "ct_b" });
    expect(computeWorkTraceContentHash(a, 1)).toBe(computeWorkTraceContentHash(b, 1));
  });

  it("changing WorkTrace.conversationThreadId does not change the hash (lineage column — excluded)", () => {
    const a = baseTrace({ conversationThreadId: "thr_a" });
    const b = baseTrace({ conversationThreadId: "thr_b" });
    expect(computeWorkTraceContentHash(a, 1)).toBe(computeWorkTraceContentHash(b, 1));
  });

  it("a trace WITH the lineage columns hashes identical to the same trace WITHOUT them", () => {
    const without = baseTrace();
    const with_ = baseTrace({ contactId: "ct_1", conversationThreadId: "thr_1" });
    expect(computeWorkTraceContentHash(with_, 1)).toBe(computeWorkTraceContentHash(without, 1));
  });

  it("changing parameters.contactId (trusted execution bag) DOES change the hash", () => {
    const a = baseTrace({ parameters: { contactId: "ct_a" } });
    const b = baseTrace({ parameters: { contactId: "ct_b" } });
    expect(computeWorkTraceContentHash(a, 1)).not.toBe(computeWorkTraceContentHash(b, 1));
  });

  it("lineage column differs but trusted-bag contactId equal → hash unchanged", () => {
    const a = baseTrace({ contactId: "lineage_a", parameters: { contactId: "ct_same" } });
    const b = baseTrace({ contactId: "lineage_b", parameters: { contactId: "ct_same" } });
    expect(computeWorkTraceContentHash(a, 1)).toBe(computeWorkTraceContentHash(b, 1));
  });
```

- [ ] **Step 2: Also update the existing V2-excluded-set assertion so it expects the two new names and the new length. Edit the test at line 57-69 ('v2 excluded set excludes ...'): add "contactId" and "conversationThreadId" to the arrayContaining list and change the length assertion from 5 to 7.**

```ts
  it("v2 excluded set excludes contentHash, traceVersion, lockedAt, hashInputVersion, injectedPatternIds, contactId, conversationThreadId (NOT ingressPath)", () => {
    expect(WORK_TRACE_HASH_EXCLUDED_FIELDS_V2).toEqual(
      expect.arrayContaining([
        "contentHash",
        "traceVersion",
        "lockedAt",
        "hashInputVersion",
        "injectedPatternIds",
        "contactId",
        "conversationThreadId",
      ]),
    );
    expect(WORK_TRACE_HASH_EXCLUDED_FIELDS_V2).not.toContain("ingressPath");
    expect(WORK_TRACE_HASH_EXCLUDED_FIELDS_V2.length).toBe(7);
  });
```

- [ ] **Step 3: Update the V1-excluded-set length too: the V1 set is EXCLUDED_BASE plus ingressPath + hashInputVersion, so it grows from 6 to 8. Edit the test at line 43-55: add the two names to the arrayContaining list and change length from 6 to 8.**

```ts
  it("v1 excluded set excludes contentHash, traceVersion, lockedAt, ingressPath, hashInputVersion, injectedPatternIds, contactId, conversationThreadId", () => {
    expect(WORK_TRACE_HASH_EXCLUDED_FIELDS_V1).toEqual(
      expect.arrayContaining([
        "contentHash",
        "traceVersion",
        "lockedAt",
        "ingressPath",
        "hashInputVersion",
        "injectedPatternIds",
        "contactId",
        "conversationThreadId",
      ]),
    );
    expect(WORK_TRACE_HASH_EXCLUDED_FIELDS_V1.length).toBe(8);
  });
```

- [ ] **Step 4: Run the hash tests and confirm they FAIL. The invariance/bag tests fail because contactId/conversationThreadId are currently INCLUDED in the hash input (not yet in EXCLUDED_BASE), so changing them changes the hash; the length assertions fail at 5/6.**

Run: `pnpm --filter @switchboard/core test work-trace-hash`
Expected: FAIL — 'changing WorkTrace.contactId does not change the hash' and 'a trace WITH the lineage columns hashes identical ...' fail (hashes differ); the V1/V2 length assertions fail (got 6/5, expected 8/7).

- [ ] **Step 5: Implement: add the two field names to EXCLUDED_BASE in packages/core/src/platform/work-trace-hash.ts (the const array at line 13-23). Append them after injectedPatternIds with an explaining comment. Do NOT bump hashInputVersion (same treatment as injectedPatternIds — see line 22).**

```ts
const EXCLUDED_BASE = [
  "contentHash",
  "traceVersion",
  "lockedAt",
  // PR-3.2c: analytics-only metadata. Persisted on the row for
  // per-pattern conversion-lift queries, but not part of trace integrity —
  // it is downstream-derivable from BuiltContext, never operator-input.
  // Excluded so the column's @default([]) backfill on pre-PR-3.2c rows does
  // not break their original contentHash verification.
  "injectedPatternIds",
  // Spec-1A chain weld: lineage/index columns (the Contact and
  // ConversationThread this work unit acted on). Downstream-derivable from
  // parameters, never the executed input. Excluded so the new nullable
  // columns leave every existing row's contentHash byte-identical — same
  // treatment as injectedPatternIds, no hashInputVersion bump.
  "contactId",
  "conversationThreadId",
] as const;
```

- [ ] **Step 6: Re-run the hash tests and confirm they PASS (the columns are now omitted from the canonical input, so changing them is hash-invariant; parameters.contactId still changes the hash because parameters is a hashed field; lengths are now 8/7).**

Run: `pnpm --filter @switchboard/core test work-trace-hash`
Expected: PASS — all work-trace-hash tests green, including the invariance, the with/without identical-hash, and the trusted-bag-vs-lineage distinction tests.

- [ ] **Step 7: Commit Task 2 + Task 3 TOGETHER (type field add + EXCLUDED_BASE exclusion in one commit, so the content hash never changes between commits).**

Run: `git add packages/core/src/platform/work-trace.ts packages/core/src/platform/work-trace-hash.ts packages/core/src/platform/__tests__/work-trace-hash.test.ts && git commit -m "feat(core): add worktrace lineage columns to type and hash exclusion"`
Expected: Single commit containing the WorkTrace type fields and the EXCLUDED_BASE change.


#### Task 4: Task 4 — Part (c) VERIFY-ONLY: confirm ConversionRecord.bookingId is already stamped

**Files:**
- Test: `/Users/jasonli/switchboard/packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts`

- [ ] **Step 1: Confirm the producer already stamps metadata.bookingId on the booked OutboxEvent payload. Read packages/core/src/skill-runtime/tools/calendar-book.ts and verify the outbox payload metadata at line 369-375 contains bookingId: booking.id. No edit — this is a read-only confirmation that part (c)'s producer side already exists.**

Run: `grep -n "bookingId: booking.id" packages/core/src/skill-runtime/tools/calendar-book.ts`
Expected: Match at the outbox payload metadata block (around line 370) — confirms the producer already carries bookingId.

- [ ] **Step 2: Confirm the consumer already maps metadata.bookingId into the indexed column. Read packages/db/src/stores/prisma-conversion-record-store.ts and verify record() extracts event.metadata.bookingId (line 50-51) and writes bookingId in the create payload (line 65). No edit — confirmation only.**

Run: `grep -n "event.metadata.bookingId\|bookingId," packages/db/src/stores/prisma-conversion-record-store.ts`
Expected: Matches at line 51 (extraction) and line 65 (write) — confirms the store already stamps bookingId.

- [ ] **Step 3: Run the EXISTING conversion-record-store test that already asserts this behavior. This is the (c) proof: the chain already lands bookingId on ConversionRecord, so NO new code is required for part (c).**

Run: `pnpm --filter @switchboard/db test prisma-conversion-record-store`
Expected: PASS — including 'extracts bookingId from event.metadata into the indexed bookingId column' (line 44) and 'leaves bookingId null when metadata has no bookingId' (line 62). No commit for this task.


#### Task 5: Task 5 — Part (b): persist + read the lineage columns in the Prisma WorkTrace store (with migration)

**Files:**
- Create: `/Users/jasonli/switchboard/packages/db/prisma/migrations/20260606120000_worktrace_lineage_columns/migration.sql`
- Modify: `/Users/jasonli/switchboard/packages/db/prisma/schema.prisma`
- Modify: `/Users/jasonli/switchboard/packages/db/src/stores/prisma-work-trace-store.ts`
- Modify: `/Users/jasonli/switchboard/packages/db/src/stores/__tests__/prisma-work-trace-store.test.ts`
- Test: `/Users/jasonli/switchboard/packages/db/src/stores/__tests__/prisma-work-trace-store.test.ts`

- [ ] **Step 1: Add a FAILING test that the store writes the two lineage columns on persist and reads them back via mapRowToTrace. First open packages/db/src/stores/__tests__/prisma-work-trace-store.test.ts to learn its mock-Prisma factory and a baseline persist test. If the file does NOT exist, create it mirroring prisma-workflow-store.test.ts (mock Prisma with workTrace.{create,findUnique,update} + a $transaction that runs its callback with a tx exposing the same workTrace methods, and a stub auditLedger.record + operatorAlerter). Add this persist-forwarding test.**

```ts
  it("persist forwards contactId + conversationThreadId into the workTrace.create data", async () => {
    await store.persist({
      ...baseTrace(),
      contactId: "ct_chain_1",
      conversationThreadId: "thr_chain_1",
    });
    const created = (createSpy.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(created.contactId).toBe("ct_chain_1");
    expect(created.conversationThreadId).toBe("thr_chain_1");
  });

  it("persist writes null lineage columns when absent", async () => {
    await store.persist(baseTrace());
    const created = (createSpy.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(created.contactId).toBeNull();
    expect(created.conversationThreadId).toBeNull();
  });
```

- [ ] **Step 2: Run the new test and confirm it FAILS (the store does not yet write contactId/conversationThreadId, so created.contactId is undefined, not the expected value/null).**

Run: `pnpm --filter @switchboard/db test prisma-work-trace-store`
Expected: FAIL — created.contactId is undefined (expected 'ct_chain_1' / null); the new assertions fail.

- [ ] **Step 3: Add the columns to the Prisma schema. In packages/db/prisma/schema.prisma, in model WorkTrace, add the two nullable fields after injectedPatternIds (line 1958) and before the Timestamps comment (line 1960).**

```ts
  injectedPatternIds String[] @default([])

  // Spec-1A chain weld: lineage/index columns. Nullable; legacy rows stay NULL
  // (honest absence). In WorkTrace EXCLUDED_BASE (work-trace-hash.ts) so they
  // are not part of the content hash.
  contactId            String?
  conversationThreadId String?
```

- [ ] **Step 4: Add the two indexes to model WorkTrace (in the index block at line 1971-1975, after @@index([approvalId])).**

```ts
  @@index([organizationId, idempotencyKey])
  @@index([organizationId, intent])
  @@index([traceId])
  @@index([requestedAt])
  @@index([approvalId])
  @@index([organizationId, contactId])
  @@index([organizationId, conversationThreadId])
```

- [ ] **Step 5: Hand-author the migration SQL (prisma migrate dev needs a TTY — write the SQL directly). Create packages/db/prisma/migrations/20260606120000_worktrace_lineage_columns/migration.sql with the column adds + indexes. Mirror the column-add format of 20260604200000_recommendation_outcome_enrichment.**

```ts
-- Spec-1A chain weld: lineage/index columns on WorkTrace. Both nullable; legacy
-- rows stay NULL (honest absence). These columns are in the WorkTrace
-- EXCLUDED_BASE (packages/core/src/platform/work-trace-hash.ts) and land in the
-- SAME commit as that exclusion, so every existing row's contentHash stays
-- byte-identical and no hashInputVersion bump is required.
ALTER TABLE "WorkTrace"
  ADD COLUMN "contactId" TEXT,
  ADD COLUMN "conversationThreadId" TEXT;

CREATE INDEX "WorkTrace_organizationId_contactId_idx"
  ON "WorkTrace" ("organizationId", "contactId");

CREATE INDEX "WorkTrace_organizationId_conversationThreadId_idx"
  ON "WorkTrace" ("organizationId", "conversationThreadId");
```

- [ ] **Step 6: Regenerate the Prisma client so the new fields are typed for the store edit.**

Run: `pnpm db:generate`
Expected: Prisma client regenerated; WorkTrace model now exposes contactId + conversationThreadId.

- [ ] **Step 7: Implement the WRITE side: in packages/db/src/stores/prisma-work-trace-store.ts buildWorkTraceCreateData (the return object starting at line 237), add the two columns. Place them right after injectedPatternIds (line 269).**

```ts
      injectedPatternIds: trace.injectedPatternIds ?? [],
      contactId: trace.contactId ?? null,
      conversationThreadId: trace.conversationThreadId ?? null,
```

- [ ] **Step 8: Implement the READ side: in mapRowToTrace (the return object starting at line 421), add the two fields. Place them right after injectedPatternIds (line 462).**

```ts
      injectedPatternIds: row.injectedPatternIds ?? [],
      contactId: row.contactId ?? undefined,
      conversationThreadId: row.conversationThreadId ?? undefined,
```

- [ ] **Step 9: Re-run the store test and confirm it PASSES.**

Run: `pnpm --filter @switchboard/db test prisma-work-trace-store`
Expected: PASS — persist forwards both columns; the absent-case writes null.

- [ ] **Step 10: Type-check the db package to confirm the store compiles against the regenerated client.**

Run: `pnpm --filter @switchboard/db typecheck`
Expected: PASS — no type errors.

- [ ] **Step 11: Commit the schema + migration + store in ONE commit (schema change and its migration must be in the same commit per CLAUDE.md).**

Run: `git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260606120000_worktrace_lineage_columns/migration.sql packages/db/src/stores/prisma-work-trace-store.ts packages/db/src/stores/__tests__/prisma-work-trace-store.test.ts && git commit -m "feat(db): persist worktrace lineage columns + migration"`
Expected: Single commit with schema, migration SQL, store serde, and its test.


#### Task 6: Task 6 — Part (b): thread lineage request → WorkUnit → WorkTrace at submit

**Files:**
- Modify: `/Users/jasonli/switchboard/packages/core/src/platform/canonical-request.ts`
- Modify: `/Users/jasonli/switchboard/packages/core/src/platform/work-unit.ts`
- Modify: `/Users/jasonli/switchboard/packages/core/src/platform/__tests__/work-unit.test.ts`
- Modify: `/Users/jasonli/switchboard/packages/core/src/platform/work-trace-recorder.ts`
- Modify: `/Users/jasonli/switchboard/packages/core/src/platform/__tests__/work-trace-recorder.test.ts`
- Test: `/Users/jasonli/switchboard/packages/core/src/platform/__tests__/work-unit.test.ts`
- Test: `/Users/jasonli/switchboard/packages/core/src/platform/__tests__/work-trace-recorder.test.ts`

- [ ] **Step 1: Add a FAILING test that normalizeWorkUnit carries the two lineage fields from the request. Open packages/core/src/platform/__tests__/work-unit.test.ts, find how it builds a SubmitWorkRequest (reuse the existing helper/fixture in that file), and add this test.**

```ts
  it("normalizeWorkUnit carries contactId + conversationThreadId from the request", () => {
    const wu = normalizeWorkUnit(
      { ...baseRequest, contactId: "ct_1", conversationThreadId: "thr_1" },
      "skill",
    );
    expect(wu.contactId).toBe("ct_1");
    expect(wu.conversationThreadId).toBe("thr_1");
  });

  it("normalizeWorkUnit leaves lineage undefined when the request omits it", () => {
    const wu = normalizeWorkUnit(baseRequest, "skill");
    expect(wu.contactId).toBeUndefined();
    expect(wu.conversationThreadId).toBeUndefined();
  });
```

- [ ] **Step 2: Add a FAILING test that buildWorkTrace and buildClaimTrace copy the lineage onto the WorkTrace. Open packages/core/src/platform/__tests__/work-trace-recorder.test.ts, reuse its existing workUnit/governanceDecision fixtures, and add this test.**

```ts
  it("buildWorkTrace copies contactId + conversationThreadId from the WorkUnit", () => {
    const trace = buildWorkTrace({
      workUnit: { ...baseWorkUnit, contactId: "ct_1", conversationThreadId: "thr_1" },
      governanceDecision: baseDecision,
      governanceCompletedAt: "2026-06-06T00:00:00.000Z",
    });
    expect(trace.contactId).toBe("ct_1");
    expect(trace.conversationThreadId).toBe("thr_1");
  });

  it("buildClaimTrace copies contactId + conversationThreadId from the WorkUnit", () => {
    const trace = buildClaimTrace({
      workUnit: { ...baseWorkUnit, contactId: "ct_1", conversationThreadId: "thr_1" },
      governanceDecision: baseDecision,
      governanceCompletedAt: "2026-06-06T00:00:00.000Z",
      executionStartedAt: "2026-06-06T00:00:00.010Z",
    });
    expect(trace.contactId).toBe("ct_1");
    expect(trace.conversationThreadId).toBe("thr_1");
  });
```

- [ ] **Step 3: Run both tests and confirm they FAIL (the request/WorkUnit/recorder do not yet carry the fields; TypeScript may also error that contactId/conversationThreadId are not assignable to the request/workUnit — both count as a failing red).**

Run: `pnpm --filter @switchboard/core test work-unit work-trace-recorder`
Expected: FAIL — wu.contactId/trace.contactId undefined (or a TS error that the property does not exist on the request/WorkUnit type).

- [ ] **Step 4: Implement step 1: add the optional fields to CanonicalSubmitRequest in packages/core/src/platform/canonical-request.ts (after suggestedMode, line 32).**

```ts
  suggestedMode?: ExecutionModeName;
  /** Spec-1A chain weld: resolved Contact for this submit (lineage column on
   *  WorkTrace). Server-resolved, never LLM-supplied. */
  contactId?: string;
  /** Spec-1A chain weld: resolved ConversationThread for this submit (lineage
   *  column on WorkTrace). Server-resolved at submit. */
  conversationThreadId?: string;
```

- [ ] **Step 5: Implement step 2: add the fields to the WorkUnit interface and copy them in normalizeWorkUnit (packages/core/src/platform/work-unit.ts). Add to the interface after priority (line 25) and to the return object after priority (line 46).**

```ts
  trigger: Trigger;
  priority: Priority;
  contactId?: string;
  conversationThreadId?: string;
}
```

- [ ] **Step 6: In the normalizeWorkUnit return object (work-unit.ts line 32-47), copy both from the request. Add after the priority line.**

```ts
    trigger: request.trigger,
    priority: request.priority ?? "normal",
    contactId: request.contactId,
    conversationThreadId: request.conversationThreadId,
  };
```

- [ ] **Step 7: Implement step 3: in packages/core/src/platform/work-trace-recorder.ts, map the fields onto the WorkTrace in buildWorkTrace (return object at line 87-119) and buildClaimTrace (return object at line 143-170). Add to BOTH return objects, after hashInputVersion.**

```ts
    ingressPath: input.ingressPath ?? "platform_ingress",
    hashInputVersion: WORK_TRACE_HASH_VERSION_LATEST,
    contactId: workUnit.contactId,
    conversationThreadId: workUnit.conversationThreadId,
  };
```

- [ ] **Step 8: Apply the same two-line addition to the buildClaimTrace return object (work-trace-recorder.ts line 168-170), after hashInputVersion. Note buildClaimTrace hard-codes ingressPath: 'platform_ingress'.**

```ts
    ingressPath: "platform_ingress",
    hashInputVersion: WORK_TRACE_HASH_VERSION_LATEST,
    contactId: workUnit.contactId,
    conversationThreadId: workUnit.conversationThreadId,
  };
```

- [ ] **Step 9: Re-run both tests and confirm they PASS. normalizeWorkUnit (work-unit.ts) already spreads ...request into the SubmitWorkRequest at the PlatformIngress call site (platform-ingress.ts:224-231), so a request carrying these fields flows through to the WorkUnit automatically.**

Run: `pnpm --filter @switchboard/core test work-unit work-trace-recorder`
Expected: PASS — normalizeWorkUnit carries the lineage; buildWorkTrace and buildClaimTrace copy it onto the WorkTrace.

- [ ] **Step 10: Run the full core test suite to confirm the type additions broke no existing platform tests (especially that the hash invariance from Task 3 still holds with the recorder now populating the fields).**

Run: `pnpm --filter @switchboard/core test`
Expected: PASS — entire core suite green; work-trace-hash invariance tests still pass.

- [ ] **Step 11: Commit the threading.**

Run: `git add packages/core/src/platform/canonical-request.ts packages/core/src/platform/work-unit.ts packages/core/src/platform/__tests__/work-unit.test.ts packages/core/src/platform/work-trace-recorder.ts packages/core/src/platform/__tests__/work-trace-recorder.test.ts && git commit -m "feat(core): thread worktrace lineage from request through workunit to trace"`
Expected: Commit created with the request/WorkUnit/recorder threading and tests.


#### Task 7: Task 7 — Part (d): re-key the gateway conversation thread off the resolved contactId/org

**Files:**
- Modify: `/Users/jasonli/switchboard/packages/core/src/channel-gateway/types.ts`
- Modify: `/Users/jasonli/switchboard/apps/chat/src/gateway/gateway-conversation-store.ts`
- Modify: `/Users/jasonli/switchboard/apps/chat/src/gateway/__tests__/gateway-conversation-store.test.ts`
- Modify: `/Users/jasonli/switchboard/packages/core/src/channel-gateway/channel-gateway.ts`
- Test: `/Users/jasonli/switchboard/apps/chat/src/gateway/__tests__/gateway-conversation-store.test.ts`

- [ ] **Step 1: Add a FAILING test for the re-key. First check whether apps/chat/src/gateway/__tests__/gateway-conversation-store.test.ts exists; if not, create it. Mirror the apps/chat mock-Prisma pattern: a prisma double whose conversationThread.findFirst returns null (so create runs), conversationThread.create returns { id: 'thr_1' }, conversationMessage.findMany returns []. The test asserts that when an identity with a real contactId/org is passed, the thread is created with THAT contactId/org; and when identity is omitted, it falls back to the visitor-/gateway literals.**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaGatewayConversationStore } from "../gateway-conversation-store.js";

function makePrisma(createSpy: ReturnType<typeof vi.fn>) {
  return {
    conversationThread: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: createSpy,
      update: vi.fn().mockResolvedValue({}),
    },
    conversationMessage: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
    },
    conversationState: { findUnique: vi.fn().mockResolvedValue(null) },
  } as unknown as import("@switchboard/db").PrismaClient;
}

describe("PrismaGatewayConversationStore thread re-key", () => {
  let createSpy: ReturnType<typeof vi.fn>;
  let store: PrismaGatewayConversationStore;

  beforeEach(() => {
    createSpy = vi.fn().mockResolvedValue({ id: "thr_1" });
    store = new PrismaGatewayConversationStore(makePrisma(createSpy));
  });

  it("keys the new thread off the resolved contactId + organizationId when identity is provided", async () => {
    await store.getOrCreateBySession("dep_1", "whatsapp", "+6591234567", {
      organizationId: "org_real",
      contactId: "ct_real",
    });
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ contactId: "ct_real", organizationId: "org_real" }),
      }),
    );
  });

  it("falls back to visitor-/gateway literals when identity is absent (no resolvable contact)", async () => {
    await store.getOrCreateBySession("dep_1", "web", "sess_x");
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ contactId: "visitor-sess_x", organizationId: "gateway" }),
      }),
    );
  });

  it("falls back to the visitor- literal when identity.contactId is null", async () => {
    await store.getOrCreateBySession("dep_1", "whatsapp", "sess_y", {
      organizationId: "org_real",
      contactId: null,
    });
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ contactId: "visitor-sess_y", organizationId: "org_real" }),
      }),
    );
  });
});
```

- [ ] **Step 2: Build core first (apps/chat consumes @switchboard/core's compiled types; the gateway store imports the GatewayConversationStore interface), then run the new test and confirm it FAILS — the store ignores the 4th arg and always uses visitor-/gateway, so the first assertion (contactId 'ct_real') fails.**

Run: `pnpm --filter @switchboard/core build && pnpm --filter @switchboard/chat test gateway-conversation-store`
Expected: FAIL — first test expects contactId 'ct_real'/org 'org_real' but the create was called with 'visitor-+6591234567'/'gateway'.

- [ ] **Step 3: Implement step 1: widen the interface in packages/core/src/channel-gateway/types.ts. Add an optional 4th param to getOrCreateBySession (the GatewayConversationStore interface at line 181-189).**

```ts
export interface GatewayConversationStore {
  getOrCreateBySession(
    deploymentId: string,
    channel: string,
    sessionId: string,
    /** Spec-1A chain weld: resolved identity used to key the thread. When
     *  omitted, or when contactId is null, the store falls back to the
     *  legacy visitor-/gateway literals (no resolvable contact). */
    identity?: { organizationId: string; contactId: string | null },
  ): Promise<{
    conversationId: string;
    messages: Array<{ role: string; content: string }>;
  }>;
  addMessage(conversationId: string, role: string, content: string): Promise<void>;
  getConversationStatus?(sessionId: string): Promise<string | null>;
}
```

- [ ] **Step 4: Implement step 2: in apps/chat/src/gateway/gateway-conversation-store.ts, accept the param and derive the thread key from it, keeping the literals as the fallback. Replace the signature + the two literal-assignment lines (line 15-24).**

```ts
  async getOrCreateBySession(
    deploymentId: string,
    channel: string,
    sessionId: string,
    identity?: { organizationId: string; contactId: string | null },
  ): Promise<{
    conversationId: string;
    messages: Array<{ role: string; content: string }>;
  }> {
    // Spec-1A chain weld: key the thread off the resolver-provided contact/org
    // so the ConversationThread is the SAME row a booking later resolves
    // against. The visitor-/gateway literals remain ONLY as the fallback for a
    // session with no resolvable contact (identity absent or contactId null).
    const contactId = identity?.contactId ?? `visitor-${sessionId}`;
    const orgId = identity?.organizationId ?? "gateway";
```

- [ ] **Step 5: Build core (the interface widened) then run the gateway store test and confirm it PASSES.**

Run: `pnpm --filter @switchboard/core build && pnpm --filter @switchboard/chat test gateway-conversation-store`
Expected: PASS — identity-provided path keys off ct_real/org_real; both fallback paths use the visitor- literal.

- [ ] **Step 6: Implement step 3: wire the real caller. In packages/core/src/channel-gateway/channel-gateway.ts, hoist the resolveContactIdentity block (currently step 4c, line 216-224) to BEFORE the main getOrCreateBySession call (step 3, line 190-194), and pass the resolved identity in. Replace the step-3 call so it reads the pre-resolved `identity`.**

```ts
    // 3. Resolve contact identity FIRST (Spec-1A chain weld), then get/create
    // the conversation so the thread is keyed off the resolved contact/org.
    // No-op (contactId null) when contactStore is unwired or channel != whatsapp.
    const identity = this.config.contactStore
      ? await resolveContactIdentity({
          channel: message.channel,
          sessionId: message.sessionId,
          organizationId: resolved.organizationId,
          contactStore: this.config.contactStore,
        })
      : { contactId: null, phone: null, channel: message.channel };

    const { conversationId, messages: history } = await conversationStore.getOrCreateBySession(
      resolved.deploymentId,
      message.channel,
      message.sessionId,
      { organizationId: resolved.organizationId, contactId: identity.contactId },
    );
```

- [ ] **Step 7: Remove the now-duplicated identity resolution at the old step-4c location (channel-gateway.ts line 216-224) so resolveContactIdentity runs exactly once. Delete the old `const identity = ...` block there; the subsequent opt-out branch (line 229+) now reads the `identity` resolved earlier in step 3. Leave the inactive-deployment call (line 154-158) unchanged — it legitimately passes no identity (deployment resolution threw; no org/contact available → fallback).**

```ts
    // 4c. (Identity already resolved in step 3 above for the chain weld.)
    // 4d. WhatsApp opt-out keyword detection — terminal branch.
```

- [ ] **Step 8: Build core and run the full channel-gateway test suite to confirm the hoist did not change gateway behavior (the existing mocks pass extra-arg-tolerant vi.fn()s).**

Run: `pnpm --filter @switchboard/core build && pnpm --filter @switchboard/core test channel-gateway`
Expected: PASS — all channel-gateway tests green; resolveContactIdentity still invoked once on the main path.

- [ ] **Step 9: Type-check apps/chat to confirm the widened interface and the gateway store impl line up across the layer boundary.**

Run: `pnpm --filter @switchboard/chat typecheck`
Expected: PASS — no type errors in apps/chat.

- [ ] **Step 10: Commit part (d).**

Run: `git add packages/core/src/channel-gateway/types.ts packages/core/src/channel-gateway/channel-gateway.ts apps/chat/src/gateway/gateway-conversation-store.ts apps/chat/src/gateway/__tests__/gateway-conversation-store.test.ts && git commit -m "feat(core,chat): re-key gateway thread off resolved contact identity"`
Expected: Commit created with the interface widening, the gateway caller hoist, the store impl, and its test.


#### Task 8: Task 8 — Full-suite verification + one-query chain join proof

**Files:**
- Modify: `/Users/jasonli/switchboard/packages/db/src/stores/__tests__/prisma-work-trace-store.test.ts`
- Test: `/Users/jasonli/switchboard/packages/db/src/stores/__tests__/prisma-work-trace-store.test.ts`

- [ ] **Step 1: Add a one-query chain-join proof to the work-trace store test that documents the spine the PR welds: Booking.workTraceId → WorkTrace.workUnitId → WorkTrace.contactId/conversationThreadId. Because DB tests mock Prisma (no Postgres), prove the JOIN SHAPE by asserting that a stored WorkTrace carries the lineage that a Booking row can join on. Add this test to prisma-work-trace-store.test.ts.**

```ts
  it("stores the lineage a Booking can chain-join on (Booking.workTraceId -> WorkTrace.workUnitId -> contactId/conversationThreadId)", async () => {
    const trace = {
      ...baseTrace(),
      workUnitId: "wu_chain",
      contactId: "ct_chain",
      conversationThreadId: "thr_chain",
    };
    await store.persist(trace);
    const created = (createSpy.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    // A Booking row with workTraceId = 'wu_chain' joins to this row by workUnitId
    // and reaches the Contact + ConversationThread in one hop.
    expect(created.workUnitId).toBe("wu_chain");
    expect(created.contactId).toBe("ct_chain");
    expect(created.conversationThreadId).toBe("thr_chain");
  });
```

- [ ] **Step 2: Run the work-trace store test and confirm the chain-join proof PASSES (lineage columns are persisted alongside the join key).**

Run: `pnpm --filter @switchboard/db test prisma-work-trace-store`
Expected: PASS — the chain-join shape test confirms workUnitId + contactId + conversationThreadId are co-persisted.

- [ ] **Step 3: Run the full test suite and typecheck across the touched packages to confirm the whole PR is green end-to-end before opening the PR.**

Run: `pnpm --filter @switchboard/core test && pnpm --filter @switchboard/db test && pnpm --filter @switchboard/chat test && pnpm --filter @switchboard/core typecheck && pnpm --filter @switchboard/db typecheck && pnpm --filter @switchboard/chat typecheck`
Expected: PASS — core, db, and chat suites all green; all three packages type-check. (If typecheck reports stale missing exports from @switchboard/core, run pnpm reset first per CLAUDE.md, then re-run.)

- [ ] **Step 4: If a local PostgreSQL is available, verify the migration applies and matches the schema (no drift). Skip if Postgres is unreachable — CI validates the migration.**

Run: `pnpm db:check-drift`
Expected: PASS — no drift between schema.prisma and the migrations (or a clear 'Postgres unreachable' message, in which case rely on CI).

- [ ] **Step 5: Commit the chain-join proof.**

Run: `git add packages/db/src/stores/__tests__/prisma-work-trace-store.test.ts && git commit -m "test(db): pin one-query booking-to-worktrace chain join shape"`
Expected: Commit created with the chain-join proof test.


---

## 1A-3 — feat(schemas,core,db): receipt primitive + isPaidVisit verdict + calendar-receipt mint with prod-assert

**Goal:** Introduce the shared Receipt primitive (kind calendar|payment, tier T1_FETCH_BACK>T2_PROVIDER_SIGNATURE>T3_ADMIN_AUDIT, status booked|held|paid|void, Zod-discriminated evidence — no any) and a STRUCTURED isPaidVisit verdict {paid,held,tier,basis,degraded} (never a bare boolean), so "is this real, and how strongly" exists as a first-class abstraction BEFORE any money flows (PR 1A-4). Per R2: a calendar-confirmed booking is BOOKED not HELD — a CalendarReceipt has status='booked', basis='calendar_confirmed', and isPaidVisit returns {paid:false, held:false}; the PAID signal only ever comes from a verified PaymentReceipt. Per R1: a Noop/Local calendar provider can NEVER mint above tier T3 in production — enforced by a parametrized tier resolver injected at the apps/api wiring site (core stays surface-agnostic and never reads process.env) plus a load-bearing prod-assert test. Add the Receipt Prisma model + raw-SQL partial-unique migration (organizationId, kind, externalRef) WHERE externalRef IS NOT NULL in the SAME commit, a ReceiptStore interface in core (structural-match, mirroring revenue-store.ts), a PrismaReceiptStore impl in db (mirroring prisma-revenue-store.ts, every mutation org-scoped via updateMany + count===0 guard), and mint a status='booked' CalendarReceipt inside the existing calendar-book confirm transaction (calendar-book.ts:343-394) via a co-located helper (calendar-book.ts is at 439 lines — extract, never inline). DEPENDS ON 1A-2 (WorkTrace.contactId/conversationThreadId welded, ConversionRecord.bookingId stamped, workTraceId passed at calendar-book).

**File structure:**

| Action | Path | Responsibility |
|---|---|---|
| create | `packages/schemas/src/receipt.ts` | L1 Zod source of truth: ReceiptKindSchema (calendar|payment), ReceiptTierSchema (T1_FETCH_BACK|T2_PROVIDER_SIGNATURE|T3_ADMIN_AUDIT), ReceiptStatusSchema (booked|held|paid|void), ReceiptEvidenceSchema (z.discriminatedUnion('kind', [calendar evidence, payment evidence]) — no any), ReceiptSchema (id, organizationId, kind, tier, status, bookingId?, opportunityId?, revenueEventId?, connectionId?, provider?, externalRef?, amount?, currency?, evidence, capturedBy, verifiedAt?, workTraceId?, createdAt) and inferred types; PaidVisitVerdict type {paid:boolean, held:boolean, tier:ReceiptTier, basis:string, degraded:boolean}; RECEIPT_TIER_RANK map + clampTierForUntrustedProvider() pure helper enforcing 'never above T3' (used by both the mint helper and its prod-assert test). |
| create | `packages/schemas/src/receipt.test.ts` | Co-located schema tests: ReceiptSchema accepts a valid calendar receipt (status booked) and a valid payment receipt (status paid); evidence discriminated union rejects a calendar receipt carrying payment-shaped evidence (and vice-versa); status enum rejects 'partial'; clampTierForUntrustedProvider clamps T1/T2→T3 and leaves T3 as T3. |
| modify | `packages/schemas/src/index.ts` | Append `export * from "./receipt.js";` after the calendar export (index.ts:127) so Receipt types are reachable from @switchboard/schemas. |
| create | `packages/core/src/receipts/is-paid-visit.ts` | L3 pure predicate isPaidVisit(receipt): PaidVisitVerdict — STRUCTURED verdict, never a bare boolean. calendar+status='booked' → {paid:false, held:false, basis:'calendar_confirmed', tier, degraded:false}; calendar+status='held' → {paid:false, held:true, basis:'calendar_confirmed'}; payment+status='paid'+provider!=='noop'+tier===T1 → {paid:true, held:false, basis:'payment_verified', degraded:false}; payment+provider==='noop' → {paid:false, degraded:true, basis:'payment_degraded'} (NOT production-countable); status='void' → {paid:false, held:false, basis:'void'}. Plus isProductionCountable(verdict, env) helper that excludes degraded verdicts when env is production (R1). |
| create | `packages/core/src/receipts/is-paid-visit.test.ts` | Co-located verdict MATRIX: calendar-booked→not paid/not held; calendar-held→held not paid; payment-T1-live→paid; noop-payment→degraded & not production-countable; void→neither; asserts the return is the structured object (never boolean). |
| create | `packages/core/src/receipts/receipt-store.ts` | L3 ReceiptStore interface (structural-match pattern; mirrors lifecycle/revenue-store.ts): MintReceiptInput type, ReceiptStore.mint(input, tx?: StoreTransactionContext): Promise<Receipt>, findByBooking(orgId, bookingId): Promise<Receipt[]>. Re-uses StoreTransactionContext=unknown from lifecycle (re-declared locally to keep core internal deps minimal, matching revenue-store.ts). |
| create | `packages/core/src/receipts/mint-calendar-receipt.ts` | L3 co-located helper buildCalendarReceiptData({bookingId, organizationId, opportunityId, workTraceId, externalRef, provider, isProduction, requestedTier}): returns the receipt-create payload with status='booked', kind='calendar', basis evidence calendar_confirmed, tier = clampTierForUntrustedProvider applied when the provider is untrusted (Noop/Local) so production can never store above T3. Pure data-builder so it is unit-testable WITHOUT a DB and is the prod-assert seam. |
| create | `packages/core/src/receipts/mint-calendar-receipt.test.ts` | Co-located: builds a booked CalendarReceipt (status==='booked' NOT 'held'); PROD-ASSERT (R1): isProduction=true + untrusted provider + requestedTier T1 → result tier === 'T3_ADMIN_AUDIT'; trusted provider + real re-fetch keeps requested tier. |
| create | `packages/core/src/receipts/index.ts` | Barrel re-exporting is-paid-visit, receipt-store iface, mint-calendar-receipt from the new receipts subdir. |
| modify | `packages/core/src/index.ts` | Add `export * from "./receipts/index.js";` so isPaidVisit, ReceiptStore, and the mint helper are reachable from @switchboard/core. |
| modify | `packages/core/src/skill-runtime/tools/calendar-book.ts` | Extend the TransactionFn tx type (calendar-book.ts:70-83) with a `receipt: { create(args:{data:Record<string,unknown>}):Promise<unknown> }` member; add receiptStore-less mint INSIDE the existing confirm tx (calendar-book.ts:343-394) by calling buildCalendarReceiptData(...) and tx.receipt.create({data}); add to CalendarBookToolDeps the injected `receiptTierForProvider:(p:CalendarProvider)=>ReceiptTier` resolver and `isProduction:boolean` so core never reads process.env. Keep the file under 400 lines by delegating payload construction to mint-calendar-receipt.ts (no inline logic). |
| modify | `packages/core/src/skill-runtime/tools/calendar-book.test.ts` | Add a spy assertion that the confirm tx calls tx.receipt.create with status:'booked' and the clamped tier; extend the existing mock tx + deps (mirroring the file's current factory) with receipt.create, receiptTierForProvider, isProduction. |
| create | `packages/db/src/stores/prisma-receipt-store.ts` | L4 PrismaReceiptStore (mirrors prisma-revenue-store.ts:57): mint(input, tx?) → client.receipt.create with a generated id; findByBooking(orgId, bookingId) org-scoped; a mapRowToReceipt mapper (mirrors :268). Class duplicates the ReceiptStore iface locally with the 'structural match with @switchboard/core' comment (precedent prisma-revenue-store.ts:6). |
| create | `packages/db/src/stores/__tests__/prisma-receipt-store.test.ts` | L4 MOCKED-Prisma tests (CI has no Postgres; mirrors prisma-revenue-store.test.ts + prisma-workflow-store.test.ts): mint uses tx client when tx passed / this.prisma otherwise; findByBooking scopes where to {organizationId, bookingId}; mapper round-trips status='booked'. |
| modify | `packages/db/src/index.ts` | Add `export { PrismaReceiptStore } from "./stores/prisma-receipt-store.js";` after the PrismaRevenueStore export (index.ts:73). |
| modify | `packages/db/prisma/schema.prisma` | Add the Receipt model (after ConversionRecord, ~schema.prisma:2054) with fields per §7, @@index([organizationId, bookingId]) and @@index([organizationId, kind, status]); add a sync comment that the partial-unique (organizationId, kind, externalRef) WHERE externalRef IS NOT NULL lives in raw SQL (Prisma 6 limitation, mirroring Booking model comment :2004-2006). |
| create | `packages/db/prisma/migrations/20260606120000_add_receipt/migration.sql` | Same-commit migration: CREATE TABLE "Receipt" (mirroring 20260602093000 style) + CREATE INDEX for the two composite indexes + raw-SQL CREATE UNIQUE INDEX ... WHERE "externalRef" IS NOT NULL (mirroring 20260603120000_booking_partial_unique_active). |

**Notes:** VERIFIED ANCHORS (file:line): schemas barrel packages/schemas/src/index.ts:127 (calendar.js export — append receipt.js after it); discriminatedUnion precedent whatsapp-template-create.ts:20 and qualification-signals.ts:42; CalendarProvider interface calendar.ts:92-99 has NO kind/providerKind discriminator (this is WHY the tier resolver must be injected at L5). Core lifecycle store-iface precedent: revenue-store.ts:8 (StoreTransactionContext=unknown), :41 (RevenueStore interface), re-exported lifecycle/index.ts:19-25. db impl precedent prisma-revenue-store.ts:6 ("structural match with @switchboard/core" — db duplicates the iface locally), class at :57, mapper at :268. db barrel export point index.ts:73 (PrismaRevenueStore). Prisma models: Booking schema.prisma:1982, ConversionRecord:2034 (bookingId already exists :2045), LifecycleRevenueEvent:1829. Migration precedents: CREATE TABLE style 20260602093000_add_scheduled_reminder/migration.sql; raw-SQL PARTIAL UNIQUE 20260603120000_booking_partial_unique_active/migration.sql (Prisma 6 cannot express partial unique in-schema — keep a sync comment on the model). calendar-book confirm tx: calendar-book.ts:70-83 (TransactionFn tx type), :342 (eventId=randomUUID, NOT changed in this PR — that is 1A-5), :343-394 (the confirm tx where the receipt is minted). Wiring site apps/api/src/bootstrap/skill-mode.ts:307-350 (deps assembled), :309 (isCalendarProviderConfigured uses isNoopCalendarProvider), :329-347 (runTransaction tx-shape that must gain receipt). Noop detection: apps/api/src/bootstrap/noop-calendar-provider.ts (isNoopCalendarProvider); LocalCalendarProvider local-calendar-provider.ts:88 (local- prefix, fabricated id → also T3). DB tests MOCK Prisma (CI has no Postgres): mirror prisma-revenue-store.test.ts and prisma-workflow-store.test.ts (mock factory + count===0 guard test at :150). Test cmds use vitest run (package.json test scripts schemas:149/core:121/db:23). NO new env var, NO new mutating route — nothing to add to allowlists. LAYERING: ReceiptSchema/verdict types in schemas(L1); isPaidVisit predicate + ReceiptStore iface + mint helper in core(L3); PrismaReceiptStore in db(L4); tier resolver + isProduction flag injected from apps/api(L5). The mint helper lives in core but the production gate FLOWS IN as data (isProduction:boolean) — core never reads process.env (surface-agnostic invariant). Run `pnpm reset` before typecheck if Prisma client is stale after the migration. CROSS-PR: PaymentReceipt(verified,T1) minting is PR 1A-4 (this PR only mints the CalendarReceipt and ships the predicate that 1A-4's payment path will satisfy); deterministic eventId + origin filtering is 1A-5.

#### Task 1: Task 1 — L1 Receipt schema: enums, discriminated evidence, ReceiptSchema, verdict type, tier-clamp helper (schemas, no DB)

**Files:**
- Create: `packages/schemas/src/receipt.ts`
- Create: `packages/schemas/src/receipt.test.ts`
- Modify: `packages/schemas/src/index.ts`
- Test: `packages/schemas/src/receipt.test.ts`

- [ ] **Step 1: Write the FAILING test first. Create packages/schemas/src/receipt.test.ts. It imports symbols that do not exist yet (ReceiptSchema, ReceiptStatusSchema, clampTierForUntrustedProvider), so it must fail to import/compile. Mirror the schema-test style already used in this package (plain vitest, no Prisma).**

```ts
import { describe, it, expect } from "vitest";
import {
  ReceiptSchema,
  ReceiptStatusSchema,
  clampTierForUntrustedProvider,
} from "./receipt.js";

describe("ReceiptSchema", () => {
  it("accepts a valid calendar receipt with status booked", () => {
    const parsed = ReceiptSchema.safeParse({
      id: "rcpt-1",
      organizationId: "org-1",
      kind: "calendar",
      tier: "T1_FETCH_BACK",
      status: "booked",
      bookingId: "bk-1",
      capturedBy: "calendar-book",
      evidence: { kind: "calendar", basis: "calendar_confirmed", calendarEventId: "gcal_123" },
      createdAt: new Date("2026-06-06T00:00:00Z"),
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a valid payment receipt with status paid", () => {
    const parsed = ReceiptSchema.safeParse({
      id: "rcpt-2",
      organizationId: "org-1",
      kind: "payment",
      tier: "T1_FETCH_BACK",
      status: "paid",
      provider: "stripe",
      externalRef: "pi_abc",
      amount: 5000,
      currency: "SGD",
      capturedBy: "payment.record_verified",
      evidence: { kind: "payment", basis: "payment_verified", chargeId: "ch_abc", amountFetched: 5000 },
      createdAt: new Date("2026-06-06T00:00:00Z"),
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a calendar receipt carrying payment-shaped evidence", () => {
    const parsed = ReceiptSchema.safeParse({
      id: "rcpt-3",
      organizationId: "org-1",
      kind: "calendar",
      tier: "T1_FETCH_BACK",
      status: "booked",
      capturedBy: "calendar-book",
      evidence: { kind: "payment", basis: "payment_verified", chargeId: "ch_x", amountFetched: 1 },
      createdAt: new Date(),
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an unknown status", () => {
    expect(ReceiptStatusSchema.safeParse("partial").success).toBe(false);
  });
});

describe("clampTierForUntrustedProvider", () => {
  it("clamps T1 and T2 down to T3 for untrusted providers", () => {
    expect(clampTierForUntrustedProvider("T1_FETCH_BACK")).toBe("T3_ADMIN_AUDIT");
    expect(clampTierForUntrustedProvider("T2_PROVIDER_SIGNATURE")).toBe("T3_ADMIN_AUDIT");
  });
  it("leaves T3 as T3", () => {
    expect(clampTierForUntrustedProvider("T3_ADMIN_AUDIT")).toBe("T3_ADMIN_AUDIT");
  });
});
```

- [ ] **Step 2: Run the test and confirm it FAILS (module/symbols do not exist yet).**

Run: `pnpm --filter @switchboard/schemas test -- receipt.test.ts`
Expected: FAIL — cannot find module "./receipt.js" (or export missing). 0 passing for this file.

- [ ] **Step 3: Write the MINIMAL real implementation. Create packages/schemas/src/receipt.ts. Use z.discriminatedUnion('kind', ...) for evidence (precedent whatsapp-template-create.ts:20). No `any`. RECEIPT_TIER_RANK encodes T1>T2>T3 ordering (spec §7). clampTierForUntrustedProvider always returns T3 (an untrusted Noop/Local provider can never out-rank admin-audit).**

```ts
import { z } from "zod";

export const ReceiptKindSchema = z.enum(["calendar", "payment"]);
export type ReceiptKind = z.infer<typeof ReceiptKindSchema>;

/** Strength ordering T1_FETCH_BACK > T2_PROVIDER_SIGNATURE > T3_ADMIN_AUDIT (spec §7). */
export const ReceiptTierSchema = z.enum([
  "T1_FETCH_BACK",
  "T2_PROVIDER_SIGNATURE",
  "T3_ADMIN_AUDIT",
]);
export type ReceiptTier = z.infer<typeof ReceiptTierSchema>;

/** R2: a calendar-confirmed booking is BOOKED, not HELD. */
export const ReceiptStatusSchema = z.enum(["booked", "held", "paid", "void"]);
export type ReceiptStatus = z.infer<typeof ReceiptStatusSchema>;

const CalendarEvidenceSchema = z.object({
  kind: z.literal("calendar"),
  basis: z.literal("calendar_confirmed"),
  calendarEventId: z.string().nullable().optional(),
});

const PaymentEvidenceSchema = z.object({
  kind: z.literal("payment"),
  basis: z.enum(["payment_verified", "payment_degraded"]),
  chargeId: z.string(),
  amountFetched: z.number().int().nonnegative(),
});

export const ReceiptEvidenceSchema = z.discriminatedUnion("kind", [
  CalendarEvidenceSchema,
  PaymentEvidenceSchema,
]);
export type ReceiptEvidence = z.infer<typeof ReceiptEvidenceSchema>;

export const ReceiptSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  kind: ReceiptKindSchema,
  tier: ReceiptTierSchema,
  status: ReceiptStatusSchema,
  bookingId: z.string().nullable().optional(),
  opportunityId: z.string().nullable().optional(),
  revenueEventId: z.string().nullable().optional(),
  connectionId: z.string().nullable().optional(),
  provider: z.string().nullable().optional(),
  externalRef: z.string().nullable().optional(),
  amount: z.number().int().nullable().optional(),
  currency: z.string().nullable().optional(),
  evidence: ReceiptEvidenceSchema,
  capturedBy: z.string(),
  verifiedAt: z.date().nullable().optional(),
  workTraceId: z.string().nullable().optional(),
  createdAt: z.date(),
});
export type Receipt = z.infer<typeof ReceiptSchema>;

/** Structured verdict — NEVER a bare boolean (spec §3, cross-cutting decision §11). */
export interface PaidVisitVerdict {
  paid: boolean;
  held: boolean;
  tier: ReceiptTier;
  basis: string;
  degraded: boolean;
}

export const RECEIPT_TIER_RANK: Record<ReceiptTier, number> = {
  T1_FETCH_BACK: 3,
  T2_PROVIDER_SIGNATURE: 2,
  T3_ADMIN_AUDIT: 1,
};

/**
 * R1: a Noop/Local provider fabricates its ids, so its evidence can never out-rank
 * admin-audit. Always clamp an untrusted provider's tier to T3_ADMIN_AUDIT.
 */
export function clampTierForUntrustedProvider(_requested: ReceiptTier): ReceiptTier {
  return "T3_ADMIN_AUDIT";
}
```

- [ ] **Step 4: Export the new module from the schemas barrel. Open packages/schemas/src/index.ts and add the receipt export immediately after the calendar export (index.ts:127).**

```ts
export * from "./calendar.js";
export * from "./receipt.js";
```

- [ ] **Step 5: Run the test and confirm it now PASSES.**

Run: `pnpm --filter @switchboard/schemas test -- receipt.test.ts`
Expected: PASS — all assertions green for receipt.test.ts.

- [ ] **Step 6: Typecheck the schemas package to confirm no `any`/type errors leaked.**

Run: `pnpm --filter @switchboard/schemas typecheck`
Expected: PASS — no type errors.

- [ ] **Step 7: Commit (lowercase conventional subject).**

Run: `git add packages/schemas/src/receipt.ts packages/schemas/src/receipt.test.ts packages/schemas/src/index.ts && git commit -m "feat(schemas): receipt primitive with discriminated evidence and tier clamp"`
Expected: Commit succeeds; commitlint accepts the lowercase subject.


#### Task 2: Task 2 — L3 isPaidVisit structured verdict + production-countable exclusion (core, no DB)

**Files:**
- Create: `packages/core/src/receipts/is-paid-visit.ts`
- Create: `packages/core/src/receipts/is-paid-visit.test.ts`
- Test: `packages/core/src/receipts/is-paid-visit.test.ts`

- [ ] **Step 1: Write the FAILING test first. Create packages/core/src/receipts/is-paid-visit.test.ts encoding the full verdict MATRIX from spec §13 (calendar-booked → not paid not held; calendar-held → held; payment-T1-live → paid; noop-payment → degraded & not production-countable; void → neither). It imports isPaidVisit + isProductionCountable which do not exist yet.**

```ts
import { describe, it, expect } from "vitest";
import type { Receipt } from "@switchboard/schemas";
import { isPaidVisit, isProductionCountable } from "./is-paid-visit.js";

function receipt(overrides: Partial<Receipt>): Receipt {
  return {
    id: "r",
    organizationId: "org-1",
    kind: "calendar",
    tier: "T1_FETCH_BACK",
    status: "booked",
    capturedBy: "calendar-book",
    evidence: { kind: "calendar", basis: "calendar_confirmed", calendarEventId: "gcal_1" },
    createdAt: new Date(),
    ...overrides,
  } as Receipt;
}

describe("isPaidVisit", () => {
  it("calendar booked -> not paid, not held, basis calendar_confirmed", () => {
    const v = isPaidVisit(receipt({ kind: "calendar", status: "booked" }));
    expect(v.paid).toBe(false);
    expect(v.held).toBe(false);
    expect(v.basis).toBe("calendar_confirmed");
    expect(v.degraded).toBe(false);
  });

  it("calendar held -> held, not paid", () => {
    const v = isPaidVisit(receipt({ kind: "calendar", status: "held" }));
    expect(v.held).toBe(true);
    expect(v.paid).toBe(false);
  });

  it("verified payment (T1, real provider) -> paid", () => {
    const v = isPaidVisit(
      receipt({
        kind: "payment",
        status: "paid",
        provider: "stripe",
        tier: "T1_FETCH_BACK",
        evidence: { kind: "payment", basis: "payment_verified", chargeId: "ch_1", amountFetched: 5000 },
      }),
    );
    expect(v.paid).toBe(true);
    expect(v.degraded).toBe(false);
  });

  it("noop payment -> degraded and NOT production-countable", () => {
    const v = isPaidVisit(
      receipt({
        kind: "payment",
        status: "paid",
        provider: "noop",
        tier: "T3_ADMIN_AUDIT",
        evidence: { kind: "payment", basis: "payment_degraded", chargeId: "noop_1", amountFetched: 5000 },
      }),
    );
    expect(v.degraded).toBe(true);
    expect(v.paid).toBe(false);
    expect(isProductionCountable(v, "production")).toBe(false);
  });

  it("void -> neither paid nor held", () => {
    const v = isPaidVisit(receipt({ kind: "payment", status: "void", provider: "stripe" }));
    expect(v.paid).toBe(false);
    expect(v.held).toBe(false);
  });

  it("returns a structured object, never a bare boolean", () => {
    const v = isPaidVisit(receipt({}));
    expect(typeof v).toBe("object");
    expect(v).toHaveProperty("tier");
  });
});
```

- [ ] **Step 2: Run the test and confirm it FAILS (module does not exist).**

Run: `pnpm --filter @switchboard/core test -- is-paid-visit.test.ts`
Expected: FAIL — cannot find module "./is-paid-visit.js".

- [ ] **Step 3: Write the MINIMAL real implementation. Create packages/core/src/receipts/is-paid-visit.ts. paid is true ONLY for a verified payment (provider not 'noop', tier T1, status paid); a noop payment is degraded; a calendar receipt is held only when status==='held' (booked stays held:false per R2). isProductionCountable excludes degraded verdicts in production env (R1).**

```ts
import type { Receipt, PaidVisitVerdict } from "@switchboard/schemas";

/**
 * Structured verdict — never a bare boolean (spec §11). R1/R2:
 * - calendar booked -> attended, not paid, not held
 * - calendar held -> held, payment unverified
 * - verified payment (real provider, T1) -> paid
 * - noop/degraded payment -> degraded, NOT production-countable
 * - void -> neither
 */
export function isPaidVisit(receipt: Receipt): PaidVisitVerdict {
  const { kind, status, provider, tier } = receipt;

  if (status === "void") {
    return { paid: false, held: false, tier, basis: "void", degraded: false };
  }

  if (kind === "calendar") {
    return {
      paid: false,
      held: status === "held",
      tier,
      basis: "calendar_confirmed",
      degraded: false,
    };
  }

  // kind === "payment"
  const isNoop = provider === "noop";
  if (isNoop) {
    return { paid: false, held: false, tier, basis: "payment_degraded", degraded: true };
  }
  const paid = status === "paid" && tier === "T1_FETCH_BACK";
  return { paid, held: false, tier, basis: "payment_verified", degraded: false };
}

/** R1: in production, a degraded (e.g. noop) verdict never counts as a real paid visit. */
export function isProductionCountable(
  verdict: PaidVisitVerdict,
  env: string,
): boolean {
  if (env === "production" && verdict.degraded) return false;
  return verdict.paid;
}
```

- [ ] **Step 4: Run the test and confirm it now PASSES.**

Run: `pnpm --filter @switchboard/core test -- is-paid-visit.test.ts`
Expected: PASS — full verdict matrix green.

- [ ] **Step 5: Commit.**

Run: `git add packages/core/src/receipts/is-paid-visit.ts packages/core/src/receipts/is-paid-visit.test.ts && git commit -m "feat(core): structured ispaidvisit verdict with production-countable exclusion"`
Expected: Commit succeeds.


#### Task 3: Task 3 — L3 ReceiptStore interface + calendar-receipt mint payload builder + prod-assert (core)

**Files:**
- Create: `packages/core/src/receipts/receipt-store.ts`
- Create: `packages/core/src/receipts/mint-calendar-receipt.ts`
- Create: `packages/core/src/receipts/mint-calendar-receipt.test.ts`
- Create: `packages/core/src/receipts/index.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/receipts/mint-calendar-receipt.test.ts`

- [ ] **Step 1: Write the FAILING prod-assert test first. Create packages/core/src/receipts/mint-calendar-receipt.test.ts. It asserts (a) the built receipt has status 'booked' NOT 'held' (R2), and (b) the prod-assert (R1): in production, an UNTRUSTED provider's requested T1 is clamped to T3_ADMIN_AUDIT. It imports buildCalendarReceiptData which does not exist yet.**

```ts
import { describe, it, expect } from "vitest";
import { buildCalendarReceiptData } from "./mint-calendar-receipt.js";

const base = {
  bookingId: "bk-1",
  organizationId: "org-1",
  opportunityId: "opp-1",
  workTraceId: "wt-1",
  calendarEventId: "gcal_123",
};

describe("buildCalendarReceiptData", () => {
  it("mints status 'booked', not 'held' (R2)", () => {
    const data = buildCalendarReceiptData({
      ...base,
      providerTrusted: true,
      requestedTier: "T1_FETCH_BACK",
      isProduction: false,
    });
    expect(data.status).toBe("booked");
    expect(data.kind).toBe("calendar");
    expect(data.evidence).toMatchObject({ kind: "calendar", basis: "calendar_confirmed" });
  });

  it("PROD-ASSERT (R1): untrusted provider in production can never mint above T3", () => {
    const data = buildCalendarReceiptData({
      ...base,
      providerTrusted: false,
      requestedTier: "T1_FETCH_BACK",
      isProduction: true,
    });
    expect(data.tier).toBe("T3_ADMIN_AUDIT");
  });

  it("keeps the requested tier for a trusted provider with a real re-fetch", () => {
    const data = buildCalendarReceiptData({
      ...base,
      providerTrusted: true,
      requestedTier: "T1_FETCH_BACK",
      isProduction: true,
    });
    expect(data.tier).toBe("T1_FETCH_BACK");
  });
});
```

- [ ] **Step 2: Run the test and confirm it FAILS (module does not exist).**

Run: `pnpm --filter @switchboard/core test -- mint-calendar-receipt.test.ts`
Expected: FAIL — cannot find module "./mint-calendar-receipt.js".

- [ ] **Step 3: Create the ReceiptStore interface (structural-match pattern, mirroring lifecycle/revenue-store.ts:8,41). Create packages/core/src/receipts/receipt-store.ts.**

```ts
import type { Receipt, ReceiptKind, ReceiptTier, ReceiptStatus, ReceiptEvidence } from "@switchboard/schemas";

/** Forwarded opaque tx context (mirrors lifecycle/revenue-store.ts StoreTransactionContext). */
export type StoreTransactionContext = unknown;

export interface MintReceiptInput {
  organizationId: string;
  kind: ReceiptKind;
  tier: ReceiptTier;
  status: ReceiptStatus;
  bookingId?: string | null;
  opportunityId?: string | null;
  revenueEventId?: string | null;
  connectionId?: string | null;
  provider?: string | null;
  externalRef?: string | null;
  amount?: number | null;
  currency?: string | null;
  evidence: ReceiptEvidence;
  capturedBy: string;
  verifiedAt?: Date | null;
  workTraceId?: string | null;
}

export interface ReceiptStore {
  mint(input: MintReceiptInput, tx?: StoreTransactionContext): Promise<Receipt>;
  findByBooking(orgId: string, bookingId: string): Promise<Receipt[]>;
}
```

- [ ] **Step 4: Write the MINIMAL real implementation of the payload builder. Create packages/core/src/receipts/mint-calendar-receipt.ts. It returns the data object the confirm tx will hand to tx.receipt.create. Use clampTierForUntrustedProvider from schemas; clamp whenever the provider is untrusted (R1) — independent of env, but the prod-assert test pins the production case explicitly.**

```ts
import {
  clampTierForUntrustedProvider,
  type ReceiptTier,
  type ReceiptEvidence,
} from "@switchboard/schemas";

export interface BuildCalendarReceiptArgs {
  bookingId: string;
  organizationId: string;
  opportunityId?: string | null;
  workTraceId?: string | null;
  calendarEventId?: string | null;
  /** false for Noop/Local providers that fabricate ids (R1). */
  providerTrusted: boolean;
  requestedTier: ReceiptTier;
  isProduction: boolean;
}

export interface CalendarReceiptData {
  kind: "calendar";
  status: "booked";
  tier: ReceiptTier;
  organizationId: string;
  bookingId: string;
  opportunityId: string | null;
  workTraceId: string | null;
  capturedBy: string;
  evidence: ReceiptEvidence;
}

/**
 * R2: a calendar-confirmed booking is BOOKED, not HELD.
 * R1: an untrusted (Noop/Local) provider can never mint above T3 — clamp regardless
 * of env; the prod-assert test pins isProduction=true explicitly.
 */
export function buildCalendarReceiptData(args: BuildCalendarReceiptArgs): CalendarReceiptData {
  const tier = args.providerTrusted
    ? args.requestedTier
    : clampTierForUntrustedProvider(args.requestedTier);
  return {
    kind: "calendar",
    status: "booked",
    tier,
    organizationId: args.organizationId,
    bookingId: args.bookingId,
    opportunityId: args.opportunityId ?? null,
    workTraceId: args.workTraceId ?? null,
    capturedBy: "calendar-book",
    evidence: {
      kind: "calendar",
      basis: "calendar_confirmed",
      calendarEventId: args.calendarEventId ?? null,
    },
  };
}
```

- [ ] **Step 5: Create the receipts barrel. Create packages/core/src/receipts/index.ts.**

```ts
export * from "./is-paid-visit.js";
export * from "./receipt-store.js";
export * from "./mint-calendar-receipt.js";
```

- [ ] **Step 6: Re-export the receipts barrel from the core index. Open packages/core/src/index.ts and add the export near the other domain barrels (e.g. after the lifecycle export at index.ts:242).**

```ts
// Receipts (Receipt store iface, isPaidVisit verdict, calendar-receipt mint helper)
export * from "./receipts/index.js";
```

- [ ] **Step 7: Run the test and confirm it now PASSES.**

Run: `pnpm --filter @switchboard/core test -- mint-calendar-receipt.test.ts`
Expected: PASS — booked status + prod-assert clamp green.

- [ ] **Step 8: Typecheck core to confirm the new barrel exports resolve and there are no `any` leaks.**

Run: `pnpm --filter @switchboard/core typecheck`
Expected: PASS — no type errors. (If it reports missing @switchboard/schemas exports, run `pnpm reset` then retry — stale dist.)

- [ ] **Step 9: Commit.**

Run: `git add packages/core/src/receipts/receipt-store.ts packages/core/src/receipts/mint-calendar-receipt.ts packages/core/src/receipts/mint-calendar-receipt.test.ts packages/core/src/receipts/index.ts packages/core/src/index.ts && git commit -m "feat(core): receipt store interface and calendar-receipt mint builder with prod-assert"`
Expected: Commit succeeds.


#### Task 4: Task 4 — Receipt Prisma model + raw-SQL partial-unique migration (db, same commit)

**Files:**
- Create: `packages/db/prisma/migrations/20260606120000_add_receipt/migration.sql`
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add the Receipt model to the Prisma schema. Open packages/db/prisma/schema.prisma and insert the model immediately after the ConversionRecord model (which ends near schema.prisma:2054). Keep the sync comment about the partial-unique living in raw SQL (Prisma 6 cannot express it — same pattern noted on the Booking model at schema.prisma:2004-2006).**

```ts
// ---------------------------------------------------------------------------
// Receipt — shared proof primitive (calendar | payment). isPaidVisit reads tier+status.
// The (organizationId, kind, externalRef) PARTIAL UNIQUE (WHERE externalRef IS NOT NULL)
// is raw SQL in migration 20260606120000_add_receipt (Prisma 6 cannot express partial
// unique in-schema; same pattern as Booking 20260603120000). Keep this comment in sync.
// ---------------------------------------------------------------------------

model Receipt {
  id             String    @id @default(uuid())
  organizationId String
  kind           String // calendar | payment
  tier           String // T1_FETCH_BACK | T2_PROVIDER_SIGNATURE | T3_ADMIN_AUDIT
  status         String // booked | held | paid | void
  bookingId      String?
  opportunityId  String?
  revenueEventId String?
  connectionId   String?
  provider       String?
  externalRef    String?
  amount         Int?
  currency       String?
  evidence       Json
  capturedBy     String
  verifiedAt     DateTime?
  workTraceId    String?
  createdAt      DateTime  @default(now())

  @@index([organizationId, bookingId])
  @@index([organizationId, kind, status])
}
```

- [ ] **Step 2: Author the migration BY HAND (do not run `prisma migrate dev` — it needs a TTY and Postgres). Create packages/db/prisma/migrations/20260606120000_add_receipt/migration.sql. CREATE TABLE mirrors the 20260602093000_add_scheduled_reminder style; the partial UNIQUE mirrors 20260603120000_booking_partial_unique_active.**

```ts
-- Receipt: shared calendar|payment proof primitive (spec 1A-3).
-- The partial UNIQUE on (organizationId, kind, externalRef) WHERE externalRef IS NOT NULL
-- dedupes externally-referenced receipts (PSP charge id / external event id) without
-- blocking the many calendar receipts that have a NULL externalRef. Prisma 6 cannot
-- express a partial unique in-schema (same pattern as 20260603120000_booking_partial_unique_active).
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "bookingId" TEXT,
    "opportunityId" TEXT,
    "revenueEventId" TEXT,
    "connectionId" TEXT,
    "provider" TEXT,
    "externalRef" TEXT,
    "amount" INTEGER,
    "currency" TEXT,
    "evidence" JSONB NOT NULL,
    "capturedBy" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "workTraceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Receipt_organizationId_bookingId_idx" ON "Receipt"("organizationId", "bookingId");

-- CreateIndex
CREATE INDEX "Receipt_organizationId_kind_status_idx" ON "Receipt"("organizationId", "kind", "status");

-- Partial unique: dedupe externally-referenced receipts only (NULL externalRef allowed many).
CREATE UNIQUE INDEX "Receipt_org_kind_externalRef_key"
  ON "Receipt" ("organizationId", "kind", "externalRef")
  WHERE "externalRef" IS NOT NULL;
```

- [ ] **Step 3: Regenerate the Prisma client so the new Receipt delegate (prisma.receipt) is typed for Tasks 5-6.**

Run: `pnpm db:generate`
Expected: Prisma client regenerated; output mentions Receipt model. No errors.

- [ ] **Step 4: Confirm the index name is within Postgres' 63-char identifier cap (hand migrations must match Prisma's expectation or drift fails). Receipt_org_kind_externalRef_key is 33 chars — safe.**

Run: `node -e "const n='Receipt_org_kind_externalRef_key';console.log(n.length, n.length<=63?'OK':'TOO_LONG')"`
Expected: 33 OK

- [ ] **Step 5: Commit the schema + migration together (schema change and its migration MUST be in the same commit).**

Run: `git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260606120000_add_receipt/migration.sql && git commit -m "feat(db): receipt model with partial-unique on external ref"`
Expected: Commit succeeds; both files in one commit.


#### Task 5: Task 5 — L4 PrismaReceiptStore (mocked-Prisma tests, org-scoped, structural-match)

**Files:**
- Create: `packages/db/src/stores/prisma-receipt-store.ts`
- Create: `packages/db/src/stores/__tests__/prisma-receipt-store.test.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/stores/__tests__/prisma-receipt-store.test.ts`

- [ ] **Step 1: Write the FAILING test first. Create packages/db/src/stores/__tests__/prisma-receipt-store.test.ts. MOCK Prisma (CI has no Postgres) mirroring prisma-revenue-store.test.ts. Assert tx-threading (uses tx client when provided, else this.prisma) and that findByBooking scopes where to {organizationId, bookingId}. It imports PrismaReceiptStore which does not exist yet.**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaReceiptStore } from "../prisma-receipt-store.js";

const now = new Date("2026-06-06T12:00:00Z");

function makeMockPrisma() {
  return {
    receipt: {
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "rcpt-1",
    organizationId: "org-1",
    kind: "calendar",
    tier: "T1_FETCH_BACK",
    status: "booked",
    bookingId: "bk-1",
    opportunityId: "opp-1",
    revenueEventId: null,
    connectionId: null,
    provider: null,
    externalRef: null,
    amount: null,
    currency: null,
    evidence: { kind: "calendar", basis: "calendar_confirmed", calendarEventId: "gcal_1" },
    capturedBy: "calendar-book",
    verifiedAt: null,
    workTraceId: "wt-1",
    createdAt: now,
    ...overrides,
  };
}

const mintInput = {
  organizationId: "org-1",
  kind: "calendar" as const,
  tier: "T1_FETCH_BACK" as const,
  status: "booked" as const,
  bookingId: "bk-1",
  capturedBy: "calendar-book",
  evidence: { kind: "calendar" as const, basis: "calendar_confirmed" as const, calendarEventId: "gcal_1" },
};

describe("PrismaReceiptStore", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let store: PrismaReceiptStore;

  beforeEach(() => {
    prisma = makeMockPrisma();
    store = new PrismaReceiptStore(prisma as never);
  });

  it("mint uses tx client instead of this.prisma when tx is provided", async () => {
    const txClient = { receipt: { create: vi.fn().mockResolvedValue(makeRow()) } };
    const result = await store.mint(mintInput, txClient as never);
    expect(txClient.receipt.create).toHaveBeenCalledTimes(1);
    expect(prisma.receipt.create).not.toHaveBeenCalled();
    expect(result.status).toBe("booked");
  });

  it("mint falls back to this.prisma when no tx is provided", async () => {
    prisma.receipt.create.mockResolvedValue(makeRow());
    await store.mint(mintInput);
    expect(prisma.receipt.create).toHaveBeenCalledTimes(1);
    expect(prisma.receipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: expect.any(String),
        organizationId: "org-1",
        kind: "calendar",
        status: "booked",
        bookingId: "bk-1",
      }),
    });
  });

  it("findByBooking scopes the where clause to organizationId AND bookingId", async () => {
    prisma.receipt.findMany.mockResolvedValue([makeRow()]);
    const result = await store.findByBooking("org-1", "bk-1");
    expect(prisma.receipt.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", bookingId: "bk-1" },
      orderBy: { createdAt: "desc" },
    });
    expect(result[0]!.id).toBe("rcpt-1");
  });
});
```

- [ ] **Step 2: Run the test and confirm it FAILS (module does not exist).**

Run: `pnpm --filter @switchboard/db test -- prisma-receipt-store.test.ts`
Expected: FAIL — cannot find module "../prisma-receipt-store.js".

- [ ] **Step 3: Write the MINIMAL real implementation. Create packages/db/src/stores/prisma-receipt-store.ts mirroring prisma-revenue-store.ts (local structural-match iface + class + mapper). mint() generates the id and threads tx; findByBooking() is org-scoped; mapRowToReceipt casts the row to the schema type (evidence is Json — cast through the discriminated union type, no `any`).**

```ts
import { randomUUID } from "node:crypto";
import type { PrismaDbClient } from "../prisma-db.js";
import type { Receipt, ReceiptEvidence, MintReceiptInput, ReceiptStore } from "@switchboard/core";

// Structural match with @switchboard/core ReceiptStore (db imports core types directly;
// the local re-import keeps the impl decoupled from core internals, mirroring
// prisma-revenue-store.ts). If drift becomes a problem, hoist into @switchboard/schemas.

export class PrismaReceiptStore implements ReceiptStore {
  constructor(private prisma: PrismaDbClient) {}

  async mint(input: MintReceiptInput, tx?: PrismaDbClient): Promise<Receipt> {
    const client = tx ?? this.prisma;
    const created = await client.receipt.create({
      data: {
        id: randomUUID(),
        organizationId: input.organizationId,
        kind: input.kind,
        tier: input.tier,
        status: input.status,
        bookingId: input.bookingId ?? null,
        opportunityId: input.opportunityId ?? null,
        revenueEventId: input.revenueEventId ?? null,
        connectionId: input.connectionId ?? null,
        provider: input.provider ?? null,
        externalRef: input.externalRef ?? null,
        amount: input.amount ?? null,
        currency: input.currency ?? null,
        evidence: input.evidence,
        capturedBy: input.capturedBy,
        verifiedAt: input.verifiedAt ?? null,
        workTraceId: input.workTraceId ?? null,
      },
    });
    return mapRowToReceipt(created);
  }

  async findByBooking(orgId: string, bookingId: string): Promise<Receipt[]> {
    const rows = await this.prisma.receipt.findMany({
      where: { organizationId: orgId, bookingId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(mapRowToReceipt);
  }
}

interface ReceiptRow {
  id: string;
  organizationId: string;
  kind: string;
  tier: string;
  status: string;
  bookingId: string | null;
  opportunityId: string | null;
  revenueEventId: string | null;
  connectionId: string | null;
  provider: string | null;
  externalRef: string | null;
  amount: number | null;
  currency: string | null;
  evidence: unknown;
  capturedBy: string;
  verifiedAt: Date | null;
  workTraceId: string | null;
  createdAt: Date;
}

function mapRowToReceipt(row: ReceiptRow): Receipt {
  return {
    id: row.id,
    organizationId: row.organizationId,
    kind: row.kind as Receipt["kind"],
    tier: row.tier as Receipt["tier"],
    status: row.status as Receipt["status"],
    bookingId: row.bookingId,
    opportunityId: row.opportunityId,
    revenueEventId: row.revenueEventId,
    connectionId: row.connectionId,
    provider: row.provider,
    externalRef: row.externalRef,
    amount: row.amount,
    currency: row.currency,
    evidence: row.evidence as ReceiptEvidence,
    capturedBy: row.capturedBy,
    verifiedAt: row.verifiedAt,
    workTraceId: row.workTraceId,
    createdAt: row.createdAt,
  };
}
```

- [ ] **Step 4: Export the store from the db barrel. Open packages/db/src/index.ts and add the export after the PrismaRevenueStore export (index.ts:73).**

```ts
export { PrismaRevenueStore } from "./stores/prisma-revenue-store.js";
export { PrismaReceiptStore } from "./stores/prisma-receipt-store.js";
```

- [ ] **Step 5: Run the test and confirm it now PASSES.**

Run: `pnpm --filter @switchboard/db test -- prisma-receipt-store.test.ts`
Expected: PASS — tx-threading + org-scoped findByBooking + mapper green.

- [ ] **Step 6: Typecheck db (the new store imports core types; confirms the client has the receipt delegate from Task 4).**

Run: `pnpm --filter @switchboard/db typecheck`
Expected: PASS — no type errors. (If `prisma.receipt` is reported missing, run `pnpm db:generate` then retry.)

- [ ] **Step 7: Commit.**

Run: `git add packages/db/src/stores/prisma-receipt-store.ts packages/db/src/stores/__tests__/prisma-receipt-store.test.ts packages/db/src/index.ts && git commit -m "feat(db): prismareceiptstore with org-scoped reads"`
Expected: Commit succeeds.


#### Task 6: Task 6 — Mint the booked CalendarReceipt inside the calendar-book confirm tx + wire tier resolver at apps/api (core + apps/api)

**Files:**
- Modify: `packages/core/src/skill-runtime/tools/calendar-book.ts`
- Modify: `packages/core/src/skill-runtime/tools/calendar-book.test.ts`
- Modify: `apps/api/src/bootstrap/skill-mode.ts`
- Test: `packages/core/src/skill-runtime/tools/calendar-book.test.ts`

- [ ] **Step 1: Inspect the existing calendar-book test factory so the new deps/tx members are added consistently (find the mock tx + deps construction and the booking.create confirm path).**

Run: `grep -n "runTransaction\|receipt\|isProduction\|outboxEvent\|createCalendarBookToolFactory(\|defaultCurrency" packages/core/src/skill-runtime/tools/calendar-book.test.ts`
Expected: Shows the mock runTransaction tx object (booking/outboxEvent/opportunity) and the deps passed to createCalendarBookToolFactory — the seams to extend. No receipt/isProduction yet.

- [ ] **Step 2: Write the FAILING test addition first. In packages/core/src/skill-runtime/tools/calendar-book.test.ts, (a) add a `receipt: { create: vi.fn() }` member to the mock tx object the test passes through runTransaction, (b) add `receiptTierForProvider: () => "T1_FETCH_BACK"` and `isProduction: false` to the deps in the factory under test, and (c) add a new assertion that a successful booking.create calls tx.receipt.create with a booked receipt. Paste this new test into the existing booking.create describe block.**

```ts
it("mints a booked CalendarReceipt in the confirm transaction", async () => {
  // Arrange: provider returns a calendar event id (success path).
  // (Reuse the file's existing happy-path setup for provider + stores; this block
  //  only adds the receipt assertion. tx.receipt.create is on the mock tx object.)
  const result = await tool.operations["booking.create"]!.execute({
    service: "botox",
    slotStart: "2026-07-01T10:00:00Z",
    slotEnd: "2026-07-01T11:00:00Z",
    calendarId: "cal-1",
  });
  expect(result.ok).toBe(true);
  expect(tx.receipt.create).toHaveBeenCalledTimes(1);
  const arg = tx.receipt.create.mock.calls[0]![0] as { data: { status: string; kind: string; tier: string } };
  expect(arg.data.status).toBe("booked");
  expect(arg.data.kind).toBe("calendar");
  expect(arg.data.tier).toBe("T1_FETCH_BACK");
});
```

- [ ] **Step 3: Run the calendar-book test and confirm the NEW case FAILS (tx.receipt.create never called yet; and types: receiptTierForProvider/isProduction not on deps).**

Run: `pnpm --filter @switchboard/core test -- calendar-book.test.ts`
Expected: FAIL — the new "mints a booked CalendarReceipt" expectation fails (receipt.create not called); other cases still pass.

- [ ] **Step 4: Extend the tx type and deps in calendar-book.ts. (1) In the TransactionFn tx object type (calendar-book.ts:70-83) add a `receipt` member. (2) In CalendarBookToolDeps add the injected tier resolver + production flag. Import the builder from the receipts module.**

```ts
import { buildCalendarReceiptData } from "../../receipts/mint-calendar-receipt.js";
import type { ReceiptTier } from "@switchboard/schemas";

// --- inside TransactionFn tx object type, alongside booking/outboxEvent/opportunity ---
    receipt: {
      create(args: { data: Record<string, unknown> }): Promise<unknown>;
    };

// --- inside CalendarBookToolDeps ---
  /** Maps the resolved provider to its evidence tier. Injected at the apps/api wiring
   *  site because CalendarProvider has no kind discriminator and core must not read env. */
  receiptTierForProvider: (provider: CalendarProvider) => ReceiptTier;
  /** True in production. Untrusted (Noop/Local) providers are clamped to T3 regardless;
   *  this flag pins the R1 prod-assert at the call site. */
  isProduction: boolean;
```

- [ ] **Step 5: Mint the receipt inside the confirm tx. In the runTransaction callback (calendar-book.ts:343-394), after the tx.outboxEvent.create call, build the data via buildCalendarReceiptData and call tx.receipt.create. A trusted provider is one the deps classify above T3; compute providerTrusted from the resolver result.**

```ts
              const requestedTier = deps.receiptTierForProvider(provider);
              const providerTrusted = requestedTier !== "T3_ADMIN_AUDIT";
              const receiptData = buildCalendarReceiptData({
                bookingId: booking.id,
                organizationId: orgId,
                opportunityId,
                calendarEventId: calendarResult.calendarEventId ?? null,
                providerTrusted,
                requestedTier,
                isProduction: deps.isProduction,
              });
              await tx.receipt.create({ data: receiptData });
```

- [ ] **Step 6: Wire the injected deps at the apps/api composition root. In apps/api/src/bootstrap/skill-mode.ts, extend the createCalendarBookToolFactory deps (skill-mode.ts:307-350): (1) add `receipt: tx.receipt` to the runTransaction passthrough (skill-mode.ts:345-346), (2) add the runTransaction tx-type `receipt` member to match core, (3) add receiptTierForProvider classifying Noop/Local as T3 (using isNoopCalendarProvider already imported, plus a name check for the Local provider's fabricated ids), (4) add isProduction from the API's env helper.**

```ts
    // --- in the runTransaction tx-type, alongside booking/outboxEvent/opportunity ---
        receipt: {
          create(args: { data: Record<string, unknown> }): Promise<unknown>;
        };
    // --- in the prismaClient.$transaction passthrough ---
      prismaClient.$transaction((tx) =>
        fn({
          booking: tx.booking,
          outboxEvent: tx.outboxEvent,
          opportunity: tx.opportunity,
          receipt: tx.receipt,
        }),
      ),
    // --- alongside isCalendarProviderConfigured / defaultCurrency ---
    receiptTierForProvider: (provider) =>
      isNoopCalendarProvider(provider) || provider.constructor.name === "LocalCalendarProvider"
        ? "T3_ADMIN_AUDIT"
        : "T1_FETCH_BACK",
    isProduction: process.env["NODE_ENV"] === "production",
```

- [ ] **Step 7: Run the calendar-book test and confirm it now PASSES.**

Run: `pnpm --filter @switchboard/core test -- calendar-book.test.ts`
Expected: PASS — including the new booked-receipt case; pre-existing cases still green.

- [ ] **Step 8: Confirm calendar-book.ts stayed under the 400-line warn threshold (logic was delegated to the helper, not inlined).**

Run: `node -e "const l=require('fs').readFileSync('packages/core/src/skill-runtime/tools/calendar-book.ts','utf8').split('\n').length;console.log(l, l<400?'OK':'EXTRACT_MORE')"`
Expected: A number below 400 and OK (started at 439? if over, move the providerTrusted computation into the helper — but the delta here is ~10 lines added; verify).

- [ ] **Step 9: Typecheck core and apps/api together to confirm the tx-type and deps line up across the L3/L5 boundary.**

Run: `pnpm --filter @switchboard/core typecheck && pnpm --filter @switchboard/api typecheck`
Expected: PASS for both. (If apps/api reports the tx `receipt` member missing, the schema client is stale — run `pnpm db:generate` then retry.)

- [ ] **Step 10: Run the broader touched-package suites to confirm no regression in the booking flow or db stores.**

Run: `pnpm --filter @switchboard/core test -- skill-runtime/tools && pnpm --filter @switchboard/db test -- stores`
Expected: PASS — calendar-book and receipt store suites green; no other store regressions.

- [ ] **Step 11: Commit.**

Run: `git add packages/core/src/skill-runtime/tools/calendar-book.ts packages/core/src/skill-runtime/tools/calendar-book.test.ts apps/api/src/bootstrap/skill-mode.ts && git commit -m "feat(core,api): mint booked calendar receipt in confirm tx with injected tier resolver"`
Expected: Commit succeeds.


---

## 1A-4a — feat(schemas,api,core): paymentport + noop deposit issuance

**Goal:** Land the L1 PaymentPort seam (mirror of CalendarProvider) with exactly two methods — createDepositLink and retrievePayment — plus its Zod schemas/types; a NoopPaymentAdapter + per-org payment-port factory in apps/api that mints a DETERMINISTIC externalReference (noop_pay_${bookingId}) and a provider='noop' DEGRADED VerifiedPayment (R1: never a production-countable T1 paid visit); and an idempotent deposit-link tool in core that issues a link against an already-approved confirmed booking (no webhook, no verified writer, no schema migration). This PR proves the deposit-issuance mechanics in isolation so PR 1A-4 can add the fetch-back webhook and verified Receipt writer on top.

**File structure:**

| Action | Path | Responsibility |
|---|---|---|
| create | `packages/schemas/src/payment.ts` | L1 PaymentPort interface (createDepositLink, retrievePayment only) + Zod schemas/types: DepositLinkInputSchema/DepositLinkInput, DepositLinkSchema/DepositLink, PaymentStatusSchema, VerifiedPaymentSchema/VerifiedPayment (carries provider, amountCents, currency, status). Mirrors calendar.ts. No @switchboard/* imports. |
| create | `packages/schemas/src/payment.test.ts` | Co-located Zod unit tests: VerifiedPaymentSchema validates a provider='noop' degraded payment; rejects negative amountCents; DepositLinkSchema requires url+externalReference+amountCents; status enum = booked|held|paid|void rejected vs payment status pending|paid|failed|refunded. |
| modify | `packages/schemas/src/index.ts` | Add barrel re-export `export * from "./payment.js";` mirroring the existing `export * from "./calendar.js";`. |
| modify | `packages/schemas/package.json` | Add the `"./payment"` subpath export block (types+import to ./dist/payment.*) mirroring the existing `"./calendar"` block. |
| create | `apps/api/src/bootstrap/noop-payment-adapter.ts` | NoopPaymentAdapter implements PaymentPort: createDepositLink fabricates deterministic externalReference `noop_pay_${input.bookingId}` + a deterministic url; retrievePayment returns VerifiedPayment{provider:'noop', status:'paid', amountCents, currency} (R1 DEGRADED) or null. Exports isNoopPaymentAdapter guard. Mirrors noop-calendar-provider.ts. |
| create | `apps/api/src/bootstrap/noop-payment-adapter.test.ts` | Co-located tests: createDepositLink is DETERMINISTIC per bookingId (same ref twice); externalReference === `noop_pay_<bookingId>`; retrievePayment returns provider='noop'; isNoopPaymentAdapter true for instance, false for a plain object. |
| create | `apps/api/src/bootstrap/payment-port-factory.ts` | Per-org payment-port factory: createPaymentPortFactory(deps) -> (orgId)=>Promise<PaymentPort> with the same memoization+reject-eviction+ORG_ID_REQUIRED shape as calendar-provider-factory.ts; returns NoopPaymentAdapter when no Stripe env present (Stripe adapter is PR 1A-4b). |
| create | `apps/api/src/bootstrap/__tests__/payment-port-factory.test.ts` | Tests mirror calendar-provider-factory.test.ts: rejects ORG_ID_REQUIRED on empty/whitespace orgId; returns NoopPaymentAdapter when no env; memoizes per orgId (same Promise); independent per orgId; rejected construction cleared from cache. |
| create | `packages/core/src/skill-runtime/tools/deposit-link.ts` | L3 factory-with-context deposit-link tool (createDepositLinkToolFactory). effectCategory:'read', idempotent:true (idempotent external read, no new approval). Sources orgId from ctx, bookingId from params; injected findById(orgId,bookingId) + injected PaymentPort; fails MISSING_BOOKING / BOOKING_NOT_CONFIRMED; returns ok({url, externalReference, amountCents}). Co-located so calendar-book.ts is untouched. |
| create | `packages/core/src/skill-runtime/tools/deposit-link.test.ts` | Co-located tool tests: factory id; happy path returns ok with deterministic externalReference; MISSING_BOOKING when findById returns null; BOOKING_NOT_CONFIRMED when status!=='confirmed'; orgId comes from ctx not params (passes a malicious params.orgId, asserts findById called with ctx.orgId); idempotent (two calls -> same externalReference). |
| modify | `packages/core/src/skill-runtime/tools/index.ts` | Re-export the new tool: `export { createDepositLinkToolFactory } from "./deposit-link.js";` + `export type { DepositLinkToolFactory } from "./deposit-link.js";` mirroring the calendar-book/escalate lines. |

**Notes:** SCOPE GUARD — this PR is 1A-4a ONLY: PaymentPort + Noop deposit issuance. NO webhook, NO verified writer, NO schema/migration, NO Stripe adapter (1A-4b). Verified at: spec §10 item 4 (1A-4) and §3 item 4. The full 1A-4 webhook/verified-writer/DB-unique work is a SEPARATE downstream PR that builds on this.

KEY DESIGN DECISIONS + repo evidence:
1. effectCategory for deposit.issue = "read" (not a fabricated "external_read"). The EffectCategory union (packages/core/src/skill-runtime/governance-types.ts:1-8) is read|propose|simulate|write|external_send|external_mutation|irreversible. Spec §8 says deposit-link issuance is "an idempotent external read riding on the already-approved booking — no new approval." "read"+idempotent:true keeps it off the approval path; calendar-book's booking.create uses external_mutation (which CAN gate) and that is deliberately NOT what we want here. This choice is documented inline in the tool.
2. PaymentPort lives in L1 schemas (packages/schemas/src/payment.ts), exactly mirroring CalendarProvider (packages/schemas/src/calendar.ts:92-99). The deposit-link tool (L3 core) depends only on the L1 PaymentPort TYPE and an injected per-org PaymentPortFactory — core never imports apps/api, preserving layering (CLAUDE.md L3 rules).
3. R1 (Noop never mints production-countable T1): enforced at the adapter — NoopPaymentAdapter.retrievePayment always returns provider:'noop'. A test asserts provider==='noop'. The PROD-ASSERT that a noop payment can never appear as a real T1 paid visit in production lives in the verified-writer/metric PR (1A-4 / 1A-5), since this PR has no writer or metric — there is nothing to exclude yet. Flagged so the next author wires the env-gated exclusion + test.
4. Determinism (R1): externalReference = `noop_pay_${bookingId}` (literally required by the prompt). Test asserts the exact string and replay-equality.
5. R2 (booked != held) is NOT touched here — there is no Receipt/CalendarReceipt in this PR (that is 1A-3, already sequenced earlier). PaymentStatusSchema (pending|paid|failed|refunded) is the PSP charge lifecycle and is intentionally DISTINCT from the Receipt status enum (booked|held|paid|void); a comment in payment.ts records this so a later author does not conflate them.
6. PaymentStatus deliberately does NOT include "held"/"void" — those belong to the Receipt status enum landed in PR 1A-3; this is the raw provider charge state only.

TEST PATTERN SOURCES (mirrored, not guessed): factory-with-context tool tests -> packages/core/src/skill-runtime/tools/escalate.test.ts:37-156; per-org factory tests (memoization + reject-eviction + ORG_ID_REQUIRED) -> apps/api/src/bootstrap/__tests__/calendar-provider-factory.test.ts:17-167; guard test -> apps/api/src/bootstrap/__tests__/noop-calendar-provider.test.ts:1-20; Zod schema tests -> packages/schemas/src/lead-intake.test.ts:1-40. Tool factory + ok/fail signatures verified at packages/core/src/skill-runtime/tool-result.ts:26-93 and tools/escalate.ts:22-83. SkillRequestContext.surface enum ("chat"|"simulation"|"api"|"system") verified at packages/core/src/skill-runtime/types.ts:406-421.

DEPS-INJECTION NOTE for the next author: the deposit-link tool takes depositAmountCents + defaultCurrency as injected deps (mirroring calendar-book.ts:117-119 defaultCurrency). Per-org deposit pricing is future work; wiring the factory into the skill runtime (skill-mode.ts) is part of the downstream 1A-4 PR, not this one — this PR only defines+unit-tests the tool factory in isolation, matching de-risk step ordering in spec §12.

COMMAND NOTE: tests are invoked via `pnpm --filter <pkg> exec vitest run <path>` (the package "test" script is `vitest run` per packages/{core,schemas}/package.json and apps/api/package.json). Paths are package-relative. Package names: @switchboard/schemas, @switchboard/core, @switchboard/api.

CLAUDE.md compliance: ESM with .js relative imports throughout; no `any` (stubs use typed vi.fn + `as never` only in guard negative-cases, matching the existing noop-calendar-provider.test.ts:10-18 precedent); co-located *.test.ts for every new module; conventional-commit lowercase subjects; all new files << 400 lines. No Prisma mutations in this PR (factory needs no DB; the Noop adapter is in-memory), so the updateMany/count===0 and DB-mock rules do not apply here — they bind the verified-writer PR (1A-4).

#### Task 1: Task 1 — L1 PaymentPort + Zod schemas/types in @switchboard/schemas

**Files:**
- Create: `packages/schemas/src/payment.ts`
- Create: `packages/schemas/src/payment.test.ts`
- Modify: `packages/schemas/src/index.ts`
- Modify: `packages/schemas/package.json`
- Test: `packages/schemas/src/payment.test.ts`

- [ ] **Step 1: Write the FAILING test first. Create packages/schemas/src/payment.test.ts importing from the not-yet-existing ./payment.js. It pins the contract: VerifiedPaymentSchema accepts a provider='noop' degraded payment, rejects a negative amountCents, and DepositLinkSchema requires url+externalReference+amountCents. Mirror the describe/it style at packages/schemas/src/lead-intake.test.ts:1-20.**

```ts
import { describe, it, expect } from "vitest";
import {
  VerifiedPaymentSchema,
  DepositLinkSchema,
  DepositLinkInputSchema,
} from "./payment.js";

describe("VerifiedPaymentSchema", () => {
  it("validates a provider='noop' degraded payment", () => {
    const parsed = VerifiedPaymentSchema.parse({
      provider: "noop",
      amountCents: 5000,
      currency: "SGD",
      status: "paid",
      externalReference: "noop_pay_bk_1",
    });
    expect(parsed.provider).toBe("noop");
    expect(parsed.amountCents).toBe(5000);
  });

  it("rejects a negative amountCents", () => {
    expect(() =>
      VerifiedPaymentSchema.parse({
        provider: "noop",
        amountCents: -1,
        currency: "SGD",
        status: "paid",
        externalReference: "noop_pay_bk_1",
      }),
    ).toThrow();
  });
});

describe("DepositLinkSchema", () => {
  it("requires url, externalReference and amountCents", () => {
    expect(() => DepositLinkSchema.parse({ url: "https://x" })).toThrow();
    const ok = DepositLinkSchema.parse({
      url: "https://pay.example/noop_pay_bk_1",
      externalReference: "noop_pay_bk_1",
      amountCents: 5000,
      currency: "SGD",
    });
    expect(ok.externalReference).toBe("noop_pay_bk_1");
  });
});

describe("DepositLinkInputSchema", () => {
  it("requires bookingId, organizationId, amountCents and currency", () => {
    const ok = DepositLinkInputSchema.parse({
      bookingId: "bk_1",
      organizationId: "org_1",
      amountCents: 5000,
      currency: "SGD",
    });
    expect(ok.bookingId).toBe("bk_1");
    expect(() => DepositLinkInputSchema.parse({ bookingId: "bk_1" })).toThrow();
  });
});

```

- [ ] **Step 2: Run the test and confirm it FAILS because ./payment.js does not exist yet.**

Run: `pnpm --filter @switchboard/schemas exec vitest run src/payment.test.ts`
Expected: FAIL — module resolution / import error: Cannot find module './payment.js' (or 'Failed to load'). No tests pass.

- [ ] **Step 3: Write the minimal real implementation. Create packages/schemas/src/payment.ts. It defines the Zod schemas + inferred types and the PaymentPort interface with EXACTLY two methods. Structure mirrors packages/schemas/src/calendar.ts (Schema then `export type X = z.infer<...>` then the interface at the bottom; calendar.ts:92-99 is the CalendarProvider precedent). PaymentStatus is the PSP payment lifecycle (pending|paid|failed|refunded) and is DISTINCT from the Receipt status enum (booked|held|paid|void, landed in a later PR). amountCents is a non-negative integer (cents end-to-end per spec §11). provider is a free string so the Noop adapter can stamp 'noop' and the Stripe adapter 'stripe' in PR 1A-4b.**

```ts
import { z } from "zod";

/**
 * PSP payment lifecycle status. DISTINCT from the Receipt status enum
 * (booked|held|paid|void) introduced in PR 1A-3 — this is the raw provider
 * charge state, not the structured visit verdict.
 */
export const PaymentStatusSchema = z.enum(["pending", "paid", "failed", "refunded"]);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

/**
 * Input to PaymentPort.createDepositLink. The deposit is keyed to an already
 * confirmed booking; amount flows as minor units (cents) end-to-end (spec §11).
 */
export const DepositLinkInputSchema = z.object({
  bookingId: z.string().min(1),
  organizationId: z.string().min(1),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().min(1),
});
export type DepositLinkInput = z.infer<typeof DepositLinkInputSchema>;

/**
 * A first-party deposit link issued for a confirmed booking. `externalReference`
 * is the PSP-side handle the webhook (PR 1A-4) re-fetches the charge by — for the
 * Noop adapter it is the DETERMINISTIC `noop_pay_${bookingId}`.
 */
export const DepositLinkSchema = z.object({
  url: z.string().min(1),
  externalReference: z.string().min(1),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().min(1),
});
export type DepositLink = z.infer<typeof DepositLinkSchema>;

/**
 * The result of re-fetching a charge by its external reference. The verified
 * writer (PR 1A-4) trusts THIS object's amount, never a webhook body. A payment
 * whose `provider` is 'noop' is DEGRADED and must never be counted as a real
 * (T1) production paid visit (spec §3, R1).
 */
export const VerifiedPaymentSchema = z.object({
  provider: z.string().min(1),
  externalReference: z.string().min(1),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().min(1),
  status: PaymentStatusSchema,
});
export type VerifiedPayment = z.infer<typeof VerifiedPaymentSchema>;

/**
 * No-PMS payment seam (architecture A). Mirrors `CalendarProvider`
 * (calendar.ts). EXACTLY two methods — link issuance and a fetch-back read.
 * Concrete adapters (Noop now, Stripe Connect in PR 1A-4b) live in apps/api;
 * orchestration + the PSP webhook live in apps/api, never in this layer.
 */
export interface PaymentPort {
  createDepositLink(input: DepositLinkInput): Promise<DepositLink>;
  retrievePayment(externalReference: string): Promise<VerifiedPayment | null>;
}

```

- [ ] **Step 4: Wire the barrel export. Edit packages/schemas/src/index.ts to add the payment re-export. Place it next to the existing calendar export (index.ts:127 is `export * from "./calendar.js";`).**

```ts
// Add this line near the existing `export * from "./calendar.js";` line:
export * from "./payment.js";
```

- [ ] **Step 5: Add the subpath export to packages/schemas/package.json. Mirror the existing `"./calendar"` block (package.json:141). Add a `"./payment"` block inside the `"exports"` object (e.g. immediately after the `"./calendar"` block — JSON object key order is irrelevant, but keep valid commas).**

```ts
    "./payment": {
      "types": "./dist/payment.d.ts",
      "import": "./dist/payment.js"
    }
```

- [ ] **Step 6: Run the test again and confirm it PASSES.**

Run: `pnpm --filter @switchboard/schemas exec vitest run src/payment.test.ts`
Expected: PASS — all tests in payment.test.ts green (VerifiedPaymentSchema x2, DepositLinkSchema x1, DepositLinkInputSchema x1).

- [ ] **Step 7: Rebuild schemas so downstream packages (api, core) resolve the new ./payment subpath and barrel symbols from dist/ (CLAUDE.md: lower-layer dist staleness causes false 'missing export' errors).**

Run: `pnpm --filter @switchboard/schemas build`
Expected: tsc completes with no errors; dist/payment.js and dist/payment.d.ts are emitted.

- [ ] **Step 8: Commit. Verify branch context first per CLAUDE.md branch doctrine.**

Run: `git add packages/schemas/src/payment.ts packages/schemas/src/payment.test.ts packages/schemas/src/index.ts packages/schemas/package.json && git commit -m "feat(schemas): paymentport interface + deposit/verified-payment zod schemas"`
Expected: Commit succeeds; commitlint accepts the lowercase subject.


#### Task 2: Task 2 — NoopPaymentAdapter + isNoopPaymentAdapter guard (apps/api)

**Files:**
- Create: `apps/api/src/bootstrap/noop-payment-adapter.ts`
- Create: `apps/api/src/bootstrap/noop-payment-adapter.test.ts`
- Test: `apps/api/src/bootstrap/noop-payment-adapter.test.ts`

- [ ] **Step 1: Write the FAILING test. Create apps/api/src/bootstrap/noop-payment-adapter.test.ts. It pins R1's two non-negotiables: the externalReference is DETERMINISTIC `noop_pay_<bookingId>` (replay-safe) and retrievePayment is provider='noop' (degraded). Mirror the guard-test shape at apps/api/src/bootstrap/__tests__/noop-calendar-provider.test.ts:1-20 (kept here co-located with the adapter, same dir as the source).**

```ts
import { describe, it, expect } from "vitest";
import { NoopPaymentAdapter, isNoopPaymentAdapter } from "./noop-payment-adapter.js";

const INPUT = {
  bookingId: "bk_1",
  organizationId: "org_1",
  amountCents: 5000,
  currency: "SGD",
};

describe("NoopPaymentAdapter.createDepositLink", () => {
  it("fabricates a deterministic externalReference per bookingId", async () => {
    const adapter = new NoopPaymentAdapter();
    const a = await adapter.createDepositLink(INPUT);
    const b = await adapter.createDepositLink(INPUT);
    expect(a.externalReference).toBe("noop_pay_bk_1");
    expect(b.externalReference).toBe(a.externalReference);
    expect(a.amountCents).toBe(5000);
    expect(a.url).toContain("noop_pay_bk_1");
  });
});

describe("NoopPaymentAdapter.retrievePayment", () => {
  it("returns a provider='noop' DEGRADED verified payment", async () => {
    const adapter = new NoopPaymentAdapter();
    const vp = await adapter.retrievePayment("noop_pay_bk_1");
    expect(vp).not.toBeNull();
    expect(vp!.provider).toBe("noop");
    expect(vp!.status).toBe("paid");
    expect(vp!.externalReference).toBe("noop_pay_bk_1");
  });
});

describe("isNoopPaymentAdapter", () => {
  it("returns true for a NoopPaymentAdapter instance", () => {
    expect(isNoopPaymentAdapter(new NoopPaymentAdapter())).toBe(true);
  });

  it("returns false for a non-Noop port", () => {
    const fake = {
      createDepositLink: async () => ({}) as never,
      retrievePayment: async () => null,
    };
    expect(isNoopPaymentAdapter(fake as never)).toBe(false);
  });
});

```

- [ ] **Step 2: Run the test and confirm it FAILS (module does not exist).**

Run: `pnpm --filter @switchboard/api exec vitest run src/bootstrap/noop-payment-adapter.test.ts`
Expected: FAIL — Cannot find module './noop-payment-adapter.js'. No tests pass.

- [ ] **Step 3: Write the minimal real implementation. Create apps/api/src/bootstrap/noop-payment-adapter.ts. It implements the L1 PaymentPort. Mirror noop-calendar-provider.ts (a class implementing the port + an `isXProvider` instanceof guard, file lines 11-84). createDepositLink encodes the amount on the returned link so the fetch-back in retrievePayment can echo it; in the Noop case we re-derive the amount deterministically. Because retrievePayment receives only the externalReference (per the PaymentPort contract) and Noop holds no state, it returns a fixed-shape degraded VerifiedPayment whose amount is taken from an in-memory map populated by createDepositLink (so an issued link's amount round-trips), defaulting to a sentinel when never issued. This stays a pure stub: no network, no persistence.**

```ts
import type {
  PaymentPort,
  DepositLinkInput,
  DepositLink,
  VerifiedPayment,
} from "@switchboard/schemas";

/**
 * In-process, side-effect-free PaymentPort used to prove the deposit mechanics
 * without Stripe-Connect onboarding (spec §2). Per R1 it is DEGRADED: every
 * payment it returns carries provider='noop' and must never be counted as a
 * real (T1) production paid visit. The Stripe Connect adapter (PR 1A-4b) lands
 * behind this same port.
 */
export class NoopPaymentAdapter implements PaymentPort {
  // Maps a deterministic externalReference -> the cents issued, so an issued
  // link's amount round-trips through retrievePayment. Process-lifetime only.
  private readonly issued = new Map<string, { amountCents: number; currency: string }>();

  async createDepositLink(input: DepositLinkInput): Promise<DepositLink> {
    const externalReference = `noop_pay_${input.bookingId}`;
    this.issued.set(externalReference, {
      amountCents: input.amountCents,
      currency: input.currency,
    });
    return {
      url: `https://pay.noop.switchboard.local/${externalReference}`,
      externalReference,
      amountCents: input.amountCents,
      currency: input.currency,
    };
  }

  async retrievePayment(externalReference: string): Promise<VerifiedPayment | null> {
    const issued = this.issued.get(externalReference);
    if (!issued) {
      // Unknown reference: a real PSP returns null; Noop does the same so the
      // verified writer's not-found branch is exercisable.
      return null;
    }
    return {
      provider: "noop",
      externalReference,
      amountCents: issued.amountCents,
      currency: issued.currency,
      status: "paid",
    };
  }
}

export function isNoopPaymentAdapter(port: PaymentPort): boolean {
  return port instanceof NoopPaymentAdapter;
}

```

- [ ] **Step 4: The retrievePayment test calls retrievePayment("noop_pay_bk_1") on a fresh adapter that never issued that link, which (per the impl above) returns null and the test asserts not-null. Fix the test to first issue the link so the round-trip is exercised honestly. Update the retrievePayment describe block in noop-payment-adapter.test.ts.**

```ts
describe("NoopPaymentAdapter.retrievePayment", () => {
  it("returns a provider='noop' DEGRADED verified payment for an issued link", async () => {
    const adapter = new NoopPaymentAdapter();
    await adapter.createDepositLink(INPUT);
    const vp = await adapter.retrievePayment("noop_pay_bk_1");
    expect(vp).not.toBeNull();
    expect(vp!.provider).toBe("noop");
    expect(vp!.status).toBe("paid");
    expect(vp!.amountCents).toBe(5000);
    expect(vp!.externalReference).toBe("noop_pay_bk_1");
  });

  it("returns null for an unknown reference (fetch-back miss)", async () => {
    const adapter = new NoopPaymentAdapter();
    expect(await adapter.retrievePayment("noop_pay_unknown")).toBeNull();
  });
});

```

- [ ] **Step 5: Run the test again and confirm it PASSES.**

Run: `pnpm --filter @switchboard/api exec vitest run src/bootstrap/noop-payment-adapter.test.ts`
Expected: PASS — createDepositLink determinism, retrievePayment round-trip + null-miss, and both isNoopPaymentAdapter cases green.

- [ ] **Step 6: Commit.**

Run: `git add apps/api/src/bootstrap/noop-payment-adapter.ts apps/api/src/bootstrap/noop-payment-adapter.test.ts && git commit -m "feat(api): noop payment adapter with deterministic deposit ref"`
Expected: Commit succeeds.


#### Task 3: Task 3 — per-org payment-port factory (apps/api)

**Files:**
- Create: `apps/api/src/bootstrap/payment-port-factory.ts`
- Create: `apps/api/src/bootstrap/__tests__/payment-port-factory.test.ts`
- Test: `apps/api/src/bootstrap/__tests__/payment-port-factory.test.ts`

- [ ] **Step 1: Write the FAILING test. Create apps/api/src/bootstrap/__tests__/payment-port-factory.test.ts (this file lives in __tests__ to mirror calendar-provider-factory.test.ts which is in __tests__/). It pins the factory contract by direct mirror of calendar-provider-factory.test.ts:17-37,39-61,95-110,144-167: ORG_ID_REQUIRED on empty/whitespace, Noop fallback with no env, per-org memoization (same Promise + one resolve), and rejected-construction cache eviction.**

```ts
import { describe, it, expect, vi } from "vitest";
import { createPaymentPortFactory } from "../payment-port-factory.js";
import { isNoopPaymentAdapter } from "../noop-payment-adapter.js";

const silentLogger = { info: () => {}, error: () => {} };

describe("createPaymentPortFactory: input validation", () => {
  it("rejects with ORG_ID_REQUIRED when orgId is empty string", async () => {
    const factory = createPaymentPortFactory({ logger: silentLogger, env: {} });
    await expect(factory("")).rejects.toThrow(/ORG_ID_REQUIRED/);
  });

  it("rejects with ORG_ID_REQUIRED when orgId is whitespace-only", async () => {
    const factory = createPaymentPortFactory({ logger: silentLogger, env: {} });
    await expect(factory("   ")).rejects.toThrow(/ORG_ID_REQUIRED/);
  });
});

describe("createPaymentPortFactory: Noop fallback", () => {
  it("returns NoopPaymentAdapter when no Stripe env is configured", async () => {
    const factory = createPaymentPortFactory({ logger: silentLogger, env: {} });
    expect(isNoopPaymentAdapter(await factory("org-A"))).toBe(true);
  });
});

describe("createPaymentPortFactory: memoization", () => {
  it("returns the same Promise for the same orgId across calls", async () => {
    const factory = createPaymentPortFactory({ logger: silentLogger, env: {} });
    const p1 = factory("org-A");
    const p2 = factory("org-A");
    expect(p1).toBe(p2);
    await Promise.all([p1, p2]);
  });

  it("returns independent ports for different orgIds", async () => {
    const factory = createPaymentPortFactory({ logger: silentLogger, env: {} });
    const [a, b] = await Promise.all([factory("org-A"), factory("org-B")]);
    expect(a).not.toBe(b);
  });
});

describe("createPaymentPortFactory: rejection eviction", () => {
  it("clears a rejected construction so a later call can retry", async () => {
    let attempt = 0;
    const resolver = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("transient init failure");
      const { NoopPaymentAdapter } = await import("../noop-payment-adapter.js");
      return new NoopPaymentAdapter();
    });
    const factory = createPaymentPortFactory({
      logger: silentLogger,
      env: {},
      resolveForOrg: resolver,
    });
    await expect(factory("org-A")).rejects.toThrow(/transient init failure/);
    const port = await factory("org-A");
    expect(isNoopPaymentAdapter(port)).toBe(true);
    expect(resolver).toHaveBeenCalledTimes(2);
  });
});

```

- [ ] **Step 2: Run the test and confirm it FAILS (module does not exist).**

Run: `pnpm --filter @switchboard/api exec vitest run src/bootstrap/__tests__/payment-port-factory.test.ts`
Expected: FAIL — Cannot find module '../payment-port-factory.js'. No tests pass.

- [ ] **Step 3: Write the minimal real implementation. Create apps/api/src/bootstrap/payment-port-factory.ts. Mirror calendar-provider-factory.ts:5-46 EXACTLY for the cache/eviction/ORG_ID_REQUIRED shape. Default resolution returns the Noop adapter (no Stripe yet — PR 1A-4b adds the Stripe branch). Accept an optional injectable `resolveForOrg` so the eviction test can force a transient failure without a Stripe env. The factory takes no prismaClient yet (Noop needs no org config); the `env`/`logger` deps mirror the calendar factory's optional-env-injection convention so PR 1A-4b can read STRIPE_* without a new signature.**

```ts
import type { PaymentPort } from "@switchboard/schemas";
import { NoopPaymentAdapter } from "./noop-payment-adapter.js";

export type PaymentPortFactory = (orgId: string) => Promise<PaymentPort>;

export interface PaymentPortFactoryDeps {
  // Matches the bootstrap logger shape used by calendar-provider-factory.ts.
  logger: { info(msg: string): void; error(msg: string): void };
  // Optional env injection for tests; falls back to process.env at call sites
  // in PR 1A-4b when the Stripe branch lands.
  env?: {
    STRIPE_SECRET_KEY?: string;
    STRIPE_CONNECT_ACCOUNT_ID?: string;
  };
  // Optional override so tests can force a transient construction failure and
  // assert the rejected promise is evicted from the cache. Defaults to the
  // Noop resolver below.
  resolveForOrg?: (deps: PaymentPortFactoryDeps, orgId: string) => Promise<PaymentPort>;
}

export function createPaymentPortFactory(deps: PaymentPortFactoryDeps): PaymentPortFactory {
  // No eviction in beta (~10 orgs), mirroring calendar-provider-factory.ts.
  const cache = new Map<string, Promise<PaymentPort>>();
  const resolve = deps.resolveForOrg ?? resolveForOrg;

  const factory: PaymentPortFactory = (orgId: string) => {
    if (!orgId || typeof orgId !== "string" || orgId.trim() === "") {
      return Promise.reject(new Error("ORG_ID_REQUIRED"));
    }

    const existing = cache.get(orgId);
    if (existing) return existing;

    const promise = resolve(deps, orgId).catch((error) => {
      cache.delete(orgId);
      throw error;
    });

    cache.set(orgId, promise);
    return promise;
  };

  return factory;
}

async function resolveForOrg(deps: PaymentPortFactoryDeps, orgId: string): Promise<PaymentPort> {
  // Stripe Connect adapter lands in PR 1A-4b behind this same port. Until then
  // every org gets the Noop adapter (DEGRADED, never a T1 production paid visit).
  deps.logger.info(
    `Payment[${orgId}]: using NoopPaymentAdapter (Stripe Connect not configured)`,
  );
  return new NoopPaymentAdapter();
}

```

- [ ] **Step 4: Run the test again and confirm it PASSES.**

Run: `pnpm --filter @switchboard/api exec vitest run src/bootstrap/__tests__/payment-port-factory.test.ts`
Expected: PASS — ORG_ID_REQUIRED x2, Noop fallback, memoization x2, and rejection-eviction (resolver called twice) all green.

- [ ] **Step 5: Commit.**

Run: `git add apps/api/src/bootstrap/payment-port-factory.ts apps/api/src/bootstrap/__tests__/payment-port-factory.test.ts && git commit -m "feat(api): per-org payment-port factory (noop default)"`
Expected: Commit succeeds.


#### Task 4: Task 4 — deposit-link tool in core (idempotent external read, no new approval)

**Files:**
- Create: `packages/core/src/skill-runtime/tools/deposit-link.ts`
- Create: `packages/core/src/skill-runtime/tools/deposit-link.test.ts`
- Modify: `packages/core/src/skill-runtime/tools/index.ts`
- Test: `packages/core/src/skill-runtime/tools/deposit-link.test.ts`

- [ ] **Step 1: Write the FAILING test. Create packages/core/src/skill-runtime/tools/deposit-link.test.ts. It mirrors the factory-with-context test style at escalate.test.ts:37-156 (TEST_CONTEXT with surface, deps as vi.fn). It pins: (1) factory id; (2) happy path returns ok({url,externalReference,amountCents}) for a confirmed booking; (3) MISSING_BOOKING when findById returns null; (4) BOOKING_NOT_CONFIRMED when status!=='confirmed'; (5) the AI-1 vector — orgId is taken from ctx, NOT from params (a malicious params.organizationId is ignored, findById is called with ctx.orgId); (6) idempotency — two calls yield the same externalReference. The injected PaymentPort is the real schema type, so we hand-roll a stub.**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDepositLinkToolFactory } from "./deposit-link.js";
import type { SkillRequestContext } from "../types.js";
import type { PaymentPort, DepositLinkInput } from "@switchboard/schemas";

const TEST_CONTEXT: SkillRequestContext = {
  sessionId: "sess_1",
  orgId: "org_1",
  deploymentId: "deploy_1",
  surface: "chat",
};

function makeDeps(
  booking: { id: string; organizationId: string; status: string } | null,
) {
  const createDepositLink = vi.fn(async (input: DepositLinkInput) => ({
    url: `https://pay.noop/${input.bookingId}`,
    externalReference: `noop_pay_${input.bookingId}`,
    amountCents: input.amountCents,
    currency: input.currency,
  }));
  const paymentPort: PaymentPort = {
    createDepositLink,
    retrievePayment: vi.fn(async () => null),
  };
  const findById = vi.fn(async (_orgId: string, _bookingId: string) => booking);
  return {
    paymentPortFactory: vi.fn(async (_orgId: string) => paymentPort),
    findById,
    depositAmountCents: 5000,
    defaultCurrency: "SGD",
    _createDepositLink: createDepositLink,
  };
}

describe("deposit-link tool factory", () => {
  let deps: ReturnType<typeof makeDeps>;
  beforeEach(() => {
    deps = makeDeps({ id: "bk_1", organizationId: "org_1", status: "confirmed" });
  });

  it("factory returns a tool with id 'deposit-link'", () => {
    const tool = createDepositLinkToolFactory(deps)(TEST_CONTEXT);
    expect(tool.id).toBe("deposit-link");
  });

  it("issues a deposit link for a confirmed booking", async () => {
    const tool = createDepositLinkToolFactory(deps)(TEST_CONTEXT);
    const result = await tool.operations["deposit.issue"]!.execute({ bookingId: "bk_1" });
    expect(result.status).toBe("success");
    expect(result.data).toEqual({
      url: "https://pay.noop/bk_1",
      externalReference: "noop_pay_bk_1",
      amountCents: 5000,
    });
  });

  it("fails MISSING_BOOKING when the booking does not exist", async () => {
    const d = makeDeps(null);
    const tool = createDepositLinkToolFactory(d)(TEST_CONTEXT);
    const result = await tool.operations["deposit.issue"]!.execute({ bookingId: "nope" });
    expect(result.status).toBe("error");
    expect(result.error!.code).toBe("MISSING_BOOKING");
  });

  it("fails BOOKING_NOT_CONFIRMED when the booking is not confirmed", async () => {
    const d = makeDeps({ id: "bk_1", organizationId: "org_1", status: "pending_confirmation" });
    const tool = createDepositLinkToolFactory(d)(TEST_CONTEXT);
    const result = await tool.operations["deposit.issue"]!.execute({ bookingId: "bk_1" });
    expect(result.status).toBe("error");
    expect(result.error!.code).toBe("BOOKING_NOT_CONFIRMED");
  });

  it("sources orgId from ctx, never from params (AI-1)", async () => {
    const tool = createDepositLinkToolFactory(deps)(TEST_CONTEXT);
    await tool.operations["deposit.issue"]!.execute({
      bookingId: "bk_1",
      organizationId: "attacker_org",
    });
    expect(deps.findById).toHaveBeenCalledWith("org_1", "bk_1");
  });

  it("is idempotent: same bookingId yields the same externalReference", async () => {
    const tool = createDepositLinkToolFactory(deps)(TEST_CONTEXT);
    const a = await tool.operations["deposit.issue"]!.execute({ bookingId: "bk_1" });
    const b = await tool.operations["deposit.issue"]!.execute({ bookingId: "bk_1" });
    expect(a.data!.externalReference).toBe(b.data!.externalReference);
  });
});

```

- [ ] **Step 2: Run the test and confirm it FAILS (module does not exist).**

Run: `pnpm --filter @switchboard/core exec vitest run src/skill-runtime/tools/deposit-link.test.ts`
Expected: FAIL — Cannot find module './deposit-link.js'. No tests pass.

- [ ] **Step 3: Write the minimal real implementation. Create packages/core/src/skill-runtime/tools/deposit-link.ts. Mirror the factory-with-context pattern from escalate.ts:1-83 and the AI-1 sourcing comment from calendar-book.ts:154-159. effectCategory is 'read' (from the EffectCategory union in governance-types.ts:1-8 — there is no 'external_read'; 'read' + idempotent:true keeps this off the approval path, satisfying spec §8 'no new approval'). The PaymentPort is reached via an injected per-org factory (typed PaymentPortFactory) so core (L3) never imports apps/api (L5) — it only depends on the L1 PaymentPort type. bookingId comes from params; orgId from ctx. findById is injected (BookingLookup) so calendar-book.ts is untouched.**

```ts
import type { SkillTool, SkillRequestContext } from "../types.js";
import type { ToolResult } from "../tool-result.js";
import { ok, fail } from "../tool-result.js";
import type { PaymentPort } from "@switchboard/schemas";

/** Per-org PaymentPort resolver. Typed here (not imported from apps/api) so
 *  core stays at L3 — it depends only on the L1 PaymentPort type. The concrete
 *  factory is injected from apps/api at wiring time. */
export type PaymentPortFactory = (orgId: string) => Promise<PaymentPort>;

/** Minimal booking row the tool needs to gate issuance. Injected so the durable
 *  booking store stays in db/apps and calendar-book.ts is untouched. */
interface BookingLookup {
  findById(
    orgId: string,
    bookingId: string,
  ): Promise<{ id: string; organizationId: string; status: string } | null>;
}

interface DepositLinkToolDeps {
  paymentPortFactory: PaymentPortFactory;
  findById: BookingLookup["findById"];
  /** Deposit amount in minor units (cents). Injected dep until per-org deposit
   *  pricing is wired (mirrors calendar-book.ts defaultCurrency convention). */
  depositAmountCents: number;
  /** ISO-4217 currency for the deposit link. */
  defaultCurrency: string;
}

export type DepositLinkToolFactory = (ctx: SkillRequestContext) => SkillTool;

/**
 * Issues a first-party deposit link against an ALREADY-APPROVED, confirmed
 * booking. This is an idempotent external read riding on the booking's prior
 * approval — NO new approval is required (spec §8). `orgId` is sourced from the
 * trusted `SkillRequestContext`, never from LLM tool input (AI-1, mirrors
 * calendar-book.ts). The externalReference is deterministic per booking, so a
 * replay returns the same link.
 */
export function createDepositLinkToolFactory(deps: DepositLinkToolDeps): DepositLinkToolFactory {
  return (ctx: SkillRequestContext): SkillTool => ({
    id: "deposit-link",
    operations: {
      "deposit.issue": {
        description:
          "Issue a deposit payment link for a confirmed booking. Idempotent; returns the same link on replay.",
        // 'read': idempotent external read on an already-approved booking — must
        // NOT trigger a new approval (spec §8). The EffectCategory union has no
        // 'external_read'; 'read' + idempotent is the honest mapping.
        effectCategory: "read" as const,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: {
            bookingId: { type: "string", description: "The confirmed booking to attach a deposit to" },
          },
          required: ["bookingId"],
        },
        execute: async (params: unknown): Promise<ToolResult> => {
          const { bookingId } = params as { bookingId: string };
          const orgId = ctx.orgId;

          const booking = await deps.findById(orgId, bookingId);
          if (!booking) {
            return fail("MISSING_BOOKING", "No booking was found for this id.", {
              retryable: false,
              modelRemediation:
                "Do not issue a deposit link without a confirmed booking. Book the slot first.",
            });
          }
          if (booking.status !== "confirmed") {
            return fail(
              "BOOKING_NOT_CONFIRMED",
              "A deposit link can only be issued for a confirmed booking.",
              {
                retryable: false,
                modelRemediation:
                  "Confirm the booking before issuing a deposit link. Do not tell the customer to pay yet.",
              },
            );
          }

          const port = await deps.paymentPortFactory(orgId);
          const link = await port.createDepositLink({
            bookingId,
            organizationId: orgId,
            amountCents: deps.depositAmountCents,
            currency: deps.defaultCurrency,
          });

          return ok({
            url: link.url,
            externalReference: link.externalReference,
            amountCents: link.amountCents,
          });
        },
      },
    },
  });
}

```

- [ ] **Step 4: Wire the tool into the core tools barrel. Edit packages/core/src/skill-runtime/tools/index.ts to add the new exports next to the calendar-book/escalate lines (index.ts:5-8).**

```ts
export { createDepositLinkToolFactory } from "./deposit-link.js";
export type { DepositLinkToolFactory } from "./deposit-link.js";
```

- [ ] **Step 5: Run the test again and confirm it PASSES.**

Run: `pnpm --filter @switchboard/core exec vitest run src/skill-runtime/tools/deposit-link.test.ts`
Expected: PASS — factory id, happy path, MISSING_BOOKING, BOOKING_NOT_CONFIRMED, AI-1 ctx-orgId, and idempotency all green.

- [ ] **Step 6: Run typecheck across the three touched packages to confirm the new L1 export resolves downstream and no `any`/layering violation slipped in.**

Run: `pnpm --filter @switchboard/schemas --filter @switchboard/core --filter @switchboard/api typecheck`
Expected: All three packages typecheck with no errors. (If schemas exports look missing, run `pnpm reset` first per CLAUDE.md, then re-run.)

- [ ] **Step 7: Commit.**

Run: `git add packages/core/src/skill-runtime/tools/deposit-link.ts packages/core/src/skill-runtime/tools/deposit-link.test.ts packages/core/src/skill-runtime/tools/index.ts && git commit -m "feat(core): idempotent deposit-link tool on confirmed bookings"`
Expected: Commit succeeds.


#### Task 5: Task 5 — final verification (lint + full typecheck + targeted tests)

**Files:**
- Test: `packages/schemas/src/payment.test.ts`
- Test: `apps/api/src/bootstrap/noop-payment-adapter.test.ts`
- Test: `apps/api/src/bootstrap/__tests__/payment-port-factory.test.ts`
- Test: `packages/core/src/skill-runtime/tools/deposit-link.test.ts`

- [ ] **Step 1: Run lint on the three packages. CI lint runs prettier (per MEMORY: format:check is not in local lint) — run format:check too so the PR is not red on formatting.**

Run: `pnpm --filter @switchboard/schemas --filter @switchboard/core --filter @switchboard/api lint && pnpm format:check`
Expected: Lint passes for all three; prettier reports all matched files use the correct style (semi, double quotes, 2-space, 100 width). If format:check flags a file, run `pnpm format` and re-`git add` it.

- [ ] **Step 2: Run the four new test files together to confirm the whole PR is green in one pass.**

Run: `pnpm --filter @switchboard/schemas exec vitest run src/payment.test.ts && pnpm --filter @switchboard/api exec vitest run src/bootstrap/noop-payment-adapter.test.ts src/bootstrap/__tests__/payment-port-factory.test.ts && pnpm --filter @switchboard/core exec vitest run src/skill-runtime/tools/deposit-link.test.ts`
Expected: All four files PASS; zero failures.

- [ ] **Step 3: Confirm no file exceeds the 400-line warn / 600-line error gate (all new files are well under). This is a sanity check, not a fix.**

Run: `wc -l packages/schemas/src/payment.ts apps/api/src/bootstrap/noop-payment-adapter.ts apps/api/src/bootstrap/payment-port-factory.ts packages/core/src/skill-runtime/tools/deposit-link.ts`
Expected: Each file is well under 400 lines (none approaches the 600 arch-check error).

- [ ] **Step 4: Verify branch context before the PR per CLAUDE.md branch doctrine, then confirm the four commits are present.**

Run: `git branch --show-current && git log --oneline -4`
Expected: On the implementation branch (not main); the four feat commits from Tasks 1-4 are listed newest-first.


---

## 1A-4b — feat(db,schemas,core,api): verified payment writer + LifecycleRevenueEvent bookingId weld (no webhook)

**Goal:** Land the replay-proof verified-payment write path and the DB chain weld it needs, WITHOUT any PSP webhook (that route is a later PR). Two pieces: (a) a new `payment.record_verified` operator intent registered `system_auto_approved` (authority = the external PSP fetch-back, not human judgment) whose handler writes — in ONE runInTransaction — a payment `Receipt` (from 1A-3's primitive, status="paid", evidence kind="payment"), a `LifecycleRevenueEvent(bookingId, type="deposit")`, and a `purchased` OutboxEvent; (b) the schema/migration that adds `LifecycleRevenueEvent.bookingId String?` + index + a RAW-SQL partial unique on `(organizationId, externalReference) WHERE externalReference IS NOT NULL` so a replayed charge is an idempotent no-op. PER R1: tier is honestly derived from the provider — a real external PSP fetch-back mints T1_FETCH_BACK + `verified=true` (production-countable); a `provider="noop"` payment mints T3_ADMIN_AUDIT + `verified=false` + `degraded=true`, so a Noop payment exercises the write path but NEVER appears as a real (T1) paid visit and is never production-countable (the production-countable signal is `verified=true`, spec §9.4). PER R2 this is a payment receipt (status="paid", basis=payment evidence) — the paid signal comes only from this verified PaymentReceipt, never from a calendar-only receipt. Depends on 1A-3 (Receipt primitive + ReceiptStore + Prisma `receipt` delegate) and 1A-4a/1A-2 (chain weld). Excludes: the PSP webhook route, the PaymentPort/Noop adapter, the Stripe Connect adapter, and the owner read surface.

**File structure:**

| Action | Path | Responsibility |
|---|---|---|
| modify | `packages/schemas/src/lifecycle.ts` | Add `bookingId: z.string().nullable().optional()` to LifecycleRevenueEventSchema (after the externalReference line at lifecycle.ts:176) so the typed LifecycleRevenueEvent carries the booking weld. |
| modify | `packages/core/src/lifecycle/revenue-store.ts` | Add `bookingId?: string | null` to the RecordRevenueInput interface (after externalReference at revenue-store.ts:22) — the structural store contract core exposes. |
| modify | `packages/db/prisma/schema.prisma` | Add `bookingId String?` to model LifecycleRevenueEvent (after externalReference at schema.prisma:1841), add `@@index([organizationId, bookingId])`, and a sync comment pointing at the raw-SQL partial-unique migration. |
| create | `packages/db/prisma/migrations/20260606130000_lre_booking_and_external_ref_unique/migration.sql` | Same-commit migration: ADD COLUMN bookingId, CREATE INDEX on (organizationId, bookingId), and RAW-SQL CREATE UNIQUE INDEX on (organizationId, externalReference) WHERE externalReference IS NOT NULL (mirrors 20260603120000_booking_partial_unique_active). |
| modify | `packages/db/src/stores/prisma-revenue-store.ts` | Forward + map bookingId: add `bookingId?: string | null` to the local RecordRevenueInput (line 22), add `bookingId: input.bookingId ?? null` to the create data block (line 87), and add `bookingId` to the mapRowToRevenueEvent param type + returned object (lines 278/295). |
| modify | `packages/db/src/stores/__tests__/prisma-revenue-store.test.ts` | Add a failing-first test that bookingId is forwarded into prisma.lifecycleRevenueEvent.create and round-trips through the mapper; add `bookingId: null` to the makeRevenueEvent default row so the mapper has the field to read. |
| create | `apps/api/src/payments/resolve-payment-tier.ts` | Pure, db-free `resolvePaymentReceiptTier(provider)` -> {tier, verified, degraded}: provider==='noop' -> {T3_ADMIN_AUDIT, verified:false, degraded:true}; any real PSP provider -> {T1_FETCH_BACK, verified:true, degraded:false}. The R1 honest-degradation gate, independently unit-testable. |
| create | `apps/api/src/payments/resolve-payment-tier.test.ts` | Co-located unit matrix: noop -> T3 + verified:false + degraded:true; stripe -> T1 + verified:true + degraded:false; asserts a noop payment can never resolve to T1 (R1). |
| create | `apps/api/src/routes/operator-intents-schemas-payment.ts` | Zod RecordVerifiedPaymentParametersSchema (org-free; contactId, opportunityId, bookingId, amountCents int positive, currency len3 default SGD, externalReference required (replay key), provider default 'noop', connectionId optional, sourceCampaignId/sourceAdId nullable). Separate file so operator-intents-schemas.ts stays small. |
| create | `apps/api/src/bootstrap/operator-intents/record-verified-payment.ts` | buildRecordVerifiedPaymentHandler(receiptWriter, revenueStore, outboxWriter, runInTransaction): OperatorMutationHandler + the ReceiptWriter seam (forwards a full CreateReceiptInput to 1A-3's ReceiptStore) + RECORD_VERIFIED_PAYMENT_INTENT const. Writes payment Receipt + LifecycleRevenueEvent(bookingId) + purchased outbox in one tx; tier/verified derived via resolvePaymentReceiptTier (R1). Mirrors revenue.ts. |
| create | `apps/api/src/bootstrap/operator-intents/record-verified-payment.test.ts` | Handler unit tests: one-tx (same tx arg to all three writes) with parsed amountCents; replay re-issues the same outbox eventId; a provider='noop' payment writes T3 + verified=false (never T1) and an org-scoping assertion that organizationId flows from the WorkUnit into all writes. |
| modify | `apps/api/src/bootstrap/operator-intents.ts` | Register the new intent: import/re-export buildRecordVerifiedPaymentHandler + RECORD_VERIFIED_PAYMENT_INTENT + ReceiptWriter; add receiptWriter? to OperatorIntentsBootstrapDeps; when receiptWriter+revenueStore+outboxWriter+runInTransaction present, handlers.set(...) + registerOperatorIntent(...) (system_auto_approved); bump the intentCount tally. |
| modify | `apps/api/src/app.ts` | Bootstrap binding: pass a `receiptWriter` into the existing bootstrapOperatorIntents({...}) call (app.ts:764-778) that forwards a CreateReceiptInput to `new PrismaReceiptStore(prismaClient).record(input, tx as never)` (PrismaReceiptStore is 1A-3's export). This is the only seam touching 1A-3's Receipt model. |
| create | `apps/api/src/bootstrap/operator-intents/__tests__/record-verified-payment.integration.test.ts` | Postgres-gated (describe.skipIf(!DATABASE_URL)) replay-proof proof: drive the handler twice with the SAME externalReference against a real $transaction + PrismaRevenueStore + PrismaReceiptStore + PrismaOutboxStore; assert exactly one LifecycleRevenueEvent row, one Receipt row, one outbox row (the partial-unique no-op the unit test cannot prove). |

**Notes:** DEPENDENCY ORDERING: This PR depends on 1A-3 (Receipt primitive + ReceiptStore/CreateReceiptInput in @switchboard/core, PrismaReceiptStore in @switchboard/db, the `Receipt` Prisma model + `prisma.receipt` delegate) and 1A-4a/1A-2 (the chain weld). Verified that `prisma.receipt` does NOT yet exist (packages/db/src/prisma-db.ts has no receipt delegate) and @switchboard/core does not yet export ReceiptStore/CreateReceiptInput — both are 1A-3's deliverables. Tasks 4-6 typecheck only once 1A-3 is in the branch; the explicit failure mode is called out in each affected step (rebase onto 1A-3, then `pnpm reset` + `pnpm db:generate`). Task 1 (schema) and Task 2/3 (pure helper + Zod) are independent of 1A-3 and can land first.\n\nKEY DIVERGENCE FROM THE EXISTING 1A PLAN (correct per the prompt's R1): the plan's 1A-4 Task 6 hard-codes `provider:\"noop\"` + `tier:\"T1_FETCH_BACK\"` + `verified:true` for EVERY payment. That violates R1 (a Noop payment would become a production-countable T1 paid visit). This PR instead derives tier/verified/degraded from the provider via a new pure `resolvePaymentReceiptTier` (Task 2): provider==='noop' -> T3_ADMIN_AUDIT + verified=false + degraded=true; a real PSP -> T1_FETCH_BACK + verified=true. The production-countable signal is `verified=true` (spec sec.9.4 'the trustworthy count reads only verified=true'); noop never sets it, so a Noop payment exercises the write path but never appears as a real paid visit. The Task-4 test asserts this directly (R1). The narrow ReceiptWriter shape in the plan (no evidence/capturedBy) is also widened to forward a full CreateReceiptInput so it matches 1A-3's actual ReceiptStore.record (verified in the 1A plan, lines 2224-2250) and carries the discriminated PaymentReceiptEvidence (R2: the paid signal lives in this verified payment receipt, basis=payment evidence).\n\nSCOPE BOUNDARY (per the prompt 'no webhook yet'): this PR deliberately EXCLUDES the PSP webhook route (apps/api/src/routes/payments-webhook.ts), the PaymentPort interface + Noop adapter + per-org factory, and the Stripe Connect adapter. The handler is exercised in tests by direct invocation; the webhook that submits this intent via PlatformIngress with an idempotency key from the provider message id is a later PR. (The plan file's 1A-4b is the Stripe Connect adapter; the prompt re-scopes 1A-4b to this writer+weld, which is authoritative here.)\n\nCROSS-CUTTING COMPLIANCE: every Prisma mutation is org-scoped — PrismaRevenueStore.record already writes organizationId (prisma-revenue-store.ts:79) and its externalReference idempotency findFirst is scoped; PrismaReceiptStore.record (1A-3) scopes its findFirst by organizationId+kind+externalRef. The migration is RAW SQL for the partial unique (Prisma 6 cannot express it), in the SAME commit as the schema change, mirroring 20260603120000_booking_partial_unique_active. No file approaches the 600-line error / 400-line warn limit: every new piece is its own small file (handler, schema, tier resolver), nothing inlined into platform-ingress.ts/calendar-book.ts. Layering holds: schemas(L1: receipt evidence types) <- core(L3: RevenueStore/ReceiptStore ifaces) <- db(L4: Prisma stores) <- apps/api(L5: handler/bootstrap); ad-optimizer is untouched. Money stays in cents end-to-end (amountCents int) — no unit conversion happens in this PR (the cents->dollars boundary is at trueRoas in 1B, out of scope). Conventional-commit subjects are lowercase (commitlint).\n\nFILES VERIFIED (file:line): apps/api/src/bootstrap/operator-intents/revenue.ts:1-83 (writer + runInTransaction + outbox pattern, exported OutboxWriter/RunInTransaction types); apps/api/src/bootstrap/operator-intents.ts:42-46/72/84-96/118-129/164-169/188-197 (registration); apps/api/src/routes/operator-intents-schemas.ts:83-95 (RecordRevenueParametersSchema mirror); packages/core/src/lifecycle/revenue-store.ts:10-23 (RecordRevenueInput); packages/schemas/src/lifecycle.ts:60-67 (revenue enums), 166-182 (LifecycleRevenueEventSchema, externalReference@176); packages/db/prisma/schema.prisma:1829-1851 (model LifecycleRevenueEvent, externalReference@1841); packages/db/src/stores/prisma-revenue-store.ts:9-22/76-94/268-302 (input/create/mapper); packages/db/src/stores/__tests__/prisma-revenue-store.test.ts:5-37 (makeMockPrisma/makeRevenueEvent); packages/db/prisma/migrations/20260603120000_booking_partial_unique_active/migration.sql:1-9 (partial-unique precedent); packages/core/src/platform/modes/operator-mutation-mode.ts:17-26 (OperatorMutationHandler/Result); packages/core/src/platform/work-unit.ts:11-26 (WorkUnit) + platform/index.ts:25 (export); packages/core/src/platform/types.ts:7 (ActorType includes 'service'); apps/api/src/app.ts:760-778 (bootstrapOperatorIntents call + outboxWriter inline binding + `tx as never`); apps/api/src/bootstrap/operator-intents/__tests__/recommendation-handler.test.ts:3-20 (WorkUnit test cast pattern); packages/db/src/stores/prisma-conversion-record-store.ts:66 (typed Json cast). 1A-3 contracts read from the worktree plan docs/superpowers/plans/2026-06-06-close-the-revenue-loop-spec-1a.md lines 1825-1912 (Receipt schema: ReceiptTierSchema enum, PaymentReceiptEvidenceSchema {kind,chargeId,amount,currency,chargedAt}), 2224-2250 (CreateReceiptInput + ReceiptStore.record/findByBooking), 2519-2600 (PrismaReceiptStore.record idempotency on org+kind+externalRef).

#### Task 1: Task 1 — Schema + migration: LifecycleRevenueEvent.bookingId + partial-unique externalReference (one commit)

**Files:**
- Create: `packages/db/prisma/migrations/20260606130000_lre_booking_and_external_ref_unique/migration.sql`
- Modify: `packages/schemas/src/lifecycle.ts`
- Modify: `packages/core/src/lifecycle/revenue-store.ts`
- Modify: `packages/db/prisma/schema.prisma`
- Modify: `packages/db/src/stores/prisma-revenue-store.ts`
- Modify: `packages/db/src/stores/__tests__/prisma-revenue-store.test.ts`
- Test: `packages/db/src/stores/__tests__/prisma-revenue-store.test.ts`

- [ ] **Step 1: Write the failing test FIRST. Add this new `it` block inside the existing `describe("record", ...)` group in prisma-revenue-store.test.ts. It asserts bookingId is forwarded into prisma.lifecycleRevenueEvent.create and round-trips through the mapper. (Helpers makeMockPrisma/makeRevenueEvent are verified at prisma-revenue-store.test.ts:6-37; `prisma`/`store` are set in the describe's beforeEach.)**

```ts
    it("forwards bookingId into create data and round-trips it", async () => {
      const created = makeRevenueEvent({ bookingId: "book-1" });
      prisma.lifecycleRevenueEvent.create.mockResolvedValue(created);

      const result = await store.record({
        organizationId: "org-1",
        contactId: "contact-1",
        opportunityId: "opp-1",
        amount: 5000,
        type: "deposit",
        recordedBy: "stripe",
        verified: true,
        bookingId: "book-1",
      });

      expect(prisma.lifecycleRevenueEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ bookingId: "book-1" }),
      });
      expect(result.bookingId).toBe("book-1");
    });
```

- [ ] **Step 2: Run the new test — it MUST fail because PrismaRevenueStore does not yet forward or map bookingId.**

Run: `pnpm --filter @switchboard/db test src/stores/__tests__/prisma-revenue-store.test.ts -t "forwards bookingId"`
Expected: FAIL — create called without bookingId in data (objectContaining mismatch) and/or result.bookingId is undefined.

- [ ] **Step 3: Add bookingId to the makeRevenueEvent default row so the mapper has the field to read for ALL tests (otherwise row.bookingId is undefined for pre-existing tests). Edit prisma-revenue-store.test.ts makeRevenueEvent (verified at lines 18-37): insert after the externalReference line.**

```ts
    externalReference: "pi_abc123",
    bookingId: null,
    verified: true,
```

- [ ] **Step 4: Add bookingId to the core RevenueStore input contract. Edit packages/core/src/lifecycle/revenue-store.ts interface RecordRevenueInput (verified at revenue-store.ts:10-23): insert the field after the externalReference line.**

```ts
  externalReference?: string | null;
  /** Welds a verified payment to its booking row (spec 1A chain). */
  bookingId?: string | null;
  verified?: boolean;
```

- [ ] **Step 5: Add bookingId to the typed LifecycleRevenueEvent schema. Edit packages/schemas/src/lifecycle.ts LifecycleRevenueEventSchema (verified at lifecycle.ts:176-177): insert between externalReference and verified.**

```ts
  externalReference: z.string().nullable().optional(),
  bookingId: z.string().nullable().optional(),
  verified: z.boolean().default(false),
```

- [ ] **Step 6: Forward + map bookingId in the Prisma store. Edit packages/db/src/stores/prisma-revenue-store.ts in THREE places. (a) local RecordRevenueInput interface (verified at lines 9-22) — add after externalReference; (b) the create data block (verified at lines 76-94) — add after the externalReference line; (c) mapRowToRevenueEvent param type AND return object (verified at lines 268-302) — add the param field and the return field.**

```ts
// (a) interface RecordRevenueInput — after `externalReference?: string | null;`:
  bookingId?: string | null;
// (b) inside client.lifecycleRevenueEvent.create({ data: { ... } }) — after `externalReference: input.externalReference ?? null,`:
        bookingId: input.bookingId ?? null,
// (c) mapRowToRevenueEvent — add to the param type (after `externalReference: string | null;`):
  bookingId: string | null;
//     and to the returned object (after `externalReference: row.externalReference,`):
    bookingId: row.bookingId,
```

- [ ] **Step 7: Add the Prisma model field + index + sync comment. Edit packages/db/prisma/schema.prisma model LifecycleRevenueEvent (verified at schema.prisma:1829-1851): insert bookingId after externalReference, and add the index + comment in the index block.**

```ts
  externalReference String?
  bookingId         String?
  verified          Boolean     @default(false)
  sourceCampaignId  String?
  sourceAdId        String?
  recordedAt        DateTime    @default(now())
  createdAt         DateTime    @default(now())

  // The (organizationId, externalReference) WHERE externalReference IS NOT NULL
  // partial unique lives in raw SQL (Prisma 6 cannot express it) in migration
  // 20260606130000_lre_booking_and_external_ref_unique. Keep this comment in sync.
  @@index([organizationId])
  @@index([opportunityId])
  @@index([organizationId, recordedAt])
  @@index([organizationId, bookingId])
```

- [ ] **Step 8: Create the raw-SQL migration in the SAME commit (CLAUDE.md: schema change requires its migration in the same commit). Mirror the partial-unique precedent at packages/db/prisma/migrations/20260603120000_booking_partial_unique_active/migration.sql (verified lines 1-9). Note: today there is NO DB unique on externalReference (replayable) — this partial unique is what makes a replayed charge a no-op.**

```ts
-- LifecycleRevenueEvent: weld a verified payment to its booking (spec 1A chain)
-- and make a replayed PSP charge an idempotent no-op. Today there is NO DB unique
-- on the external reference, so the same charge could write twice. Add a PARTIAL
-- unique on (organizationId, externalReference) WHERE externalReference IS NOT NULL
-- (Prisma 6 cannot express partial uniques; mirrors 20260603120000).
ALTER TABLE "LifecycleRevenueEvent" ADD COLUMN "bookingId" TEXT;

CREATE INDEX "LifecycleRevenueEvent_organizationId_bookingId_idx"
  ON "LifecycleRevenueEvent" ("organizationId", "bookingId");

CREATE UNIQUE INDEX "LifecycleRevenueEvent_org_externalRef_key"
  ON "LifecycleRevenueEvent" ("organizationId", "externalReference")
  WHERE "externalReference" IS NOT NULL;
```

- [ ] **Step 9: Regenerate the Prisma client so generated types include bookingId, then re-run the store test (db tests mock Prisma, but the store file imports PrismaDbClient types from the generated client).**

Run: `pnpm db:generate && pnpm --filter @switchboard/db test src/stores/__tests__/prisma-revenue-store.test.ts`
Expected: PASS — the new 'forwards bookingId' test plus all pre-existing PrismaRevenueStore tests are green.

- [ ] **Step 10: If Postgres is reachable, verify no drift between schema.prisma and the migration (CLAUDE.md: run db:check-drift before committing schema changes). If Postgres is unavailable locally, skip and rely on CI — the hand-written SQL mirrors the proven precedent.**

Run: `pnpm db:check-drift`
Expected: No drift detected (or: skipped — Postgres unavailable; CI validates the migration).

- [ ] **Step 11: Commit schema + migration + store + types together (one commit, same-commit rule). Lowercase conventional-commit subject (commitlint).**

Run: `git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260606130000_lre_booking_and_external_ref_unique/migration.sql packages/schemas/src/lifecycle.ts packages/core/src/lifecycle/revenue-store.ts packages/db/src/stores/prisma-revenue-store.ts packages/db/src/stores/__tests__/prisma-revenue-store.test.ts && git commit -m "feat(db,schemas,core): lifecycle revenue event bookingId + external-reference partial unique"`
Expected: Commit succeeds.


#### Task 2: Task 2 — resolvePaymentReceiptTier pure helper (R1: noop can never mint T1)

**Files:**
- Create: `apps/api/src/payments/resolve-payment-tier.ts`
- Create: `apps/api/src/payments/resolve-payment-tier.test.ts`
- Test: `apps/api/src/payments/resolve-payment-tier.test.ts`

- [ ] **Step 1: Write the failing test FIRST. This pure function is the R1 honest-degradation gate: a real PSP fetch-back is T1 + verified; a provider='noop' payment is T3 + NOT verified + degraded (so it can exercise the write path but never become a production-countable T1 paid visit). Keeping it pure makes the prod-assert unit-testable without booting the app (mirrors 1A-3's resolveCalendarReceiptTier approach).**

```ts
import { describe, it, expect } from "vitest";
import { resolvePaymentReceiptTier } from "./resolve-payment-tier.js";

describe("resolvePaymentReceiptTier", () => {
  it("a noop payment is T3_ADMIN_AUDIT, not verified, degraded (R1)", () => {
    const r = resolvePaymentReceiptTier("noop");
    expect(r.tier).toBe("T3_ADMIN_AUDIT");
    expect(r.verified).toBe(false);
    expect(r.degraded).toBe(true);
  });

  it("a real PSP fetch-back (stripe) is T1_FETCH_BACK, verified, not degraded", () => {
    const r = resolvePaymentReceiptTier("stripe");
    expect(r.tier).toBe("T1_FETCH_BACK");
    expect(r.verified).toBe(true);
    expect(r.degraded).toBe(false);
  });

  it("never resolves a noop provider to T1 (anti-fake invariant)", () => {
    expect(resolvePaymentReceiptTier("noop").tier).not.toBe("T1_FETCH_BACK");
  });
});
```

- [ ] **Step 2: Run the test — it MUST fail (module does not exist).**

Run: `pnpm --filter @switchboard/api test src/payments/resolve-payment-tier.test.ts`
Expected: FAIL — Cannot find module './resolve-payment-tier.js'.

- [ ] **Step 3: Create apps/api/src/payments/resolve-payment-tier.ts. Import the tier type from @switchboard/schemas (ReceiptTier verified in the 1A-3 Receipt primitive — packages/schemas/src/receipt.ts ReceiptTierSchema enum [T1_FETCH_BACK, T2_PROVIDER_SIGNATURE, T3_ADMIN_AUDIT]). A 'noop' provider has no external corroboration so it is capped at T3 and never verified; any other (real PSP) provider rode a fetch-back so it is T1 + verified. Pure, no DB, no any.**

```ts
// apps/api/src/payments/resolve-payment-tier.ts
// ---------------------------------------------------------------------------
// R1 honest-degradation gate for payment receipts. The Noop adapter exercises
// the write path but has NO external corroboration, so a noop payment is capped
// at T3_ADMIN_AUDIT and is never `verified` -> it can never become a
// production-countable (verified=true / T1) paid visit. Only a real external
// PSP fetch-back yields T1_FETCH_BACK + verified=true (spec sec.8/sec.9).
// ---------------------------------------------------------------------------
import type { ReceiptTier } from "@switchboard/schemas";

export interface PaymentTierVerdict {
  tier: ReceiptTier;
  /** True only for a real external PSP fetch-back; this is the
   *  production-countable signal. Never true for a noop provider. */
  verified: boolean;
  /** Honest downgrade flag — a noop/local payment is degraded evidence. */
  degraded: boolean;
}

export function resolvePaymentReceiptTier(provider: string): PaymentTierVerdict {
  if (provider === "noop") {
    return { tier: "T3_ADMIN_AUDIT", verified: false, degraded: true };
  }
  return { tier: "T1_FETCH_BACK", verified: true, degraded: false };
}
```

- [ ] **Step 4: Run the test again — it MUST pass.**

Run: `pnpm --filter @switchboard/api test src/payments/resolve-payment-tier.test.ts`
Expected: PASS — 3 passed (resolvePaymentReceiptTier).

- [ ] **Step 5: Commit.**

Run: `git add apps/api/src/payments/resolve-payment-tier.ts apps/api/src/payments/resolve-payment-tier.test.ts && git commit -m "feat(api): payment receipt tier resolver (noop capped at t3, never verified)"`
Expected: Commit succeeds.


#### Task 3: Task 3 — RecordVerifiedPaymentParametersSchema (separate file, amountCents + required externalReference)

**Files:**
- Create: `apps/api/src/routes/operator-intents-schemas-payment.ts`

- [ ] **Step 1: Create the parameter schema (no separate test — it is exercised by the handler test in Task 4). Mirror RecordRevenueParametersSchema (verified at apps/api/src/routes/operator-intents-schemas.ts:83-95) but money is amountCents (int, cents end-to-end per spec sec.11) and externalReference is REQUIRED (it is the replay/idempotency key behind the Task-1 partial unique). `provider` defaults to 'noop' and is what Task 2's resolver reads. Keep it in this separate file so operator-intents-schemas.ts stays small (file-size doctrine).**

```ts
import { z } from "zod";

/**
 * Parameters for the `payment.record_verified` intent. Authority is the external
 * PSP fetch-back; `amountCents` is the RE-FETCHED amount in minor units, never a
 * webhook-body value. `externalReference` is required — it is the replay key
 * (partial unique in the DB). `provider` selects the evidence tier (R1): a real
 * PSP -> T1 verified; 'noop' -> T3 degraded, never production-countable.
 */
export const RecordVerifiedPaymentParametersSchema = z.object({
  contactId: z.string().min(1),
  opportunityId: z.string().min(1),
  bookingId: z.string().min(1),
  amountCents: z.number().int().positive(),
  currency: z.string().length(3).default("SGD"),
  externalReference: z.string().min(1),
  provider: z.string().min(1).default("noop"),
  connectionId: z.string().min(1).optional(),
  sourceCampaignId: z.string().nullable().optional(),
  sourceAdId: z.string().nullable().optional(),
});

export type RecordVerifiedPaymentParameters = z.infer<
  typeof RecordVerifiedPaymentParametersSchema
>;
```

- [ ] **Step 2: Typecheck the api package to confirm the schema compiles (no test runs yet; it is consumed in Task 4).**

Run: `pnpm --filter @switchboard/api typecheck`
Expected: No type errors. (If it reports missing @switchboard/schemas exports, run `pnpm reset` first.)

- [ ] **Step 3: Commit.**

Run: `git add apps/api/src/routes/operator-intents-schemas-payment.ts && git commit -m "feat(api): record-verified-payment parameter schema (amountcents + required external ref)"`
Expected: Commit succeeds.


#### Task 4: Task 4 — Verified-payment handler: one-tx receipt + revenue + outbox, provider-derived tier (R1/R2)

**Files:**
- Create: `apps/api/src/bootstrap/operator-intents/record-verified-payment.ts`
- Create: `apps/api/src/bootstrap/operator-intents/record-verified-payment.test.ts`
- Test: `apps/api/src/bootstrap/operator-intents/record-verified-payment.test.ts`

- [ ] **Step 1: Write the failing handler test. It proves four things: (1) all THREE writes (receipt, revenue, outbox) run inside the SAME runInTransaction with the SAME tx arg; (2) the written amount is the parsed amountCents (never recomputed); (3) replay (record returns the EXISTING row) re-issues the SAME outbox eventId so the outbox unique no-ops it; (4) R1 — a provider='noop' payment writes a T3 receipt + verified=false revenue (NEVER T1/verified). The WorkUnit shape is verified at packages/core/src/platform/work-unit.ts:11-26 (cast with `as WorkUnit`, mirroring apps/api/src/bootstrap/operator-intents/__tests__/recommendation-handler.test.ts:3-20). ReceiptWriter takes a full CreateReceiptInput so it forwards straight into 1A-3's ReceiptStore.record.**

```ts
import { describe, it, expect, vi } from "vitest";
import type { RevenueStore } from "@switchboard/core";
import type { LifecycleRevenueEvent } from "@switchboard/schemas";
import type { WorkUnit } from "@switchboard/core/platform";
import {
  buildRecordVerifiedPaymentHandler,
  type ReceiptWriter,
} from "./record-verified-payment.js";

const TX = { __tx: true } as const;

function makeEvent(overrides: Partial<LifecycleRevenueEvent> = {}): LifecycleRevenueEvent {
  return {
    id: "rev_1",
    organizationId: "org-1",
    contactId: "c1",
    opportunityId: "opp-1",
    amount: 5000,
    currency: "SGD",
    type: "deposit",
    status: "confirmed",
    recordedBy: "stripe",
    externalReference: "pi_abc",
    bookingId: "book-1",
    verified: true,
    sourceCampaignId: "camp-1",
    sourceAdId: null,
    recordedAt: new Date(0),
    createdAt: new Date(0),
    ...overrides,
  };
}

function makeWorkUnit(params: Record<string, unknown> = {}): WorkUnit {
  return {
    id: "wu-1",
    requestedAt: new Date(0).toISOString(),
    organizationId: "org-1",
    actor: { id: "system", type: "service" },
    intent: "payment.record_verified",
    parameters: {
      contactId: "c1",
      opportunityId: "opp-1",
      bookingId: "book-1",
      amountCents: 5000,
      currency: "SGD",
      externalReference: "pi_abc",
      provider: "stripe",
      sourceCampaignId: "camp-1",
      ...params,
    },
    deployment: {} as never,
    resolvedMode: "operator_mutation",
    traceId: "t-1",
    trigger: "api",
    priority: "normal",
  } as WorkUnit;
}

function makeRevenueStore(event: LifecycleRevenueEvent): RevenueStore {
  return {
    record: vi.fn(async () => event),
    findByOpportunity: vi.fn(async () => []),
    findByContact: vi.fn(async () => []),
    sumByOrg: vi.fn(async () => ({ totalAmount: 0, count: 0 })),
    sumByCampaign: vi.fn(async () => []),
  };
}

const runInTx = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(TX));

describe("buildRecordVerifiedPaymentHandler", () => {
  it("writes receipt + revenue + outbox in one tx with the parsed amount and org from the work unit", async () => {
    const receiptWriter: ReceiptWriter = { write: vi.fn(async () => {}) };
    const revenueStore = makeRevenueStore(makeEvent());
    const outboxWriter = { write: vi.fn(async () => {}) };

    const handler = buildRecordVerifiedPaymentHandler(
      receiptWriter,
      revenueStore,
      outboxWriter,
      runInTx,
    );
    const result = await handler.execute(makeWorkUnit());

    expect(result.outcome).toBe("completed");
    expect(receiptWriter.write).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        kind: "payment",
        tier: "T1_FETCH_BACK",
        status: "paid",
        bookingId: "book-1",
        externalRef: "pi_abc",
        amount: 5000,
        evidence: expect.objectContaining({ kind: "payment", chargeId: "pi_abc", amount: 5000 }),
      }),
      TX,
    );
    expect(revenueStore.record).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        type: "deposit",
        recordedBy: "stripe",
        verified: true,
        amount: 5000,
        bookingId: "book-1",
        externalReference: "pi_abc",
      }),
      TX,
    );
    expect(outboxWriter.write).toHaveBeenCalledWith(
      "evt_pay_rev_1",
      "purchased",
      expect.objectContaining({ type: "purchased", value: 5000, contactId: "c1", organizationId: "org-1" }),
      TX,
    );
  });

  it("replay re-issues the same outbox eventId (existing row returned)", async () => {
    const receiptWriter: ReceiptWriter = { write: vi.fn(async () => {}) };
    const revenueStore = makeRevenueStore(makeEvent({ id: "rev_existing" }));
    const outboxWriter = { write: vi.fn(async () => {}) };

    const handler = buildRecordVerifiedPaymentHandler(
      receiptWriter,
      revenueStore,
      outboxWriter,
      runInTx,
    );
    await handler.execute(makeWorkUnit());
    expect(outboxWriter.write).toHaveBeenCalledWith(
      "evt_pay_rev_existing",
      "purchased",
      expect.anything(),
      TX,
    );
  });

  it("a provider='noop' payment writes a T3 receipt and verified=false revenue, never T1 (R1)", async () => {
    const receiptWriter: ReceiptWriter = { write: vi.fn(async () => {}) };
    const revenueStore = makeRevenueStore(makeEvent({ verified: false, recordedBy: "stripe" }));
    const outboxWriter = { write: vi.fn(async () => {}) };

    const handler = buildRecordVerifiedPaymentHandler(
      receiptWriter,
      revenueStore,
      outboxWriter,
      runInTx,
    );
    await handler.execute(makeWorkUnit({ provider: "noop", externalReference: "noop_pay_book-1" }));

    expect(receiptWriter.write).toHaveBeenCalledWith(
      expect.objectContaining({ tier: "T3_ADMIN_AUDIT", provider: "noop", verifiedAt: null }),
      TX,
    );
    expect(revenueStore.record).toHaveBeenCalledWith(
      expect.objectContaining({ verified: false }),
      TX,
    );
    // R1: a noop payment is never minted as a verified T1 paid visit.
    expect(receiptWriter.write).not.toHaveBeenCalledWith(
      expect.objectContaining({ tier: "T1_FETCH_BACK" }),
      expect.anything(),
    );
  });
});
```

- [ ] **Step 2: Run the test — it MUST fail (handler file does not exist).**

Run: `pnpm --filter @switchboard/api test src/bootstrap/operator-intents/record-verified-payment.test.ts`
Expected: FAIL — Cannot find module './record-verified-payment.js'.

- [ ] **Step 3: Create apps/api/src/bootstrap/operator-intents/record-verified-payment.ts. Mirror revenue.ts (verified at apps/api/src/bootstrap/operator-intents/revenue.ts:1-83): reuse its exported OutboxWriter + RunInTransaction injected types; add a ReceiptWriter seam that forwards a full CreateReceiptInput (from 1A-3 @switchboard/core) to the store, so the handler never imports db. Tier/verified/degraded come from resolvePaymentReceiptTier (R1) — NOT hard-coded. Receipt is kind='payment', status='paid', evidence is the discriminated PaymentReceiptEvidence (R2: the paid signal lives in this verified payment receipt). recordedBy='stripe' and type='deposit' (authority = the PSP fetch-back, spec sec.8). verifiedAt is set only when verified.**

```ts
// apps/api/src/bootstrap/operator-intents/record-verified-payment.ts
// ---------------------------------------------------------------------------
// payment.record_verified handler factory (spec 1A-4b, architecture A).
// In ONE runInTransaction writes:
//   1. a payment Receipt (1A-3 primitive: kind=payment, status=paid, evidence
//      kind=payment) whose tier/verified/degraded are derived from the provider
//      (R1 honest degradation: noop -> T3, never verified; real PSP -> T1);
//   2. a LifecycleRevenueEvent(type=deposit, bookingId, verified) welded to the
//      booking — record() short-circuits a duplicate externalReference;
//   3. a `purchased` OutboxEvent whose eventId derives from the revenue row id,
//      so a replay re-issues the SAME id and the outbox unique no-ops it.
// Authority is the external PSP fetch-back, so this intent is system_auto_
// approved; operator.record_revenue stays separate (verified=false).
// R2: this is a PAYMENT receipt (status=paid) — the paid signal is the verified
// payment, never a calendar-only receipt.
// ---------------------------------------------------------------------------
import type {
  RevenueStore,
  StoreTransactionContext,
  CreateReceiptInput,
} from "@switchboard/core";
import type { OperatorMutationHandler } from "@switchboard/core/platform";
import { RecordVerifiedPaymentParametersSchema } from "../../routes/operator-intents-schemas-payment.js";
import { resolvePaymentReceiptTier } from "../../payments/resolve-payment-tier.js";
import type { OutboxWriter, RunInTransaction } from "./revenue.js";

export const RECORD_VERIFIED_PAYMENT_INTENT = "payment.record_verified";

/** Writes a Receipt row through the tx client (concrete impl wired at bootstrap
 *  via 1A-3's PrismaReceiptStore). Indirection mirrors OutboxWriter so the
 *  handler stays db-free + unit-testable. */
export interface ReceiptWriter {
  write(input: CreateReceiptInput, tx?: StoreTransactionContext): Promise<void>;
}

export function buildRecordVerifiedPaymentHandler(
  receiptWriter: ReceiptWriter,
  revenueStore: RevenueStore,
  outboxWriter: OutboxWriter,
  runInTransaction: RunInTransaction,
): OperatorMutationHandler {
  return {
    async execute(workUnit) {
      const params = RecordVerifiedPaymentParametersSchema.parse(workUnit.parameters);
      const orgId = workUnit.organizationId;
      const verdict = resolvePaymentReceiptTier(params.provider);
      const chargedAt = new Date().toISOString();

      const event = await runInTransaction(async (tx) => {
        // 1. Payment receipt — tier/verified honestly derived from the provider.
        await receiptWriter.write(
          {
            organizationId: orgId,
            kind: "payment",
            tier: verdict.tier,
            status: "paid",
            bookingId: params.bookingId,
            opportunityId: params.opportunityId,
            externalRef: params.externalReference,
            amount: params.amountCents,
            currency: params.currency,
            provider: params.provider,
            connectionId: params.connectionId ?? null,
            evidence: {
              kind: "payment",
              chargeId: params.externalReference,
              amount: params.amountCents,
              currency: params.currency,
              chargedAt,
            },
            capturedBy: "payment.record_verified",
            verifiedAt: verdict.verified ? chargedAt : null,
          },
          tx,
        );

        // 2. Verified revenue event welded to the booking. record() short-circuits
        //    on a duplicate externalReference, so a replay returns the existing row.
        const created = await revenueStore.record(
          {
            organizationId: orgId,
            contactId: params.contactId,
            opportunityId: params.opportunityId,
            amount: params.amountCents,
            currency: params.currency,
            type: "deposit",
            status: "confirmed",
            recordedBy: "stripe",
            verified: verdict.verified,
            bookingId: params.bookingId,
            externalReference: params.externalReference,
            sourceCampaignId: params.sourceCampaignId ?? null,
            sourceAdId: params.sourceAdId ?? null,
          },
          tx,
        );

        // 3. `purchased` outbox event keyed off the revenue row id (replay-stable).
        await outboxWriter.write(
          `evt_pay_${created.id}`,
          "purchased",
          {
            type: "purchased",
            contactId: params.contactId,
            organizationId: orgId,
            value: params.amountCents,
            sourceCampaignId: params.sourceCampaignId ?? null,
            sourceAdId: params.sourceAdId ?? null,
            occurredAt: chargedAt,
            source: "payment-verified",
            metadata: {
              bookingId: params.bookingId,
              opportunityId: params.opportunityId,
              externalReference: params.externalReference,
              currency: params.currency,
              provider: params.provider,
              verified: verdict.verified,
            },
          },
          tx,
        );
        return created;
      });

      return {
        outcome: "completed" as const,
        summary: `Recorded verified deposit of ${params.amountCents} cents ${params.currency} for booking ${params.bookingId}`,
        outputs: { event },
      };
    },
  };
}
```

- [ ] **Step 4: Run the test again — it MUST pass (one-tx, parsed-amount, replay-same-eventId, and the R1 noop-T3-not-verified case all green).**

Run: `pnpm --filter @switchboard/api test src/bootstrap/operator-intents/record-verified-payment.test.ts`
Expected: PASS — 3 passed (buildRecordVerifiedPaymentHandler).

- [ ] **Step 5: Commit.**

Run: `git add apps/api/src/bootstrap/operator-intents/record-verified-payment.ts apps/api/src/bootstrap/operator-intents/record-verified-payment.test.ts && git commit -m "feat(api): payment.record_verified handler writes receipt+revenue+outbox in one tx"`
Expected: Commit succeeds.


#### Task 5: Task 5 — Register payment.record_verified intent (system_auto_approved) in operator-intents bootstrap

**Files:**
- Modify: `apps/api/src/bootstrap/operator-intents.ts`

- [ ] **Step 1: Add the import for the new handler + constant + ReceiptWriter type, alongside the revenue.js import block (verified at apps/api/src/bootstrap/operator-intents.ts:42-46).**

```ts
import {
  buildRecordVerifiedPaymentHandler,
  RECORD_VERIFIED_PAYMENT_INTENT,
  type ReceiptWriter,
} from "./operator-intents/record-verified-payment.js";
```

- [ ] **Step 2: Re-export the constant + handler so app.ts and the integration test can import them from operator-intents.js (mirrors the revenue.ts re-export at operator-intents.ts:72). Add next to that re-export.**

```ts
export {
  buildRecordVerifiedPaymentHandler,
  RECORD_VERIFIED_PAYMENT_INTENT,
} from "./operator-intents/record-verified-payment.js";
```

- [ ] **Step 3: Add a receiptWriter dep to OperatorIntentsBootstrapDeps (verified at operator-intents.ts:84-96), after the runInTransaction field.**

```ts
  outboxWriter?: OutboxWriter;
  runInTransaction?: RunInTransaction;
  /** Required (with revenueStore+outboxWriter+runInTransaction) to register the
   *  payment.record_verified intent. Writes the verified payment Receipt. */
  receiptWriter?: ReceiptWriter;
  logger?: { info(msg: string): void };
```

- [ ] **Step 4: Destructure receiptWriter in bootstrapOperatorIntents (verified at operator-intents.ts:118-129), add it to the list.**

```ts
    revenueStore,
    outboxWriter,
    runInTransaction,
    receiptWriter,
    logger,
```

- [ ] **Step 5: Register the handler in the handlers Map. Add right after the existing RECORD_REVENUE_INTENT handler block (verified at operator-intents.ts:164-169).**

```ts
  if (receiptWriter && revenueStore && outboxWriter && runInTransaction) {
    handlers.set(
      RECORD_VERIFIED_PAYMENT_INTENT,
      buildRecordVerifiedPaymentHandler(receiptWriter, revenueStore, outboxWriter, runInTransaction),
    );
  }
```

- [ ] **Step 6: Register the intent itself. Add after the RECORD_REVENUE_INTENT registration (verified at operator-intents.ts:188-190). The shared registerOperatorIntent helper already sets approvalMode='system_auto_approved' + approvalPolicy='none' (verified at operator-intents.ts:99-115) — exactly what spec sec.8 requires for this writer (authority is the PSP fetch-back, not human judgment).**

```ts
  if (receiptWriter && revenueStore && outboxWriter && runInTransaction) {
    registerOperatorIntent(intentRegistry, RECORD_VERIFIED_PAYMENT_INTENT);
  }
```

- [ ] **Step 7: Update the intentCount tally so the bootstrap log line stays accurate (verified at operator-intents.ts:192-197). Add the new term to the sum.**

```ts
    (revenueStore && outboxWriter && runInTransaction ? 1 : 0) +
    (receiptWriter && revenueStore && outboxWriter && runInTransaction ? 1 : 0);
```

- [ ] **Step 8: Typecheck the api package to confirm the bootstrap wiring compiles (imports resolve, dep types line up). The CreateReceiptInput type comes from 1A-3 (@switchboard/core); if it reports a missing export, 1A-3 has not landed in this branch yet — rebase onto 1A-3 first, then run `pnpm reset` if the export still does not resolve.**

Run: `pnpm --filter @switchboard/api typecheck`
Expected: No type errors.

- [ ] **Step 9: Commit.**

Run: `git add apps/api/src/bootstrap/operator-intents.ts && git commit -m "feat(api): register payment.record_verified operator intent (system auto approved)"`
Expected: Commit succeeds.


#### Task 6: Task 6 — Bootstrap ReceiptWriter binding in app.ts (the only seam to 1A-3's Receipt model)

**Files:**
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Wire a receiptWriter into the existing bootstrapOperatorIntents({...}) call (verified at apps/api/src/app.ts:764-778, inside the `if (prismaClient)` block). It constructs 1A-3's PrismaReceiptStore and forwards each CreateReceiptInput through the tx client — this is the one place the Receipt model is touched. Mirror the existing outboxWriter inline-binding + `tx as never` cast at app.ts:773-774. Add the PrismaReceiptStore import next to the existing `const { PrismaOutboxStore } = await import("@switchboard/db");` line (app.ts:762), and add the receiptWriter option after runInTransaction.**

```ts
// next to: const { PrismaOutboxStore } = await import("@switchboard/db");
    const { PrismaReceiptStore } = await import("@switchboard/db");
    const prismaReceipts = new PrismaReceiptStore(prismaClient);
// ... inside the bootstrapOperatorIntents({ ... }) call, after `runInTransaction: ...,`:
      receiptWriter: {
        write: (input, tx) => prismaReceipts.record(input, tx as never).then(() => {}),
      },
```

- [ ] **Step 2: Typecheck the api package. The receiptWriter binding requires 1A-3's PrismaReceiptStore export + the Receipt Prisma model (the generated `prisma.receipt` delegate). If 1A-3 has NOT landed in this branch, this errors on the missing `PrismaReceiptStore` export / `receipt` delegate — that is the explicit, intended dependency. Resolve by rebasing onto 1A-3, then `pnpm reset` + `pnpm db:generate`, and align the CreateReceiptInput field names to 1A-3's actual core export before committing.**

Run: `pnpm --filter @switchboard/api typecheck`
Expected: No type errors once 1A-3 is in the branch. (Before 1A-3 lands: an expected error on the PrismaReceiptStore export — rebase first.)

- [ ] **Step 3: Commit.**

Run: `git add apps/api/src/app.ts && git commit -m "feat(api): bind verified-payment receipt writer at bootstrap"`
Expected: Commit succeeds.


#### Task 7: Task 7 — Postgres-gated replay-proof integration test + full verification gates

**Files:**
- Create: `apps/api/src/bootstrap/operator-intents/__tests__/record-verified-payment.integration.test.ts`
- Test: `apps/api/src/bootstrap/operator-intents/__tests__/record-verified-payment.integration.test.ts`

- [ ] **Step 1: Write the Postgres-gated integration test that proves replay is a TRUE no-op against a real $transaction + the Task-1 partial unique (the unit test mocks the store and cannot prove this). Gate on DATABASE_URL with describe.skipIf(!process.env["DATABASE_URL"]) so CI without Postgres skips it (db tests elsewhere mock Prisma; this one is the deliberate exception per the spec's 'Payment A' replay test). Drive the handler twice with the SAME externalReference using real PrismaRevenueStore + PrismaReceiptStore + PrismaOutboxStore, then assert exactly one LifecycleRevenueEvent row, one Receipt row, one outbox row. (Adjust the org/contact/opportunity/booking foreign-key seeding to match the existing api integration-test setup helpers; the assertion shape below is the load-bearing part.)**

```ts
import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaRevenueStore, PrismaReceiptStore, PrismaOutboxStore } from "@switchboard/db";
import {
  buildRecordVerifiedPaymentHandler,
  type ReceiptWriter,
} from "../record-verified-payment.js";
import type { WorkUnit } from "@switchboard/core/platform";

describe.skipIf(!process.env["DATABASE_URL"])("payment.record_verified replay (real tx)", () => {
  it("a replayed externalReference writes exactly one revenue + receipt + outbox row", async () => {
    const prisma = new PrismaClient();
    const revenueStore = new PrismaRevenueStore(prisma);
    const receipts = new PrismaReceiptStore(prisma);
    const outbox = new PrismaOutboxStore(prisma);

    // NOTE: seed Organization/Contact/Opportunity/Booking rows the FKs need here,
    // reusing the existing api integration-test seed helpers, then set these ids.
    const orgId = "itest-org";
    const externalReference = "pi_replay_1";

    const receiptWriter: ReceiptWriter = {
      write: (input, tx) => receipts.record(input, tx as never).then(() => {}),
    };
    const handler = buildRecordVerifiedPaymentHandler(
      receiptWriter,
      revenueStore,
      {
        write: (id, type, payload, tx) =>
          outbox.write(id, type, payload, tx as never).then(() => {}),
      },
      (fn) => prisma.$transaction((tx) => fn(tx)),
    );

    const wu = (): WorkUnit =>
      ({
        id: "wu",
        requestedAt: new Date().toISOString(),
        organizationId: orgId,
        actor: { id: "system", type: "service" },
        intent: "payment.record_verified",
        parameters: {
          contactId: "itest-contact",
          opportunityId: "itest-opp",
          bookingId: "itest-booking",
          amountCents: 5000,
          currency: "SGD",
          externalReference,
          provider: "stripe",
        },
        deployment: {} as never,
        resolvedMode: "operator_mutation",
        traceId: "t",
        trigger: "api",
        priority: "normal",
      }) as WorkUnit;

    await handler.execute(wu());
    await handler.execute(wu()); // replay — must be a no-op

    const revCount = await prisma.lifecycleRevenueEvent.count({
      where: { organizationId: orgId, externalReference },
    });
    const receiptCount = await prisma.receipt.count({
      where: { organizationId: orgId, externalRef: externalReference },
    });
    expect(revCount).toBe(1);
    expect(receiptCount).toBe(1);
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 2: Run the integration test. With no DATABASE_URL it is skipped (green-skipped). With Postgres reachable it proves the partial-unique no-op.**

Run: `pnpm --filter @switchboard/api test src/bootstrap/operator-intents/__tests__/record-verified-payment.integration.test.ts`
Expected: PASS or skipped — if DATABASE_URL is set, 1 passed (replay writes exactly one row of each); otherwise the describe is skipped.

- [ ] **Step 3: Run the full api + db + core + schemas test suites and typecheck to confirm no regression across the four touched packages.**

Run: `pnpm --filter @switchboard/api --filter @switchboard/db --filter @switchboard/core --filter @switchboard/schemas test && pnpm typecheck`
Expected: PASS — all suites green; typecheck reports no errors.

- [ ] **Step 4: Run lint + format check (CI lint also runs prettier; local lint may not). If format:check reports diffs, run `pnpm format`, re-`git add` the listed files, and amend.**

Run: `pnpm lint && pnpm format:check`
Expected: PASS — eslint clean and prettier reports no files needing formatting.

- [ ] **Step 5: Commit the integration test.**

Run: `git add apps/api/src/bootstrap/operator-intents/__tests__/record-verified-payment.integration.test.ts && git commit -m "test(api): postgres-gated replay no-op for payment.record_verified"`
Expected: Commit succeeds.


---

## 1A-4c — feat(api): payments webhook ingress-receiver (re-fetch charge, submit payment.record_verified)

**Goal:** Add a fail-closed PSP payments webhook as a new ingress-receiver route (apps/api/src/routes/payments-webhook.ts), copying the HMAC-over-rawBody signature pattern from apps/api/src/routes/ad-optimizer.ts. The route: (1) verifies an HMAC signature over the raw request body via an exported verifyPaymentWebhookSignature(rawBody, signature, secret) that fails closed (missing secret / missing-or-empty rawBody / missing-or-mismatched signature -> 401); (2) ONLY after verifying, parses the provider message id and the connected-account id from the body; (3) resolves the org from a Connection (serviceId:"stripe", externalAccountId = connected-account id) — refuses to submit if unresolvable; (4) NEVER trusts the webhook body amount — obtains the per-org PaymentPort via app.paymentPortFactory(orgId) and re-fetches the charge by id with retrievePayment(chargeId); (5) submits the payment.record_verified intent through app.platformIngress.submit with an idempotencyKey derived from the provider message id (so a replay is deduped at PlatformIngress). The verified-payment writer intent (payment.record_verified) and the PaymentPort interface + per-org factory are delivered by upstream PRs 1A-4b and 1A-4a respectively; this PR consumes their contracts and wires the HTTP edge. Per revision rule R1, a Noop/Local payment provider (provider="noop") never mints a real (T1) paid visit in production — that exclusion is enforced inside the payment.record_verified intent handler (1A-4b); this route only guarantees the amount it submits is the re-fetched amountCents, and (defensively) tags the submit with the re-fetched provider so the handler can degrade. The route is unauthenticated (PSPs send no Bearer token), so it is added to the auth-middleware bypass list and the billing-guard public allowlist, and (because the 2-hop ingress static scan cannot follow the dynamic PlatformIngress resolution, identical to ad-optimizer.ts) it gets a route-allowlist.yaml entry.

**File structure:**

| Action | Path | Responsibility |
|---|---|---|
| create | `apps/api/src/routes/payments-webhook.ts` | New ingress-receiver Fastify plugin. Header `// @route-class: ingress-receiver`. Exports verifyPaymentWebhookSignature (HMAC-SHA256 over rawBody, fail-closed) and paymentsWebhookRoutes. POST /payments/webhook: rawBody:true; verify signature with STRIPE_WEBHOOK_SECRET -> 401 on failure; parse providerMessageId + connectedAccountId from body AFTER verify; resolve org via Connection(serviceId:'stripe', externalAccountId) -> 200 skip if unresolvable; obtain per-org PaymentPort via app.paymentPortFactory(orgId) -> retrievePayment(chargeId) re-fetch -> 503 if factory absent; submit payment.record_verified via app.platformIngress with idempotencyKey=`psp-${providerMessageId}` and parameters carrying the RE-FETCHED amountCents/currency/provider (never the body amount). |
| create | `apps/api/src/routes/__tests__/payments-webhook.test.ts` | Co-located tests. Standalone Fastify (mirror ad-optimizer-signature.test.ts): rejects missing/forged HMAC over rawBody (401); fails closed with no STRIPE_WEBHOOK_SECRET (401); refuses unresolvable org (no platformIngress.submit call, 200 skip); asserts retrievePayment is called with the charge id and the submitted parameters.amountCents equals the RE-FETCHED amount NOT the (different) body amount; replay (same provider message id) routes through ingress with the same idempotencyKey and the fake ingress dedups to one effective record. |
| create | `apps/api/src/types/payments-fastify.d.ts` | Module augmentation: declare module "fastify" { interface FastifyInstance { paymentPortFactory?: (orgId: string) => Promise<import("@switchboard/schemas").PaymentPort>; } }. Mirrors types/recommendations-fastify.d.ts. The actual app.decorate("paymentPortFactory", ...) is wired by 1A-4a; this file only types the seam so the route compiles. |
| modify | `apps/api/src/bootstrap/routes.ts` | Import paymentsWebhookRoutes and register it with prefix "/api/webhooks" (a prefix already public in billing-guard) so the live path is /api/webhooks/payments/webhook. Placed beside the existing webhooksRoutes registration (routes.ts:215). |
| modify | `apps/api/src/middleware/auth.ts` | Add the payments webhook to the preHandler auth-bypass list (auth.ts:121-138): a PSP sends no Authorization header, so `request.url === "/api/webhooks/payments/webhook"` must short-circuit before the Bearer check, exactly like "/api/billing/webhook" at line 129. Exact path, never a prefix. |
| modify | `apps/api/src/middleware/billing-guard.ts` | No code change required — "/api/webhooks" is already a PUBLIC_PREFIX (billing-guard.ts:27), so the new /api/webhooks/payments/webhook POST already bypasses the entitlement gate. Listed here only to document the verified dependency; do not edit unless the registration prefix changes. |
| modify | `.agent/tools/route-allowlist.yaml` | Add an entry for apps/api/src/routes/payments-webhook.ts with a one-line reason: it IS a PlatformIngress entry point (calls app.platformIngress.submit) but the 2-hop import scan misses the dynamic resolution through @switchboard/core/platform — identical justification to the ad-optimizer.ts entry at line 141. |

**Notes:** DEPENDS ON 1A-4a (PaymentPort interface in @switchboard/schemas + per-org factory createPaymentPortFactory in apps/api decorated as app.paymentPortFactory; PaymentPort.retrievePayment(chargeId) -> { id, amountCents, currency, provider, externalAccountId? }) and 1A-4b (the payment.record_verified intent registered system_auto_approved, whose handler writes PaymentReceipt(verified,T1)+LifecycleRevenueEvent+purchased outbox in one tx, gated by the (organizationId, externalReference) DB unique, and which enforces R1: provider="noop" never mints above T3/never a real paid visit in production). Those symbols do NOT exist in the repo yet (verified: grep for PaymentPort / retrievePayment / record_verified returns nothing on main and in the worktree) — do not redefine them here; import them.

NO new env var / no env-allowlist change: STRIPE_WEBHOOK_SECRET is already in scripts/env-allowlist.local-readiness.json:114 (verified). The route resolves the secret via process.env["STRIPE_WEBHOOK_SECRET"] using bracket notation (ESM/no-any lint).

SIGNATURE SCHEME: per the prompt, COPY ad-optimizer's verifyMetaWebhookSignature shape exactly — a 3-arg HMAC-SHA256 over the raw body returning "sha256="+hmac, compared timing-safe. This is the deliberate Spec-1 simplification (the real Stripe t=,v1= parsing belongs inside the 1A-4b Stripe adapter, not this edge). Do NOT import the heavier billing handleWebhookEvent (that path bypasses ingress and is for subscription events).

WIRING SEAM: app.paymentPortFactory is decorated on the Fastify instance in app.ts by 1A-4a; this PR only adds the type augmentation file (payments-fastify.d.ts) and reads the decorator, guarding with a 503 when absent (mirrors ad-optimizer's `if (entryId && app.prisma)` defensive style) so the route is runnable/testable before 1A-4a's decoration lands.

VERIFIED ANCHORS (file:line): ad-optimizer.ts verifyMetaWebhookSignature 23-36 (fail-closed shape), POST receiver 67-136 (rawBody read 71, signature header 72-73, 401 at 74-77, Connection resolve by externalAccountId 92-102, idempotencyKey build 109-110, submit 112-124, !result.ok at 126-129, workUnit.id/traceId 133-134); ad-optimizer-signature.test.ts (standalone Fastify + fastify-raw-body register 21-27, sign helper 17-19, postWebhook 29-39, 4 signature cases); Connection model schema.prisma:196-216 (externalAccountId 207, @@index([externalAccountId]) 215); CanonicalSubmitRequest canonical-request.ts:20-33; SubmitWorkResponse platform-ingress.ts:68-78; idempotency dedup branch platform-ingress.ts:100-160 (returns cached result, never re-executes); Actor/Trigger types.ts:7-8; FastifyInstance.platformIngress app.ts:67, .prisma app.ts:60; type-aug precedent types/recommendations-fastify.d.ts; decorate precedent app.ts:546; route registration bootstrap/routes.ts:237 (adOptimizerRoutes prefix /api/marketplace); auth bypass list middleware/auth.ts:121-138; billing-guard PUBLIC_PREFIXES middleware/billing-guard.ts:19-28; route-allowlist ad-optimizer entry .agent/tools/route-allowlist.yaml:141; standalone decorate test pattern marketplace-operational-state.test.ts:24-35; serviceId "stripe" convention (2 producers). CLAUDE.md: ESM .js relative imports, no any, no console.log (use app.log.warn/console.warn), files error>600/warn>400, lowercase conventional-commit subject. Layering: route is apps/api (L5) so it may import @switchboard/schemas + @switchboard/core freely.

NOT in this PR (belongs to deps): the PaymentPort interface, the payment.record_verified intent + handler, the per-org factory + its app.decorate wiring, any Prisma schema/migration (this PR adds NO schema change — it only routes through an existing intent), the Stripe-native signature parser, and the Noop-vs-prod tier enforcement (R1 lives in the 1A-4b handler).

#### Task 1: Task 1 — verifyPaymentWebhookSignature: fail-closed HMAC over raw body (TDD)

**Files:**
- Create: `apps/api/src/routes/payments-webhook.ts`
- Create: `apps/api/src/routes/__tests__/payments-webhook.test.ts`
- Test: `apps/api/src/routes/__tests__/payments-webhook.test.ts`

- [ ] **Step 1: Create the test file with the standalone-Fastify scaffolding and the FIRST four signature tests, copied structurally from apps/api/src/__tests__/ad-optimizer-signature.test.ts (verified 1-83). Use STRIPE_WEBHOOK_SECRET as the secret env var (already allowlisted) and POST to /api/webhooks/payments/webhook. The PAYLOAD is a structurally valid PSP event whose connected-account id resolves to no Connection, so a verified request short-circuits at 200 (no prisma/ingress needed for the signature cases — we decorate empty fakes). This step asserts ONLY signature behavior.**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import rawBody from "fastify-raw-body";
import { createHmac } from "node:crypto";
import { paymentsWebhookRoutes } from "../payments-webhook.js";

// PSP payments webhook ingress-receiver. Mirrors ad-optimizer-signature.test.ts:
// the route must verify an HMAC over the RAW body (STRIPE_WEBHOOK_SECRET) and
// fail closed (401) on any missing/forged signature or missing secret, BEFORE
// trusting any body field.

const SECRET = "test-webhook-secret";
// Valid JSON whose connected-account id resolves to NO Connection, so a verified
// request short-circuits at 200 without needing a real port/ingress.
const PAYLOAD = JSON.stringify({
  id: "evt_sig_1",
  type: "charge.succeeded",
  data: { object: { id: "ch_sig_1", amount: 9999, account: "acct_unknown" } },
});

function sign(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(rawBody, { field: "rawBody", global: false });
  app.decorate("prisma", { connection: { findFirst: async () => null } } as never);
  await app.register(paymentsWebhookRoutes, { prefix: "/api/webhooks" });
  await app.ready();
  return app;
}

async function postWebhook(app: FastifyInstance, signature: string | undefined) {
  return app.inject({
    method: "POST",
    url: "/api/webhooks/payments/webhook",
    headers: {
      "content-type": "application/json",
      ...(signature ? { "x-payment-signature": signature } : {}),
    },
    payload: PAYLOAD,
  });
}

describe("Payments webhook signature verification", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env["STRIPE_WEBHOOK_SECRET"];
    process.env["STRIPE_WEBHOOK_SECRET"] = SECRET;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env["STRIPE_WEBHOOK_SECRET"];
    else process.env["STRIPE_WEBHOOK_SECRET"] = saved;
  });

  it("accepts a request carrying a valid x-payment-signature (org unresolved -> 200 skip)", async () => {
    const app = await buildApp();
    const res = await postWebhook(app, sign(PAYLOAD, SECRET));
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("rejects a request with no signature header", async () => {
    const app = await buildApp();
    const res = await postWebhook(app, undefined);
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("rejects a forged signature", async () => {
    const app = await buildApp();
    const res = await postWebhook(app, sign(PAYLOAD, "wrong-secret"));
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("fails closed when STRIPE_WEBHOOK_SECRET is not configured", async () => {
    delete process.env["STRIPE_WEBHOOK_SECRET"];
    const app = await buildApp();
    const res = await postWebhook(app, sign(PAYLOAD, SECRET));
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

```

- [ ] **Step 2: Run the test and confirm it FAILS because the route module does not exist yet (import error / 404).**

Run: `pnpm --filter @switchboard/api exec vitest run src/routes/__tests__/payments-webhook.test.ts`
Expected: FAIL — Cannot find module '../payments-webhook.js' (the route file is not created yet).

- [ ] **Step 3: Create the route file with the exported verifyPaymentWebhookSignature (copied shape from ad-optimizer.ts:23-36, but secret-agnostic and using the x-payment-signature header) and a minimal POST handler that ONLY does signature verification + a stubbed org-resolution that returns 200-skip. This is the minimal impl to green the four signature tests. Note: console.warn (not console.log) per lint; bracket env access; .js relative imports.**

```ts
// @route-class: ingress-receiver
import type { FastifyPluginAsync } from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify a PSP webhook's HMAC over the RAW request body using
 * STRIPE_WEBHOOK_SECRET. Fails closed: a missing secret, missing/empty raw body,
 * or missing/mismatched signature all return false. Same fail-closed shape as
 * the ad-optimizer verifyMetaWebhookSignature; the provider-native signature
 * parser (Stripe t=,v1=) lives inside the 1A-4b adapter, not this edge.
 */
export function verifyPaymentWebhookSignature(
  rawBody: string | undefined,
  signature: string | undefined,
  secret: string | undefined,
): boolean {
  if (!secret) {
    console.warn("[payments-webhook] verifyPaymentWebhookSignature called without a secret");
    return false;
  }
  if (!rawBody || typeof signature !== "string" || signature.length === 0) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  if (signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export const paymentsWebhookRoutes: FastifyPluginAsync = async (app) => {
  app.post("/payments/webhook", { config: { rawBody: true } }, async (request, reply) => {
    // Verify the HMAC over the raw body BEFORE trusting any payload field. The
    // org is resolved from the body below, which is forgeable without this gate.
    const rawBodyStr = (request as unknown as { rawBody?: string }).rawBody;
    const sigHeader = request.headers["x-payment-signature"];
    const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
    if (!verifyPaymentWebhookSignature(rawBodyStr, signature, process.env["STRIPE_WEBHOOK_SECRET"])) {
      app.log.warn("Payments webhook: signature verification failed");
      return reply.code(401).send({ error: "Invalid signature", statusCode: 401 });
    }

    // Org resolution + re-fetch + submit are added in Tasks 2-3.
    return reply.code(200).send({ received: true });
  });
};

```

- [ ] **Step 4: Run the four signature tests again and confirm they PASS.**

Run: `pnpm --filter @switchboard/api exec vitest run src/routes/__tests__/payments-webhook.test.ts`
Expected: PASS — 4 passed (accepts valid sig -> 200; no header -> 401; forged -> 401; no secret -> 401).

- [ ] **Step 5: Commit.**

Run: `git add apps/api/src/routes/payments-webhook.ts apps/api/src/routes/__tests__/payments-webhook.test.ts && git commit -m "feat(api): payments webhook signature verification (fail-closed hmac over raw body)"`
Expected: Commit succeeds; lowercase conventional-commit subject passes commitlint.


#### Task 2: Task 2 — resolve org AFTER verify; re-fetch the charge; submit the RE-FETCHED amount (TDD)

**Files:**
- Create: `apps/api/src/types/payments-fastify.d.ts`
- Modify: `apps/api/src/routes/payments-webhook.ts`
- Test: `apps/api/src/routes/__tests__/payments-webhook.test.ts`

- [ ] **Step 1: Create the FastifyInstance type augmentation for the per-org PaymentPort factory (delivered + decorated by 1A-4a). Mirrors apps/api/src/types/recommendations-fastify.d.ts. This only types the seam so the route compiles; the app.decorate call is 1A-4a's responsibility.**

```ts
import type { PaymentPort } from "@switchboard/schemas";

declare module "fastify" {
  interface FastifyInstance {
    /**
     * Per-org PaymentPort factory (1A-4a). Resolves the org's configured PSP
     * adapter (Noop -> Stripe Connect) for fetch-back. Decorated in app.ts by
     * 1A-4a; optional so this route can 503 cleanly before that wiring lands.
     */
    paymentPortFactory?: (orgId: string) => Promise<PaymentPort>;
  }
}

```

- [ ] **Step 2: Add the org-resolution + re-fetch tests to payments-webhook.test.ts. These decorate a fake prisma (Connection.findFirst), a fake paymentPortFactory whose retrievePayment returns an amount DIFFERENT from the body amount, and a recording fake platformIngress. Assert: (a) unresolvable org -> no submit; (b) resolved org -> retrievePayment called with the charge id AND the submitted parameters.amountCents equals the RE-FETCHED value (5000), never the body amount (9999). Append these inside the test file (new describe block).**

```ts
import { vi } from "vitest";

// --- helpers shared by the resolve/refetch/replay blocks ---
function bodyWithCharge(eventId: string, chargeId: string, account: string, bodyAmount: number) {
  return JSON.stringify({
    id: eventId,
    type: "charge.succeeded",
    data: { object: { id: chargeId, amount: bodyAmount, account } },
  });
}

function makeSubmitSpy() {
  // Mimics PlatformIngress idempotency: same key returns the prior result and does
  // NOT re-run downstream effects (platform-ingress.ts:100-160).
  const seen = new Map<string, { id: string; traceId: string }>();
  const calls: Array<Record<string, unknown>> = [];
  const submit = vi.fn(async (req: Record<string, unknown>) => {
    calls.push(req);
    const key = String(req["idempotencyKey"]);
    const existing = seen.get(key);
    if (existing) {
      return { ok: true as const, result: {}, workUnit: existing };
    }
    const wu = { id: `wu-${seen.size + 1}`, traceId: `tr-${seen.size + 1}` };
    seen.set(key, wu);
    return { ok: true as const, result: {}, workUnit: wu };
  });
  return { submit, calls };
}

async function buildResolvingApp(opts: {
  connectionOrgId: string | null;
  retrievePayment: ReturnType<typeof vi.fn>;
  submit: ReturnType<typeof vi.fn>;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(rawBody, { field: "rawBody", global: false });
  app.decorate("prisma", {
    connection: {
      findFirst: async () =>
        opts.connectionOrgId ? { organizationId: opts.connectionOrgId } : null,
    },
  } as never);
  app.decorate("platformIngress", { submit: opts.submit } as never);
  app.decorate("paymentPortFactory", async () => ({
    retrievePayment: opts.retrievePayment,
  }) as never);
  await app.register(paymentsWebhookRoutes, { prefix: "/api/webhooks" });
  await app.ready();
  return app;
}

describe("Payments webhook org resolution + charge re-fetch", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env["STRIPE_WEBHOOK_SECRET"];
    process.env["STRIPE_WEBHOOK_SECRET"] = SECRET;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env["STRIPE_WEBHOOK_SECRET"];
    else process.env["STRIPE_WEBHOOK_SECRET"] = saved;
  });

  it("refuses to submit when the org cannot be resolved (no Connection)", async () => {
    const retrievePayment = vi.fn();
    const { submit, calls } = makeSubmitSpy();
    const app = await buildResolvingApp({ connectionOrgId: null, retrievePayment, submit });
    const payload = bodyWithCharge("evt_noorg", "ch_noorg", "acct_unknown", 9999);
    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/payments/webhook",
      headers: { "content-type": "application/json", "x-payment-signature": sign(payload, SECRET) },
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(submit).not.toHaveBeenCalled();
    expect(retrievePayment).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    await app.close();
  });

  it("re-fetches the charge by id and submits the RE-FETCHED amount, never the body amount", async () => {
    const retrievePayment = vi.fn(async (id: string) => ({
      id,
      amountCents: 5000,
      currency: "sgd",
      provider: "stripe",
    }));
    const { submit, calls } = makeSubmitSpy();
    const app = await buildResolvingApp({ connectionOrgId: "org-1", retrievePayment, submit });
    const payload = bodyWithCharge("evt_amt", "ch_amt", "acct_org1", 9999);
    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/payments/webhook",
      headers: { "content-type": "application/json", "x-payment-signature": sign(payload, SECRET) },
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(retrievePayment).toHaveBeenCalledWith("ch_amt");
    expect(submit).toHaveBeenCalledTimes(1);
    const req = calls[0]!;
    expect(req["intent"]).toBe("payment.record_verified");
    expect(req["organizationId"]).toBe("org-1");
    const params = req["parameters"] as { amountCents: number; provider: string };
    expect(params.amountCents).toBe(5000); // RE-FETCHED, not body's 9999
    expect(params.provider).toBe("stripe");
    await app.close();
  });
});

```

- [ ] **Step 3: Run the test and confirm the new resolve/refetch cases FAIL (the route still returns the Task-1 stub 200 without resolving/refetching/submitting).**

Run: `pnpm --filter @switchboard/api exec vitest run src/routes/__tests__/payments-webhook.test.ts`
Expected: FAIL — "refuses to submit ..." may pass incidentally, but "re-fetches the charge ... submits the RE-FETCHED amount" FAILS (retrievePayment/submit never called by the stub).

- [ ] **Step 4: Replace the stub tail of the POST handler in payments-webhook.ts (everything after the 401 block) with the full resolve -> re-fetch -> submit logic. Parse providerMessageId + chargeId + connectedAccountId from the verified body; resolve org via Connection(serviceId:'stripe', externalAccountId); 200-skip if unresolvable; 503 if the factory is absent; re-fetch via retrievePayment; submit payment.record_verified with idempotencyKey=`psp-${providerMessageId}` and the RE-FETCHED amount/currency/provider. Mirrors ad-optimizer.ts:79-136.**

```ts
    // Parse the verified body. Shape is the PSP event envelope; we only read the
    // ids and the connected-account id needed to route — NEVER the amount.
    const payload = request.body as {
      id?: string;
      data?: { object?: { id?: string; account?: string } };
    };
    const providerMessageId = payload.id;
    const chargeId = payload.data?.object?.id;
    const connectedAccountId = payload.data?.object?.account;
    if (!providerMessageId || !chargeId || !connectedAccountId) {
      return reply.code(200).send({ received: true, skipped: true, reason: "unparseable" });
    }

    // Resolve org AFTER verification, from the connected-account id. serviceId is
    // pinned to "stripe" so a forged account id cannot cross services.
    let organizationId: string | null = null;
    if (app.prisma) {
      const connection = await app.prisma.connection.findFirst({
        where: { serviceId: "stripe", externalAccountId: connectedAccountId },
      });
      organizationId = connection?.organizationId ?? null;
    }
    if (!organizationId) {
      app.log.warn({ connectedAccountId }, "No org for payments webhook account, skipping");
      return reply.code(200).send({ received: true, skipped: true, reason: "no_org" });
    }

    // Per-org fetch-back. Fail closed if the factory is not wired (1A-4a) rather
    // than trusting the body amount.
    if (!app.paymentPortFactory) {
      app.log.error("paymentPortFactory not configured; cannot verify charge");
      return reply.code(503).send({ error: "Payment verification unavailable", statusCode: 503 });
    }
    const port = await app.paymentPortFactory(organizationId);
    const charge = await port.retrievePayment(chargeId);

    // Submit the verified writer through ingress. idempotencyKey from the provider
    // message id => a replay is deduped at PlatformIngress (platform-ingress.ts).
    // The amount is the RE-FETCHED amountCents; provider is carried so the 1A-4b
    // handler can degrade a Noop provider (R1).
    const result = await app.platformIngress.submit({
      intent: "payment.record_verified",
      parameters: {
        externalReference: charge.id,
        amountCents: charge.amountCents,
        currency: charge.currency,
        provider: charge.provider,
      },
      actor: { id: "system", type: "service" },
      organizationId,
      trigger: "api",
      surface: { surface: "api" },
      idempotencyKey: `psp-${providerMessageId}`,
    });

    if (!result.ok) {
      app.log.error({ error: result.error }, "payment.record_verified submission failed");
      return reply.code(500).send({ error: result.error.message, statusCode: 500 });
    }
    return reply
      .code(200)
      .send({ received: true, workUnitId: result.workUnit.id, traceId: result.workUnit.traceId });

```

- [ ] **Step 5: Run the test and confirm all signature + resolve/refetch cases PASS.**

Run: `pnpm --filter @switchboard/api exec vitest run src/routes/__tests__/payments-webhook.test.ts`
Expected: PASS — 6 passed (4 signature + unresolvable-org skip + re-fetched-amount submit).

- [ ] **Step 6: Commit.**

Run: `git add apps/api/src/routes/payments-webhook.ts apps/api/src/types/payments-fastify.d.ts apps/api/src/routes/__tests__/payments-webhook.test.ts && git commit -m "feat(api): payments webhook resolves org after verify and submits re-fetched charge amount"`
Expected: Commit succeeds.


#### Task 3: Task 3 — replay dedup: same provider message id -> one record at ingress (TDD)

**Files:**
- Modify: `apps/api/src/routes/__tests__/payments-webhook.test.ts`
- Test: `apps/api/src/routes/__tests__/payments-webhook.test.ts`

- [ ] **Step 1: Add the replay test: POST the SAME provider message id twice. Assert both requests return 200, both produce a submit with the IDENTICAL idempotencyKey (`psp-<id>`), and the fake ingress (which mimics PlatformIngress idempotency via makeSubmitSpy's seen-map) returns the SAME workUnit both times — i.e. exactly one effective record. This proves the route delegates dedup to PlatformIngress via the message-id-derived key rather than re-recording.**

```ts
describe("Payments webhook replay (idempotency at ingress)", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env["STRIPE_WEBHOOK_SECRET"];
    process.env["STRIPE_WEBHOOK_SECRET"] = SECRET;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env["STRIPE_WEBHOOK_SECRET"];
    else process.env["STRIPE_WEBHOOK_SECRET"] = saved;
  });

  it("replaying the same provider message id dedups to one ingress record", async () => {
    const retrievePayment = vi.fn(async (id: string) => ({
      id,
      amountCents: 5000,
      currency: "sgd",
      provider: "stripe",
    }));
    const { submit, calls } = makeSubmitSpy();
    const app = await buildResolvingApp({ connectionOrgId: "org-1", retrievePayment, submit });
    const payload = bodyWithCharge("evt_replay", "ch_replay", "acct_org1", 5000);
    const headers = {
      "content-type": "application/json",
      "x-payment-signature": sign(payload, SECRET),
    };
    const first = await app.inject({ method: "POST", url: "/api/webhooks/payments/webhook", headers, payload });
    const second = await app.inject({ method: "POST", url: "/api/webhooks/payments/webhook", headers, payload });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    // Both submits carried the SAME message-id-derived key...
    expect(calls).toHaveLength(2);
    expect(calls[0]!["idempotencyKey"]).toBe("psp-evt_replay");
    expect(calls[1]!["idempotencyKey"]).toBe("psp-evt_replay");
    // ...and ingress deduped to one workUnit (the replay is a no-op effect).
    expect((first.json() as { workUnitId: string }).workUnitId).toBe(
      (second.json() as { workUnitId: string }).workUnitId,
    );
    await app.close();
  });
});

```

- [ ] **Step 2: Run the full test file and confirm the replay case PASSES alongside the others (the route already derives idempotencyKey from the provider message id, so no impl change is needed — this test pins that contract).**

Run: `pnpm --filter @switchboard/api exec vitest run src/routes/__tests__/payments-webhook.test.ts`
Expected: PASS — 7 passed (the replay returns the same workUnitId; both calls share idempotencyKey psp-evt_replay).

- [ ] **Step 3: Commit.**

Run: `git add apps/api/src/routes/__tests__/payments-webhook.test.ts && git commit -m "test(api): payments webhook replay dedups at ingress via provider message id key"`
Expected: Commit succeeds.


#### Task 4: Task 4 — wire the route, public-route bypass, and route-allowlist

**Files:**
- Modify: `apps/api/src/bootstrap/routes.ts`
- Modify: `apps/api/src/middleware/auth.ts`
- Modify: `.agent/tools/route-allowlist.yaml`
- Test: `apps/api/src/routes/__tests__/payments-webhook.test.ts`

- [ ] **Step 1: Register the route in bootstrap/routes.ts. Add the import next to the other route imports and register the plugin under the already-public "/api/webhooks" prefix, beside webhooksRoutes (routes.ts:215). Add the import line first.**

```ts
import { paymentsWebhookRoutes } from "../routes/payments-webhook.js";
```

- [ ] **Step 2: Add the registration call immediately after the existing webhooksRoutes registration (routes.ts:215: `await app.register(webhooksRoutes, { prefix: "/api/webhooks" });`).**

```ts
  await app.register(paymentsWebhookRoutes, { prefix: "/api/webhooks" });
```

- [ ] **Step 3: Add the auth-middleware bypass so a PSP (no Bearer token) is not 401'd by the auth preHandler. In apps/api/src/middleware/auth.ts, inside the OR-chain at lines 123-136, add the exact-path branch next to the "/api/billing/webhook" entry (line 129).**

```ts
      request.url === "/api/webhooks/payments/webhook" ||
```

- [ ] **Step 4: Add the route-allowlist entry so the ingress static check does not flag the route (the 2-hop scan can't follow the dynamic PlatformIngress resolution — identical to the ad-optimizer.ts entry at .agent/tools/route-allowlist.yaml:141). Add this YAML block right after that ad-optimizer entry.**

```ts
- path: "apps/api/src/routes/payments-webhook.ts"
  reason: "PSP payments webhook — inbound ingress-receiver; calls app.platformIngress.submit(payment.record_verified), but the 2-hop import scan misses the dynamic resolution through @switchboard/core/platform (same as ad-optimizer.ts)."
```

- [ ] **Step 5: Run the ingress/route-class check to confirm the new route is recognized and not flagged. (CI runs this via scripts/local-verify-fast.ts; the direct invocation is the route checker.)**

Run: `CI=1 npx tsx .agent/tools/check-routes.ts --mode=error`
Expected: Exit 0 — no missing-header error for payments-webhook.ts (it carries `// @route-class: ingress-receiver`) and no kept ingress finding (the allowlist entry suppresses it).

- [ ] **Step 6: Typecheck the api package to confirm the FastifyInstance augmentation (payments-fastify.d.ts) resolves app.paymentPortFactory and the route compiles against the real types. If it reports missing @switchboard/schemas exports (PaymentPort comes from 1A-4a), run `pnpm reset` first per CLAUDE.md, then re-run.**

Run: `pnpm --filter @switchboard/api typecheck`
Expected: PASS — no type errors. (If PaymentPort is unresolved because 1A-4a is not yet merged into this branch, that is the dependency boundary; on the integration branch it resolves.)

- [ ] **Step 7: Run the full route test file once more to confirm nothing regressed after wiring.**

Run: `pnpm --filter @switchboard/api exec vitest run src/routes/__tests__/payments-webhook.test.ts`
Expected: PASS — 7 passed.

- [ ] **Step 8: Commit the wiring.**

Run: `git add apps/api/src/bootstrap/routes.ts apps/api/src/middleware/auth.ts .agent/tools/route-allowlist.yaml && git commit -m "feat(api): register payments webhook route, bypass auth, allowlist ingress check"`
Expected: Commit succeeds; branch context verified (git branch --show-current matches the 1A-4c implementation branch).


---

## 1A-4d — feat(api): live stripe connect payment adapter behind paymentport

**Goal:** Ship a live StripeConnectPaymentAdapter that `implements PaymentPort` (the FIXED 1A-4a contract: EXACTLY two methods — `createDepositLink(input: DepositLinkInput): Promise<DepositLink>` and `retrievePayment(externalReference: string): Promise<VerifiedPayment | null>`) so the prove leg can take REAL money on a connected Stripe account without changing the webhook route, the verified-payment writer, or the port contract. createDepositLink opens a Connect destination-charge Checkout Session on the connected account with a deterministic Stripe idempotency key `deposit_${bookingId}` (re-issue reuses it, so money is never double-charged). retrievePayment fetches the PaymentIntent by id and returns the AUTHORITATIVE Stripe-side amount/currency/status mapped into VerifiedPayment (NEVER a webhook body amount — the money-authority rule). Webhook signature verification stays the STANDALONE `verifyPaymentWebhookSignature` seam from 1A-4c — this PR provides the Connect `constructEvent` shape that seam expects via an exported `verifyConnectWebhookSignature(client, rawBody, signature, connectWebhookSecret)`, using the PER-ORG Connect webhook secret — it is NOT a third PaymentPort method. The per-org factory from 1A-4a is extended to return the Stripe adapter when the org has a connected `stripe` Connection carrying full Connect creds, else keep returning Noop — fail-closed: NEVER fall back to a global env secret for a live money write (do NOT extend the existing subscription billing stripe-service.ts; its secret is the wrong account). The injected Stripe client is typed to EXACTLY checkout.sessions.create / paymentIntents.retrieve / webhooks.constructEvent, so no `any`. Everything new is apps/api (L5); the only @switchboard/schemas import is the PaymentPort types; decryptCredentials is imported from @switchboard/db (L4, allowed from L5); NO @switchboard/core import; NO Prisma migration. DEPENDS ON 1A-4a (PaymentPort + types + Noop adapter + factory), 1A-4b (Noop fast-follow groundwork), 1A-4c (payments-webhook.ts + verifyPaymentWebhookSignature seam) — none merged yet as of 2026-06-06 (verified: no payment.ts / payment-port-factory.ts / noop-payment-adapter.ts / payments-webhook.ts in main or the worktree). Do NOT start until those land; re-read packages/schemas/src/payment.ts at execution start and reconcile any concrete field-name drift on DepositLinkInput/DepositLink/VerifiedPayment — fix the adapter to the real schema, never introduce a parallel type.

**File structure:**

| Action | Path | Responsibility |
|---|---|---|
| create | `apps/api/src/payments/stripe-connect-payment-adapter.ts` | StripeConnectPaymentAdapter class implementing PaymentPort (only createDepositLink + retrievePayment) + exported StripeConnectClient narrow type (exactly checkout.sessions.create / paymentIntents.retrieve / webhooks.constructEvent, no any) + exported module-level mapPaymentIntentStatus + exported standalone verifyConnectWebhookSignature seam. createDepositLink = a Connect destination-charge Checkout Session with stripeAccount option + deterministic idempotencyKey deposit_${bookingId}. retrievePayment = paymentIntents.retrieve returning the Stripe-side amount/currency/status (never a body amount), null on resource_missing. |
| create | `apps/api/src/payments/stripe-connect-payment-adapter.test.ts` | Co-located unit tests with an injected fake Stripe client (vi.fn, no network): createDepositLink builds a destination charge on the connected account and returns url + payment_intent id as externalReference; re-issue reuses the identical idempotencyKey deposit_${bookingId}; retrievePayment returns the AUTHORITATIVE Stripe amount/currency (not a body amount) + status mapping matrix (succeeded->verified, processing/requires_*->pending, canceled->failed) + null on resource_missing; verifyConnectWebhookSignature returns the constructed event on a good signature and rethrows on a tampered one using the per-org Connect secret. |
| create | `apps/api/src/payments/stripe-connect-credentials.ts` | Pure fail-closed parser parseStripeConnectCredentials(decrypted: Record<string, unknown>) -> { connectedAccountId, secretKey, webhookSecret } | null. Returns null unless ALL three are non-empty strings, so the factory can never build a live-money adapter from partial creds. No deps. |
| create | `apps/api/src/payments/stripe-connect-credentials.test.ts` | Co-located unit tests for the credential parser: full creds parse (extra keys ignored); each missing / blank / non-string field yields null; empty object yields null. |
| modify | `apps/api/src/bootstrap/payment-port-factory.ts` | Extend the 1A-4a per-org factory: add optional injectable decryptCredentials + stripeClientFactory deps (defaulting to @switchboard/db decryptCredentials and a real new Stripe(secretKey,{apiVersion}) constructor); query the org's connected stripe Connection (findFirst where organizationId + serviceId:'stripe' + status:'connected'), decrypt + parse fail-closed, and on full creds return a StripeConnectPaymentAdapter built from the PER-ORG secret; otherwise keep the existing Noop return. Preserve the per-org cache + ORG_ID_REQUIRED scaffolding untouched. |
| modify | `apps/api/src/bootstrap/__tests__/payment-port-factory.test.ts` | Add a 'Stripe Connect selection' describe block (keeping the 1A-4a Noop tests intact): factory returns a StripeConnectPaymentAdapter (not Noop) for a connected stripe Connection with full creds; returns Noop when no stripe Connection; returns Noop when creds are partial (fail-closed); the Connection query filters by organizationId for cross-org isolation; the injected stripeClientFactory is called with the per-org secretKey. |

**Notes:** PLAN PROVENANCE: This PR is the "Live Stripe Connect adapter" leg. The task labels it 1A-4d; the already-committed 420KB implementation plan (.claude/worktrees/close-the-revenue-loop/docs/superpowers/plans/2026-06-06-close-the-revenue-loop-spec-1a.md, lines 4803-5647) calls the identical work "1A-4b". Same scope, same files, same canonical contract. I reproduced that fully-worked section and re-verified every load-bearing claim against the actual repo + installed Stripe v22.1.0 typedefs.

DEPENDENCY STATE (verified TODAY 2026-06-06): payment.ts, payment-port-factory.ts, noop-payment-adapter.ts, payments-webhook.ts do NOT exist in main or the close-the-revenue-loop worktree (the four `ls` returned No such file). So 1A-4a / 1A-4b / 1A-4c are NOT merged yet. Per the task, the 1A-4a contract is treated as FIXED and consumed verbatim. Task 1 Step 1 and Task 6 Step 1 are mandatory pre-flight re-reads to reconcile any concrete field-name drift; if payment.ts is absent at execution time, STOP — the dependency has not landed.

CANONICAL CONTRACT (used verbatim, no hedging): PaymentPort has EXACTLY two methods — createDepositLink(input: DepositLinkInput): Promise<DepositLink> and retrievePayment(externalReference: string): Promise<VerifiedPayment | null>. Webhook signature verification is the STANDALONE verifyPaymentWebhookSignature(rawBody, signature, secret) from 1A-4c — NOT a port method. This PR exports verifyConnectWebhookSignature(client, rawBody, signature, connectWebhookSecret) as the constructEvent shape that seam calls with the per-org Connect secret; it is deliberately NOT on PaymentPort. Assumed field set (reconcile at execution): DepositLinkInput{organizationId,bookingId,amountCents,currency,description?,successUrl,cancelUrl}; DepositLink{url,externalReference}; VerifiedPayment{externalReference,amountCents,currency,status:'verified'|'pending'|'failed'}.

STRIPE v22 TYPES VERIFIED (no `any`, all in apps/api/node_modules/stripe/cjs): RequestOptions.idempotencyKey + .stripeAccount (lib.d.ts:111,117); PaymentIntent.Status union 'canceled'|'processing'|'requires_action'|'requires_capture'|'requires_confirmation'|'requires_payment_method'|'succeeded' (resources/PaymentIntents.d.ts:620); PaymentIntent.amount:number(157) .currency:string(210) .status(326) .id(149); Response<T>=T&{...} (lib.d.ts:163) so intent.id/.amount/.currency/.status are directly accessible; checkout.sessions.create(params?,options?):Promise<Response<Session>> (resources/Checkout/Sessions.d.ts:25); Session.payment_intent: string|PaymentIntent|null (214) — handled by the typeof==='string' branch; paymentIntents.retrieve(id,params?,options?):Promise<Response<PaymentIntent>> (resources/PaymentIntents.d.ts:38); webhooks.constructEvent(payload,header,secret,...):Event (cjs/Webhooks.d.ts:31) with WebhookPayload=string|Uint8Array, WebhookHeader=string|string[]|Uint8Array — so the narrow string|Buffer/string params are structurally compatible (Buffer is a Uint8Array subtype); StripeError.code?:string (cjs/Error.d.ts:20) backs isStripeResourceMissing; SessionCreateParams supports mode(2184)/payment_intent_data(2214)/transfer_data(2612)/line_items.price_data(2501)/product_data(3232)/unit_amount(3242). NOTE: the real SDK declares create's params as OPTIONAL while the narrow StripeConnectClient declares it required — a safe narrowing because a real Stripe instance is widened via `as unknown as StripeConnectClient` and the adapter always passes params.

MONEY-AUTHORITY (spec §9.4, cross-cutting R1/R5 spirit): retrievePayment returns intent.amount/intent.currency FROM Stripe, never a caller- or webhook-body amount (dedicated test asserts the re-fetched amount differs from any body value). Stripe amount is already minor units (cents) and currency is lowercase ISO — mapped directly, do NOT re-multiply; a 100x bug destroys trust (spec §12). The Noop-vs-live tier separation (R1: a noop payment is T3 DEGRADED, never a T1 paid visit in production) is enforced upstream in the verified-payment writer / receipt model (1A-3, 1A-4a) — this adapter PR's job is only to ensure a REAL Stripe adapter is selected fail-closed and returns authoritative amounts; it adds no production-countable evidence itself.

FAIL-CLOSED (spec §12, locked decision): the factory builds the Stripe adapter ONLY from a per-org connected 'stripe' Connection carrying full Connect creds (connectedAccountId+secretKey+webhookSecret all non-empty). Partial creds or no Connection -> Noop. NEVER falls back to a global env secret for a live money write. The existing subscription billing stripe-service.ts uses mode:'subscription' + global STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET — do NOT extend it and do NOT reuse its secret (wrong account). 'stripe' is the canonical payments serviceId (prisma-credential-resolver.ts:24).

DETERMINISTIC IDEMPOTENCY: createDepositLink passes RequestOptions.idempotencyKey=`deposit_${bookingId}` so re-issue returns the same Session and money is never double-charged (Task 2 test pins identical keys across two calls). This is the STRIPE-side key, distinct from the DB unique on externalReference owned by 1A-4a.

PATTERNS MIRRORED (verified file:line): factory shape + per-org Map cache + ORG_ID_REQUIRED reject + resolveForOrg + Noop fallback from apps/api/src/bootstrap/calendar-provider-factory.ts:5-100; the injectable decryptCredentials seam + the `((encrypted:unknown)=>defaultDecryptCredentials(encrypted as string))` adapter + the cross-org WHERE from apps/api/src/lib/ads-client-factory.ts:2,7,30-31,36-42; the exact Connection query findFirst({where:{organizationId,serviceId,status:'connected'},select}) from apps/api/src/lib/meta-spend-provider.ts:51-54; the test injection style (prisma vi.fn stub, decrypt injected, `as never`) from apps/api/src/lib/__tests__/ads-client-factory.test.ts:1-55; isNoop guard via instanceof from apps/api/src/bootstrap/noop-calendar-provider.ts:82-84; new Stripe(key,{apiVersion:'2026-04-22.dahlia'}) + webhooks.constructEvent(body,sig,secret) from apps/api/src/services/stripe-service.ts:13,73; decryptCredentials exported from @switchboard/db barrel at packages/db/src/index.ts:45.

LAYERING / FILE-SIZE: everything new is apps/api (L5). Only @switchboard/schemas (PaymentPort types) + @switchboard/db (decryptCredentials) are imported; NO @switchboard/core, ad-optimizer untouched (Task 7 Step 5 greps to prove it). Adapter ~110-150 lines, parser tiny, factory edited in place — all under the 400-line warn gate; split into adapter / credentials-parser so nothing inlines into the factory (CLAUDE.md hot-spot rule). No new barrel. NO Prisma migration in this PR. All commit subjects are conventional-commit lowercase (commitlint). API test command is `vitest run`, so `pnpm --filter @switchboard/api test <path>` runs a single file; `pnpm --filter @switchboard/api typecheck`=tsc --noEmit, lint=eslint src --ext .ts (package.json verified).

ONE STRIPE-SEMANTICS FLAG (preserved from the approved plan, non-blocking): the createDepositLink body sets BOTH payment_intent_data.transfer_data.destination AND the stripeAccount RequestOptions. In real Stripe, a destination charge is created on the PLATFORM account with transfer_data.destination, whereas a direct charge is created ON the connected account with stripeAccount — using both together is contradictory at the live API. Because every test injects a fake client (no real Stripe call), all tests pass as written and the deterministic-key + destination assertions hold. The spec's goal sentence says "destination-charge Checkout Session on the connected account," and the plan's code (reproduced verbatim here as the approved contract) encodes both. Before flipping to a real connected account, the implementer should reconcile to ONE Connect charge model (most likely a direct charge: keep stripeAccount + on_behalf_of, drop transfer_data; OR keep transfer_data + application_fee_amount and drop stripeAccount) and add an integration assertion against a Stripe test-mode connected account. This is a live-money correctness item to resolve at the go-live gate, not a unit-test blocker.

#### Task 1: Task 1 — StripeConnectClient narrow type + adapter skeleton implementing PaymentPort (createDepositLink as a destination-charge Checkout Session)

**Files:**
- Create: `apps/api/src/payments/stripe-connect-payment-adapter.ts`
- Create: `apps/api/src/payments/stripe-connect-payment-adapter.test.ts`
- Test: `apps/api/src/payments/stripe-connect-payment-adapter.test.ts`

- [ ] **Step 1: PRE-FLIGHT (before writing any code): confirm the 1A-4a/1A-4c dependencies have merged and re-read the REAL PaymentPort contract so the adapter implements the actual interface, not the assumption. If payment.ts is missing, STOP — 1A-4a is the hard dependency (verified absent in the source repo today). Note the EXACT field names on DepositLinkInput / DepositLink / VerifiedPayment and use them verbatim below; the field set assumed from the spec is DepositLinkInput{organizationId,bookingId,amountCents,currency,description?,successUrl,cancelUrl}, DepositLink{url,externalReference}, VerifiedPayment{externalReference,amountCents,currency,status:'verified'|'pending'|'failed'}. If any differ, substitute the real names in every step.**

Run: `ls apps/api/src/bootstrap/payment-port-factory.ts apps/api/src/bootstrap/noop-payment-adapter.ts apps/api/src/routes/payments-webhook.ts packages/schemas/src/payment.ts && sed -n '1,80p' packages/schemas/src/payment.ts`
Expected: All four files exist and payment.ts shows `export interface PaymentPort` with exactly `createDepositLink(input: DepositLinkInput): Promise<DepositLink>` and `retrievePayment(externalReference: string): Promise<VerifiedPayment | null>`, plus the DepositLinkInput / DepositLink / VerifiedPayment exports. (If any file is missing, the dependency PR has not merged — do not proceed.)

- [ ] **Step 2: Write the FAILING test file FIRST. It defines a structural fake of exactly the three Stripe resources the adapter uses (vi.fn, no network, no `any`), constructs the adapter, and asserts createDepositLink returns a DepositLink whose url is the Checkout Session url and whose externalReference is the session's payment_intent id, created ON the connected account (stripeAccount option) in mode 'payment'. The adapter module does not exist yet, so this fails to resolve.**

```ts
import { describe, it, expect, vi } from "vitest";
import {
  StripeConnectPaymentAdapter,
  type StripeConnectClient,
} from "./stripe-connect-payment-adapter.js";

// A structural fake of exactly the three Stripe resources the adapter uses.
// vi.fn lets us assert call args without any network or `any`.
function makeFakeClient(overrides?: {
  sessionUrl?: string;
  paymentIntentId?: string;
}): {
  client: StripeConnectClient;
  createSession: ReturnType<typeof vi.fn>;
  retrievePI: ReturnType<typeof vi.fn>;
  constructEvent: ReturnType<typeof vi.fn>;
} {
  const createSession = vi.fn(async () => ({
    url: overrides?.sessionUrl ?? "https://checkout.stripe.com/c/pay/cs_test_123",
    payment_intent: overrides?.paymentIntentId ?? "pi_test_123",
  }));
  const retrievePI = vi.fn();
  const constructEvent = vi.fn();
  const client = {
    checkout: { sessions: { create: createSession } },
    paymentIntents: { retrieve: retrievePI },
    webhooks: { constructEvent },
  } as unknown as StripeConnectClient;
  return { client, createSession, retrievePI, constructEvent };
}

const connectedAccountId = "acct_connected_1";

describe("StripeConnectPaymentAdapter.createDepositLink", () => {
  it("opens a Checkout Session on the connected account and returns url + externalReference", async () => {
    const { client, createSession } = makeFakeClient({
      sessionUrl: "https://checkout.stripe.com/c/pay/cs_live_abc",
      paymentIntentId: "pi_live_abc",
    });
    const adapter = new StripeConnectPaymentAdapter({ client, connectedAccountId });

    const link = await adapter.createDepositLink({
      organizationId: "org_1",
      bookingId: "bk_1",
      amountCents: 5000,
      currency: "sgd",
      successUrl: "https://app/success",
      cancelUrl: "https://app/cancel",
    });

    expect(link.url).toBe("https://checkout.stripe.com/c/pay/cs_live_abc");
    expect(link.externalReference).toBe("pi_live_abc");

    // Destination charge: the session is created ON the connected account.
    const [params, options] = createSession.mock.calls[0];
    expect(options.stripeAccount).toBe(connectedAccountId);
    expect(params.mode).toBe("payment");
  });
});
```

- [ ] **Step 3: Run the new test. It MUST fail because the module does not exist yet.**

Run: `pnpm --filter @switchboard/api test src/payments/stripe-connect-payment-adapter.test.ts`
Expected: Vitest fails to resolve the suite with an error like: Failed to resolve import "./stripe-connect-payment-adapter.js" (the adapter module has not been created).

- [ ] **Step 4: Create the adapter module. Type StripeConnectClient to EXACTLY the three Stripe resources, reusing the real Stripe types (import type Stripe from "stripe") so there is no `any`. Implement createDepositLink as a Connect destination-charge Checkout Session created WITH the stripeAccount option AND the deterministic idempotencyKey `deposit_${input.bookingId}`. Stub retrievePayment with a throwing body for now (Task 3 replaces it) so the class compiles as a PaymentPort. (Real Stripe v22 signatures verified: apps/api/node_modules/stripe/cjs/resources/Checkout/Sessions.d.ts:25 create(params?,options?); resources/PaymentIntents.d.ts:38 retrieve(id,params?,options?); cjs/Webhooks.d.ts:31 constructEvent(payload,header,secret,...); RequestOptions.idempotencyKey + .stripeAccount at cjs/lib.d.ts:111,117; Session.payment_intent: string|PaymentIntent|null at resources/Checkout/Sessions.d.ts:214.)**

```ts
import type Stripe from "stripe";
import type {
  PaymentPort,
  DepositLinkInput,
  DepositLink,
  VerifiedPayment,
} from "@switchboard/schemas";

/**
 * The exact slice of the Stripe SDK this adapter touches. Typing it this
 * narrowly (rather than the whole `Stripe` instance) keeps the unit tests'
 * fake small and avoids `any` while preserving Stripe's real param/return
 * types. Signatures mirror stripe v22 (apps/api/node_modules/stripe/cjs).
 */
export interface StripeConnectClient {
  checkout: {
    sessions: {
      create(
        params: Stripe.Checkout.SessionCreateParams,
        options?: Stripe.RequestOptions,
      ): Promise<Stripe.Response<Stripe.Checkout.Session>>;
    };
  };
  paymentIntents: {
    retrieve(
      id: string,
      params?: Stripe.PaymentIntentRetrieveParams,
      options?: Stripe.RequestOptions,
    ): Promise<Stripe.Response<Stripe.PaymentIntent>>;
  };
  webhooks: {
    constructEvent(payload: string | Buffer, header: string, secret: string): Stripe.Event;
  };
}

export interface StripeConnectPaymentAdapterDeps {
  client: StripeConnectClient;
  /** The connected account id (acct_...) money is routed to. */
  connectedAccountId: string;
}

export class StripeConnectPaymentAdapter implements PaymentPort {
  private readonly client: StripeConnectClient;
  private readonly connectedAccountId: string;

  constructor(deps: StripeConnectPaymentAdapterDeps) {
    this.client = deps.client;
    this.connectedAccountId = deps.connectedAccountId;
  }

  async createDepositLink(input: DepositLinkInput): Promise<DepositLink> {
    const session = await this.client.checkout.sessions.create(
      {
        mode: "payment",
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: input.currency,
              unit_amount: input.amountCents,
              product_data: { name: input.description ?? "Deposit" },
            },
          },
        ],
        payment_intent_data: {
          transfer_data: { destination: this.connectedAccountId },
          metadata: { bookingId: input.bookingId, organizationId: input.organizationId },
        },
        metadata: { bookingId: input.bookingId, organizationId: input.organizationId },
      },
      {
        stripeAccount: this.connectedAccountId,
        idempotencyKey: `deposit_${input.bookingId}`,
      },
    );

    if (!session.url) {
      throw new Error(`Stripe Checkout Session for booking ${input.bookingId} has no url`);
    }
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : (session.payment_intent?.id ?? null);
    if (!paymentIntentId) {
      throw new Error(
        `Stripe Checkout Session for booking ${input.bookingId} has no payment_intent`,
      );
    }

    return { url: session.url, externalReference: paymentIntentId };
  }

  async retrievePayment(_externalReference: string): Promise<VerifiedPayment | null> {
    throw new Error("retrievePayment not implemented yet");
  }
}
```

- [ ] **Step 5: Run the test again. createDepositLink is now implemented and the destination-charge assertions pass.**

Run: `pnpm --filter @switchboard/api test src/payments/stripe-connect-payment-adapter.test.ts`
Expected: 1 passing test ("opens a Checkout Session on the connected account and returns url + externalReference"). No retrievePayment / verify tests run yet.

- [ ] **Step 6: Verify the active branch matches this work (CLAUDE.md branch doctrine), then commit the skeleton.**

Run: `git branch --show-current && git add apps/api/src/payments/stripe-connect-payment-adapter.ts apps/api/src/payments/stripe-connect-payment-adapter.test.ts && git commit -m "feat(api): stripe connect deposit-link via destination-charge checkout session"`
Expected: On the 1A-4d implementation branch; one commit created (conventional-commit lowercase subject).


#### Task 2: Task 2 — Deterministic Stripe idempotency key (re-issue reuses deposit_${bookingId})

**Files:**
- Modify: `apps/api/src/payments/stripe-connect-payment-adapter.test.ts`
- Test: `apps/api/src/payments/stripe-connect-payment-adapter.test.ts`

- [ ] **Step 1: Append a regression test asserting that issuing a deposit link twice for the SAME bookingId sends the IDENTICAL Stripe idempotencyKey `deposit_${bookingId}` (so Stripe returns the same Session and money is never double-charged). Task 1 already wired this; the spec calls it out as a KEY test, so lock it explicitly. This is the STRIPE-side RequestOptions key, distinct from the DB unique on externalReference owned by 1A-4a.**

```ts
describe("StripeConnectPaymentAdapter.createDepositLink idempotency", () => {
  it("reuses the deterministic key `deposit_${bookingId}` on re-issue", async () => {
    const { client, createSession } = makeFakeClient();
    const adapter = new StripeConnectPaymentAdapter({ client, connectedAccountId });

    const input = {
      organizationId: "org_1",
      bookingId: "bk_42",
      amountCents: 5000,
      currency: "sgd",
      successUrl: "https://app/success",
      cancelUrl: "https://app/cancel",
    };

    await adapter.createDepositLink(input);
    await adapter.createDepositLink(input);

    expect(createSession).toHaveBeenCalledTimes(2);
    const firstKey = createSession.mock.calls[0][1].idempotencyKey;
    const secondKey = createSession.mock.calls[1][1].idempotencyKey;
    expect(firstKey).toBe("deposit_bk_42");
    expect(secondKey).toBe("deposit_bk_42");
    expect(firstKey).toBe(secondKey);
  });
});
```

- [ ] **Step 2: Run the test. It passes immediately because Task 1 already wired the deterministic key — this test is the regression guard.**

Run: `pnpm --filter @switchboard/api test src/payments/stripe-connect-payment-adapter.test.ts`
Expected: 3 passing tests total: the original create test plus the two idempotency assertions in the new block ("reuses the deterministic key ...").

- [ ] **Step 3: Commit the idempotency regression test.**

Run: `git add apps/api/src/payments/stripe-connect-payment-adapter.test.ts && git commit -m "test(api): pin deterministic stripe idempotency key on deposit re-issue"`
Expected: One commit created.


#### Task 3: Task 3 — retrievePayment returns the AUTHORITATIVE Stripe-side amount/currency/status (never a body amount)

**Files:**
- Modify: `apps/api/src/payments/stripe-connect-payment-adapter.ts`
- Modify: `apps/api/src/payments/stripe-connect-payment-adapter.test.ts`
- Test: `apps/api/src/payments/stripe-connect-payment-adapter.test.ts`

- [ ] **Step 1: Write FAILING tests for retrievePayment. Assert it calls paymentIntents.retrieve with the externalReference ON the connected account, returns the amount/currency FROM the PaymentIntent (the money-authority rule — never a caller/body value), and maps status: succeeded->'verified'; processing/requires_payment_method/requires_capture->'pending'; canceled->'failed'. Stripe amount is already in minor units (cents) and currency is lowercase ISO — map directly to amountCents/currency, do NOT re-multiply (a 100x bug destroys trust). Append both describe blocks.**

```ts
function makeClientReturningPI(pi: {
  id: string;
  amount: number;
  currency: string;
  status: string;
}): { client: StripeConnectClient; retrievePI: ReturnType<typeof vi.fn> } {
  const retrievePI = vi.fn(async () => pi);
  const client = {
    checkout: { sessions: { create: vi.fn() } },
    paymentIntents: { retrieve: retrievePI },
    webhooks: { constructEvent: vi.fn() },
  } as unknown as StripeConnectClient;
  return { client, retrievePI };
}

describe("StripeConnectPaymentAdapter.retrievePayment", () => {
  it("returns the AUTHORITATIVE Stripe-side amount/currency, not a body amount", async () => {
    const { client, retrievePI } = makeClientReturningPI({
      id: "pi_live_abc",
      amount: 5000,
      currency: "sgd",
      status: "succeeded",
    });
    const adapter = new StripeConnectPaymentAdapter({ client, connectedAccountId });

    const result = await adapter.retrievePayment("pi_live_abc");

    expect(result).not.toBeNull();
    expect(result?.externalReference).toBe("pi_live_abc");
    expect(result?.amountCents).toBe(5000);
    expect(result?.currency).toBe("sgd");
    expect(result?.status).toBe("verified");
    // Re-fetched on the connected account.
    const [id, _params, options] = retrievePI.mock.calls[0];
    expect(id).toBe("pi_live_abc");
    expect(options.stripeAccount).toBe(connectedAccountId);
  });

  it("maps non-terminal statuses to pending and canceled to failed", async () => {
    for (const [stripeStatus, expected] of [
      ["processing", "pending"],
      ["requires_payment_method", "pending"],
      ["requires_capture", "pending"],
      ["canceled", "failed"],
    ] as const) {
      const { client } = makeClientReturningPI({
        id: "pi_x",
        amount: 100,
        currency: "sgd",
        status: stripeStatus,
      });
      const adapter = new StripeConnectPaymentAdapter({ client, connectedAccountId });
      const result = await adapter.retrievePayment("pi_x");
      expect(result?.status).toBe(expected);
    }
  });
});
```

- [ ] **Step 2: Run the suite. The two new retrievePayment tests MUST fail because retrievePayment still throws 'not implemented yet'.**

Run: `pnpm --filter @switchboard/api test src/payments/stripe-connect-payment-adapter.test.ts`
Expected: 2 failing tests in the retrievePayment block (Error: "retrievePayment not implemented yet"); the 3 create/idempotency tests still pass.

- [ ] **Step 3: Replace the throwing retrievePayment stub with the real implementation, and add a module-level pure mapPaymentIntentStatus + isStripeResourceMissing helper. PLACEMENT: the class currently ends with the throwing retrievePayment stub followed by the class-closing `}`. Delete that stub method AND the class-closing `}`, then paste the block below so the new retrievePayment becomes the last method, the class `}` is the one in the pasted block, and the two helper functions sit at MODULE scope after the class. Verify the file has exactly one class-closing brace afterward. (Stripe v22 verified: PaymentIntent.Status union at resources/PaymentIntents.d.ts:620; .amount:number:157, .currency:string:210, .status:326, .id:149; Response<T>=T&{...} at cjs/lib.d.ts:163 so intent.id/.amount/.currency/.status are directly accessible; StripeError.code?:string at cjs/Error.d.ts:20.)**

```ts
  async retrievePayment(externalReference: string): Promise<VerifiedPayment | null> {
    let intent: Stripe.Response<Stripe.PaymentIntent>;
    try {
      intent = await this.client.paymentIntents.retrieve(
        externalReference,
        undefined,
        { stripeAccount: this.connectedAccountId },
      );
    } catch (err) {
      // A missing PaymentIntent is a not-found, not a crash — let the caller
      // (the webhook route) treat it as "nothing to record".
      if (isStripeResourceMissing(err)) return null;
      throw err;
    }

    return {
      externalReference: intent.id,
      // amount/currency are the AUTHORITATIVE Stripe values — never a body amount.
      amountCents: intent.amount,
      currency: intent.currency,
      status: mapPaymentIntentStatus(intent.status),
    };
  }
}

/** Map Stripe's PaymentIntent.Status onto the VerifiedPayment status union. */
export function mapPaymentIntentStatus(
  status: Stripe.PaymentIntent.Status,
): VerifiedPayment["status"] {
  switch (status) {
    case "succeeded":
      return "verified";
    case "canceled":
      return "failed";
    default:
      // requires_payment_method | requires_confirmation | requires_action
      // | processing | requires_capture
      return "pending";
  }
}

function isStripeResourceMissing(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "resource_missing"
  );
}
```

- [ ] **Step 4: Run the suite. All 5 tests pass (create, 2 idempotency-key assertions, 2 retrievePayment behaviors incl. the status matrix).**

Run: `pnpm --filter @switchboard/api test src/payments/stripe-connect-payment-adapter.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Add a not-found test locking the resource_missing -> null path. Append this describe block.**

```ts
describe("StripeConnectPaymentAdapter.retrievePayment not-found", () => {
  it("returns null when the PaymentIntent does not exist", async () => {
    const retrievePI = vi.fn(async () => {
      throw Object.assign(new Error("No such payment_intent"), { code: "resource_missing" });
    });
    const client = {
      checkout: { sessions: { create: vi.fn() } },
      paymentIntents: { retrieve: retrievePI },
      webhooks: { constructEvent: vi.fn() },
    } as unknown as StripeConnectClient;
    const adapter = new StripeConnectPaymentAdapter({ client, connectedAccountId });

    await expect(adapter.retrievePayment("pi_missing")).resolves.toBeNull();
  });
});
```

- [ ] **Step 6: Run the suite; the not-found test passes.**

Run: `pnpm --filter @switchboard/api test src/payments/stripe-connect-payment-adapter.test.ts`
Expected: 6 tests pass.

- [ ] **Step 7: Commit retrievePayment.**

Run: `git add apps/api/src/payments/stripe-connect-payment-adapter.ts apps/api/src/payments/stripe-connect-payment-adapter.test.ts && git commit -m "feat(api): retrievepayment returns authoritative stripe amount and mapped status"`
Expected: One commit created.


#### Task 4: Task 4 — Standalone Connect constructEvent verifier (the seam, NOT a port method) rejecting tampered signatures

**Files:**
- Modify: `apps/api/src/payments/stripe-connect-payment-adapter.ts`
- Modify: `apps/api/src/payments/stripe-connect-payment-adapter.test.ts`
- Test: `apps/api/src/payments/stripe-connect-payment-adapter.test.ts`

- [ ] **Step 1: Write FAILING tests for an EXPORTED standalone verifier verifyConnectWebhookSignature(client, rawBody, signature, connectWebhookSecret) that delegates to the injected client's webhooks.constructEvent with the PER-ORG Connect secret. Assert it returns the constructed event on a good signature and rethrows when constructEvent throws a signature error (tampered body/sig). This is the shape the route's verifyPaymentWebhookSignature seam (from 1A-4c) calls — it is deliberately NOT on PaymentPort. Add the import at the TOP of the test file (alongside the existing imports) and append the describe block.**

```ts
// add to the existing top-of-file imports:
import { verifyConnectWebhookSignature } from "./stripe-connect-payment-adapter.js";

describe("verifyConnectWebhookSignature", () => {
  it("returns the constructed event using the per-org Connect secret", () => {
    const fakeEvent = { id: "evt_1", type: "payment_intent.succeeded" };
    const constructEvent = vi.fn(() => fakeEvent);
    const client = {
      checkout: { sessions: { create: vi.fn() } },
      paymentIntents: { retrieve: vi.fn() },
      webhooks: { constructEvent },
    } as unknown as StripeConnectClient;

    const event = verifyConnectWebhookSignature(
      client,
      '{"id":"evt_1"}',
      "t=1,v1=goodsig",
      "whsec_connect_secret",
    );

    expect(event).toBe(fakeEvent);
    expect(constructEvent).toHaveBeenCalledWith(
      '{"id":"evt_1"}',
      "t=1,v1=goodsig",
      "whsec_connect_secret",
    );
  });

  it("rethrows when the signature is tampered (constructEvent throws)", () => {
    const constructEvent = vi.fn(() => {
      throw new Error("No signatures found matching the expected signature for payload");
    });
    const client = {
      checkout: { sessions: { create: vi.fn() } },
      paymentIntents: { retrieve: vi.fn() },
      webhooks: { constructEvent },
    } as unknown as StripeConnectClient;

    expect(() =>
      verifyConnectWebhookSignature(client, '{"id":"evt_1"}', "t=1,v1=BADSIG", "whsec_connect_secret"),
    ).toThrow(/No signatures found/);
  });
});
```

- [ ] **Step 2: Run the suite. The two new tests MUST fail because verifyConnectWebhookSignature is not exported yet.**

Run: `pnpm --filter @switchboard/api test src/payments/stripe-connect-payment-adapter.test.ts`
Expected: 2 failing tests in the verifyConnectWebhookSignature block (the named export is undefined -> "verifyConnectWebhookSignature is not a function"); the 6 prior tests pass.

- [ ] **Step 3: Add the exported standalone verifier at MODULE scope in the adapter file (after the helper functions from Task 3). It simply delegates to the injected client's constructEvent with the per-org Connect secret, letting Stripe's own signature error propagate. It is deliberately NOT a method on the adapter / PaymentPort. (Real constructEvent verified: cjs/Webhooks.d.ts:31 constructEvent(payload, header, secret, ...) => Event; WebhookPayload=string|Uint8Array, WebhookHeader=string|string[]|Uint8Array — so the narrow string|Buffer / string params are structurally compatible.)**

```ts
/**
 * Verify a Connect webhook payload's signature using the PER-ORG Connect
 * webhook secret (separate from the billing STRIPE_WEBHOOK_SECRET). This is
 * the seam the payments-webhook route's `verifyPaymentWebhookSignature` calls;
 * it is intentionally a standalone function, NOT a PaymentPort method. Stripe's
 * StripeSignatureVerificationError propagates on a tampered body/signature.
 */
export function verifyConnectWebhookSignature(
  client: StripeConnectClient,
  rawBody: string | Buffer,
  signature: string,
  connectWebhookSecret: string,
): Stripe.Event {
  return client.webhooks.constructEvent(rawBody, signature, connectWebhookSecret);
}
```

- [ ] **Step 4: Run the suite. All verifier tests pass.**

Run: `pnpm --filter @switchboard/api test src/payments/stripe-connect-payment-adapter.test.ts`
Expected: 8 tests pass.

- [ ] **Step 5: Sanity-check the adapter file size stays well under the 400-line warn gate (do not inline into the factory).**

Run: `wc -l apps/api/src/payments/stripe-connect-payment-adapter.ts`
Expected: A line count well under 400 (roughly 110-150 lines).

- [ ] **Step 6: Commit the verifier.**

Run: `git add apps/api/src/payments/stripe-connect-payment-adapter.ts apps/api/src/payments/stripe-connect-payment-adapter.test.ts && git commit -m "feat(api): standalone connect constructevent verifier for the webhook seam"`
Expected: One commit created.


#### Task 5: Task 5 — Fail-closed Connect credentials parser

**Files:**
- Create: `apps/api/src/payments/stripe-connect-credentials.ts`
- Create: `apps/api/src/payments/stripe-connect-credentials.test.ts`
- Test: `apps/api/src/payments/stripe-connect-credentials.test.ts`

- [ ] **Step 1: Write the FAILING parser test FIRST. parseStripeConnectCredentials takes the DECRYPTED credentials object and returns the three Connect fields ONLY when all are present non-empty strings, else null (fail-closed — never build a live-money adapter from partial creds). Cover the full-parse case (extra keys ignored) plus the missing/blank/non-string/empty matrix.**

```ts
import { describe, it, expect } from "vitest";
import { parseStripeConnectCredentials } from "./stripe-connect-credentials.js";

describe("parseStripeConnectCredentials", () => {
  it("parses full Connect credentials", () => {
    const parsed = parseStripeConnectCredentials({
      connectedAccountId: "acct_1",
      secretKey: "sk_live_x",
      webhookSecret: "whsec_x",
      extra: "ignored",
    });
    expect(parsed).toEqual({
      connectedAccountId: "acct_1",
      secretKey: "sk_live_x",
      webhookSecret: "whsec_x",
    });
  });

  it.each([
    ["missing connectedAccountId", { secretKey: "sk", webhookSecret: "wh" }],
    ["missing secretKey", { connectedAccountId: "acct", webhookSecret: "wh" }],
    ["missing webhookSecret", { connectedAccountId: "acct", secretKey: "sk" }],
    ["blank secretKey", { connectedAccountId: "acct", secretKey: "  ", webhookSecret: "wh" }],
    ["non-string secretKey", { connectedAccountId: "acct", secretKey: 123, webhookSecret: "wh" }],
    ["empty object", {}],
  ])("returns null when %s (fail-closed)", (_label, creds) => {
    expect(parseStripeConnectCredentials(creds as Record<string, unknown>)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the parser test. It MUST fail because the module does not exist.**

Run: `pnpm --filter @switchboard/api test src/payments/stripe-connect-credentials.test.ts`
Expected: Vitest fails to resolve import "./stripe-connect-credentials.js".

- [ ] **Step 3: Create the parser module. Pure, no deps. Returns null unless all three fields are non-empty strings.**

```ts
export interface StripeConnectCredentials {
  connectedAccountId: string;
  secretKey: string;
  webhookSecret: string;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Fail-closed parse of an org's decrypted `stripe` Connection credentials into
 * the three fields a live Connect deposit write needs. Returns null unless ALL
 * three are present non-empty strings, so the factory can only ever build a
 * live-money adapter from complete credentials (spec: never a partial / global
 * fallback for a live write).
 */
export function parseStripeConnectCredentials(
  decrypted: Record<string, unknown>,
): StripeConnectCredentials | null {
  const { connectedAccountId, secretKey, webhookSecret } = decrypted;
  if (
    nonEmptyString(connectedAccountId) &&
    nonEmptyString(secretKey) &&
    nonEmptyString(webhookSecret)
  ) {
    return { connectedAccountId, secretKey, webhookSecret };
  }
  return null;
}
```

- [ ] **Step 4: Run the parser test; all cases pass.**

Run: `pnpm --filter @switchboard/api test src/payments/stripe-connect-credentials.test.ts`
Expected: All parser tests pass (1 full-parse case + 6 fail-closed cases).

- [ ] **Step 5: Commit the parser.**

Run: `git add apps/api/src/payments/stripe-connect-credentials.ts apps/api/src/payments/stripe-connect-credentials.test.ts && git commit -m "feat(api): fail-closed parser for per-org stripe connect credentials"`
Expected: One commit created.


#### Task 6: Task 6 — Extend the per-org payment-port factory to return the Stripe adapter for a connected 'stripe' Connection

**Files:**
- Modify: `apps/api/src/bootstrap/payment-port-factory.ts`
- Modify: `apps/api/src/bootstrap/__tests__/payment-port-factory.test.ts`
- Test: `apps/api/src/bootstrap/__tests__/payment-port-factory.test.ts`

- [ ] **Step 1: Re-read the 1A-4a factory to learn its EXACT exported creator name, deps shape, and how it currently returns the Noop adapter — you will EXTEND it in place, not rewrite it. Also re-read the Noop guard export so the test can assert Noop vs Stripe. (The 1A-4a factory is expected to mirror calendar-provider-factory.ts: createPaymentPortFactory(deps) with prismaClient + logger, a per-org Map cache, an ORG_ID_REQUIRED reject, and a resolveForOrg(deps, orgId) returning new NoopPaymentAdapter(...). The Noop guard mirrors isNoopCalendarProvider — an instanceof check. If the real names differ, use the real ones in every step below.)**

Run: `sed -n '1,200p' apps/api/src/bootstrap/payment-port-factory.ts && echo '--- noop guard ---' && grep -n "isNoopPaymentAdapter\|export" apps/api/src/bootstrap/noop-payment-adapter.ts`
Expected: Shows the factory's exported creator (assumed createPaymentPortFactory(deps)), its deps object (prismaClient + logger), the per-org cache + ORG_ID_REQUIRED guard, and the branch returning new NoopPaymentAdapter(...). The guard file exports isNoopPaymentAdapter. (If any real name differs, substitute it everywhere below.)

- [ ] **Step 2: Add a FAILING 'Stripe Connect selection' describe block to the existing factory test file (keep the 1A-4a tests intact). Inject a fake Prisma (vi.fn connection.findFirst), a fake decrypt, and a fake stripeClientFactory, and assert: (a) a connected 'stripe' Connection with full creds yields a StripeConnectPaymentAdapter (NOT Noop); (b) no 'stripe' Connection yields Noop; (c) partial creds yield Noop (fail-closed); (d) the Connection query filters by organizationId; (e) the per-org secretKey built the client. NOTE the new injectable deps (decryptCredentials, stripeClientFactory) are added in Step 4. Mirrors the ads-client-factory.test.ts injection style (apps/api/src/lib/__tests__/ads-client-factory.test.ts:1-55: prisma stubbed via vi.fn, decryptCredentials injected, `as never` casts).**

```ts
import {
  StripeConnectPaymentAdapter,
} from "../../payments/stripe-connect-payment-adapter.js";
import { isNoopPaymentAdapter } from "../noop-payment-adapter.js";

function makePrismaWithConnection(
  connectionByOrg: Record<string, { id: string; credentials: unknown } | null>,
) {
  return {
    connection: {
      findFirst: vi.fn(
        async ({ where }: { where: { organizationId: string; serviceId: string } }) =>
          connectionByOrg[where.organizationId] ?? null,
      ),
    },
  };
}

const silentLogger = { info: () => {}, error: () => {} };

function fakeStripeClient() {
  return {
    checkout: { sessions: { create: () => {} } },
    paymentIntents: { retrieve: () => {} },
    webhooks: { constructEvent: () => {} },
  };
}

describe("createPaymentPortFactory: Stripe Connect selection", () => {
  it("returns a StripeConnectPaymentAdapter when a connected 'stripe' Connection with full creds exists", async () => {
    const prisma = makePrismaWithConnection({
      "org-stripe": { id: "conn_1", credentials: "enc" },
    });
    const decryptCredentials = vi.fn(() => ({
      connectedAccountId: "acct_1",
      secretKey: "sk_live_x",
      webhookSecret: "whsec_x",
    }));
    const stripeClientFactory = vi.fn(() => fakeStripeClient());
    const factory = createPaymentPortFactory({
      prismaClient: prisma as never,
      logger: silentLogger,
      decryptCredentials,
      stripeClientFactory: stripeClientFactory as never,
    });

    const port = await factory("org-stripe");

    expect(port).toBeInstanceOf(StripeConnectPaymentAdapter);
    expect(isNoopPaymentAdapter(port)).toBe(false);
    // Cross-org isolation: the Connection lookup is org-scoped.
    expect(prisma.connection.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org-stripe",
          serviceId: "stripe",
        }),
      }),
    );
    // The per-org secret built the client (never a global env secret).
    expect(stripeClientFactory).toHaveBeenCalledWith("sk_live_x");
  });

  it("returns the Noop adapter when the org has no 'stripe' Connection", async () => {
    const prisma = makePrismaWithConnection({ "org-none": null });
    const factory = createPaymentPortFactory({
      prismaClient: prisma as never,
      logger: silentLogger,
      decryptCredentials: vi.fn(),
      stripeClientFactory: vi.fn() as never,
    });

    expect(isNoopPaymentAdapter(await factory("org-none"))).toBe(true);
  });

  it("returns the Noop adapter when Connect creds are partial (fail-closed)", async () => {
    const prisma = makePrismaWithConnection({
      "org-partial": { id: "conn_2", credentials: "enc" },
    });
    const factory = createPaymentPortFactory({
      prismaClient: prisma as never,
      logger: silentLogger,
      // missing webhookSecret -> parser returns null -> Noop
      decryptCredentials: vi.fn(() => ({ connectedAccountId: "acct", secretKey: "sk" })),
      stripeClientFactory: vi.fn() as never,
    });

    expect(isNoopPaymentAdapter(await factory("org-partial"))).toBe(true);
  });
});
```

- [ ] **Step 3: Run the factory test. The new block MUST fail: the factory does not yet accept decryptCredentials/stripeClientFactory, does not query the Connection, and never returns a StripeConnectPaymentAdapter.**

Run: `pnpm --filter @switchboard/api test src/bootstrap/__tests__/payment-port-factory.test.ts`
Expected: Failures in the "Stripe Connect selection" block: the StripeConnectPaymentAdapter assertion fails (factory still returns Noop) and/or a type/arg error on the new deps; the existing 1A-4a factory tests still pass.

- [ ] **Step 4: Extend the factory in place (do NOT rewrite or touch the cache/ORG_ID_REQUIRED scaffolding). Apply three edits to apps/api/src/bootstrap/payment-port-factory.ts: (1) add the imports; (2) add the three optional fields to the existing deps interface; (3) inside the per-org resolve function (resolveForOrg), BEFORE the existing `return new NoopPaymentAdapter(...)`, insert the Stripe-first logic below. The decrypt adapter `((encrypted: unknown) => defaultDecryptCredentials(encrypted as string))` is copied verbatim from ads-client-factory.ts:30-31 (the Prisma credentials column is JsonValue but always stores the base64 string from encryptCredentials). The Connection query mirrors meta-spend-provider.ts:51-54 exactly with serviceId 'stripe'. `apiVersion: "2026-04-22.dahlia"` matches stripe-service.ts:13 so the typed client constructs cleanly. Adjust the NoopPaymentAdapter ctor call only if 1A-4a's signature differs.**

```ts
// 1) ADD these imports at the top of payment-port-factory.ts (alongside the existing imports):
import Stripe from "stripe";
import { decryptCredentials as defaultDecryptCredentials } from "@switchboard/db";
import {
  StripeConnectPaymentAdapter,
  type StripeConnectClient,
} from "../payments/stripe-connect-payment-adapter.js";
import { parseStripeConnectCredentials } from "../payments/stripe-connect-credentials.js";

// 2) EXTEND the existing PaymentPortFactoryDeps interface with these three OPTIONAL fields
//    (keep prismaClient / logger):
//      decryptCredentials?: (encrypted: unknown) => Record<string, unknown>;
//      stripeClientFactory?: (secretKey: string) => StripeConnectClient;

// 3) INSIDE resolveForOrg(deps, orgId), BEFORE the existing `return new NoopPaymentAdapter(...)`,
//    insert the Stripe-first logic below. `deps` is the factory deps; `orgId` is the resolving org.
const decrypt =
  deps.decryptCredentials ??
  ((encrypted: unknown) => defaultDecryptCredentials(encrypted as string));
const buildStripeClient =
  deps.stripeClientFactory ??
  ((secretKey: string): StripeConnectClient =>
    new Stripe(secretKey, { apiVersion: "2026-04-22.dahlia" }) as unknown as StripeConnectClient);

const connection = await deps.prismaClient.connection.findFirst({
  where: { organizationId: orgId, serviceId: "stripe", status: "connected" },
  select: { id: true, credentials: true },
});

if (connection) {
  const creds = parseStripeConnectCredentials(decrypt(connection.credentials));
  if (creds) {
    deps.logger.info(`Payment[${orgId}]: using StripeConnectPaymentAdapter (connected account)`);
    return new StripeConnectPaymentAdapter({
      client: buildStripeClient(creds.secretKey),
      connectedAccountId: creds.connectedAccountId,
    });
  }
  deps.logger.info(
    `Payment[${orgId}]: 'stripe' Connection present but Connect creds incomplete — using Noop (fail-closed)`,
  );
}

// Fall through to the existing Noop return (unchanged from 1A-4a).
```

- [ ] **Step 5: Run the factory test again. The Stripe-selection block passes and the 1A-4a tests still pass.**

Run: `pnpm --filter @switchboard/api test src/bootstrap/__tests__/payment-port-factory.test.ts`
Expected: All factory tests pass (1A-4a's original suite + the 3 new Stripe-selection tests).

- [ ] **Step 6: Commit the factory extension.**

Run: `git add apps/api/src/bootstrap/payment-port-factory.ts apps/api/src/bootstrap/__tests__/payment-port-factory.test.ts && git commit -m "feat(api): payment-port factory returns stripe connect adapter for stripe connection"`
Expected: One commit created.


#### Task 7: Task 7 — Whole-package verification (types, lint/prettier, full api suite, file-size + layering)

**Files:**
- Test: `apps/api/src/payments/stripe-connect-payment-adapter.test.ts`
- Test: `apps/api/src/payments/stripe-connect-credentials.test.ts`
- Test: `apps/api/src/bootstrap/__tests__/payment-port-factory.test.ts`

- [ ] **Step 1: Typecheck the api package — proves the narrow StripeConnectClient type, the Stripe v22 param/return types, and the PaymentPort `implements` all line up with no `any`. If it reports missing exports from @switchboard/schemas/db/core, run `pnpm reset` first (per CLAUDE.md) and re-run.**

Run: `pnpm --filter @switchboard/api typecheck`
Expected: No type errors.

- [ ] **Step 2: Lint the package and run the prettier check (CI lint runs prettier; local lint does not — catch double-quote/semi/100-width drift before push).**

Run: `pnpm --filter @switchboard/api lint && pnpm format:check`
Expected: No eslint errors; prettier reports all matched files already formatted.

- [ ] **Step 3: Run the FULL api test suite to confirm nothing else regressed (the new adapter/factory are injected-only, so no live Stripe call is made).**

Run: `pnpm --filter @switchboard/api test`
Expected: The full suite passes, including the three new test files (stripe-connect-payment-adapter, stripe-connect-credentials, payment-port-factory).

- [ ] **Step 4: Confirm no new/changed file breaches the 600-line error / 400-line warn gate (do not inline the adapter or parser into the factory).**

Run: `wc -l apps/api/src/payments/stripe-connect-payment-adapter.ts apps/api/src/payments/stripe-connect-credentials.ts apps/api/src/bootstrap/payment-port-factory.ts`
Expected: All three comfortably under 400 lines.

- [ ] **Step 5: Confirm layering: the only @switchboard import beyond apps-internal relatives is the PaymentPort types from @switchboard/schemas and decryptCredentials from @switchboard/db — and crucially NO @switchboard/core import was introduced (apps/api may import anything, but this PR must not reach into core, and ad-optimizer must never be touched).**

Run: `grep -rn "@switchboard/" apps/api/src/payments/ apps/api/src/bootstrap/payment-port-factory.ts`
Expected: Only `@switchboard/schemas` (PaymentPort + DepositLinkInput/DepositLink/VerifiedPayment types) and `@switchboard/db` (decryptCredentials in the factory). No `@switchboard/core`, no `@switchboard/ad-optimizer`.

- [ ] **Step 6: Final branch-context check before opening the PR (CLAUDE.md branch doctrine).**

Run: `git branch --show-current && git status --short && git log --oneline -7`
Expected: On the 1A-4d implementation branch (consuming the spec on main), a clean working tree, and the 6 task commits present. Open the PR against the integration base once 1A-4a/1A-4b/1A-4c have merged.


---

## 1A-5 — feat(core,db,api): anti-fake hardening — deterministic booked eventId, origin markers, external-timestamp windowing, demoted operator revenue, gateway wamid idempotency

**Goal:** Make the paid/booked number trustworthy by closing five verified anti-fake gaps in the prove leg, all behind strict TDD with mocked Prisma (CI has no Postgres). Concretely: (1) the booked OutboxEvent gets a deterministic eventId `evt_booked_${bookingId}` so a replayed confirm collides on the existing `OutboxEvent.eventId @unique` and yields one row; (2) add `origin String @default("live")` to Booking, ConversionRecord, LifecycleRevenueEvent (raw-SQL backfill of existing rows to 'live' in the same commit), default live writes to 'live' in the ConversionRecord store, filter `origin:'live'` in the booked metric (PrismaConversionRecordStore.queryBookedValueCentsByCampaign / queryBookedStatsByCampaign) and the by-campaign read (PrismaRevenueStore.sumByCampaign), and add a grep-guard test that fails if any seed file creates one of these three models without explicitly stamping `origin` (R4 — no seed factory does today, so the guard prevents future fixture leakage); (3) stamp the booked OutboxEvent `occurredAt` from the EXTERNAL event time (`input.slotStart` = Booking.startsAt) instead of the in-app wall clock, so the existing occurredAt window is an external-timestamp window (clock-game defense); (4) narrow `operator.record_revenue`'s `recordedBy` to `{owner,staff}` (drop stripe/integration) at operator-intents-schemas.ts and force `verified:false` in the operator handler so only the later PSP fetch-back path can mint verified=true (R1); (5) thread the provider message id (wamid) through IncomingChannelMessage and set `CanonicalSubmitRequest.idempotencyKey` from it so a replayed inbound dedups at PlatformIngress.submit (which already keys on idempotencyKey via the trace store). DEPENDS ON 1A-4b. Per R5 this PR does not touch read-surface attribution copy. The schemas-package `RecordedBySchema` (owner/staff/stripe/integration) and the store-level `recordedBy` unions stay wide because the PSP writer (a later PR) needs `stripe`; only the operator parameter schema narrows.

**File structure:**

| Action | Path | Responsibility |
|---|---|---|
| modify | `packages/db/prisma/schema.prisma` | Add `origin String @default("live")` to model Booking (after workTraceId, line ~1998), model ConversionRecord (after bookingId, line ~2045), and model LifecycleRevenueEvent (after sourceAdId, line ~1844). Columns only; the backfill of existing rows lives in the raw-SQL migration in the same commit. |
| create | `packages/db/prisma/migrations/20260606090000_revenue_origin_marker/migration.sql` | Raw-SQL migration (same commit as schema.prisma): ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'live' to Booking, ConversionRecord, LifecycleRevenueEvent, then UPDATE each table SET origin='live' WHERE origin IS NULL to backfill pre-existing rows explicitly (defense-in-depth; the DEFAULT already covers new+existing on Postgres, the UPDATE documents intent and is a no-op if empty). Mirrors the ADD COLUMN format of 20260604200000_recommendation_outcome_enrichment. |
| modify | `packages/db/src/stores/prisma-conversion-record-store.ts` | (a) Add optional `origin?: "live"|"seed"|"demo"` to RecordInput (line ~31) and write `origin: event.origin ?? "live"` in the create branch of record() (line ~55) so live writers are stamped without threading origin through every caller. (b) Add `origin: "live"` to the WHERE of queryBookedValueCentsByCampaign (line ~232) and queryBookedStatsByCampaign (line ~269) so seed/demo booked rows are excluded from the trustworthy metric. |
| modify | `packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts` | Add tests: record() defaults origin to 'live' when omitted and passes through an explicit 'seed'; queryBookedValueCentsByCampaign and queryBookedStatsByCampaign include `origin:"live"` in the groupBy WHERE (fixture-leakage exclusion). Extend the existing makePrisma mock unchanged (groupBy/upsert already present). |
| create | `packages/db/src/seed/__tests__/seed-origin-stamp.guard.test.ts` | Grep-guard (R4): statically scan every seed file under packages/db/prisma/seed*.ts and packages/db/src/seed/*.ts; for each that contains a `.booking.`/`.conversionRecord.`/`.lifecycleRevenueEvent.` create/upsert/createMany call, assert the same file also contains an `origin:` literal. Today no seed creates these models so the guard passes vacuously; it red-flags the first future seed factory that forgets origin. |
| modify | `packages/core/src/skill-runtime/tools/calendar-book.ts` | Replace `const eventId = randomUUID();` (line 342) with `const eventId = \`evt_booked_${booking.id}\`;` and drop the now-unused `randomUUID` import (line 1). Change the booked outbox payload `occurredAt` (line 367) from `new Date().toISOString()` to `new Date(input.slotStart).toISOString()` so the conversion record windows on the external booking start, not the in-app write clock. |
| modify | `packages/core/src/skill-runtime/tools/calendar-book.test.ts` | Add to the existing 'booking.create conversion stamping' describe (uses buildToolWithCapture which already captures the outbox payload): assert the booked outbox eventId is deterministic (`evt_booked_bk_1`, not random) by capturing args.data.eventId, and assert payload.occurredAt equals the external input.slotStart (clock-game: not the wall clock). File already has /* eslint-disable max-lines */ and is excluded from arch-check (test file). |
| modify | `apps/api/src/routes/operator-intents-schemas.ts` | Narrow RecordRevenueParametersSchema.recordedBy (line 89) from z.enum(["owner","staff","stripe","integration"]) to z.enum(["owner","staff"]).default("owner") so an operator can never self-assert a stripe/integration (verified-looking) source. The wide schemas-package RecordedBySchema and store unions are untouched (PSP path needs stripe). |
| modify | `apps/api/src/bootstrap/operator-intents/revenue.ts` | Pass `verified: false` explicitly to revenueStore.record (in the input object around line 39-50) so only the PSP fetch-back path (later PR) can set verified=true; an accidental future edit can't silently flip operator-recorded revenue to verified. Also stamp the outbox `occurredAt` honestly (leave as write-time — operator path has no external charge time; verified:false already excludes it from the trustworthy count). |
| modify | `apps/api/src/bootstrap/operator-intents/__tests__/revenue.test.ts` | Add a test asserting revenueStore.record is called with `verified: false` (objectContaining) for an owner-recorded payment; and a schema test asserting RecordRevenueParametersSchema rejects recordedBy:'stripe' / 'integration' (safeParse success=false) while accepting owner/staff. |
| modify | `packages/db/src/stores/prisma-revenue-store.ts` | Add `origin: "live"` to the WHERE of sumByCampaign (line ~150) so seed/demo LifecycleRevenueEvent rows are excluded from the owner-facing by-campaign read surface. (sumByOrg and revenueWithFirstTouch left for their own slice; the prove-leg read surface is by-campaign.) |
| modify | `packages/db/src/stores/__tests__/prisma-revenue-store.test.ts` | Add a test asserting sumByCampaign's groupBy WHERE includes `origin:"live"` (mock groupBy, inspect mock.calls[0][0].where.origin). Mirror the existing makePrisma mock in this file (add lifecycleRevenueEvent.groupBy if not already mocked). |
| modify | `packages/core/src/channel-gateway/types.ts` | Add optional `providerMessageId?: string` to IncomingChannelMessage (after `text`, line ~205) with a doc comment: stable provider message id (WhatsApp wamid, Telegram message_id). When present, the gateway derives the ingress idempotencyKey from it so a redelivered webhook dedups at PlatformIngress.submit. |
| modify | `packages/core/src/channel-gateway/channel-gateway.ts` | In handleIncoming's CanonicalSubmitRequest build (lines 311-332), set `idempotencyKey` from the provider message id when present: `...(message.providerMessageId ? { idempotencyKey: \`${resolved.organizationId}:${message.channel}:${message.providerMessageId}\` } : {})`. The org+channel prefix keeps the key org-scoped (PlatformIngress.getByIdempotencyKey is org-scoped at line 120-123). No other behavior changes. |
| modify | `packages/core/src/channel-gateway/__tests__/channel-gateway.test.ts` | Add tests: (a) when message.providerMessageId is set, platformIngress.submit receives a request whose idempotencyKey is `org-1:web_widget:<wamid>`; (b) two handleIncoming calls with the SAME providerMessageId both pass the SAME idempotencyKey to submit (gateway-level same-wamid dedup proof — submit's trace-store dedup is unit-tested in platform-ingress); (c) when providerMessageId is absent, the submitted request has no idempotencyKey (backward compat). Reuse createMockConfig (submit is already a spy). |
| modify | `apps/chat/src/routes/managed-webhook.ts` | Thread the wamid into the gateway: pass `providerMessageId: rawMessageId ?? undefined` into the handleIncoming message object (the message object built at lines 173-181; rawMessageId is already extracted at line 158 via gatewayEntry.adapter.extractMessageId). This wires the real producer so the idempotency key is populated in production. |

**Notes:** Verified facts (file:line) underpinning this plan, in /Users/jasonli/switchboard/.claude/worktrees/close-the-revenue-loop:

KEY PATH CORRECTIONS vs the PR brief's stated paths:
- calendar-book.ts is at packages/core/src/skill-runtime/tools/calendar-book.ts (NOT packages/core/src/skills/). randomUUID() is at line 342; booked occurredAt at line 367; the import is at line 1. Its co-located test is calendar-book.test.ts (same dir), already has /* eslint-disable max-lines */ at line 1 and is 755 lines — fine because arch-check counts only non-test source files (arch-check.ts:111,117) and eslint max-lines is disabled there.

SEED FINDING (load-bearing for R4): NO seed file currently creates Booking, ConversionRecord, or LifecycleRevenueEvent — confirmed by grep across packages/db/prisma/seed*.ts and packages/db/src/seed/*.ts (empty result). Seed factories actually live in packages/db/prisma/ (seed.ts 653 lines, seed-dev-data.ts 328 lines, seed-marketplace.ts), NOT packages/db/src/seed/ (that dir holds governance/deployment seeders). Therefore R4 is implemented as a grep-GUARD test that bites the first future seed factory writing one of these models without origin — there is no existing factory to stamp. The plan proves the guard bites with a throwaway fixture, then removes it.

IDEMPOTENCY: CanonicalSubmitRequest already has optional idempotencyKey (canonical-request.ts:27); PlatformIngress.submit already dedups on it via traceStore.getByIdempotencyKey, org-scoped (platform-ingress.ts:119-123). So the gateway change is purely to SET the key — no ingress change needed. IncomingChannelMessage (channel-gateway/types.ts:194-207) has NO providerMessageId field — added. The wamid is already extracted in the managed webhook as rawMessageId via gatewayEntry.adapter.extractMessageId(request.body) (managed-webhook.ts:158); the WhatsApp adapter surfaces it as messageId = s["id"] (whatsapp.ts:348). The same-wamid-twice test asserts the gateway emits an IDENTICAL key both times (the actual row-dedup is PlatformIngress's job, unit-tested there) — this is the honest, mock-Prisma-friendly assertion at the gateway layer.

RECORDEDBY NARROWING SCOPE: only operator-intents-schemas.ts:89 (RecordRevenueParametersSchema) narrows to {owner,staff}. The schemas-package RecordedBySchema (packages/schemas/src/lifecycle.ts:66) and the store-level unions (packages/db/src/stores/prisma-revenue-store.ts:17, packages/core/src/lifecycle/revenue-store.ts:18) stay wide because the later PSP writer needs 'stripe'. No external caller passes recordedBy:'stripe'/'integration' on the operator path (grep clean), so the narrowing is safe. Core's RecordRevenueInput.verified?:boolean (revenue-store.ts:20) makes the handler's `verified:false` typecheck.

WINDOWING / CLOCK-GAME: occurredAt is the only time column on ConversionRecord and is currently set to the in-app wall clock at calendar-book.ts:367 (and operator revenue.ts:63). The fix makes occurredAt honest for the booked path by stamping it from input.slotStart (= Booking.startsAt, the external event time), so the existing occurredAt window (queryBookedValueCentsByCampaign at prisma-conversion-record-store.ts:236) becomes an external-timestamp window. No new external-timestamp column is added (out of this PR's scope and unnecessary for the deterministic test). The operator path keeps write-time occurredAt but is verified:false so it is excluded from the trustworthy metric anyway.

ORIGIN PLACEMENT: schema.prisma models at Booking line 1982 (col after workTraceId line 1998), ConversionRecord line 2034 (col after bookingId line 2045), LifecycleRevenueEvent line 1829 (col after sourceAdId line 1844). Migration mirrors the ADD COLUMN format of 20260604200000_recommendation_outcome_enrichment (NOT the partial-unique precedent — these are plain non-null defaulted columns, no partial index needed for this PR; the LifecycleRevenueEvent partial-unique on externalReference is a SEPARATE concern owned by PR 1A-4, per spec §7). The metric filters: queryBookedValueCentsByCampaign + queryBookedStatsByCampaign (booked, for Riley) AND PrismaRevenueStore.sumByCampaign (the by-campaign owner read surface). ConversionRecordStore.record (prisma-conversion-record-store.ts:49) defaults origin to 'live' so production writers are stamped without threading origin through every conversion-bus caller (reconciliation-runner, audit-runner, inngest-functions, roi.ts, dashboard-overview.ts all inherit the default).

OUT OF SCOPE for this PR (owned elsewhere per spec §7/§10): LifecycleRevenueEvent.bookingId + partial-unique on externalReference (1A-2/1A-4), ConversionRecord.externalRef @unique (1A-4), the Receipt model (1A-3), the by-campaign verified=true filter + bookingId join (1A-6). This PR adds the by-campaign origin='live' filter (its own anti-fake concern) but does not add the verified=true join.

TEST INVOCATION: `pnpm --filter @switchboard/<pkg> test -- <file> -t "<name>"`; package names are @switchboard/core, @switchboard/db, @switchboard/api, @switchboard/chat. db tests mock Prisma (CI has no Postgres) — mirror the makePrisma() pattern in prisma-conversion-record-store.test.ts:4-12. Run `pnpm db:generate` after the schema edit so stores/tests see the `origin` field; `pnpm reset` if typecheck reports stale lower-layer exports.

#### Task 1: Task 1 — Deterministic booked eventId + external-timestamp occurredAt (calendar-book)

**Files:**
- Modify: `packages/core/src/skill-runtime/tools/calendar-book.ts`
- Modify: `packages/core/src/skill-runtime/tools/calendar-book.test.ts`
- Test: `packages/core/src/skill-runtime/tools/calendar-book.test.ts`

- [ ] **Step 1: Add a failing test for the deterministic booked eventId inside the existing 'booking.create conversion stamping' describe block. buildToolWithCapture (calendar-book.test.ts:540) currently captures only the payload; extend its outboxEvent.create mock to also capture eventId, then assert it equals evt_booked_<bookingId>. Add this `eventId` field to the `captured` object and the capture closure, and add a new `it`. Place the new it right after the existing 'stamps attribution, value, currency on the booked event' test (ends line 611).**

```ts
// In buildToolWithCapture (around line 544), widen the captured shape:
//   const captured: { payload?: Record<string, unknown>; eventId?: unknown } = {};
// and in the outboxEvent.create mock body (around line 549), capture eventId too:
//   create: vi.fn(async (args: { data: { eventId: unknown; payload: Record<string, unknown> } }) => {
//     captured.eventId = args.data.eventId;
//     captured.payload = args.data.payload;
//     return { id: "ob_1" };
//   }),

it("uses a deterministic booked eventId (evt_booked_<bookingId>), never a random UUID", async () => {
  const { tool: t, captured } = buildToolWithCapture({
    contact: { id: "ct_1", name: "Jane", email: "jane@example.com", phone: "+6591234567", attribution: null },
    opportunity: { id: "opp_1", estimatedValue: 1000 },
  });
  await t.operations["booking.create"]!.execute({
    service: "botox",
    slotStart: "2026-06-01T10:00:00Z",
    slotEnd: "2026-06-01T10:30:00Z",
    calendarId: "primary",
  });
  // bookingStore.create in buildToolWithCapture resolves { id: "bk_1" }
  expect(captured.eventId).toBe("evt_booked_bk_1");
});
```

- [ ] **Step 2: Run the new test and watch it FAIL — the current code uses randomUUID() so eventId will be a random uuid, not the deterministic string.**

Run: `pnpm --filter @switchboard/core test -- calendar-book.test.ts -t "deterministic booked eventId"`
Expected: FAIL: expected captured.eventId to be "evt_booked_bk_1" but received a random UUID string (e.g. a 36-char uuid).

- [ ] **Step 3: Make it pass: in calendar-book.ts replace the random eventId at line 342 with the deterministic one, and remove the now-unused randomUUID import at line 1.**

```ts
// calendar-book.ts line 1 — delete this import line entirely:
// import { randomUUID } from "node:crypto";

// calendar-book.ts line 342 — replace:
//   const eventId = randomUUID();
// with:
const eventId = `evt_booked_${booking.id}`;
```

- [ ] **Step 4: Run the deterministic-eventId test again — it should PASS now.**

Run: `pnpm --filter @switchboard/core test -- calendar-book.test.ts -t "deterministic booked eventId"`
Expected: PASS (1 test). No 'randomUUID is not defined' error (import removed and no other usage in the file).

- [ ] **Step 5: Add a failing clock-game test: assert the booked outbox payload.occurredAt is the EXTERNAL booking start (input.slotStart), not the in-app wall clock. Add it directly after the deterministic-eventId test.**

```ts
it("stamps booked occurredAt from the external slotStart, not the in-app write clock (clock-game defense)", async () => {
  const { tool: t, captured } = buildToolWithCapture({
    contact: { id: "ct_1", name: "Jane", email: "jane@example.com", phone: "+6591234567", attribution: null },
    opportunity: { id: "opp_1", estimatedValue: 1000 },
  });
  const slotStart = "2026-06-01T10:00:00.000Z";
  await t.operations["booking.create"]!.execute({
    service: "botox",
    slotStart,
    slotEnd: "2026-06-01T10:30:00Z",
    calendarId: "primary",
  });
  expect(captured.payload?.occurredAt).toBe(slotStart);
});
```

- [ ] **Step 6: Run it and watch it FAIL — code currently sets occurredAt to new Date().toISOString() (the wall clock), which will not equal the slotStart.**

Run: `pnpm --filter @switchboard/core test -- calendar-book.test.ts -t "clock-game defense"`
Expected: FAIL: expected captured.payload.occurredAt to be "2026-06-01T10:00:00.000Z" but received the current wall-clock ISO timestamp.

- [ ] **Step 7: Make it pass: in calendar-book.ts change the booked payload occurredAt at line 367 to derive from the external slot start.**

```ts
// calendar-book.ts line 367 — replace:
//   occurredAt: new Date().toISOString(),
// with:
occurredAt: new Date(input.slotStart).toISOString(),
```

- [ ] **Step 8: Run the clock-game test again — PASS.**

Run: `pnpm --filter @switchboard/core test -- calendar-book.test.ts -t "clock-game defense"`
Expected: PASS (1 test).

- [ ] **Step 9: Run the whole calendar-book suite to confirm no regression (the existing 'stamps attribution...' test still passes with the widened capture closure).**

Run: `pnpm --filter @switchboard/core test -- calendar-book.test.ts`
Expected: PASS (all tests in the file green, including the two new ones).

- [ ] **Step 10: Commit.**

Run: `git add packages/core/src/skill-runtime/tools/calendar-book.ts packages/core/src/skill-runtime/tools/calendar-book.test.ts && git commit -m "fix(core): deterministic booked eventId and external-timestamp occurredAt"`
Expected: Commit succeeds; commitlint accepts the lowercase subject.


#### Task 2: Task 2 — origin column on Booking/ConversionRecord/LifecycleRevenueEvent (schema + raw-SQL migration, same commit)

**Files:**
- Create: `packages/db/prisma/migrations/20260606090000_revenue_origin_marker/migration.sql`
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add the `origin` column to all three Prisma models. Edit schema.prisma: in model LifecycleRevenueEvent add the column after sourceAdId (line 1844); in model Booking add it after workTraceId (line 1998); in model ConversionRecord add it after bookingId (line 2045).**

```ts
// model LifecycleRevenueEvent — after `sourceAdId String?` (line 1844), add:
  origin            String      @default("live")

// model Booking — after `workTraceId     String?` (line 1998), add:
  origin          String    @default("live")

// model ConversionRecord — after `bookingId         String?` (line 2045), add:
  origin            String   @default("live")
```

- [ ] **Step 2: Create the raw-SQL migration in the SAME commit (CLAUDE.md: schema change + migration together; no prisma migrate dev TTY — hand-write the SQL, mirror the ADD COLUMN format of 20260604200000_recommendation_outcome_enrichment). Create the file at packages/db/prisma/migrations/20260606090000_revenue_origin_marker/migration.sql.**

```ts
-- Anti-fake hardening (Spec-1A-5): mark every revenue-bearing row with its
-- provenance so the trustworthy metric can read only 'live'. Seed/demo factories
-- stamp 'seed'/'demo' explicitly; the DEFAULT covers production writers that do
-- not pass origin. The UPDATE backfills any pre-existing rows to 'live' (a no-op
-- when the table is empty; the DEFAULT already applies to existing rows on add).
ALTER TABLE "Booking" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'live';
UPDATE "Booking" SET "origin" = 'live' WHERE "origin" IS NULL;

ALTER TABLE "ConversionRecord" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'live';
UPDATE "ConversionRecord" SET "origin" = 'live' WHERE "origin" IS NULL;

ALTER TABLE "LifecycleRevenueEvent" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'live';
UPDATE "LifecycleRevenueEvent" SET "origin" = 'live' WHERE "origin" IS NULL;
```

- [ ] **Step 3: Regenerate the Prisma client so the new `origin` field is visible to the stores and their tests (otherwise typecheck reports unknown field — see CLAUDE.md reset guidance).**

Run: `pnpm db:generate`
Expected: Prisma Client generated successfully; the generated types now include `origin` on Booking, ConversionRecord, LifecycleRevenueEvent.

- [ ] **Step 4: Confirm the schema and migration agree and the schema is valid (no running Postgres needed for validate).**

Run: `pnpm --filter @switchboard/db exec prisma validate`
Expected: "The schema at prisma/schema.prisma is valid."

- [ ] **Step 5: Commit schema + migration together (one commit, per CLAUDE.md).**

Run: `git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260606090000_revenue_origin_marker/migration.sql && git commit -m "feat(db): add origin marker to booking, conversion-record, revenue-event"`
Expected: Commit succeeds with schema change and its migration in the same commit.


#### Task 3: Task 3 — Stamp origin in the ConversionRecord write path + filter origin='live' in the booked metric

**Files:**
- Modify: `packages/db/src/stores/prisma-conversion-record-store.ts`
- Modify: `packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts`
- Test: `packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts`

- [ ] **Step 1: Add a failing test: record() must default origin to 'live' when omitted, and pass through an explicit 'seed'. Add to the existing PrismaConversionRecordStore describe (the makePrisma mock at line 4 already mocks conversionRecord.upsert).**

```ts
it("defaults origin to 'live' on create when omitted", async () => {
  const upsertMock = prisma.conversionRecord.upsert as ReturnType<typeof vi.fn>;
  upsertMock.mockResolvedValue({ id: "cr_o1" });
  await store.record({
    eventId: "evt-o1", organizationId: "org-1", contactId: "ct-1", type: "booked",
    value: 100, occurredAt: new Date("2026-05-14T10:00:00Z"), source: "calendar-book", metadata: {},
  });
  expect(upsertMock.mock.calls[0]![0].create.origin).toBe("live");
});

it("passes an explicit origin through to create (seed/demo provenance)", async () => {
  const upsertMock = prisma.conversionRecord.upsert as ReturnType<typeof vi.fn>;
  upsertMock.mockResolvedValue({ id: "cr_o2" });
  await store.record({
    eventId: "evt-o2", organizationId: "org-1", contactId: "ct-1", type: "booked",
    value: 100, occurredAt: new Date("2026-05-14T10:00:00Z"), source: "seed", metadata: {},
    origin: "seed",
  });
  expect(upsertMock.mock.calls[0]![0].create.origin).toBe("seed");
});
```

- [ ] **Step 2: Run and watch FAIL — record() does not yet set origin, and RecordInput has no origin field (TS error or undefined value).**

Run: `pnpm --filter @switchboard/db test -- prisma-conversion-record-store.test.ts -t "origin"`
Expected: FAIL: create.origin is undefined (and/or a TS error that 'origin' is not assignable to RecordInput for the explicit-seed test).

- [ ] **Step 3: Make it pass: add optional origin to RecordInput and write it in the create branch of record().**

```ts
// prisma-conversion-record-store.ts — in interface RecordInput (after `metadata` field, ~line 43) add:
  origin?: "live" | "seed" | "demo";

// in record()'s upsert create object, after `occurredAt: event.occurredAt,` (line 67) add:
        origin: event.origin ?? "live",
```

- [ ] **Step 4: Run the origin write tests — PASS.**

Run: `pnpm --filter @switchboard/db test -- prisma-conversion-record-store.test.ts -t "origin"`
Expected: PASS (2 tests).

- [ ] **Step 5: Add a failing test that the booked metric excludes non-live rows: queryBookedValueCentsByCampaign and queryBookedStatsByCampaign must include origin:'live' in the groupBy WHERE. Add to the existing queryBookedValueCentsByCampaign and queryBookedStatsByCampaign describes.**

```ts
// inside describe("queryBookedValueCentsByCampaign"):
it("filters to origin 'live' so seed/demo booked rows are excluded", async () => {
  const groupBy = prisma.conversionRecord.groupBy as ReturnType<typeof vi.fn>;
  groupBy.mockResolvedValue([]);
  await store.queryBookedValueCentsByCampaign({ orgId: "org_1", ...window });
  expect(groupBy.mock.calls[0]![0].where.origin).toBe("live");
});

// inside describe("queryBookedStatsByCampaign"):
it("filters to origin 'live'", async () => {
  const groupBy = prisma.conversionRecord.groupBy as ReturnType<typeof vi.fn>;
  groupBy.mockResolvedValue([]);
  await store.queryBookedStatsByCampaign({ orgId: "org_1", ...window });
  expect(groupBy.mock.calls[0]![0].where.origin).toBe("live");
});
```

- [ ] **Step 6: Run and watch FAIL — the WHERE has no origin yet.**

Run: `pnpm --filter @switchboard/db test -- prisma-conversion-record-store.test.ts -t "origin 'live'"`
Expected: FAIL: where.origin is undefined in both queries.

- [ ] **Step 7: Make it pass: add `origin: "live"` to the WHERE of both queries. In queryBookedValueCentsByCampaign add it after `type: "booked",` (line ~234); in queryBookedStatsByCampaign add it after `type: "booked",` (line ~271).**

```ts
// queryBookedValueCentsByCampaign where (after `type: "booked",`):
        origin: "live",

// queryBookedStatsByCampaign where (after `type: "booked",`):
        origin: "live",
```

- [ ] **Step 8: Note: the queryBookedStatsByCampaign test at line 216 asserts an EXACT toHaveBeenCalledWith on the full where object — adding origin will break it. Update that existing assertion's where to include `origin: "live"` so the exact-match test reflects the new filter.**

```ts
// In the existing 'aggregates sum AND count...' test (line 216), the expected where object
// gains origin. Change:
//   where: { organizationId: "org_1", type: "booked", value: { gt: 0 }, occurredAt: {...}, sourceCampaignId: { in: ["camp_1"] } },
// to include origin right after type:
        where: {
          organizationId: "org_1",
          type: "booked",
          origin: "live",
          value: { gt: 0 },
          occurredAt: { gte: window.from, lte: window.to },
          sourceCampaignId: { in: ["camp_1"] },
        },
```

- [ ] **Step 9: Run the whole conversion-record-store suite — all green (origin write, origin filter, and the updated exact-match test).**

Run: `pnpm --filter @switchboard/db test -- prisma-conversion-record-store.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 10: Commit.**

Run: `git add packages/db/src/stores/prisma-conversion-record-store.ts packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts && git commit -m "feat(db): stamp and filter origin in conversion-record booked metric"`
Expected: Commit succeeds.


#### Task 4: Task 4 — Filter origin='live' in the by-campaign read surface (revenue store)

**Files:**
- Modify: `packages/db/src/stores/prisma-revenue-store.ts`
- Modify: `packages/db/src/stores/__tests__/prisma-revenue-store.test.ts`
- Test: `packages/db/src/stores/__tests__/prisma-revenue-store.test.ts`

- [ ] **Step 1: Open the existing revenue-store test to see its makePrisma mock shape, then add a failing test asserting sumByCampaign's groupBy WHERE includes origin:'live'. If the mock does not already expose lifecycleRevenueEvent.groupBy, add it to makePrisma.**

```ts
// New test (place inside the top-level describe("PrismaRevenueStore")):
it("sumByCampaign filters to origin 'live' (excludes seed/demo revenue from the owner read)", async () => {
  const groupBy = prisma.lifecycleRevenueEvent.groupBy as ReturnType<typeof vi.fn>;
  groupBy.mockResolvedValue([]);
  await store.sumByCampaign("org-1");
  expect(groupBy.mock.calls[0]![0].where.origin).toBe("live");
});

// If makePrisma lacks groupBy on lifecycleRevenueEvent, add inside its lifecycleRevenueEvent block:
//   groupBy: vi.fn(),
```

- [ ] **Step 2: Run and watch FAIL — sumByCampaign's WHERE has no origin.**

Run: `pnpm --filter @switchboard/db test -- prisma-revenue-store.test.ts -t "origin 'live'"`
Expected: FAIL: where.origin is undefined.

- [ ] **Step 3: Make it pass: add `origin: "live"` to the where object in sumByCampaign (after the sourceCampaignId not-null clause, around line 153-156).**

```ts
// prisma-revenue-store.ts sumByCampaign where (line ~150) — add origin:
    const where: Record<string, unknown> = {
      organizationId: orgId,
      status: "confirmed",
      origin: "live",
      sourceCampaignId: {
        not: null,
      },
    };
```

- [ ] **Step 4: Run it — PASS. Then run the full revenue-store suite to confirm no other assertion (e.g. an exact-match on sumByCampaign where) regressed; if one did, add origin:'live' to that expected where too.**

Run: `pnpm --filter @switchboard/db test -- prisma-revenue-store.test.ts`
Expected: PASS (all tests). If a pre-existing exact-match where assertion fails, update it to include origin:"live" and re-run to green.

- [ ] **Step 5: Commit.**

Run: `git add packages/db/src/stores/prisma-revenue-store.ts packages/db/src/stores/__tests__/prisma-revenue-store.test.ts && git commit -m "feat(db): filter origin live in by-campaign revenue read"`
Expected: Commit succeeds.


#### Task 5: Task 5 — Seed origin grep-guard (R4: catch a future seed factory that forgets origin)

**Files:**
- Create: `packages/db/src/seed/__tests__/seed-origin-stamp.guard.test.ts`
- Test: `packages/db/src/seed/__tests__/seed-origin-stamp.guard.test.ts`

- [ ] **Step 1: Write the grep-guard test. It scans every seed file; for any that creates one of the three revenue-bearing models, it requires an `origin:` literal in the same file. Today this passes vacuously (no seed creates these models — verified); it fails the day a seed factory writes one of these rows without origin. Use node:fs and the repo-relative seed dirs. The test file lives in packages/db, so paths resolve from packages/db/src/seed/__tests__/ up to packages/db/prisma and packages/db/src/seed.**

```ts
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/db/src/seed/__tests__ -> packages/db
const DB_ROOT = join(__dirname, "..", "..", "..");

function seedFiles(): string[] {
  const out: string[] = [];
  const prismaDir = join(DB_ROOT, "prisma");
  if (existsSync(prismaDir)) {
    for (const f of readdirSync(prismaDir)) {
      if (f.startsWith("seed") && f.endsWith(".ts") && !f.endsWith(".d.ts")) out.push(join(prismaDir, f));
    }
  }
  const seedDir = join(DB_ROOT, "src", "seed");
  if (existsSync(seedDir)) {
    for (const f of readdirSync(seedDir)) {
      if (f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts")) out.push(join(seedDir, f));
    }
  }
  return out;
}

// A seed file that writes one of these models must stamp origin explicitly (R4).
const MODEL_WRITE = /\.(booking|conversionRecord|lifecycleRevenueEvent)\.(create|createMany|upsert)\b/;

describe("seed origin stamping guard (R4)", () => {
  it("every seed file that creates booking/conversionRecord/lifecycleRevenueEvent stamps origin explicitly", () => {
    const offenders: string[] = [];
    for (const path of seedFiles()) {
      const src = readFileSync(path, "utf8");
      if (MODEL_WRITE.test(src) && !/origin\s*:/.test(src)) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });

  it("actually discovered seed files to scan (guard is not silently empty)", () => {
    expect(seedFiles().length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the guard. Both tests PASS immediately: no seed file currently creates these models (so the first test passes vacuously), and there ARE seed files to scan (second test).**

Run: `pnpm --filter @switchboard/db test -- seed-origin-stamp.guard.test.ts`
Expected: PASS (2 tests). offenders is [] and seedFiles().length > 0.

- [ ] **Step 3: Sanity-prove the guard actually bites (temporary, do NOT commit this): create a throwaway seed fixture that writes a booking without origin, re-run, confirm the first test FAILS, then delete it.**

Run: `printf 'export const x = async (p: any) => { await p.booking.create({ data: { id: "x" } }); };\n' > packages/db/prisma/seed-temp-guardcheck.ts && pnpm --filter @switchboard/db test -- seed-origin-stamp.guard.test.ts; rm packages/db/prisma/seed-temp-guardcheck.ts`
Expected: FAIL while the temp file exists (offenders contains seed-temp-guardcheck.ts); the file is removed by the same command so the tree is clean afterward. Re-running the guard now PASSES.

- [ ] **Step 4: Commit the guard.**

Run: `git add packages/db/src/seed/__tests__/seed-origin-stamp.guard.test.ts && git commit -m "test(db): guard that seed factories stamp origin explicitly"`
Expected: Commit succeeds; git status shows no stray seed-temp-guardcheck.ts.


#### Task 6: Task 6 — Demote operator.record_revenue (narrow recordedBy + force verified=false)

**Files:**
- Modify: `apps/api/src/routes/operator-intents-schemas.ts`
- Modify: `apps/api/src/bootstrap/operator-intents/revenue.ts`
- Modify: `apps/api/src/bootstrap/operator-intents/__tests__/revenue.test.ts`
- Test: `apps/api/src/bootstrap/operator-intents/__tests__/revenue.test.ts`

- [ ] **Step 1: Add a failing schema test: RecordRevenueParametersSchema must reject recordedBy:'stripe' and 'integration' and accept 'owner'/'staff'. Add it to revenue.test.ts (import the schema at top).**

```ts
// add to the imports at the top of revenue.test.ts:
import { RecordRevenueParametersSchema } from "../../../routes/operator-intents-schemas.js";

// add a new describe block:
describe("RecordRevenueParametersSchema recordedBy narrowing", () => {
  it("rejects stripe and integration (operator cannot self-assert a verified-looking source)", () => {
    expect(RecordRevenueParametersSchema.safeParse({ contactId: "c1", amount: 100, recordedBy: "stripe" }).success).toBe(false);
    expect(RecordRevenueParametersSchema.safeParse({ contactId: "c1", amount: 100, recordedBy: "integration" }).success).toBe(false);
  });
  it("accepts owner and staff", () => {
    expect(RecordRevenueParametersSchema.safeParse({ contactId: "c1", amount: 100, recordedBy: "owner" }).success).toBe(true);
    expect(RecordRevenueParametersSchema.safeParse({ contactId: "c1", amount: 100, recordedBy: "staff" }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run and watch FAIL — the schema currently accepts stripe/integration.**

Run: `pnpm --filter @switchboard/api test -- revenue.test.ts -t "recordedBy narrowing"`
Expected: FAIL: safeParse({...recordedBy:"stripe"}).success is true (expected false).

- [ ] **Step 3: Make it pass: narrow the enum at operator-intents-schemas.ts line 89.**

```ts
// operator-intents-schemas.ts line 89 — replace:
//   recordedBy: z.enum(["owner", "staff", "stripe", "integration"]).default("owner"),
// with:
  recordedBy: z.enum(["owner", "staff"]).default("owner"),
```

- [ ] **Step 4: Run the schema test — PASS.**

Run: `pnpm --filter @switchboard/api test -- revenue.test.ts -t "recordedBy narrowing"`
Expected: PASS (2 tests).

- [ ] **Step 5: Add a failing test that the handler forces verified:false into revenueStore.record. Add it inside the existing describe("buildRecordRevenueHandler").**

```ts
it("forces verified:false — only the PSP fetch-back path may set verified=true", async () => {
  const revenueStore = { record: vi.fn().mockResolvedValue({ id: "rev_1", amount: 100, currency: "SGD" }) };
  const outboxWriter = { write: vi.fn().mockResolvedValue(undefined) };
  const handler = buildRecordRevenueHandler(revenueStore as never, outboxWriter, sentinelRunner);
  await handler.execute({
    organizationId: "org_a", actor: { id: "u1", type: "user" },
    parameters: { contactId: "c1", amount: 100, currency: "SGD", type: "payment", recordedBy: "owner" },
  } as never);
  expect(revenueStore.record).toHaveBeenCalledWith(
    expect.objectContaining({ verified: false }),
    SENTINEL_TX,
  );
});
```

- [ ] **Step 6: Run and watch FAIL — the handler does not pass verified at all today, so objectContaining({verified:false}) does not match (the property is absent).**

Run: `pnpm --filter @switchboard/api test -- revenue.test.ts -t "forces verified:false"`
Expected: FAIL: record was called without a verified property.

- [ ] **Step 7: Make it pass: in revenue.ts add `verified: false` to the input object passed to revenueStore.record (the object spanning lines 39-50, e.g. right after `recordedBy: params.recordedBy,`).**

```ts
// revenue.ts — inside the revenueStore.record({ ... }) input object, add:
            recordedBy: params.recordedBy,
            verified: false,
            externalReference: params.externalReference ?? null,
```

- [ ] **Step 8: Run the verified test — PASS. Then run the whole revenue.test.ts suite (the existing 'records revenue...' tests use recordedBy:'owner'/'staff' which remain valid).**

Run: `pnpm --filter @switchboard/api test -- revenue.test.ts`
Expected: PASS (all tests including the new schema + verified tests; existing tests unaffected).

- [ ] **Step 9: Typecheck the api package to confirm the narrowed enum did not break any other consumer of RecordRevenueParameters (none found in the codebase, but verify).**

Run: `pnpm --filter @switchboard/api typecheck`
Expected: No type errors. (If it reports missing exports from @switchboard/db/core, run `pnpm reset` first per CLAUDE.md, then re-run.)

- [ ] **Step 10: Commit.**

Run: `git add apps/api/src/routes/operator-intents-schemas.ts apps/api/src/bootstrap/operator-intents/revenue.ts apps/api/src/bootstrap/operator-intents/__tests__/revenue.test.ts && git commit -m "feat(api): demote operator record_revenue to verified false and narrow recordedBy"`
Expected: Commit succeeds.


#### Task 7: Task 7 — Gateway idempotency key from provider message id (wamid), deduped at PlatformIngress.submit

**Files:**
- Modify: `packages/core/src/channel-gateway/types.ts`
- Modify: `packages/core/src/channel-gateway/channel-gateway.ts`
- Modify: `packages/core/src/channel-gateway/__tests__/channel-gateway.test.ts`
- Modify: `apps/chat/src/routes/managed-webhook.ts`
- Test: `packages/core/src/channel-gateway/__tests__/channel-gateway.test.ts`

- [ ] **Step 1: Add a failing test: when message.providerMessageId is set, platformIngress.submit receives a request whose idempotencyKey is org+channel+wamid. Use the existing createMockConfig (submit is a spy). Add it inside describe("ChannelGateway").**

```ts
it("derives the ingress idempotencyKey from the provider message id (wamid)", async () => {
  const submitSpy = vi.fn().mockResolvedValue({
    ok: true,
    result: { outcome: "completed", outputs: { response: "hi" }, summary: "s", traceId: "t1" },
    workUnit: { id: "wu-1", traceId: "t1" },
  });
  const config = createMockConfig({ platformIngress: { submit: submitSpy } });
  const gateway = new ChannelGateway(config);
  const message: IncomingChannelMessage = {
    channel: "web_widget", token: "sw_valid123", sessionId: "sess-1", text: "Hello",
    providerMessageId: "wamid.ABC",
  };
  await gateway.handleIncoming(message, { send: vi.fn() });
  expect(submitSpy).toHaveBeenCalledWith(
    expect.objectContaining({ idempotencyKey: "org-1:web_widget:wamid.ABC" }),
  );
});

it("sends the SAME idempotencyKey when the same wamid is delivered twice (gateway dedup proof)", async () => {
  const submitSpy = vi.fn().mockResolvedValue({
    ok: true,
    result: { outcome: "completed", outputs: { response: "hi" }, summary: "s", traceId: "t1" },
    workUnit: { id: "wu-1", traceId: "t1" },
  });
  const config = createMockConfig({ platformIngress: { submit: submitSpy } });
  const gateway = new ChannelGateway(config);
  const message: IncomingChannelMessage = {
    channel: "web_widget", token: "sw_valid123", sessionId: "sess-1", text: "Hello",
    providerMessageId: "wamid.DUP",
  };
  await gateway.handleIncoming(message, { send: vi.fn() });
  await gateway.handleIncoming(message, { send: vi.fn() });
  const keys = submitSpy.mock.calls.map((c) => (c[0] as { idempotencyKey?: string }).idempotencyKey);
  expect(keys).toEqual(["org-1:web_widget:wamid.DUP", "org-1:web_widget:wamid.DUP"]);
});

it("omits idempotencyKey when no provider message id is supplied (backward compat)", async () => {
  const submitSpy = vi.fn().mockResolvedValue({
    ok: true,
    result: { outcome: "completed", outputs: { response: "hi" }, summary: "s", traceId: "t1" },
    workUnit: { id: "wu-1", traceId: "t1" },
  });
  const config = createMockConfig({ platformIngress: { submit: submitSpy } });
  const gateway = new ChannelGateway(config);
  await gateway.handleIncoming(
    { channel: "web_widget", token: "sw_valid123", sessionId: "sess-1", text: "Hello" },
    { send: vi.fn() },
  );
  expect((submitSpy.mock.calls[0]![0] as { idempotencyKey?: string }).idempotencyKey).toBeUndefined();
});
```

- [ ] **Step 2: Run and watch FAIL — providerMessageId is not yet on the type (TS error) and the gateway never sets idempotencyKey.**

Run: `pnpm --filter @switchboard/core test -- channel-gateway.test.ts -t "idempotencyKey"`
Expected: FAIL: either a TS error that providerMessageId is not a property of IncomingChannelMessage, or the submitted request has no idempotencyKey.

- [ ] **Step 3: Add the field to the type. Edit channel-gateway/types.ts IncomingChannelMessage (after `text: string;`, line ~205).**

```ts
// types.ts IncomingChannelMessage — after `text: string;` add:
  /**
   * Stable provider message id (WhatsApp wamid, Telegram message_id). When the
   * adapter supplies it, the gateway derives the ingress idempotencyKey from it
   * so a redelivered webhook dedups at PlatformIngress.submit (org-scoped trace
   * lookup). Omit when the provider gives no stable id.
   */
  providerMessageId?: string;
```

- [ ] **Step 4: Set the key in the request build. Edit channel-gateway.ts: in the CanonicalSubmitRequest object (lines 311-332), add the conditional idempotencyKey just before `parentWorkUnitId`/`targetHint` (e.g. right after the closing of `parameters` or alongside the other top-level fields).**

```ts
// channel-gateway.ts — inside the `const request: CanonicalSubmitRequest = { ... }` literal,
// add as a top-level field (e.g. directly after `surface: { surface: "chat", sessionId: message.sessionId },`):
      ...(message.providerMessageId
        ? { idempotencyKey: `${resolved.organizationId}:${message.channel}:${message.providerMessageId}` }
        : {}),
```

- [ ] **Step 5: Run the gateway idempotency tests — PASS.**

Run: `pnpm --filter @switchboard/core test -- channel-gateway.test.ts -t "idempotencyKey"`
Expected: PASS (3 tests: derives key, same-wamid-twice same key, omitted when absent).

- [ ] **Step 6: Run the full channel-gateway suite to confirm no regression in the existing flow tests.**

Run: `pnpm --filter @switchboard/core test -- channel-gateway.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 7: Wire the real producer: pass the wamid into the gateway from the managed webhook. Edit apps/chat/src/routes/managed-webhook.ts — rawMessageId is already extracted at line 158; add it to the handleIncoming message object (the object at lines 173-181), after `text: incoming.text,`.**

```ts
// managed-webhook.ts — in the handleIncoming({ ... }) message object, after `text: incoming.text,` add:
          providerMessageId: rawMessageId ?? undefined,
```

- [ ] **Step 8: Typecheck the chat app to confirm the new field threads cleanly (rawMessageId is `string | null` from extractMessageId; `?? undefined` matches the optional `string`).**

Run: `pnpm --filter @switchboard/chat typecheck`
Expected: No type errors. (If it reports stale @switchboard/core exports, run `pnpm reset` then re-run.)

- [ ] **Step 9: Commit.**

Run: `git add packages/core/src/channel-gateway/types.ts packages/core/src/channel-gateway/channel-gateway.ts packages/core/src/channel-gateway/__tests__/channel-gateway.test.ts apps/chat/src/routes/managed-webhook.ts && git commit -m "feat(core,chat): derive ingress idempotency key from provider message id"`
Expected: Commit succeeds.


#### Task 8: Task 8 — Full-suite verification + arch/lint gates before PR

**Files:**
- Test: `packages/core`
- Test: `packages/db`
- Test: `apps/api`
- Test: `apps/chat`

- [ ] **Step 1: Run the affected package test suites in full to confirm nothing regressed across the five changes.**

Run: `pnpm --filter @switchboard/core test && pnpm --filter @switchboard/db test && pnpm --filter @switchboard/api test`
Expected: All three suites PASS. (db tests run against mocked Prisma — no Postgres needed.)

- [ ] **Step 2: Typecheck the whole repo. If it reports missing exports from @switchboard/schemas/db/core or unknown Prisma fields like `origin`, run `pnpm reset` first (clears dist + regenerates Prisma + rebuilds schemas→core→db), then re-run typecheck.**

Run: `pnpm typecheck`
Expected: No type errors repo-wide. The new `origin` field is recognized on all three models; the narrowed operator enum has no broken consumers.

- [ ] **Step 3: Run the architecture check — confirms no source file crossed 600 lines from these edits (calendar-book.ts gained 0 net lines; the test file is excluded from the source line count). ad-optimizer must still not import core (untouched here).**

Run: `pnpm arch:check`
Expected: No 🔴 ERROR lines. calendar-book.ts unchanged in size category; no new >600-line source file.

- [ ] **Step 4: Run lint + prettier format-check (CI runs prettier; local lint does not — run it explicitly per the dev gotcha) on the whole repo.**

Run: `pnpm lint && pnpm format:check`
Expected: Lint passes; prettier reports no formatting diffs. (If format:check flags a file, run `pnpm format` on it, `git add`, and amend the relevant commit.)

- [ ] **Step 5: Final branch-context check before opening the PR (CLAUDE.md: verify branch matches the work).**

Run: `git branch --show-current && git status --short && git log --oneline -7`
Expected: On the 1A-5 implementation branch; working tree clean; the seven feature commits from tasks 1-7 present in order.


---

## 1A-6 — feat(db,api,dashboard): owner read surface — paid visits by ad (per-visit, verified-only)

**Goal:** Give the owner a read-only surface that lists each individually verified PAID visit attributed to the ad campaign that produced it — "Paid S$X visit linked to campaign Y via CTWA attribution" — decoupled from Riley. (a) A new store query `paidVisitsByCampaign` returns ONE row per verified PAID `LifecycleRevenueEvent` (amount in cents), joined to `ConversionRecord` via `bookingId` to recover `sourceCampaignId`; per R1 it EXCLUDES degraded/Noop payments (provider='noop' or non-T1 receipt) when `origin='live'` in production, so a Noop payment can never appear as a real paid visit in prod; per R5 each row carries an honest `attributionBasis` (ctwa_captured | campaign_missing | copied_from_contact). (b) Extend `GET /:orgId/revenue/by-campaign` with `?detail=paid-visits` to return the per-visit rows, converting cents→major units EXACTLY ONCE (50000c → S$500.00, never 100x). (c) One dashboard panel reusing the reports campaigns-section styling + a dashboard→api proxy route + an api-client method, rendering each paid visit with honest attribution copy (never "proven came from campaign Y"). This is individual receipts, NOT aggregate ROAS. DEPENDS ON 1A-4b (verified Stripe `PaymentReceipt`/`LifecycleRevenueEvent.bookingId`/`origin`/`provider`) and 1A-2 (`ConversionRecord.bookingId` populated on the booked event).

**File structure:**

| Action | Path | Responsibility |
|---|---|---|
| modify | `/Users/jasonli/switchboard/packages/schemas/src/reports/v1.ts` | Add the L1 shared types: `AttributionBasis` union (ctwa_captured | campaign_missing | copied_from_contact) and the `PaidVisitRow` interface (bookingId, amountMajor:number, currency, campaignId:string|null, campaignName:string|null, attributionBasis, paidAt:string). Auto-exported via the existing barrel re-export. |
| modify | `/Users/jasonli/switchboard/packages/db/src/stores/prisma-revenue-store.ts` | Add `paidVisitsByCampaign({orgId, from, to, isProduction})` returning one row per verified PAID LifecycleRevenueEvent in CENTS (amountCents:number), joined to ConversionRecord via bookingId for sourceCampaignId + derived attributionBasis; excludes provider='noop'/non-T1 receipts and requires origin='live' when isProduction. Returns raw cents — performs NO cents→major division. |
| modify | `/Users/jasonli/switchboard/packages/db/src/stores/__tests__/prisma-revenue-store.test.ts` | Add a `paidVisitsByCampaign` describe block (mocked Prisma): one row per paid visit, verified=true only, Noop/origin!=live excluded in production but kept when not production, org-isolated WHERE on both findMany calls, honest attributionBasis (ctwa_captured vs campaign_missing), and that the store returns raw cents (no division). |
| modify | `/Users/jasonli/switchboard/apps/api/src/routes/revenue.ts` | Extend GET /:orgId/revenue/by-campaign: when `?detail=paid-visits`, call store.paidVisitsByCampaign(...) and return `{ paidVisits: PaidVisitRow[] }`, converting amountCents→amountMajor (÷100) EXACTLY ONCE in the mapper; default (no detail) behavior unchanged. Passes isProduction = process.env.NODE_ENV === 'production'. |
| modify | `/Users/jasonli/switchboard/apps/api/src/routes/__tests__/revenue.test.ts` | Add the cents→major unit-boundary mapper test (50000 cents → amountMajor 500, asserting the exact ÷100 conversion done once and never 100x) plus an attributionBasis pass-through assertion for the route's row mapper. |
| create | `/Users/jasonli/switchboard/apps/dashboard/src/lib/api-client/dashboard.ts.paid-visits-method` | (Logical change inside dashboard.ts) Add `getPaidVisitsByCampaign(orgId, params:{from:string; to:string}): Promise<{paidVisits: PaidVisitRow[]}>` calling `this.request('/api/${orgId}/revenue/by-campaign?detail=paid-visits&from=..&to=..')`. NOTE: this is a modify of api-client/dashboard.ts, not a new file. |
| create | `/Users/jasonli/switchboard/apps/dashboard/src/app/api/dashboard/revenue/paid-visits/route.ts` | Dashboard→API proxy GET: requireSession → getApiClient → client.getPaidVisitsByCampaign(session.organizationId, {from,to from searchParams}) → NextResponse.json; proxyError(401 on Unauthorized else 500). Read-only. |
| create | `/Users/jasonli/switchboard/apps/dashboard/src/app/api/dashboard/revenue/paid-visits/__tests__/route.test.ts` | Proxy test (vi.mock session + getApiClient): 401 when unauthenticated, 200 happy path forwarding rows, and that orgId comes from session not the query string. |
| create | `/Users/jasonli/switchboard/apps/dashboard/src/components/results/paid-visits-section.tsx` | Read-only panel: renders each PaidVisitRow as 'Paid S$X visit linked to campaign Y via CTWA attribution' (fmtSGD withCents:always) for ctwa_captured, and 'Paid S$X visit — campaign not captured' for campaign_missing; calm empty-state; NEVER 'proven came from', NEVER blank-as-attributed. |
| create | `/Users/jasonli/switchboard/apps/dashboard/src/components/results/paid-visits-section.test.tsx` | Component test: one line per paid visit, honest copy ('linked to campaign … via CTWA attribution', never 'proven'), campaign_missing renders the honest fallback (not blank/0), money shows S$ + cents (no bare $), empty-state renders. |

**Notes:** VERIFIED FACTS (cited file:line):
- `LifecycleRevenueEvent` model: packages/db/prisma/schema.prisma:1829-1851 — has `amount Int`, `verified Boolean`, `sourceCampaignId String?`, `recordedAt`, `externalReference`. The dependency PRs 1A-4/1A-5 add `bookingId String?` and `origin String @default("live")` to THIS model and 1A-3 adds the `Receipt` model (kind/tier/provider/status/bookingId) — THIS PR adds NO Prisma schema (it consumes those columns). If `pnpm typecheck`/Prisma errors about missing `bookingId`/`origin`/`receipt`, the dependency PRs are not merged yet — STOP and rebase onto them; run `pnpm reset` first (CLAUDE.md).
- `ConversionRecord` model: schema.prisma:2034-2054 — has `bookingId String?` (col exists; 1A-2 populates it) + `sourceCampaignId String?` + `@@index([bookingId])`. This is the join source for campaign attribution.
- Store to extend: packages/db/src/stores/prisma-revenue-store.ts:185-261 (`revenueByCampaign`, `revenueWithFirstTouch` — mirror its two-findMany + Map join shape at :208-260).
- Store test pattern (MOCK Prisma, no Postgres): packages/db/src/stores/__tests__/prisma-revenue-store.test.ts:6-46 (`makeMockPrisma`/`makeRevenueEvent`/`beforeEach`).
- Route to extend: apps/api/src/routes/revenue.ts:114-125 (GET /:orgId/revenue/by-campaign). File is `// @route-class: operator-direct` (revenue.ts:1) — read GETs in this file are already classified; NO new route-allowlist entry needed (the GET does not enter ingress).
- Route uses `requireOrganizationScope(request, reply)` (revenue.ts:84,119) — auth org is authoritative.
- Dashboard panel to reuse: apps/dashboard/src/components/results/campaigns-section.tsx (table/card markup + `fmtSGD`).
- `fmtSGD`: apps/dashboard/src/app/(auth)/(mercury)/reports/components/format.ts:13 — `fmtSGD(500,{withCents:"always"})` → "S$500.00"; `fmtSGD(500)` (auto, integer<1000) → "S$500" (no cents). Use `{withCents:"always"}` so the per-visit money always shows cents.
- Proxy mirror: apps/dashboard/src/app/api/dashboard/.../overview/route.ts (requireSession → getApiClient → client method → NextResponse.json; proxyError fallback 401 on "Unauthorized" else 500). `session.organizationId` supplies orgId (apps/dashboard/src/lib/session.ts:11).
- Client method mirror: apps/dashboard/src/lib/api-client/dashboard.ts:61-87 (`getRoiSummary`/`recordRevenue` — `this.request('/api/${orgId}/...')`). SwitchboardClient composes through to SwitchboardDashboardClient (api-client/index.ts).
- Schema type home: packages/schemas/src/reports/v1.ts (CampaignRow at :65); barrel auto-exports via `export * from "./reports/v1.js"` (packages/schemas/src/index.ts:163).
- Proxy test mirror: apps/dashboard/src/app/api/dashboard/operator-chat/__tests__/route.test.ts:1-50 (vi.mock session + getApiClient; assert 401 + happy path).
- Component test mirror: apps/dashboard/src/components/results/campaigns-section.test.tsx (render + container.textContent assertions; the `not.toMatch(/(?<!S)\$/)` bare-$ guard).
- API route handler test: per the prompt scope I add store + route-handler-shape tests; full Fastify inject harness exists at apps/api/src/__tests__/test-server.ts (buildTestServer) but the existing by-campaign route has NO inject test, so I test the new branch via a focused handler/shape test mirroring revenue.test.ts:1-54 (Zod/shape) — keeps the PR self-contained without standing up the full server.

DESIGN DECISIONS:
- Cents→major conversion happens EXACTLY ONCE, in the API route mapper (`amountCents/100 → amountMajor`). The store returns `amountCents` (raw Int). The dashboard renders `amountMajor` with `fmtSGD(..,{withCents:"always"})`. Hard unit-boundary test: 50000 → 500.00 (route test) and the store never divides (store test asserts it returns the raw cents int).
- R1 (Noop never counts in prod): `paidVisitsByCampaign` takes an explicit `isProduction: boolean` (caller passes `process.env.NODE_ENV === "production"`, mirroring db/src/seed/seed-mira-demo-creatives.ts:19). When `isProduction` is true the query requires `origin: "live"` AND excludes degraded payments (provider !== "noop" AND the joined payment Receipt tier === "T1_FETCH_BACK"); when false (dev/test/seed demos) it returns all verified rows for local exercise. Test asserts a Noop/origin!=live row is dropped in prod and a real T1 live row survives.
- R5 (honest attribution): `attributionBasis` is derived in the store join — `ctwa_captured` when the matched ConversionRecord has a non-null `sourceCampaignId`; `campaign_missing` when the booking has no ConversionRecord campaign; (`copied_from_contact` is reserved in the union for the later contact-fallback path and is part of the type but not emitted by this query). The panel renders "Paid S$X visit linked to campaign Y via CTWA attribution" for ctwa_captured and "Paid S$X visit — campaign not captured" for campaign_missing; NEVER "proven came from campaign Y", NEVER blank-as-attributed, NEVER 0.
- Additive route param: default GET /:orgId/revenue/by-campaign behavior (returns `{campaigns}` aggregate) is UNCHANGED; only `?detail=paid-visits` returns `{paidVisits}` — zero blast radius on existing consumers.
- File sizes: prisma-revenue-store.ts is 262 lines; adding ~55 lines → ~317 (under 400 warn). revenue.ts is 126 lines; adding ~25 → ~151. No extraction needed; nothing touches platform-ingress.ts/skill-executor.ts/calendar-book.ts.

ORG ISOLATION: every query in `paidVisitsByCampaign` includes `organizationId` in the WHERE (both the LifecycleRevenueEvent findMany and the ConversionRecord findMany), mirroring revenueWithFirstTouch (:209,:226). These are READS (findMany) so the updateMany+count===0 rule does not apply (that rule is for mutations); there are no mutations in this PR.

CITES: schema.prisma:1829-1851 (LifecycleRevenueEvent), schema.prisma:2034-2054 (ConversionRecord), prisma-revenue-store.ts:185-261, revenue.ts:1,114-125, format.ts:13-37, reports/v1.ts:65, schemas/index.ts:163, dashboard.ts:61-87, operator-chat route.test.ts:1-50.

#### Task 1: Task 1 — L1 shared types: AttributionBasis + PaidVisitRow (schemas)

**Files:**
- Modify: `/Users/jasonli/switchboard/packages/schemas/src/reports/v1.ts`
- Test: `/Users/jasonli/switchboard/packages/schemas/src/__tests__/reports-v1.test.ts`

- [ ] **Step 1: Add a failing test asserting the new types are exported and shaped. Open packages/schemas/src/__tests__/reports-v1.test.ts and append a describe block that imports PaidVisitRow + AttributionBasis from the package entry and constructs a valid object (TypeScript compile-time + a runtime field check). This fails first because the symbols do not exist yet.**

```ts
// append to packages/schemas/src/__tests__/reports-v1.test.ts
import type { PaidVisitRow, AttributionBasis } from "../index.js";

describe("PaidVisitRow (1A-6)", () => {
  it("accepts a ctwa_captured paid visit row in major units", () => {
    const basis: AttributionBasis = "ctwa_captured";
    const row: PaidVisitRow = {
      bookingId: "bk-1",
      amountMajor: 500,
      currency: "SGD",
      campaignId: "camp-1",
      campaignName: "camp-1",
      attributionBasis: basis,
      paidAt: "2026-06-01T00:00:00.000Z",
    };
    expect(row.amountMajor).toBe(500);
    expect(row.attributionBasis).toBe("ctwa_captured");
  });

  it("allows campaign_missing with null campaign fields", () => {
    const row: PaidVisitRow = {
      bookingId: "bk-2",
      amountMajor: 120.5,
      currency: "SGD",
      campaignId: null,
      campaignName: null,
      attributionBasis: "campaign_missing",
      paidAt: "2026-06-02T00:00:00.000Z",
    };
    expect(row.campaignId).toBeNull();
    expect(row.attributionBasis).toBe("campaign_missing");
  });
});
```

- [ ] **Step 2: Run the schemas test — expect a FAIL (module has no exported member 'PaidVisitRow'/'AttributionBasis').**

Run: `pnpm --filter @switchboard/schemas test -- reports-v1`
Expected: FAIL — TS / runtime error: '"../index.js"' has no exported member 'PaidVisitRow' (and 'AttributionBasis').

- [ ] **Step 3: Add the real types to packages/schemas/src/reports/v1.ts. Insert immediately AFTER the CampaignRow interface (the interface that starts at line 65). The barrel (packages/schemas/src/index.ts:163 `export * from "./reports/v1.js"`) auto-exports them.**

```ts
// packages/schemas/src/reports/v1.ts — add after the CampaignRow interface

/**
 * How a paid visit was tied to its campaign (1A-6, honest labeling per spec §11).
 * - ctwa_captured: the booking's ConversionRecord carried a non-null sourceCampaignId
 *   (the click-to-WhatsApp attribution survived the unified Contact).
 * - campaign_missing: no campaign was captured for this booking — render honestly,
 *   never as attributed.
 * - copied_from_contact: reserved for the later contact-fallback path (not emitted
 *   by the 1A-6 read query; cryptographic ClickEvidence is a later spec).
 */
export type AttributionBasis = "ctwa_captured" | "campaign_missing" | "copied_from_contact";

/**
 * One individually-verified PAID visit attributed to the ad that produced it.
 * `amountMajor` is in MAJOR currency units (dollars) — the API converts the
 * stored cents EXACTLY ONCE. This is a per-receipt row, never an aggregate.
 */
export interface PaidVisitRow {
  bookingId: string;
  amountMajor: number;
  currency: string;
  campaignId: string | null;
  campaignName: string | null;
  attributionBasis: AttributionBasis;
  paidAt: string;
}
```

- [ ] **Step 4: Re-run the schemas test — expect PASS.**

Run: `pnpm --filter @switchboard/schemas test -- reports-v1`
Expected: PASS — both new PaidVisitRow specs green; existing reports-v1 tests still pass.

- [ ] **Step 5: Typecheck the schemas package to confirm no type errors.**

Run: `pnpm --filter @switchboard/schemas typecheck`
Expected: PASS — no TypeScript errors.

- [ ] **Step 6: Commit.**

Run: `git add packages/schemas/src/reports/v1.ts packages/schemas/src/__tests__/reports-v1.test.ts && git commit -m "feat(schemas): paid-visit row + attribution-basis types for the by-ad read surface"`
Expected: Commit created on the implementation branch (lowercase conventional subject).


#### Task 2: Task 2 — Store query: paidVisitsByCampaign (verified-only, cents, Noop-excluded in prod, org-isolated)

**Files:**
- Modify: `/Users/jasonli/switchboard/packages/db/src/stores/prisma-revenue-store.ts`
- Test: `/Users/jasonli/switchboard/packages/db/src/stores/__tests__/prisma-revenue-store.test.ts`

- [ ] **Step 1: First run pnpm reset so the generated Prisma client reflects the dependency PRs' columns (LifecycleRevenueEvent.bookingId/origin, the Receipt model). If reset reports drift or the client lacks `bookingId`/`origin`/`receipt`, the dependency PRs (1A-2/1A-3/1A-4) are NOT merged into this branch — STOP and rebase onto them before continuing (this PR adds no schema of its own).**

Run: `pnpm reset`
Expected: PASS — Prisma client regenerated; `prisma.lifecycleRevenueEvent` exposes `bookingId`/`origin` and `prisma.receipt` exists. If not, rebase onto 1A-2/1A-4 first.

- [ ] **Step 2: Add failing store tests. Open packages/db/src/stores/__tests__/prisma-revenue-store.test.ts. Extend makeMockPrisma to also mock `conversionRecord.findMany` and `receipt.findMany`, then add a `paidVisitsByCampaign` describe block. The tests assert: (1) one row per verified PAID LifecycleRevenueEvent; (2) the LifecycleRevenueEvent findMany WHERE includes organizationId + verified:true; (3) in production a row with provider='noop' (its receipt tier !== T1) or origin!='live' is dropped while a real T1 live row survives; (4) when not production all verified rows are kept; (5) attributionBasis is ctwa_captured when the joined ConversionRecord has a campaign, campaign_missing otherwise; (6) the store returns raw CENTS (amountCents equals the stored Int, NOT divided). These fail because the method does not exist.**

```ts
// packages/db/src/stores/__tests__/prisma-revenue-store.test.ts
// 1) extend makeMockPrisma() — add these two models alongside lifecycleRevenueEvent:
//      conversionRecord: { findMany: vi.fn().mockResolvedValue([]) },
//      receipt: { findMany: vi.fn().mockResolvedValue([]) },
//
// 2) append this describe block:

const FROM = new Date("2026-06-01T00:00:00Z");
const TO = new Date("2026-06-30T23:59:59Z");

function paidEvent(overrides: Record<string, unknown> = {}) {
  return makeRevenueEvent({
    type: "deposit",
    status: "confirmed",
    verified: true,
    amount: 50000, // cents
    bookingId: "bk-1",
    origin: "live",
    ...overrides,
  });
}

describe("paidVisitsByCampaign", () => {
  it("returns one row per verified paid visit, scoped to organizationId + verified:true", async () => {
    prisma.lifecycleRevenueEvent.findMany.mockResolvedValue([
      paidEvent({ id: "r1", bookingId: "bk-1" }),
      paidEvent({ id: "r2", bookingId: "bk-2", amount: 12000 }),
    ]);
    prisma.conversionRecord.findMany.mockResolvedValue([
      { bookingId: "bk-1", sourceCampaignId: "camp-1" },
      { bookingId: "bk-2", sourceCampaignId: "camp-2" },
    ]);
    prisma.receipt.findMany.mockResolvedValue([
      { bookingId: "bk-1", provider: "stripe", tier: "T1_FETCH_BACK" },
      { bookingId: "bk-2", provider: "stripe", tier: "T1_FETCH_BACK" },
    ]);

    const rows = await store.paidVisitsByCampaign({
      orgId: "org-1",
      from: FROM,
      to: TO,
      isProduction: true,
    });

    expect(rows).toHaveLength(2);
    const where = prisma.lifecycleRevenueEvent.findMany.mock.calls[0]![0].where;
    expect(where.organizationId).toBe("org-1");
    expect(where.verified).toBe(true);
  });

  it("returns CENTS (no division): a 50000-cent event yields amountCents 50000", async () => {
    prisma.lifecycleRevenueEvent.findMany.mockResolvedValue([paidEvent({ id: "r1", amount: 50000 })]);
    prisma.conversionRecord.findMany.mockResolvedValue([{ bookingId: "bk-1", sourceCampaignId: "camp-1" }]);
    prisma.receipt.findMany.mockResolvedValue([{ bookingId: "bk-1", provider: "stripe", tier: "T1_FETCH_BACK" }]);

    const rows = await store.paidVisitsByCampaign({ orgId: "org-1", from: FROM, to: TO, isProduction: true });
    expect(rows[0]!.amountCents).toBe(50000);
  });

  it("in production, EXCLUDES a Noop payment and a non-live row; keeps the real T1 live row", async () => {
    prisma.lifecycleRevenueEvent.findMany.mockResolvedValue([
      paidEvent({ id: "good", bookingId: "bk-good", origin: "live" }),
      paidEvent({ id: "noop", bookingId: "bk-noop", origin: "live" }),
      paidEvent({ id: "seed", bookingId: "bk-seed", origin: "seed" }),
    ]);
    prisma.conversionRecord.findMany.mockResolvedValue([
      { bookingId: "bk-good", sourceCampaignId: "camp-1" },
      { bookingId: "bk-noop", sourceCampaignId: "camp-1" },
      { bookingId: "bk-seed", sourceCampaignId: "camp-1" },
    ]);
    prisma.receipt.findMany.mockResolvedValue([
      { bookingId: "bk-good", provider: "stripe", tier: "T1_FETCH_BACK" },
      { bookingId: "bk-noop", provider: "noop", tier: "T3_ADMIN_AUDIT" },
      { bookingId: "bk-seed", provider: "stripe", tier: "T1_FETCH_BACK" },
    ]);

    const rows = await store.paidVisitsByCampaign({ orgId: "org-1", from: FROM, to: TO, isProduction: true });
    // origin filter is applied IN the prisma WHERE in prod:
    const where = prisma.lifecycleRevenueEvent.findMany.mock.calls[0]![0].where;
    expect(where.origin).toBe("live");
    // and the noop-provider row is dropped post-join:
    expect(rows.map((r) => r.bookingId)).toEqual(["bk-good"]);
  });

  it("outside production, keeps verified rows regardless of provider/origin (local exercise)", async () => {
    prisma.lifecycleRevenueEvent.findMany.mockResolvedValue([paidEvent({ id: "noop", bookingId: "bk-noop", origin: "demo" })]);
    prisma.conversionRecord.findMany.mockResolvedValue([{ bookingId: "bk-noop", sourceCampaignId: "camp-1" }]);
    prisma.receipt.findMany.mockResolvedValue([{ bookingId: "bk-noop", provider: "noop", tier: "T3_ADMIN_AUDIT" }]);

    const rows = await store.paidVisitsByCampaign({ orgId: "org-1", from: FROM, to: TO, isProduction: false });
    const where = prisma.lifecycleRevenueEvent.findMany.mock.calls[0]![0].where;
    expect(where.origin).toBeUndefined(); // no origin filter outside prod
    expect(rows).toHaveLength(1);
  });

  it("derives attributionBasis: ctwa_captured with a campaign, campaign_missing without", async () => {
    prisma.lifecycleRevenueEvent.findMany.mockResolvedValue([
      paidEvent({ id: "r1", bookingId: "bk-1" }),
      paidEvent({ id: "r2", bookingId: "bk-2" }),
    ]);
    prisma.conversionRecord.findMany.mockResolvedValue([
      { bookingId: "bk-1", sourceCampaignId: "camp-1" },
      { bookingId: "bk-2", sourceCampaignId: null },
    ]);
    prisma.receipt.findMany.mockResolvedValue([
      { bookingId: "bk-1", provider: "stripe", tier: "T1_FETCH_BACK" },
      { bookingId: "bk-2", provider: "stripe", tier: "T1_FETCH_BACK" },
    ]);

    const rows = await store.paidVisitsByCampaign({ orgId: "org-1", from: FROM, to: TO, isProduction: true });
    const byBooking = Object.fromEntries(rows.map((r) => [r.bookingId, r]));
    expect(byBooking["bk-1"]!.attributionBasis).toBe("ctwa_captured");
    expect(byBooking["bk-1"]!.sourceCampaignId).toBe("camp-1");
    expect(byBooking["bk-2"]!.attributionBasis).toBe("campaign_missing");
    expect(byBooking["bk-2"]!.sourceCampaignId).toBeNull();
  });

  it("scopes the ConversionRecord join by organizationId too", async () => {
    prisma.lifecycleRevenueEvent.findMany.mockResolvedValue([paidEvent({ id: "r1", bookingId: "bk-1" })]);
    prisma.conversionRecord.findMany.mockResolvedValue([{ bookingId: "bk-1", sourceCampaignId: "camp-1" }]);
    prisma.receipt.findMany.mockResolvedValue([{ bookingId: "bk-1", provider: "stripe", tier: "T1_FETCH_BACK" }]);

    await store.paidVisitsByCampaign({ orgId: "org-1", from: FROM, to: TO, isProduction: true });
    expect(prisma.conversionRecord.findMany.mock.calls[0]![0].where.organizationId).toBe("org-1");
    expect(prisma.receipt.findMany.mock.calls[0]![0].where.organizationId).toBe("org-1");
  });
});
```

- [ ] **Step 3: Run the store test — expect a FAIL (store.paidVisitsByCampaign is not a function).**

Run: `pnpm --filter @switchboard/db test -- prisma-revenue-store`
Expected: FAIL — TypeError: store.paidVisitsByCampaign is not a function (all new specs error).

- [ ] **Step 4: Implement paidVisitsByCampaign in packages/db/src/stores/prisma-revenue-store.ts. Add it as a public method on PrismaRevenueStore, right after revenueWithFirstTouch (which ends at line 261, before the closing brace of the class at 262). It mirrors revenueWithFirstTouch's two-findMany + Map join shape (:208-260). Returns raw cents; applies the origin='live' filter in the WHERE only when isProduction; post-join drops noop/non-T1 receipts only when isProduction; derives attributionBasis. NOTE: also add the matching return type to nothing else — this method is intentionally NOT on the RevenueStore interface (it is a concrete read used by the route), matching how revenueWithFirstTouch is also off-interface.**

```ts
// packages/db/src/stores/prisma-revenue-store.ts — add inside the class, after revenueWithFirstTouch

  /**
   * One row per individually-verified PAID visit, joined to its campaign via
   * bookingId. Returns amount in CENTS (the caller converts to major units
   * exactly once). Per spec R1: in production, only origin="live" rows backed by
   * a non-Noop T1 payment receipt count — a Noop/degraded payment can exercise
   * the write path but must never surface here as a real paid visit.
   */
  async paidVisitsByCampaign(input: {
    orgId: string;
    from: Date;
    to: Date;
    isProduction: boolean;
  }): Promise<
    Array<{
      bookingId: string;
      amountCents: number;
      currency: string;
      sourceCampaignId: string | null;
      attributionBasis: "ctwa_captured" | "campaign_missing";
      paidAt: Date;
    }>
  > {
    const where: Record<string, unknown> = {
      organizationId: input.orgId,
      verified: true,
      bookingId: { not: null },
      recordedAt: { gte: input.from, lt: input.to },
    };
    // Anti-fixture: in production only live-origin revenue is countable.
    if (input.isProduction) where.origin = "live";

    const events = await this.prisma.lifecycleRevenueEvent.findMany({
      where,
      select: { bookingId: true, amount: true, currency: true, recordedAt: true },
      orderBy: { recordedAt: "desc" },
    });
    if (events.length === 0) return [];

    const bookingIds = [
      ...new Set(events.map((e) => e.bookingId).filter((b): b is string => b !== null)),
    ];

    // Campaign attribution comes from the booked ConversionRecord (org-scoped).
    const conversions = await this.prisma.conversionRecord.findMany({
      where: { organizationId: input.orgId, bookingId: { in: bookingIds } },
      select: { bookingId: true, sourceCampaignId: true },
    });
    const campaignByBooking = new Map<string, string | null>();
    for (const c of conversions) {
      if (c.bookingId && !campaignByBooking.has(c.bookingId)) {
        campaignByBooking.set(c.bookingId, c.sourceCampaignId);
      }
    }

    // Payment-receipt provenance (org-scoped) — drives the Noop/degraded exclusion.
    const receipts = await this.prisma.receipt.findMany({
      where: { organizationId: input.orgId, kind: "payment", bookingId: { in: bookingIds } },
      select: { bookingId: true, provider: true, tier: true },
    });
    const receiptByBooking = new Map<string, { provider: string | null; tier: string }>();
    for (const r of receipts) {
      if (r.bookingId && !receiptByBooking.has(r.bookingId)) {
        receiptByBooking.set(r.bookingId, { provider: r.provider, tier: r.tier });
      }
    }

    const rows: Array<{
      bookingId: string;
      amountCents: number;
      currency: string;
      sourceCampaignId: string | null;
      attributionBasis: "ctwa_captured" | "campaign_missing";
      paidAt: Date;
    }> = [];
    for (const e of events) {
      const bookingId = e.bookingId;
      if (!bookingId) continue;
      if (input.isProduction) {
        const receipt = receiptByBooking.get(bookingId);
        // Production-countable paid visit requires a real T1 fetch-back receipt
        // from a non-Noop provider. Anything else is degraded and excluded.
        if (!receipt || receipt.provider === "noop" || receipt.tier !== "T1_FETCH_BACK") {
          continue;
        }
      }
      const campaign = campaignByBooking.get(bookingId) ?? null;
      rows.push({
        bookingId,
        amountCents: e.amount,
        currency: e.currency,
        sourceCampaignId: campaign,
        attributionBasis: campaign ? "ctwa_captured" : "campaign_missing",
        paidAt: e.recordedAt,
      });
    }
    return rows;
  }
```

- [ ] **Step 5: Run the store test — expect PASS.**

Run: `pnpm --filter @switchboard/db test -- prisma-revenue-store`
Expected: PASS — all paidVisitsByCampaign specs green; existing revenue-store specs still pass.

- [ ] **Step 6: Typecheck the db package.**

Run: `pnpm --filter @switchboard/db typecheck`
Expected: PASS — no TypeScript errors (relies on the dependency PRs' bookingId/origin/Receipt columns from the regenerated client).

- [ ] **Step 7: Commit.**

Run: `git add packages/db/src/stores/prisma-revenue-store.ts packages/db/src/stores/__tests__/prisma-revenue-store.test.ts && git commit -m "feat(db): paidVisitsByCampaign read — verified-only per-visit rows, noop-excluded in prod"`
Expected: Commit created (lowercase conventional subject).


#### Task 3: Task 3 — API route: extend by-campaign with ?detail=paid-visits, cents→major exactly once

**Files:**
- Modify: `/Users/jasonli/switchboard/apps/api/src/routes/revenue.ts`
- Test: `/Users/jasonli/switchboard/apps/api/src/routes/__tests__/revenue.test.ts`

- [ ] **Step 1: Add a failing unit test for the cents→major mapper. Open apps/api/src/routes/__tests__/revenue.test.ts and append a describe block that imports the pure mapper `toPaidVisitRow` (which the route will use). Assert 50000 cents → amountMajor 500 (NOT 5_000_000, NOT 500_000) and that attributionBasis/campaign fields pass through. This fails because toPaidVisitRow does not exist yet.**

```ts
// append to apps/api/src/routes/__tests__/revenue.test.ts
import { toPaidVisitRow } from "../revenue.js";

describe("toPaidVisitRow — cents→major conversion (1A-6 unit boundary)", () => {
  it("converts 50000 cents to S$500.00 major units exactly once (not 100x)", () => {
    const row = toPaidVisitRow({
      bookingId: "bk-1",
      amountCents: 50000,
      currency: "SGD",
      sourceCampaignId: "camp-1",
      attributionBasis: "ctwa_captured",
      paidAt: new Date("2026-06-01T00:00:00.000Z"),
    });
    expect(row.amountMajor).toBe(500);
    expect(row.amountMajor).not.toBe(5_000_000);
    expect(row.amountMajor).not.toBe(500_000);
    expect(row.currency).toBe("SGD");
    expect(row.campaignId).toBe("camp-1");
    expect(row.campaignName).toBe("camp-1");
    expect(row.attributionBasis).toBe("ctwa_captured");
    expect(row.paidAt).toBe("2026-06-01T00:00:00.000Z");
  });

  it("keeps campaign_missing honest: null campaign id/name, never 0", () => {
    const row = toPaidVisitRow({
      bookingId: "bk-2",
      amountCents: 12050,
      currency: "SGD",
      sourceCampaignId: null,
      attributionBasis: "campaign_missing",
      paidAt: new Date("2026-06-02T00:00:00.000Z"),
    });
    expect(row.amountMajor).toBe(120.5);
    expect(row.campaignId).toBeNull();
    expect(row.campaignName).toBeNull();
    expect(row.attributionBasis).toBe("campaign_missing");
  });
});
```

- [ ] **Step 2: Run the api test — expect a FAIL (no export toPaidVisitRow).**

Run: `pnpm --filter @switchboard/api test -- revenue.test`
Expected: FAIL — '"../revenue.js"' has no exported member 'toPaidVisitRow'.

- [ ] **Step 3: Edit apps/api/src/routes/revenue.ts. (1) Import the PaidVisitRow type. (2) Add and EXPORT the pure mapper `toPaidVisitRow` near the top (after the schema, before revenueRoutes) — this is the single cents→major boundary (÷100). (3) In the GET /:orgId/revenue/by-campaign handler (currently lines 114-125), branch on `request.query.detail === 'paid-visits'`: call store.paidVisitsByCampaign with a 90-day window and isProduction from NODE_ENV, map with toPaidVisitRow, return `{ paidVisits }`; otherwise keep the existing `{ campaigns }` behavior unchanged.**

```ts
// apps/api/src/routes/revenue.ts

// (1) add to the existing schemas import line:
import type { PaidVisitRow } from "@switchboard/schemas";

// (2) add this exported mapper after RecordRevenueInputSchema (the ONLY cents→major boundary):
export function toPaidVisitRow(row: {
  bookingId: string;
  amountCents: number;
  currency: string;
  sourceCampaignId: string | null;
  attributionBasis: "ctwa_captured" | "campaign_missing";
  paidAt: Date;
}): PaidVisitRow {
  return {
    bookingId: row.bookingId,
    amountMajor: row.amountCents / 100, // convert cents → major units EXACTLY ONCE
    currency: row.currency,
    campaignId: row.sourceCampaignId,
    campaignName: row.sourceCampaignId, // human label is the campaign id until a name lookup ships
    attributionBasis: row.attributionBasis,
    paidAt: row.paidAt.toISOString(),
  };
}

// (3) REPLACE the body of the existing GET /:orgId/revenue/by-campaign handler with:
  app.get("/:orgId/revenue/by-campaign", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }

    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const store = new PrismaRevenueStore(app.prisma);
    const { detail } = request.query as { detail?: string };

    if (detail === "paid-visits") {
      const to = new Date();
      const from = new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000);
      const visits = await store.paidVisitsByCampaign({
        orgId,
        from,
        to,
        isProduction: process.env.NODE_ENV === "production",
      });
      const paidVisits = visits.map(toPaidVisitRow);
      return reply.send({ paidVisits });
    }

    const campaigns = await store.sumByCampaign(orgId);
    return reply.send({ campaigns });
  });
```

- [ ] **Step 4: Run the api test — expect PASS.**

Run: `pnpm --filter @switchboard/api test -- revenue.test`
Expected: PASS — toPaidVisitRow specs green (500, 120.5, honest nulls); existing RecordRevenueInputSchema specs still pass.

- [ ] **Step 5: Typecheck the api package.**

Run: `pnpm --filter @switchboard/api typecheck`
Expected: PASS — no TypeScript errors.

- [ ] **Step 6: Commit.**

Run: `git add apps/api/src/routes/revenue.ts apps/api/src/routes/__tests__/revenue.test.ts && git commit -m "feat(api): by-campaign ?detail=paid-visits returns per-visit rows; cents to major once"`
Expected: Commit created (lowercase conventional subject).


#### Task 4: Task 4 — Dashboard api-client method + proxy route

**Files:**
- Create: `/Users/jasonli/switchboard/apps/dashboard/src/app/api/dashboard/revenue/paid-visits/route.ts`
- Create: `/Users/jasonli/switchboard/apps/dashboard/src/app/api/dashboard/revenue/paid-visits/__tests__/route.test.ts`
- Modify: `/Users/jasonli/switchboard/apps/dashboard/src/lib/api-client/dashboard.ts`
- Test: `/Users/jasonli/switchboard/apps/dashboard/src/app/api/dashboard/revenue/paid-visits/__tests__/route.test.ts`

- [ ] **Step 1: Add the client method to apps/dashboard/src/lib/api-client/dashboard.ts. Import the PaidVisitRow type and add getPaidVisitsByCampaign right after recordRevenue (lines 70-87), mirroring getRoiSummary's query-string + this.request pattern (:61-68). Dashboard imports omit .js extensions (Next.js) — use the bare @switchboard/schemas import.**

```ts
// apps/dashboard/src/lib/api-client/dashboard.ts
// add PaidVisitRow to the existing `import type { ... } from "@switchboard/schemas";` block, then add:

  async getPaidVisitsByCampaign(
    orgId: string,
    params: { from: string; to: string },
  ): Promise<{ paidVisits: PaidVisitRow[] }> {
    const search = new URLSearchParams({
      detail: "paid-visits",
      from: params.from,
      to: params.to,
    });
    return this.request<{ paidVisits: PaidVisitRow[] }>(
      `/api/${orgId}/revenue/by-campaign?${search.toString()}`,
    );
  }
```

- [ ] **Step 2: Create the proxy route test FIRST (failing). Mirror operator-chat/__tests__/route.test.ts:1-50: mock session + getApiClient, assert 401 when unauthenticated, 200 happy path forwarding the rows, and that orgId is taken from session.organizationId (not the query). This fails because ../route does not exist yet.**

```ts
// apps/dashboard/src/app/api/dashboard/revenue/paid-visits/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));

const mockGetPaidVisitsByCampaign = vi.fn();
vi.mock("@/lib/get-api-client", () => ({
  getApiClient: vi.fn(() => ({ getPaidVisitsByCampaign: mockGetPaidVisitsByCampaign })),
}));

import { GET } from "../route";
import { requireSession } from "@/lib/session";

describe("GET /api/dashboard/revenue/paid-visits", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when not authenticated", async () => {
    (requireSession as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Unauthorized"));
    const req = new Request("http://localhost/api/dashboard/revenue/paid-visits");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("proxies to the API with session org and returns rows", async () => {
    (requireSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u-1", email: "owner@example.com" },
      organizationId: "org-1",
      principalId: "p-1",
    });
    mockGetPaidVisitsByCampaign.mockResolvedValue({
      paidVisits: [
        {
          bookingId: "bk-1",
          amountMajor: 500,
          currency: "SGD",
          campaignId: "camp-1",
          campaignName: "camp-1",
          attributionBasis: "ctwa_captured",
          paidAt: "2026-06-01T00:00:00.000Z",
        },
      ],
    });

    const req = new Request("http://localhost/api/dashboard/revenue/paid-visits");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { paidVisits: unknown[] };
    expect(body.paidVisits).toHaveLength(1);
    // orgId comes from the session, not the request URL
    expect(mockGetPaidVisitsByCampaign).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ from: expect.any(String), to: expect.any(String) }),
    );
  });
});
```

- [ ] **Step 3: Run the proxy test — expect a FAIL (Cannot find module '../route').**

Run: `pnpm --filter @switchboard/dashboard test -- paid-visits`
Expected: FAIL — cannot resolve ../route (the proxy route file does not exist yet).

- [ ] **Step 4: Create the proxy route apps/dashboard/src/app/api/dashboard/revenue/paid-visits/route.ts, mirroring the overview proxy (requireSession → getApiClient → client method → NextResponse.json; proxyError 401 on Unauthorized else 500). Compute a 90-day window server-side so the client always sends from/to.**

```ts
// apps/dashboard/src/app/api/dashboard/revenue/paid-visits/route.ts
import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { proxyError } from "@/lib/proxy-error";

export async function GET(_req: Request) {
  try {
    const session = await requireSession();
    const client = await getApiClient();
    const to = new Date();
    const from = new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000);
    const data = await client.getPaidVisitsByCampaign(session.organizationId, {
      from: from.toISOString(),
      to: to.toISOString(),
    });
    return NextResponse.json(data);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
```

- [ ] **Step 5: Run the proxy test — expect PASS.**

Run: `pnpm --filter @switchboard/dashboard test -- paid-visits`
Expected: PASS — 401 and happy-path specs green.

- [ ] **Step 6: Typecheck the dashboard (this is the only step that catches dashboard import/.js mistakes).**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS — no TypeScript errors; getPaidVisitsByCampaign resolves on the composed SwitchboardClient.

- [ ] **Step 7: Commit.**

Run: `git add apps/dashboard/src/lib/api-client/dashboard.ts apps/dashboard/src/app/api/dashboard/revenue/paid-visits/ && git commit -m "feat(dashboard): paid-visits api-client method + proxy route"`
Expected: Commit created (lowercase conventional subject).


#### Task 5: Task 5 — Dashboard panel: paid-visits-section with honest attribution copy

**Files:**
- Create: `/Users/jasonli/switchboard/apps/dashboard/src/components/results/paid-visits-section.tsx`
- Create: `/Users/jasonli/switchboard/apps/dashboard/src/components/results/paid-visits-section.test.tsx`
- Test: `/Users/jasonli/switchboard/apps/dashboard/src/components/results/paid-visits-section.test.tsx`

- [ ] **Step 1: Write the component test FIRST (failing). Mirror campaigns-section.test.tsx style (render + container.textContent). Assert: (1) one line per paid visit; (2) ctwa_captured copy reads 'linked to campaign … via CTWA attribution' and NEVER 'proven'; (3) campaign_missing renders an honest fallback (contains 'campaign not captured', NOT blank, NOT '0'); (4) money shows S$ with cents and no bare $ (reuse the /(?<!S)\$/ guard); (5) empty array renders a calm empty-state. This fails because the component file does not exist.**

```ts
// apps/dashboard/src/components/results/paid-visits-section.test.tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import type { PaidVisitRow } from "@switchboard/schemas";
import { PaidVisitsSection } from "./paid-visits-section";

const ctwa: PaidVisitRow = {
  bookingId: "bk-1",
  amountMajor: 500,
  currency: "SGD",
  campaignId: "camp-1",
  campaignName: "Spring Promo",
  attributionBasis: "ctwa_captured",
  paidAt: "2026-06-01T00:00:00.000Z",
};
const missing: PaidVisitRow = {
  bookingId: "bk-2",
  amountMajor: 120.5,
  currency: "SGD",
  campaignId: null,
  campaignName: null,
  attributionBasis: "campaign_missing",
  paidAt: "2026-06-02T00:00:00.000Z",
};

describe("PaidVisitsSection", () => {
  it("renders one line per paid visit with honest CTWA attribution copy (never 'proven')", () => {
    const { container } = render(<PaidVisitsSection visits={[ctwa]} />);
    expect(container.textContent).toContain("Spring Promo");
    expect(container.textContent).toContain("linked to campaign");
    expect(container.textContent).toContain("via CTWA attribution");
    expect(container.textContent?.toLowerCase()).not.toContain("proven");
  });

  it("shows money as S$ with cents and no bare $", () => {
    const { container } = render(<PaidVisitsSection visits={[ctwa]} />);
    expect(container.textContent).toContain("S$500.00");
    expect(container.textContent).not.toMatch(/(?<!S)\$/);
  });

  it("renders campaign_missing honestly (not blank, not 0, not as attributed)", () => {
    const { container } = render(<PaidVisitsSection visits={[missing]} />);
    expect(container.textContent?.toLowerCase()).toContain("campaign not captured");
    expect(container.textContent).not.toContain("via CTWA attribution");
    expect(container.textContent).toContain("S$120.50");
  });

  it("renders a calm empty-state when there are no paid visits", () => {
    const { container } = render(<PaidVisitsSection visits={[]} />);
    expect(container.textContent?.toLowerCase()).toMatch(/no paid visits|once a deposit/);
  });
});
```

- [ ] **Step 2: Run the component test — expect a FAIL (cannot resolve ./paid-visits-section).**

Run: `pnpm --filter @switchboard/dashboard test -- paid-visits-section`
Expected: FAIL — cannot resolve ./paid-visits-section (component file does not exist).

- [ ] **Step 3: Create the component apps/dashboard/src/components/results/paid-visits-section.tsx. Reuse fmtSGD (with withCents:'always' so per-visit money always shows cents) and the existing results.module.css. Render each row as an honest sentence: ctwa_captured → 'Paid S$X visit linked to campaign <name> via CTWA attribution'; campaign_missing → 'Paid S$X visit — campaign not captured'. Calm empty-state. Dashboard imports omit .js.**

```ts
// apps/dashboard/src/components/results/paid-visits-section.tsx
"use client";

import { fmtSGD } from "@/app/(auth)/(mercury)/reports/components/format";
import type { PaidVisitRow } from "@switchboard/schemas";
import styles from "./results.module.css";

export function PaidVisitsSection({ visits }: { visits: PaidVisitRow[] }) {
  if (visits.length === 0) {
    return (
      <p className={styles.campaignEmpty}>
        No paid visits yet — once a deposit is captured against a booking, the verified visit and
        the ad that produced it appear here.
      </p>
    );
  }

  return (
    <ol className={styles.campaignCardList}>
      {visits.map((v) => (
        <li key={v.bookingId} className={styles.campaignCard}>
          {v.attributionBasis === "ctwa_captured" && v.campaignName ? (
            <span>
              Paid {fmtSGD(v.amountMajor, { withCents: "always" })} visit linked to campaign{" "}
              {v.campaignName} via CTWA attribution
            </span>
          ) : (
            <span>
              Paid {fmtSGD(v.amountMajor, { withCents: "always" })} visit — campaign not captured
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 4: Run the component test — expect PASS.**

Run: `pnpm --filter @switchboard/dashboard test -- paid-visits-section`
Expected: PASS — all four specs green (one line per visit, honest copy, campaign_missing fallback, empty-state).

- [ ] **Step 5: Run lint + format check on the touched dashboard files (CI runs prettier; local lint does not — catch it now).**

Run: `pnpm --filter @switchboard/dashboard lint && pnpm format:check`
Expected: PASS — no lint errors; prettier reports the new files already formatted (semi, double quotes, 2-space, 100 width).

- [ ] **Step 6: Commit.**

Run: `git add apps/dashboard/src/components/results/paid-visits-section.tsx apps/dashboard/src/components/results/paid-visits-section.test.tsx && git commit -m "feat(dashboard): paid-visits-by-ad panel with honest ctwa attribution copy"`
Expected: Commit created (lowercase conventional subject).


#### Task 6: Task 6 — Full verification gate (typecheck, tests, arch) across touched packages

**Files:**
- Test: `/Users/jasonli/switchboard/packages/db/src/stores/__tests__/prisma-revenue-store.test.ts`
- Test: `/Users/jasonli/switchboard/apps/api/src/routes/__tests__/revenue.test.ts`
- Test: `/Users/jasonli/switchboard/apps/dashboard/src/app/api/dashboard/revenue/paid-visits/__tests__/route.test.ts`
- Test: `/Users/jasonli/switchboard/apps/dashboard/src/components/results/paid-visits-section.test.tsx`

- [ ] **Step 1: Run the full test suite for the four touched packages to confirm nothing regressed (the store-tightening lesson: run api + dashboard too, not just db).**

Run: `pnpm --filter @switchboard/schemas --filter @switchboard/db --filter @switchboard/api --filter @switchboard/dashboard test`
Expected: PASS — all suites green across schemas, db, api, dashboard.

- [ ] **Step 2: Run typecheck across the repo (picks up app packages from the rebuilt lower layers).**

Run: `pnpm typecheck`
Expected: PASS — no TypeScript errors anywhere.

- [ ] **Step 3: Run the architecture check (CI 'architecture' job counts raw .ts lines, err >600; separate from eslint). Confirms prisma-revenue-store.ts (~317) and revenue.ts (~151) stay under the limit and no layering rule broke (ad-optimizer untouched; this PR only touches schemas/db/api/dashboard).**

Run: `pnpm arch:check`
Expected: PASS — no file >600 raw lines; no forbidden cross-layer import introduced.

- [ ] **Step 4: Final lint across the repo.**

Run: `pnpm lint`
Expected: PASS — no lint errors.

- [ ] **Step 5: If all green, there is nothing to commit (verification only). Confirm the branch is clean.**

Run: `git status --short`
Expected: Clean working tree — all five feature commits already made; no unstaged changes.

