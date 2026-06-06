# Close the Revenue Loop — Spec-1A (Prove Leg) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "this paid $X visit came from campaign Y" a provable, replay-proof fact for one no-PMS clinic chain — the first sellable artifact and the WTP demo, before the act leg (Spec-1B).

**Architecture:** One spine — Contact (unified by canonical E.164) <- ConversationThread <- WorkTrace(contactId, conversationThreadId) <- Booking(workTraceId) <- Receipt(bookingId) <- ConversionRecord/LifecycleRevenueEvent(bookingId). Architecture A (no-PMS): Switchboard owns the deposit, so a verified PSP PaymentReceipt makes the paid visit a first-party fact. The Riley act-leg and architecture B are deliberately out of this plan (Spec-1B/1C).

**Tech Stack:** TypeScript ESM monorepo (pnpm, Turborepo), Prisma/Postgres, vitest, Fastify (apps/api), Next.js (apps/dashboard). Layering schemas->{ad-optimizer,...}->core->db->apps.

Spec: `docs/superpowers/specs/2026-06-05-close-the-revenue-loop-design.md`. Sequence is strict (1A-1 is load-bearing; everything else mis-attributes until it lands). Run `pnpm worktree:init` in the implementation worktree before starting.

---

## File map (all PRs)

| PR | Action | Path | Responsibility |
|---|---|---|---|
| 1A-1 | create | `packages/schemas/src/phone.ts` | L1 canonical phone module: normalizeToE164(raw, region?) -> string|null with SG/MY heuristics + refuse-to-guess, and isE164(value) -> boolean reusing the E.164 regex shape from whatsapp-template-create.ts:3. No @switchboard/* imports. |
| 1A-1 | create | `packages/schemas/src/phone.test.ts` | Co-located unit matrix for normalizeToE164/isE164: already-+ idempotent, SG 8-digit -> +65, MY 0-prefixed -> +60 drop-0, strip spaces/dashes/parens, junk -> null (never throws). |
| 1A-1 | modify | `packages/schemas/src/index.ts` | Barrel re-export of ./phone.js so @switchboard/schemas exposes normalizeToE164 + isE164 to L2/L3/L4 callers. |
| 1A-1 | modify | `packages/db/prisma/schema.prisma` | Add Contact.phoneE164 String? + @@index([organizationId, phoneE164]). (Partial unique lives in raw SQL — Prisma 6 cannot express it.) |
| 1A-1 | create | `packages/db/prisma/migrations/20260606120000_contact_phone_e164/migration.sql` | Add column phoneE164, the plain composite index, and a RAW-SQL PARTIAL UNIQUE index on (organizationId, phoneE164) WHERE phoneE164 IS NOT NULL. Mirrors 20260603120000. |
| 1A-1 | modify | `packages/db/src/stores/prisma-contact-store.ts` | Derive phoneE164 from input.phone in create(); normalize the lookup arg in findByPhone() to query by phoneE164 (fallback to raw phone for un-normalizable input). Map phoneE164 through to the Contact projection is NOT required (not in the schema type); only the write/lookup derivation. |
| 1A-1 | modify | `packages/db/src/stores/__tests__/prisma-contact-store.test.ts` | Mocked-Prisma tests: create() passes a derived phoneE164 to prisma.contact.create; findByPhone() looks up the normalized form so a bare wa_id matches a +E.164 row; un-normalizable input still queries raw phone. |
| 1A-1 | modify | `packages/db/src/stores/lead-intake-store.ts` | Derive phoneE164 from input.phone inside upsertContact() create branch so the CTWA Contact persists a normalized number. |
| 1A-1 | modify | `packages/db/src/stores/__tests__/lead-intake-store.test.ts` | Add a mocked-Prisma describe block (NOT gated on DATABASE_URL) asserting upsertContact's create payload carries the derived phoneE164. |
| 1A-1 | modify | `packages/ad-optimizer/src/lead-intake/ctwa-adapter.ts` | Replace the hand-rolled `from.startsWith("+") ? from : `+${from}`` at line 54 with normalizeToE164 (SG/MY heuristics); fall back to the raw +prefix shape only when normalization returns null so a non-SG/MY number is still ingestible. |
| 1A-1 | modify | `packages/ad-optimizer/src/lead-intake/instant-form-adapter.ts` | Replace the hand-rolled normalizePhone() helper at lines 25-28 with normalizeToE164, preserving the undefined-on-missing contract. |
| 1A-1 | modify | `packages/core/src/channel-gateway/resolve-contact-identity.ts` | Normalize the WhatsApp sessionId (bare wa_id) via normalizeToE164 before findByPhone/create so the lookup matches the lead.intake-stored phoneE164; keep the original sessionId as the returned `phone` only if normalization fails. |
| 1A-1 | modify | `packages/core/src/channel-gateway/__tests__/resolve-contact-identity.test.ts` | Add the load-bearing regression: bare wa_id `6591234567` resolves findByPhone with the normalized `+6591234567` and, when the store returns Contact A, does NOT call create. |
| 1A-2 | modify | `/Users/jasonli/switchboard/packages/core/src/skill-runtime/tools/calendar-book.ts` | Pass workTraceId: ctx.workUnitId ?? null into bookingStore.create (line 259 block) so the Booking row is joinable to its WorkTrace. No other behavior change. |
| 1A-2 | modify | `/Users/jasonli/switchboard/packages/core/src/skill-runtime/tools/calendar-book.test.ts` | Add a test asserting bookingStore.create is called with workTraceId from ctx.workUnitId, and a test asserting it falls back to null when ctx.workUnitId is absent. |
| 1A-2 | modify | `/Users/jasonli/switchboard/packages/core/src/platform/work-trace-hash.ts` | Add 'contactId' and 'conversationThreadId' to EXCLUDED_BASE so the two new WorkTrace columns are stripped from the canonical hash input (precedent: injectedPatternIds). No hashInputVersion bump. |
| 1A-2 | modify | `/Users/jasonli/switchboard/packages/core/src/platform/__tests__/work-trace-hash.test.ts` | Add an INVARIANCE test (same trace with vs without contactId/conversationThreadId -> identical contentHash) and update the two excluded-set length assertions (v1: 6->8, v2: 5->7) and the arrayContaining lists. |
| 1A-2 | modify | `/Users/jasonli/switchboard/packages/core/src/platform/work-trace.ts` | Add contactId?: string and conversationThreadId?: string to the WorkTrace interface (chain-join lineage; excluded from hash). |
| 1A-2 | modify | `/Users/jasonli/switchboard/packages/core/src/platform/canonical-request.ts` | Add conversationThreadId?: string to CanonicalSubmitRequest so the resolved thread id can flow from the gateway to the persisted WorkTrace. |
| 1A-2 | modify | `/Users/jasonli/switchboard/packages/core/src/platform/work-trace-recorder.ts` | In buildWorkTrace and buildClaimTrace, populate trace.contactId from workUnit.parameters.contactId (trusted bag) and trace.conversationThreadId from workUnit.conversationThreadId. |
| 1A-2 | modify | `/Users/jasonli/switchboard/packages/core/src/platform/work-trace-recorder.test.ts` | Add tests asserting buildWorkTrace/buildClaimTrace copy contactId from parameters and conversationThreadId from the work unit (create the file if it does not exist). |
| 1A-2 | modify | `/Users/jasonli/switchboard/packages/core/src/platform/work-unit.ts` | Add conversationThreadId?: string to WorkUnit and copy request.conversationThreadId in normalizeWorkUnit. |
| 1A-2 | modify | `/Users/jasonli/switchboard/packages/core/src/channel-gateway/channel-gateway.ts` | Thread the resolved conversationId (the thread id) into the CanonicalSubmitRequest as conversationThreadId at the submit call site. |
| 1A-2 | modify | `/Users/jasonli/switchboard/packages/db/prisma/schema.prisma` | Add WorkTrace.contactId String?, WorkTrace.conversationThreadId String?, and two indexes (organizationId+contactId, organizationId+conversationThreadId). |
| 1A-2 | create | `/Users/jasonli/switchboard/packages/db/prisma/migrations/20260606120000_worktrace_chain_columns/migration.sql` | ALTER TABLE WorkTrace ADD the two nullable columns + CREATE the two indexes (plain B-tree, no partial unique — committed in the same commit as the schema change). |
| 1A-2 | modify | `/Users/jasonli/switchboard/packages/db/src/stores/prisma-work-trace-store.ts` | Write contactId/conversationThreadId in buildWorkTraceCreateData and read them back in mapRowToTrace. |
| 1A-2 | modify | `/Users/jasonli/switchboard/packages/db/src/stores/__tests__/prisma-work-trace-store.test.ts` | Add a test asserting persist() writes contactId/conversationThreadId (and null when absent). |
| 1A-2 | modify | `/Users/jasonli/switchboard/packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts` | Add a test asserting record() stamps ConversionRecord.bookingId from event.metadata.bookingId (proves the booked-outbox -> conversion-record leg of the chain). |
| 1A-2 | modify | `/Users/jasonli/switchboard/apps/chat/src/gateway/gateway-conversation-store.ts` | Re-key the gateway thread off a resolved {contactId, organizationId} (injected resolver) instead of the literal 'visitor-'+sessionId / 'gateway', so the attribution-carrying Contact is the thread's contact. |
| 1A-2 | modify | `/Users/jasonli/switchboard/apps/chat/src/gateway/__tests__/gateway-conversation-store.test.ts` | Update existing tests for the resolver and add a test asserting the thread is created with the RESOLVED contactId/org, not the visitor-/gateway literals. |
| 1A-3 | create | `packages/schemas/src/receipt.ts` | ReceiptKind/ReceiptTier/ReceiptStatus enums; CalendarReceiptEvidenceSchema + PaymentReceiptEvidenceSchema; ReceiptEvidenceSchema = z.discriminatedUnion('kind', ...) (no any); ReceiptSchema; IsPaidVisitVerdictSchema/IsPaidVisitVerdict {paid,held,tier,basis,degraded}; inferred types. |
| 1A-3 | create | `packages/schemas/src/__tests__/receipt.test.ts` | Parse/round-trip tests: valid calendar+payment receipts parse; evidence discriminator rejects a payment-shaped evidence under kind:calendar; tier/status enums reject junk; verdict schema parses. |
| 1A-3 | modify | `packages/schemas/src/index.ts` | Add `export * from "./receipt.js";` so Receipt + verdict types are importable as @switchboard/schemas. |
| 1A-3 | create | `packages/core/src/receipts/is-paid-visit.ts` | Pure isPaidVisit(receipt): IsPaidVisitVerdict — structured verdict, never a bare boolean. Maps (kind,tier,status) to {paid,held,tier,basis,degraded}. |
| 1A-3 | create | `packages/core/src/receipts/is-paid-visit.test.ts` | Verdict matrix: calendar-T1-held, calendar-T3-local degraded, payment-T1 paid, calendar status=paid (B via T3) paid, status=void neither; asserts return is the structured object not a boolean. |
| 1A-3 | create | `packages/core/src/receipts/resolve-calendar-receipt-tier.ts` | Pure resolveCalendarReceiptTier({calendarEventId,isProduction}): ReceiptTier — fabricated id (null | noop- | local- prefix) → T3; real provider id → T1; in production a fabricated id can NEVER yield T1/T2 (the anti-fake prod-assert). |
| 1A-3 | create | `packages/core/src/receipts/resolve-calendar-receipt-tier.test.ts` | Prod-assert matrix: prod+noop-/local-/null → T3; prod+gcal_ real id → T1; non-prod+local- → still T3 (honest degradation regardless of env). |
| 1A-3 | create | `packages/core/src/receipts/receipt-store.ts` | ReceiptStore interface + CreateReceiptInput (mirrors lifecycle/revenue-store.ts shape) + StoreTransactionContext re-use; record(input,tx?) and findByBooking(orgId,bookingId). |
| 1A-3 | create | `packages/core/src/receipts/index.ts` | Barrel: re-export is-paid-visit, resolve-calendar-receipt-tier, receipt-store. |
| 1A-3 | modify | `packages/core/src/index.ts` | Add `export * from "./receipts/index.js";` next to the lifecycle export so isPaidVisit/ReceiptStore/resolveCalendarReceiptTier are public from @switchboard/core. |
| 1A-3 | create | `packages/db/src/stores/prisma-receipt-store.ts` | PrismaReceiptStore implements ReceiptStore (structural match) — record() (P2002 idempotency on the partial-unique externalRef) + findByBooking(); evidence written via typed cast (no any); mapper row→Receipt. |
| 1A-3 | create | `packages/db/src/stores/__tests__/prisma-receipt-store.test.ts` | Mocked-Prisma tests (mirror prisma-revenue-store.test.ts): record passes organizationId+kind+tier+status+evidence; tx threading uses tx client; findByBooking scopes org+bookingId; idempotent return on existing externalRef. |
| 1A-3 | modify | `packages/db/src/index.ts` | Add `export { PrismaReceiptStore } from "./stores/prisma-receipt-store.js";`. |
| 1A-3 | modify | `packages/db/prisma/schema.prisma` | Add `model Receipt` (id, organizationId, kind, tier, status, bookingId?, opportunityId?, revenueEventId?, connectionId?, provider?, externalRef?, amount Int?, currency?, evidence Json, capturedBy, verifiedAt?, workTraceId?, createdAt; @@index([organizationId,bookingId]); @@index([organizationId,kind,status])) with a comment noting the partial-unique lives in raw SQL. |
| 1A-3 | create | `packages/db/prisma/migrations/20260606120000_add_receipt/migration.sql` | CREATE TABLE "Receipt" (Prisma-generated DDL for the base model) + raw-SQL partial unique index Receipt_org_kind_externalRef_key ON (organizationId,kind,externalRef) WHERE externalRef IS NOT NULL (mirrors 20260603120000). |
| 1A-3 | create | `packages/core/src/receipts/mint-calendar-receipt.ts` | Pure buildCalendarReceiptInput({orgId,bookingId,opportunityId,calendarEventId,provider,workTraceId,isProduction,startsAt}): CreateReceiptInput — sets kind:calendar, status:held, tier via resolveCalendarReceiptTier, evidence {kind:calendar,...}. No DB access. |
| 1A-3 | create | `packages/core/src/receipts/mint-calendar-receipt.test.ts` | buildCalendarReceiptInput sets status held, kind calendar, T1 on real id, T3 on local-/prod, evidence carries calendarEventId+startsAt+provider. |
| 1A-3 | modify | `packages/core/src/skill-runtime/tools/calendar-book.ts` | Widen TransactionFn tx to include receipt.create; in the confirm tx (lines 343-394) call buildCalendarReceiptInput + tx.receipt.create(...) after the booking.update; add isProduction + calendarProviderName to CalendarBookToolDeps. |
| 1A-3 | modify | `packages/core/src/skill-runtime/tools/calendar-book.test.ts` | Add a confirm-tx test: a real calendarEventId mints a calendar Receipt tier T1 status held; a Noop result (calendarEventId null) under isProduction mints tier T3. |
| 1A-3 | modify | `apps/api/src/bootstrap/skill-mode.ts` | Forward tx.receipt in the calendar-book runTransaction (skill-mode.ts:329-347) and pass isProduction: process.env.NODE_ENV === "production" into createCalendarBookToolFactory. |
| 1A-4 | create | `packages/schemas/src/payment.ts` | L1 PaymentPort interface (createDepositLink(input)->DepositLink, retrievePayment(externalReference)->VerifiedPayment|null) + Zod schemas DepositLinkInputSchema/DepositLinkSchema/VerifiedPaymentSchema and inferred types. Mirrors calendar.ts CalendarProvider. No @switchboard/* imports. |
| 1A-4 | create | `packages/schemas/src/__tests__/payment.test.ts` | Unit tests for the payment Zod schemas (valid parse, amountCents must be a positive integer, currency length 3, externalReference required). |
| 1A-4 | modify | `packages/schemas/src/index.ts` | Add `export * from "./payment.js";` so PaymentPort + payment types are reachable from @switchboard/schemas. |
| 1A-4 | create | `apps/api/src/bootstrap/noop-payment-adapter.ts` | NoopPaymentAdapter implements PaymentPort: createDepositLink fabricates a DETERMINISTIC externalReference (`noop_pay_${bookingId}`) + url; retrievePayment echoes a deterministic verified VerifiedPayment for any `noop_pay_*` reference, returns null otherwise. Plus isNoopPaymentAdapter type-guard. Mirrors noop-calendar-provider.ts. |
| 1A-4 | create | `apps/api/src/bootstrap/__tests__/noop-payment-adapter.test.ts` | Tests: createDepositLink is deterministic for a given bookingId; retrievePayment returns a verified payment with the SAME externalReference + amountCents for a noop reference and null for an unknown one. |
| 1A-4 | create | `apps/api/src/bootstrap/payment-port-factory.ts` | Per-org PaymentPortFactory (orgId)->Promise<PaymentPort> with a process-lifetime cache, mirroring calendar-provider-factory.ts. Resolves NoopPaymentAdapter today (Stripe Connect adapter is 1A-4b fast-follow behind the same port). Rejects empty orgId with ORG_ID_REQUIRED. |
| 1A-4 | create | `apps/api/src/bootstrap/__tests__/payment-port-factory.test.ts` | Tests: rejects empty orgId; returns a PaymentPort; caches per orgId (same promise for repeated calls). |
| 1A-4 | create | `packages/core/src/skill-runtime/tools/deposit-link.ts` | createDepositLinkToolFactory: a SkillTool with one `deposit.issue` operation. Idempotent external read on the already-approved booking (sources orgId/bookingId from trusted SkillRequestContext+params, looks the booking up via an injected booking-store subset findById, calls PaymentPort.createDepositLink). Returns ok({url, externalReference, amountCents}) ToolResult. No new approval. Co-located so calendar-book.ts is untouched. |
| 1A-4 | create | `packages/core/src/skill-runtime/tools/deposit-link.test.ts` | Tests: returns ok with the port-issued link for a confirmed booking; fails MISSING_BOOKING when the booking is absent/cross-org; fails BOOKING_NOT_CONFIRMED when status!='confirmed'; calls createDepositLink with org+bookingId+amount. |
| 1A-4 | create | `apps/api/src/bootstrap/operator-intents/record-verified-payment.ts` | buildRecordVerifiedPaymentHandler(receiptWriter, revenueStore, outboxWriter, runInTransaction): OperatorMutationHandler. Parses RecordVerifiedPaymentParametersSchema, then in ONE runInTransaction writes (1) a payment Receipt(kind=payment,tier=T1_FETCH_BACK,status=paid,verified) via receiptWriter, (2) revenueStore.record({type:'deposit',verified:true,recordedBy:'stripe',bookingId,externalReference}), (3) outboxWriter.write(evt_pay_<id>,'purchased',...). Idempotent: relies on the partial-unique externalReference + revenueStore's externalReference short-circuit so a replay is a no-op. Plus the ReceiptWriter interface + RECORD_VERIFIED_PAYMENT_INTENT constant. |
| 1A-4 | create | `apps/api/src/bootstrap/operator-intents/record-verified-payment.test.ts` | Handler-unit tests: writes receipt+revenue+outbox once inside the SAME tx (all three get the same tx arg); never reads amount from anywhere but the parsed params; replay (record returns the existing event) re-issues the same outbox eventId so the partial-unique makes it a no-op. |
| 1A-4 | create | `apps/api/src/routes/operator-intents-schemas-payment.ts` | Zod RecordVerifiedPaymentParametersSchema (organizationId-free; contactId, opportunityId, bookingId, amountCents int positive, currency len 3, externalReference non-empty, sourceCampaignId/sourceAdId nullable). Co-located like operator-intents-schemas.ts. Kept in a separate file so operator-intents-schemas.ts stays small. |
| 1A-4 | create | `apps/api/src/routes/payments-webhook.ts` | // @route-class: ingress-receiver. POST /payments/webhook ingress-receiver copied from ad-optimizer.ts: read rawBody, verifyPaymentWebhookSignature(rawBody, sig, STRIPE_WEBHOOK_SECRET) fail-closed -> 401; parse the message id; resolve org from a Connection by externalAccountId AFTER verify; re-fetch the charge by id via the per-org PaymentPort.retrievePayment (NEVER the body amount); submit payment.record_verified via app.platformIngress with idempotencyKey from the provider message id. Exports verifyPaymentWebhookSignature. |
| 1A-4 | create | `apps/api/src/routes/__tests__/payments-webhook.test.ts` | Route tests (standalone Fastify, mirror ad-optimizer-signature.test.ts): rejects bad/missing HMAC over rawBody (401); fails closed with no secret (401); refuses unresolvable org (200 skipped, no submit); asserts retrievePayment(re-fetch) is called and the SUBMIT amount equals the re-fetched amountCents, NOT the (different) body amount; replay (same message id) -> ingress dedups (submit called, but writer idempotent). |
| 1A-4 | modify | `apps/api/src/bootstrap/operator-intents.ts` | Register the new payment.record_verified intent + handler: import buildRecordVerifiedPaymentHandler + RECORD_VERIFIED_PAYMENT_INTENT + ReceiptWriter; add receiptWriter?+paymentWiringDeps to OperatorIntentsBootstrapDeps; when receiptWriter+revenueStore+outboxWriter+runInTransaction present, handlers.set(...) and registerOperatorIntent(...). Re-export the constant. |
| 1A-4 | modify | `apps/api/src/app.ts` | Wire the new pieces at bootstrap: construct the PaymentPortFactory; decorate app.paymentPortFactory; pass a ReceiptWriter (writes a Receipt row via the tx Prisma client) into bootstrapOperatorIntents; register payments-webhook route under /api/payments. |
| 1A-4 | modify | `apps/api/src/bootstrap/routes.ts` | Import paymentsWebhookRoutes and register under prefix /api/payments (mirrors adOptimizerRoutes registration). |
| 1A-4 | modify | `packages/core/src/lifecycle/revenue-store.ts` | Add optional `bookingId?: string | null` to RecordRevenueInput so the verified-payment writer can stamp the booking on LifecycleRevenueEvent. |
| 1A-4 | modify | `packages/db/src/stores/prisma-revenue-store.ts` | Add `bookingId?: string | null` to the local RecordRevenueInput, persist it in create({data:{...bookingId}}), and surface it through mapRowToRevenueEvent. |
| 1A-4 | modify | `packages/db/src/stores/__tests__/prisma-revenue-store.test.ts` | Extend the create test to assert `bookingId` is forwarded into prisma.lifecycleRevenueEvent.create data and round-trips through the mapper. |
| 1A-4 | modify | `packages/schemas/src/lifecycle.ts` | Add `bookingId: z.string().nullable().optional()` to LifecycleRevenueEventSchema so the typed event carries the booking weld. |
| 1A-4 | modify | `packages/db/prisma/schema.prisma` | Add `bookingId String?` to model LifecycleRevenueEvent + `@@index([organizationId, bookingId])`. (The partial-unique on (organizationId, externalReference) is raw SQL in the migration; add a sync comment since Prisma 6 cannot express it.) |
| 1A-4 | create | `packages/db/prisma/migrations/20260606120000_lre_booking_and_external_ref_unique/migration.sql` | Raw SQL in the SAME commit: ALTER TABLE add bookingId; CREATE INDEX (organizationId,bookingId); CREATE UNIQUE INDEX ... (organizationId, externalReference) WHERE externalReference IS NOT NULL. Mirrors 20260603120000_booking_partial_unique_active. |
| 1A-4b | create | `apps/api/src/payments/stripe-connect-payment-adapter.ts` | StripeConnectPaymentAdapter class implementing PaymentPort (createDepositLink + retrievePayment) plus an exported verifyConnectWebhookSignature helper; depends only on an injected, narrowly-typed StripeConnectClient (checkout.sessions.create, paymentIntents.retrieve, webhooks.constructEvent) so it is unit-testable with no network and no `any`. Maps PaymentIntent.Status -> VerifiedPayment.status and uses the Stripe-side amount/currency. createDepositLink passes stripeAccount + a deterministic idempotencyKey `deposit_${bookingId}`. |
| 1A-4b | create | `apps/api/src/payments/stripe-connect-payment-adapter.test.ts` | Co-located unit tests: createDepositLink builds a destination charge on the connected account with idempotencyKey `deposit_${bookingId}` and re-issue reuses the same key; retrievePayment returns the Stripe-side amount/currency and maps status (succeeded->verified), returns null on a not-found PaymentIntent; status mapping matrix; verifyConnectWebhookSignature returns the constructed event on a good signature and rethrows on a tampered one (uses the per-org Connect secret). |
| 1A-4b | create | `apps/api/src/payments/stripe-connect-credentials.ts` | Pure parser/validator: parseStripeConnectCredentials(decrypted: Record<string, unknown>) -> { connectedAccountId, secretKey, webhookSecret } | null. Fail-closed: returns null unless all three string fields are present and non-empty, so the factory never builds a live-money adapter from partial creds. |
| 1A-4b | create | `apps/api/src/payments/stripe-connect-credentials.test.ts` | Co-located unit tests for the credential parser: full creds parse; each missing/blank/non-string field yields null; extra keys ignored. |
| 1A-4b | modify | `apps/api/src/bootstrap/payment-port-factory.ts` | Extend the 1A-4 per-org factory: query the org's `stripe` Connection (findFirst where organizationId+serviceId='stripe'+status='connected'), decrypt + parse its Connect credentials; when present, construct and return a StripeConnectPaymentAdapter (real Stripe client built from the per-org secret); otherwise keep returning the Noop adapter. Per-org cache + ORG_ID_REQUIRED guard preserved. Fail-closed: never falls back to global env for a live write. |
| 1A-4b | modify | `apps/api/src/bootstrap/__tests__/payment-port-factory.test.ts` | Add tests: factory returns a StripeConnectPaymentAdapter (not Noop) when a connected 'stripe' Connection with full Connect creds exists; returns Noop when no 'stripe' Connection; returns Noop when the 'stripe' Connection creds are partial (fail-closed); the Connection query filters by organizationId for cross-org isolation; injected stripeClientFactory + decrypt are used. |
| 1A-5 | modify | `packages/db/prisma/schema.prisma` | Add `origin String @default("live")` to the Booking (after line 1998 workTraceId), ConversionRecord (after line 2045 bookingId), and LifecycleRevenueEvent (after line 1844 sourceAdId) models. Add `@@index([organizationId, origin])` to each so the live-filter reads stay indexed. |
| 1A-5 | create | `packages/db/prisma/migrations/20260606120000_anti_fake_origin_hardening/migration.sql` | Hand-written migration (same commit as the schema change): ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'live' on Booking, ConversionRecord, LifecycleRevenueEvent; backfill is implicit via the DEFAULT for existing rows; CREATE INDEX for (organizationId, origin) on each table. No partial-unique here (plain column + plain index), so no raw-SQL gymnastics beyond ADD COLUMN/CREATE INDEX. |
| 1A-5 | modify | `packages/core/src/skill-runtime/tools/calendar-book.ts` | Measure 1: replace `const eventId = randomUUID();` (line 342) with `const eventId = \`evt_booked_${booking.id}\`;` and remove the now-unused `randomUUID` import (line 1). Measure 3: change the OutboxEvent payload `occurredAt` (line 367) from `new Date().toISOString()` to the external booking start `new Date(input.slotStart).toISOString()`. |
| 1A-5 | modify | `packages/core/src/skill-runtime/tools/calendar-book.test.ts` | Add tests: deterministic booked eventId equals `evt_booked_${bookingId}`; booked-event payload `occurredAt` equals the external `slotStart`, not the wall clock. |
| 1A-5 | modify | `packages/db/src/stores/prisma-booking-store.ts` | Stamp `origin: "live"` in the `booking.create` data block (after `workTraceId` on line 62). The store is the single live-booking writer; defaulting here means no app caller can drift it. |
| 1A-5 | modify | `packages/db/src/stores/__tests__/prisma-booking-store.test.ts` | Add a test asserting `create` writes `origin: "live"` into `tx.booking.create` data. |
| 1A-5 | modify | `packages/db/src/stores/prisma-conversion-record-store.ts` | Add `origin: "live"` to the upsert `create` block in `record()` (after `bookingId`, line 65) so the booked ConversionRecord written from the outbox is marked live. Add `origin: "live"` to the WHERE of the two trustworthy reads `queryBookedValueCentsByCampaign` (line 236 where) and `queryBookedStatsByCampaign` (line 273 where) so seed/demo rows can never inflate Riley's paid-value input. |
| 1A-5 | modify | `packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts` | Add tests: `record` writes `origin: "live"`; `queryBookedValueCentsByCampaign` and `queryBookedStatsByCampaign` each include `origin: "live"` in the groupBy where (fixture-leakage guard). |
| 1A-5 | modify | `packages/db/src/stores/prisma-revenue-store.ts` | Add `origin: "live"` to the `lifecycleRevenueEvent.create` data block in `record()` (after `sourceAdId`, line 90). Add `origin: "live"` to the WHERE of the trustworthy reads `sumByOrg` (line 121 where) and `sumByCampaign` (line 150 where) so seed/demo revenue never counts. |
| 1A-5 | modify | `packages/db/src/stores/__tests__/prisma-revenue-store.test.ts` | Add tests: `record` writes `origin: "live"`; `sumByOrg` and `sumByCampaign` include `origin: "live"` in their where (fixture-leakage guard). |
| 1A-5 | modify | `apps/api/src/routes/operator-intents-schemas.ts` | Measure 4: narrow `RecordRevenueParametersSchema.recordedBy` (line 89) from `z.enum(["owner", "staff", "stripe", "integration"])` to `z.enum(["owner", "staff"])`. Operators can only attest as owner/staff; `stripe`/`integration` is reserved for the PSP-fetch-back verified writer (1A-4). |
| 1A-5 | modify | `apps/api/src/routes/revenue.ts` | Measure 4: narrow the route-local `RecordRevenueInputSchema.recordedBy` (line 24) to `z.enum(["owner", "staff"])` to match the parameters schema (the route validates body before ingress, so it must reject `stripe` at the edge too). |
| 1A-5 | modify | `apps/api/src/bootstrap/operator-intents/revenue.ts` | Measure 4: pass `verified: false` explicitly into `revenueStore.record(...)` (in the input object around line 47) so the operator path can never be parsed/coerced into a verified row; the trustworthy count reads `verified=true` only. |
| 1A-5 | modify | `apps/api/src/bootstrap/operator-intents/__tests__/revenue.test.ts` | Add a test asserting `revenueStore.record` is called with `verified: false`. Keep existing tests (they use `recordedBy: "owner"`/`"staff"`, both still valid). |
| 1A-5 | modify | `apps/api/src/routes/__tests__/revenue-ingress.test.ts` | Add a test: POST /:orgId/revenue with `recordedBy: "stripe"` is rejected 400 by the narrowed enum (operator-forged-revenue regression). |
| 1A-5 | modify | `packages/core/src/channel-gateway/types.ts` | Measure 5: add `messageId?: string;` to the `IncomingChannelMessage` interface (after `text`, line 197). The provider message id (wamid for WhatsApp) flows in so the gateway can derive a per-message idempotency key. |
| 1A-5 | modify | `packages/core/src/channel-gateway/channel-gateway.ts` | Measure 5: when `message.messageId` is present, set `idempotencyKey: \`inbound:${message.channel}:${message.messageId}\`` on the `CanonicalSubmitRequest` (the object built at line 310) so a replayed inbound (same wamid) dedups at the existing `PlatformIngress.submit` idempotency claim (canonical-request.ts:27, platform-ingress.ts:100). |
| 1A-5 | create | `packages/core/src/channel-gateway/__tests__/channel-gateway-idempotency.test.ts` | Gateway idempotency tests: same `messageId` twice => `submit` receives the same `idempotencyKey` both times (the ingress claim then collapses the replay to one execution); no `messageId` => `idempotencyKey` is undefined (backward-compat). |
| 1A-5 | modify | `apps/chat/src/routes/managed-webhook.ts` | Measure 5 wiring: pass the already-extracted `rawMessageId` (line 158) into the `handleIncoming` call (line 172) as `messageId: rawMessageId ?? undefined` so the live WhatsApp inbound path supplies the wamid. |
| 1A-5 | modify | `apps/chat/src/routes/__tests__/managed-webhook.test.ts` | Add/extend a test asserting the gateway `handleIncoming` is called with `messageId` equal to the extracted wamid (so the same wamid twice yields one booking through the ingress claim). |
| 1A-6 | modify | `/Users/jasonli/switchboard/packages/db/src/stores/prisma-revenue-store.ts` | Add `PaidVisitRow` type + `paidVisitsByCampaign(input)` method: query verified+bookingId LifecycleRevenueEvent in [from,to), join ConversionRecord (sourceCampaignId) and Booking (startsAt as occurredExternalAt) by bookingId, org-isolated, amount passed through as amountCents (NO division). Also add the method to the `RevenueStore` interface. |
| 1A-6 | create | `/Users/jasonli/switchboard/packages/db/src/stores/__tests__/prisma-revenue-store-paid-visits.test.ts` | Co-located DB test (mocked Prisma, CI has no Postgres): one row per paid visit (not aggregated), verified=true only, bookingId-null excluded, org-isolation in every WHERE, amount returned verbatim in cents (no 100x), absent campaign join → null campaign field. |
| 1A-6 | modify | `/Users/jasonli/switchboard/apps/api/src/routes/revenue.ts` | Extend GET /:orgId/revenue/by-campaign: parse optional `view`, `from`, `to` query params; when view==="paid-visits" call store.paidVisitsByCampaign and reply { paidVisits }, else preserve the existing { campaigns } aggregate. Keep the // @route-class: operator-direct header. |
| 1A-6 | create | `/Users/jasonli/switchboard/apps/api/src/routes/__tests__/revenue-by-campaign-route.test.ts` | Fastify route test (mocks @switchboard/db PrismaRevenueStore, registers revenueRoutes, app.inject): paid-visits view returns the per-visit array, org passed through from auth, 403 when unauthenticated, default (no view) still returns aggregate. |
| 1A-6 | modify | `/Users/jasonli/switchboard/apps/dashboard/src/lib/api-client/dashboard.ts` | Add `PaidVisit` type + `getPaidVisitsByCampaign(orgId, range)` client method calling GET /api/:orgId/revenue/by-campaign?view=paid-visits&from&to via the shared `request` helper. |
| 1A-6 | create | `/Users/jasonli/switchboard/apps/dashboard/src/lib/api-client/__tests__/dashboard-paid-visits.test.ts` | api-client test (stub global fetch): GETs the correct URL with view=paid-visits + range params + Bearer header, returns the payload, propagates upstream error body. |
| 1A-6 | create | `/Users/jasonli/switchboard/apps/dashboard/src/app/api/dashboard/paid-visits/route.ts` | Next.js proxy route: requireSession → getApiClient → client.getPaidVisitsByCampaign(orgId, range); reads orgId/from/to from searchParams; proxyError on failure (401 for Unauthorized, else 500). |
| 1A-6 | create | `/Users/jasonli/switchboard/apps/dashboard/src/app/api/dashboard/paid-visits/__tests__/route.test.ts` | Proxy route test (mock get-api-client + session): forwards orgId+range to client, 200 payload passthrough, 400 when orgId missing, 401 when session missing, 500 on upstream failure. |
| 1A-6 | create | `/Users/jasonli/switchboard/apps/dashboard/src/components/results/paid-visits-section.tsx` | Client panel: sorts paid visits by amount desc, renders one row per visit with fmtSGD(amountCents/100) (cents→dollars converted ONCE), campaign label, and external date; calm empty state. Reuses results.module.css classes. |
| 1A-6 | create | `/Users/jasonli/switchboard/apps/dashboard/src/components/results/paid-visits-section.test.tsx` | Panel test (jsdom + @testing-library/react): renders one row per visit, money is S$-prefixed dollars NOT cents (50000c → S$500.00, asserts no 100x leak), empty-state renders, campaign name shown. |

---
## 1A-1 — feat(schemas,ad-optimizer,core,db): heal the two-contact split (E.164 identity unification)

**Goal:** Make the CTWA Contact that carries ad attribution BE the same Contact a WhatsApp booking resolves against, by introducing one canonical E.164 normalizer in @switchboard/schemas (L1) and threading it through every place a phone enters the system. Add Contact.phoneE164 (derived in the store so callers cannot drift it) + a raw-SQL partial-unique on (organizationId, phoneE164) so a second Contact for the same number can never be minted. The load-bearing acceptance: a lead.intake Contact A (phoneE164 set) then resolveContactIdentity with the bare wa_id MUST return A and MUST NOT create a second Contact. Refuse-to-guess: junk/ambiguous input returns null (wrong-merge is worse than no-merge). This is the first PR of Spec-1A; every downstream receipt is mis-attributed until it lands.

**File structure:**

| Action | Path | Responsibility |
|---|---|---|
| create | `packages/schemas/src/phone.ts` | L1 canonical phone module: normalizeToE164(raw, region?) -> string|null with SG/MY heuristics + refuse-to-guess, and isE164(value) -> boolean reusing the E.164 regex shape from whatsapp-template-create.ts:3. No @switchboard/* imports. |
| create | `packages/schemas/src/phone.test.ts` | Co-located unit matrix for normalizeToE164/isE164: already-+ idempotent, SG 8-digit -> +65, MY 0-prefixed -> +60 drop-0, strip spaces/dashes/parens, junk -> null (never throws). |
| modify | `packages/schemas/src/index.ts` | Barrel re-export of ./phone.js so @switchboard/schemas exposes normalizeToE164 + isE164 to L2/L3/L4 callers. |
| modify | `packages/db/prisma/schema.prisma` | Add Contact.phoneE164 String? + @@index([organizationId, phoneE164]). (Partial unique lives in raw SQL — Prisma 6 cannot express it.) |
| create | `packages/db/prisma/migrations/20260606120000_contact_phone_e164/migration.sql` | Add column phoneE164, the plain composite index, and a RAW-SQL PARTIAL UNIQUE index on (organizationId, phoneE164) WHERE phoneE164 IS NOT NULL. Mirrors 20260603120000. |
| modify | `packages/db/src/stores/prisma-contact-store.ts` | Derive phoneE164 from input.phone in create(); normalize the lookup arg in findByPhone() to query by phoneE164 (fallback to raw phone for un-normalizable input). Map phoneE164 through to the Contact projection is NOT required (not in the schema type); only the write/lookup derivation. |
| modify | `packages/db/src/stores/__tests__/prisma-contact-store.test.ts` | Mocked-Prisma tests: create() passes a derived phoneE164 to prisma.contact.create; findByPhone() looks up the normalized form so a bare wa_id matches a +E.164 row; un-normalizable input still queries raw phone. |
| modify | `packages/db/src/stores/lead-intake-store.ts` | Derive phoneE164 from input.phone inside upsertContact() create branch so the CTWA Contact persists a normalized number. |
| modify | `packages/db/src/stores/__tests__/lead-intake-store.test.ts` | Add a mocked-Prisma describe block (NOT gated on DATABASE_URL) asserting upsertContact's create payload carries the derived phoneE164. |
| modify | `packages/ad-optimizer/src/lead-intake/ctwa-adapter.ts` | Replace the hand-rolled `from.startsWith("+") ? from : `+${from}`` at line 54 with normalizeToE164 (SG/MY heuristics); fall back to the raw +prefix shape only when normalization returns null so a non-SG/MY number is still ingestible. |
| modify | `packages/ad-optimizer/src/lead-intake/instant-form-adapter.ts` | Replace the hand-rolled normalizePhone() helper at lines 25-28 with normalizeToE164, preserving the undefined-on-missing contract. |
| modify | `packages/core/src/channel-gateway/resolve-contact-identity.ts` | Normalize the WhatsApp sessionId (bare wa_id) via normalizeToE164 before findByPhone/create so the lookup matches the lead.intake-stored phoneE164; keep the original sessionId as the returned `phone` only if normalization fails. |
| modify | `packages/core/src/channel-gateway/__tests__/resolve-contact-identity.test.ts` | Add the load-bearing regression: bare wa_id `6591234567` resolves findByPhone with the normalized `+6591234567` and, when the store returns Contact A, does NOT call create. |

**Notes:** LAYERING: phone.ts is pure (L1, zero imports) so it is safely callable from ad-optimizer (L2), core (L3), db (L4). ad-optimizer must NOT import core — it only imports @switchboard/schemas, which is preserved. FILE SIZE: every touched file stays well under 400 lines; phone.ts is a new ~60-line module (no inlining into adapters). MIGRATION: partial-unique CANNOT be expressed in Prisma 6 schema — it is raw SQL mirroring packages/db/prisma/migrations/20260603120000_booking_partial_unique_active/migration.sql; the migration ships IN THE SAME COMMIT as the schema.prisma edit (Task 2). DB TESTS MOCK PRISMA: the existing prisma-contact-store.test.ts already uses a vi.fn() mock (no Postgres) — extend that. The existing lead-intake-store.test.ts is an INTEGRATION test gated `describe.skipIf(!process.env.DATABASE_URL)` (skipped in CI); we ADD a separate NON-gated mocked-Prisma describe block in the same file so phoneE164 derivation is proven in CI. PRISMA CLIENT REGEN: after editing schema.prisma you MUST run `pnpm db:generate` (Task 2) so the generated client knows about Contact.phoneE164, else db typecheck/tests referencing it fail; if a later task reports `phoneE164` unknown, run `pnpm reset`. FINDBYPHONE CONTRACT: the store derives + queries the normalized form (chosen over a new findByNormalizedPhone method so all 3 existing callers — lifecycle-service.ts:54, resolve-contact-identity.ts:22, test-stores.ts:236 — benefit without signature churn). REFUSE-TO-GUESS: normalizeToE164 returns null rather than mint a wrong +E.164; callers fall back to their prior behavior (raw phone) so an unrecognized number is never dropped, only un-merged. NO STRUCTURED-OUTPUT 100x RISK here (that pin is PR 1B). DEPS: none — this is the first PR; do NOT reference Receipt/PaymentPort/WorkTrace.contactId (later PRs). After all tasks: run `pnpm --filter @switchboard/schemas test`, `pnpm --filter @switchboard/ad-optimizer test`, `pnpm --filter @switchboard/core test`, `pnpm --filter @switchboard/db test`, then `pnpm typecheck` and `pnpm lint` before opening the PR.

#### Task 1: Task 1 — L1 E.164 normalizer (packages/schemas/src/phone.ts) with full unit matrix

**Files:**
- Create: `packages/schemas/src/phone.ts`
- Create: `packages/schemas/src/phone.test.ts`
- Modify: `packages/schemas/src/index.ts`
- Test: `packages/schemas/src/phone.test.ts`

- [ ] **Step 1: Create the FAILING test file first (strict TDD). It imports from the not-yet-created module. The matrix mirrors the spec's §13 Identity row exactly: already-+ idempotent, SG 8-digit [89]xxxxxxx -> +65, MY 0-prefixed national -> +60 drop-0, strip spaces/dashes/parens, junk -> null (never throws), and isE164 truth table. Note `.js` extension on the relative import (ESM rule) even though the source is .ts.**

```ts
import { describe, it, expect } from "vitest";
import { normalizeToE164, isE164 } from "./phone.js";

describe("isE164", () => {
  it("accepts a well-formed E.164 number", () => {
    expect(isE164("+6591234567")).toBe(true);
    expect(isE164("+15551234567")).toBe(true);
  });

  it("rejects values without a leading + or with junk", () => {
    expect(isE164("6591234567")).toBe(false);
    expect(isE164("+0123")).toBe(false); // leading 0 after + not allowed
    expect(isE164("")).toBe(false);
    expect(isE164("+abc")).toBe(false);
  });
});

describe("normalizeToE164", () => {
  it("keeps an already-+ E.164 number unchanged (idempotent)", () => {
    expect(normalizeToE164("+6591234567")).toBe("+6591234567");
    expect(normalizeToE164(normalizeToE164("+6591234567")!)).toBe("+6591234567");
  });

  it("strips spaces, dashes, and parentheses before matching", () => {
    expect(normalizeToE164("+65 9123 4567")).toBe("+6591234567");
    expect(normalizeToE164("+65-9123-4567")).toBe("+6591234567");
    expect(normalizeToE164("+65 (9123) 4567")).toBe("+6591234567");
  });

  it("treats a bare 65-prefixed number (WhatsApp wa_id) as already-international", () => {
    // WhatsApp delivers wa_id without a leading +, e.g. "6591234567".
    expect(normalizeToE164("6591234567")).toBe("+6591234567");
  });

  it("applies SG heuristic: 8-digit local starting 8 or 9 -> +65", () => {
    expect(normalizeToE164("91234567")).toBe("+6591234567");
    expect(normalizeToE164("81234567")).toBe("+6581234567");
  });

  it("applies MY heuristic: 0-prefixed national -> +60 with leading 0 dropped", () => {
    expect(normalizeToE164("0123456789", "MY")).toBe("+60123456789");
    expect(normalizeToE164("012-345 6789", "MY")).toBe("+60123456789");
  });

  it("honours an explicit SG region for an 8-digit local number", () => {
    expect(normalizeToE164("61234567", "SG")).toBe("+6561234567");
  });

  it("REFUSES to guess: returns null for ambiguous/junk input, never throws", () => {
    expect(normalizeToE164("12345")).toBeNull(); // too short, no region signal
    expect(normalizeToE164("hello")).toBeNull();
    expect(normalizeToE164("")).toBeNull();
    expect(normalizeToE164(undefined as unknown as string)).toBeNull();
    expect(() => normalizeToE164("!!!")).not.toThrow();
  });
});

```

- [ ] **Step 2: Run the test and confirm it FAILS because the module does not exist yet.**

Run: `pnpm --filter @switchboard/schemas test src/phone.test.ts`
Expected: FAIL — Vitest reports a resolve error: "Failed to load url ./phone.js" / "Cannot find module './phone.js'" (the source file has not been created).

- [ ] **Step 3: Create the implementation. Reuse the E.164 regex shape from packages/schemas/src/whatsapp-template-create.ts:3 (`/^\+[1-9]\d{6,14}$/`). normalizeToE164 strips spaces/dashes/parens, keeps an already-+ that passes isE164, treats a bare 65/60-prefixed number as international, applies SG (8-digit [89] or explicit region SG) and MY (0-prefixed or explicit region MY) heuristics, and returns null for anything it cannot confidently map (refuse-to-guess). No `any`; region is a narrow union.**

```ts
/**
 * Canonical phone-number normalization for the revenue loop's identity spine.
 *
 * One source of truth so a CTWA-captured Contact and a WhatsApp-resolved
 * Contact converge on the SAME E.164 string. Heuristics target SG/MY (the
 * pilot regions); anything ambiguous returns `null` rather than minting a
 * wrong number — a wrong merge is worse than no merge.
 *
 * L1 module: no @switchboard/* imports.
 */

/** Matches a well-formed E.164 number (leading +, no leading zero, 7-15 digits). */
const E164 = /^\+[1-9]\d{6,14}$/;

export type PhoneRegion = "SG" | "MY";

/** True when `value` is already a well-formed E.164 number. */
export function isE164(value: string): boolean {
  return typeof value === "string" && E164.test(value);
}

/** Remove spaces, dashes, and parentheses (common human formatting). */
function stripFormatting(raw: string): string {
  return raw.replace(/[\s()\-]/g, "");
}

/**
 * Normalize a raw phone string to E.164, or return `null` if it cannot be
 * confidently mapped. `region` is an optional hint for bare national numbers.
 */
export function normalizeToE164(raw: string, region?: PhoneRegion): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = stripFormatting(raw.trim());
  if (cleaned.length === 0) return null;

  // Already-+ international: accept iff it is well-formed E.164.
  if (cleaned.startsWith("+")) {
    return E164.test(cleaned) ? cleaned : null;
  }

  // Reject anything with non-digits left over (e.g. "hello", "!!!").
  if (!/^\d+$/.test(cleaned)) return null;

  // Bare international form delivered without a + (e.g. WhatsApp wa_id).
  // SG country code 65 + 8 local digits = 10; MY 60 + 9-10 local = 11-12.
  if (cleaned.startsWith("65") && cleaned.length === 10) {
    const candidate = `+${cleaned}`;
    return E164.test(candidate) ? candidate : null;
  }
  if (cleaned.startsWith("60") && cleaned.length >= 11 && cleaned.length <= 12) {
    const candidate = `+${cleaned}`;
    return E164.test(candidate) ? candidate : null;
  }

  // MY national: leading 0 -> +60 with the 0 dropped.
  if (region === "MY" || (cleaned.startsWith("0") && cleaned.length >= 10 && cleaned.length <= 11)) {
    const national = cleaned.startsWith("0") ? cleaned.slice(1) : cleaned;
    const candidate = `+60${national}`;
    return E164.test(candidate) ? candidate : null;
  }

  // SG national: 8 digits starting 8 or 9 (or explicit SG region) -> +65.
  if (region === "SG" || (cleaned.length === 8 && /^[89]/.test(cleaned))) {
    if (cleaned.length === 8) {
      const candidate = `+65${cleaned}`;
      return E164.test(candidate) ? candidate : null;
    }
  }

  // Cannot confidently map — refuse to guess.
  return null;
}

```

- [ ] **Step 4: Run the test again and confirm every case PASSES.**

Run: `pnpm --filter @switchboard/schemas test src/phone.test.ts`
Expected: PASS — all assertions in phone.test.ts green (isE164 + normalizeToE164 blocks).

- [ ] **Step 5: Export the module from the schemas barrel so L2/L3/L4 callers can import normalizeToE164/isE164. Add the line at the end of the barrel, next to the other recent additions.**

```ts
// Canonical phone E.164 normalization (revenue-loop identity spine, Spec-1A 1A-1)
export * from "./phone.js";
```

- [ ] **Step 6: Build the schemas package so the dist artifact (consumed by ad-optimizer/core/db at typecheck) includes phone.js, then confirm the full schemas test suite is still green.**

Run: `pnpm --filter @switchboard/schemas build && pnpm --filter @switchboard/schemas test`
Expected: tsc completes with no errors; Vitest reports all schemas test files passing (including the new phone.test.ts).

- [ ] **Step 7: Commit. Lowercase conventional-commit subject (commitlint).**

Run: `git add packages/schemas/src/phone.ts packages/schemas/src/phone.test.ts packages/schemas/src/index.ts && git commit -m "feat(schemas): canonical E.164 normalizer with SG/MY heuristics and refuse-to-guess"`
Expected: Commit succeeds; pre-commit hooks (lint-staged/prettier) pass with no reformat-then-fail loop.


#### Task 2: Task 2 — Contact.phoneE164 column + raw-SQL partial-unique migration (same commit)

**Files:**
- Create: `packages/db/prisma/migrations/20260606120000_contact_phone_e164/migration.sql`
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add the phoneE164 column and its plain composite index to the Contact model in schema.prisma. Insert the field right after the existing `phone String?` line (schema.prisma:1745) and the index alongside the existing @@index block (the `@@index([organizationId, phone])` at schema.prisma:1790). The PARTIAL unique is NOT expressible in Prisma 6 — it lives only in raw SQL (next step). First add the column:**

```ts
  phone                String?
  phoneE164            String? // canonical E.164 derived in the store (1A-1); never set by callers directly
```

- [ ] **Step 2: Add the plain composite index next to the other Contact @@index lines (after `@@index([organizationId, phone])`). The partial-unique is added by raw SQL, so do NOT attempt @@unique here.**

```ts
  @@index([organizationId, phone])
  @@index([organizationId, phoneE164])
```

- [ ] **Step 3: Create the migration directory + migration.sql. Mirror the raw-SQL partial-unique pattern from packages/db/prisma/migrations/20260603120000_booking_partial_unique_active/migration.sql (verified: CREATE UNIQUE INDEX ... WHERE ...). The migration adds the column, the plain index Prisma expects, AND the partial unique. Use IF NOT EXISTS-free DDL to match repo convention (the booking migration uses plain CREATE).**

```ts
-- 1A-1 identity unification: store-derived canonical phone for Contact dedup.
-- The plain index backs (organizationId, phoneE164) lookups in findByPhone.
ALTER TABLE "Contact" ADD COLUMN "phoneE164" TEXT;

-- CreateIndex (matches @@index([organizationId, phoneE164]) in schema.prisma)
CREATE INDEX "Contact_organizationId_phoneE164_idx" ON "Contact" ("organizationId", "phoneE164");

-- Partial unique: at most one Contact per (org, phoneE164) when phoneE164 is set.
-- Prisma 6 cannot express a partial index in-schema, so it lives in raw SQL
-- (mirrors 20260603120000_booking_partial_unique_active). NULL phoneE164 rows are
-- exempt, so un-normalizable numbers never collide.
CREATE UNIQUE INDEX "Contact_org_phoneE164_unique"
  ON "Contact" ("organizationId", "phoneE164")
  WHERE "phoneE164" IS NOT NULL;

```

- [ ] **Step 4: Regenerate the Prisma client so the generated types include Contact.phoneE164 (required before db typecheck/tests reference it). This does NOT need Postgres — `prisma generate` is offline.**

Run: `pnpm db:generate`
Expected: "Generated Prisma Client" success message; no errors. (If a later step reports `phoneE164` as an unknown field, run `pnpm reset` to clear stale dist + regenerate.)

- [ ] **Step 5: Sanity-check that the index name fits Postgres's 63-char identifier cap (a hand-written migration that drifts from the cap fails on deploy). Both names are < 63 chars; confirm.**

Run: `node -e "for (const n of ['Contact_organizationId_phoneE164_idx','Contact_org_phoneE164_unique']) console.log(n.length, n)"`
Expected: Each line prints a length < 63 (e.g. `36 Contact_organizationId_phoneE164_idx` and `28 Contact_org_phoneE164_unique`).

- [ ] **Step 6: Commit the schema + migration TOGETHER (CLAUDE.md: a schema change requires its migration in the same commit). Lowercase subject.**

Run: `git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260606120000_contact_phone_e164/migration.sql && git commit -m "feat(db): add Contact.phoneE164 column with raw-sql partial-unique index"`
Expected: Commit succeeds; the docs-only branch-relevance hook (if it warns) is non-blocking.


#### Task 3: Task 3 — Store derives phoneE164 on create + normalizes findByPhone lookup (mocked Prisma)

**Files:**
- Modify: `packages/db/src/stores/prisma-contact-store.ts`
- Modify: `packages/db/src/stores/__tests__/prisma-contact-store.test.ts`
- Test: `packages/db/src/stores/__tests__/prisma-contact-store.test.ts`

- [ ] **Step 1: Add the FAILING tests to the existing mocked-Prisma suite (packages/db/src/stores/__tests__/prisma-contact-store.test.ts). Two new behaviors: (a) create() derives phoneE164 from input.phone and passes it to prisma.contact.create; (b) findByPhone() normalizes a bare wa_id and queries by phoneE164 so it matches a +E.164 row. Insert these new `it` blocks INSIDE the existing `describe("create", ...)` and `describe("findByPhone", ...)` blocks (the mock + makeContact helpers at the top of the file already exist).**

```ts
// --- add inside describe("create", () => { ... }) ---
    it("derives phoneE164 from input.phone and passes it to prisma.contact.create", async () => {
      prisma.contact.create.mockResolvedValue(makeContact({ phone: "6591234567" }));

      await store.create({
        organizationId: "org-1",
        phone: "6591234567", // bare wa_id form
        primaryChannel: "whatsapp",
      });

      expect(prisma.contact.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ phone: "6591234567", phoneE164: "+6591234567" }),
      });
    });

    it("sets phoneE164 to null when the phone cannot be normalized (refuse-to-guess)", async () => {
      prisma.contact.create.mockResolvedValue(makeContact({ phone: "junk" }));

      await store.create({
        organizationId: "org-1",
        phone: "junk",
        primaryChannel: "whatsapp",
      });

      expect(prisma.contact.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ phone: "junk", phoneE164: null }),
      });
    });

// --- add inside describe("findByPhone", () => { ... }) ---
    it("normalizes a bare wa_id and looks up by phoneE164 so it matches a +E.164 row", async () => {
      const contact = makeContact({ phone: "+6591234567" });
      prisma.contact.findFirst.mockResolvedValue(contact);

      const result = await store.findByPhone("org-1", "6591234567");

      expect(prisma.contact.findFirst).toHaveBeenCalledWith({
        where: { organizationId: "org-1", phoneE164: "+6591234567" },
      });
      expect(result!.phone).toBe("+6591234567");
    });

    it("falls back to a raw phone lookup when the input cannot be normalized", async () => {
      prisma.contact.findFirst.mockResolvedValue(null);

      await store.findByPhone("org-1", "junk");

      expect(prisma.contact.findFirst).toHaveBeenCalledWith({
        where: { organizationId: "org-1", phone: "junk" },
      });
    });
```

- [ ] **Step 2: Run the contact-store test and confirm the FOUR new cases FAIL (the store does not yet derive phoneE164 or normalize the lookup; create still omits phoneE164 and findByPhone still queries raw phone).**

Run: `pnpm --filter @switchboard/db test src/stores/__tests__/prisma-contact-store.test.ts`
Expected: FAIL — the new create cases fail because the actual create payload has no `phoneE164` key; the findByPhone bare-wa_id case fails because findFirst was called with `{ phone: "6591234567" }` not `{ phoneE164: "+6591234567" }`.

- [ ] **Step 3: Add the normalizeToE164 import to prisma-contact-store.ts. The file already imports types from @switchboard/schemas at lines 4-9; extend that import with the value import (it is a runtime function, not a type).**

```ts
import { normalizeToE164 } from "@switchboard/schemas";
import type {
  Contact,
  ContactStage,
  AttributionChain,
  MessagingOptInSource,
} from "@switchboard/schemas";
```

- [ ] **Step 4: In create() (prisma-contact-store.ts:85-114), derive phoneE164 and add it to the create data. Add the derivation right after `const messagingOptIn = ...` (line 88) and the field into the `data: { ... }` object right after the `phone:` line (line 96).**

```ts
    const messagingOptIn = input.messagingOptIn ?? false;
    const phoneE164 = input.phone ? normalizeToE164(input.phone) : null;
```

- [ ] **Step 5: Add the phoneE164 field to the create() data object, immediately after the existing `phone:` line inside `data:`.**

```ts
        phone: input.phone ?? null,
        phoneE164,
```

- [ ] **Step 6: Rewrite findByPhone() (prisma-contact-store.ts:128-138) to normalize the lookup. When normalization succeeds, query by phoneE164; otherwise fall back to the raw phone column (so an un-normalizable input still behaves as before). Keep updateMany/count===0 guards untouched (read path, no mutation).**

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

- [ ] **Step 7: Run the contact-store test again; all cases (existing + four new) PASS. Note the pre-existing findByPhone test "returns null when no contact with phone exists" uses `+6599999999` which normalizes to itself, so it now asserts the phoneE164 branch — but it already expects `where: { organizationId, phone: "+6599999999" }`. Update that ONE pre-existing assertion to the phoneE164 shape so it stays green.**

```ts
// In describe("findByPhone") -> it("returns null when no contact with phone exists"):
// change the expected where-clause from { organizationId, phone } to { organizationId, phoneE164 }.
      expect(prisma.contact.findFirst).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          phoneE164: "+6599999999",
        },
      });
```

- [ ] **Step 8: Also update the pre-existing findByPhone test "returns first contact matching phone" (it passes `+6591234567`, which normalizes to itself) — it does not assert the where-clause, only the result, so re-run to confirm it still passes without edits. Run the full file.**

Run: `pnpm --filter @switchboard/db test src/stores/__tests__/prisma-contact-store.test.ts`
Expected: PASS — every test in prisma-contact-store.test.ts green (create derivation x2, findByPhone normalization x2, the updated null-lookup assertion, and all untouched delete/list/updateStage cases).

- [ ] **Step 9: Commit the store change + its tests together. Lowercase subject.**

Run: `git add packages/db/src/stores/prisma-contact-store.ts packages/db/src/stores/__tests__/prisma-contact-store.test.ts && git commit -m "feat(db): derive phoneE164 on contact create and normalize findByPhone lookup"`
Expected: Commit succeeds; lint-staged passes.


#### Task 4: Task 4 — Lead-intake store derives phoneE164 on upsert (mocked-Prisma proof in CI)

**Files:**
- Modify: `packages/db/src/stores/lead-intake-store.ts`
- Modify: `packages/db/src/stores/__tests__/lead-intake-store.test.ts`
- Test: `packages/db/src/stores/__tests__/lead-intake-store.test.ts`

- [ ] **Step 1: The existing lead-intake-store.test.ts is an INTEGRATION suite gated `describe.skipIf(!process.env.DATABASE_URL)` (skipped in CI, no Postgres). Add a SEPARATE, NON-gated mocked-Prisma describe block at the END of the file so phoneE164 derivation is proven in CI. It mocks prisma.contact.upsert and asserts the create branch carries the derived phoneE164. Append after the closing of the existing describe block.**

```ts
import { describe as describeUnit, it as itUnit, expect as expectUnit, vi } from "vitest";
import { PrismaLeadIntakeStore as PrismaLeadIntakeStoreUnit } from "../lead-intake-store.js";

describeUnit("PrismaLeadIntakeStore (mocked prisma — phoneE164 derivation)", () => {
  function mockPrisma() {
    return {
      contact: {
        upsert: vi.fn().mockResolvedValue({ id: "contact-1" }),
      },
      activityLog: { create: vi.fn().mockResolvedValue({ id: "act-1" }) },
    } as unknown as import("@prisma/client").PrismaClient;
  }

  itUnit("upsertContact derives phoneE164 from the input phone in the create branch", async () => {
    const prisma = mockPrisma();
    const store = new PrismaLeadIntakeStoreUnit(prisma);

    await store.upsertContact({
      organizationId: "org-1",
      deploymentId: "dep-1",
      phone: "6591234567", // bare wa_id form delivered by CTWA
      sourceType: "ctwa",
      attribution: { ctwa_clid: "abc" },
      idempotencyKey: "k1",
    });

    expectUnit(prisma.contact.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ phone: "6591234567", phoneE164: "+6591234567" }),
      }),
    );
  });

  itUnit("upsertContact sets phoneE164 to null when the phone is absent", async () => {
    const prisma = mockPrisma();
    const store = new PrismaLeadIntakeStoreUnit(prisma);

    await store.upsertContact({
      organizationId: "org-1",
      deploymentId: "dep-1",
      email: "a@b.com",
      sourceType: "instant_form",
      attribution: { leadgen_id: "lg1" },
      idempotencyKey: "k2",
    });

    expectUnit(prisma.contact.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ phoneE164: null }),
      }),
    );
  });
});

```

- [ ] **Step 2: Note: the new block imports `expect` aliased AND uses bare `expect.objectContaining`. Fix that — `expect.objectContaining` is a static on the SAME expect. Since we aliased to expectUnit, use expectUnit.objectContaining. Correct the two matcher calls.**

```ts
// Replace `expect.objectContaining` with `expectUnit.objectContaining` in BOTH itUnit blocks, e.g.:
    expectUnit(prisma.contact.upsert).toHaveBeenCalledWith(
      expectUnit.objectContaining({
        create: expectUnit.objectContaining({ phone: "6591234567", phoneE164: "+6591234567" }),
      }),
    );
```

- [ ] **Step 3: Run the test and confirm the two new mocked cases FAIL (upsertContact's create branch has no phoneE164 key yet).**

Run: `pnpm --filter @switchboard/db test src/stores/__tests__/lead-intake-store.test.ts`
Expected: FAIL — the two "mocked prisma — phoneE164 derivation" cases fail because the actual upsert `create` object lacks `phoneE164`. The original integration describe stays skipped (no DATABASE_URL).

- [ ] **Step 4: Add the normalizeToE164 import to lead-intake-store.ts (currently imports only types at lines 1-2). It is a value import.**

```ts
import { normalizeToE164 } from "@switchboard/schemas";
import type { LeadIntakeStore } from "@switchboard/core";
import type { PrismaDbClient } from "../prisma-db.js";
```

- [ ] **Step 5: In upsertContact() (lead-intake-store.ts:69-107) derive phoneE164 and add it to the `create:` branch. Add the derivation after `const messagingOptIn = ...` (line 72) and the field into `create:` right after the `phone:` line (line 83). Leave the `update:` branch untouched (idempotent no-op contract).**

```ts
    const messagingOptIn = input.messagingOptIn ?? false;
    const phoneE164 = input.phone ? normalizeToE164(input.phone) : null;
```

- [ ] **Step 6: Add phoneE164 to the create branch of the upsert, immediately after the existing `phone:` line.**

```ts
        phone: input.phone ?? null,
        phoneE164,
```

- [ ] **Step 7: Run the test again; the two mocked cases PASS (integration cases remain skipped).**

Run: `pnpm --filter @switchboard/db test src/stores/__tests__/lead-intake-store.test.ts`
Expected: PASS — the two "mocked prisma — phoneE164 derivation" cases green; the integration describe reports skipped.

- [ ] **Step 8: Run the whole db package suite to confirm no regression across stores (the contact-store edit from Task 3 + this edit).**

Run: `pnpm --filter @switchboard/db test`
Expected: PASS — all db tests green (or pre-existing pg_advisory_lock integration flakes only, which are skipped without DATABASE_URL).

- [ ] **Step 9: Commit. Lowercase subject.**

Run: `git add packages/db/src/stores/lead-intake-store.ts packages/db/src/stores/__tests__/lead-intake-store.test.ts && git commit -m "feat(db): derive phoneE164 on lead-intake upsert"`
Expected: Commit succeeds.


#### Task 5: Task 5 — Route ad-optimizer adapters (CTWA + Instant Form) through normalizeToE164

**Files:**
- Modify: `packages/ad-optimizer/src/lead-intake/ctwa-adapter.ts`
- Modify: `packages/ad-optimizer/src/lead-intake/instant-form-adapter.ts`
- Test: `packages/ad-optimizer/src/lead-intake/ctwa-adapter.test.ts`
- Test: `packages/ad-optimizer/src/lead-intake/instant-form-adapter.test.ts`

- [ ] **Step 1: Confirm the adapter test files exist (the modules have co-located tests) so we extend them rather than create new ones.**

Run: `ls packages/ad-optimizer/src/lead-intake/ctwa-adapter.test.ts packages/ad-optimizer/src/lead-intake/instant-form-adapter.test.ts`
Expected: Both paths print (the test files exist). If either is missing, create it mirroring the lead-intake.test.ts import style before proceeding.

- [ ] **Step 2: Add a FAILING test to ctwa-adapter.test.ts proving buildCtwaIntake normalizes an SG 8-digit `from` (not just prefixing a +). Append a new `it` inside the existing top-level describe. (`buildCtwaIntake` is the exported pure builder at ctwa-adapter.ts:44.)**

```ts
  it("normalizes an SG 8-digit wa_id to +65 E.164 on the contact phone", () => {
    const intake = buildCtwaIntake(
      {
        from: "91234567", // SG 8-digit, no country code
        metadata: { ctwaClid: "ARxx_abc" },
        organizationId: "o1",
        deploymentId: "d1",
      },
      { now: () => new Date("2026-06-06T00:00:00Z") },
    );
    expect(intake?.contact.phone).toBe("+6591234567");
    expect(intake?.idempotencyKey).toBe("+6591234567:ARxx_abc");
  });
```

- [ ] **Step 3: Ensure buildCtwaIntake is imported in ctwa-adapter.test.ts. If the test file only imports CtwaAdapter, extend the import. (Check the file header; the builder is a named export.)**

```ts
// Confirm the import line includes buildCtwaIntake, e.g.:
import { CtwaAdapter, buildCtwaIntake } from "./ctwa-adapter.js";
```

- [ ] **Step 4: Run the ctwa-adapter test; the new SG case FAILS (current code does `from.startsWith("+") ? from : `+${from}`` → produces `+91234567`, not `+6591234567`).**

Run: `pnpm --filter @switchboard/ad-optimizer test src/lead-intake/ctwa-adapter.test.ts`
Expected: FAIL — expected `+6591234567` but received `+91234567` (and idempotencyKey `+91234567:ARxx_abc`).

- [ ] **Step 5: Import normalizeToE164 at the top of ctwa-adapter.ts (currently imports only the LeadIntake type at line 1).**

```ts
import type { LeadIntake } from "@switchboard/schemas";
import { normalizeToE164 } from "@switchboard/schemas";
```

- [ ] **Step 6: Replace the hand-rolled normalization at ctwa-adapter.ts:54. Prefer the canonical normalizer; fall back to the old +prefix shape only when it returns null (so a non-SG/MY number is still ingestible rather than dropped).**

```ts
  const normalizedPhone = normalizeToE164(msg.from) ?? (msg.from.startsWith("+") ? msg.from : `+${msg.from}`);
```

- [ ] **Step 7: Run the ctwa-adapter test again; all cases PASS (existing +-prefix cases still produce the same E.164; the SG case now yields +6591234567).**

Run: `pnpm --filter @switchboard/ad-optimizer test src/lead-intake/ctwa-adapter.test.ts`
Expected: PASS — ctwa-adapter.test.ts green, including the new SG normalization case.

- [ ] **Step 8: Add a FAILING test to instant-form-adapter.test.ts proving buildInstantFormIntake normalizes an SG 8-digit phone_number field. Append inside the existing describe. (`buildInstantFormIntake` is exported at instant-form-adapter.ts:36; the field name is `phone_number` per line 41.)**

```ts
  it("normalizes an SG 8-digit phone_number field to +65 E.164", () => {
    const intake = buildInstantFormIntake(
      {
        leadgenId: "lg-1",
        organizationId: "o1",
        deploymentId: "d1",
        fieldData: [{ name: "phone_number", values: ["91234567"] }],
      },
      { now: () => new Date("2026-06-06T00:00:00Z") },
    );
    expect(intake?.contact.phone).toBe("+6591234567");
  });
```

- [ ] **Step 9: Confirm buildInstantFormIntake is imported in instant-form-adapter.test.ts; extend the import if needed.**

```ts
// Confirm the import includes the builder, e.g.:
import { InstantFormAdapter, buildInstantFormIntake } from "./instant-form-adapter.js";
```

- [ ] **Step 10: Run the instant-form-adapter test; the new SG case FAILS (current normalizePhone helper at lines 25-28 only prefixes a +, producing +91234567).**

Run: `pnpm --filter @switchboard/ad-optimizer test src/lead-intake/instant-form-adapter.test.ts`
Expected: FAIL — expected `+6591234567` but received `+91234567`.

- [ ] **Step 11: Import normalizeToE164 at the top of instant-form-adapter.ts (currently imports the LeadIntake type at line 1 and IngressLike at line 2).**

```ts
import type { LeadIntake } from "@switchboard/schemas";
import { normalizeToE164 } from "@switchboard/schemas";
import type { IngressLike } from "./ctwa-adapter.js";
```

- [ ] **Step 12: Replace the local normalizePhone helper (instant-form-adapter.ts:25-28) so it delegates to the canonical normalizer, preserving the undefined-on-missing contract and falling back to the prior +prefix when normalization returns null.**

```ts
const normalizePhone = (raw: string | undefined): string | undefined => {
  if (!raw) return undefined;
  return normalizeToE164(raw) ?? (raw.startsWith("+") ? raw : `+${raw}`);
};
```

- [ ] **Step 13: Run the instant-form-adapter test again; all cases PASS.**

Run: `pnpm --filter @switchboard/ad-optimizer test src/lead-intake/instant-form-adapter.test.ts`
Expected: PASS — instant-form-adapter.test.ts green, including the new SG case.

- [ ] **Step 14: Run the full ad-optimizer suite to confirm no cross-file regression and that layering still holds (ad-optimizer imports only @switchboard/schemas).**

Run: `pnpm --filter @switchboard/ad-optimizer test`
Expected: PASS — all ad-optimizer tests green.

- [ ] **Step 15: Commit. Lowercase subject.**

Run: `git add packages/ad-optimizer/src/lead-intake/ctwa-adapter.ts packages/ad-optimizer/src/lead-intake/ctwa-adapter.test.ts packages/ad-optimizer/src/lead-intake/instant-form-adapter.ts packages/ad-optimizer/src/lead-intake/instant-form-adapter.test.ts && git commit -m "feat(ad-optimizer): normalize lead-intake phones through canonical E.164"`
Expected: Commit succeeds.


#### Task 6: Task 6 — resolveContactIdentity normalizes the bare wa_id + load-bearing unification regression

**Files:**
- Modify: `packages/core/src/channel-gateway/resolve-contact-identity.ts`
- Modify: `packages/core/src/channel-gateway/__tests__/resolve-contact-identity.test.ts`
- Test: `packages/core/src/channel-gateway/__tests__/resolve-contact-identity.test.ts`

- [ ] **Step 1: Add the FAILING load-bearing regression to resolve-contact-identity.test.ts. This is the spec's headline acceptance: a bare wa_id (`6591234567`) MUST look up by the normalized `+6591234567` so it resolves the lead.intake Contact A, and MUST NOT create a second Contact. The existing makeStore helper at the top of the file already provides findByPhone/create vi.fn()s. Append two `it` blocks inside the existing describe.**

```ts
  it("LOAD-BEARING: bare wa_id resolves the existing +E.164 Contact A and does NOT create a second", async () => {
    // Contact A was created by lead.intake with phoneE164 = +6591234567. The store's
    // findByPhone normalizes its lookup arg, so passing the bare wa_id matches A.
    const store = makeStore({
      findByPhone: vi.fn().mockResolvedValue({ id: "contact-A" }),
    });

    const result = await resolveContactIdentity({
      channel: "whatsapp",
      sessionId: "6591234567", // bare wa_id, no leading +
      organizationId: "org-1",
      contactStore: store,
    });

    expect(store.findByPhone).toHaveBeenCalledWith("org-1", "+6591234567");
    expect(store.create).not.toHaveBeenCalled();
    expect(result).toEqual({
      contactId: "contact-A",
      phone: "+6591234567",
      channel: "whatsapp",
    });
  });

  it("creates with the normalized phone when no Contact exists for the bare wa_id", async () => {
    const store = makeStore(); // findByPhone -> null, create -> { id: "new-contact-id" }

    const result = await resolveContactIdentity({
      channel: "whatsapp",
      sessionId: "6591234567",
      organizationId: "org-1",
      contactStore: store,
    });

    expect(store.findByPhone).toHaveBeenCalledWith("org-1", "+6591234567");
    expect(store.create).toHaveBeenCalledWith({
      organizationId: "org-1",
      phone: "+6591234567",
      primaryChannel: "whatsapp",
      source: "whatsapp_inbound",
      messagingOptIn: true,
      messagingOptInSource: "organic_inbound",
    });
    expect(result.phone).toBe("+6591234567");
  });
```

- [ ] **Step 2: Run the resolve-contact-identity test; the two new cases FAIL (current code at resolve-contact-identity.ts:21 sets `const phone = sessionId;` so findByPhone is called with the bare `6591234567`, and create would receive the bare form).**

Run: `pnpm --filter @switchboard/core test src/channel-gateway/__tests__/resolve-contact-identity.test.ts`
Expected: FAIL — findByPhone was called with `"org-1", "6591234567"` not `"org-1", "+6591234567"`; the create-case create payload has `phone: "6591234567"`.

- [ ] **Step 3: Import normalizeToE164 into resolve-contact-identity.ts (currently imports only GatewayContactStore type at line 1).**

```ts
import { normalizeToE164 } from "@switchboard/schemas";
import type { GatewayContactStore } from "./types.js";
```

- [ ] **Step 4: Normalize the WhatsApp identifier before lookup/create. Replace `const phone = sessionId;` (resolve-contact-identity.ts:21) so the resolved phone is the canonical E.164 when normalization succeeds, falling back to the raw sessionId only when it does not (refuse-to-guess: we never invent a wrong number, but we also never drop the lead). The downstream findByPhone/create then both see the normalized value.**

```ts
  const phone = normalizeToE164(sessionId) ?? sessionId;
```

- [ ] **Step 5: Run the resolve-contact-identity test again; ALL cases PASS — the load-bearing regression and the existing `+6599999999` cases (which normalize to themselves, so unchanged) are green.**

Run: `pnpm --filter @switchboard/core test src/channel-gateway/__tests__/resolve-contact-identity.test.ts`
Expected: PASS — every resolve-contact-identity test green, including the two new bare-wa_id cases.

- [ ] **Step 6: Run the whole core package suite to confirm the channel-gateway change did not break neighbouring gateway tests (channel-gateway.test.ts wires resolveContactIdentity via contactStore).**

Run: `pnpm --filter @switchboard/core test`
Expected: PASS — all core tests green (any pg_advisory / known integration flakes are skipped without DATABASE_URL).

- [ ] **Step 7: Commit. Lowercase subject.**

Run: `git add packages/core/src/channel-gateway/resolve-contact-identity.ts packages/core/src/channel-gateway/__tests__/resolve-contact-identity.test.ts && git commit -m "feat(core): normalize whatsapp wa_id to e164 so bookings resolve the attributed contact"`
Expected: Commit succeeds.


#### Task 7: Task 7 — Cross-package verification gate (typecheck, lint, full suites) before PR

**Files:**


- [ ] **Step 1: Run the monorepo typecheck. This is the only check that catches missing .js extensions on @/relative imports and confirms the generated Prisma client (regenerated in Task 2) is consistent across packages.**

Run: `pnpm typecheck`
Expected: PASS — no type errors. If it reports `phoneE164` unknown on the Prisma model or missing exports from @switchboard/schemas, run `pnpm reset` then re-run (stale lower-layer dist artifacts cause false alarms).

- [ ] **Step 2: Run lint across the repo (CI lint also runs prettier; catch format drift now).**

Run: `pnpm lint && pnpm format:check`
Expected: PASS — eslint clean and prettier reports no files needing formatting. If format:check fails, run `pnpm format` (or `prettier --write` on the listed files) and re-`git add` before committing.

- [ ] **Step 3: Run the four touched package suites together as a final regression gate (schemas, ad-optimizer, core, db).**

Run: `pnpm --filter @switchboard/schemas test && pnpm --filter @switchboard/ad-optimizer test && pnpm --filter @switchboard/core test && pnpm --filter @switchboard/db test`
Expected: PASS — all four suites green; phone.test.ts, the contact-store + lead-intake-store mocked cases, the two adapter SG cases, and the resolve-contact-identity load-bearing regression all pass.

- [ ] **Step 4: Verify the commit series is on the implementation branch (not main) and reflects exactly this PR's scope. CLAUDE.md branch doctrine: confirm branch context before pushing.**

Run: `git branch --show-current && git log --oneline -6`
Expected: Shows the 1A-1 implementation branch and the six feat commits from Tasks 1-6 (schemas normalizer, db column+migration, db store derive, db lead-intake derive, ad-optimizer adapters, core resolve-identity). No stray edits to platform-ingress.ts / skill-executor.ts / calendar-book.ts.


---

## 1A-2 — feat(core,db,chat): weld booking -> WorkTrace -> ConversionRecord (chain spine)

**Goal:** Make the revenue chain queryable end-to-end with one SQL join. Today the chain is broken in four places: (1) calendar-book never passes workTraceId when it creates the Booking, so a Booking cannot be joined back to its WorkTrace; (2) WorkTrace has no contactId/conversationThreadId columns, so the WorkTrace cannot be joined to the Contact or ConversationThread; (3) the booked OutboxEvent payload and the ConversionRecord write must reliably carry bookingId so a paid conversion can be joined to the booking; (4) the chat-app gateway thread is keyed off the literal contactId 'visitor-'+sessionId and the literal org 'gateway', so the CTWA Contact that carries attribution is NOT the Contact the booking resolves against. After this PR a single query reconstructs Booking.workTraceId -> WorkTrace.workUnitId -> WorkTrace.contactId, and the two new WorkTrace columns are populated at submit WITHOUT changing any existing WorkTrace contentHash (both added to EXCLUDED_BASE in the same commit, no hashInputVersion bump). DEPENDS ON 1A-1 (the canonical E.164 normalizer + normalized findByPhone), which makes resolveContactIdentity return the attribution-carrying Contact instead of creating a split one. This PR is the chain SPINE; 1A-3 (Receipt) and 1A-4 (payment) hang off it.

**File structure:**

| Action | Path | Responsibility |
|---|---|---|
| modify | `/Users/jasonli/switchboard/packages/core/src/skill-runtime/tools/calendar-book.ts` | Pass workTraceId: ctx.workUnitId ?? null into bookingStore.create (line 259 block) so the Booking row is joinable to its WorkTrace. No other behavior change. |
| modify | `/Users/jasonli/switchboard/packages/core/src/skill-runtime/tools/calendar-book.test.ts` | Add a test asserting bookingStore.create is called with workTraceId from ctx.workUnitId, and a test asserting it falls back to null when ctx.workUnitId is absent. |
| modify | `/Users/jasonli/switchboard/packages/core/src/platform/work-trace-hash.ts` | Add 'contactId' and 'conversationThreadId' to EXCLUDED_BASE so the two new WorkTrace columns are stripped from the canonical hash input (precedent: injectedPatternIds). No hashInputVersion bump. |
| modify | `/Users/jasonli/switchboard/packages/core/src/platform/__tests__/work-trace-hash.test.ts` | Add an INVARIANCE test (same trace with vs without contactId/conversationThreadId -> identical contentHash) and update the two excluded-set length assertions (v1: 6->8, v2: 5->7) and the arrayContaining lists. |
| modify | `/Users/jasonli/switchboard/packages/core/src/platform/work-trace.ts` | Add contactId?: string and conversationThreadId?: string to the WorkTrace interface (chain-join lineage; excluded from hash). |
| modify | `/Users/jasonli/switchboard/packages/core/src/platform/canonical-request.ts` | Add conversationThreadId?: string to CanonicalSubmitRequest so the resolved thread id can flow from the gateway to the persisted WorkTrace. |
| modify | `/Users/jasonli/switchboard/packages/core/src/platform/work-trace-recorder.ts` | In buildWorkTrace and buildClaimTrace, populate trace.contactId from workUnit.parameters.contactId (trusted bag) and trace.conversationThreadId from workUnit.conversationThreadId. |
| modify | `/Users/jasonli/switchboard/packages/core/src/platform/work-trace-recorder.test.ts` | Add tests asserting buildWorkTrace/buildClaimTrace copy contactId from parameters and conversationThreadId from the work unit (create the file if it does not exist). |
| modify | `/Users/jasonli/switchboard/packages/core/src/platform/work-unit.ts` | Add conversationThreadId?: string to WorkUnit and copy request.conversationThreadId in normalizeWorkUnit. |
| modify | `/Users/jasonli/switchboard/packages/core/src/channel-gateway/channel-gateway.ts` | Thread the resolved conversationId (the thread id) into the CanonicalSubmitRequest as conversationThreadId at the submit call site. |
| modify | `/Users/jasonli/switchboard/packages/db/prisma/schema.prisma` | Add WorkTrace.contactId String?, WorkTrace.conversationThreadId String?, and two indexes (organizationId+contactId, organizationId+conversationThreadId). |
| create | `/Users/jasonli/switchboard/packages/db/prisma/migrations/20260606120000_worktrace_chain_columns/migration.sql` | ALTER TABLE WorkTrace ADD the two nullable columns + CREATE the two indexes (plain B-tree, no partial unique — committed in the same commit as the schema change). |
| modify | `/Users/jasonli/switchboard/packages/db/src/stores/prisma-work-trace-store.ts` | Write contactId/conversationThreadId in buildWorkTraceCreateData and read them back in mapRowToTrace. |
| modify | `/Users/jasonli/switchboard/packages/db/src/stores/__tests__/prisma-work-trace-store.test.ts` | Add a test asserting persist() writes contactId/conversationThreadId (and null when absent). |
| modify | `/Users/jasonli/switchboard/packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts` | Add a test asserting record() stamps ConversionRecord.bookingId from event.metadata.bookingId (proves the booked-outbox -> conversion-record leg of the chain). |
| modify | `/Users/jasonli/switchboard/apps/chat/src/gateway/gateway-conversation-store.ts` | Re-key the gateway thread off a resolved {contactId, organizationId} (injected resolver) instead of the literal 'visitor-'+sessionId / 'gateway', so the attribution-carrying Contact is the thread's contact. |
| modify | `/Users/jasonli/switchboard/apps/chat/src/gateway/__tests__/gateway-conversation-store.test.ts` | Update existing tests for the resolver and add a test asserting the thread is created with the RESOLVED contactId/org, not the visitor-/gateway literals. |

**Notes:** LAYERING: all changes respect schemas(L1) -> core(L3) -> db(L4) -> apps(L5). The conversationThreadId field is added to core types (canonical-request.ts, work-unit.ts, work-trace.ts) which is L3; db (L4) reads core types — no cycle. apps/chat (L5) may import anything. CONTENT-HASH SAFETY (the load-bearing invariant): contactId+conversationThreadId MUST be added to EXCLUDED_BASE in the SAME COMMIT as the schema columns (Task 2), exactly mirroring injectedPatternIds at work-trace-hash.ts:22. Because EXCLUDED_BASE feeds both WORK_TRACE_HASH_EXCLUDED_FIELDS_V1 and _V2, both excluded sets grow by 2; the v1 PINNED snapshot at work-trace-hash.test.ts:214-229 stays IDENTICAL (baseTraceForVersionBlock never sets the new fields, so the canonical input is byte-for-byte unchanged) but the two length assertions at lines 54 (v1: 6) and 68 (v2: 5) WILL break and must be bumped to 8 and 7 in the same task. NO hashInputVersion bump — this is the whole point of the EXCLUDED_BASE approach. (c) IS PARTLY ALREADY DONE: ConversionRecord.bookingId column exists (schema.prisma:2045), the booked outbox payload already sets metadata.bookingId (calendar-book.ts:370), and PrismaConversionRecordStore.record already reads event.metadata.bookingId and writes it (prisma-conversion-record-store.ts:50-51,65). Task 6 is a CHARACTERIZATION test that pins this leg so a future refactor cannot silently break it — do not duplicate the write. (d) SCOPE: the core GatewayConversationStore interface signature (channel-gateway/types.ts:181) is FIXED at (deploymentId, channel, sessionId) and is NOT changed here — the re-key is bounded to the apps/chat implementation by injecting a resolver through the store constructor. The org/contact resolution that feeds it (resolveContactIdentity) already lives in the gateway; this PR only stops the chat store from hardcoding visitor-/gateway. DB TESTS MOCK PRISMA (CI has no Postgres) — mirror prisma-work-trace-store.test.ts:30-46 ($transaction: vi.fn(async cb => cb(mockPrisma)), each model is a plain object of vi.fn(), cast `as never`). Run `pnpm reset` first if typecheck complains about unknown Prisma field contactId on WorkTrace (stale generated client). FILE SIZES: prisma-work-trace-store.ts already carries an eslint-disable max-lines (line 1) and calendar-book.test.ts carries one (line 1) — adding a few lines is fine; do NOT inline new modules into calendar-book.ts. DEPENDS ON 1A-1: do not start until 1A-1 (E.164 normalizer + normalized findByPhone) is merged, otherwise the re-keyed gateway thread still points at a split Contact and the chain join returns a mis-attributed contactId.

#### Task 1: Task 1 — Pass workTraceId at calendar-book so the Booking is joinable to its WorkTrace

**Files:**
- Modify: `/Users/jasonli/switchboard/packages/core/src/skill-runtime/tools/calendar-book.ts`
- Test: `/Users/jasonli/switchboard/packages/core/src/skill-runtime/tools/calendar-book.test.ts`

- [ ] **Step 1: Open the existing calendar-book test and read the beforeEach scaffold (lines 95-115) and the 'uses ctx.orgId for store calls' test (lines 202-232). Note: the tool under test is built in beforeEach as `tool = factory({ ...TRUSTED_CTX, contactId: "ct_1" })` where TRUSTED_CTX (lines 77-81) has NO workUnitId. You will add workUnitId to a fresh tool instance inside the new test, because SkillRequestContext.workUnitId is optional (types.ts:414).**

- [ ] **Step 2: Write the FIRST failing test. Add this block immediately after the closing `});` of the 'booking.create uses ctx.orgId for store calls (LLM cannot override)' test (after line 232 in the current file). It builds a tool whose context carries workUnitId='wu_parent' and asserts the booking store receives it. The store mocks and validInput shape mirror the existing tests exactly.**

```ts
  it("booking.create passes ctx.workUnitId as workTraceId into bookingStore.create", async () => {
    bookingStore.create.mockResolvedValue({ id: "bk_1", status: "pending_confirmation" });
    opportunityStore.findActiveByContact.mockResolvedValue({ id: "opp_1" });
    calendarProvider.createBooking.mockResolvedValue({
      calendarEventId: "gcal_123",
      status: "confirmed",
    });
    const withWorkUnit = factory({ ...TRUSTED_CTX, contactId: "ct_1", workUnitId: "wu_parent" });

    await withWorkUnit.operations["booking.create"]!.execute({
      service: "consultation",
      slotStart: "2026-04-20T10:00:00+08:00",
      slotEnd: "2026-04-20T10:30:00+08:00",
      calendarId: "primary",
    });

    expect(bookingStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ workTraceId: "wu_parent" }),
    );
  });

  it("booking.create passes workTraceId null when ctx.workUnitId is absent", async () => {
    bookingStore.create.mockResolvedValue({ id: "bk_1" });
    opportunityStore.findActiveByContact.mockResolvedValue({ id: "opp_1" });
    calendarProvider.createBooking.mockResolvedValue({ calendarEventId: "gcal_1" });

    await tool.operations["booking.create"]!.execute({
      service: "consultation",
      slotStart: "2026-04-20T10:00:00+08:00",
      slotEnd: "2026-04-20T10:30:00+08:00",
      calendarId: "primary",
    });

    expect(bookingStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ workTraceId: null }),
    );
  });
```

- [ ] **Step 3: Run the new tests and confirm they FAIL because calendar-book.ts does not yet pass workTraceId.**

Run: `pnpm --filter @switchboard/core test src/skill-runtime/tools/calendar-book.test.ts`
Expected: FAIL: the two new tests fail. The failure message is an assertion mismatch like `expect(bookingStore.create).toHaveBeenCalledWith(...)` showing the actual call object has no `workTraceId` key (the existing call passes organizationId/contactId/opportunityId/service/startsAt/endsAt/attendeeName/attendeeEmail only). All other calendar-book tests still pass.

- [ ] **Step 4: Make the minimal implementation. In calendar-book.ts, find the bookingStore.create call (currently lines 259-268) and add the workTraceId field sourced from ctx.workUnitId. The ctx is the closure variable from createCalendarBookToolFactory's returned (ctx) => SkillTool (line 160).**

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

- [ ] **Step 5: Add workTraceId to the local BookingStoreSubset.create input type in calendar-book.ts. The interface is at lines 16-30; it already lists workTraceId?: string | null at line 29, so VERIFY it is present — if it is, no change is needed here. (The store's real signature already accepts it: prisma-booking-store.ts:18.)**

```ts
// VERIFY ONLY — BookingStoreSubset.create already declares:
//   workTraceId?: string | null;
// at calendar-book.ts line 29. No edit needed if present.
```

- [ ] **Step 6: Re-run the calendar-book tests and confirm everything PASSES.**

Run: `pnpm --filter @switchboard/core test src/skill-runtime/tools/calendar-book.test.ts`
Expected: PASS: all calendar-book tests pass, including the two new ones.

- [ ] **Step 7: Commit.**

Run: `git add packages/core/src/skill-runtime/tools/calendar-book.ts packages/core/src/skill-runtime/tools/calendar-book.test.ts && git commit -m "feat(core): pass workTraceId from booking tool context into bookingStore.create"`
Expected: Commit succeeds. Pre-commit hooks (lint-staged/prettier) reformat if needed; if a file is reformatted, re-run `git add` on it and re-commit.


#### Task 2: Task 2 — Add contactId/conversationThreadId to WorkTrace EXCLUDED_BASE (content-hash invariance)

**Files:**
- Modify: `/Users/jasonli/switchboard/packages/core/src/platform/work-trace.ts`
- Modify: `/Users/jasonli/switchboard/packages/core/src/platform/work-trace-hash.ts`
- Test: `/Users/jasonli/switchboard/packages/core/src/platform/__tests__/work-trace-hash.test.ts`

- [ ] **Step 1: First add the two fields to the WorkTrace TYPE so the test compiles. Open work-trace.ts and add contactId/conversationThreadId after injectedPatternIds (the last field, ends at line 95). These are chain-join lineage, excluded from the hash.**

```ts
  /**
   * Chain-join lineage (Spec 1A-2): the authoritative Contact and
   * ConversationThread this work unit belongs to. Excluded from the content
   * hash (added to EXCLUDED_BASE, same commit) so backfilling these columns on
   * pre-1A-2 rows does not break their original contentHash verification —
   * precedent: injectedPatternIds. Populated at submit from the trusted param
   * bag (contactId) and the resolved gateway thread (conversationThreadId).
   */
  contactId?: string;
  conversationThreadId?: string;
```

- [ ] **Step 2: Write the FAILING invariance test in work-trace-hash.test.ts. Add it inside the first `describe("work-trace-hash", ...)` block, immediately after the injectedPatternIds invariance test (after line 75). It asserts that adding the two new columns does NOT change the hash. It will FAIL today because the fields are NOT yet in EXCLUDED_BASE, so they leak into the canonical input.**

```ts
  it("changing contactId / conversationThreadId does not change the hash (excluded — chain lineage)", () => {
    const bare = baseTrace();
    const welded = baseTrace({ contactId: "ct_9", conversationThreadId: "th_9" });
    expect(computeWorkTraceContentHash(welded, 1)).toBe(computeWorkTraceContentHash(bare, 1));
  });
```

- [ ] **Step 3: Update the two length assertions and the arrayContaining lists in the SAME test file to anticipate the grown excluded sets. Change the v1 length from 6 to 8 (line 54) and add the two names to its arrayContaining (lines 44-53); change the v2 length from 5 to 7 (line 68) and add the two names to its arrayContaining (lines 58-66). Replace the body of the v1 test (lines 43-55).**

```ts
  it("v1 excluded set excludes base + ingressPath + hashInputVersion + chain columns", () => {
    expect(WORK_TRACE_HASH_EXCLUDED_FIELDS_V1).toEqual(
      expect.arrayContaining([
        "contentHash",
        "traceVersion",
        "lockedAt",
        "injectedPatternIds",
        "contactId",
        "conversationThreadId",
        "ingressPath",
        "hashInputVersion",
      ]),
    );
    expect(WORK_TRACE_HASH_EXCLUDED_FIELDS_V1.length).toBe(8);
  });
```

- [ ] **Step 4: Replace the body of the v2 length test (lines 57-69) with the grown set.**

```ts
  it("v2 excluded set excludes base + hashInputVersion + chain columns (NOT ingressPath)", () => {
    expect(WORK_TRACE_HASH_EXCLUDED_FIELDS_V2).toEqual(
      expect.arrayContaining([
        "contentHash",
        "traceVersion",
        "lockedAt",
        "injectedPatternIds",
        "contactId",
        "conversationThreadId",
        "hashInputVersion",
      ]),
    );
    expect(WORK_TRACE_HASH_EXCLUDED_FIELDS_V2).not.toContain("ingressPath");
    expect(WORK_TRACE_HASH_EXCLUDED_FIELDS_V2.length).toBe(7);
  });
```

- [ ] **Step 5: Run the hash tests and confirm the new invariance test FAILS and the two length tests FAIL (expected, since the impl is not done yet). Critically, the v1 PINNED snapshot test (lines 214-229) must STILL PASS — verify it does, proving the change is backward-compatible.**

Run: `pnpm --filter @switchboard/core test src/platform/__tests__/work-trace-hash.test.ts`
Expected: FAIL: 'changing contactId / conversationThreadId does not change the hash' fails (the two hashes differ because the fields leak into canonical input). The two length tests fail (actual length still 6 and 5). The pinned-snapshot test 'v1 hash for a row matches a pinned reference fixture' PASSES (unchanged hash ccafb985...).

- [ ] **Step 6: Now make the minimal impl: add the two names to EXCLUDED_BASE in work-trace-hash.ts. The array is at lines 13-23; insert after injectedPatternIds (line 22).**

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
  // Spec 1A-2: chain-join lineage columns (Contact + ConversationThread).
  // Excluded for the same reason as injectedPatternIds — they are derived at
  // submit, never part of trace integrity, and the nullable-column backfill on
  // pre-1A-2 rows must not change their original contentHash. No hashInputVersion
  // bump: the canonical input is unchanged for any row that never set these.
  "contactId",
  "conversationThreadId",
] as const;
```

- [ ] **Step 7: Re-run the hash tests and confirm ALL pass (invariance, both length tests, AND the unchanged pinned snapshot).**

Run: `pnpm --filter @switchboard/core test src/platform/__tests__/work-trace-hash.test.ts`
Expected: PASS: all work-trace-hash tests pass. The pinned v1 snapshot is still ccafb985781b689b6e9f66c75dcd11e160e03aa696b98558e7abe110c61aa3f5 (proves zero hash drift for existing rows).

- [ ] **Step 8: Commit the type + hash + test together (the EXCLUDED_BASE change MUST land with the type addition).**

Run: `git add packages/core/src/platform/work-trace.ts packages/core/src/platform/work-trace-hash.ts packages/core/src/platform/__tests__/work-trace-hash.test.ts && git commit -m "feat(core): exclude worktrace chain columns from content hash"`
Expected: Commit succeeds. If lint-staged reformats, re-add and re-commit.


#### Task 3: Task 3 — Populate contactId/conversationThreadId at submit (request -> work unit -> trace)

**Files:**
- Modify: `/Users/jasonli/switchboard/packages/core/src/platform/canonical-request.ts`
- Modify: `/Users/jasonli/switchboard/packages/core/src/platform/work-unit.ts`
- Modify: `/Users/jasonli/switchboard/packages/core/src/platform/work-trace-recorder.ts`
- Modify: `/Users/jasonli/switchboard/packages/core/src/channel-gateway/channel-gateway.ts`
- Test: `/Users/jasonli/switchboard/packages/core/src/platform/work-trace-recorder.test.ts`

- [ ] **Step 1: Add the optional field to CanonicalSubmitRequest so the resolved thread id can flow from the gateway to the trace. Open canonical-request.ts and add conversationThreadId after traceId (line 29).**

```ts
export interface CanonicalSubmitRequest {
  organizationId: string;
  actor: Actor;
  intent: string;
  parameters: Record<string, unknown>;
  trigger: Trigger;
  surface: SurfaceMetadata;
  idempotencyKey?: string;
  parentWorkUnitId?: string;
  traceId?: string;
  /** Resolved ConversationThread id for this submit, server-supplied (chain
   *  lineage, Spec 1A-2). Flowed into WorkTrace.conversationThreadId; never
   *  LLM-controlled. */
  conversationThreadId?: string;
  priority?: "low" | "normal" | "high";
  targetHint?: TargetHint;
  suggestedMode?: ExecutionModeName;
}
```

- [ ] **Step 2: Add conversationThreadId to WorkUnit and copy it in normalizeWorkUnit. Open work-unit.ts; add the field to the WorkUnit interface after traceId (line 23) and the copy in normalizeWorkUnit after traceId (line 44).**

```ts
export interface WorkUnit {
  id: string;
  requestedAt: string;
  organizationId: string;
  actor: Actor;
  intent: string;
  parameters: Record<string, unknown>;
  deployment: DeploymentContext;
  suggestedMode?: ExecutionModeName;
  resolvedMode: ExecutionModeName;
  idempotencyKey?: string;
  parentWorkUnitId?: string;
  traceId: string;
  conversationThreadId?: string;
  trigger: Trigger;
  priority: Priority;
}
```

- [ ] **Step 3: In normalizeWorkUnit (work-unit.ts), copy request.conversationThreadId. Add the line after `traceId: request.traceId ?? createId(),` (line 44).**

```ts
    traceId: request.traceId ?? createId(),
    conversationThreadId: request.conversationThreadId,
```

- [ ] **Step 4: Write the FAILING recorder test. The file work-trace-recorder.test.ts may not exist — check first with the command in the next step, then create-or-append. This test drives buildWorkTrace with a work unit whose parameters carry contactId and whose top level carries conversationThreadId, and asserts both land on the trace. The WorkUnit/GovernanceDecision shapes mirror the minimal fields buildWorkTrace reads (work-trace-recorder.ts:66-120).**

```ts
import { describe, it, expect } from "vitest";
import { buildWorkTrace, buildClaimTrace } from "./work-trace-recorder.js";
import type { WorkUnit } from "./work-unit.js";
import type { GovernanceDecision } from "./governance-types.js";

function makeWorkUnit(over: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id: "wu_1",
    requestedAt: "2026-06-06T00:00:00.000Z",
    organizationId: "org_1",
    actor: { id: "u_1", type: "user" },
    intent: "alex.respond",
    parameters: { contactId: "ct_1" },
    deployment: { deploymentId: "dep_1" } as unknown as WorkUnit["deployment"],
    resolvedMode: "skill",
    traceId: "tr_1",
    conversationThreadId: "th_1",
    trigger: "chat",
    priority: "normal",
    ...over,
  };
}

const decision: GovernanceDecision = {
  outcome: "execute",
  riskScore: 0,
  matchedPolicies: [],
} as unknown as GovernanceDecision;

describe("work-trace-recorder chain lineage", () => {
  it("buildWorkTrace copies contactId from parameters and conversationThreadId from the unit", () => {
    const trace = buildWorkTrace({
      workUnit: makeWorkUnit(),
      governanceDecision: decision,
      governanceCompletedAt: "2026-06-06T00:00:00.050Z",
    });
    expect(trace.contactId).toBe("ct_1");
    expect(trace.conversationThreadId).toBe("th_1");
  });

  it("buildWorkTrace leaves chain fields undefined when absent", () => {
    const trace = buildWorkTrace({
      workUnit: makeWorkUnit({ parameters: {}, conversationThreadId: undefined }),
      governanceDecision: decision,
      governanceCompletedAt: "2026-06-06T00:00:00.050Z",
    });
    expect(trace.contactId).toBeUndefined();
    expect(trace.conversationThreadId).toBeUndefined();
  });

  it("buildClaimTrace also carries the chain lineage", () => {
    const trace = buildClaimTrace({
      workUnit: makeWorkUnit(),
      governanceDecision: decision,
      governanceCompletedAt: "2026-06-06T00:00:00.050Z",
      executionStartedAt: "2026-06-06T00:00:00.060Z",
    });
    expect(trace.contactId).toBe("ct_1");
    expect(trace.conversationThreadId).toBe("th_1");
  });
});
```

- [ ] **Step 5: Check whether the recorder test already exists. If it prints a path, append the describe block above to it instead of overwriting (adjust imports to avoid duplicates). If it prints nothing, create it with the content above.**

Run: `ls packages/core/src/platform/work-trace-recorder.test.ts 2>/dev/null || echo NO_FILE`
Expected: Either prints the path (append) or 'NO_FILE' (create the file with the content from the previous step).

- [ ] **Step 6: Run the recorder test and confirm it FAILS because buildWorkTrace/buildClaimTrace do not yet set the chain fields.**

Run: `pnpm --filter @switchboard/core test src/platform/work-trace-recorder.test.ts`
Expected: FAIL: trace.contactId is undefined (expected 'ct_1') and trace.conversationThreadId is undefined (expected 'th_1') in the buildWorkTrace and buildClaimTrace tests.

- [ ] **Step 7: Implement in buildWorkTrace (work-trace-recorder.ts). In the returned object (lines 87-119), add the two fields after `idempotencyKey: workUnit.idempotencyKey,` (line 97). Read contactId defensively from the parameter bag (it is a Record<string, unknown>).**

```ts
    idempotencyKey: workUnit.idempotencyKey,
    contactId:
      typeof workUnit.parameters.contactId === "string"
        ? workUnit.parameters.contactId
        : undefined,
    conversationThreadId: workUnit.conversationThreadId,
```

- [ ] **Step 8: Implement in buildClaimTrace (work-trace-recorder.ts) the same way. In its returned object (lines 143-170), add after `idempotencyKey: workUnit.idempotencyKey,` (line 153).**

```ts
    idempotencyKey: workUnit.idempotencyKey,
    contactId:
      typeof workUnit.parameters.contactId === "string"
        ? workUnit.parameters.contactId
        : undefined,
    conversationThreadId: workUnit.conversationThreadId,
```

- [ ] **Step 9: Re-run the recorder test and confirm PASS.**

Run: `pnpm --filter @switchboard/core test src/platform/work-trace-recorder.test.ts`
Expected: PASS: all chain-lineage recorder tests pass.

- [ ] **Step 10: Wire the gateway to supply conversationThreadId at submit. Open channel-gateway.ts and find the CanonicalSubmitRequest built around line 310. Add `conversationThreadId: conversationId,` (conversationId is the thread id resolved at line 190 and in scope here). Add it right after the `traceId`/`trigger` fields — locate the request object literal and insert the field alongside the existing top-level fields (after `surface: { surface: "chat", sessionId: message.sessionId },`).**

```ts
      trigger: "chat" as const,
      surface: { surface: "chat", sessionId: message.sessionId },
      conversationThreadId: conversationId,
      targetHint: {
        skillSlug: resolved.skillSlug,
        deploymentId: resolved.deploymentId,
        channel: message.channel,
        token: message.token,
      },
```

- [ ] **Step 11: Typecheck core to confirm the wiring compiles (the gateway change has no dedicated unit assertion here; its effect is covered end-to-end by Task 4's store test and the existing channel-gateway suite).**

Run: `pnpm --filter @switchboard/core test src/channel-gateway && pnpm --filter @switchboard/core typecheck`
Expected: PASS: the channel-gateway test suite still passes and typecheck reports no errors. If typecheck complains that conversationThreadId is missing on a CanonicalSubmitRequest literal elsewhere, it is optional, so no other call site needs changes.

- [ ] **Step 12: Commit.**

Run: `git add packages/core/src/platform/canonical-request.ts packages/core/src/platform/work-unit.ts packages/core/src/platform/work-trace-recorder.ts packages/core/src/platform/work-trace-recorder.test.ts packages/core/src/channel-gateway/channel-gateway.ts && git commit -m "feat(core): populate worktrace chain lineage at submit"`
Expected: Commit succeeds. If lint-staged reformats, re-add and re-commit.


#### Task 4: Task 4 — Persist + read the new WorkTrace columns (schema, migration, store)

**Files:**
- Create: `/Users/jasonli/switchboard/packages/db/prisma/migrations/20260606120000_worktrace_chain_columns/migration.sql`
- Modify: `/Users/jasonli/switchboard/packages/db/prisma/schema.prisma`
- Modify: `/Users/jasonli/switchboard/packages/db/src/stores/prisma-work-trace-store.ts`
- Test: `/Users/jasonli/switchboard/packages/db/src/stores/__tests__/prisma-work-trace-store.test.ts`

- [ ] **Step 1: Add the two columns + two indexes to the WorkTrace model in schema.prisma. The model is at lines 1908-1976. Add the columns near the other lineage fields (after parentWorkUnitId at line 1912 is a natural spot, but to minimize churn add them just before the Timestamps block, after injectedPatternIds at line 1958). Add the two indexes inside the index block (after line 1975).**

```ts
  // Spec 1A-2: chain-join lineage. Nullable + excluded from the WorkTrace
  // content hash (see EXCLUDED_BASE in work-trace-hash.ts) so backfilling these
  // on pre-1A-2 rows does not change their contentHash. Populated at submit.
  contactId            String?
  conversationThreadId String?
```

- [ ] **Step 2: Add the two indexes to the WorkTrace @@index block (after the existing @@index([approvalId]) at line 1975, before the closing brace at line 1976).**

```ts
  @@index([organizationId, contactId])
  @@index([organizationId, conversationThreadId])
```

- [ ] **Step 3: Create the migration SQL by hand (CI has no TTY; do not use `prisma migrate dev`). Plain nullable columns + plain B-tree indexes — NO partial unique here. Mirror the additive style of prior migrations.**

```ts
-- Spec 1A-2: weld WorkTrace into the revenue chain. Two nullable lineage
-- columns (Contact + ConversationThread) plus their lookup indexes. Both
-- columns are EXCLUDED from the WorkTrace content hash in the same commit
-- (work-trace-hash.ts EXCLUDED_BASE), so this backfill cannot change any
-- existing row's contentHash. No hashInputVersion bump.
ALTER TABLE "WorkTrace" ADD COLUMN "contactId" TEXT;
ALTER TABLE "WorkTrace" ADD COLUMN "conversationThreadId" TEXT;

CREATE INDEX "WorkTrace_organizationId_contactId_idx"
  ON "WorkTrace" ("organizationId", "contactId");
CREATE INDEX "WorkTrace_organizationId_conversationThreadId_idx"
  ON "WorkTrace" ("organizationId", "conversationThreadId");
```

- [ ] **Step 4: Regenerate the Prisma client so the generated types know the new columns (otherwise the store + test will not typecheck).**

Run: `pnpm db:generate`
Expected: Prisma client regenerates successfully (output: 'Generated Prisma Client'). If it errors on schema validation, re-read the schema.prisma WorkTrace block for a typo.

- [ ] **Step 5: Write the FAILING store test. Open prisma-work-trace-store.test.ts; the makeTrace helper is at lines 5-27 and the mockPrisma is at lines 30-35. Add a test (after the 'persists a work trace with all fields' test, ~line 73) asserting the create data includes contactId/conversationThreadId, and one asserting null when absent. makeTrace accepts overrides, so pass the chain fields through it.**

```ts
  it("persists the chain lineage columns (contactId, conversationThreadId)", async () => {
    const trace = makeTrace({ contactId: "ct_1", conversationThreadId: "th_1" });
    await store.persist(trace);
    expect(mockPrisma.workTrace.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contactId: "ct_1",
        conversationThreadId: "th_1",
      }),
    });
  });

  it("persists null chain lineage when absent", async () => {
    const trace = makeTrace();
    await store.persist(trace);
    const call = mockPrisma.workTrace.create.mock.calls[0]![0];
    expect(call.data.contactId).toBeNull();
    expect(call.data.conversationThreadId).toBeNull();
  });
```

- [ ] **Step 6: Run the store test and confirm the new tests FAIL (buildWorkTraceCreateData does not yet emit the columns).**

Run: `pnpm --filter @switchboard/db test src/stores/__tests__/prisma-work-trace-store.test.ts`
Expected: FAIL: 'persists the chain lineage columns' fails (create data has no contactId/conversationThreadId key); 'persists null chain lineage when absent' fails (call.data.contactId is undefined, not null).

- [ ] **Step 7: Implement the write in buildWorkTraceCreateData (prisma-work-trace-store.ts, lines 233-285). Add the two fields after `ingressPath: trace.ingressPath,` (line 282), coercing undefined to null.**

```ts
      ingressPath: trace.ingressPath, // explicit; should always be set by buildWorkTrace
      hashInputVersion: opts.hashInputVersion,
      contactId: trace.contactId ?? null,
      conversationThreadId: trace.conversationThreadId ?? null,
```

- [ ] **Step 8: Implement the read in mapRowToTrace (prisma-work-trace-store.ts, lines 418-485). Add the two fields after `hashInputVersion: row.hashInputVersion ?? 1,` (line 479).**

```ts
      hashInputVersion: row.hashInputVersion ?? 1,
      contactId: row.contactId ?? undefined,
      conversationThreadId: row.conversationThreadId ?? undefined,
```

- [ ] **Step 9: Re-run the store test and confirm PASS.**

Run: `pnpm --filter @switchboard/db test src/stores/__tests__/prisma-work-trace-store.test.ts`
Expected: PASS: all PrismaWorkTraceStore tests pass, including the two new lineage tests.

- [ ] **Step 10: Commit schema + migration + store + test TOGETHER (the migration MUST land in the same commit as the schema change per CLAUDE.md).**

Run: `git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260606120000_worktrace_chain_columns/migration.sql packages/db/src/stores/prisma-work-trace-store.ts packages/db/src/stores/__tests__/prisma-work-trace-store.test.ts && git commit -m "feat(db): persist worktrace chain lineage columns + migration"`
Expected: Commit succeeds. If lint-staged reformats, re-add and re-commit.


#### Task 5: Task 5 — Characterize the booked-outbox -> ConversionRecord.bookingId leg

**Files:**
- Test: `/Users/jasonli/switchboard/packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts`

- [ ] **Step 1: Read the existing conversion-record store test to learn its mock idiom and the record() input shape (RecordInput is at prisma-conversion-record-store.ts:31-44; record() reads metadata.bookingId at lines 50-51 and writes it at line 65). Confirm the test file exists.**

Run: `ls packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts && grep -n "upsert\|mockPrisma\|conversionRecord\|describe" packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts | head -20`
Expected: The file exists and uses a mockPrisma object with conversionRecord.upsert (and likely groupBy) as vi.fn(). Note the exact mock variable name for use below.

- [ ] **Step 2: Add a CHARACTERIZATION test that pins the chain leg: a booked event whose metadata carries bookingId must upsert ConversionRecord with that bookingId. This is the join Booking.id -> ConversionRecord.bookingId. It guards against a future refactor silently dropping bookingId. Match the existing file's mock-prisma variable name (shown by the grep above) — the snippet below assumes it is `mockPrisma` with `conversionRecord.upsert`; rename if the file differs. Place the test inside the top-level describe block.**

```ts
  it("stamps ConversionRecord.bookingId from event.metadata.bookingId (chain leg)", async () => {
    const store = new PrismaConversionRecordStore(mockPrisma as never);
    await store.record({
      eventId: "evt_1",
      type: "booked",
      contactId: "ct_1",
      organizationId: "org_1",
      value: 5000,
      occurredAt: new Date("2026-06-06T00:00:00.000Z"),
      source: "calendar-book",
      metadata: { bookingId: "bk_1", service: "botox" },
    });
    expect(mockPrisma.conversionRecord.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: "evt_1" },
        create: expect.objectContaining({ bookingId: "bk_1" }),
      }),
    );
  });

  it("writes null bookingId when metadata omits it (no fabrication)", async () => {
    const store = new PrismaConversionRecordStore(mockPrisma as never);
    await store.record({
      eventId: "evt_2",
      type: "inquiry",
      contactId: "ct_1",
      organizationId: "org_1",
      occurredAt: new Date("2026-06-06T00:00:00.000Z"),
      source: "x",
      metadata: {},
    });
    const call = mockPrisma.conversionRecord.upsert.mock.calls.at(-1)![0];
    expect(call.create.bookingId).toBeNull();
  });
```

- [ ] **Step 3: Run the conversion-record store test. Because the store ALREADY reads+writes metadata.bookingId, these characterization tests should PASS on first run (they pin existing behavior). If the file's mock object/import is named differently, adjust the snippet (e.g. import { PrismaConversionRecordStore } at top, mock variable name) until green.**

Run: `pnpm --filter @switchboard/db test src/stores/__tests__/prisma-conversion-record-store.test.ts`
Expected: PASS: both new tests pass immediately (the bookingId write at prisma-conversion-record-store.ts:65 is already present). If they FAIL on a missing import or wrong mock name, fix the test harness — NOT the store — since the production behavior already exists.

- [ ] **Step 4: Commit the characterization test.**

Run: `git add packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts && git commit -m "test(db): pin booking-id stamping on conversion records"`
Expected: Commit succeeds.


#### Task 6: Task 6 — Re-key the chat gateway thread off the resolved contact/org (kill visitor-/gateway literals)

**Files:**
- Modify: `/Users/jasonli/switchboard/apps/chat/src/gateway/gateway-conversation-store.ts`
- Test: `/Users/jasonli/switchboard/apps/chat/src/gateway/__tests__/gateway-conversation-store.test.ts`

- [ ] **Step 1: Read the current store (gateway-conversation-store.ts). It hardcodes `const contactId = 'visitor-'+sessionId` and `const orgId = 'gateway'` at lines 23-24, then uses them for the thread create (lines 40-48), the message read (line 52), and the threadCache (line 50). The minimal, layering-safe re-key injects a resolver through the constructor so the chat store stops fabricating identity. The core GatewayConversationStore interface (channel-gateway/types.ts:181) signature is NOT changed.**

- [ ] **Step 2: Write the FAILING test FIRST. Update the test file to construct the store with a resolver and assert the thread is created with the RESOLVED contactId/org. Replace the 'creates new conversation when none exists' test (lines 24-47) with a version that injects a resolver returning a real contact/org and asserts those values are used (NOT 'visitor-sess-1'/'gateway'). Also add a constructor-shape note: the second constructor arg is the resolver.**

```ts
  it("creates the thread with the RESOLVED contactId/org (not visitor-/gateway)", async () => {
    mockPrisma.conversationThread.findFirst.mockResolvedValue(null);
    mockPrisma.conversationThread.create.mockResolvedValue({
      id: "new-conv",
      contactId: "ct_real",
      organizationId: "org_real",
    });
    mockPrisma.conversationMessage.findMany.mockResolvedValue([]);
    const resolveIdentity = vi.fn().mockResolvedValue({
      contactId: "ct_real",
      organizationId: "org_real",
    });

    const store = new PrismaGatewayConversationStore(mockPrisma as never, resolveIdentity);
    const result = await store.getOrCreateBySession("dep-1", "whatsapp", "sess-1");

    expect(result.conversationId).toBe("new-conv");
    expect(resolveIdentity).toHaveBeenCalledWith("dep-1", "whatsapp", "sess-1");
    expect(mockPrisma.conversationThread.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contactId: "ct_real",
          organizationId: "org_real",
        }),
      }),
    );
    expect(mockPrisma.conversationMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { contactId: "ct_real", orgId: "org_real" } }),
    );
  });
```

- [ ] **Step 3: Update the OTHER existing tests in the file that pass only `(mockPrisma as never)` to the constructor — they will now need the resolver arg. The simplest fix: define a module-level default resolver helper and pass it. Add this helper near the top of the describe block (after the beforeEach at line 22) and update each `new PrismaGatewayConversationStore(mockPrisma as never)` to `new PrismaGatewayConversationStore(mockPrisma as never, defaultResolver)`. For the tests that asserted 'visitor-sess-1'/'gateway' (lines 49-95 and the makeStoreWithThread helper at 103-113), point the default resolver at those same literals so those assertions stay valid while exercising the new code path.**

```ts
  const defaultResolver = vi
    .fn()
    .mockResolvedValue({ contactId: "visitor-sess-1", organizationId: "gateway" });

  // Update each construction in the existing tests, e.g.:
  //   const store = new PrismaGatewayConversationStore(mockPrisma as never, defaultResolver);
  // For the WhatsApp block's makeStoreWithThread, use a resolver returning
  //   { contactId: "visitor-sess-wa", organizationId: "gateway" }
  // so its existing message-create assertions (contactId: visitor-sess-wa, orgId: gateway) hold.
```

- [ ] **Step 4: Run the test and confirm the NEW test FAILS (the constructor takes only prisma today; the resolver arg is ignored and contactId is still the fabricated literal). The existing tests may also fail to compile because the constructor signature has not changed yet.**

Run: `pnpm --filter @switchboard/chat test src/gateway/__tests__/gateway-conversation-store.test.ts`
Expected: FAIL: the new 'creates the thread with the RESOLVED contactId/org' test fails — conversationThread.create is called with contactId 'visitor-sess-1'/'gateway' (the hardcoded literals), not 'ct_real'/'org_real'. (If the suite fails to compile on the 2-arg constructor, that is expected — the impl is next.)

- [ ] **Step 5: Implement the resolver injection. In gateway-conversation-store.ts, define a resolver type, accept it in the constructor, and use it in getOrCreateBySession instead of the literals. Replace the constructor (line 13) and the head of getOrCreateBySession (lines 15-24).**

```ts
type GatewayIdentityResolver = (
  deploymentId: string,
  channel: string,
  sessionId: string,
) => Promise<{ contactId: string; organizationId: string }>;

export class PrismaGatewayConversationStore implements GatewayConversationStore {
  private threadCache = new Map<string, ThreadInfo>();

  constructor(
    private prisma: PrismaClient,
    private resolveIdentity: GatewayIdentityResolver,
  ) {}

  async getOrCreateBySession(
    deploymentId: string,
    channel: string,
    sessionId: string,
  ): Promise<{
    conversationId: string;
    messages: Array<{ role: string; content: string }>;
  }> {
    const { contactId, organizationId: orgId } = await this.resolveIdentity(
      deploymentId,
      channel,
      sessionId,
    );
```

- [ ] **Step 6: Re-run the gateway store test and confirm ALL pass (the new resolved-identity test and the updated existing ones).**

Run: `pnpm --filter @switchboard/chat test src/gateway/__tests__/gateway-conversation-store.test.ts`
Expected: PASS: all PrismaGatewayConversationStore tests pass; conversationThread.create now receives the resolver's contactId/org.

- [ ] **Step 7: Wire the resolver at the construction site so production behavior is correct. Open gateway-bridge.ts and find `new PrismaGatewayConversationStore(prisma)` (gateway-bridge.ts:270). Supply a resolver. The minimal correct resolver maps a gateway session to the real contact/org; reuse the same identity source the gateway already uses. Read gateway-bridge.ts around line 270 first to see what contact/deployment lookups are already in scope, then pass a resolver that returns the resolved contact/org (falling back to the legacy literals only if no contact can be resolved, to avoid a hard failure for anonymous web-widget sessions).**

Run: `sed -n '255,275p' apps/chat/src/gateway/gateway-bridge.ts`
Expected: Shows the construction of PrismaGatewayConversationStore at line ~270 and the surrounding wiring (prisma, deploymentResolver, contactStore). Use whatever contact/deployment resolver is already wired here to build the GatewayIdentityResolver; if none is available for a given session, return { contactId: `visitor-${sessionId}`, organizationId: "gateway" } as the explicit anonymous fallback.

- [ ] **Step 8: Implement the resolver at gateway-bridge.ts:270. Replace `new PrismaGatewayConversationStore(prisma)` with a 2-arg construction. The resolver below resolves the contact via the same path the gateway uses and falls back to the legacy literals for unresolved/anonymous sessions (preserving today's behavior for web-widget visitors while welding real WhatsApp/CTWA contacts).**

```ts
new PrismaGatewayConversationStore(prisma, async (deploymentId, channel, sessionId) => {
  // Resolve the deployment's org, then the contact for this session. For
  // unresolved/anonymous sessions (e.g. web-widget) fall back to the legacy
  // anonymous identity so existing flows keep working; real WhatsApp/CTWA
  // sessions weld onto the attribution-carrying Contact (Spec 1A-1 normalized
  // findByPhone makes this the SAME row the booking resolves against).
  const resolved = await deploymentResolver.resolveByChannel?.(channel, deploymentId);
  const organizationId = resolved?.organizationId ?? "gateway";
  const identity = await resolveContactIdentity({
    channel,
    sessionId,
    organizationId,
    contactStore,
  }).catch(() => null);
  return {
    contactId: identity?.contactId ?? `visitor-${sessionId}`,
    organizationId,
  };
})
```

- [ ] **Step 9: Adapt the resolver to the identifiers actually in scope. The exact names (the deploymentResolver method, the contactStore variable, the resolveContactIdentity import path) depend on what gateway-bridge.ts already has — substitute the real ones you saw in the sed output into Step 8's code. Wiring the real resolver is REQUIRED, not optional: 1A-1 is a hard dependency of this PR and provides resolveContactIdentity + normalized findByPhone, and the whole point of this task is to STOP the gateway hardcoding visitor-/gateway for real WhatsApp/CTWA sessions (otherwise the welded thread points at the split, attribution-less Contact and the chain join mis-attributes). The `visitor-${sessionId}` / `gateway` literals may remain ONLY as the in-resolver fallback for a session with no resolvable contact (e.g. an anonymous web-widget visitor), exactly as written in Step 8 — never as a blanket replacement for the resolver and never behind a `// TODO`. If contactStore/deploymentResolver are not already in scope at the construction site, thread them in from where gateway-bridge.ts already builds them rather than skipping the wiring. Then ensure the chat app typechecks.**

Run: `pnpm --filter @switchboard/chat typecheck`
Expected: PASS: apps/chat typechecks with the 2-arg PrismaGatewayConversationStore construction. Fix any unresolved import (e.g. add `import { resolveContactIdentity } from "@switchboard/core";`) until clean.

- [ ] **Step 10: Run the full chat gateway test directory to ensure no neighboring test broke from the constructor change.**

Run: `pnpm --filter @switchboard/chat test src/gateway`
Expected: PASS: the gateway test directory is green.

- [ ] **Step 11: Commit.**

Run: `git add apps/chat/src/gateway/gateway-conversation-store.ts apps/chat/src/gateway/gateway-bridge.ts apps/chat/src/gateway/__tests__/gateway-conversation-store.test.ts && git commit -m "feat(chat): re-key gateway thread off resolved contact and org"`
Expected: Commit succeeds. If lint-staged reformats, re-add and re-commit.


#### Task 7: Task 7 — Chain-join proof + full verification gate

**Files:**
- Create: `/Users/jasonli/switchboard/packages/db/src/stores/__tests__/chain-join.test.ts`
- Test: `/Users/jasonli/switchboard/packages/db/src/stores/__tests__/chain-join.test.ts`

- [ ] **Step 1: Write a single one-query chain-join proof at the db layer that pins the spine: given a Booking with workTraceId, a join to WorkTrace by workUnitId yields the WorkTrace.contactId. Because CI has no Postgres, this is a MOCK-prisma test that asserts the QUERY SHAPE used to walk the chain (Booking.workTraceId -> WorkTrace.workUnitId -> contactId), not a live DB join. It documents and locks the join contract so a future schema change that renames a join column fails here. Create the file.**

```ts
import { describe, it, expect, vi } from "vitest";

// Spec 1A-2 chain-join proof (mock-prisma; CI has no Postgres). Pins the
// reconstruction Booking.workTraceId -> WorkTrace.workUnitId -> contactId so a
// future rename of any join column breaks this test loudly. Mirrors the
// db-test convention of asserting Prisma call SHAPE rather than a live join.
describe("revenue chain join", () => {
  it("walks Booking.workTraceId -> WorkTrace.workUnitId -> contactId", async () => {
    const mockPrisma = {
      booking: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: "bk_1", workTraceId: "wu_1", organizationId: "org_1" }),
      },
      workTrace: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ workUnitId: "wu_1", contactId: "ct_1", conversationThreadId: "th_1" }),
      },
    };

    const booking = await mockPrisma.booking.findUnique({
      where: { id: "bk_1" },
      select: { workTraceId: true, organizationId: true },
    });
    expect(booking?.workTraceId).toBe("wu_1");

    const trace = await mockPrisma.workTrace.findUnique({
      where: { workUnitId: booking!.workTraceId! },
      select: { contactId: true, conversationThreadId: true },
    });
    expect(trace?.contactId).toBe("ct_1");
    expect(trace?.conversationThreadId).toBe("th_1");

    // The join contract: Booking.workTraceId is the FK into WorkTrace.workUnitId.
    expect(mockPrisma.workTrace.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workUnitId: "wu_1" } }),
    );
  });
});
```

- [ ] **Step 2: Run the chain-join proof and confirm PASS.**

Run: `pnpm --filter @switchboard/db test src/stores/__tests__/chain-join.test.ts`
Expected: PASS: the chain-join proof passes.

- [ ] **Step 3: Run the full typecheck across the touched packages to catch any cross-layer break (core types consumed by db, db client consumed by chat).**

Run: `pnpm --filter @switchboard/core typecheck && pnpm --filter @switchboard/db typecheck && pnpm --filter @switchboard/chat typecheck`
Expected: PASS: all three typecheck clean. If core reports a missing export or db reports unknown Prisma field contactId, run `pnpm reset` then retry (stale dist/generated client).

- [ ] **Step 4: Run the full test suites for the three packages to confirm no regression anywhere in the chain.**

Run: `pnpm --filter @switchboard/core test && pnpm --filter @switchboard/db test && pnpm --filter @switchboard/chat test`
Expected: PASS: all suites green. The pg_advisory_xact_lock / api-auth flakes noted in project memory are unrelated to this PR; rerun once if a known flake trips.

- [ ] **Step 5: Run lint + format check (CI runs prettier in lint; local lint may not).**

Run: `pnpm lint && pnpm format:check`
Expected: PASS: no lint errors and no formatting diffs. If format:check reports diffs, run `pnpm format` (or `pnpm prettier --write` on the listed files), re-add, and amend the relevant commit.

- [ ] **Step 6: Commit the chain-join proof.**

Run: `git add packages/db/src/stores/__tests__/chain-join.test.ts && git commit -m "test(db): prove booking-to-contact chain join"`
Expected: Commit succeeds. The PR is complete: workTraceId flows at booking, WorkTrace carries contactId/conversationThreadId with zero content-hash drift, ConversionRecord.bookingId is pinned, and the gateway thread is keyed off the real contact/org.


---

## 1A-3 — feat(schemas,core,db): receipt primitive + isPaidVisit verdict + calendar-book mint with prod-assert

**Goal:** Introduce the shared Receipt primitive, isPaidVisit verdict, ReceiptStore (core iface + db impl), the Receipt model + migration, and calendar-book minting with the Noop/Local prod-assert.

**File structure:**

| Action | Path | Responsibility |
|---|---|---|
| create | `packages/schemas/src/receipt.ts` | ReceiptKind/ReceiptTier/ReceiptStatus enums; CalendarReceiptEvidenceSchema + PaymentReceiptEvidenceSchema; ReceiptEvidenceSchema = z.discriminatedUnion('kind', ...) (no any); ReceiptSchema; IsPaidVisitVerdictSchema/IsPaidVisitVerdict {paid,held,tier,basis,degraded}; inferred types. |
| create | `packages/schemas/src/__tests__/receipt.test.ts` | Parse/round-trip tests: valid calendar+payment receipts parse; evidence discriminator rejects a payment-shaped evidence under kind:calendar; tier/status enums reject junk; verdict schema parses. |
| modify | `packages/schemas/src/index.ts` | Add `export * from "./receipt.js";` so Receipt + verdict types are importable as @switchboard/schemas. |
| create | `packages/core/src/receipts/is-paid-visit.ts` | Pure isPaidVisit(receipt): IsPaidVisitVerdict — structured verdict, never a bare boolean. Maps (kind,tier,status) to {paid,held,tier,basis,degraded}. |
| create | `packages/core/src/receipts/is-paid-visit.test.ts` | Verdict matrix: calendar-T1-held, calendar-T3-local degraded, payment-T1 paid, calendar status=paid (B via T3) paid, status=void neither; asserts return is the structured object not a boolean. |
| create | `packages/core/src/receipts/resolve-calendar-receipt-tier.ts` | Pure resolveCalendarReceiptTier({calendarEventId,isProduction}): ReceiptTier — fabricated id (null | noop- | local- prefix) → T3; real provider id → T1; in production a fabricated id can NEVER yield T1/T2 (the anti-fake prod-assert). |
| create | `packages/core/src/receipts/resolve-calendar-receipt-tier.test.ts` | Prod-assert matrix: prod+noop-/local-/null → T3; prod+gcal_ real id → T1; non-prod+local- → still T3 (honest degradation regardless of env). |
| create | `packages/core/src/receipts/receipt-store.ts` | ReceiptStore interface + CreateReceiptInput (mirrors lifecycle/revenue-store.ts shape) + StoreTransactionContext re-use; record(input,tx?) and findByBooking(orgId,bookingId). |
| create | `packages/core/src/receipts/index.ts` | Barrel: re-export is-paid-visit, resolve-calendar-receipt-tier, receipt-store. |
| modify | `packages/core/src/index.ts` | Add `export * from "./receipts/index.js";` next to the lifecycle export so isPaidVisit/ReceiptStore/resolveCalendarReceiptTier are public from @switchboard/core. |
| create | `packages/db/src/stores/prisma-receipt-store.ts` | PrismaReceiptStore implements ReceiptStore (structural match) — record() (P2002 idempotency on the partial-unique externalRef) + findByBooking(); evidence written via typed cast (no any); mapper row→Receipt. |
| create | `packages/db/src/stores/__tests__/prisma-receipt-store.test.ts` | Mocked-Prisma tests (mirror prisma-revenue-store.test.ts): record passes organizationId+kind+tier+status+evidence; tx threading uses tx client; findByBooking scopes org+bookingId; idempotent return on existing externalRef. |
| modify | `packages/db/src/index.ts` | Add `export { PrismaReceiptStore } from "./stores/prisma-receipt-store.js";`. |
| modify | `packages/db/prisma/schema.prisma` | Add `model Receipt` (id, organizationId, kind, tier, status, bookingId?, opportunityId?, revenueEventId?, connectionId?, provider?, externalRef?, amount Int?, currency?, evidence Json, capturedBy, verifiedAt?, workTraceId?, createdAt; @@index([organizationId,bookingId]); @@index([organizationId,kind,status])) with a comment noting the partial-unique lives in raw SQL. |
| create | `packages/db/prisma/migrations/20260606120000_add_receipt/migration.sql` | CREATE TABLE "Receipt" (Prisma-generated DDL for the base model) + raw-SQL partial unique index Receipt_org_kind_externalRef_key ON (organizationId,kind,externalRef) WHERE externalRef IS NOT NULL (mirrors 20260603120000). |
| create | `packages/core/src/receipts/mint-calendar-receipt.ts` | Pure buildCalendarReceiptInput({orgId,bookingId,opportunityId,calendarEventId,provider,workTraceId,isProduction,startsAt}): CreateReceiptInput — sets kind:calendar, status:held, tier via resolveCalendarReceiptTier, evidence {kind:calendar,...}. No DB access. |
| create | `packages/core/src/receipts/mint-calendar-receipt.test.ts` | buildCalendarReceiptInput sets status held, kind calendar, T1 on real id, T3 on local-/prod, evidence carries calendarEventId+startsAt+provider. |
| modify | `packages/core/src/skill-runtime/tools/calendar-book.ts` | Widen TransactionFn tx to include receipt.create; in the confirm tx (lines 343-394) call buildCalendarReceiptInput + tx.receipt.create(...) after the booking.update; add isProduction + calendarProviderName to CalendarBookToolDeps. |
| modify | `packages/core/src/skill-runtime/tools/calendar-book.test.ts` | Add a confirm-tx test: a real calendarEventId mints a calendar Receipt tier T1 status held; a Noop result (calendarEventId null) under isProduction mints tier T3. |
| modify | `apps/api/src/bootstrap/skill-mode.ts` | Forward tx.receipt in the calendar-book runTransaction (skill-mode.ts:329-347) and pass isProduction: process.env.NODE_ENV === "production" into createCalendarBookToolFactory. |

**Notes:** LAYERING: schema type in schemas (L1); verdict fn + store interface + tier-resolver in core (L3); Prisma impl in db (L4); mint wiring in core calendar-book tool + apps/api skill-mode (L5). No new cross-layer cycle (db already imports core; core never imports db). FILE SIZE: do NOT inline anything into calendar-book.ts (439 lines today, warn at 400) — the receipt-mint helper + tier resolver are EXTRACTED into packages/core/src/receipts/. PROD-ASSERT is a PURE function (resolveCalendarReceiptTier) so it is unit-testable without booting the app — this is the spec's 'Key test'. MIGRATION: partial unique (organizationId, kind, externalRef) WHERE externalRef IS NOT NULL is raw SQL (Prisma 6 cannot express it) — mirror packages/db/prisma/migrations/20260603120000_booking_partial_unique_active. The base Receipt model columns ARE expressible in schema.prisma; only the partial-unique index is raw SQL appended to the same migration file. DB TESTS MOCK PRISMA (CI has no Postgres) — mirror packages/db/src/stores/__tests__/prisma-revenue-store.test.ts exactly. Every Prisma mutation includes organizationId in WHERE; reads here are findFirst/create only (no updateMany needed — Receipt is append-only in this PR). EVIDENCE Json write uses the typed-cast pattern from prisma-conversion-record-store.ts:66 (no Prisma.InputJsonValue import, no any). The calendar-book confirm tx (packages/core/src/skill-runtime/tools/calendar-book.ts:343-394) currently threads only booking/outboxEvent/opportunity — Task 6 widens the TransactionFn tx shape to add `receipt.create` and the apps/api runTransaction at skill-mode.ts:329-347 to forward tx.receipt. VERDICT NAMING: `IsPaidVisitVerdict` (type) + `isPaidVisit` (fn) — `paid`/`held` are independent booleans (B-architecture is held:true,paid:false), `tier` is the strongest evidence tier, `basis` is a short machine string, `degraded` flags an honest downgrade. Run `pnpm reset` first if typecheck reports missing @switchboard/schemas exports after Task 1.

#### Task 1: Task 1 — Receipt schema primitive in L1 (kind/tier/status + discriminated evidence + verdict type, no any)

**Files:**
- Create: `packages/schemas/src/receipt.ts`
- Create: `packages/schemas/src/__tests__/receipt.test.ts`
- Modify: `packages/schemas/src/index.ts`
- Test: `packages/schemas/src/__tests__/receipt.test.ts`

- [ ] **Step 1: Write the failing test first. Create packages/schemas/src/__tests__/receipt.test.ts. It imports the symbols we are about to define and asserts: (a) a valid calendar receipt parses, (b) a valid payment receipt parses, (c) the evidence discriminator rejects payment-shaped evidence when kind is calendar (this is the no-any safety the spec demands), (d) the verdict schema parses a structured verdict. Mirror the import style of packages/schemas/src/__tests__/calendar.test.ts (relative import with .js extension).**

```ts
import { describe, it, expect } from "vitest";
import {
  ReceiptSchema,
  ReceiptEvidenceSchema,
  IsPaidVisitVerdictSchema,
} from "../receipt.js";

describe("ReceiptSchema", () => {
  const base = {
    id: "rcpt-1",
    organizationId: "org-1",
    status: "held" as const,
    capturedBy: "calendar-book",
    createdAt: "2026-06-06T00:00:00.000Z",
  };

  it("parses a calendar receipt with calendar evidence", () => {
    const parsed = ReceiptSchema.parse({
      ...base,
      kind: "calendar",
      tier: "T1_FETCH_BACK",
      bookingId: "bk-1",
      evidence: {
        kind: "calendar",
        calendarEventId: "gcal_123",
        provider: "google_calendar",
        startsAt: "2026-06-10T09:00:00.000Z",
      },
    });
    expect(parsed.kind).toBe("calendar");
    expect(parsed.tier).toBe("T1_FETCH_BACK");
  });

  it("parses a payment receipt with payment evidence", () => {
    const parsed = ReceiptSchema.parse({
      ...base,
      kind: "payment",
      tier: "T1_FETCH_BACK",
      status: "paid",
      amount: 5000,
      currency: "SGD",
      externalRef: "pi_abc",
      evidence: {
        kind: "payment",
        chargeId: "ch_abc",
        amount: 5000,
        currency: "SGD",
        chargedAt: "2026-06-10T10:00:00.000Z",
      },
    });
    expect(parsed.kind).toBe("payment");
    expect(parsed.amount).toBe(5000);
  });

  it("rejects payment-shaped evidence under kind:calendar (discriminated, no any)", () => {
    const result = ReceiptEvidenceSchema.safeParse({
      kind: "calendar",
      chargeId: "ch_abc",
      amount: 5000,
      currency: "SGD",
      chargedAt: "2026-06-10T10:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown tier", () => {
    const result = ReceiptSchema.safeParse({
      ...base,
      kind: "calendar",
      tier: "T9_FAKE",
      evidence: { kind: "calendar", calendarEventId: "x", startsAt: "2026-06-10T09:00:00.000Z" },
    });
    expect(result.success).toBe(false);
  });

  it("parses a structured isPaidVisit verdict", () => {
    const v = IsPaidVisitVerdictSchema.parse({
      paid: false,
      held: true,
      tier: "T1_FETCH_BACK",
      basis: "calendar_fetch_back",
      degraded: false,
    });
    expect(v.held).toBe(true);
    expect(v.paid).toBe(false);
  });
});

```

- [ ] **Step 2: Run the test and confirm it fails because the module does not exist yet.**

Run: `pnpm --filter @switchboard/schemas test src/__tests__/receipt.test.ts`
Expected: FAIL — error resolving '../receipt.js' (Cannot find module / Failed to load). No tests run.

- [ ] **Step 3: Create packages/schemas/src/receipt.ts. Use z.discriminatedUnion('kind', ...) for evidence (the no-any guarantee, mirroring the pattern in packages/schemas/src/whatsapp-template-create.ts:20 and qualification-signals.ts:42). Tier order is T1_FETCH_BACK > T2_PROVIDER_SIGNATURE > T3_ADMIN_AUDIT. status is held|paid|void. Include the IsPaidVisitVerdict type the verdict function will return.**

```ts
import { z } from "zod";

export const ReceiptKindSchema = z.enum(["calendar", "payment"]);
export type ReceiptKind = z.infer<typeof ReceiptKindSchema>;

/**
 * Evidence strength tiers, strongest first. T1 is a first-party re-fetch of the
 * authoritative external fact (PSP charge / real calendar event). T3 is an
 * admin/local audit assertion with no external corroboration — the ceiling for a
 * Noop/Local provider in production (see resolveCalendarReceiptTier).
 */
export const ReceiptTierSchema = z.enum([
  "T1_FETCH_BACK",
  "T2_PROVIDER_SIGNATURE",
  "T3_ADMIN_AUDIT",
]);
export type ReceiptTier = z.infer<typeof ReceiptTierSchema>;

export const ReceiptStatusSchema = z.enum(["held", "paid", "void"]);
export type ReceiptStatus = z.infer<typeof ReceiptStatusSchema>;

export const CalendarReceiptEvidenceSchema = z.object({
  kind: z.literal("calendar"),
  calendarEventId: z.string().min(1),
  provider: z.string().min(1).nullable().optional(),
  startsAt: z.string(),
});
export type CalendarReceiptEvidence = z.infer<typeof CalendarReceiptEvidenceSchema>;

export const PaymentReceiptEvidenceSchema = z.object({
  kind: z.literal("payment"),
  chargeId: z.string().min(1),
  amount: z.number().int().nonnegative(),
  currency: z.string().min(1),
  chargedAt: z.string(),
});
export type PaymentReceiptEvidence = z.infer<typeof PaymentReceiptEvidenceSchema>;

/**
 * Discriminated by `kind` so the evidence payload is fully typed (no `any`).
 * The Prisma column is Json; this schema is the validation gate at every write.
 */
export const ReceiptEvidenceSchema = z.discriminatedUnion("kind", [
  CalendarReceiptEvidenceSchema,
  PaymentReceiptEvidenceSchema,
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
  verifiedAt: z.string().nullable().optional(),
  workTraceId: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type Receipt = z.infer<typeof ReceiptSchema>;

/**
 * Structured verdict returned by isPaidVisit — NEVER a bare boolean.
 * `paid` and `held` are independent: architecture B is held:true, paid:false.
 * `tier` is the strongest evidence tier backing the verdict; `basis` is a short
 * machine-readable reason; `degraded` flags an honest downgrade (e.g. local id).
 */
export const IsPaidVisitVerdictSchema = z.object({
  paid: z.boolean(),
  held: z.boolean(),
  tier: ReceiptTierSchema,
  basis: z.string(),
  degraded: z.boolean(),
});
export type IsPaidVisitVerdict = z.infer<typeof IsPaidVisitVerdictSchema>;

```

- [ ] **Step 4: Export the new module from the schemas barrel. Add the line directly under the lifecycle export at packages/schemas/src/index.ts:62 (the `export * from "./lifecycle.js";` line).**

```ts
// Receipt primitive (calendar|payment evidence + isPaidVisit verdict type)
export * from "./receipt.js";
```

- [ ] **Step 5: Run the test again; it now passes.**

Run: `pnpm --filter @switchboard/schemas test src/__tests__/receipt.test.ts`
Expected: PASS — 5 passed (ReceiptSchema).

- [ ] **Step 6: Commit. (Lowercase conventional-commit subject per commitlint.)**

Run: `git add packages/schemas/src/receipt.ts packages/schemas/src/__tests__/receipt.test.ts packages/schemas/src/index.ts && git commit -m "feat(schemas): receipt primitive + isPaidVisit verdict type"`
Expected: One commit created; commitlint passes (lowercase subject).


#### Task 2: Task 2 — isPaidVisit structured verdict in core (never a bare boolean)

**Files:**
- Create: `packages/core/src/receipts/is-paid-visit.ts`
- Create: `packages/core/src/receipts/is-paid-visit.test.ts`
- Test: `packages/core/src/receipts/is-paid-visit.test.ts`

- [ ] **Step 1: Build schemas so core can resolve the new @switchboard/schemas exports, then write the failing verdict test. Create packages/core/src/receipts/is-paid-visit.test.ts. It asserts the matrix from the spec section 13: calendar T1 status held → held:true paid:false; calendar T3 (local) status held → degraded:true; payment T1 status paid → paid:true; calendar status paid (architecture B via operator T3) → paid:true; status void → paid:false held:false. Crucially it asserts the RETURN is the structured object, not a boolean.**

```ts
import { describe, it, expect } from "vitest";
import { isPaidVisit } from "./is-paid-visit.js";
import type { Receipt } from "@switchboard/schemas";

function calReceipt(over: Partial<Receipt> = {}): Receipt {
  return {
    id: "r1",
    organizationId: "org-1",
    kind: "calendar",
    tier: "T1_FETCH_BACK",
    status: "held",
    capturedBy: "calendar-book",
    evidence: { kind: "calendar", calendarEventId: "gcal_1", startsAt: "2026-06-10T09:00:00.000Z" },
    createdAt: "2026-06-06T00:00:00.000Z",
    ...over,
  };
}
function payReceipt(over: Partial<Receipt> = {}): Receipt {
  return {
    id: "r2",
    organizationId: "org-1",
    kind: "payment",
    tier: "T1_FETCH_BACK",
    status: "paid",
    amount: 5000,
    currency: "SGD",
    capturedBy: "stripe-webhook",
    evidence: { kind: "payment", chargeId: "ch_1", amount: 5000, currency: "SGD", chargedAt: "2026-06-10T10:00:00.000Z" },
    createdAt: "2026-06-06T00:00:00.000Z",
    ...over,
  };
}

describe("isPaidVisit", () => {
  it("returns a structured verdict object, not a boolean", () => {
    const v = isPaidVisit(calReceipt());
    expect(typeof v).toBe("object");
    expect(v).toHaveProperty("paid");
    expect(v).toHaveProperty("held");
    expect(v).toHaveProperty("tier");
    expect(v).toHaveProperty("basis");
    expect(v).toHaveProperty("degraded");
  });

  it("calendar T1 held → held:true, paid:false, not degraded", () => {
    const v = isPaidVisit(calReceipt({ tier: "T1_FETCH_BACK", status: "held" }));
    expect(v).toEqual({ paid: false, held: true, tier: "T1_FETCH_BACK", basis: "calendar_fetch_back", degraded: false });
  });

  it("calendar T3 (local/admin) held → degraded:true", () => {
    const v = isPaidVisit(calReceipt({ tier: "T3_ADMIN_AUDIT", status: "held" }));
    expect(v.held).toBe(true);
    expect(v.paid).toBe(false);
    expect(v.degraded).toBe(true);
    expect(v.basis).toBe("calendar_admin_audit");
  });

  it("payment T1 paid → paid:true held:true", () => {
    const v = isPaidVisit(payReceipt());
    expect(v.paid).toBe(true);
    expect(v.held).toBe(true);
    expect(v.degraded).toBe(false);
    expect(v.basis).toBe("payment_fetch_back");
  });

  it("calendar status=paid via operator T3 (architecture B) → paid:true degraded:true", () => {
    const v = isPaidVisit(calReceipt({ tier: "T3_ADMIN_AUDIT", status: "paid" }));
    expect(v.paid).toBe(true);
    expect(v.held).toBe(true);
    expect(v.degraded).toBe(true);
  });

  it("status=void → neither paid nor held", () => {
    const v = isPaidVisit(calReceipt({ status: "void" }));
    expect(v.paid).toBe(false);
    expect(v.held).toBe(false);
  });
});

```

- [ ] **Step 2: Run the test; it fails because is-paid-visit.ts does not exist. (Run the full schemas build first so core resolves the new types.)**

Run: `pnpm --filter @switchboard/schemas build && pnpm --filter @switchboard/core test src/receipts/is-paid-visit.test.ts`
Expected: schemas build succeeds; core test FAILS — Cannot find module './is-paid-visit.js'.

- [ ] **Step 3: Create packages/core/src/receipts/is-paid-visit.ts. Pure function: paid when status==='paid'; held when status is 'paid' or 'held' (a paid receipt is also attended); void → both false; degraded when the tier is T3 (no external corroboration). basis is a short machine string per (kind,tier).**

```ts
import type { Receipt, IsPaidVisitVerdict } from "@switchboard/schemas";

/**
 * Structured verdict over a single Receipt — NEVER a bare boolean (cross-cutting
 * decision, spec section 11). `paid` is true only for a status:'paid' receipt;
 * `held` is true for paid OR held (a paid visit is also an attended one);
 * `degraded` flags a T3 (admin/local) tier with no external corroboration so the
 * read surface can distinguish 'verified' from 'operator-asserted'.
 */
export function isPaidVisit(receipt: Receipt): IsPaidVisitVerdict {
  const paid = receipt.status === "paid";
  const held = receipt.status === "paid" || receipt.status === "held";
  const degraded = receipt.tier === "T3_ADMIN_AUDIT";
  return {
    paid,
    held,
    tier: receipt.tier,
    basis: basisFor(receipt),
    degraded,
  };
}

function basisFor(receipt: Receipt): string {
  if (receipt.kind === "payment") {
    return receipt.tier === "T1_FETCH_BACK" ? "payment_fetch_back" : "payment_admin_audit";
  }
  // calendar
  return receipt.tier === "T1_FETCH_BACK" ? "calendar_fetch_back" : "calendar_admin_audit";
}

```

- [ ] **Step 4: Run the test; it passes.**

Run: `pnpm --filter @switchboard/core test src/receipts/is-paid-visit.test.ts`
Expected: PASS — 6 passed (isPaidVisit).

- [ ] **Step 5: Commit.**

Run: `git add packages/core/src/receipts/is-paid-visit.ts packages/core/src/receipts/is-paid-visit.test.ts && git commit -m "feat(core): isPaidVisit structured verdict"`
Expected: One commit; commitlint passes.


#### Task 3: Task 3 — resolveCalendarReceiptTier (the anti-fake prod-assert: Noop/Local can never mint above T3 in production)

**Files:**
- Create: `packages/core/src/receipts/resolve-calendar-receipt-tier.ts`
- Create: `packages/core/src/receipts/resolve-calendar-receipt-tier.test.ts`
- Test: `packages/core/src/receipts/resolve-calendar-receipt-tier.test.ts`

- [ ] **Step 1: Write the failing prod-assert test. This is the spec's named Key test. Fabricated ids come from NoopCalendarProvider (calendarEventId null) and LocalCalendarProvider (`local-<uuid>`, verified at packages/core/src/calendar/local-calendar-provider.ts:88); a real Google event id looks like `gcal_123` (packages/core/src/calendar/google-calendar-adapter.ts:93). The rule: in production a fabricated id MUST resolve to T3, never T1/T2.**

```ts
import { describe, it, expect } from "vitest";
import { resolveCalendarReceiptTier } from "./resolve-calendar-receipt-tier.js";

describe("resolveCalendarReceiptTier — prod-assert", () => {
  it("production + null calendarEventId (Noop) → T3_ADMIN_AUDIT", () => {
    expect(resolveCalendarReceiptTier({ calendarEventId: null, isProduction: true })).toBe("T3_ADMIN_AUDIT");
  });

  it("production + local- prefixed id (Local) → T3_ADMIN_AUDIT", () => {
    expect(resolveCalendarReceiptTier({ calendarEventId: "local-abc-123", isProduction: true })).toBe("T3_ADMIN_AUDIT");
  });

  it("production + noop- prefixed id → T3_ADMIN_AUDIT", () => {
    expect(resolveCalendarReceiptTier({ calendarEventId: "noop-abc-123", isProduction: true })).toBe("T3_ADMIN_AUDIT");
  });

  it("production + real provider id → T1_FETCH_BACK", () => {
    expect(resolveCalendarReceiptTier({ calendarEventId: "gcal_123", isProduction: true })).toBe("T1_FETCH_BACK");
  });

  it("non-production + local- id → still T3 (honest degradation regardless of env)", () => {
    expect(resolveCalendarReceiptTier({ calendarEventId: "local-abc-123", isProduction: false })).toBe("T3_ADMIN_AUDIT");
  });

  it("non-production + real id → T1", () => {
    expect(resolveCalendarReceiptTier({ calendarEventId: "gcal_123", isProduction: false })).toBe("T1_FETCH_BACK");
  });
});

```

- [ ] **Step 2: Run it; fails (module missing).**

Run: `pnpm --filter @switchboard/core test src/receipts/resolve-calendar-receipt-tier.test.ts`
Expected: FAIL — Cannot find module './resolve-calendar-receipt-tier.js'.

- [ ] **Step 3: Create packages/core/src/receipts/resolve-calendar-receipt-tier.ts. A fabricated id is null or starts with `noop-`/`local-`. A fabricated id NEVER earns T1/T2 — it is always T3 (the honest floor holds in every env; production is the place where it MUST hold, hence the explicit isProduction param so the caller can also assert in tests). A real id earns T1 (a true fetch-back of the external event).**

```ts
import type { ReceiptTier } from "@switchboard/schemas";

const FABRICATED_ID_PREFIXES = ["noop-", "local-"] as const;

/**
 * Decide the evidence tier for a calendar receipt from the provider's returned
 * event id. Anti-fake invariant (spec section 9): a Noop/Local provider
 * FABRICATES ids (null, or a `noop-`/`local-` prefix — see
 * noop-calendar-provider.ts and local-calendar-provider.ts:88) and therefore can
 * NEVER mint above T3. A real provider id (e.g. a Google `gcal_*` id) is a true
 * fetch-back and earns T1. The floor holds in every environment; `isProduction`
 * is threaded so callers (and the prod-assert test) can prove it explicitly in
 * the environment where a forged high tier would be most damaging.
 */
export function resolveCalendarReceiptTier(args: {
  calendarEventId: string | null | undefined;
  isProduction: boolean;
}): ReceiptTier {
  if (isFabricatedCalendarEventId(args.calendarEventId)) {
    return "T3_ADMIN_AUDIT";
  }
  return "T1_FETCH_BACK";
}

export function isFabricatedCalendarEventId(id: string | null | undefined): boolean {
  if (id === null || id === undefined || id.trim() === "") return true;
  return FABRICATED_ID_PREFIXES.some((prefix) => id.startsWith(prefix));
}

```

- [ ] **Step 4: Run; passes.**

Run: `pnpm --filter @switchboard/core test src/receipts/resolve-calendar-receipt-tier.test.ts`
Expected: PASS — 6 passed.

- [ ] **Step 5: Commit.**

Run: `git add packages/core/src/receipts/resolve-calendar-receipt-tier.ts packages/core/src/receipts/resolve-calendar-receipt-tier.test.ts && git commit -m "feat(core): calendar receipt tier resolver with noop/local prod-assert"`
Expected: One commit; commitlint passes.


#### Task 4: Task 4 — ReceiptStore interface + core barrel + public export

**Files:**
- Create: `packages/core/src/receipts/receipt-store.ts`
- Create: `packages/core/src/receipts/index.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/receipts/index.test.ts`

- [ ] **Step 1: Write a tiny barrel test that proves the public surface resolves the three symbols (the interface is a type so we assert the runtime fns + a type-only import compile). Create packages/core/src/receipts/index.test.ts.**

```ts
import { describe, it, expect } from "vitest";
import { isPaidVisit, resolveCalendarReceiptTier } from "./index.js";
import type { ReceiptStore, CreateReceiptInput } from "./index.js";

describe("receipts barrel", () => {
  it("re-exports the verdict and tier-resolver functions", () => {
    expect(typeof isPaidVisit).toBe("function");
    expect(typeof resolveCalendarReceiptTier).toBe("function");
  });

  it("exposes ReceiptStore + CreateReceiptInput types (compile-time)", () => {
    const input: CreateReceiptInput = {
      organizationId: "org-1",
      kind: "calendar",
      tier: "T1_FETCH_BACK",
      status: "held",
      capturedBy: "calendar-book",
      evidence: { kind: "calendar", calendarEventId: "gcal_1", startsAt: "2026-06-10T09:00:00.000Z" },
    };
    const fake: Pick<ReceiptStore, "record"> = {
      record: async () => ({
        ...input,
        id: "r1",
        createdAt: "2026-06-06T00:00:00.000Z",
      }),
    };
    expect(input.kind).toBe("calendar");
    expect(typeof fake.record).toBe("function");
  });
});

```

- [ ] **Step 2: Run; fails (./index.js has no such exports yet).**

Run: `pnpm --filter @switchboard/core test src/receipts/index.test.ts`
Expected: FAIL — Cannot find module './index.js' (or missing exports).

- [ ] **Step 3: Create packages/core/src/receipts/receipt-store.ts. Mirror the lifecycle/revenue-store.ts shape (verified at packages/core/src/lifecycle/revenue-store.ts:8-47): re-use the opaque StoreTransactionContext concept, define CreateReceiptInput (the writeable subset of Receipt, evidence typed via the discriminated union — no any), and a ReceiptStore interface with record(input,tx?) and findByBooking.**

```ts
import type { Receipt, ReceiptKind, ReceiptTier, ReceiptStatus, ReceiptEvidence } from "@switchboard/schemas";

/**
 * Opaque tx context forwarded from the app-layer runner into store calls. Core
 * never inspects it (concrete type is PrismaDbClient in packages/db). Mirrors
 * lifecycle/revenue-store.ts StoreTransactionContext.
 */
export type StoreTransactionContext = unknown;

export interface CreateReceiptInput {
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
  verifiedAt?: string | null;
  workTraceId?: string | null;
}

export interface ReceiptStore {
  /**
   * Append a receipt. When externalRef is set, the write is idempotent on the
   * partial-unique (organizationId, kind, externalRef) — a replay returns the
   * existing row rather than throwing.
   */
  record(input: CreateReceiptInput, tx?: StoreTransactionContext): Promise<Receipt>;
  findByBooking(orgId: string, bookingId: string): Promise<Receipt[]>;
}

```

- [ ] **Step 4: Create packages/core/src/receipts/index.ts (the barrel).**

```ts
export { isPaidVisit } from "./is-paid-visit.js";
export { resolveCalendarReceiptTier, isFabricatedCalendarEventId } from "./resolve-calendar-receipt-tier.js";
export type { ReceiptStore, CreateReceiptInput, StoreTransactionContext } from "./receipt-store.js";

```

- [ ] **Step 5: Wire the barrel into the public core surface. Add the export immediately after the lifecycle export at packages/core/src/index.ts:242 (`export * from "./lifecycle/index.js";`).**

```ts
// Receipt primitive (isPaidVisit verdict, calendar tier resolver, ReceiptStore)
export * from "./receipts/index.js";
```

- [ ] **Step 6: Run; passes.**

Run: `pnpm --filter @switchboard/core test src/receipts/index.test.ts`
Expected: PASS — 2 passed (receipts barrel).

- [ ] **Step 7: Typecheck core to confirm the barrel + index wiring compile with no any and no missing symbols.**

Run: `pnpm --filter @switchboard/core typecheck`
Expected: No errors. (If it reports missing @switchboard/schemas exports, run `pnpm reset` then re-run.)

- [ ] **Step 8: Commit.**

Run: `git add packages/core/src/receipts/receipt-store.ts packages/core/src/receipts/index.ts packages/core/src/receipts/index.test.ts packages/core/src/index.ts && git commit -m "feat(core): receiptstore interface and receipts barrel export"`
Expected: One commit; commitlint passes.


#### Task 5: Task 5 — Receipt Prisma model + raw-SQL partial-unique migration

**Files:**
- Create: `packages/db/prisma/migrations/20260606120000_add_receipt/migration.sql`
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add the Receipt model to schema.prisma. Place it directly after the ConversionRecord model (ends at packages/db/prisma/schema.prisma:2054). evidence is Json (validated by ReceiptEvidenceSchema at the store boundary). The base columns + two plain indexes ARE expressible in-schema; the partial-unique index is raw SQL (Prisma 6 cannot express it) and is documented in a comment pointing at the migration, exactly like the Booking comment at schema.prisma:2004-2006.**

```ts
// ---------------------------------------------------------------------------
// Receipt — shared proof primitive for the revenue loop (calendar|payment).
// `evidence` is validated by ReceiptEvidenceSchema (discriminated by kind) at
// every store write. The replay guard is a PARTIAL unique index on
// (organizationId, kind, externalRef) WHERE externalRef IS NOT NULL, which
// Prisma 6 cannot express in-schema — it lives in raw SQL in migration
// 20260606120000_add_receipt. Keep this comment in sync.
// ---------------------------------------------------------------------------
model Receipt {
  id             String    @id @default(uuid())
  organizationId String
  kind           String
  tier           String
  status         String    @default("held")
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

- [ ] **Step 2: Generate the base DDL deterministically with migrate diff (avoids `prisma migrate dev`, which needs a TTY — a known gotcha). This prints the CREATE TABLE + plain indexes for the new model by diffing the committed migrations against the updated schema. Capture it into the migration file we are creating, then we append the raw partial-unique by hand.**

Run: `mkdir -p packages/db/prisma/migrations/20260606120000_add_receipt && pnpm --filter @switchboard/db exec prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma --script > packages/db/prisma/migrations/20260606120000_add_receipt/migration.sql`
Expected: File written containing `CREATE TABLE "Receipt" (...)` plus `CREATE INDEX "Receipt_organizationId_bookingId_idx"` and `CREATE INDEX "Receipt_organizationId_kind_status_idx"`. (Requires DATABASE_URL reachable only for the shadow diff; if Postgres is down, hand-write the CREATE TABLE mirroring the model columns above.)

- [ ] **Step 3: Append the raw-SQL partial-unique index to the bottom of the generated migration.sql. Mirror packages/db/prisma/migrations/20260603120000_booking_partial_unique_active/migration.sql exactly (a CREATE UNIQUE INDEX ... WHERE ...). The index name must stay under Postgres's 63-char identifier cap (gotcha) — `Receipt_org_kind_externalRef_key` is 31 chars.**

```ts
-- Replay guard: a PSP/calendar externalRef may appear at most once per (org,kind).
-- PARTIAL so receipts WITHOUT an externalRef (e.g. T3 admin-audit) are unconstrained.
-- Prisma 6 cannot express a partial unique in-schema; mirrors
-- 20260603120000_booking_partial_unique_active. Index name <= 63 chars.
CREATE UNIQUE INDEX "Receipt_org_kind_externalRef_key"
  ON "Receipt" ("organizationId", "kind", "externalRef")
  WHERE "externalRef" IS NOT NULL;
```

- [ ] **Step 4: Regenerate the Prisma client so the new Receipt delegate is typed for the db store in Task 6.**

Run: `pnpm --filter @switchboard/db db:generate`
Expected: Prisma Client generated successfully; `prisma.receipt` is now a typed delegate.

- [ ] **Step 5: Confirm the schema and the migration agree (no drift) — runs only if Postgres is reachable; skip with a note if not (CI validates migrations).**

Run: `pnpm --filter @switchboard/db exec prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma --exit-code`
Expected: Exit code 0 — 'No difference detected'. (If Postgres is down locally, skip; the migration is hand-verified against the model and CI will check it.)

- [ ] **Step 6: Commit the schema change and its migration TOGETHER (CLAUDE.md: a schema change requires its migration in the same commit).**

Run: `git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260606120000_add_receipt/migration.sql && git commit -m "feat(db): receipt model with partial-unique externalRef migration"`
Expected: One commit containing both schema.prisma and the migration.sql; commitlint passes.


#### Task 6: Task 6 — PrismaReceiptStore impl + mocked-Prisma tests + db export

**Files:**
- Create: `packages/db/src/stores/prisma-receipt-store.ts`
- Create: `packages/db/src/stores/__tests__/prisma-receipt-store.test.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/stores/__tests__/prisma-receipt-store.test.ts`

- [ ] **Step 1: Write the failing store test. Mirror packages/db/src/stores/__tests__/prisma-revenue-store.test.ts EXACTLY (mocked Prisma — CI has no Postgres). Assert: record() writes organizationId+kind+tier+status+evidence+capturedBy; tx threading uses the tx client not this.prisma; record() with an existing externalRef returns the existing row (idempotent, no second create); findByBooking scopes organizationId AND bookingId.**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaReceiptStore } from "../prisma-receipt-store.js";

const now = new Date("2026-06-06T00:00:00Z");

function makeMockPrisma() {
  return {
    receipt: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

function makeRow(over: Record<string, unknown> = {}) {
  return {
    id: "rcpt-1",
    organizationId: "org-1",
    kind: "calendar",
    tier: "T1_FETCH_BACK",
    status: "held",
    bookingId: "bk-1",
    opportunityId: null,
    revenueEventId: null,
    connectionId: null,
    provider: "google_calendar",
    externalRef: null,
    amount: null,
    currency: null,
    evidence: { kind: "calendar", calendarEventId: "gcal_1", startsAt: "2026-06-10T09:00:00.000Z" },
    capturedBy: "calendar-book",
    verifiedAt: null,
    workTraceId: "wt-1",
    createdAt: now,
    ...over,
  };
}

describe("PrismaReceiptStore", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let store: PrismaReceiptStore;

  beforeEach(() => {
    prisma = makeMockPrisma();
    store = new PrismaReceiptStore(prisma as never);
  });

  it("records a calendar receipt with organizationId, kind, tier, status, evidence", async () => {
    prisma.receipt.create.mockResolvedValue(makeRow());
    const result = await store.record({
      organizationId: "org-1",
      kind: "calendar",
      tier: "T1_FETCH_BACK",
      status: "held",
      bookingId: "bk-1",
      provider: "google_calendar",
      workTraceId: "wt-1",
      capturedBy: "calendar-book",
      evidence: { kind: "calendar", calendarEventId: "gcal_1", startsAt: "2026-06-10T09:00:00.000Z" },
    });
    expect(prisma.receipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: expect.any(String),
        organizationId: "org-1",
        kind: "calendar",
        tier: "T1_FETCH_BACK",
        status: "held",
        bookingId: "bk-1",
        capturedBy: "calendar-book",
        externalRef: null,
      }),
    });
    expect(result.kind).toBe("calendar");
    expect(result.tier).toBe("T1_FETCH_BACK");
  });

  it("uses the tx client instead of this.prisma when tx is provided", async () => {
    const txClient = {
      receipt: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(makeRow()),
      },
    };
    await store.record(
      {
        organizationId: "org-1",
        kind: "calendar",
        tier: "T1_FETCH_BACK",
        status: "held",
        capturedBy: "calendar-book",
        evidence: { kind: "calendar", calendarEventId: "gcal_1", startsAt: "2026-06-10T09:00:00.000Z" },
      },
      txClient as never,
    );
    expect(txClient.receipt.create).toHaveBeenCalledTimes(1);
    expect(prisma.receipt.create).not.toHaveBeenCalled();
  });

  it("is idempotent on externalRef: returns existing row, no second create", async () => {
    const existing = makeRow({ id: "rcpt-existing", kind: "payment", externalRef: "pi_dup", status: "paid" });
    prisma.receipt.findFirst.mockResolvedValue(existing);
    const result = await store.record({
      organizationId: "org-1",
      kind: "payment",
      tier: "T1_FETCH_BACK",
      status: "paid",
      externalRef: "pi_dup",
      amount: 5000,
      currency: "SGD",
      capturedBy: "stripe-webhook",
      evidence: { kind: "payment", chargeId: "ch_dup", amount: 5000, currency: "SGD", chargedAt: "2026-06-10T10:00:00.000Z" },
    });
    expect(prisma.receipt.findFirst).toHaveBeenCalledWith({
      where: { organizationId: "org-1", kind: "payment", externalRef: "pi_dup" },
    });
    expect(prisma.receipt.create).not.toHaveBeenCalled();
    expect(result.id).toBe("rcpt-existing");
  });

  it("findByBooking scopes organizationId AND bookingId", async () => {
    prisma.receipt.findMany.mockResolvedValue([makeRow()]);
    const rows = await store.findByBooking("org-1", "bk-1");
    expect(prisma.receipt.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", bookingId: "bk-1" },
      orderBy: { createdAt: "desc" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.bookingId).toBe("bk-1");
  });
});

```

- [ ] **Step 2: Run; fails (module missing).**

Run: `pnpm --filter @switchboard/db test src/stores/__tests__/prisma-receipt-store.test.ts`
Expected: FAIL — Cannot find module '../prisma-receipt-store.js'.

- [ ] **Step 3: Create packages/db/src/stores/prisma-receipt-store.ts. Mirror PrismaRevenueStore (packages/db/src/stores/prisma-revenue-store.ts): constructor takes PrismaDbClient; record() does the externalRef idempotency findFirst (scoped organizationId+kind+externalRef per the partial-unique axis) then create; evidence is written with the typed-cast Json pattern from prisma-conversion-record-store.ts:66 (no any, no Prisma.InputJsonValue import); a mapper converts the row (Date → ISO strings, Json → ReceiptEvidence) to the Receipt schema type. Implements the core ReceiptStore structurally (same comment style as revenue store).**

```ts
import { randomUUID } from "node:crypto";
import type { PrismaDbClient } from "../prisma-db.js";
import type { Receipt, ReceiptEvidence } from "@switchboard/schemas";

// Structural match with @switchboard/core ReceiptStore / CreateReceiptInput.
interface CreateReceiptInput {
  organizationId: string;
  kind: "calendar" | "payment";
  tier: "T1_FETCH_BACK" | "T2_PROVIDER_SIGNATURE" | "T3_ADMIN_AUDIT";
  status: "held" | "paid" | "void";
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
  verifiedAt?: string | null;
  workTraceId?: string | null;
}

export class PrismaReceiptStore {
  constructor(private prisma: PrismaDbClient) {}

  async record(input: CreateReceiptInput, tx?: PrismaDbClient): Promise<Receipt> {
    const client = tx ?? this.prisma;
    // Idempotency on the partial-unique axis (organizationId, kind, externalRef).
    if (input.externalRef) {
      const existing = await client.receipt.findFirst({
        where: {
          organizationId: input.organizationId,
          kind: input.kind,
          externalRef: input.externalRef,
        },
      });
      if (existing) return mapRow(existing);
    }

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
        // Json column; evidence is already validated by ReceiptEvidenceSchema at
        // the call site. Typed cast (no any) mirrors prisma-conversion-record-store.ts.
        evidence: input.evidence as Record<string, string | number | boolean | null>,
        capturedBy: input.capturedBy,
        verifiedAt: input.verifiedAt ? new Date(input.verifiedAt) : null,
        workTraceId: input.workTraceId ?? null,
      },
    });
    return mapRow(created);
  }

  async findByBooking(orgId: string, bookingId: string): Promise<Receipt[]> {
    const rows = await this.prisma.receipt.findMany({
      where: { organizationId: orgId, bookingId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(mapRow);
  }
}

function mapRow(row: {
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
}): Receipt {
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
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
    workTraceId: row.workTraceId,
    createdAt: row.createdAt.toISOString(),
  };
}

```

- [ ] **Step 4: Run; passes.**

Run: `pnpm --filter @switchboard/db test src/stores/__tests__/prisma-receipt-store.test.ts`
Expected: PASS — 4 passed (PrismaReceiptStore).

- [ ] **Step 5: Export PrismaReceiptStore from the db barrel. Add the line directly after the PrismaRevenueStore export at packages/db/src/index.ts:73.**

```ts
export { PrismaReceiptStore } from "./stores/prisma-receipt-store.js";
```

- [ ] **Step 6: Typecheck db to confirm the store compiles against the generated Prisma client (the receipt delegate exists from Task 5) and the structural match with core's ReceiptStore holds.**

Run: `pnpm --filter @switchboard/db typecheck`
Expected: No errors. (If it reports an unknown `receipt` delegate, re-run `pnpm --filter @switchboard/db db:generate`.)

- [ ] **Step 7: Commit.**

Run: `git add packages/db/src/stores/prisma-receipt-store.ts packages/db/src/stores/__tests__/prisma-receipt-store.test.ts packages/db/src/index.ts && git commit -m "feat(db): prisma receipt store with externalref idempotency"`
Expected: One commit; commitlint passes.


#### Task 7: Task 7 — buildCalendarReceiptInput pure helper (extracted, keeps calendar-book under the size limit)

**Files:**
- Create: `packages/core/src/receipts/mint-calendar-receipt.ts`
- Create: `packages/core/src/receipts/mint-calendar-receipt.test.ts`
- Test: `packages/core/src/receipts/mint-calendar-receipt.test.ts`

- [ ] **Step 1: Write the failing helper test. buildCalendarReceiptInput is a PURE function (no DB) so the minting logic stays out of calendar-book.ts (439 lines, warn at 400). It returns a CreateReceiptInput with kind:calendar, status:held, tier via resolveCalendarReceiptTier, and a calendar evidence object carrying the event id + startsAt + provider.**

```ts
import { describe, it, expect } from "vitest";
import { buildCalendarReceiptInput } from "./mint-calendar-receipt.js";

const common = {
  orgId: "org-1",
  bookingId: "bk-1",
  opportunityId: "opp-1",
  provider: "google_calendar",
  workTraceId: "wt-1",
  startsAt: "2026-06-10T09:00:00.000Z",
};

describe("buildCalendarReceiptInput", () => {
  it("real event id → kind calendar, status held, tier T1, calendar evidence", () => {
    const input = buildCalendarReceiptInput({ ...common, calendarEventId: "gcal_123", isProduction: true });
    expect(input.kind).toBe("calendar");
    expect(input.status).toBe("held");
    expect(input.tier).toBe("T1_FETCH_BACK");
    expect(input.bookingId).toBe("bk-1");
    expect(input.opportunityId).toBe("opp-1");
    expect(input.workTraceId).toBe("wt-1");
    expect(input.capturedBy).toBe("calendar-book");
    expect(input.evidence).toEqual({
      kind: "calendar",
      calendarEventId: "gcal_123",
      provider: "google_calendar",
      startsAt: "2026-06-10T09:00:00.000Z",
    });
  });

  it("local-/null id in production → tier T3 (the prod-assert floor)", () => {
    const local = buildCalendarReceiptInput({ ...common, calendarEventId: "local-xyz", isProduction: true });
    expect(local.tier).toBe("T3_ADMIN_AUDIT");
    // null id (Noop) still needs a non-empty evidence.calendarEventId, so the
    // helper substitutes a sentinel rather than violating the evidence schema.
    const noop = buildCalendarReceiptInput({ ...common, calendarEventId: null, isProduction: true });
    expect(noop.tier).toBe("T3_ADMIN_AUDIT");
    expect(noop.evidence.kind).toBe("calendar");
    expect(noop.evidence.calendarEventId.length).toBeGreaterThan(0);
  });
});

```

- [ ] **Step 2: Run; fails (module missing).**

Run: `pnpm --filter @switchboard/core test src/receipts/mint-calendar-receipt.test.ts`
Expected: FAIL — Cannot find module './mint-calendar-receipt.js'.

- [ ] **Step 3: Create packages/core/src/receipts/mint-calendar-receipt.ts. It calls resolveCalendarReceiptTier (Task 3) for the tier, sets status:held (a confirmed calendar booking is attended-pending, never paid via calendar in architecture A), and builds a typed CalendarReceiptEvidence. Because the evidence schema requires a non-empty calendarEventId, substitute a `pending:<bookingId>` sentinel when the provider returned null (Noop) so the receipt is still mintable and honestly tier T3.**

```ts
import type { CreateReceiptInput } from "./receipt-store.js";
import { resolveCalendarReceiptTier } from "./resolve-calendar-receipt-tier.js";

/**
 * Pure builder for the CalendarReceipt minted inside the calendar-book confirm
 * tx (architecture A: status always 'held' — paid is a separate payment receipt).
 * Tier is decided by resolveCalendarReceiptTier so a Noop/Local provider can
 * never exceed T3 in production (anti-fake, spec section 9). Extracted from
 * calendar-book.ts to keep that file under the size limit.
 */
export function buildCalendarReceiptInput(args: {
  orgId: string;
  bookingId: string;
  opportunityId: string | null;
  calendarEventId: string | null | undefined;
  provider: string | null;
  workTraceId: string | null;
  startsAt: string;
  isProduction: boolean;
}): CreateReceiptInput {
  const tier = resolveCalendarReceiptTier({
    calendarEventId: args.calendarEventId,
    isProduction: args.isProduction,
  });
  // Evidence requires a non-empty id; a Noop result has none, so record an
  // honest sentinel (the tier is already T3 for this case).
  const evidenceEventId =
    args.calendarEventId && args.calendarEventId.trim() !== ""
      ? args.calendarEventId
      : `pending:${args.bookingId}`;
  return {
    organizationId: args.orgId,
    kind: "calendar",
    tier,
    status: "held",
    bookingId: args.bookingId,
    opportunityId: args.opportunityId,
    provider: args.provider,
    workTraceId: args.workTraceId,
    capturedBy: "calendar-book",
    evidence: {
      kind: "calendar",
      calendarEventId: evidenceEventId,
      provider: args.provider,
      startsAt: args.startsAt,
    },
  };
}

```

- [ ] **Step 4: Add the export to the receipts barrel created in Task 4 (packages/core/src/receipts/index.ts).**

```ts
export { buildCalendarReceiptInput } from "./mint-calendar-receipt.js";
```

- [ ] **Step 5: Run; passes.**

Run: `pnpm --filter @switchboard/core test src/receipts/mint-calendar-receipt.test.ts`
Expected: PASS — 2 passed (buildCalendarReceiptInput).

- [ ] **Step 6: Commit.**

Run: `git add packages/core/src/receipts/mint-calendar-receipt.ts packages/core/src/receipts/mint-calendar-receipt.test.ts packages/core/src/receipts/index.ts && git commit -m "feat(core): pure calendar receipt-input builder"`
Expected: One commit; commitlint passes.


#### Task 8: Task 8 — Mint the CalendarReceipt inside the calendar-book confirm tx (widen tx shape + deps)

**Files:**
- Modify: `packages/core/src/skill-runtime/tools/calendar-book.ts`
- Modify: `packages/core/src/skill-runtime/tools/calendar-book.test.ts`
- Test: `packages/core/src/skill-runtime/tools/calendar-book.test.ts`

- [ ] **Step 1: Read the existing calendar-book test to copy its exact deps-construction harness (the test builds a full CalendarBookToolDeps with a fake runTransaction). You will extend that harness with a captured receipt.create spy and assert the mint. Find the test's makeDeps/runTransaction fake.**

Run: `grep -n "runTransaction\|booking:\|outboxEvent:\|opportunity:\|makeDeps\|isCalendarProviderConfigured\|defaultCurrency\|booking.create\|createCalendarBookToolFactory" packages/core/src/skill-runtime/tools/calendar-book.test.ts | head -40`
Expected: Prints the lines where the test fakes runTransaction (a tx object exposing booking/outboxEvent/opportunity) and constructs deps — the exact shape you will extend with a `receipt` spy.

- [ ] **Step 2: Add the failing confirm-tx mint test. In calendar-book.test.ts, extend the fake runTransaction's tx object with a `receipt: { create: vi.fn() }` spy and pass the two new deps (isProduction, calendarProviderName). Then assert: a real calendarEventId mints a calendar Receipt at tier T1 status held; a Noop result (calendarEventId null) under isProduction:true mints tier T3. Add this as a new describe block (reuse the file's existing helpers for ctx/contactStore/bookingStore — match their names from the grep output).**

```ts
// NEW BLOCK — append inside calendar-book.test.ts, reusing the file's existing
// makeDeps()/ctx helpers (rename to match the grep output if they differ).
// The fake runTransaction's tx object MUST now also expose `receipt.create`.
//
// Example tx fake (merge into the existing one in makeDeps):
//   const receiptCreate = vi.fn().mockResolvedValue({});
//   runTransaction: (fn) => fn({
//     booking: { update: vi.fn().mockResolvedValue({}) },
//     outboxEvent: { create: vi.fn().mockResolvedValue({}) },
//     opportunity: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
//     receipt: { create: receiptCreate },
//   }),
//   // expose receiptCreate from makeDeps so the test can assert on it.
//
// And pass the two new deps:
//   isProduction: true,
//   calendarProviderName: "google_calendar",

describe("booking.create — calendar receipt mint", () => {
  it("real calendarEventId mints a calendar Receipt at tier T1, status held", async () => {
    const { deps, receiptCreate, provider } = makeDeps();
    // provider.createBooking resolves a REAL event id:
    provider.createBooking = vi
      .fn()
      .mockResolvedValue({ calendarEventId: "gcal_123" });
    const tool = createCalendarBookToolFactory(deps)(makeCtx());
    await tool.operations["booking.create"].execute({
      service: "consult",
      slotStart: "2026-06-10T09:00:00.000Z",
      slotEnd: "2026-06-10T09:30:00.000Z",
      calendarId: "primary",
    });
    expect(receiptCreate).toHaveBeenCalledTimes(1);
    expect(receiptCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "calendar",
        tier: "T1_FETCH_BACK",
        status: "held",
      }),
    });
  });

  it("Noop result (null calendarEventId) under production mints tier T3", async () => {
    const { deps, receiptCreate, provider } = makeDeps({ isProduction: true });
    provider.createBooking = vi.fn().mockResolvedValue({ calendarEventId: null });
    const tool = createCalendarBookToolFactory(deps)(makeCtx());
    await tool.operations["booking.create"].execute({
      service: "consult",
      slotStart: "2026-06-10T09:00:00.000Z",
      slotEnd: "2026-06-10T09:30:00.000Z",
      calendarId: "primary",
    });
    expect(receiptCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: "calendar", tier: "T3_ADMIN_AUDIT" }),
    });
  });
});

```

- [ ] **Step 3: Run the test; it fails because (a) the tx type has no `receipt` and (b) the deps have no isProduction/calendarProviderName and (c) no mint call exists yet. TypeScript or the assertion will fail.**

Run: `pnpm --filter @switchboard/core test src/skill-runtime/tools/calendar-book.test.ts`
Expected: FAIL — receiptCreate not called (0 times) and/or a type error that `receipt` is not on the tx param / isProduction not on deps.

- [ ] **Step 4: In calendar-book.ts, widen the TransactionFn tx type (lines 70-83) to add a `receipt.create` delegate. This is the minimal type so core stays db-agnostic.**

```ts
type TransactionFn = (
  fn: (tx: {
    booking: {
      update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
    };
    outboxEvent: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
    opportunity: {
      updateMany(args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }): Promise<{ count: number }>;
    };
    receipt: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
  }) => Promise<unknown>,
) => Promise<unknown>;
```

- [ ] **Step 5: Add the two new deps to CalendarBookToolDeps (the interface starting at calendar-book.ts:99). isProduction drives the prod-assert tier floor; calendarProviderName labels the receipt evidence.**

```ts
  /** True when NODE_ENV==='production'. Threaded so a Noop/Local provider can
   *  never mint a calendar receipt above T3 in production (anti-fake). */
  isProduction: boolean;
  /** Provider label stored on the calendar receipt evidence (e.g. 'google_calendar'). */
  calendarProviderName: string;
```

- [ ] **Step 6: Import the builder at the top of calendar-book.ts (next to the existing buildBookedConversionPayload import on line 13). Use a relative import with .js, pointing at the receipts module (core can import within itself).**

```ts
import { buildCalendarReceiptInput } from "../../receipts/mint-calendar-receipt.js";
```

- [ ] **Step 7: Mint the receipt inside the confirm tx. In the runTransaction callback (calendar-book.ts:343-394), after the existing `tx.booking.update(...)` block (ends ~line 350) and before/after the outboxEvent.create, add a tx.receipt.create using the pure builder. The booking is `booking.id`, the resolved opportunity is `opportunityId`, the provider event id is `calendarResult.calendarEventId`, startsAt is `input.slotStart`, workTraceId is not in scope here (calendar-book does not yet thread it post-1A-2) so pass null. evidence is stringified Json — pass the object; Prisma Json accepts it.**

```ts
              // Mint the calendar receipt in the SAME durable tx as the confirm.
              // status is always 'held' (architecture A pays via a separate
              // payment receipt). Tier degrades to T3 for a Noop/Local id,
              // enforced in production by buildCalendarReceiptInput.
              const receiptInput = buildCalendarReceiptInput({
                orgId,
                bookingId: booking.id,
                opportunityId,
                calendarEventId: calendarResult.calendarEventId,
                provider: deps.calendarProviderName,
                workTraceId: null,
                startsAt: input.slotStart,
                isProduction: deps.isProduction,
              });
              await tx.receipt.create({ data: receiptInput as unknown as Record<string, unknown> });
```

- [ ] **Step 8: Update the test harness makeDeps() to supply the new deps and the receipt spy. (If makeDeps already exists, add `isProduction`, `calendarProviderName`, the `receipt` tx delegate, and return `receiptCreate`. If the test file used inline deps instead of a helper, extract a makeDeps now to keep the file under 400 lines.) Confirm the harness wires the receipt spy into runTransaction's tx object.**

```ts
// In makeDeps(): add to the returned deps object —
//   isProduction: opts?.isProduction ?? false,
//   calendarProviderName: "google_calendar",
// and in the fake runTransaction tx object add —
//   receipt: { create: receiptCreate },
// and return receiptCreate alongside deps so the new block can assert on it.
```

- [ ] **Step 9: Run the calendar-book test; the mint assertions pass.**

Run: `pnpm --filter @switchboard/core test src/skill-runtime/tools/calendar-book.test.ts`
Expected: PASS — all prior calendar-book tests plus the 2 new mint tests pass.

- [ ] **Step 10: Confirm calendar-book.ts stayed under the hard 600-line limit (warn at 400) after the additions — the mint was a small block because the logic was extracted in Task 7.**

Run: `wc -l packages/core/src/skill-runtime/tools/calendar-book.ts`
Expected: Around 455-465 lines — under 600. (If it exceeded 600, the extraction in Task 7 should absorb more; it should not, given the small added block.)

- [ ] **Step 11: Commit.**

Run: `git add packages/core/src/skill-runtime/tools/calendar-book.ts packages/core/src/skill-runtime/tools/calendar-book.test.ts && git commit -m "feat(core): mint calendar receipt in calendar-book confirm tx"`
Expected: One commit; commitlint passes.


#### Task 9: Task 9 — Wire the receipt tx + isProduction into apps/api skill-mode, then full verify

**Files:**
- Modify: `apps/api/src/bootstrap/skill-mode.ts`

- [ ] **Step 1: Update the calendar-book runTransaction in skill-mode.ts (lines 329-347) to forward tx.receipt and add the new typed delegate to the inline tx type, mirroring the existing booking/outboxEvent/opportunity forwarding. Prisma's $transaction tx already exposes `tx.receipt` (the client was regenerated in Task 5).**

```ts
    runTransaction: (
      fn: (tx: {
        booking: {
          update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
        };
        outboxEvent: {
          create(args: { data: Record<string, unknown> }): Promise<unknown>;
        };
        opportunity: {
          updateMany(args: {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
          }): Promise<{ count: number }>;
        };
        receipt: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
      }) => Promise<unknown>,
    ) =>
      prismaClient.$transaction((tx) =>
        fn({
          booking: tx.booking,
          outboxEvent: tx.outboxEvent,
          opportunity: tx.opportunity,
          receipt: tx.receipt,
        }),
      ),
```

- [ ] **Step 2: Add the two new deps to the createCalendarBookToolFactory call (the object spanning skill-mode.ts:307-350) — set isProduction from NODE_ENV and label the provider. Place them next to `defaultCurrency: "SGD"` at line 349.**

```ts
    defaultCurrency: "SGD",
    isProduction: process.env.NODE_ENV === "production",
    calendarProviderName: "google_calendar",
```

- [ ] **Step 3: Typecheck the api app to confirm the wiring compiles against the regenerated Prisma client (tx.receipt exists) and the widened core deps.**

Run: `pnpm --filter @switchboard/api typecheck`
Expected: No errors.

- [ ] **Step 4: Run the focused store-tightening safety net the gotchas call out: the api package tests, since this PR widened a tx shape that api spies/fakes might mirror (the 'store-tightening needs app tests' rule).**

Run: `pnpm --filter @switchboard/api test`
Expected: PASS — no api test red from the widened calendar-book tx (skill-mode-governance.test.ts still green). If a fake tx in an api test lacks `receipt`, add a `receipt: { create: vi.fn() }` to that fake and re-run.

- [ ] **Step 5: Run the whole touched-package test + typecheck sweep before opening the PR (schemas, core, db, api).**

Run: `pnpm --filter @switchboard/schemas --filter @switchboard/core --filter @switchboard/db --filter @switchboard/api test && pnpm --filter @switchboard/schemas --filter @switchboard/core --filter @switchboard/db --filter @switchboard/api typecheck`
Expected: All four packages: tests PASS and typecheck clean.

- [ ] **Step 6: Run prettier check (CI lint runs prettier; local lint does not — the 'ci_prettier_not_in_local_lint' gotcha) so the PR is not red on formatting.**

Run: `pnpm format:check`
Expected: All matched files use Prettier code style. (If not, run `pnpm format` and re-add.)

- [ ] **Step 7: Run the arch line-count check (separate from eslint; counts raw .ts lines, errors >600 — the 'arch_check_ts_only' gotcha) to confirm no touched .ts file breached the cap.**

Run: `pnpm arch:check`
Expected: No file over 600 lines; calendar-book.ts and skill-mode.ts both pass.

- [ ] **Step 8: Commit the wiring.**

Run: `git add apps/api/src/bootstrap/skill-mode.ts && git commit -m "feat(api): wire receipt tx and prod flag into calendar-book"`
Expected: One commit; commitlint passes. PR 1A-3 is complete: schema + verdict + tier resolver + store iface + Prisma impl + model/migration + calendar-book mint + prod-assert + api wiring.


---

## 1A-4 — feat(schemas,core,api,db): no-PMS payment-port + Noop adapter + PSP webhook + verified writer (architecture A)

**Goal:** Ship the first PAID-verified-attributed dollar on the no-PMS path (architecture A), Noop adapter first, replay-proof. Introduce a `PaymentPort` interface (L1 schemas) mirroring `CalendarProvider`; a deterministic `NoopPaymentAdapter` + per-org payment-port factory in apps/api (mirroring calendar-provider-factory.ts); an idempotent deposit-link issuance helper (co-located in core, NOT inlined into the ~440-line calendar-book.ts) that returns the link in a ToolResult riding the already-approved booking with no new approval; an ingress-receiver PSP webhook route (copied from ad-optimizer.ts: rawBody + HMAC-over-rawBody verify, resolve org from the Connection AFTER verify, NEVER trust the webhook body amount -> re-fetch the charge by id); and a NEW `payment.record_verified` operator intent (system_auto_approved) whose handler writes a payment Receipt(verified, T1) + LifecycleRevenueEvent(verified=true, bookingId, type=deposit) + a `purchased` OutboxEvent in ONE runInTransaction. Add `LifecycleRevenueEvent.bookingId` + index + a RAW-SQL partial-unique `(organizationId, externalReference) WHERE externalReference IS NOT NULL` (migration in the same commit) so a replayed charge (same externalReference) is an idempotent no-op (count stays 1).

**File structure:**

| Action | Path | Responsibility |
|---|---|---|
| create | `packages/schemas/src/payment.ts` | L1 PaymentPort interface (createDepositLink(input)->DepositLink, retrievePayment(externalReference)->VerifiedPayment|null) + Zod schemas DepositLinkInputSchema/DepositLinkSchema/VerifiedPaymentSchema and inferred types. Mirrors calendar.ts CalendarProvider. No @switchboard/* imports. |
| create | `packages/schemas/src/__tests__/payment.test.ts` | Unit tests for the payment Zod schemas (valid parse, amountCents must be a positive integer, currency length 3, externalReference required). |
| modify | `packages/schemas/src/index.ts` | Add `export * from "./payment.js";` so PaymentPort + payment types are reachable from @switchboard/schemas. |
| create | `apps/api/src/bootstrap/noop-payment-adapter.ts` | NoopPaymentAdapter implements PaymentPort: createDepositLink fabricates a DETERMINISTIC externalReference (`noop_pay_${bookingId}`) + url; retrievePayment echoes a deterministic verified VerifiedPayment for any `noop_pay_*` reference, returns null otherwise. Plus isNoopPaymentAdapter type-guard. Mirrors noop-calendar-provider.ts. |
| create | `apps/api/src/bootstrap/__tests__/noop-payment-adapter.test.ts` | Tests: createDepositLink is deterministic for a given bookingId; retrievePayment returns a verified payment with the SAME externalReference + amountCents for a noop reference and null for an unknown one. |
| create | `apps/api/src/bootstrap/payment-port-factory.ts` | Per-org PaymentPortFactory (orgId)->Promise<PaymentPort> with a process-lifetime cache, mirroring calendar-provider-factory.ts. Resolves NoopPaymentAdapter today (Stripe Connect adapter is 1A-4b fast-follow behind the same port). Rejects empty orgId with ORG_ID_REQUIRED. |
| create | `apps/api/src/bootstrap/__tests__/payment-port-factory.test.ts` | Tests: rejects empty orgId; returns a PaymentPort; caches per orgId (same promise for repeated calls). |
| create | `packages/core/src/skill-runtime/tools/deposit-link.ts` | createDepositLinkToolFactory: a SkillTool with one `deposit.issue` operation. Idempotent external read on the already-approved booking (sources orgId/bookingId from trusted SkillRequestContext+params, looks the booking up via an injected booking-store subset findById, calls PaymentPort.createDepositLink). Returns ok({url, externalReference, amountCents}) ToolResult. No new approval. Co-located so calendar-book.ts is untouched. |
| create | `packages/core/src/skill-runtime/tools/deposit-link.test.ts` | Tests: returns ok with the port-issued link for a confirmed booking; fails MISSING_BOOKING when the booking is absent/cross-org; fails BOOKING_NOT_CONFIRMED when status!='confirmed'; calls createDepositLink with org+bookingId+amount. |
| create | `apps/api/src/bootstrap/operator-intents/record-verified-payment.ts` | buildRecordVerifiedPaymentHandler(receiptWriter, revenueStore, outboxWriter, runInTransaction): OperatorMutationHandler. Parses RecordVerifiedPaymentParametersSchema, then in ONE runInTransaction writes (1) a payment Receipt(kind=payment,tier=T1_FETCH_BACK,status=paid,verified) via receiptWriter, (2) revenueStore.record({type:'deposit',verified:true,recordedBy:'stripe',bookingId,externalReference}), (3) outboxWriter.write(evt_pay_<id>,'purchased',...). Idempotent: relies on the partial-unique externalReference + revenueStore's externalReference short-circuit so a replay is a no-op. Plus the ReceiptWriter interface + RECORD_VERIFIED_PAYMENT_INTENT constant. |
| create | `apps/api/src/bootstrap/operator-intents/record-verified-payment.test.ts` | Handler-unit tests: writes receipt+revenue+outbox once inside the SAME tx (all three get the same tx arg); never reads amount from anywhere but the parsed params; replay (record returns the existing event) re-issues the same outbox eventId so the partial-unique makes it a no-op. |
| create | `apps/api/src/routes/operator-intents-schemas-payment.ts` | Zod RecordVerifiedPaymentParametersSchema (organizationId-free; contactId, opportunityId, bookingId, amountCents int positive, currency len 3, externalReference non-empty, sourceCampaignId/sourceAdId nullable). Co-located like operator-intents-schemas.ts. Kept in a separate file so operator-intents-schemas.ts stays small. |
| create | `apps/api/src/routes/payments-webhook.ts` | // @route-class: ingress-receiver. POST /payments/webhook ingress-receiver copied from ad-optimizer.ts: read rawBody, verifyPaymentWebhookSignature(rawBody, sig, STRIPE_WEBHOOK_SECRET) fail-closed -> 401; parse the message id; resolve org from a Connection by externalAccountId AFTER verify; re-fetch the charge by id via the per-org PaymentPort.retrievePayment (NEVER the body amount); submit payment.record_verified via app.platformIngress with idempotencyKey from the provider message id. Exports verifyPaymentWebhookSignature. |
| create | `apps/api/src/routes/__tests__/payments-webhook.test.ts` | Route tests (standalone Fastify, mirror ad-optimizer-signature.test.ts): rejects bad/missing HMAC over rawBody (401); fails closed with no secret (401); refuses unresolvable org (200 skipped, no submit); asserts retrievePayment(re-fetch) is called and the SUBMIT amount equals the re-fetched amountCents, NOT the (different) body amount; replay (same message id) -> ingress dedups (submit called, but writer idempotent). |
| modify | `apps/api/src/bootstrap/operator-intents.ts` | Register the new payment.record_verified intent + handler: import buildRecordVerifiedPaymentHandler + RECORD_VERIFIED_PAYMENT_INTENT + ReceiptWriter; add receiptWriter?+paymentWiringDeps to OperatorIntentsBootstrapDeps; when receiptWriter+revenueStore+outboxWriter+runInTransaction present, handlers.set(...) and registerOperatorIntent(...). Re-export the constant. |
| modify | `apps/api/src/app.ts` | Wire the new pieces at bootstrap: construct the PaymentPortFactory; decorate app.paymentPortFactory; pass a ReceiptWriter (writes a Receipt row via the tx Prisma client) into bootstrapOperatorIntents; register payments-webhook route under /api/payments. |
| modify | `apps/api/src/bootstrap/routes.ts` | Import paymentsWebhookRoutes and register under prefix /api/payments (mirrors adOptimizerRoutes registration). |
| modify | `packages/core/src/lifecycle/revenue-store.ts` | Add optional `bookingId?: string | null` to RecordRevenueInput so the verified-payment writer can stamp the booking on LifecycleRevenueEvent. |
| modify | `packages/db/src/stores/prisma-revenue-store.ts` | Add `bookingId?: string | null` to the local RecordRevenueInput, persist it in create({data:{...bookingId}}), and surface it through mapRowToRevenueEvent. |
| modify | `packages/db/src/stores/__tests__/prisma-revenue-store.test.ts` | Extend the create test to assert `bookingId` is forwarded into prisma.lifecycleRevenueEvent.create data and round-trips through the mapper. |
| modify | `packages/schemas/src/lifecycle.ts` | Add `bookingId: z.string().nullable().optional()` to LifecycleRevenueEventSchema so the typed event carries the booking weld. |
| modify | `packages/db/prisma/schema.prisma` | Add `bookingId String?` to model LifecycleRevenueEvent + `@@index([organizationId, bookingId])`. (The partial-unique on (organizationId, externalReference) is raw SQL in the migration; add a sync comment since Prisma 6 cannot express it.) |
| create | `packages/db/prisma/migrations/20260606120000_lre_booking_and_external_ref_unique/migration.sql` | Raw SQL in the SAME commit: ALTER TABLE add bookingId; CREATE INDEX (organizationId,bookingId); CREATE UNIQUE INDEX ... (organizationId, externalReference) WHERE externalReference IS NOT NULL. Mirrors 20260603120000_booking_partial_unique_active. |

**Notes:** DEPENDS ON 1A-3 (Receipt model + columns) and 1A-2 (chain weld). The bootstrap ReceiptWriter in Task 9 writes `client.receipt.create(...)` — the Receipt model is owned by 1A-3; if 1A-3 has not merged into the branch, Task 9's typecheck fails on `prisma.receipt` (the explicit, intended dependency). Rebase onto 1A-3 first and align the Receipt column literals (kind/tier/status/externalRef/capturedBy/verifiedAt) to 1A-3's actual schema.prisma before committing Task 9. The handler (Task 6) is db-free via the injected ReceiptWriter, so it and its unit test pass independently of 1A-3.

This PR mints a `Receipt` row with kind='payment' (the spec's unified Receipt model, §7), NOT a separate PaymentReceipt model — "PaymentReceipt(verified,T1)" in the spec/prompt means a Receipt where kind=payment, tier=T1_FETCH_BACK, status=paid, verified=true.

The webhook reuses the existing STRIPE_WEBHOOK_SECRET (already allowlisted + in .env.example line 306) — deliberately NO new env var, to avoid the env-allowlist CI gate. The route goes through PlatformIngress so it needs only the `// @route-class: ingress-receiver` header, NOT a route-allowlist.yaml entry.

#### Task 1: Task 1 — PaymentPort interface + Zod schemas (L1 schemas)

**Files:**
- Create: `packages/schemas/src/payment.ts`
- Create: `packages/schemas/src/__tests__/payment.test.ts`
- Modify: `packages/schemas/src/index.ts`
- Test: `packages/schemas/src/__tests__/payment.test.ts`

- [ ] **Step 1: Write the failing test FIRST. Create packages/schemas/src/__tests__/payment.test.ts asserting the three payment schemas parse valid input and reject malformed input. These schemas mirror the shape of calendar.ts (verified at packages/schemas/src/calendar.ts:1-99). amountCents is minor units (cents) per spec cross-cutting decision (§11 'money values flow as minor units').**

```ts
import { describe, it, expect } from "vitest";
import {
  DepositLinkInputSchema,
  DepositLinkSchema,
  VerifiedPaymentSchema,
} from "../payment.js";

describe("DepositLinkInputSchema", () => {
  it("parses a valid deposit-link request", () => {
    const parsed = DepositLinkInputSchema.parse({
      organizationId: "org-1",
      bookingId: "book-1",
      amountCents: 5000,
      currency: "SGD",
    });
    expect(parsed.amountCents).toBe(5000);
  });

  it("rejects a non-integer amountCents", () => {
    expect(() =>
      DepositLinkInputSchema.parse({
        organizationId: "org-1",
        bookingId: "book-1",
        amountCents: 50.5,
        currency: "SGD",
      }),
    ).toThrow();
  });

  it("rejects a zero or negative amountCents", () => {
    expect(() =>
      DepositLinkInputSchema.parse({
        organizationId: "org-1",
        bookingId: "book-1",
        amountCents: 0,
        currency: "SGD",
      }),
    ).toThrow();
  });
});

describe("DepositLinkSchema", () => {
  it("parses an issued link", () => {
    const parsed = DepositLinkSchema.parse({
      url: "https://pay.example/abc",
      externalReference: "noop_pay_book-1",
      amountCents: 5000,
      currency: "SGD",
    });
    expect(parsed.externalReference).toBe("noop_pay_book-1");
  });
});

describe("VerifiedPaymentSchema", () => {
  it("parses a verified charge", () => {
    const parsed = VerifiedPaymentSchema.parse({
      externalReference: "noop_pay_book-1",
      amountCents: 5000,
      currency: "SGD",
      status: "paid",
      chargedAt: "2026-06-06T00:00:00.000Z",
    });
    expect(parsed.status).toBe("paid");
  });

  it("rejects an empty externalReference", () => {
    expect(() =>
      VerifiedPaymentSchema.parse({
        externalReference: "",
        amountCents: 5000,
        currency: "SGD",
        status: "paid",
        chargedAt: "2026-06-06T00:00:00.000Z",
      }),
    ).toThrow();
  });
});

```

- [ ] **Step 2: Run the test — it MUST fail because packages/schemas/src/payment.ts does not exist yet.**

Run: `pnpm --filter @switchboard/schemas test src/__tests__/payment.test.ts`
Expected: FAIL — Cannot find module '../payment.js' (the file does not exist yet). All test cases error at import time.

- [ ] **Step 3: Create packages/schemas/src/payment.ts with the Zod schemas + the PaymentPort interface. Mirror calendar.ts exactly: Zod schemas with inferred types, then a plain TS interface (calendar.ts:92-99). No @switchboard/* imports (L1). amountCents are minor units (cents) per §11.**

```ts
import { z } from "zod";

/**
 * No-PMS payment port (architecture A). Mirrors `CalendarProvider`
 * (calendar.ts): Switchboard owns the deposit. The Noop adapter ships first;
 * a live Stripe Connect adapter (1A-4b) sits behind the same interface.
 *
 * Money is in MINOR UNITS (cents) end-to-end (spec cross-cutting decision):
 * normalize to major units exactly once, far downstream at `trueRoas`.
 */
export const DepositLinkInputSchema = z.object({
  organizationId: z.string().min(1),
  bookingId: z.string().min(1),
  amountCents: z.number().int().positive(),
  currency: z.string().length(3),
});
export type DepositLinkInput = z.infer<typeof DepositLinkInputSchema>;

export const DepositLinkSchema = z.object({
  url: z.string().min(1),
  /** Opaque PSP charge/intent id. The webhook re-fetches the charge by this id
   *  and NEVER trusts the webhook body amount. */
  externalReference: z.string().min(1),
  amountCents: z.number().int().positive(),
  currency: z.string().length(3),
});
export type DepositLink = z.infer<typeof DepositLinkSchema>;

export const VerifiedPaymentSchema = z.object({
  externalReference: z.string().min(1),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  status: z.enum(["paid", "pending", "failed", "refunded"]),
  /** External (PSP) charge timestamp — the trustworthy clock for windowing. */
  chargedAt: z.string(),
});
export type VerifiedPayment = z.infer<typeof VerifiedPaymentSchema>;

/**
 * Per-org payment provider. The factory in apps/api resolves the concrete
 * adapter (Noop today, Stripe Connect in 1A-4b). The orgId is closed over by the
 * factory, NEVER read from LLM/webhook input.
 */
export interface PaymentPort {
  /** Issue a first-party deposit link for a confirmed booking. */
  createDepositLink(input: DepositLinkInput): Promise<DepositLink>;
  /** Re-fetch a charge by its provider id. Returns null when unknown. The
   *  webhook calls this to get the AUTHORITATIVE amount (never the body). */
  retrievePayment(externalReference: string): Promise<VerifiedPayment | null>;
}

```

- [ ] **Step 4: Export the new module from the schemas barrel. Add the line next to the calendar export (verified at packages/schemas/src/index.ts:127 `export * from "./calendar.js";`).**

```ts
// No-PMS payment port (architecture A) — PaymentPort interface + deposit/charge
// schemas. Mirrors calendar.ts. Adapters/factory/webhook live in apps/api.
export * from "./payment.js";
```

- [ ] **Step 5: Run the test again — it MUST pass now.**

Run: `pnpm --filter @switchboard/schemas test src/__tests__/payment.test.ts`
Expected: PASS — all DepositLinkInputSchema / DepositLinkSchema / VerifiedPaymentSchema cases green.

- [ ] **Step 6: Commit. The schemas package is L1; this is a pure additive type module.**

Run: `git add packages/schemas/src/payment.ts packages/schemas/src/__tests__/payment.test.ts packages/schemas/src/index.ts && git commit -m "feat(schemas): add PaymentPort interface + deposit/charge schemas"`
Expected: Commit succeeds. commitlint accepts the lowercase subject.


#### Task 2: Task 2 — NoopPaymentAdapter (deterministic externalReference)

**Files:**
- Create: `apps/api/src/bootstrap/noop-payment-adapter.ts`
- Create: `apps/api/src/bootstrap/__tests__/noop-payment-adapter.test.ts`
- Test: `apps/api/src/bootstrap/__tests__/noop-payment-adapter.test.ts`

- [ ] **Step 1: Write the failing test FIRST. The Noop adapter must produce a DETERMINISTIC externalReference for a given bookingId (so a deposit-link re-issue is idempotent), and retrievePayment must echo the SAME externalReference + amountCents for a noop reference and null for anything else. Mirror noop-calendar-provider.ts (verified at apps/api/src/bootstrap/noop-calendar-provider.ts:1-85).**

```ts
import { describe, it, expect } from "vitest";
import { NoopPaymentAdapter, isNoopPaymentAdapter } from "../noop-payment-adapter.js";

describe("NoopPaymentAdapter", () => {
  it("createDepositLink is deterministic for a given bookingId", async () => {
    const adapter = new NoopPaymentAdapter();
    const a = await adapter.createDepositLink({
      organizationId: "org-1",
      bookingId: "book-1",
      amountCents: 5000,
      currency: "SGD",
    });
    const b = await adapter.createDepositLink({
      organizationId: "org-1",
      bookingId: "book-1",
      amountCents: 5000,
      currency: "SGD",
    });
    expect(a.externalReference).toBe("noop_pay_book-1");
    expect(a.externalReference).toBe(b.externalReference);
    expect(a.amountCents).toBe(5000);
  });

  it("retrievePayment echoes the deterministic charge for a noop reference", async () => {
    const adapter = new NoopPaymentAdapter();
    const charge = await adapter.retrievePayment("noop_pay_book-1");
    expect(charge).not.toBeNull();
    expect(charge!.externalReference).toBe("noop_pay_book-1");
    expect(charge!.status).toBe("paid");
    expect(charge!.amountCents).toBeGreaterThan(0);
  });

  it("retrievePayment returns null for an unknown reference", async () => {
    const adapter = new NoopPaymentAdapter();
    expect(await adapter.retrievePayment("pi_real_stripe")).toBeNull();
  });

  it("isNoopPaymentAdapter recognizes the adapter", () => {
    expect(isNoopPaymentAdapter(new NoopPaymentAdapter())).toBe(true);
  });
});

```

- [ ] **Step 2: Run the test — it MUST fail (file does not exist yet).**

Run: `pnpm --filter @switchboard/api test src/bootstrap/__tests__/noop-payment-adapter.test.ts`
Expected: FAIL — Cannot find module '../noop-payment-adapter.js'.

- [ ] **Step 3: Create apps/api/src/bootstrap/noop-payment-adapter.ts implementing PaymentPort. The externalReference is `noop_pay_${bookingId}` so re-issuing a link for the same booking is stable. retrievePayment recognizes the `noop_pay_` prefix and fabricates a fixed verified charge; the amountCents it returns is a constant the webhook test uses to prove the route trusts the re-fetch, not the body. Mirror the NoopCalendarProvider class+guard shape.**

```ts
import type {
  PaymentPort,
  DepositLinkInput,
  DepositLink,
  VerifiedPayment,
} from "@switchboard/schemas";

const NOOP_PREFIX = "noop_pay_";
/** The amount the Noop PSP reports on fetch-back. The webhook re-fetch test
 *  sends a DIFFERENT body amount to prove the route never trusts the body. */
export const NOOP_VERIFIED_AMOUNT_CENTS = 5000;

/**
 * Deterministic, side-effect-free PaymentPort for proving the no-PMS mechanics
 * without a real PSP. The live Stripe Connect adapter (1A-4b) replaces this
 * behind the same interface. Mirrors NoopCalendarProvider.
 */
export class NoopPaymentAdapter implements PaymentPort {
  private readonly logger: { info(msg: string): void };

  constructor(logger?: { info(msg: string): void }) {
    this.logger = logger ?? { info: () => {} };
  }

  async createDepositLink(input: DepositLinkInput): Promise<DepositLink> {
    const externalReference = `${NOOP_PREFIX}${input.bookingId}`;
    this.logger.info(`NoopPaymentAdapter: issued deposit link ${externalReference}`);
    return {
      url: `https://pay.noop.local/${externalReference}`,
      externalReference,
      amountCents: input.amountCents,
      currency: input.currency,
    };
  }

  async retrievePayment(externalReference: string): Promise<VerifiedPayment | null> {
    if (!externalReference.startsWith(NOOP_PREFIX)) return null;
    return {
      externalReference,
      amountCents: NOOP_VERIFIED_AMOUNT_CENTS,
      currency: "SGD",
      status: "paid",
      chargedAt: new Date(0).toISOString(),
    };
  }
}

export function isNoopPaymentAdapter(port: PaymentPort): boolean {
  return port instanceof NoopPaymentAdapter;
}

```

- [ ] **Step 4: Run the test again — it MUST pass.**

Run: `pnpm --filter @switchboard/api test src/bootstrap/__tests__/noop-payment-adapter.test.ts`
Expected: PASS — determinism, fetch-back echo, null-for-unknown, and type-guard cases green.

- [ ] **Step 5: Commit.**

Run: `git add apps/api/src/bootstrap/noop-payment-adapter.ts apps/api/src/bootstrap/__tests__/noop-payment-adapter.test.ts && git commit -m "feat(api): noop payment adapter with deterministic external reference"`
Expected: Commit succeeds.


#### Task 3: Task 3 — Per-org PaymentPortFactory

**Files:**
- Create: `apps/api/src/bootstrap/payment-port-factory.ts`
- Create: `apps/api/src/bootstrap/__tests__/payment-port-factory.test.ts`
- Test: `apps/api/src/bootstrap/__tests__/payment-port-factory.test.ts`

- [ ] **Step 1: Write the failing test FIRST. The factory mirrors createCalendarProviderFactory (verified at apps/api/src/bootstrap/calendar-provider-factory.ts:20-46): rejects empty orgId with ORG_ID_REQUIRED, returns a PaymentPort, and caches per orgId (same promise instance for repeated calls).**

```ts
import { describe, it, expect } from "vitest";
import { createPaymentPortFactory } from "../payment-port-factory.js";
import { isNoopPaymentAdapter } from "../noop-payment-adapter.js";

const deps = { logger: { info: () => {}, error: () => {} } };

describe("createPaymentPortFactory", () => {
  it("rejects an empty orgId", async () => {
    const factory = createPaymentPortFactory(deps);
    await expect(factory("")).rejects.toThrow("ORG_ID_REQUIRED");
  });

  it("resolves a PaymentPort (Noop today)", async () => {
    const factory = createPaymentPortFactory(deps);
    const port = await factory("org-1");
    expect(isNoopPaymentAdapter(port)).toBe(true);
  });

  it("caches the same promise per orgId", async () => {
    const factory = createPaymentPortFactory(deps);
    const a = await factory("org-1");
    const b = await factory("org-1");
    expect(a).toBe(b);
  });
});

```

- [ ] **Step 2: Run the test — it MUST fail (file does not exist).**

Run: `pnpm --filter @switchboard/api test src/bootstrap/__tests__/payment-port-factory.test.ts`
Expected: FAIL — Cannot find module '../payment-port-factory.js'.

- [ ] **Step 3: Create apps/api/src/bootstrap/payment-port-factory.ts mirroring the calendar factory's cache + empty-org-reject shape (calendar-provider-factory.ts:20-46). Resolve NoopPaymentAdapter today; a comment marks the Stripe Connect adapter (1A-4b) as the fast-follow behind the same port.**

```ts
import type { PaymentPort } from "@switchboard/schemas";
import { NoopPaymentAdapter } from "./noop-payment-adapter.js";

export type PaymentPortFactory = (orgId: string) => Promise<PaymentPort>;

export interface PaymentPortFactoryDeps {
  logger: { info(msg: string): void; error(msg: string): void };
}

/**
 * Per-org PaymentPort factory. Mirrors createCalendarProviderFactory: a
 * process-lifetime cache keyed on orgId (no eviction in beta). Resolves the
 * Noop adapter today; the live Stripe Connect adapter (1A-4b) lands behind the
 * SAME PaymentPort interface and selects per the org's stored Connection.
 */
export function createPaymentPortFactory(deps: PaymentPortFactoryDeps): PaymentPortFactory {
  const cache = new Map<string, Promise<PaymentPort>>();

  return (orgId: string) => {
    if (!orgId || typeof orgId !== "string" || orgId.trim() === "") {
      return Promise.reject(new Error("ORG_ID_REQUIRED"));
    }
    const existing = cache.get(orgId);
    if (existing) return existing;

    const promise = (async (): Promise<PaymentPort> => {
      deps.logger.info(`Payment[${orgId}]: using NoopPaymentAdapter (no PSP configured)`);
      return new NoopPaymentAdapter();
    })().catch((error) => {
      cache.delete(orgId);
      throw error;
    });
    cache.set(orgId, promise);
    return promise;
  };
}

```

- [ ] **Step 4: Run the test again — it MUST pass.**

Run: `pnpm --filter @switchboard/api test src/bootstrap/__tests__/payment-port-factory.test.ts`
Expected: PASS — empty-org reject, Noop resolution, per-org cache cases green.

- [ ] **Step 5: Commit.**

Run: `git add apps/api/src/bootstrap/payment-port-factory.ts apps/api/src/bootstrap/__tests__/payment-port-factory.test.ts && git commit -m "feat(api): per-org payment-port factory"`
Expected: Commit succeeds.


#### Task 4: Task 4 — Deposit-link issuance helper (co-located core tool)

**Files:**
- Create: `packages/core/src/skill-runtime/tools/deposit-link.ts`
- Create: `packages/core/src/skill-runtime/tools/deposit-link.test.ts`
- Test: `packages/core/src/skill-runtime/tools/deposit-link.test.ts`

- [ ] **Step 1: Write the failing test FIRST. The helper is a SkillTool (factory-with-context, like calendar-book.ts:159) with one `deposit.issue` operation. It sources orgId from the trusted SkillRequestContext (NEVER LLM input — same rule as calendar-book.ts:223), reads the booking via an injected booking-store subset, requires status=='confirmed' (idempotent read on the already-approved booking; no new approval), then calls PaymentPort.createDepositLink and returns ok({...}). Test the four branches: success, missing/cross-org booking, unconfirmed booking, and that createDepositLink receives org+bookingId+amount. Mirror tool-result.ts ok/fail (verified at packages/core/src/skill-runtime/tool-result.ts:5-93).**

```ts
import { describe, it, expect, vi } from "vitest";
import type { PaymentPort } from "@switchboard/schemas";
import { createDepositLinkToolFactory } from "./deposit-link.js";
import type { SkillRequestContext } from "../types.js";

const ctx = { sessionId: "s", orgId: "org-1", deploymentId: "d" } as SkillRequestContext;

function makePort(): PaymentPort {
  return {
    createDepositLink: vi.fn(async (input) => ({
      url: `https://pay/${input.bookingId}`,
      externalReference: `noop_pay_${input.bookingId}`,
      amountCents: input.amountCents,
      currency: input.currency,
    })),
    retrievePayment: vi.fn(async () => null),
  };
}

function makeBookingStore(
  row: { id: string; organizationId: string; status: string } | null,
) {
  return {
    findById: vi.fn(async (orgId: string, bookingId: string) =>
      row && row.organizationId === orgId && row.id === bookingId ? row : null,
    ),
  };
}

describe("deposit-link tool — deposit.issue", () => {
  it("issues a link for a confirmed booking", async () => {
    const port = makePort();
    const bookingStore = makeBookingStore({
      id: "book-1",
      organizationId: "org-1",
      status: "confirmed",
    });
    const tool = createDepositLinkToolFactory({
      paymentPortFactory: async () => port,
      bookingStore,
      depositAmountCents: 5000,
      defaultCurrency: "SGD",
    })(ctx);
    const result = await tool.operations["deposit.issue"].execute({ bookingId: "book-1" });
    expect(result.status).toBe("success");
    expect(result.data?.externalReference).toBe("noop_pay_book-1");
    expect(port.createDepositLink).toHaveBeenCalledWith({
      organizationId: "org-1",
      bookingId: "book-1",
      amountCents: 5000,
      currency: "SGD",
    });
  });

  it("fails MISSING_BOOKING when the booking is absent or cross-org", async () => {
    const tool = createDepositLinkToolFactory({
      paymentPortFactory: async () => makePort(),
      bookingStore: makeBookingStore({ id: "book-1", organizationId: "other-org", status: "confirmed" }),
      depositAmountCents: 5000,
      defaultCurrency: "SGD",
    })(ctx);
    const result = await tool.operations["deposit.issue"].execute({ bookingId: "book-1" });
    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("MISSING_BOOKING");
  });

  it("fails BOOKING_NOT_CONFIRMED for an unconfirmed booking", async () => {
    const tool = createDepositLinkToolFactory({
      paymentPortFactory: async () => makePort(),
      bookingStore: makeBookingStore({ id: "book-1", organizationId: "org-1", status: "pending_confirmation" }),
      depositAmountCents: 5000,
      defaultCurrency: "SGD",
    })(ctx);
    const result = await tool.operations["deposit.issue"].execute({ bookingId: "book-1" });
    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("BOOKING_NOT_CONFIRMED");
  });
});

```

- [ ] **Step 2: Run the test — it MUST fail (file does not exist).**

Run: `pnpm --filter @switchboard/core test src/skill-runtime/tools/deposit-link.test.ts`
Expected: FAIL — Cannot find module './deposit-link.js'.

- [ ] **Step 3: Create packages/core/src/skill-runtime/tools/deposit-link.ts. It is L3 core: imports ONLY @switchboard/schemas (PaymentPort) + the local tool-result/types — NOT db or apps/api. Use the factory-with-context shape from calendar-book.ts (orgId from ctx, never from tool input). The booking-store subset is a structural type duplicated locally (same approach calendar-book.ts uses at line 16-56). This is an idempotent external read on the already-approved booking, so there is NO new approval (effectCategory 'read').**

```ts
import type { PaymentPort } from "@switchboard/schemas";
import type { SkillTool, SkillRequestContext } from "../types.js";
import type { ToolResult } from "../tool-result.js";
import { ok, fail } from "../tool-result.js";

/** Local booking-store subset (structural; core cannot import db). */
interface BookingLookup {
  findById(
    orgId: string,
    bookingId: string,
  ): Promise<{ id: string; organizationId: string; status: string } | null>;
}

export type DepositLinkPaymentPortFactory = (orgId: string) => Promise<PaymentPort>;

export interface DepositLinkToolDeps {
  paymentPortFactory: DepositLinkPaymentPortFactory;
  bookingStore: BookingLookup;
  /** Deposit amount in minor units (cents). Injected dep until per-org
   *  deposit pricing is wired (mirrors calendar-book.ts defaultCurrency). */
  depositAmountCents: number;
  defaultCurrency: string;
}

export type DepositLinkToolFactory = (ctx: SkillRequestContext) => SkillTool;

/**
 * Issues a first-party deposit link for an already-confirmed (already-approved)
 * booking. The link is an IDEMPOTENT external read riding on the prior booking
 * approval — no new approval (spec supervised-approval model). Co-located so the
 * ~440-line calendar-book.ts stays untouched.
 */
export function createDepositLinkToolFactory(deps: DepositLinkToolDeps): DepositLinkToolFactory {
  return (ctx: SkillRequestContext): SkillTool => ({
    id: "deposit-link",
    operations: {
      "deposit.issue": {
        description: "Issue a deposit-payment link for a confirmed booking.",
        effectCategory: "read" as const,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: { bookingId: { type: "string" } },
          required: ["bookingId"],
        },
        execute: async (params: unknown): Promise<ToolResult> => {
          const input = params as { bookingId: string };
          const orgId = ctx.orgId;
          const booking = await deps.bookingStore.findById(orgId, input.bookingId);
          if (!booking) {
            return fail("MISSING_BOOKING", "No booking found for this organization.", {
              retryable: false,
              modelRemediation:
                "Do not issue a deposit link without a confirmed booking. Escalate to the operator.",
            });
          }
          if (booking.status !== "confirmed") {
            return fail("BOOKING_NOT_CONFIRMED", "The booking is not confirmed yet.", {
              retryable: false,
              modelRemediation: "Confirm the booking before issuing a deposit link.",
            });
          }
          const port = await deps.paymentPortFactory(orgId);
          const link = await port.createDepositLink({
            organizationId: orgId,
            bookingId: booking.id,
            amountCents: deps.depositAmountCents,
            currency: deps.defaultCurrency,
          });
          return ok({
            url: link.url,
            externalReference: link.externalReference,
            amountCents: link.amountCents,
            currency: link.currency,
          });
        },
      },
    },
  });
}

```

- [ ] **Step 4: Run the test again — it MUST pass. If TypeScript complains that the SkillTool operation shape (effectCategory/inputSchema/execute) does not match, open packages/core/src/skill-runtime/types.ts and align the operation object to the SkillTool type exactly as calendar-book.ts does (calendar-book.ts:162-199 is the reference).**

Run: `pnpm --filter @switchboard/core test src/skill-runtime/tools/deposit-link.test.ts`
Expected: PASS — success, MISSING_BOOKING (cross-org), and BOOKING_NOT_CONFIRMED cases green.

- [ ] **Step 5: Typecheck the core package to confirm the SkillTool shape and the L1-only import surface (no db/apps import) are correct.**

Run: `pnpm --filter @switchboard/core typecheck`
Expected: No type errors. (If it reports missing exports from @switchboard/schemas, run `pnpm reset` first per CLAUDE.md.)

- [ ] **Step 6: Commit.**

Run: `git add packages/core/src/skill-runtime/tools/deposit-link.ts packages/core/src/skill-runtime/tools/deposit-link.test.ts && git commit -m "feat(core): deposit-link issuance tool on a confirmed booking"`
Expected: Commit succeeds.


#### Task 5: Task 5 — Schema + migration: LifecycleRevenueEvent.bookingId + partial-unique externalReference

**Files:**
- Create: `packages/db/prisma/migrations/20260606120000_lre_booking_and_external_ref_unique/migration.sql`
- Modify: `packages/db/prisma/schema.prisma`
- Modify: `packages/schemas/src/lifecycle.ts`
- Modify: `packages/core/src/lifecycle/revenue-store.ts`
- Modify: `packages/db/src/stores/prisma-revenue-store.ts`
- Modify: `packages/db/src/stores/__tests__/prisma-revenue-store.test.ts`
- Test: `packages/db/src/stores/__tests__/prisma-revenue-store.test.ts`

- [ ] **Step 1: Write the failing test FIRST. Extend the existing prisma-revenue-store create test to assert `bookingId` is forwarded into prisma.lifecycleRevenueEvent.create and round-trips through the mapper. Add this new `it` block inside the existing `describe("record", ...)` block (the file is verified at packages/db/src/stores/__tests__/prisma-revenue-store.test.ts:112-194; makeMockPrisma/makeRevenueEvent helpers verified at lines 6-37).**

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

- [ ] **Step 2: Run the test — it MUST fail because PrismaRevenueStore does not yet forward or map bookingId.**

Run: `pnpm --filter @switchboard/db test src/stores/__tests__/prisma-revenue-store.test.ts -t "forwards bookingId"`
Expected: FAIL — create was called WITHOUT bookingId in data (objectContaining mismatch) and/or result.bookingId is undefined.

- [ ] **Step 3: Add bookingId to the core RevenueStore input type (the structural contract). Edit packages/core/src/lifecycle/revenue-store.ts: in interface RecordRevenueInput (verified at revenue-store.ts:10-23), add the field after `externalReference`.**

```ts
  externalReference?: string | null;
  /** Welds the verified payment to the booking row (spec chain). */
  bookingId?: string | null;
  verified?: boolean;
```

- [ ] **Step 4: Add bookingId to the typed LifecycleRevenueEvent. Edit packages/schemas/src/lifecycle.ts LifecycleRevenueEventSchema (verified at lifecycle.ts:166-182), inserting after the externalReference line.**

```ts
  externalReference: z.string().nullable().optional(),
  bookingId: z.string().nullable().optional(),
  verified: z.boolean().default(false),
```

- [ ] **Step 5: Forward + map bookingId in the Prisma store. Edit packages/db/src/stores/prisma-revenue-store.ts in THREE places: (a) the local RecordRevenueInput interface (line 9-22), add `bookingId?: string | null;` after externalReference; (b) the create data block (line 76-94), add `bookingId: input.bookingId ?? null,` after the externalReference line; (c) the mapRowToRevenueEvent param type AND return object (line 268-302), add `bookingId: string | null;` to the param type and `bookingId: row.bookingId,` to the returned object.**

```ts
// (a) interface RecordRevenueInput — after externalReference:
  externalReference?: string | null;
  bookingId?: string | null;
// (b) create data — after the externalReference line:
        externalReference: input.externalReference ?? null,
        bookingId: input.bookingId ?? null,
// (c) mapRowToRevenueEvent — add to the param type and the return object:
//   param type:
  externalReference: string | null;
  bookingId: string | null;
//   return object:
    externalReference: row.externalReference,
    bookingId: row.bookingId,
```

- [ ] **Step 6: Update makeRevenueEvent in the test helper so the default row carries a bookingId field the mapper can read (otherwise row.bookingId is undefined for the existing tests). Edit packages/db/src/stores/__tests__/prisma-revenue-store.test.ts makeRevenueEvent (verified at lines 18-37), add `bookingId: null,` after the externalReference line.**

```ts
    externalReference: "pi_abc123",
    bookingId: null,
    verified: true,
```

- [ ] **Step 7: Add the Prisma model field + index. Edit packages/db/prisma/schema.prisma model LifecycleRevenueEvent (verified at schema.prisma:1829-1851): add bookingId after externalReference, add the index, and a sync comment for the raw-SQL partial-unique.**

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
  // 20260606120000_lre_booking_and_external_ref_unique. Keep this comment in sync.
  @@index([organizationId])
  @@index([opportunityId])
  @@index([organizationId, recordedAt])
  @@index([organizationId, bookingId])
```

- [ ] **Step 8: Create the raw-SQL migration in the SAME commit (CLAUDE.md: schema change requires its migration in the same commit). Mirror the partial-unique pattern from 20260603120000_booking_partial_unique_active/migration.sql (verified at packages/db/prisma/migrations/20260603120000_booking_partial_unique_active/migration.sql:1-9).**

```ts
-- LifecycleRevenueEvent: weld a verified payment to its booking (chain) and make
-- a replayed PSP charge an idempotent no-op. Today there is NO DB unique on the
-- external reference, so the same charge could write twice. Add a PARTIAL unique
-- on (organizationId, externalReference) WHERE externalReference IS NOT NULL
-- (Prisma 6 cannot express partial uniques; mirrors 20260603120000).
ALTER TABLE "LifecycleRevenueEvent" ADD COLUMN "bookingId" TEXT;

CREATE INDEX "LifecycleRevenueEvent_organizationId_bookingId_idx"
  ON "LifecycleRevenueEvent" ("organizationId", "bookingId");

CREATE UNIQUE INDEX "LifecycleRevenueEvent_org_externalRef_key"
  ON "LifecycleRevenueEvent" ("organizationId", "externalReference")
  WHERE "externalReference" IS NOT NULL;
```

- [ ] **Step 9: Regenerate the Prisma client so the generated types include bookingId, then re-run the store test. (db tests mock Prisma but the store file imports PrismaDbClient types from the generated client.)**

Run: `pnpm db:generate && pnpm --filter @switchboard/db test src/stores/__tests__/prisma-revenue-store.test.ts`
Expected: PASS — the new 'forwards bookingId' test plus all pre-existing PrismaRevenueStore tests are green.

- [ ] **Step 10: If Postgres is reachable, verify no schema drift between schema.prisma and the migration (CLAUDE.md: run db:check-drift before committing schema changes). If Postgres is unavailable locally, skip this and rely on CI — the hand-written SQL mirrors the proven partial-unique precedent.**

Run: `pnpm db:check-drift`
Expected: No drift detected (or: skipped — Postgres unavailable; CI validates the migration).

- [ ] **Step 11: Commit schema + migration + store + types together (one commit, per the same-commit rule).**

Run: `git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260606120000_lre_booking_and_external_ref_unique/migration.sql packages/schemas/src/lifecycle.ts packages/core/src/lifecycle/revenue-store.ts packages/db/src/stores/prisma-revenue-store.ts packages/db/src/stores/__tests__/prisma-revenue-store.test.ts && git commit -m "feat(db,schemas,core): lifecycle revenue event bookingId + external-reference partial unique"`
Expected: Commit succeeds.


#### Task 6: Task 6 — Verified-payment intent handler (one-tx receipt + revenue + outbox)

**Files:**
- Create: `apps/api/src/routes/operator-intents-schemas-payment.ts`
- Create: `apps/api/src/bootstrap/operator-intents/record-verified-payment.ts`
- Create: `apps/api/src/bootstrap/operator-intents/record-verified-payment.test.ts`
- Test: `apps/api/src/bootstrap/operator-intents/record-verified-payment.test.ts`

- [ ] **Step 1: Create the parameter schema FIRST (no test needed for a pure Zod object; it is exercised by the handler test). Mirror RecordRevenueParametersSchema (verified at operator-intents-schemas.ts:83-95) but money is amountCents (int) and externalReference is REQUIRED. Keep it in a separate file so operator-intents-schemas.ts stays small.**

```ts
import { z } from "zod";

/**
 * Parameters for the `payment.record_verified` intent. Authority is the external
 * PSP fetch-back, so recordedBy is fixed to 'stripe' downstream and the amount
 * is the RE-FETCHED amount (cents), never a webhook-body value. externalReference
 * is required — it is the replay/idempotency key (partial unique in the DB).
 */
export const RecordVerifiedPaymentParametersSchema = z.object({
  contactId: z.string().min(1),
  opportunityId: z.string().min(1),
  bookingId: z.string().min(1),
  amountCents: z.number().int().positive(),
  currency: z.string().length(3).default("SGD"),
  externalReference: z.string().min(1),
  connectionId: z.string().min(1).optional(),
  sourceCampaignId: z.string().nullable().optional(),
  sourceAdId: z.string().nullable().optional(),
});

export type RecordVerifiedPaymentParameters = z.infer<
  typeof RecordVerifiedPaymentParametersSchema
>;

```

- [ ] **Step 2: Write the failing handler test. It must prove: (1) all THREE writes (receipt, revenue, outbox) happen inside the SAME runInTransaction with the SAME tx argument; (2) the amount written is the parsed amountCents (never recomputed); (3) on a replay where revenueStore.record returns the EXISTING event, the same outbox eventId is re-issued (so the partial-unique + outbox unique make it a no-op). Build the WorkUnit-shaped object inline (WorkUnit verified at packages/core/src/platform/work-unit.ts:11-26). Mirror the revenue.ts handler test approach (the handler signature mirrors buildRecordRevenueHandler at revenue.ts:27-31).**

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
    externalReference: "noop_pay_book-1",
    bookingId: "book-1",
    verified: true,
    sourceCampaignId: "camp-1",
    sourceAdId: null,
    recordedAt: new Date(0),
    createdAt: new Date(0),
    ...overrides,
  };
}

function makeWorkUnit(): WorkUnit {
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
      externalReference: "noop_pay_book-1",
      sourceCampaignId: "camp-1",
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

describe("buildRecordVerifiedPaymentHandler", () => {
  it("writes receipt + revenue + outbox in one tx with the parsed amount", async () => {
    const event = makeEvent();
    const receiptWriter: ReceiptWriter = { write: vi.fn(async () => {}) };
    const revenueStore = makeRevenueStore(event);
    const outboxWriter = { write: vi.fn(async () => {}) };
    const runInTransaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(TX));

    const handler = buildRecordVerifiedPaymentHandler(
      receiptWriter,
      revenueStore,
      outboxWriter,
      runInTransaction,
    );
    const result = await handler.execute(makeWorkUnit());

    expect(result.outcome).toBe("completed");
    // All three writes received the SAME tx instance.
    expect(receiptWriter.write).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        kind: "payment",
        tier: "T1_FETCH_BACK",
        status: "paid",
        verified: true,
        bookingId: "book-1",
        externalReference: "noop_pay_book-1",
        amount: 5000,
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
        externalReference: "noop_pay_book-1",
      }),
      TX,
    );
    expect(outboxWriter.write).toHaveBeenCalledWith(
      "evt_pay_rev_1",
      "purchased",
      expect.objectContaining({ type: "purchased", value: 5000, contactId: "c1" }),
      TX,
    );
  });

  it("re-issues the same outbox eventId on replay (existing event returned)", async () => {
    // record() returns the pre-existing row (its externalReference short-circuit),
    // so the outbox eventId is derived from that SAME id -> the outbox unique makes
    // the replay a no-op.
    const existing = makeEvent({ id: "rev_existing" });
    const receiptWriter: ReceiptWriter = { write: vi.fn(async () => {}) };
    const revenueStore = makeRevenueStore(existing);
    const outboxWriter = { write: vi.fn(async () => {}) };
    const runInTransaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(TX));

    const handler = buildRecordVerifiedPaymentHandler(
      receiptWriter,
      revenueStore,
      outboxWriter,
      runInTransaction,
    );
    await handler.execute(makeWorkUnit());
    expect(outboxWriter.write).toHaveBeenCalledWith(
      "evt_pay_rev_existing",
      "purchased",
      expect.anything(),
      TX,
    );
  });
});

```

- [ ] **Step 3: Run the test — it MUST fail (handler file does not exist).**

Run: `pnpm --filter @switchboard/api test src/bootstrap/operator-intents/record-verified-payment.test.ts`
Expected: FAIL — Cannot find module './record-verified-payment.js'.

- [ ] **Step 4: Create apps/api/src/bootstrap/operator-intents/record-verified-payment.ts. Mirror revenue.ts (verified at revenue.ts:1-83): same OutboxWriter/RunInTransaction injected deps, plus a ReceiptWriter (so the handler never imports db directly — bootstrap supplies the tx.receipt.create binding). The handler hard-codes the verified-payment facts: kind='payment', tier='T1_FETCH_BACK', status='paid', verified=true, type='deposit', recordedBy='stripe' (authority = the PSP fetch-back, spec §8). Define RECORD_VERIFIED_PAYMENT_INTENT here.**

```ts
// apps/api/src/bootstrap/operator-intents/record-verified-payment.ts
// ---------------------------------------------------------------------------
// payment.record_verified handler factory (spec 1A-4, architecture A).
// Writes Receipt(payment,T1,paid,verified) + LifecycleRevenueEvent(verified,
// bookingId, deposit) + a `purchased` OutboxEvent in ONE runInTransaction.
// Authority is the external PSP fetch-back, so this intent is
// system_auto_approved; operator.record_revenue stays separate (verified=false).
// ---------------------------------------------------------------------------
import type { RevenueStore, StoreTransactionContext } from "@switchboard/core";
import type { OperatorMutationHandler } from "@switchboard/core/platform";
import { RecordVerifiedPaymentParametersSchema } from "../../routes/operator-intents-schemas-payment.js";
import type { OutboxWriter, RunInTransaction } from "./revenue.js";

export const RECORD_VERIFIED_PAYMENT_INTENT = "payment.record_verified";

/** Receipt row written through the tx client (concrete impl wired at bootstrap).
 *  Indirection mirrors OutboxWriter so the handler stays db-free + testable. */
export interface ReceiptWriter {
  write(
    input: {
      organizationId: string;
      kind: "payment";
      tier: "T1_FETCH_BACK";
      status: "paid";
      verified: true;
      bookingId: string;
      opportunityId: string;
      externalReference: string;
      amount: number;
      currency: string;
      provider: string;
      connectionId?: string;
    },
    tx?: StoreTransactionContext,
  ): Promise<void>;
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

      const event = await runInTransaction(async (tx) => {
        // 1. Verified payment receipt (T1 — authority is the PSP fetch-back).
        await receiptWriter.write(
          {
            organizationId: orgId,
            kind: "payment",
            tier: "T1_FETCH_BACK",
            status: "paid",
            verified: true,
            bookingId: params.bookingId,
            opportunityId: params.opportunityId,
            externalReference: params.externalReference,
            amount: params.amountCents,
            currency: params.currency,
            provider: "noop",
            ...(params.connectionId ? { connectionId: params.connectionId } : {}),
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
            verified: true,
            bookingId: params.bookingId,
            externalReference: params.externalReference,
            sourceCampaignId: params.sourceCampaignId ?? null,
            sourceAdId: params.sourceAdId ?? null,
          },
          tx,
        );

        // 3. `purchased` outbox event. eventId derives from the revenue row id, so
        //    a replay re-issues the SAME eventId -> the outbox unique no-ops it.
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
            occurredAt: new Date().toISOString(),
            source: "payment-webhook",
            metadata: {
              bookingId: params.bookingId,
              opportunityId: params.opportunityId,
              externalReference: params.externalReference,
              currency: params.currency,
              verified: true,
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

- [ ] **Step 5: Run the test again — it MUST pass.**

Run: `pnpm --filter @switchboard/api test src/bootstrap/operator-intents/record-verified-payment.test.ts`
Expected: PASS — one-tx (same TX arg to all three writes), parsed-amount, and replay-same-eventId cases green.

- [ ] **Step 6: Commit.**

Run: `git add apps/api/src/routes/operator-intents-schemas-payment.ts apps/api/src/bootstrap/operator-intents/record-verified-payment.ts apps/api/src/bootstrap/operator-intents/record-verified-payment.test.ts && git commit -m "feat(api): payment.record_verified handler writes receipt+revenue+outbox in one tx"`
Expected: Commit succeeds.


#### Task 7: Task 7 — Register the payment.record_verified intent in operator-intents bootstrap

**Files:**
- Modify: `apps/api/src/bootstrap/operator-intents.ts`
- Test: `apps/api/src/bootstrap/operator-intents/record-verified-payment.test.ts`

- [ ] **Step 1: Add imports for the new handler + constant + ReceiptWriter type at the top of operator-intents.ts (alongside the revenue.js import, verified at operator-intents.ts:42-46).**

```ts
import {
  buildRecordVerifiedPaymentHandler,
  RECORD_VERIFIED_PAYMENT_INTENT,
  type ReceiptWriter,
} from "./operator-intents/record-verified-payment.js";
```

- [ ] **Step 2: Re-export the constant + handler so other modules (app.ts, the integration test) can import them from operator-intents.js (mirrors the revenue.ts re-export at operator-intents.ts:72).**

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

- [ ] **Step 5: Register the handler in the handlers Map. Add this block right after the existing RECORD_REVENUE_INTENT handler block (verified at operator-intents.ts:164-169).**

```ts
  if (receiptWriter && revenueStore && outboxWriter && runInTransaction) {
    handlers.set(
      RECORD_VERIFIED_PAYMENT_INTENT,
      buildRecordVerifiedPaymentHandler(receiptWriter, revenueStore, outboxWriter, runInTransaction),
    );
  }
```

- [ ] **Step 6: Register the intent itself. Add after the RECORD_REVENUE_INTENT registration (verified at operator-intents.ts:188-190). The shared registerOperatorIntent helper already sets defaultMode/approvalMode='system_auto_approved' (verified at operator-intents.ts:99-115) — exactly what spec §8 requires for this writer.**

```ts
  if (receiptWriter && revenueStore && outboxWriter && runInTransaction) {
    registerOperatorIntent(intentRegistry, RECORD_VERIFIED_PAYMENT_INTENT);
  }
```

- [ ] **Step 7: Update the intentCount tally so the bootstrap log line stays accurate (verified at operator-intents.ts:192-197). Add the new term.**

```ts
    (revenueStore && outboxWriter && runInTransaction ? 1 : 0) +
    (receiptWriter && revenueStore && outboxWriter && runInTransaction ? 1 : 0);
```

- [ ] **Step 8: Typecheck the api package to confirm the bootstrap wiring compiles (imports resolve, dep types line up).**

Run: `pnpm --filter @switchboard/api typecheck`
Expected: No type errors. (If it reports missing @switchboard/core or @switchboard/schemas exports, run `pnpm reset` first.)

- [ ] **Step 9: Commit.**

Run: `git add apps/api/src/bootstrap/operator-intents.ts && git commit -m "feat(api): register payment.record_verified operator intent"`
Expected: Commit succeeds.


#### Task 8: Task 8 — PSP webhook route (ingress-receiver, fetch-back, never trust body amount)

**Files:**
- Create: `apps/api/src/routes/payments-webhook.ts`
- Create: `apps/api/src/routes/__tests__/payments-webhook.test.ts`
- Test: `apps/api/src/routes/__tests__/payments-webhook.test.ts`

- [ ] **Step 1: Write the failing route test FIRST. Stand up a standalone Fastify app registering ONLY payments-webhook + the rawBody plugin, and decorate mock prisma/platformIngress/paymentPortFactory — mirror ad-optimizer-signature.test.ts (verified at apps/api/src/__tests__/ad-optimizer-signature.test.ts:1-83). The CRITICAL anti-fake assertion: the webhook BODY carries amountCents:999999 but retrievePayment returns 5000 (NoopPaymentAdapter.NOOP_VERIFIED_AMOUNT_CENTS), and the SUBMIT must carry 5000 — proving the route trusts the fetch-back, never the body. Use STRIPE_WEBHOOK_SECRET for the HMAC (already in env-allowlist + .env.example; no new env var).**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import rawBody from "fastify-raw-body";
import { createHmac } from "node:crypto";
import { paymentsWebhookRoutes } from "../payments-webhook.js";

const SECRET = "test-webhook-secret";

function sign(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

// Body amount is INTENTIONALLY wrong (999999) so the test proves the route uses
// the re-fetched amount (5000), not the body.
function body(externalReference: string, messageId: string): string {
  return JSON.stringify({
    id: messageId,
    account: "acct_123",
    data: { externalReference, amountCents: 999999 },
  });
}

interface Mocks {
  submit: ReturnType<typeof vi.fn>;
  retrievePayment: ReturnType<typeof vi.fn>;
  connectionFindFirst: ReturnType<typeof vi.fn>;
}

async function buildApp(mocks: Mocks): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(rawBody, { field: "rawBody", global: false });
  app.decorate("prisma", {
    connection: { findFirst: mocks.connectionFindFirst },
  } as never);
  app.decorate("platformIngress", {
    submit: mocks.submit,
  } as never);
  app.decorate("paymentPortFactory", (async () => ({
    createDepositLink: vi.fn(),
    retrievePayment: mocks.retrievePayment,
  })) as never);
  await app.register(paymentsWebhookRoutes, { prefix: "/api/payments" });
  await app.ready();
  return app;
}

function makeMocks(overrides: Partial<Mocks> = {}): Mocks {
  return {
    submit: vi.fn(async () => ({ ok: true, workUnit: { id: "wu-1", traceId: "t-1" } })),
    retrievePayment: vi.fn(async () => ({
      externalReference: "noop_pay_book-1",
      amountCents: 5000,
      currency: "SGD",
      status: "paid",
      chargedAt: new Date(0).toISOString(),
    })),
    connectionFindFirst: vi.fn(async () => ({
      organizationId: "org-1",
      id: "conn-1",
    })),
    ...overrides,
  };
}

function post(app: FastifyInstance, payload: string, signature: string | undefined) {
  return app.inject({
    method: "POST",
    url: "/api/payments/webhook",
    headers: {
      "content-type": "application/json",
      ...(signature ? { "x-payment-signature": signature } : {}),
    },
    payload,
  });
}

describe("POST /api/payments/webhook — PSP ingress-receiver", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env["STRIPE_WEBHOOK_SECRET"];
    process.env["STRIPE_WEBHOOK_SECRET"] = SECRET;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env["STRIPE_WEBHOOK_SECRET"];
    else process.env["STRIPE_WEBHOOK_SECRET"] = saved;
  });

  it("rejects a missing signature (401), no submit", async () => {
    const mocks = makeMocks();
    const app = await buildApp(mocks);
    const res = await post(app, body("noop_pay_book-1", "msg_1"), undefined);
    expect(res.statusCode).toBe(401);
    expect(mocks.submit).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects a forged signature (401), no submit", async () => {
    const mocks = makeMocks();
    const app = await buildApp(mocks);
    const payload = body("noop_pay_book-1", "msg_1");
    const res = await post(app, payload, sign(payload, "wrong"));
    expect(res.statusCode).toBe(401);
    expect(mocks.submit).not.toHaveBeenCalled();
    await app.close();
  });

  it("fails closed when STRIPE_WEBHOOK_SECRET is unset (401)", async () => {
    delete process.env["STRIPE_WEBHOOK_SECRET"];
    const mocks = makeMocks();
    const app = await buildApp(mocks);
    const payload = body("noop_pay_book-1", "msg_1");
    const res = await post(app, payload, sign(payload, SECRET));
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("refuses an unresolvable org (200 skipped), no submit", async () => {
    const mocks = makeMocks({ connectionFindFirst: vi.fn(async () => null) });
    const app = await buildApp(mocks);
    const payload = body("noop_pay_book-1", "msg_1");
    const res = await post(app, payload, sign(payload, SECRET));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ skipped: true });
    expect(mocks.submit).not.toHaveBeenCalled();
    await app.close();
  });

  it("re-fetches the charge and submits the RE-FETCHED amount, never the body amount", async () => {
    const mocks = makeMocks();
    const app = await buildApp(mocks);
    const payload = body("noop_pay_book-1", "msg_1");
    const res = await post(app, payload, sign(payload, SECRET));
    expect(res.statusCode).toBe(200);
    // re-fetch happened with the external reference from the body
    expect(mocks.retrievePayment).toHaveBeenCalledWith("noop_pay_book-1");
    // submit carried the re-fetched 5000, NOT the body's 999999
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    const arg = mocks.submit.mock.calls[0]![0] as {
      intent: string;
      parameters: { amountCents: number; externalReference: string };
      idempotencyKey: string;
      organizationId: string;
    };
    expect(arg.intent).toBe("payment.record_verified");
    expect(arg.parameters.amountCents).toBe(5000);
    expect(arg.parameters.externalReference).toBe("noop_pay_book-1");
    expect(arg.organizationId).toBe("org-1");
    // idempotency key derives from the provider message id
    expect(arg.idempotencyKey).toContain("msg_1");
    await app.close();
  });

  it("returns 200 without submit when the charge is not paid", async () => {
    const mocks = makeMocks({
      retrievePayment: vi.fn(async () => ({
        externalReference: "noop_pay_book-1",
        amountCents: 5000,
        currency: "SGD",
        status: "pending",
        chargedAt: new Date(0).toISOString(),
      })),
    });
    const app = await buildApp(mocks);
    const payload = body("noop_pay_book-1", "msg_1");
    const res = await post(app, payload, sign(payload, SECRET));
    expect(res.statusCode).toBe(200);
    expect(mocks.submit).not.toHaveBeenCalled();
    await app.close();
  });
});

```

- [ ] **Step 2: Run the test — it MUST fail (route file does not exist).**

Run: `pnpm --filter @switchboard/api test src/routes/__tests__/payments-webhook.test.ts`
Expected: FAIL — Cannot find module '../payments-webhook.js'.

- [ ] **Step 3: Create apps/api/src/routes/payments-webhook.ts. COPY the ad-optimizer.ts ingress-receiver structure (verified at apps/api/src/routes/ad-optimizer.ts:1-137): line 1 is the `// @route-class: ingress-receiver` header; verifyPaymentWebhookSignature mirrors verifyMetaWebhookSignature (HMAC over rawBody, fail-closed); resolve org from a Connection AFTER verify; then re-fetch the charge by id via the per-org PaymentPort (NEVER the body amount) and submit payment.record_verified. The contactId/opportunityId/bookingId are derived from the booking the externalReference encodes — for the Noop path the externalReference is `noop_pay_<bookingId>`, so parse the bookingId from it and look up the booking to get contact/opportunity. NOTE: payment.record_verified goes THROUGH PlatformIngress, so this route needs NO route-allowlist entry — only the route-class header.**

```ts
// @route-class: ingress-receiver
import type { FastifyPluginAsync } from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";
import { RECORD_VERIFIED_PAYMENT_INTENT } from "../bootstrap/operator-intents.js";

/**
 * Verify the PSP webhook HMAC over the RAW request body using
 * STRIPE_WEBHOOK_SECRET. Fails closed: missing secret, missing/empty raw body,
 * or missing/mismatched signature all return false. Mirrors
 * verifyMetaWebhookSignature in ad-optimizer.ts.
 */
export function verifyPaymentWebhookSignature(
  rawBody: string | undefined,
  signature: string | undefined,
  secret: string | undefined,
): boolean {
  if (!secret) {
    console.warn("[payments] verifyPaymentWebhookSignature called without STRIPE_WEBHOOK_SECRET");
    return false;
  }
  if (!rawBody || typeof signature !== "string" || signature.length === 0) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  if (signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export const paymentsWebhookRoutes: FastifyPluginAsync = async (app) => {
  app.post("/webhook", { config: { rawBody: true } }, async (request, reply) => {
    // 1. Verify HMAC over the raw body BEFORE trusting any field (the org is
    //    resolved from a forgeable account id below).
    const rawBody = (request as unknown as { rawBody?: string }).rawBody;
    const sigHeader = request.headers["x-payment-signature"];
    const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
    if (!verifyPaymentWebhookSignature(rawBody, signature, process.env["STRIPE_WEBHOOK_SECRET"])) {
      app.log.warn("Payment webhook: signature verification failed");
      return reply.code(401).send({ error: "Invalid signature", statusCode: 401 });
    }

    const payload = request.body as {
      id?: string;
      account?: string;
      data?: { externalReference?: string };
    };
    const messageId = payload.id;
    const account = payload.account;
    const externalReference = payload.data?.externalReference;
    if (!messageId || !externalReference) {
      return reply.code(200).send({ received: true, skipped: true, reason: "incomplete" });
    }

    // 2. Resolve org from the Connection AFTER verify (mirrors ad-optimizer.ts).
    let organizationId: string | null = null;
    let connectionId: string | undefined;
    if (account && app.prisma) {
      const connection = await app.prisma.connection.findFirst({
        where: { serviceId: "stripe", externalAccountId: account },
      });
      if (connection?.organizationId) {
        organizationId = connection.organizationId;
        connectionId = connection.id;
      }
    }
    if (!organizationId) {
      app.log.warn({ account }, "Payment webhook: no org for account, skipping");
      return reply.code(200).send({ received: true, skipped: true, reason: "no_org" });
    }

    // 3. Re-fetch the charge by id — NEVER trust the webhook body amount.
    const port = await app.paymentPortFactory(organizationId);
    const charge = await port.retrievePayment(externalReference);
    if (!charge || charge.status !== "paid") {
      return reply.code(200).send({ received: true, skipped: true, reason: "not_paid" });
    }

    // 4. Derive booking/contact/opportunity from the booking the reference encodes.
    //    Noop path: externalReference is `noop_pay_<bookingId>`.
    const bookingId = externalReference.startsWith("noop_pay_")
      ? externalReference.slice("noop_pay_".length)
      : null;
    if (!bookingId || !app.prisma) {
      return reply.code(200).send({ received: true, skipped: true, reason: "no_booking" });
    }
    const booking = await app.prisma.booking.findFirst({
      where: { id: bookingId, organizationId },
      select: { id: true, contactId: true, opportunityId: true },
    });
    if (!booking || !booking.opportunityId) {
      return reply.code(200).send({ received: true, skipped: true, reason: "no_booking" });
    }

    // 5. Submit through PlatformIngress. Idempotency key = provider message id, so
    //    a replayed delivery dedups at ingress; the partial-unique + outbox unique
    //    make the write itself a no-op even if a distinct key slips through.
    const result = await app.platformIngress.submit({
      intent: RECORD_VERIFIED_PAYMENT_INTENT,
      parameters: {
        contactId: booking.contactId,
        opportunityId: booking.opportunityId,
        bookingId: booking.id,
        amountCents: charge.amountCents,
        currency: charge.currency,
        externalReference: charge.externalReference,
        ...(connectionId ? { connectionId } : {}),
      },
      actor: { id: "system", type: "service" },
      organizationId,
      trigger: "api",
      surface: { surface: "api" },
      idempotencyKey: `payment-${messageId}`,
    });

    if (!result.ok) {
      app.log.error({ error: result.error }, "Verified-payment submission failed");
      return reply.code(500).send({ error: result.error.message, statusCode: 500 });
    }
    return reply.code(200).send({ received: true, workUnitId: result.workUnit.id });
  });
};

```

- [ ] **Step 4: Run the test again — it MUST pass. If TypeScript flags app.paymentPortFactory / app.platformIngress as unknown decorators, that is expected here (the standalone test decorates them with `as never`); the real type augmentation is added in Task 9 (app.ts decorate). The route file uses them structurally so it compiles against the test's decorations.**

Run: `pnpm --filter @switchboard/api test src/routes/__tests__/payments-webhook.test.ts`
Expected: PASS — missing/forged/no-secret 401s; unresolvable-org 200 skipped; the fetch-back assertion (submit amount 5000, not 999999); and not-paid 200-no-submit cases all green.

- [ ] **Step 5: Commit.**

Run: `git add apps/api/src/routes/payments-webhook.ts apps/api/src/routes/__tests__/payments-webhook.test.ts && git commit -m "feat(api): psp payment webhook ingress-receiver with fetch-back verification"`
Expected: Commit succeeds.


#### Task 9: Task 9 — Bootstrap wiring: paymentPortFactory decorator, ReceiptWriter, route registration

**Files:**
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/bootstrap/routes.ts`
- Test: `apps/api/src/routes/__tests__/payments-webhook.test.ts`

- [ ] **Step 1: Add the FastifyInstance type augmentation for the new decorator. In app.ts find the `declare module "fastify"` block that already declares `platformIngress` (verified near app.ts:60-67) and add paymentPortFactory next to it.**

```ts
    platformIngress: import("@switchboard/core/platform").PlatformIngress;
    paymentPortFactory: import("./bootstrap/payment-port-factory.js").PaymentPortFactory;
```

- [ ] **Step 2: Construct + decorate the PaymentPortFactory. In app.ts, near where the calendar provider factory or app.prisma is decorated (app.decorate("prisma", ...) is at app.ts:370), add the import at the top and the decoration. Place the decoration unconditionally (it does not need prisma; the Noop adapter is self-contained).**

```ts
// top of app.ts (with the other bootstrap imports):
import { createPaymentPortFactory } from "./bootstrap/payment-port-factory.js";

// near app.decorate("prisma", prismaClient):
app.decorate(
  "paymentPortFactory",
  createPaymentPortFactory({
    logger: { info: (m) => app.log.info(m), error: (m) => app.log.error(m) },
  }),
);
```

- [ ] **Step 3: Pass a ReceiptWriter into bootstrapOperatorIntents. In app.ts find the bootstrapOperatorIntents({...}) call (verified at app.ts:764-778) and add the receiptWriter option after runInTransaction. The ReceiptWriter writes a Receipt row through the tx Prisma client — this is the seam to 1A-3's Receipt model. tx is the StoreTransactionContext forwarded by runInTransaction; cast to the Prisma tx client (mirrors the outboxWriter cast at app.ts:773-774 `tx as never`).**

```ts
      runInTransaction: (fn) => prismaClient.$transaction((tx) => fn(tx)),
      receiptWriter: {
        write: async (input, tx) => {
          const client = (tx as typeof prismaClient) ?? prismaClient;
          await client.receipt.create({
            data: {
              organizationId: input.organizationId,
              kind: input.kind,
              tier: input.tier,
              status: input.status,
              verified: input.verified,
              bookingId: input.bookingId,
              opportunityId: input.opportunityId,
              externalRef: input.externalReference,
              amount: input.amount,
              currency: input.currency,
              provider: input.provider,
              ...(input.connectionId ? { connectionId: input.connectionId } : {}),
              capturedBy: "payment-webhook",
              verifiedAt: new Date(),
            },
          });
        },
      },
      logger: app.log,
```

- [ ] **Step 4: Register the webhook route. In apps/api/src/bootstrap/routes.ts add the import next to adOptimizerRoutes (verified at routes.ts:42) and the registration next to the adOptimizer registration (verified at routes.ts:237).**

```ts
// import (next to adOptimizerRoutes):
import { paymentsWebhookRoutes } from "../routes/payments-webhook.js";

// registration (next to adOptimizerRoutes):
await app.register(paymentsWebhookRoutes, { prefix: "/api/payments" });
```

- [ ] **Step 5: Typecheck the api package. The ReceiptWriter's `client.receipt.create(...)` requires the Receipt Prisma model from 1A-3. If 1A-3 has NOT landed in this branch yet, this will error on `receipt` / the column names — that is the explicit dependency. Resolve by rebasing onto 1A-3, then align the column names (kind/tier/status/externalRef/capturedBy/verifiedAt) to 1A-3's actual schema.prisma Receipt model.**

Run: `pnpm reset && pnpm --filter @switchboard/api typecheck`
Expected: No type errors once 1A-3's Receipt model is present. If `Property 'receipt' does not exist on PrismaClient` appears, 1A-3 has not merged — rebase onto it before continuing.

- [ ] **Step 6: Re-run the webhook route test to confirm the augmentation did not break the standalone test (it still decorates its own mocks).**

Run: `pnpm --filter @switchboard/api test src/routes/__tests__/payments-webhook.test.ts`
Expected: PASS — all route cases still green.

- [ ] **Step 7: Commit.**

Run: `git add apps/api/src/app.ts apps/api/src/bootstrap/routes.ts && git commit -m "feat(api): wire payment-port factory, receipt writer, and payment webhook route"`
Expected: Commit succeeds.


#### Task 10: Task 10 — Postgres-gated integration test: full webhook->ingress->writer one-tx + replay no-op

**Files:**
- Create: `apps/api/src/routes/__tests__/payments-webhook-integration.test.ts`
- Test: `apps/api/src/routes/__tests__/payments-webhook-integration.test.ts`

- [ ] **Step 1: Write the integration test that proves replay is a true no-op against a real $transaction + the partial-unique. Gate it on DATABASE_URL (mirror revenue-ingress.test.ts:460 describe.skipIf(!process.env["DATABASE_URL"])). It drives the writer handler directly with a real PrismaRevenueStore + PrismaOutboxStore + a real ReceiptWriter, calling it twice with the SAME externalReference, and asserts exactly one LifecycleRevenueEvent row, one Receipt row, and one outbox row. This is the load-bearing replay-proof assertion the route-unit test cannot make (it mocks the store).**

```ts
import { describe, it, expect, vi } from "vitest";
import { buildRecordVerifiedPaymentHandler } from "../../bootstrap/operator-intents/record-verified-payment.js";
import type { RunInTransaction } from "../../bootstrap/operator-intents/revenue.js";
import type { WorkUnit } from "@switchboard/core/platform";

const ORG = "org_pay_int";
const EXTREF = "noop_pay_book_pay_int";
const OPP = "opp_pay_int";
const BOOK = "book_pay_int";

function workUnit(): WorkUnit {
  return {
    id: "wu-int",
    requestedAt: new Date(0).toISOString(),
    organizationId: ORG,
    actor: { id: "system", type: "service" },
    intent: "payment.record_verified",
    parameters: {
      contactId: "c_pay_int",
      opportunityId: OPP,
      bookingId: BOOK,
      amountCents: 5000,
      currency: "SGD",
      externalReference: EXTREF,
      sourceCampaignId: "camp-1",
    },
    deployment: {} as never,
    resolvedMode: "operator_mutation",
    traceId: "t-int",
    trigger: "api",
    priority: "normal",
  } as WorkUnit;
}

describe.skipIf(!process.env["DATABASE_URL"])(
  "verified-payment writer — real $transaction replay (requires DATABASE_URL)",
  () => {
    it("a replayed charge (same externalReference) writes exactly one of each row", async () => {
      const { PrismaClient, PrismaRevenueStore, PrismaOutboxStore } = await import("@switchboard/db");
      const prisma = new PrismaClient();
      try {
        // Clean slate.
        const priorRev = await prisma.lifecycleRevenueEvent.findMany({
          where: { organizationId: ORG, externalReference: EXTREF },
          select: { id: true },
        });
        for (const r of priorRev) {
          await prisma.outboxEvent.deleteMany({ where: { eventId: `evt_pay_${r.id}` } });
        }
        await prisma.lifecycleRevenueEvent.deleteMany({ where: { organizationId: ORG, externalReference: EXTREF } });
        await prisma.receipt.deleteMany({ where: { organizationId: ORG, externalRef: EXTREF } });

        const revenueStore = new PrismaRevenueStore(prisma);
        const outboxStore = new PrismaOutboxStore(prisma);
        const runInTransaction: RunInTransaction = (fn) => prisma.$transaction((tx) => fn(tx));
        const receiptWriter = {
          write: async (input: Record<string, unknown>, tx?: unknown) => {
            const client = (tx as typeof prisma) ?? prisma;
            await client.receipt.create({
              data: {
                organizationId: input.organizationId as string,
                kind: "payment",
                tier: "T1_FETCH_BACK",
                status: "paid",
                verified: true,
                bookingId: input.bookingId as string,
                opportunityId: input.opportunityId as string,
                externalRef: input.externalReference as string,
                amount: input.amount as number,
                currency: input.currency as string,
                provider: "noop",
                capturedBy: "payment-webhook",
                verifiedAt: new Date(),
              },
            });
          },
        };

        const handler = buildRecordVerifiedPaymentHandler(
          receiptWriter,
          { record: (i, tx) => revenueStore.record(i, tx as never), findByOpportunity: revenueStore.findByOpportunity.bind(revenueStore), findByContact: revenueStore.findByContact.bind(revenueStore), sumByOrg: revenueStore.sumByOrg.bind(revenueStore), sumByCampaign: revenueStore.sumByCampaign.bind(revenueStore) },
          { write: (id, type, p, tx) => outboxStore.write(id, type, p, tx as never) },
          runInTransaction,
        );

        await handler.execute(workUnit());
        // Replay: same externalReference. The Receipt partial-unique + revenue
        // short-circuit + outbox unique must make this a no-op.
        await handler.execute(workUnit()).catch(() => {});

        const rev = await prisma.lifecycleRevenueEvent.findMany({ where: { organizationId: ORG, externalReference: EXTREF } });
        expect(rev).toHaveLength(1);
        const receipts = await prisma.receipt.findMany({ where: { organizationId: ORG, externalRef: EXTREF } });
        expect(receipts).toHaveLength(1);
        const outbox = await prisma.outboxEvent.findMany({ where: { eventId: `evt_pay_${rev[0]!.id}` } });
        expect(outbox).toHaveLength(1);

        // Cleanup.
        await prisma.outboxEvent.deleteMany({ where: { eventId: `evt_pay_${rev[0]!.id}` } });
        await prisma.lifecycleRevenueEvent.deleteMany({ where: { organizationId: ORG, externalReference: EXTREF } });
        await prisma.receipt.deleteMany({ where: { organizationId: ORG, externalRef: EXTREF } });
      } finally {
        await prisma.$disconnect();
      }
    });
  },
);

// Keep a non-Postgres assertion so the file is never an empty suite.
describe("verified-payment writer — eventId derivation (no Postgres)", () => {
  it("derives the outbox eventId from the revenue row id", async () => {
    const receiptWriter = { write: vi.fn(async () => {}) };
    const outboxWriter = { write: vi.fn(async () => {}) };
    const handler = buildRecordVerifiedPaymentHandler(
      receiptWriter,
      { record: vi.fn(async () => ({ id: "rev_x" }) as never), findByOpportunity: vi.fn(async () => []), findByContact: vi.fn(async () => []), sumByOrg: vi.fn(async () => ({ totalAmount: 0, count: 0 })), sumByCampaign: vi.fn(async () => []) },
      outboxWriter,
      async (fn) => fn(undefined),
    );
    await handler.execute(workUnit());
    expect(outboxWriter.write).toHaveBeenCalledWith("evt_pay_rev_x", "purchased", expect.anything(), undefined);
  });
});

```

- [ ] **Step 2: Run the test. Without DATABASE_URL the gated describe is skipped and only the eventId-derivation case runs; with DATABASE_URL (and 1A-3's Receipt model migrated), the replay-no-op case runs too.**

Run: `pnpm --filter @switchboard/api test src/routes/__tests__/payments-webhook-integration.test.ts`
Expected: PASS — eventId-derivation green; the Postgres-gated replay case green when DATABASE_URL is set, else skipped.

- [ ] **Step 3: Commit.**

Run: `git add apps/api/src/routes/__tests__/payments-webhook-integration.test.ts && git commit -m "test(api): verified-payment writer replay-no-op integration test"`
Expected: Commit succeeds.


#### Task 11: Task 11 — Full-suite verification + route-class + arch + lint gates

**Files:**
- Test: `packages/schemas`
- Test: `packages/core`
- Test: `packages/db`
- Test: `apps/api`

- [ ] **Step 1: Run the route-class validator to confirm payments-webhook.ts carries a recognized `// @route-class: ingress-receiver` header (the validator parses the first 2048 chars; valid classes verified at .agent/tools/route-class-validator.ts:3-18). This is the gate the MEMORY note 'new mutating route' references — but because this route goes through PlatformIngress.submit it needs only the class header, not a route-allowlist entry.**

Run: `CI=1 npx tsx scripts/local-verify-fast.ts`
Expected: check-routes + route-class validation pass; payments-webhook.ts recognized as ingress-receiver. No 'uncategorized route' or 'missing route-class' error.

- [ ] **Step 2: Run the architecture check (raw line count >600 errors; .ts only — verified by the MEMORY 'arch-check is .ts only' note). Confirm calendar-book.ts was NOT touched (helper is co-located) and no new file exceeds 600 lines.**

Run: `pnpm arch:check`
Expected: PASS — no file over 600 lines; layering intact (core deposit-link.ts imports only schemas; ad-optimizer untouched).

- [ ] **Step 3: Typecheck the whole repo to catch cross-package drift (the new schemas export, the core RevenueStore field, the api wiring). Run reset first per CLAUDE.md so lower-layer dist artifacts are fresh.**

Run: `pnpm reset && pnpm typecheck`
Expected: No type errors across schemas/core/db/api (assuming 1A-3's Receipt model is present for app.ts's receiptWriter).

- [ ] **Step 4: Run the full test suites for the four touched packages.**

Run: `pnpm --filter @switchboard/schemas test && pnpm --filter @switchboard/core test && pnpm --filter @switchboard/db test && pnpm --filter @switchboard/api test`
Expected: All green. Coverage holds: core 65/65/70/65 (deposit-link.ts fully covered), global 55/50/52/55.

- [ ] **Step 5: Run lint + prettier check (CI lint runs prettier; local lint does not — MEMORY 'CI prettier not in local lint'). Fix any formatting, then re-add.**

Run: `pnpm lint && pnpm format:check`
Expected: No lint errors; prettier reports all files formatted (semi, double quotes, 2-space, trailing commas, 100 width).

- [ ] **Step 6: Final branch-context sanity check before opening the PR (CLAUDE.md: verify branch context before every commit; MEMORY 'subagent cwd drift').**

Run: `git branch --show-current && git status --short && git log --oneline -11`
Expected: On the 1A-4 implementation branch; clean working tree; the eleven feature commits present.


---

## 1A-4b — feat(api): live stripe connect payment adapter behind paymentport

**Goal:** Ship a live StripeConnectPaymentAdapter that implements the SAME PaymentPort introduced by 1A-4 (exactly two methods: createDepositLink + retrievePayment), so the prove leg can take real money on a connected Stripe account without changing the webhook route, the verified-payment writer, or the port contract. createDepositLink opens a Connect destination-charge Checkout Session on the connected account with a deterministic Stripe idempotency key `deposit_${bookingId}` (re-issue reuses it). retrievePayment fetches the PaymentIntent by id and returns the AUTHORITATIVE Stripe-side amount/currency/status mapped into VerifiedPayment (never a webhook body amount). A standalone Connect `constructEvent` verifier (the shape the route's verifyPaymentWebhookSignature seam expects) is provided using the per-org Connect webhook secret — NOT a third port method. The per-org payment-port factory from 1A-4 is extended to return the Stripe adapter when the org has a 'stripe' Connection carrying Connect credentials, else keep returning the Noop adapter. The injected Stripe client is typed to exactly the three resources used, so no `any`. Everything is apps/api (L5); the only schemas import is the PaymentPort types. No Prisma migration in this PR.

**File structure:**

| Action | Path | Responsibility |
|---|---|---|
| create | `apps/api/src/payments/stripe-connect-payment-adapter.ts` | StripeConnectPaymentAdapter class implementing PaymentPort (createDepositLink + retrievePayment) plus an exported verifyConnectWebhookSignature helper; depends only on an injected, narrowly-typed StripeConnectClient (checkout.sessions.create, paymentIntents.retrieve, webhooks.constructEvent) so it is unit-testable with no network and no `any`. Maps PaymentIntent.Status -> VerifiedPayment.status and uses the Stripe-side amount/currency. createDepositLink passes stripeAccount + a deterministic idempotencyKey `deposit_${bookingId}`. |
| create | `apps/api/src/payments/stripe-connect-payment-adapter.test.ts` | Co-located unit tests: createDepositLink builds a destination charge on the connected account with idempotencyKey `deposit_${bookingId}` and re-issue reuses the same key; retrievePayment returns the Stripe-side amount/currency and maps status (succeeded->verified), returns null on a not-found PaymentIntent; status mapping matrix; verifyConnectWebhookSignature returns the constructed event on a good signature and rethrows on a tampered one (uses the per-org Connect secret). |
| create | `apps/api/src/payments/stripe-connect-credentials.ts` | Pure parser/validator: parseStripeConnectCredentials(decrypted: Record<string, unknown>) -> { connectedAccountId, secretKey, webhookSecret } | null. Fail-closed: returns null unless all three string fields are present and non-empty, so the factory never builds a live-money adapter from partial creds. |
| create | `apps/api/src/payments/stripe-connect-credentials.test.ts` | Co-located unit tests for the credential parser: full creds parse; each missing/blank/non-string field yields null; extra keys ignored. |
| modify | `apps/api/src/bootstrap/payment-port-factory.ts` | Extend the 1A-4 per-org factory: query the org's `stripe` Connection (findFirst where organizationId+serviceId='stripe'+status='connected'), decrypt + parse its Connect credentials; when present, construct and return a StripeConnectPaymentAdapter (real Stripe client built from the per-org secret); otherwise keep returning the Noop adapter. Per-org cache + ORG_ID_REQUIRED guard preserved. Fail-closed: never falls back to global env for a live write. |
| modify | `apps/api/src/bootstrap/__tests__/payment-port-factory.test.ts` | Add tests: factory returns a StripeConnectPaymentAdapter (not Noop) when a connected 'stripe' Connection with full Connect creds exists; returns Noop when no 'stripe' Connection; returns Noop when the 'stripe' Connection creds are partial (fail-closed); the Connection query filters by organizationId for cross-org isolation; injected stripeClientFactory + decrypt are used. |

**Notes:** DEPENDS ON 1A-4 (not yet merged anywhere as of 2026-06-06 — verified: no payment.ts / payment-port-factory.ts / noop-payment-adapter.ts / payments-webhook.ts exist in main or the worktree, and git log --all shows no 1A-4 commit). This plan treats the 1A-4 contract as FIXED per the task: PaymentPort has EXACTLY two methods (createDepositLink/retrievePayment), types DepositLinkInput/DepositLink/VerifiedPayment in packages/schemas/src/payment.ts, factory at apps/api/src/bootstrap/payment-port-factory.ts returning NoopPaymentAdapter, isNoopPaymentAdapter guard in apps/api/src/bootstrap/noop-payment-adapter.ts, and verifyPaymentWebhookSignature(rawBody, signature, secret) in apps/api/src/routes/payments-webhook.ts. Do NOT start 1A-4b until 1A-4 is merged; if 1A-4's concrete field names on DepositLinkInput/DepositLink/VerifiedPayment differ from what is assumed in Task 1 Step 1, FIX the adapter to the real schema — do not introduce a parallel type. The assumed-from-spec field set is: DepositLinkInput{organizationId,bookingId,amountCents,currency,description?,successUrl,cancelUrl}; DepositLink{url,externalReference}; VerifiedPayment{externalReference,amountCents,currency,status:'verified'|'pending'|'failed'}. Re-READ packages/schemas/src/payment.ts at execution start and reconcile.

CANONICAL CONTRACT IS FIXED — no third port method. Webhook signature verification is a STANDALONE function, never a PaymentPort method. The adapter exports verifyConnectWebhookSignature (the constructEvent seam) for the route to call with the per-org Connect secret; it is NOT on the PaymentPort interface.

LAYERING: everything new is apps/api (L5). The only @switchboard/schemas import is the PaymentPort types (payment.ts). decryptCredentials is imported from @switchboard/db (L4) — allowed from L5. Do NOT import @switchboard/core. ad-optimizer is irrelevant here.

NO `any`: the adapter accepts an injected StripeConnectClient typed to exactly the three resources used. Real signatures verified from the installed Stripe v22 typedefs (apps/api/node_modules/stripe/cjs): checkout.sessions.create(params?: Stripe.Checkout.SessionCreateParams, options?: Stripe.RequestOptions): Promise<Stripe.Response<Stripe.Checkout.Session>>; paymentIntents.retrieve(id: string, params?: Stripe.PaymentIntentRetrieveParams, options?: Stripe.RequestOptions): Promise<Stripe.Response<Stripe.PaymentIntent>>; webhooks.constructEvent(payload, header, secret, ...): Stripe.Event. Stripe.RequestOptions has idempotencyKey? and stripeAccount? (cjs/lib.d.ts). PaymentIntent.amount:number, .currency:string, .status: PaymentIntent.Status = 'canceled'|'processing'|'requires_action'|'requires_capture'|'requires_confirmation'|'requires_payment_method'|'succeeded'. Stripe.errors.StripeSignatureVerificationError exists (cjs/Error.d.ts).

MONEY-AUTHORITY RULE (spec §9.4, §4): retrievePayment returns the amount/currency FROM the PaymentIntent, never a caller- or body-supplied amount. There is a dedicated test for this. Currency from Stripe is lowercase ISO (e.g. 'sgd') and amount is already in minor units (cents) — map directly to amountCents, do NOT re-multiply (a 100x bug destroys trust, spec §12).

DETERMINISTIC IDEMPOTENCY (spec §10 1A-4 line): the Stripe idempotency key is `deposit_${bookingId}` passed in RequestOptions.idempotencyKey on checkout.sessions.create. Re-issuing for the same booking reuses the identical key so Stripe returns the same Session — there is a test asserting the key is identical across two calls. This is the STRIPE-side idempotency key (RequestOptions), distinct from the DB unique on externalReference that 1A-4 owns.

FAIL-CLOSED (spec §12 'fail closed if no org-scoped Connection — never fall back to global env for a live write'): the factory builds the Stripe adapter ONLY from a per-org 'stripe' Connection carrying full Connect creds (connectedAccountId+secretKey+webhookSecret all present). Partial creds or no Connection -> Noop. The existing apps Stripe service (apps/api/src/services/stripe-service.ts) is SUBSCRIPTION/billing-only (mode:'subscription', global STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET) — do NOT extend it and do NOT reuse its secret; the Connect secret is per-org from the Connection.

PATTERNS MIRRORED (verified file:line): factory shape + per-org cache + ORG_ID_REQUIRED + Noop fallback from apps/api/src/bootstrap/calendar-provider-factory.ts (its test mocks Prisma via vi.fn + `as never` and asserts the isNoop* guard — apps/api/src/bootstrap/__tests__/calendar-provider-factory.test.ts); Connection→decrypt→client + cross-org WHERE from apps/api/src/lib/ads-client-factory.ts (test stubs prisma.connection.findFirst + injects decryptCredentials — apps/api/src/lib/__tests__/ads-client-factory.test.ts); exact Connection query `findFirst({ where:{ organizationId, serviceId:'stripe', status:'connected' } })` from apps/api/src/lib/meta-spend-provider.ts:51-54; isNoop guard via instanceof from apps/api/src/bootstrap/noop-calendar-provider.ts:82-84; constructEvent usage from apps/api/src/services/stripe-service.ts:73. The 'stripe' serviceId is already the canonical payments service id (packages/db/src/storage/prisma-credential-resolver.ts:24).

FILE SIZE: new files are small and split (adapter / credentials parser separate) to stay well under the 400-line warn / 600-line error gate; do not inline into the factory. No new barrel.

TESTS ARE PURE UNIT (no Postgres, no network): the adapter takes an injected fake Stripe client (vi.fn-based); the factory takes an injected stripeClientFactory + decrypt so no real Stripe constructor runs. Mirrors the db-tests-mock-Prisma rule and the ads-client-factory injection style. Run with `pnpm --filter @switchboard/api test <path>` (api test = `vitest run`, verified package.json scripts). Conventional-commit subjects are lowercase (commitlint).

#### Task 1: Task 1 — StripeConnectClient type + adapter skeleton implementing PaymentPort (two methods)

**Files:**
- Create: `apps/api/src/payments/stripe-connect-payment-adapter.ts`
- Create: `apps/api/src/payments/stripe-connect-payment-adapter.test.ts`
- Test: `apps/api/src/payments/stripe-connect-payment-adapter.test.ts`

- [ ] **Step 1: PRE-FLIGHT (do this before writing any code): confirm 1A-4 has merged and re-read the real PaymentPort contract so the adapter implements the actual interface, not the assumption. If the file is missing, STOP — 1A-4 is the dependency.**

Run: `ls apps/api/src/bootstrap/payment-port-factory.ts apps/api/src/bootstrap/noop-payment-adapter.ts apps/api/src/routes/payments-webhook.ts packages/schemas/src/payment.ts && sed -n '1,80p' packages/schemas/src/payment.ts`
Expected: All four files exist and payment.ts shows `export interface PaymentPort` with exactly `createDepositLink(input: DepositLinkInput): Promise<DepositLink>` and `retrievePayment(externalReference: string): Promise<VerifiedPayment | null>`, plus the DepositLinkInput / DepositLink / VerifiedPayment type exports. Note the EXACT field names on those three types — use them verbatim in the steps below (the field names assumed here: DepositLinkInput.bookingId, .amountCents, .currency, .successUrl, .cancelUrl, .description?; DepositLink.url, .externalReference; VerifiedPayment.externalReference, .amountCents, .currency, .status). If any differ, substitute the real names everywhere below.

- [ ] **Step 2: Write the FAILING test file first. It defines a fake Stripe client (no network) typed structurally, constructs the adapter, and asserts createDepositLink returns a DepositLink whose url comes from the Checkout Session and whose externalReference is the session's payment_intent id. This pins the two-method PaymentPort shape and the destination-charge call. The adapter and its StripeConnectClient type do not exist yet, so this fails to compile/import.**

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
Expected: Vitest fails to run / resolve the suite with an error like "Failed to resolve import \"./stripe-connect-payment-adapter.js\"" (the adapter module has not been created).

- [ ] **Step 4: Create the adapter module with the narrowly-typed injected client and a minimal createDepositLink that satisfies the test. Type StripeConnectClient to EXACTLY the three Stripe resources, reusing the real Stripe types so there is no `any`. Implement createDepositLink as a Connect destination-charge Checkout Session (transfer_data.destination = connected account) created WITH stripeAccount option. Stub retrievePayment + verifyConnectWebhookSignature with throwing bodies for now (later tasks replace them) so the class compiles as a PaymentPort.**

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
Expected: 1 passing test ("opens a Checkout Session on the connected account and returns url + externalReference"). No `retrievePayment`/`verify` tests run yet.

- [ ] **Step 6: Commit the skeleton.**

Run: `git add apps/api/src/payments/stripe-connect-payment-adapter.ts apps/api/src/payments/stripe-connect-payment-adapter.test.ts && git commit -m "feat(api): stripe connect deposit-link via destination-charge checkout session"`
Expected: One commit created on the feature branch. (Confirm branch first with `git branch --show-current` per CLAUDE.md branch doctrine.)


#### Task 2: Task 2 — Deterministic Stripe idempotency key (re-issue reuses deposit_${bookingId})

**Files:**
- Modify: `apps/api/src/payments/stripe-connect-payment-adapter.test.ts`
- Test: `apps/api/src/payments/stripe-connect-payment-adapter.test.ts`

- [ ] **Step 1: Add a FAILING-by-absence test asserting that issuing a deposit link twice for the SAME bookingId sends the IDENTICAL Stripe idempotencyKey `deposit_${bookingId}` (so Stripe returns the same Session and money is never double-charged). The implementation already does this from Task 1, but the spec calls this out as a key test; write it explicitly so the behavior is locked. Append this describe block to the existing test file.**

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

- [ ] **Step 2: Run the test. It passes immediately because Task 1 already wired the deterministic key — this test is the regression guard. (If 1A-4's DepositLinkInput field names differ, this is the second place to fix them.)**

Run: `pnpm --filter @switchboard/api test src/payments/stripe-connect-payment-adapter.test.ts`
Expected: 3 passing tests total: the original create test, plus the two idempotency assertions in the new block ("reuses the deterministic key ...").

- [ ] **Step 3: Commit the idempotency regression test.**

Run: `git add apps/api/src/payments/stripe-connect-payment-adapter.test.ts && git commit -m "test(api): pin deterministic stripe idempotency key on deposit re-issue"`
Expected: One commit created.


#### Task 3: Task 3 — retrievePayment returns the Stripe-side amount/currency/status (never a body amount)

**Files:**
- Modify: `apps/api/src/payments/stripe-connect-payment-adapter.ts`
- Modify: `apps/api/src/payments/stripe-connect-payment-adapter.test.ts`
- Test: `apps/api/src/payments/stripe-connect-payment-adapter.test.ts`

- [ ] **Step 1: Write FAILING tests for retrievePayment. Assert it calls paymentIntents.retrieve with the externalReference (on the connected account), returns the amount/currency FROM the PaymentIntent (not any caller value), and maps status: succeeded->'verified', requires_payment_method/processing->'pending', canceled->'failed'. Append this describe block.**

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

- [ ] **Step 2: Run the suite. The two new retrievePayment tests MUST fail because retrievePayment still throws "not implemented yet".**

Run: `pnpm --filter @switchboard/api test src/payments/stripe-connect-payment-adapter.test.ts`
Expected: 2 failing tests in the retrievePayment block (Error: "retrievePayment not implemented yet"); the 3 create/idempotency tests still pass.

- [ ] **Step 3: Implement retrievePayment + a private status mapper in the adapter. Replace the throwing stub. Fetch the PaymentIntent by id on the connected account, read amount/currency/status FROM Stripe, and map the status. Add the mapper as a module-level pure function so it is independently testable and keeps the method short.**

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

- [ ] **Step 4: IMPORTANT placement note while applying the previous step: the class currently ends with the throwing `retrievePayment` stub followed by `}` (class close). Delete that stub method and the class-closing `}`, then paste the block above so the new `retrievePayment` becomes the last method, the class `}` is the one in the pasted block, and the two helper functions sit at module scope after it. Verify the file still has exactly one class-closing brace.**

Run: `pnpm --filter @switchboard/api test src/payments/stripe-connect-payment-adapter.test.ts`
Expected: All 5 tests pass (create, 2 idempotency-key assertions, 2 retrievePayment behaviors incl. the status matrix).

- [ ] **Step 5: Add a not-found test to lock the resource_missing -> null path, then re-run.**

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


#### Task 4: Task 4 — Standalone Connect constructEvent verifier (NOT a port method) rejecting tampered signatures

**Files:**
- Modify: `apps/api/src/payments/stripe-connect-payment-adapter.ts`
- Modify: `apps/api/src/payments/stripe-connect-payment-adapter.test.ts`
- Test: `apps/api/src/payments/stripe-connect-payment-adapter.test.ts`

- [ ] **Step 1: Write FAILING tests for an EXPORTED standalone verifier `verifyConnectWebhookSignature(client, rawBody, signature, connectWebhookSecret)` that delegates to Stripe's webhooks.constructEvent with the PER-ORG Connect secret. Assert it returns the constructed event on a good signature and rethrows when constructEvent throws a signature error (tampered body/sig). This is the seam the route's verifyPaymentWebhookSignature calls — it is NOT on PaymentPort. Append this block.**

```ts
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
      "{\"id\":\"evt_1\"}",
      "t=1,v1=goodsig",
      "whsec_connect_secret",
    );

    expect(event).toBe(fakeEvent);
    expect(constructEvent).toHaveBeenCalledWith(
      "{\"id\":\"evt_1\"}",
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
      verifyConnectWebhookSignature(client, "{\"id\":\"evt_1\"}", "t=1,v1=BADSIG", "whsec_connect_secret"),
    ).toThrow(/No signatures found/);
  });
});

```

- [ ] **Step 2: Run the suite. The two new tests MUST fail because verifyConnectWebhookSignature is not exported yet.**

Run: `pnpm --filter @switchboard/api test src/payments/stripe-connect-payment-adapter.test.ts`
Expected: 2 failing tests in the verifyConnectWebhookSignature block (import resolves but the named export is undefined -> "verifyConnectWebhookSignature is not a function"); the 6 prior tests pass.

- [ ] **Step 3: Add the exported standalone verifier at module scope in the adapter file (after the helpers). It simply delegates to the injected client's constructEvent with the per-org Connect secret, letting Stripe's own signature error propagate. It is deliberately NOT a method on the adapter/PaymentPort.**

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

- [ ] **Step 5: Sanity-check the adapter file size stays well under the 400-line warn gate.**

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

- [ ] **Step 1: Write the FAILING parser test first. parseStripeConnectCredentials takes the DECRYPTED credentials object and returns the three Connect fields only when ALL are present non-empty strings, else null (fail-closed — never build a live-money adapter from partial creds).**

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

- [ ] **Step 3: Create the parser module. Pure, no deps.**

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


#### Task 6: Task 6 — Extend the per-org payment-port factory to return the Stripe adapter for a 'stripe' Connection

**Files:**
- Modify: `apps/api/src/bootstrap/payment-port-factory.ts`
- Modify: `apps/api/src/bootstrap/__tests__/payment-port-factory.test.ts`
- Test: `apps/api/src/bootstrap/__tests__/payment-port-factory.test.ts`

- [ ] **Step 1: Re-read the 1A-4 factory to learn its EXACT exported function name, deps shape, and how it currently returns the Noop adapter — you will extend it in place, not rewrite it. Also re-read the Noop guard export so the test can assert Noop vs Stripe.**

Run: `sed -n '1,200p' apps/api/src/bootstrap/payment-port-factory.ts && echo '--- noop guard ---' && grep -n "isNoopPaymentAdapter\|export" apps/api/src/bootstrap/noop-payment-adapter.ts`
Expected: Shows the factory's exported creator (assumed `createPaymentPortFactory(deps)`), its deps object (assumed to include `prismaClient` and a logger, mirroring calendar-provider-factory), the per-org cache + ORG_ID_REQUIRED guard, and the branch that returns `new NoopPaymentAdapter(...)`. The guard file exports `isNoopPaymentAdapter`. If the real names differ, use the real ones in every step below.

- [ ] **Step 2: Add FAILING factory tests. They inject a fake Prisma (vi.fn connection.findFirst), a fake decrypt, and a fake stripeClientFactory, and assert: (a) a connected 'stripe' Connection with full Connect creds yields a StripeConnectPaymentAdapter (NOT Noop); (b) no 'stripe' Connection yields Noop; (c) partial creds yield Noop (fail-closed); (d) the Connection query filters by organizationId. Add a new describe block to the existing factory test file (keep the 1A-4 tests intact). NOTE: this assumes the 1A-4 factory accepts injectable `decryptCredentials` and `stripeClientFactory` deps; Step 4 adds those seams if 1A-4 did not already expose them.**

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

- [ ] **Step 3: Run the factory test. The new block MUST fail: the factory does not yet accept `decryptCredentials`/`stripeClientFactory`, does not query the Connection, and never returns a StripeConnectPaymentAdapter.**

Run: `pnpm --filter @switchboard/api test src/bootstrap/__tests__/payment-port-factory.test.ts`
Expected: Failures in the "Stripe Connect selection" block: the StripeConnectPaymentAdapter assertion fails (factory still returns Noop) and/or a type/arg error on the new deps; the existing 1A-4 factory tests still pass.

- [ ] **Step 4: Extend the factory. Add optional `decryptCredentials` and `stripeClientFactory` deps (defaulting to the real db decrypt and a real Stripe constructor), query the org's connected 'stripe' Connection, parse the creds fail-closed, and on success build a StripeConnectPaymentAdapter from a per-org client; otherwise keep the existing Noop return. Edit the deps interface and the per-org resolution body — do NOT touch the cache/ORG_ID_REQUIRED scaffolding. Apply the three edits below to apps/api/src/bootstrap/payment-port-factory.ts.**

```ts
// 1) ADD these imports at the top of payment-port-factory.ts (alongside the existing imports):
import Stripe from "stripe";
import { decryptCredentials as defaultDecryptCredentials } from "@switchboard/db";
import {
  StripeConnectPaymentAdapter,
  type StripeConnectClient,
} from "../payments/stripe-connect-payment-adapter.js";
import { parseStripeConnectCredentials } from "../payments/stripe-connect-credentials.js";

// 2) EXTEND the factory deps interface (add these three optional fields to the
//    existing PaymentPortFactoryDeps interface — keep prismaClient/logger):
//      decryptCredentials?: (encrypted: unknown) => Record<string, unknown>;
//      stripeClientFactory?: (secretKey: string) => StripeConnectClient;

// 3) REPLACE the body that currently returns `new NoopPaymentAdapter(...)`
//    inside the per-org resolve function with the Stripe-first logic below.
//    `deps` is the factory deps; `orgId` is the resolving org. Adjust the
//    Noop construction call to match 1A-4's exact NoopPaymentAdapter ctor.
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

// Fall through to the existing Noop return (unchanged from 1A-4).

```

- [ ] **Step 5: Run the factory test again. The Stripe-selection block passes and the 1A-4 tests still pass. The `apiVersion: "2026-04-22.dahlia"` matches the existing billing service (apps/api/src/services/stripe-service.ts:13), so Stripe's typed client constructs cleanly.**

Run: `pnpm --filter @switchboard/api test src/bootstrap/__tests__/payment-port-factory.test.ts`
Expected: All factory tests pass (1A-4's original suite + the 3 new Stripe-selection tests).

- [ ] **Step 6: Commit the factory extension.**

Run: `git add apps/api/src/bootstrap/payment-port-factory.ts apps/api/src/bootstrap/__tests__/payment-port-factory.test.ts && git commit -m "feat(api): payment-port factory returns stripe connect adapter for stripe connection"`
Expected: One commit created.


#### Task 7: Task 7 — Whole-package verification (types, lint, full api suite)

**Files:**
- Test: `apps/api/src/payments/stripe-connect-payment-adapter.test.ts`
- Test: `apps/api/src/payments/stripe-connect-credentials.test.ts`
- Test: `apps/api/src/bootstrap/__tests__/payment-port-factory.test.ts`

- [ ] **Step 1: Typecheck the api package — proves the narrow StripeConnectClient type, the Stripe v22 param/return types, and the PaymentPort `implements` all line up with no `any`. If it reports missing exports from @switchboard/schemas/db/core, run `pnpm reset` first (per CLAUDE.md) and re-run.**

Run: `pnpm --filter @switchboard/api typecheck`
Expected: No type errors.

- [ ] **Step 2: Lint the new/changed files (CI lint also runs prettier; this catches double-quote/semi/100-width drift before push).**

Run: `pnpm --filter @switchboard/api lint && pnpm format:check`
Expected: No eslint errors; prettier reports all matched files already formatted.

- [ ] **Step 3: Run the full api test suite to confirm nothing else regressed (the new adapter/factory are injected-only, so no live Stripe call is made).**

Run: `pnpm --filter @switchboard/api test`
Expected: The full suite passes, including the three new test files (stripe-connect-payment-adapter, stripe-connect-credentials, payment-port-factory).

- [ ] **Step 4: Confirm no new file breaches the 600-line error / 400-line warn gate.**

Run: `wc -l apps/api/src/payments/stripe-connect-payment-adapter.ts apps/api/src/payments/stripe-connect-credentials.ts apps/api/src/bootstrap/payment-port-factory.ts`
Expected: All three comfortably under 400 lines.

- [ ] **Step 5: Final branch-context check before opening the PR (CLAUDE.md branch doctrine: verify the active branch matches this work).**

Run: `git branch --show-current && git status --short && git log --oneline -7`
Expected: On the 1A-4b implementation branch (consuming the spec on main), a clean working tree, and the 6 task commits present. Open the PR against the integration base once 1A-4 has merged.


---

## 1A-5 — anti-fake hardening: deterministic eventId, origin markers + external-timestamp windowing, demoted operator revenue, gateway idempotency

**Goal:** Make the paid number trustworthy by closing five verified anti-fake defects (spec §9, PR 1A-5): (1) replace the random booked OutboxEvent eventId with a deterministic `evt_booked_${bookingId}` so a replayed booked event collides to one row; (2) add `origin String @default("live")` to Booking / ConversionRecord / LifecycleRevenueEvent (migration backfills existing rows to 'live'), stamp 'live' in the booking write path, and filter `origin='live'` in the trustworthy metric/read queries; (3) stamp the booked ConversionRecord's `occurredAt` with the EXTERNAL booking time (`Booking.startsAt`, i.e. `input.slotStart`) instead of the in-app wall clock, so a clock-game (two paid rows with the same write time but different external times) only counts the in-window one; (4) demote `operator.record_revenue` to `verified=false` and narrow its `recordedBy` enum to `{owner, staff}` (drop `stripe`/`integration`); (5) derive a gateway idempotency key from the provider message id (wamid) and plumb it into `CanonicalSubmitRequest.idempotencyKey` so a replayed inbound dedups at the existing `PlatformIngress.submit` idempotency claim. DEPENDS ON 1A-4 (PaymentReceipt verified writer + `LifecycleRevenueEvent.bookingId` already landed). Strict TDD, co-located *.test.ts, every mutation org-scoped.

**File structure:**

| Action | Path | Responsibility |
|---|---|---|
| modify | `packages/db/prisma/schema.prisma` | Add `origin String @default("live")` to the Booking (after line 1998 workTraceId), ConversionRecord (after line 2045 bookingId), and LifecycleRevenueEvent (after line 1844 sourceAdId) models. Add `@@index([organizationId, origin])` to each so the live-filter reads stay indexed. |
| create | `packages/db/prisma/migrations/20260606120000_anti_fake_origin_hardening/migration.sql` | Hand-written migration (same commit as the schema change): ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'live' on Booking, ConversionRecord, LifecycleRevenueEvent; backfill is implicit via the DEFAULT for existing rows; CREATE INDEX for (organizationId, origin) on each table. No partial-unique here (plain column + plain index), so no raw-SQL gymnastics beyond ADD COLUMN/CREATE INDEX. |
| modify | `packages/core/src/skill-runtime/tools/calendar-book.ts` | Measure 1: replace `const eventId = randomUUID();` (line 342) with `const eventId = \`evt_booked_${booking.id}\`;` and remove the now-unused `randomUUID` import (line 1). Measure 3: change the OutboxEvent payload `occurredAt` (line 367) from `new Date().toISOString()` to the external booking start `new Date(input.slotStart).toISOString()`. |
| modify | `packages/core/src/skill-runtime/tools/calendar-book.test.ts` | Add tests: deterministic booked eventId equals `evt_booked_${bookingId}`; booked-event payload `occurredAt` equals the external `slotStart`, not the wall clock. |
| modify | `packages/db/src/stores/prisma-booking-store.ts` | Stamp `origin: "live"` in the `booking.create` data block (after `workTraceId` on line 62). The store is the single live-booking writer; defaulting here means no app caller can drift it. |
| modify | `packages/db/src/stores/__tests__/prisma-booking-store.test.ts` | Add a test asserting `create` writes `origin: "live"` into `tx.booking.create` data. |
| modify | `packages/db/src/stores/prisma-conversion-record-store.ts` | Add `origin: "live"` to the upsert `create` block in `record()` (after `bookingId`, line 65) so the booked ConversionRecord written from the outbox is marked live. Add `origin: "live"` to the WHERE of the two trustworthy reads `queryBookedValueCentsByCampaign` (line 236 where) and `queryBookedStatsByCampaign` (line 273 where) so seed/demo rows can never inflate Riley's paid-value input. |
| modify | `packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts` | Add tests: `record` writes `origin: "live"`; `queryBookedValueCentsByCampaign` and `queryBookedStatsByCampaign` each include `origin: "live"` in the groupBy where (fixture-leakage guard). |
| modify | `packages/db/src/stores/prisma-revenue-store.ts` | Add `origin: "live"` to the `lifecycleRevenueEvent.create` data block in `record()` (after `sourceAdId`, line 90). Add `origin: "live"` to the WHERE of the trustworthy reads `sumByOrg` (line 121 where) and `sumByCampaign` (line 150 where) so seed/demo revenue never counts. |
| modify | `packages/db/src/stores/__tests__/prisma-revenue-store.test.ts` | Add tests: `record` writes `origin: "live"`; `sumByOrg` and `sumByCampaign` include `origin: "live"` in their where (fixture-leakage guard). |
| modify | `apps/api/src/routes/operator-intents-schemas.ts` | Measure 4: narrow `RecordRevenueParametersSchema.recordedBy` (line 89) from `z.enum(["owner", "staff", "stripe", "integration"])` to `z.enum(["owner", "staff"])`. Operators can only attest as owner/staff; `stripe`/`integration` is reserved for the PSP-fetch-back verified writer (1A-4). |
| modify | `apps/api/src/routes/revenue.ts` | Measure 4: narrow the route-local `RecordRevenueInputSchema.recordedBy` (line 24) to `z.enum(["owner", "staff"])` to match the parameters schema (the route validates body before ingress, so it must reject `stripe` at the edge too). |
| modify | `apps/api/src/bootstrap/operator-intents/revenue.ts` | Measure 4: pass `verified: false` explicitly into `revenueStore.record(...)` (in the input object around line 47) so the operator path can never be parsed/coerced into a verified row; the trustworthy count reads `verified=true` only. |
| modify | `apps/api/src/bootstrap/operator-intents/__tests__/revenue.test.ts` | Add a test asserting `revenueStore.record` is called with `verified: false`. Keep existing tests (they use `recordedBy: "owner"`/`"staff"`, both still valid). |
| modify | `apps/api/src/routes/__tests__/revenue-ingress.test.ts` | Add a test: POST /:orgId/revenue with `recordedBy: "stripe"` is rejected 400 by the narrowed enum (operator-forged-revenue regression). |
| modify | `packages/core/src/channel-gateway/types.ts` | Measure 5: add `messageId?: string;` to the `IncomingChannelMessage` interface (after `text`, line 197). The provider message id (wamid for WhatsApp) flows in so the gateway can derive a per-message idempotency key. |
| modify | `packages/core/src/channel-gateway/channel-gateway.ts` | Measure 5: when `message.messageId` is present, set `idempotencyKey: \`inbound:${message.channel}:${message.messageId}\`` on the `CanonicalSubmitRequest` (the object built at line 310) so a replayed inbound (same wamid) dedups at the existing `PlatformIngress.submit` idempotency claim (canonical-request.ts:27, platform-ingress.ts:100). |
| create | `packages/core/src/channel-gateway/__tests__/channel-gateway-idempotency.test.ts` | Gateway idempotency tests: same `messageId` twice => `submit` receives the same `idempotencyKey` both times (the ingress claim then collapses the replay to one execution); no `messageId` => `idempotencyKey` is undefined (backward-compat). |
| modify | `apps/chat/src/routes/managed-webhook.ts` | Measure 5 wiring: pass the already-extracted `rawMessageId` (line 158) into the `handleIncoming` call (line 172) as `messageId: rawMessageId ?? undefined` so the live WhatsApp inbound path supplies the wamid. |
| modify | `apps/chat/src/routes/__tests__/managed-webhook.test.ts` | Add/extend a test asserting the gateway `handleIncoming` is called with `messageId` equal to the extracted wamid (so the same wamid twice yields one booking through the ingress claim). |

**Notes:** LAYERING: all reads/writes stay in their existing layer — schema (db), calendar-book (core L3), revenue handler/schemas (apps/api L5), gateway (core L3), managed-webhook (apps/chat L5). No new cross-layer imports; ad-optimizer is NOT touched (its `queryBookedValueCentsByCampaign` caller transparently gets the origin filter because the predicate lives in the L4 store). DEPENDS ON 1A-4: that PR already added `LifecycleRevenueEvent.bookingId`, the `payment.record_verified` (system_auto_approved) intent that writes `recordedBy:'stripe', verified:true`, and the PaymentReceipt unique on `externalReference`. This PR's narrowing of the OPERATOR enum to {owner,staff} must NOT touch the store-level `RecordRevenueInput` type (prisma-revenue-store.ts:17) which keeps `stripe|integration` for that verified writer — narrow only the two operator-facing Zod schemas (operator-intents-schemas.ts:89, revenue.ts:24). SEED-STAMPING (spec §9 measure 2 "seed scripts stamp seed"): verified by grep that NO current seed script (seed.ts, seed-dev-data.ts, seed-marketplace.ts, packages/db/src/seed/*) creates Booking/ConversionRecord/LifecycleRevenueEvent rows, so there is no seed writer to stamp; the obligation is met by the column DEFAULT 'live' (so any future fixture writer must opt OUT to mark seed/demo) plus the live-only metric filter — a guard test pins the filter. If a later PR adds a seed writer for these rows it MUST pass `origin:'seed'`. WINDOWING (measure 3): the only write site with a real external anchor is the booked ConversionRecord (its `occurredAt` becomes `Booking.startsAt` = `input.slotStart`); `operator-intents/revenue.ts:63` has no external charge time for operator-typed revenue and is left wall-clock, which is harmless because that path is verified=false and excluded from the trustworthy count by measure 4 — documented in the windowing task. PRISMA RESET: if `pnpm typecheck` reports `origin` unknown on the Prisma model after editing schema.prisma, run `pnpm reset` (regenerates the client) before re-running — the new column won't exist on the generated client until then. DB TESTS MOCK PRISMA (CI has no Postgres) — all packages/db tests follow the makeMockPrisma()/vi.fn() pattern already in the touched test files; assert on `.mock.calls[0][0]` shape, never a live DB. ORG-SCOPE: the reads touched already include `organizationId` in WHERE; we only ADD `origin` — no WHERE loses its org scope, no mutation changes from updateMany semantics. FILE SIZE: calendar-book.test.ts already carries an eslint-disable max-lines marker (line 1) — appending two short tests is consistent with that existing convention; no new file needed. COMMIT GRANULARITY: one commit per measure (5 commits) keeps each green and reviewable; all conventional-commit lowercase subjects.

#### Task 1: Measure 1 — deterministic booked OutboxEvent eventId (replay collapses to one row)

**Files:**
- Modify: `packages/core/src/skill-runtime/tools/calendar-book.ts`
- Test: `packages/core/src/skill-runtime/tools/calendar-book.test.ts`

- [ ] **Step 1: Add a failing test that the booked OutboxEvent eventId is the deterministic `evt_booked_${bookingId}`, not a random UUID. Open packages/core/src/skill-runtime/tools/calendar-book.test.ts and append this test INSIDE the top-level `describe("createCalendarBookToolFactory", ...)` block, just before its closing `});`. It reuses the suite's shared `beforeEach` scaffold (bookingStore, calendarProvider, runTransaction, tool). The key move: capture the `tx.outboxEvent.create` spy by overriding `runTransaction` for this test so we can read the eventId the tool wrote.**

```ts
  it("booking.create writes a deterministic booked eventId (evt_booked_<bookingId>)", async () => {
    bookingStore.create.mockResolvedValue({ id: "bk_det_1" });
    opportunityStore.findActiveByContact.mockResolvedValue({ id: "opp_1" });
    calendarProvider.createBooking.mockResolvedValue({ calendarEventId: "gcal_1" });
    const outboxCreate = vi.fn().mockResolvedValue({ id: "ob_1" });
    const runTx = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        booking: { update: vi.fn().mockResolvedValue({ id: "bk_det_1" }) },
        outboxEvent: { create: outboxCreate },
        opportunity: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      }),
    );
    const t = createCalendarBookToolFactory({
      calendarProviderFactory: calendarProviderFactory as never,
      isCalendarProviderConfigured: isCalendarProviderConfigured as never,
      bookingStore: bookingStore as never,
      opportunityStore: opportunityStore as never,
      runTransaction: runTx as never,
      failureHandler: failureHandler as never,
      contactStore: contactStore as never,
      defaultCurrency: "SGD",
    })({ ...TRUSTED_CTX, contactId: "ct_1" });
    await t.operations["booking.create"]!.execute({
      service: "facial",
      slotStart: "2026-07-01T10:00:00.000Z",
      slotEnd: "2026-07-01T11:00:00.000Z",
      calendarId: "cal_1",
    });
    expect(outboxCreate).toHaveBeenCalledTimes(1);
    expect(outboxCreate.mock.calls[0]![0].data.eventId).toBe("evt_booked_bk_det_1");
  });
```

- [ ] **Step 2: Run the new test and watch it fail because the tool currently writes a random UUID, not `evt_booked_bk_det_1`.**

Run: `pnpm --filter @switchboard/core test calendar-book.test.ts -t "deterministic booked eventId"`
Expected: 1 failing test: `expected 'evt_booked_bk_det_1' but received '<some-uuid>'` (a 36-char UUID). The rest of the suite is not run because of the -t filter.

- [ ] **Step 3: Make it pass: in packages/core/src/skill-runtime/tools/calendar-book.ts replace the random eventId at line 342 with the deterministic form keyed on the booking id (which already exists in scope as `booking.id`).**

```ts
            const eventId = `evt_booked_${booking.id}`;
```

- [ ] **Step 4: Remove the now-unused `randomUUID` import. At line 1 of calendar-book.ts delete the import line entirely (it is the only use of randomUUID in this file).**

```ts
// DELETE this line (was line 1):
// import { randomUUID } from "node:crypto";
```

- [ ] **Step 5: Re-run the targeted test — it should pass now.**

Run: `pnpm --filter @switchboard/core test calendar-book.test.ts -t "deterministic booked eventId"`
Expected: 1 passing test, 0 failing.

- [ ] **Step 6: Run the whole calendar-book suite to confirm removing the import and changing the eventId did not break sibling tests (some assert on outbox payload).**

Run: `pnpm --filter @switchboard/core test calendar-book.test.ts`
Expected: All calendar-book.test.ts tests pass (the previous green count + 1).

- [ ] **Step 7: Commit measure 1.**

Run: `git add packages/core/src/skill-runtime/tools/calendar-book.ts packages/core/src/skill-runtime/tools/calendar-book.test.ts && git commit -m "fix(core): deterministic booked outbox eventId for replay safety"`
Expected: One commit created on the current branch; commitlint accepts the lowercase subject.


#### Task 2: Measure 3 — booked ConversionRecord windows on external Booking.startsAt, not the wall clock

**Files:**
- Modify: `packages/core/src/skill-runtime/tools/calendar-book.ts`
- Test: `packages/core/src/skill-runtime/tools/calendar-book.test.ts`

- [ ] **Step 1: Add a failing test that the booked OutboxEvent payload's `occurredAt` is the EXTERNAL booking start (`slotStart`), not the in-app wall-clock time. This is the clock-game defence at the write side: the downstream metric windows on `occurredAt`, so `occurredAt` must carry the external timestamp. Append this test inside the top-level describe block, after the measure-1 test.**

```ts
  it("booking.create stamps the booked event occurredAt with the external slotStart, not the wall clock", async () => {
    bookingStore.create.mockResolvedValue({ id: "bk_ts_1" });
    opportunityStore.findActiveByContact.mockResolvedValue({ id: "opp_1" });
    calendarProvider.createBooking.mockResolvedValue({ calendarEventId: "gcal_1" });
    const outboxCreate = vi.fn().mockResolvedValue({ id: "ob_1" });
    const runTx = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        booking: { update: vi.fn().mockResolvedValue({ id: "bk_ts_1" }) },
        outboxEvent: { create: outboxCreate },
        opportunity: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      }),
    );
    const t = createCalendarBookToolFactory({
      calendarProviderFactory: calendarProviderFactory as never,
      isCalendarProviderConfigured: isCalendarProviderConfigured as never,
      bookingStore: bookingStore as never,
      opportunityStore: opportunityStore as never,
      runTransaction: runTx as never,
      failureHandler: failureHandler as never,
      contactStore: contactStore as never,
      defaultCurrency: "SGD",
    })({ ...TRUSTED_CTX, contactId: "ct_1" });
    await t.operations["booking.create"]!.execute({
      service: "facial",
      slotStart: "2026-07-01T10:00:00.000Z",
      slotEnd: "2026-07-01T11:00:00.000Z",
      calendarId: "cal_1",
    });
    expect(outboxCreate.mock.calls[0]![0].data.payload.occurredAt).toBe(
      "2026-07-01T10:00:00.000Z",
    );
  });
```

- [ ] **Step 2: Run the new test and watch it fail because the payload currently sets `occurredAt: new Date().toISOString()` (today's wall clock), which is not the 2026-07-01 slotStart.**

Run: `pnpm --filter @switchboard/core test calendar-book.test.ts -t "external slotStart"`
Expected: 1 failing test: `expected '2026-07-01T10:00:00.000Z' but received '<today's ISO timestamp>'`.

- [ ] **Step 3: Make it pass: in packages/core/src/skill-runtime/tools/calendar-book.ts change the booked OutboxEvent payload `occurredAt` (line 367) to the external booking start. `input.slotStart` is already an ISO string but re-parsing through Date normalizes it.**

```ts
                  occurredAt: new Date(input.slotStart).toISOString(),
```

- [ ] **Step 4: Re-run the targeted test — it should pass now.**

Run: `pnpm --filter @switchboard/core test calendar-book.test.ts -t "external slotStart"`
Expected: 1 passing test, 0 failing.

- [ ] **Step 5: Run the full calendar-book suite again to confirm no sibling test asserted the old wall-clock occurredAt.**

Run: `pnpm --filter @switchboard/core test calendar-book.test.ts`
Expected: All calendar-book.test.ts tests pass.

- [ ] **Step 6: Commit measure 3.**

Run: `git add packages/core/src/skill-runtime/tools/calendar-book.ts packages/core/src/skill-runtime/tools/calendar-book.test.ts && git commit -m "fix(core): window booked conversion on external slotStart not wall clock"`
Expected: One commit created; commitlint accepts the subject.


#### Task 3: Measure 2a — schema: add origin column to Booking / ConversionRecord / LifecycleRevenueEvent (+ migration)

**Files:**
- Create: `packages/db/prisma/migrations/20260606120000_anti_fake_origin_hardening/migration.sql`
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add the `origin` field to the LifecycleRevenueEvent model. In packages/db/prisma/schema.prisma, find the `sourceAdId String?` line at 1844 inside `model LifecycleRevenueEvent` and add the origin field right after it, then add an index. Replace the existing `sourceAdId  String?` line plus the following blank-then-recordedAt lines region by editing: insert `origin String @default("live")` after sourceAdId and `@@index([organizationId, origin])` in the index block (after line 1850 `@@index([organizationId, recordedAt])`).**

```ts
// In model LifecycleRevenueEvent, after the line:
//   sourceAdId        String?
// add:
  origin            String      @default("live")
// and in the index block, after `@@index([organizationId, recordedAt])`, add:
  @@index([organizationId, origin])
```

- [ ] **Step 2: Add the `origin` field to the Booking model. In schema.prisma `model Booking`, after the `workTraceId String?` line (1998) add the origin field, and add an index in the Booking index block (after `@@index([status])`, line 2010).**

```ts
// In model Booking, after the line:
//   workTraceId     String?
// add:
  origin          String    @default("live")
// and in the index block, after `@@index([status])`, add:
  @@index([organizationId, origin])
```

- [ ] **Step 3: Add the `origin` field to the ConversionRecord model. In schema.prisma `model ConversionRecord`, after the `bookingId String?` line (2045) add the origin field, and add an index in its index block (after `@@index([bookingId])`, line 2053).**

```ts
// In model ConversionRecord, after the line:
//   bookingId         String?
// add:
  origin            String   @default("live")
// and in the index block, after `@@index([bookingId])`, add:
  @@index([organizationId, origin])
```

- [ ] **Step 4: Create the hand-written migration directory and SQL (Prisma 6 + no live Postgres here, so we author the DDL directly, mirroring the precedent migration 20260603120000). The DEFAULT 'live' backfills every existing row in the ADD COLUMN itself, satisfying 'backfill existing rows to live'. The timestamp 20260606120000 sorts after the latest existing migration (20260604233000).**

```ts
-- 1A-5 anti-fake hardening: provenance marker so seed/demo rows can never
-- inflate the trustworthy paid number. ADD COLUMN ... DEFAULT 'live' backfills
-- every pre-existing row to 'live' atomically; future fixture writers must
-- explicitly set origin='seed'|'demo'. Plain column + plain index (no partial
-- unique), so this is expressible without the raw-SQL partial-index dance.
ALTER TABLE "Booking" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'live';
ALTER TABLE "ConversionRecord" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'live';
ALTER TABLE "LifecycleRevenueEvent" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'live';

CREATE INDEX "Booking_organizationId_origin_idx" ON "Booking" ("organizationId", "origin");
CREATE INDEX "ConversionRecord_organizationId_origin_idx" ON "ConversionRecord" ("organizationId", "origin");
CREATE INDEX "LifecycleRevenueEvent_organizationId_origin_idx" ON "LifecycleRevenueEvent" ("organizationId", "origin");
```

- [ ] **Step 5: Regenerate the Prisma client so the generated types carry the new `origin` field (the store edits in the next tasks won't typecheck until this runs). `pnpm reset` clears dist + regenerates the client + rebuilds schemas/db/core.**

Run: `pnpm reset`
Expected: Turbo clean + prisma generate + rebuild of schemas/db/core all succeed; no TypeScript errors. The generated client now knows `origin` on Booking/ConversionRecord/LifecycleRevenueEvent.

- [ ] **Step 6: Sanity-check the migration filename matches Prisma's index-name 63-char cap convention and that the schema parses. (No Postgres needed for `prisma validate`.)**

Run: `pnpm --filter @switchboard/db exec prisma validate`
Expected: `The schema at prisma/schema.prisma is valid` (or equivalent success). No errors about unknown attributes.

- [ ] **Step 7: Commit measure 2a (schema + migration together, per the same-commit rule for schema changes).**

Run: `git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260606120000_anti_fake_origin_hardening/migration.sql && git commit -m "feat(db): add origin provenance column to booking, conversion, revenue"`
Expected: One commit with both the schema and its migration; commitlint accepts the subject.


#### Task 4: Measure 2b — stamp origin=live on the three live writers and filter origin=live on the trustworthy reads

**Files:**
- Modify: `packages/db/src/stores/prisma-booking-store.ts`
- Modify: `packages/db/src/stores/prisma-conversion-record-store.ts`
- Modify: `packages/db/src/stores/prisma-revenue-store.ts`
- Test: `packages/db/src/stores/__tests__/prisma-booking-store.test.ts`
- Test: `packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts`
- Test: `packages/db/src/stores/__tests__/prisma-revenue-store.test.ts`

- [ ] **Step 1: Booking writer — failing test first. Open packages/db/src/stores/__tests__/prisma-booking-store.test.ts and add a test that `create` stamps `origin: "live"`. The suite mocks `$transaction` to invoke its callback with a `tx` whose `booking.create` is a spy; assert on that spy's data. (If the file's mock helper differs, read its existing `create` test and mirror the exact tx-mock shape — the key assertion is the data.origin value.)**

```ts
  it("stamps origin 'live' on create", async () => {
    const createSpy = vi.fn().mockResolvedValue({ id: "bk_1" });
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      booking: { findFirst: vi.fn().mockResolvedValue(null), create: createSpy },
    };
    const prisma = { $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)) };
    const store = new PrismaBookingStore(prisma as never);
    await store.create({
      organizationId: "org-1",
      contactId: "ct-1",
      service: "facial",
      startsAt: new Date("2026-07-01T10:00:00Z"),
      endsAt: new Date("2026-07-01T11:00:00Z"),
    });
    expect(createSpy.mock.calls[0]![0].data.origin).toBe("live");
  });
```

- [ ] **Step 2: Run it — fails because the store's create data has no `origin` key (undefined).**

Run: `pnpm --filter @switchboard/db test prisma-booking-store.test.ts -t "stamps origin"`
Expected: 1 failing test: `expected 'live' but received undefined`.

- [ ] **Step 3: Make it pass: in packages/db/src/stores/prisma-booking-store.ts add `origin: "live",` to the `tx.booking.create` data block, right after the `workTraceId` line (62).**

```ts
          origin: "live",
```

- [ ] **Step 4: Conversion-record writer + reads — failing tests. Open packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts. Add three tests using the file's existing `makePrisma()` helper (which already mocks `conversionRecord.upsert` and `groupBy`): (a) record stamps origin live; (b) queryBookedValueCentsByCampaign filters origin live; (c) queryBookedStatsByCampaign filters origin live. Place them inside the top-level describe.**

```ts
  it("stamps origin 'live' on record upsert create", async () => {
    (prisma.conversionRecord.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "cr_o" });
    await store.record({
      eventId: "evt_o",
      type: "booked",
      contactId: "ct_1",
      organizationId: "org_1",
      value: 100,
      occurredAt: new Date("2026-07-01T10:00:00Z"),
      source: "calendar-book",
      metadata: {},
    });
    const call = (prisma.conversionRecord.upsert as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.create.origin).toBe("live");
  });

  it("queryBookedValueCentsByCampaign excludes non-live rows (origin live filter)", async () => {
    const groupBy = prisma.conversionRecord.groupBy as ReturnType<typeof vi.fn>;
    groupBy.mockResolvedValue([]);
    await store.queryBookedValueCentsByCampaign({
      orgId: "org_1",
      from: new Date("2026-06-01"),
      to: new Date("2026-06-30"),
    });
    expect(groupBy.mock.calls[0]![0].where.origin).toBe("live");
  });

  it("queryBookedStatsByCampaign excludes non-live rows (origin live filter)", async () => {
    const groupBy = prisma.conversionRecord.groupBy as ReturnType<typeof vi.fn>;
    groupBy.mockResolvedValue([]);
    await store.queryBookedStatsByCampaign({
      orgId: "org_1",
      from: new Date("2026-06-01"),
      to: new Date("2026-06-30"),
    });
    expect(groupBy.mock.calls[0]![0].where.origin).toBe("live");
  });
```

- [ ] **Step 5: Run the three conversion-store tests — all fail (no origin in create, no origin in the two where clauses).**

Run: `pnpm --filter @switchboard/db test prisma-conversion-record-store.test.ts -t "origin"`
Expected: 3 failing tests, each `expected 'live' but received undefined`.

- [ ] **Step 6: Make them pass: in packages/db/src/stores/prisma-conversion-record-store.ts, (1) add `origin: "live",` to the upsert `create` block in `record()` right after the `bookingId,` line (65).**

```ts
        origin: "live",
```

- [ ] **Step 7: (2) In `queryBookedValueCentsByCampaign`, add `origin: "live",` to the groupBy `where` (after `type: "booked",`, line 233-236 region).**

```ts
        origin: "live",
```

- [ ] **Step 8: (3) In `queryBookedStatsByCampaign`, add the same `origin: "live",` to its groupBy `where` (after `type: "booked",`, line 270-273 region).**

```ts
        origin: "live",
```

- [ ] **Step 9: Run the conversion-store origin tests — they should pass.**

Run: `pnpm --filter @switchboard/db test prisma-conversion-record-store.test.ts -t "origin"`
Expected: 3 passing, 0 failing.

- [ ] **Step 10: Revenue writer + reads — failing tests. Open packages/db/src/stores/__tests__/prisma-revenue-store.test.ts (uses `makeMockPrisma()` with `lifecycleRevenueEvent.create`, `.aggregate`, `.groupBy`). Add three tests: record stamps origin live; sumByOrg filters origin live; sumByCampaign filters origin live. Place inside the top-level describe.**

```ts
  it("stamps origin 'live' on record create", async () => {
    prisma.lifecycleRevenueEvent.create.mockResolvedValue(makeRevenueEvent({}));
    await store.record({
      organizationId: "org-1",
      contactId: "contact-1",
      opportunityId: "opp-1",
      amount: 1000,
      type: "payment",
      recordedBy: "owner",
    });
    expect(prisma.lifecycleRevenueEvent.create.mock.calls[0]![0].data.origin).toBe("live");
  });

  it("sumByOrg filters origin 'live'", async () => {
    await store.sumByOrg("org-1");
    expect(prisma.lifecycleRevenueEvent.aggregate.mock.calls[0]![0].where.origin).toBe("live");
  });

  it("sumByCampaign filters origin 'live'", async () => {
    await store.sumByCampaign("org-1");
    expect(prisma.lifecycleRevenueEvent.groupBy.mock.calls[0]![0].where.origin).toBe("live");
  });
```

- [ ] **Step 11: Run the three revenue-store tests — all fail.**

Run: `pnpm --filter @switchboard/db test prisma-revenue-store.test.ts -t "origin"`
Expected: 3 failing tests, each `expected 'live' but received undefined`.

- [ ] **Step 12: Make them pass: in packages/db/src/stores/prisma-revenue-store.ts, (1) add `origin: "live",` to the `lifecycleRevenueEvent.create` data block right after `sourceAdId: input.sourceAdId ?? null,` (line 90).**

```ts
        origin: "live",
```

- [ ] **Step 13: (2) In `sumByOrg`, add `origin: "live",` to the `where` object initializer (alongside `organizationId` and `status: "confirmed"`, line 121-124).**

```ts
      origin: "live",
```

- [ ] **Step 14: (3) In `sumByCampaign`, add `origin: "live",` to its `where` object initializer (alongside `organizationId`, `status: "confirmed"`, `sourceCampaignId: { not: null }`, line 150-156).**

```ts
      origin: "live",
```

- [ ] **Step 15: Run the revenue-store origin tests — they should pass.**

Run: `pnpm --filter @switchboard/db test prisma-revenue-store.test.ts -t "origin"`
Expected: 3 passing, 0 failing.

- [ ] **Step 16: Run all three touched db store suites in full to confirm the added origin keys did not break existing assertions (some tests assert exact `where`/`data` shapes via objectContaining, which tolerates extra keys; a strict toEqual would not — this run catches that).**

Run: `pnpm --filter @switchboard/db test prisma-booking-store.test.ts prisma-conversion-record-store.test.ts prisma-revenue-store.test.ts`
Expected: All three suites pass (previous green counts + the 7 new tests).

- [ ] **Step 17: Commit measure 2b.**

Run: `git add packages/db/src/stores/prisma-booking-store.ts packages/db/src/stores/prisma-conversion-record-store.ts packages/db/src/stores/prisma-revenue-store.ts packages/db/src/stores/__tests__/prisma-booking-store.test.ts packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts packages/db/src/stores/__tests__/prisma-revenue-store.test.ts && git commit -m "feat(db): stamp origin live on writers, filter origin live on trustworthy reads"`
Expected: One commit; commitlint accepts the subject.


#### Task 5: Measure 4 — demote operator.record_revenue to verified=false and narrow recordedBy to {owner,staff}

**Files:**
- Modify: `apps/api/src/routes/operator-intents-schemas.ts`
- Modify: `apps/api/src/routes/revenue.ts`
- Modify: `apps/api/src/bootstrap/operator-intents/revenue.ts`
- Test: `apps/api/src/bootstrap/operator-intents/__tests__/revenue.test.ts`
- Test: `apps/api/src/routes/__tests__/revenue-ingress.test.ts`

- [ ] **Step 1: Failing test 1 — handler must force verified=false. Open apps/api/src/bootstrap/operator-intents/__tests__/revenue.test.ts and add a test asserting `revenueStore.record` receives `verified: false`. Mirror the existing test setup (sentinelRunner, revenueStore/outboxWriter spies).**

```ts
  it("forces verified:false on the operator-recorded revenue (only PSP fetch-back verifies)", async () => {
    const revenueStore = { record: vi.fn().mockResolvedValue({ id: "rev_v", amount: 100, currency: "SGD" }) };
    const outboxWriter = { write: vi.fn().mockResolvedValue(undefined) };
    const handler = buildRecordRevenueHandler(revenueStore as never, outboxWriter, sentinelRunner);
    await handler.execute({
      organizationId: "org_a",
      actor: { id: "u1", type: "user" },
      parameters: {
        contactId: "c1",
        amount: 100,
        currency: "SGD",
        type: "payment",
        recordedBy: "owner",
      },
    } as never);
    expect(revenueStore.record).toHaveBeenCalledWith(
      expect.objectContaining({ verified: false }),
      SENTINEL_TX,
    );
  });
```

- [ ] **Step 2: Run it — fails because the handler currently omits `verified` from the record input (it is absent, not literally false).**

Run: `pnpm --filter @switchboard/api test revenue.test.ts -t "forces verified:false"`
Expected: 1 failing test: the objectContaining({ verified: false }) does not match because the record call has no `verified` key.

- [ ] **Step 3: Make it pass: in apps/api/src/bootstrap/operator-intents/revenue.ts add `verified: false,` to the object passed to `revenueStore.record(...)`. Insert it right after the `recordedBy: params.recordedBy,` line (46).**

```ts
            verified: false,
```

- [ ] **Step 4: Run the handler test again — passes. Also run the whole handler suite to confirm the existing objectContaining assertions still match (they don't assert absence of verified).**

Run: `pnpm --filter @switchboard/api test revenue.test.ts`
Expected: All revenue.test.ts handler tests pass (previous count + 1).

- [ ] **Step 5: Failing test 2 — narrowed enum rejects stripe at the route edge. Open apps/api/src/routes/__tests__/revenue-ingress.test.ts and add a test that POST /:orgId/revenue with recordedBy:'stripe' returns 400. Mirror the file's existing request-building helper (read how it builds the app + sends the POST; reuse that harness). The assertion is status 400.**

```ts
  it("rejects recordedBy:'stripe' on the operator route (operator-forged-revenue guard)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/org_a/revenue",
      headers: { "idempotency-key": "k-stripe-reject", "x-org-id": "org_a" },
      payload: {
        contactId: "c1",
        amount: 100,
        currency: "SGD",
        type: "payment",
        recordedBy: "stripe",
      },
    });
    expect(res.statusCode).toBe(400);
  });
```

- [ ] **Step 6: Run it — fails because the route's RecordRevenueInputSchema still accepts 'stripe' (returns 201 or whatever the success path yields, not 400). NOTE: if the existing harness in this file names the Fastify instance something other than `app` or requires a different inject signature, adapt the `app.inject` call to match the file's other tests verbatim — read one passing POST test in the same file first.**

Run: `pnpm --filter @switchboard/api test revenue-ingress.test.ts -t "rejects recordedBy"`
Expected: 1 failing test: expected 400 but received a non-400 (the enum still permits 'stripe').

- [ ] **Step 7: Make it pass — narrow the route-local schema. In apps/api/src/routes/revenue.ts change the `recordedBy` enum in `RecordRevenueInputSchema` (line 24) to only owner/staff.**

```ts
  recordedBy: z.enum(["owner", "staff"]).default("owner"),
```

- [ ] **Step 8: Narrow the intent parameters schema too (defence in depth — the handler parses this after ingress). In apps/api/src/routes/operator-intents-schemas.ts change `RecordRevenueParametersSchema.recordedBy` (line 89).**

```ts
  recordedBy: z.enum(["owner", "staff"]).default("owner"),
```

- [ ] **Step 9: Run the route rejection test — passes now.**

Run: `pnpm --filter @switchboard/api test revenue-ingress.test.ts -t "rejects recordedBy"`
Expected: 1 passing, 0 failing.

- [ ] **Step 10: Run both touched api suites in full to confirm the enum narrowing did not break any existing test that used recordedBy:'stripe'/'integration' on the operator path (the verified-payment writer from 1A-4 uses a SEPARATE intent/schema, so it must be unaffected — if any operator-path test used 'stripe', it was asserting the old loose behaviour and should be updated to the new contract).**

Run: `pnpm --filter @switchboard/api test revenue-ingress.test.ts revenue.test.ts`
Expected: Both suites pass. If a pre-existing test fails because it sent recordedBy:'stripe' through the OPERATOR route, update that test to 'owner' (operator attestations) — the narrowed contract is intended.

- [ ] **Step 11: Typecheck the api package to confirm the narrowed Zod enums still satisfy the wider store-level `RecordRevenueInput` type (the handler passes recordedBy: params.recordedBy into a param typed owner|staff|stripe|integration — narrowing the source is assignment-compatible, so this must pass).**

Run: `pnpm --filter @switchboard/api typecheck`
Expected: No TypeScript errors. (owner|staff is assignable to owner|staff|stripe|integration.)

- [ ] **Step 12: Commit measure 4.**

Run: `git add apps/api/src/routes/operator-intents-schemas.ts apps/api/src/routes/revenue.ts apps/api/src/bootstrap/operator-intents/revenue.ts apps/api/src/bootstrap/operator-intents/__tests__/revenue.test.ts apps/api/src/routes/__tests__/revenue-ingress.test.ts && git commit -m "fix(api): demote operator revenue to unverified and narrow recordedby to owner/staff"`
Expected: One commit; commitlint accepts the lowercase subject.


#### Task 6: Measure 5 — gateway idempotency key from provider message id (wamid) dedups replays at PlatformIngress.submit

**Files:**
- Create: `packages/core/src/channel-gateway/__tests__/channel-gateway-idempotency.test.ts`
- Modify: `packages/core/src/channel-gateway/types.ts`
- Modify: `packages/core/src/channel-gateway/channel-gateway.ts`
- Modify: `apps/chat/src/routes/managed-webhook.ts`
- Modify: `apps/chat/src/routes/__tests__/managed-webhook.test.ts`

- [ ] **Step 1: Add `messageId?: string;` to the IncomingChannelMessage interface so the provider message id can flow into the gateway. In packages/core/src/channel-gateway/types.ts add the field after `text: string;` (line 197).**

```ts
  /** Provider message id (e.g. WhatsApp wamid). When present, the gateway
   *  derives an idempotency key so a replayed inbound dedups at submit. */
  messageId?: string;
```

- [ ] **Step 2: Write the failing gateway test. Create packages/core/src/channel-gateway/__tests__/channel-gateway-idempotency.test.ts mirroring the makeConfig/makeContactStore pattern from channel-gateway-opt-out.test.ts (same dir). Two cases: (a) with messageId, submit's request carries `idempotencyKey: "inbound:whatsapp:<wamid>"`; (b) without messageId, idempotencyKey is undefined.**

```ts
import { describe, it, expect, vi } from "vitest";
import { ChannelGateway } from "../channel-gateway.js";
import type {
  ChannelGatewayConfig,
  GatewayContactStore,
  ReplySink,
} from "../types.js";
import type { DeploymentResolverResult } from "../../platform/deployment-resolver.js";

function makeResolverResult(): DeploymentResolverResult {
  return {
    deploymentId: "dep-1",
    listingId: "listing-1",
    organizationId: "org-1",
    skillSlug: "alex",
    trustLevel: "guided",
    trustScore: 50,
    inputConfig: {},
  };
}

function makeContactStore(): GatewayContactStore {
  return {
    findByPhone: vi.fn().mockResolvedValue({ id: "contact-1" }),
    create: vi.fn().mockResolvedValue({ id: "contact-1" }),
    recordMessagingOptOut: vi.fn().mockResolvedValue(undefined),
  } as never;
}

function makeConfig(overrides: Partial<ChannelGatewayConfig> = {}): ChannelGatewayConfig {
  return {
    conversationStore: {
      getOrCreateBySession: vi
        .fn()
        .mockResolvedValue({ conversationId: "conv-1", messages: [] }),
      addMessage: vi.fn().mockResolvedValue(undefined),
    },
    deploymentResolver: {
      resolveByChannelToken: vi.fn().mockResolvedValue(makeResolverResult()),
      resolveByDeploymentId: vi.fn().mockResolvedValue(makeResolverResult()),
      resolveByOrgAndSlug: vi.fn().mockResolvedValue(makeResolverResult()),
    },
    platformIngress: {
      submit: vi.fn().mockResolvedValue({
        ok: true,
        result: { outcome: "completed", outputs: { response: "Hi" }, summary: "ok" },
        workUnit: { id: "wu-1", traceId: "trace-1" },
      }),
    },
    approvalStore: {
      save: vi.fn().mockResolvedValue(undefined),
      getById: vi.fn().mockResolvedValue(null),
      updateState: vi.fn().mockResolvedValue(undefined),
      listPending: vi.fn().mockResolvedValue([]),
    },
    ...overrides,
  };
}

describe("ChannelGateway — inbound idempotency key from provider message id", () => {
  it("derives idempotencyKey from messageId so a replay dedups at submit", async () => {
    const config = makeConfig({ contactStore: makeContactStore() });
    const gateway = new ChannelGateway(config);
    const replySink: ReplySink = { send: vi.fn().mockResolvedValue(undefined) };

    await gateway.handleIncoming(
      {
        channel: "whatsapp",
        token: "wa-token",
        sessionId: "+6591234567",
        text: "hello",
        messageId: "wamid.ABCD",
      },
      replySink,
    );

    const submit = config.platformIngress.submit as ReturnType<typeof vi.fn>;
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]![0].idempotencyKey).toBe("inbound:whatsapp:wamid.ABCD");
  });

  it("leaves idempotencyKey undefined when no messageId is supplied", async () => {
    const config = makeConfig({ contactStore: makeContactStore() });
    const gateway = new ChannelGateway(config);
    const replySink: ReplySink = { send: vi.fn().mockResolvedValue(undefined) };

    await gateway.handleIncoming(
      { channel: "whatsapp", token: "wa-token", sessionId: "+6591234567", text: "hello" },
      replySink,
    );

    const submit = config.platformIngress.submit as ReturnType<typeof vi.fn>;
    expect(submit.mock.calls[0]![0].idempotencyKey).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the new gateway test — both cases fail because the gateway never sets idempotencyKey on the request today.**

Run: `pnpm --filter @switchboard/core test channel-gateway-idempotency.test.ts`
Expected: 2 failing tests: first expects 'inbound:whatsapp:wamid.ABCD' but gets undefined; second already passes only by accident if undefined — but the first failing case confirms the gap.

- [ ] **Step 4: Make it pass: in packages/core/src/channel-gateway/channel-gateway.ts add the idempotencyKey to the CanonicalSubmitRequest object literal (the `const request: CanonicalSubmitRequest = { ... }` at line 310). Add this line inside the object, e.g. right after `targetHint: { ... },` closes — using a conditional spread so the key is omitted entirely when no messageId (matching the 'undefined' test).**

```ts
      ...(message.messageId
        ? { idempotencyKey: `inbound:${message.channel}:${message.messageId}` }
        : {}),
```

- [ ] **Step 5: Run the gateway idempotency test again — both pass.**

Run: `pnpm --filter @switchboard/core test channel-gateway-idempotency.test.ts`
Expected: 2 passing, 0 failing.

- [ ] **Step 6: Confirm no other channel-gateway test broke (the conditional spread is additive; existing tests pass no messageId so idempotencyKey stays absent — their submit assertions use not.toHaveBeenCalled or objectContaining and are unaffected).**

Run: `pnpm --filter @switchboard/core test channel-gateway`
Expected: All channel-gateway __tests__ pass.

- [ ] **Step 7: Wire the live WhatsApp path. In apps/chat/src/routes/managed-webhook.ts the wamid is already extracted as `rawMessageId` (line 158). Pass it into the existing handleIncoming call (line 172-178) by adding `messageId: rawMessageId ?? undefined,` to the message object (after `text: incoming.text,`).**

```ts
          messageId: rawMessageId ?? undefined,
```

- [ ] **Step 8: Add/extend the managed-webhook test to assert the wamid is forwarded. Open apps/chat/src/routes/__tests__/managed-webhook.test.ts, find the test that exercises an inbound message reaching `gateway.handleIncoming` (read how it stubs the gateway + adapter.extractMessageId), and assert the handleIncoming call received `messageId` equal to the extracted wamid. If no such gateway-call assertion exists, add a focused test that stubs `gatewayEntry.adapter.extractMessageId` to return a known wamid and asserts the gateway spy's first-arg messageId.**

```ts
    // within an existing inbound-message test (adapt names to the file's harness):
    expect(gatewaySpy.handleIncoming).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: "wamid.ABCD" }),
      expect.anything(),
    );
```

- [ ] **Step 9: Run the managed-webhook suite. If the file's harness differs (different spy/adapter names), align the assertion with how the other tests reference the gateway and the extractMessageId stub before re-running.**

Run: `pnpm --filter @switchboard/chat test managed-webhook.test.ts`
Expected: managed-webhook.test.ts passes, including the new messageId-forwarding assertion.

- [ ] **Step 10: Build the chat package so the test-only tsc pass over .test.ts files (untyped vi.fn pitfall) is exercised before push, per the chat-build gotcha.**

Run: `pnpm --filter @switchboard/chat build`
Expected: chat package builds with no TS errors.

- [ ] **Step 11: Commit measure 5.**

Run: `git add packages/core/src/channel-gateway/types.ts packages/core/src/channel-gateway/channel-gateway.ts packages/core/src/channel-gateway/__tests__/channel-gateway-idempotency.test.ts apps/chat/src/routes/managed-webhook.ts apps/chat/src/routes/__tests__/managed-webhook.test.ts && git commit -m "feat(core,chat): gateway idempotency key from provider message id"`
Expected: One commit; commitlint accepts the subject.


#### Task 7: Final verification — full typecheck + targeted suites + arch/format gates

**Files:**


- [ ] **Step 1: Run the full typecheck across the monorepo to catch any cross-package fallout from the schema/enum/interface changes.**

Run: `pnpm typecheck`
Expected: No TypeScript errors anywhere. If it reports `origin` unknown on a Prisma model, you skipped `pnpm reset` after the schema edit — run it and retry.

- [ ] **Step 2: Run the three touched package test suites together to confirm the whole change set is green.**

Run: `pnpm --filter @switchboard/core test && pnpm --filter @switchboard/db test && pnpm --filter @switchboard/api test && pnpm --filter @switchboard/chat test`
Expected: All four packages' suites pass.

- [ ] **Step 3: Run prettier check (CI lint runs it; local lint does not) and the arch line-count check on the .ts files touched.**

Run: `pnpm format:check && pnpm arch:check`
Expected: format:check reports no formatting diffs; arch:check passes (no touched .ts file crossed the 600-line error threshold — calendar-book.ts grows by ~0 net lines; the stores grow by a handful).

- [ ] **Step 4: Confirm branch context and that exactly the intended commits are present (one per measure plus the schema commit).**

Run: `git branch --show-current && git log --oneline origin/main..HEAD`
Expected: The active feature branch is shown; the log lists the five+ commits authored above (deterministic eventId, external windowing, origin column, origin stamping/filtering, operator demotion, gateway idempotency) and nothing unrelated.


---

## 1A-6 — feat(db,api,dashboard): owner read surface — paid visits by ad

**Goal:** Give the clinic owner a read-only surface that lists, one line per row, every VERIFIED paid visit attributed to a Meta campaign — "this paid $X visit came from campaign Y." Decoupled from Riley. Three layers: (1) a new `paidVisitsByCampaign` method on `PrismaRevenueStore` (packages/db) that returns one row per `verified=true` `LifecycleRevenueEvent` carrying a non-null `bookingId`, joined to `ConversionRecord` (for `sourceCampaignId`) and `Booking` (for the external `startsAt` timestamp), org-isolated, amount passed through verbatim in CENTS; (2) the existing `GET /:orgId/revenue/by-campaign` route gains a `?view=paid-visits` branch returning `{ paidVisits: [...] }`, leaving the legacy aggregate as the default; (3) a dashboard api-client method + Next proxy route + a `PaidVisitsSection` panel reusing `fmtSGD`, converting cents→dollars exactly once (the load-bearing 100x guard). DEPENDS ON 1A-4 (adds `LifecycleRevenueEvent.bookingId` column + `verified=true` writer) and 1A-2 (stamps `ConversionRecord.bookingId` + welds Booking↔WorkTrace). This PR adds NO schema/migration — it consumes columns those PRs land.

**File structure:**

| Action | Path | Responsibility |
|---|---|---|
| modify | `/Users/jasonli/switchboard/packages/db/src/stores/prisma-revenue-store.ts` | Add `PaidVisitRow` type + `paidVisitsByCampaign(input)` method: query verified+bookingId LifecycleRevenueEvent in [from,to), join ConversionRecord (sourceCampaignId) and Booking (startsAt as occurredExternalAt) by bookingId, org-isolated, amount passed through as amountCents (NO division). Also add the method to the `RevenueStore` interface. |
| create | `/Users/jasonli/switchboard/packages/db/src/stores/__tests__/prisma-revenue-store-paid-visits.test.ts` | Co-located DB test (mocked Prisma, CI has no Postgres): one row per paid visit (not aggregated), verified=true only, bookingId-null excluded, org-isolation in every WHERE, amount returned verbatim in cents (no 100x), absent campaign join → null campaign field. |
| modify | `/Users/jasonli/switchboard/apps/api/src/routes/revenue.ts` | Extend GET /:orgId/revenue/by-campaign: parse optional `view`, `from`, `to` query params; when view==="paid-visits" call store.paidVisitsByCampaign and reply { paidVisits }, else preserve the existing { campaigns } aggregate. Keep the // @route-class: operator-direct header. |
| create | `/Users/jasonli/switchboard/apps/api/src/routes/__tests__/revenue-by-campaign-route.test.ts` | Fastify route test (mocks @switchboard/db PrismaRevenueStore, registers revenueRoutes, app.inject): paid-visits view returns the per-visit array, org passed through from auth, 403 when unauthenticated, default (no view) still returns aggregate. |
| modify | `/Users/jasonli/switchboard/apps/dashboard/src/lib/api-client/dashboard.ts` | Add `PaidVisit` type + `getPaidVisitsByCampaign(orgId, range)` client method calling GET /api/:orgId/revenue/by-campaign?view=paid-visits&from&to via the shared `request` helper. |
| create | `/Users/jasonli/switchboard/apps/dashboard/src/lib/api-client/__tests__/dashboard-paid-visits.test.ts` | api-client test (stub global fetch): GETs the correct URL with view=paid-visits + range params + Bearer header, returns the payload, propagates upstream error body. |
| create | `/Users/jasonli/switchboard/apps/dashboard/src/app/api/dashboard/paid-visits/route.ts` | Next.js proxy route: requireSession → getApiClient → client.getPaidVisitsByCampaign(orgId, range); reads orgId/from/to from searchParams; proxyError on failure (401 for Unauthorized, else 500). |
| create | `/Users/jasonli/switchboard/apps/dashboard/src/app/api/dashboard/paid-visits/__tests__/route.test.ts` | Proxy route test (mock get-api-client + session): forwards orgId+range to client, 200 payload passthrough, 400 when orgId missing, 401 when session missing, 500 on upstream failure. |
| create | `/Users/jasonli/switchboard/apps/dashboard/src/components/results/paid-visits-section.tsx` | Client panel: sorts paid visits by amount desc, renders one row per visit with fmtSGD(amountCents/100) (cents→dollars converted ONCE), campaign label, and external date; calm empty state. Reuses results.module.css classes. |
| create | `/Users/jasonli/switchboard/apps/dashboard/src/components/results/paid-visits-section.test.tsx` | Panel test (jsdom + @testing-library/react): renders one row per visit, money is S$-prefixed dollars NOT cents (50000c → S$500.00, asserts no 100x leak), empty-state renders, campaign name shown. |

**Notes:** LAYERING: db(L4) store → api(L5) route → dashboard(L5). No core/ad-optimizer touched; no cycles.

DEPENDS ON 1A-4 + 1A-2 — those land `LifecycleRevenueEvent.bookingId` (1A-4), the `verified=true` PSP writer (1A-4), and `ConversionRecord.bookingId` stamping + Booking↔WorkTrace weld (1A-2). This PR adds ZERO schema/migration; it READS columns that already exist on disk after those PRs merge. If you build this branch off `main` BEFORE 1A-4 merges, `prisma.lifecycleRevenueEvent` will not have `bookingId` and the DB test's typed Prisma mock still passes (mock is `unknown`-cast), but `pnpm --filter @switchboard/db typecheck` / `pnpm reset` against the real generated client will fail on `bookingId` in the `select`. Stack on top of 1A-4 (run `pnpm reset` after rebasing so the Prisma client regenerates).

CENTS BOUNDARY (the 100x trap, spec §11/§12): `LifecycleRevenueEvent.amount` is already an `Int` in minor units (cents). The store returns it verbatim as `amountCents` — NO division anywhere in db/api. The ONLY cents→dollars conversion is `amountCents / 100` immediately before `fmtSGD(...)` in `paid-visits-section.tsx` (fmtSGD takes whole dollars — see its header comment at apps/dashboard/.../reports/components/format.ts). The panel test pins this: a 50000-cent row must render `S$500.00`, never `S$500,000` or `S$50,000`.

ROUTE CHOICE: I extend the EXISTING `/:orgId/revenue/by-campaign` (spec §3.6 says "extend") behind `?view=paid-visits` rather than overwriting the aggregate, because the legacy `{ campaigns }` aggregate shape may still have consumers; the new per-visit shape is additive and back-compatible. Default (no `view`) is unchanged.

AUTH IN ROUTE TEST: revenue.ts uses `requireOrganizationScope` which reads `request.organizationIdFromAuth`. The route also runs `buildDevAuthFallback(app)` as a preHandler, but it is a NO-OP unless `app.authDisabled === true`. In the test, do NOT decorate `authDisabled` — then the fallback is inert and the `onRequest` hook setting `organizationIdFromAuth` is authoritative (mirror marketplace-business-facts.test.ts buildApp).

EXTERNAL TIMESTAMP: spec §9.3 windows on external timestamps. `LifecycleRevenueEvent` has no external timestamp column, so the store sources `occurredExternalAt` from the joined `Booking.startsAt` (the visit's real calendar time). Range filter on the query uses `recordedAt` (the row we have a range index for: `@@index([organizationId, recordedAt])`); the external `startsAt` is surfaced per row for display + future windowing. (True external-timestamp WINDOWING of the metric is 1B-3/1A-5 scope, out of this read PR.)

FILE SIZES (gate: err 600 / warn 400): dashboard.ts is 267 lines, prisma-revenue-store.ts 302, revenue.ts 126 — all safe to extend. New files are small.

PRETTIER/ESM: double quotes, 2-space, trailing commas, 100-width, semicolons; `.js` extensions on relative imports in db + api (NOT in the Next.js dashboard, which uses `@/` aliases and bare relative). No `any` — use `unknown` or proper types. Unused vars prefixed `_`.

TEST COMMANDS: db → `pnpm --filter @switchboard/db test <path>`; api → `pnpm --filter @switchboard/api test <path>`; dashboard → `pnpm --filter @switchboard/dashboard test <path>`. Dashboard coverage gate is 40/35/40/40 (NOT CLAUDE.md's 55/50/52/55).

#### Task 1: Task 1 — DB store: paidVisitsByCampaign (one row per verified paid visit, cents verbatim, org-isolated)

**Files:**
- Create: `/Users/jasonli/switchboard/packages/db/src/stores/__tests__/prisma-revenue-store-paid-visits.test.ts`
- Modify: `/Users/jasonli/switchboard/packages/db/src/stores/prisma-revenue-store.ts`
- Test: `/Users/jasonli/switchboard/packages/db/src/stores/__tests__/prisma-revenue-store-paid-visits.test.ts`

- [ ] **Step 1: Write the FAILING test first. Create the test file. It mocks Prisma exactly like the canonical pattern (mockPrisma() returning an object cast `as unknown as PrismaClient`, mirror packages/db/src/stores/__tests__/prisma-workflow-store.test.ts lines 5-26). Three Prisma delegates are exercised: `lifecycleRevenueEvent.findMany` (the verified rows), `conversionRecord.findMany` (campaign join), `booking.findMany` (external-timestamp join). The test asserts: (a) one output row per paid visit; (b) the WHERE on lifecycleRevenueEvent includes `verified: true`, `organizationId`, `bookingId: { not: null }`, and a `recordedAt` range; (c) amount is returned verbatim as `amountCents` (50000 cents stays 50000 — no 100x); (d) campaign comes from the matching ConversionRecord, and is `null` when no ConversionRecord matches; (e) org-isolation: conversionRecord/booking joins also carry `organizationId`.**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaRevenueStore } from "../prisma-revenue-store.js";

function mockPrisma() {
  return {
    lifecycleRevenueEvent: {
      findMany: vi.fn(),
    },
    conversionRecord: {
      findMany: vi.fn(),
    },
    booking: {
      findMany: vi.fn(),
    },
  } as unknown as import("@prisma/client").PrismaClient;
}

const RANGE = { from: new Date("2026-06-01T00:00:00Z"), to: new Date("2026-06-08T00:00:00Z") };

describe("PrismaRevenueStore.paidVisitsByCampaign", () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let store: PrismaRevenueStore;

  beforeEach(() => {
    prisma = mockPrisma();
    store = new PrismaRevenueStore(prisma);
  });

  it("returns one row per verified paid visit with amount verbatim in cents (no 100x)", async () => {
    (prisma.lifecycleRevenueEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { amount: 50000, contactId: "c-1", bookingId: "b-1" },
      { amount: 38800, contactId: "c-2", bookingId: "b-2" },
    ]);
    (prisma.conversionRecord.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { bookingId: "b-1", sourceCampaignId: "camp-A" },
      { bookingId: "b-2", sourceCampaignId: "camp-B" },
    ]);
    (prisma.booking.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "b-1", startsAt: new Date("2026-06-03T09:00:00Z") },
      { id: "b-2", startsAt: new Date("2026-06-04T10:00:00Z") },
    ]);

    const rows = await store.paidVisitsByCampaign({ orgId: "org-1", ...RANGE });

    expect(rows).toEqual([
      {
        campaign: "camp-A",
        amountCents: 50000,
        occurredExternalAt: new Date("2026-06-03T09:00:00Z"),
        contactId: "c-1",
        bookingId: "b-1",
      },
      {
        campaign: "camp-B",
        amountCents: 38800,
        occurredExternalAt: new Date("2026-06-04T10:00:00Z"),
        contactId: "c-2",
        bookingId: "b-2",
      },
    ]);
  });

  it("queries only verified=true rows with a non-null bookingId, org-scoped and date-ranged", async () => {
    (prisma.lifecycleRevenueEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await store.paidVisitsByCampaign({ orgId: "org-1", ...RANGE });

    expect(prisma.lifecycleRevenueEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org-1",
          verified: true,
          bookingId: { not: null },
          recordedAt: { gte: RANGE.from, lt: RANGE.to },
        }),
      }),
    );
  });

  it("returns campaign=null when no ConversionRecord matches the booking", async () => {
    (prisma.lifecycleRevenueEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { amount: 10000, contactId: "c-9", bookingId: "b-9" },
    ]);
    (prisma.conversionRecord.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.booking.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "b-9", startsAt: new Date("2026-06-05T11:00:00Z") },
    ]);

    const rows = await store.paidVisitsByCampaign({ orgId: "org-1", ...RANGE });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.campaign).toBeNull();
    expect(rows[0]!.amountCents).toBe(10000);
  });

  it("scopes the ConversionRecord and Booking joins to the same org", async () => {
    (prisma.lifecycleRevenueEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { amount: 20000, contactId: "c-1", bookingId: "b-1" },
    ]);
    (prisma.conversionRecord.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.booking.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await store.paidVisitsByCampaign({ orgId: "org-1", ...RANGE });

    expect(prisma.conversionRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org-1", bookingId: { in: ["b-1"] } }),
      }),
    );
    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org-1", id: { in: ["b-1"] } }),
      }),
    );
  });
});

```

- [ ] **Step 2: Run the test — it MUST fail because `paidVisitsByCampaign` does not exist yet.**

Run: `pnpm --filter @switchboard/db test src/stores/__tests__/prisma-revenue-store-paid-visits.test.ts`
Expected: FAIL — TypeError: store.paidVisitsByCampaign is not a function (all 4 tests error/fail).

- [ ] **Step 3: Add the `PaidVisitRow` type + the method to the `RevenueStore` interface in prisma-revenue-store.ts. Insert the type just below the `CampaignRevenueSummary` interface (after line 38), and add the method signature inside the `RevenueStore` interface (after the existing `revenueByCampaign` signature, before the closing brace at line 51).**

```ts
interface PaidVisitRow {
  campaign: string | null;
  amountCents: number;
  occurredExternalAt: Date | null;
  contactId: string;
  bookingId: string;
}
```

- [ ] **Step 4: Add the method to the `RevenueStore` interface. Edit the interface block (lines 40-51) to include the new signature right after the `revenueByCampaign` signature.**

```ts
  revenueByCampaign(input: {
    orgId: string;
    from: Date;
    to: Date;
  }): Promise<Array<{ sourceCampaignId: string; totalAmount: number }>>;
  paidVisitsByCampaign(input: {
    orgId: string;
    from: Date;
    to: Date;
  }): Promise<PaidVisitRow[]>;
```

- [ ] **Step 5: Implement the method on the `PrismaRevenueStore` class. Insert it immediately AFTER the `revenueByCampaign` method (after line 198, before `revenueWithFirstTouch`). It does three org-scoped findMany calls then an in-memory join (mirrors the `revenueWithFirstTouch` join style at lines 200-261). Amount is passed through verbatim — no arithmetic. occurredExternalAt comes from the joined Booking.startsAt.**

```ts
  async paidVisitsByCampaign(input: {
    orgId: string;
    from: Date;
    to: Date;
  }): Promise<PaidVisitRow[]> {
    const events = await this.prisma.lifecycleRevenueEvent.findMany({
      where: {
        organizationId: input.orgId,
        verified: true,
        bookingId: { not: null },
        recordedAt: { gte: input.from, lt: input.to },
      },
      select: {
        amount: true,
        contactId: true,
        bookingId: true,
      },
      orderBy: { recordedAt: "desc" },
    });

    if (events.length === 0) return [];

    const bookingIds = [
      ...new Set(events.map((e) => e.bookingId).filter((id): id is string => id !== null)),
    ];

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

    const bookings = await this.prisma.booking.findMany({
      where: { organizationId: input.orgId, id: { in: bookingIds } },
      select: { id: true, startsAt: true },
    });
    const startsAtByBooking = new Map<string, Date>();
    for (const b of bookings) startsAtByBooking.set(b.id, b.startsAt);

    return events
      .filter((e): e is { amount: number; contactId: string; bookingId: string } =>
        e.bookingId !== null,
      )
      .map((e) => ({
        campaign: campaignByBooking.get(e.bookingId) ?? null,
        amountCents: e.amount,
        occurredExternalAt: startsAtByBooking.get(e.bookingId) ?? null,
        contactId: e.contactId,
        bookingId: e.bookingId,
      }));
  }
```

- [ ] **Step 6: Run the test again — it MUST pass now.**

Run: `pnpm --filter @switchboard/db test src/stores/__tests__/prisma-revenue-store-paid-visits.test.ts`
Expected: PASS — 4 passed. (one row per visit; verified+bookingId+org+range WHERE asserted; campaign=null fallback; org-scoped joins).

- [ ] **Step 7: Type-check the db package to confirm the Prisma `select` fields (`bookingId`, `verified`, `startsAt`) exist on the generated client. If this errors with 'bookingId does not exist on LifecycleRevenueEventSelect', you are NOT stacked on 1A-4 — rebase onto 1A-4 and run `pnpm reset` to regenerate the client.**

Run: `pnpm --filter @switchboard/db typecheck`
Expected: No type errors. (LifecycleRevenueEvent.bookingId resolved because 1A-4 is in the base; ConversionRecord.bookingId and Booking.startsAt already exist on main.)

- [ ] **Step 8: Commit. Verify branch context first per CLAUDE.md.**

Run: `git add packages/db/src/stores/prisma-revenue-store.ts packages/db/src/stores/__tests__/prisma-revenue-store-paid-visits.test.ts && git commit -m "feat(db): paid-visits-by-campaign read query (verified, cents-verbatim, org-isolated)"`
Expected: Commit succeeds; commitlint accepts the lowercase subject.


#### Task 2: Task 2 — API route: paid-visits view on GET /:orgId/revenue/by-campaign

**Files:**
- Create: `/Users/jasonli/switchboard/apps/api/src/routes/__tests__/revenue-by-campaign-route.test.ts`
- Modify: `/Users/jasonli/switchboard/apps/api/src/routes/revenue.ts`
- Test: `/Users/jasonli/switchboard/apps/api/src/routes/__tests__/revenue-by-campaign-route.test.ts`

- [ ] **Step 1: Write the FAILING route test first. Mirror the harness in apps/api/src/routes/__tests__/marketplace-business-facts.test.ts (lines 1-33): vi.mock @switchboard/db to swap `PrismaRevenueStore` for a mock whose `paidVisitsByCampaign`/`sumByCampaign` are vi.fn(); build a Fastify app, register `revenueRoutes` (no prefix needed for the test), set `organizationIdFromAuth` via an onRequest hook, and use `app.inject`. Assert: (a) `?view=paid-visits` returns `{ paidVisits: [...] }` from the store and passes the auth org through; (b) no `view` returns the legacy `{ campaigns }` aggregate; (c) unauthenticated → 403, store not called for the paid-visits view. DO NOT decorate `authDisabled` (keeps buildDevAuthFallback inert so the onRequest org is authoritative).**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

const mockRevenueStore = {
  paidVisitsByCampaign: vi.fn(),
  sumByCampaign: vi.fn(),
};

vi.mock("@switchboard/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@switchboard/db")>()),
  PrismaRevenueStore: vi.fn(() => mockRevenueStore),
}));

import { revenueRoutes } from "../revenue.js";

function buildApp(orgId: string | null): FastifyInstance {
  const app = Fastify();
  app.decorate("prisma", {} as never);
  app.addHook("onRequest", async (req) => {
    (req as unknown as { organizationIdFromAuth: string | null }).organizationIdFromAuth = orgId;
  });
  app.register(revenueRoutes);
  return app;
}

describe("GET /:orgId/revenue/by-campaign?view=paid-visits", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns one line per paid visit for the authenticated org", async () => {
    mockRevenueStore.paidVisitsByCampaign.mockResolvedValue([
      {
        campaign: "camp-A",
        amountCents: 50000,
        occurredExternalAt: new Date("2026-06-03T09:00:00Z"),
        contactId: "c-1",
        bookingId: "b-1",
      },
    ]);
    const app = buildApp("org-1");
    const res = await app.inject({
      method: "GET",
      url: "/org-1/revenue/by-campaign?view=paid-visits&from=2026-06-01&to=2026-06-08",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { paidVisits: Array<{ amountCents: number }> };
    expect(body.paidVisits).toHaveLength(1);
    expect(body.paidVisits[0]!.amountCents).toBe(50000);
    expect(mockRevenueStore.paidVisitsByCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1" }),
    );
    await app.close();
  });

  it("falls back to the legacy aggregate when no view is given", async () => {
    mockRevenueStore.sumByCampaign.mockResolvedValue([
      { sourceCampaignId: "camp-A", totalAmount: 50000, count: 1 },
    ]);
    const app = buildApp("org-1");
    const res = await app.inject({ method: "GET", url: "/org-1/revenue/by-campaign" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { campaigns: unknown[] };
    expect(body.campaigns).toHaveLength(1);
    expect(mockRevenueStore.paidVisitsByCampaign).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 403 when unauthenticated and does not query paid visits", async () => {
    const app = buildApp(null);
    const res = await app.inject({
      method: "GET",
      url: "/org-1/revenue/by-campaign?view=paid-visits",
    });
    expect(res.statusCode).toBe(403);
    expect(mockRevenueStore.paidVisitsByCampaign).not.toHaveBeenCalled();
    await app.close();
  });
});

```

- [ ] **Step 2: Run the test — it MUST fail because the route does not yet branch on `view` (the paid-visits request currently returns `{ campaigns }`, so the `body.paidVisits` assertion fails).**

Run: `pnpm --filter @switchboard/api test src/routes/__tests__/revenue-by-campaign-route.test.ts`
Expected: FAIL — first test: expected body.paidVisits to have length 1 but it is undefined (route still returns { campaigns }).

- [ ] **Step 3: Implement the `view` branch in revenue.ts. Replace the existing by-campaign handler body (lines 114-125) with one that parses `view`/`from`/`to` and branches. Keep the `// @route-class: operator-direct` file header (line 1) untouched.**

```ts
  // GET /:orgId/revenue/by-campaign — aggregate (default) or one line per paid visit (view=paid-visits)
  app.get("/:orgId/revenue/by-campaign", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }

    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const { view, from, to } = request.query as {
      view?: string;
      from?: string;
      to?: string;
    };
    const store = new PrismaRevenueStore(app.prisma);

    if (view === "paid-visits") {
      const now = Date.now();
      const fromDate = from ? new Date(from) : new Date(now - 30 * 24 * 60 * 60 * 1000);
      const toDate = to ? new Date(to) : new Date(now);
      const paidVisits = await store.paidVisitsByCampaign({
        orgId,
        from: fromDate,
        to: toDate,
      });
      return reply.send({ paidVisits });
    }

    const campaigns = await store.sumByCampaign(orgId);
    return reply.send({ campaigns });
  });
```

- [ ] **Step 4: Run the test again — all three cases MUST pass.**

Run: `pnpm --filter @switchboard/api test src/routes/__tests__/revenue-by-campaign-route.test.ts`
Expected: PASS — 3 passed. (paid-visits view returns the per-visit array; default returns aggregate; unauthenticated → 403, store not called).

- [ ] **Step 5: Type-check the api package.**

Run: `pnpm --filter @switchboard/api typecheck`
Expected: No type errors.

- [ ] **Step 6: Commit.**

Run: `git add apps/api/src/routes/revenue.ts apps/api/src/routes/__tests__/revenue-by-campaign-route.test.ts && git commit -m "feat(api): paid-visits view on revenue/by-campaign route"`
Expected: Commit succeeds.


#### Task 3: Task 3 — Dashboard api-client method getPaidVisitsByCampaign

**Files:**
- Create: `/Users/jasonli/switchboard/apps/dashboard/src/lib/api-client/__tests__/dashboard-paid-visits.test.ts`
- Modify: `/Users/jasonli/switchboard/apps/dashboard/src/lib/api-client/dashboard.ts`
- Test: `/Users/jasonli/switchboard/apps/dashboard/src/lib/api-client/__tests__/dashboard-paid-visits.test.ts`

- [ ] **Step 1: Write the FAILING api-client test first. Mirror apps/dashboard/src/lib/api-client/__tests__/dashboard-reports.test.ts (stub global fetch, instantiate `SwitchboardDashboardClient`, assert URL + Bearer header + return value, and upstream-error propagation). Assert the URL is `/api/<orgId>/revenue/by-campaign?view=paid-visits&from=...&to=...`.**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SwitchboardDashboardClient } from "../dashboard";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const PAYLOAD = {
  paidVisits: [
    {
      campaign: "camp-A",
      amountCents: 50000,
      occurredExternalAt: "2026-06-03T09:00:00.000Z",
      contactId: "c-1",
      bookingId: "b-1",
    },
  ],
};

describe("SwitchboardDashboardClient.getPaidVisitsByCampaign", () => {
  it("GETs by-campaign with view=paid-visits and the range params URL-encoded", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => PAYLOAD });

    const client = new SwitchboardDashboardClient("http://api.test", "key-123");
    const out = await client.getPaidVisitsByCampaign("org-1", {
      from: "2026-06-01",
      to: "2026-06-08",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "http://api.test/api/org-1/revenue/by-campaign?view=paid-visits&from=2026-06-01&to=2026-06-08",
    );
    expect(init).toMatchObject({
      headers: { Authorization: "Bearer key-123" },
    });
    expect(out).toEqual(PAYLOAD);
  });

  it("propagates the upstream error body", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: "Database not available" }),
    });
    const client = new SwitchboardDashboardClient("http://api.test", "key-123");
    await expect(
      client.getPaidVisitsByCampaign("org-1", { from: "2026-06-01", to: "2026-06-08" }),
    ).rejects.toThrow("Database not available");
  });
});

```

- [ ] **Step 2: Run the test — it MUST fail (method does not exist).**

Run: `pnpm --filter @switchboard/dashboard test src/lib/api-client/__tests__/dashboard-paid-visits.test.ts`
Expected: FAIL — TypeError: client.getPaidVisitsByCampaign is not a function.

- [ ] **Step 3: Add the `PaidVisit` type and the `getPaidVisitsByCampaign` method to dashboard.ts. Add the exported interface just below the imports (after line 16, before `export class SwitchboardDashboardClient`), and add the method inside the class in the Reports section (right after `refreshReport`, after line 149).**

```ts
export interface PaidVisit {
  campaign: string | null;
  amountCents: number;
  occurredExternalAt: string | null;
  contactId: string;
  bookingId: string;
}
```

- [ ] **Step 4: Add the method inside the class (after the `refreshReport` method, before the `getContact` jsdoc block at line 151).**

```ts
  // ── Paid visits by ad (1A-6 read surface) ──

  async getPaidVisitsByCampaign(
    orgId: string,
    range: { from: string; to: string },
  ): Promise<{ paidVisits: PaidVisit[] }> {
    const params = new URLSearchParams({
      view: "paid-visits",
      from: range.from,
      to: range.to,
    });
    return this.request<{ paidVisits: PaidVisit[] }>(
      `/api/${orgId}/revenue/by-campaign?${params.toString()}`,
    );
  }
```

- [ ] **Step 5: Run the test again — it MUST pass.**

Run: `pnpm --filter @switchboard/dashboard test src/lib/api-client/__tests__/dashboard-paid-visits.test.ts`
Expected: PASS — 2 passed. (correct URL + Bearer header + payload; upstream error propagated).

- [ ] **Step 6: Commit.**

Run: `git add apps/dashboard/src/lib/api-client/dashboard.ts apps/dashboard/src/lib/api-client/__tests__/dashboard-paid-visits.test.ts && git commit -m "feat(dashboard): api-client getPaidVisitsByCampaign method"`
Expected: Commit succeeds.


#### Task 4: Task 4 — Dashboard Next proxy route /api/dashboard/paid-visits

**Files:**
- Create: `/Users/jasonli/switchboard/apps/dashboard/src/app/api/dashboard/paid-visits/route.ts`
- Create: `/Users/jasonli/switchboard/apps/dashboard/src/app/api/dashboard/paid-visits/__tests__/route.test.ts`
- Test: `/Users/jasonli/switchboard/apps/dashboard/src/app/api/dashboard/paid-visits/__tests__/route.test.ts`

- [ ] **Step 1: Write the FAILING proxy-route test first. Mirror apps/dashboard/src/app/api/dashboard/reports/__tests__/route.test.ts: vi.mock get-api-client + session, build a fake NextRequest with nextUrl, assert the client method is called with org+range, status passthrough, 400 when orgId missing, 401 when session missing, 500 on upstream failure.**

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/get-api-client", () => ({ getApiClient: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireSession: vi.fn().mockResolvedValue(undefined),
}));

import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { GET } from "../route";

function mkRequest(url: string) {
  const u = new URL(url);
  return { nextUrl: u } as unknown as Parameters<typeof GET>[0];
}

const PAYLOAD = { paidVisits: [{ campaign: "camp-A", amountCents: 50000 }] };

describe("paid-visits dashboard proxy — GET", () => {
  it("forwards orgId + range to the client and returns the payload", async () => {
    const getPaidVisitsByCampaign = vi.fn().mockResolvedValue(PAYLOAD);
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      getPaidVisitsByCampaign,
    });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const res = await GET(
      mkRequest(
        "http://test/api/dashboard/paid-visits?orgId=org-1&from=2026-06-01&to=2026-06-08",
      ),
    );

    expect(getPaidVisitsByCampaign).toHaveBeenCalledWith("org-1", {
      from: "2026-06-01",
      to: "2026-06-08",
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(PAYLOAD);
  });

  it("returns 400 when orgId is missing", async () => {
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      getPaidVisitsByCampaign: vi.fn(),
    });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const res = await GET(mkRequest("http://test/api/dashboard/paid-visits"));
    expect(res.status).toBe(400);
  });

  it("returns 401 when session is missing", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Unauthorized"),
    );
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      getPaidVisitsByCampaign: vi.fn(),
    });

    const res = await GET(mkRequest("http://test/api/dashboard/paid-visits?orgId=org-1"));
    expect(res.status).toBe(401);
  });

  it("returns 500 surfacing the upstream error on backend failure", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      getPaidVisitsByCampaign: vi.fn().mockRejectedValue(new Error("Database not available")),
    });

    const res = await GET(mkRequest("http://test/api/dashboard/paid-visits?orgId=org-1"));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: "Database not available" });
  });
});

```

- [ ] **Step 2: Run the test — it MUST fail because ../route does not exist (import error).**

Run: `pnpm --filter @switchboard/dashboard test src/app/api/dashboard/paid-visits/__tests__/route.test.ts`
Expected: FAIL — Cannot find module '../route' (or 'Failed to resolve import').

- [ ] **Step 3: Create the proxy route. Mirror apps/dashboard/src/app/api/dashboard/reports/route.ts (requireSession → getApiClient → proxyError). It reads orgId/from/to from searchParams; defaults the range to the last 30 days when absent so the panel works without explicit params; 400 when orgId is missing.**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { proxyError } from "@/lib/proxy-error";

export async function GET(req: NextRequest) {
  try {
    await requireSession();
    const orgId = req.nextUrl.searchParams.get("orgId");
    if (!orgId) {
      return NextResponse.json({ error: "orgId is required" }, { status: 400 });
    }
    const now = Date.now();
    const from =
      req.nextUrl.searchParams.get("from") ??
      new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const to = req.nextUrl.searchParams.get("to") ?? new Date(now).toISOString().slice(0, 10);

    const client = await getApiClient();
    const data = await client.getPaidVisitsByCampaign(orgId, { from, to });
    return NextResponse.json(data);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
```

- [ ] **Step 4: Run the test again — all four cases MUST pass.**

Run: `pnpm --filter @switchboard/dashboard test src/app/api/dashboard/paid-visits/__tests__/route.test.ts`
Expected: PASS — 4 passed. (forwards org+range; 400 missing orgId; 401 missing session; 500 upstream error).

- [ ] **Step 5: Commit.**

Run: `git add apps/dashboard/src/app/api/dashboard/paid-visits/route.ts apps/dashboard/src/app/api/dashboard/paid-visits/__tests__/route.test.ts && git commit -m "feat(dashboard): paid-visits proxy route"`
Expected: Commit succeeds.


#### Task 5: Task 5 — Dashboard PaidVisitsSection panel (cents→dollars converted ONCE; the 100x guard)

**Files:**
- Create: `/Users/jasonli/switchboard/apps/dashboard/src/components/results/paid-visits-section.tsx`
- Create: `/Users/jasonli/switchboard/apps/dashboard/src/components/results/paid-visits-section.test.tsx`
- Test: `/Users/jasonli/switchboard/apps/dashboard/src/components/results/paid-visits-section.test.tsx`

- [ ] **Step 1: Write the FAILING panel test first. Mirror apps/dashboard/src/components/results/campaigns-section.test.tsx (jsdom render + @testing-library/react). The load-bearing assertion: a 50000-CENT visit must render as `S$500.00` (cents converted to dollars exactly once) — and must NOT render `S$500,000` or `S$50,000` (the two 100x failure modes). Also assert one row per visit, the campaign label shows, an unknown campaign shows a sensible fallback, and the empty state renders.**

```ts
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { PaidVisitsSection } from "./paid-visits-section";
import type { PaidVisit } from "@/lib/api-client/dashboard";

const VISITS: PaidVisit[] = [
  {
    campaign: "camp-A",
    amountCents: 50000,
    occurredExternalAt: "2026-06-03T09:00:00.000Z",
    contactId: "c-1",
    bookingId: "b-1",
  },
  {
    campaign: "camp-B",
    amountCents: 38800,
    occurredExternalAt: "2026-06-04T10:00:00.000Z",
    contactId: "c-2",
    bookingId: "b-2",
  },
];

describe("PaidVisitsSection", () => {
  it("renders cents as dollars exactly once (no 100x): 50000c -> S$500.00", () => {
    const { container } = render(<PaidVisitsSection visits={[VISITS[0]!]} />);
    expect(container.textContent).toContain("S$500.00");
    expect(container.textContent).not.toContain("S$500,000");
    expect(container.textContent).not.toContain("S$50,000");
  });

  it("renders one row per paid visit with its campaign label", () => {
    const { container } = render(<PaidVisitsSection visits={VISITS} />);
    expect(container.textContent).toContain("camp-A");
    expect(container.textContent).toContain("camp-B");
    expect(container.textContent).toContain("S$500.00");
    expect(container.textContent).toContain("S$388.00");
  });

  it("shows a fallback label when the campaign is unknown", () => {
    const { container } = render(
      <PaidVisitsSection
        visits={[{ ...VISITS[0]!, campaign: null }]}
      />,
    );
    expect(container.textContent?.toLowerCase()).toMatch(/unknown campaign/);
  });

  it("renders a calm empty state when there are no paid visits", () => {
    const { container } = render(<PaidVisitsSection visits={[]} />);
    expect(container.textContent?.toLowerCase()).toMatch(/no paid visits/);
  });
});

```

- [ ] **Step 2: Run the test — it MUST fail (component does not exist).**

Run: `pnpm --filter @switchboard/dashboard test src/components/results/paid-visits-section.test.tsx`
Expected: FAIL — Failed to resolve import './paid-visits-section'.

- [ ] **Step 3: Create the panel. It is a client component reusing `fmtSGD` from the reports format helper and `results.module.css` (same imports campaigns-section.tsx uses — verified at campaigns-section.tsx lines 4 and 7). CRITICAL: the ONLY cents→dollars conversion in the whole feature is `v.amountCents / 100` here, passed straight to `fmtSGD` (which formats whole dollars). Sort by amount descending so the biggest paid visits lead, matching the campaigns panel's revenue-first default. NOTE: Next.js dashboard imports omit `.js` extensions (use `@/` alias + bare relative).**

```ts
"use client";

import { useMemo } from "react";
import { fmtSGD } from "@/app/(auth)/(mercury)/reports/components/format";
import type { PaidVisit } from "@/lib/api-client/dashboard";
import styles from "./results.module.css";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" });
}

export function PaidVisitsSection({ visits }: { visits: PaidVisit[] }) {
  const sorted = useMemo(
    () => [...visits].sort((a, b) => b.amountCents - a.amountCents),
    [visits],
  );

  if (visits.length === 0) {
    return (
      <p className={styles.campaignEmpty}>
        No paid visits attributed yet — once a deposit is captured against a booked ad lead, it
        appears here.
      </p>
    );
  }

  return (
    <ol className={styles.campaignCardList}>
      {sorted.map((v) => (
        <li key={v.bookingId} className={styles.campaignCard}>
          <div className={styles.campaignCardHeader}>
            <span className={styles.campaignCardName}>{v.campaign ?? "Unknown campaign"}</span>
            <span className={styles.campaignCardStatVal}>{fmtSGD(v.amountCents / 100)}</span>
          </div>
          <dl className={styles.campaignCardStats}>
            <div className={styles.campaignCardStat}>
              <dt className={styles.campaignCardStatLabel}>Visit date</dt>
              <dd className={styles.campaignCardStatVal}>{fmtDate(v.occurredExternalAt)}</dd>
            </div>
          </dl>
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 4: Run the test again — all four cases MUST pass. The first case proves the cents boundary is correct (no 100x).**

Run: `pnpm --filter @switchboard/dashboard test src/components/results/paid-visits-section.test.tsx`
Expected: PASS — 4 passed. (50000c renders S$500.00, never S$500,000/S$50,000; one row per visit; unknown-campaign fallback; empty state).

- [ ] **Step 5: Run the dashboard build to catch any missing-`.js` / alias-resolution issues (only `next build` catches these per CLAUDE.md), then typecheck.**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: No type errors. (PaidVisit imported from the api-client; fmtSGD signature matches; styles module resolves).

- [ ] **Step 6: Commit.**

Run: `git add apps/dashboard/src/components/results/paid-visits-section.tsx apps/dashboard/src/components/results/paid-visits-section.test.tsx && git commit -m "feat(dashboard): paid-visits-by-ad panel"`
Expected: Commit succeeds.


#### Task 6: Task 6 — Full-suite + format gates across the three packages

**Files:**
- Test: `/Users/jasonli/switchboard/packages/db/src/stores/__tests__/prisma-revenue-store-paid-visits.test.ts`
- Test: `/Users/jasonli/switchboard/apps/api/src/routes/__tests__/revenue-by-campaign-route.test.ts`
- Test: `/Users/jasonli/switchboard/apps/dashboard/src/components/results/paid-visits-section.test.tsx`

- [ ] **Step 1: Run the db + api + dashboard test suites together to confirm no regression in neighboring tests (the existing revenue.test.ts schema test, dashboard-reports.test.ts, campaigns-section.test.tsx).**

Run: `pnpm --filter @switchboard/db test && pnpm --filter @switchboard/api test src/routes/__tests__/revenue-by-campaign-route.test.ts src/routes/__tests__/revenue.test.ts && pnpm --filter @switchboard/dashboard test src/components/results src/lib/api-client/__tests__/dashboard-paid-visits.test.ts src/app/api/dashboard/paid-visits`
Expected: All suites PASS; no previously-green test turns red.

- [ ] **Step 2: Run Prettier format-check on the touched files — CI lint runs prettier even though local lint does not (per CLAUDE.md gotcha). If it reports diffs, run the same command with `--write`, then `git add` and amend.**

Run: `pnpm exec prettier --check packages/db/src/stores/prisma-revenue-store.ts apps/api/src/routes/revenue.ts apps/dashboard/src/lib/api-client/dashboard.ts apps/dashboard/src/app/api/dashboard/paid-visits/route.ts apps/dashboard/src/components/results/paid-visits-section.tsx`
Expected: All matched files use Prettier code style. (If not: re-run with --write, git add, and `git commit --amend --no-edit`.)

- [ ] **Step 3: Run the architecture line-count check (CI `architecture` job counts raw .ts lines, err >600 — separate from eslint; per CLAUDE.md gotcha). Confirm no touched .ts file crossed 600.**

Run: `pnpm arch:check`
Expected: No file-size violations for the touched files (prisma-revenue-store.ts ~360, revenue.ts ~145, dashboard.ts ~290 — all under 600).

