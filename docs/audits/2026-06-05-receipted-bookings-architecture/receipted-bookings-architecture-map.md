# Receipted Bookings — Architecture Map & Design Pass

> Date: 2026-06-05. Design/mapping only — no implementation.
> North star (revised 2026-06-05 after the strategy stress-test — see §0): **Switchboard makes a clinic more money and shows it which spend produced it — by running the booking/ad work itself, keeping an honest per-dollar ledger of what that work earned, and automatically shifting budget toward what pays off.** Wedge: **SG/MY aesthetic clinics that book on WhatsApp** (the no-PMS long tail Meta is conflicted against and the vertical OS won't reach). First metric: **weekly paid visits attributed to their cause.** _"Prove which actions created revenue" is the internal moat thesis and an embedded trust proof-point — not the headline SKU._
> Method: 13 codebase audits + 4 external-research agents + 1 adversarial red-team (18 agents, ~2.4M tokens), then synthesized against repo source. Every claim is cited `file:line`; unverified items say so.

A receipted booking is the connected chain, every link evidenced and every mutating hop enforced:

```
ad $ / campaign  →  conversation  →  consent on file  →  governed booking mutation
   →  booked appointment  →  held appointment  →  revenue / payment
```

The blunt headline: **the substrate is real and rare, but the chain does not connect end-to-end today, and the two configurations that produce a counted booking are mutually exclusive with human oversight.** The hardest-to-copy parts (single ingress chokepoint, hash-chained WorkTrace, transactional outbox, approval-binding) exist and are load-bearing. The links that make a _receipt_ (not an audit log) — externally-sourced identity for each hop — are mostly absent, self-reported, or flag-gated off.

---

## 0. Verdict (revised 2026-06-05 after an adversarial strategy stress-test)

The original framing of this doc — neutral, externally-verifiable **receipts** as the headline — was stress-tested by a 10-agent adversarial fan-out and **did not survive**. A standalone proof/attribution layer is a _vitamin_ (first budget cut, "another dashboard"); held+paid PMS attribution already ships in adjacent healthcare (Patient Prism, Invoca); the vertical OS already does cross-channel attribution from the POS (Zenoti "AI Digital Marketer"); and "trust unlocks autonomy" is inverted by every 2025–26 survey (buyers want a _supervised co-pilot_, not an autonomous worker they audit). What survived: **Meta's conflict of interest is real and durable** (it sells the ads it would have to audit; it quit the MRC audit Oct 2025 and keeps incrementality a black box), and **the governed substrate Switchboard already built is the right substrate.**

The revised north star is the **revenue loop**, in the owner's own words — _make me more money, and show me which spend produced it so I can do more of what works._ Proof stops being the product and becomes (a) the trust signal that the number isn't self-serving and (b) the input **Riley acts on to reallocate budget**. The moat is not the receipt and not the agents — it is **owning the acting-and-reallocating loop for the clinics Meta is conflicted against and the vertical OS won't reach** (SG/MY, WhatsApp-booking, no-PMS). The remaining build is to **close the loop's act-on-proof leg**: connect the chain to one identity, make a paid visit a first-party fact, and give Riley a reallocation that actually executes. Sections 1–6 (the codebase audit) stand unchanged; §7 (sequencing) and §9 (recommendation) are rewritten to this. Proof remains a vitamin **until welded to making more money** — the welding is: _the same system that does the work keeps the books and acts on the books._

---

## 1. Current-state architecture map

### 1.1 The spine that exists and is load-bearing (thesis-aligned)

| Component                                                                                                                                                                                          | Where                                                                              | Status                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **PlatformIngress.submit()** — single mutating chokepoint: idempotency claim-first (fail-closed), entitlement, intent/trigger validation, deployment resolution, GovernanceGate, WorkTrace persist | `packages/core/src/platform/platform-ingress.ts:89-428`                            | **Real.** The one place all enforcement co-occurs — for the _first_ submit of an action. |
| **WorkTrace** — canonical per-action record; content-hashed, AuditEntry hash-chain anchor, `lockedAt` seal, app-layer append-only                                                                  | `schema.prisma:1908-1976`; `prisma-work-trace-store.ts`; `work-trace-hash.ts:89`   | **Real but self-contained** (see §4).                                                    |
| **Transactional outbox** — `booked`/`purchased` OutboxEvent written in the _same DB tx_ as the domain mutation, drained to ConversionRecord                                                        | `calendar-book.ts:343-394`; `conversion-bus-bootstrap.ts:43-51`                    | **Real & load-bearing.** Guaranteed-publication funnel substrate.                        |
| **Booking write integrity** — `pg_advisory_xact_lock` per org + half-open overlap check + partial-unique active index + orphan-event compensation                                                  | `prisma-booking-store.ts:33-46`; `calendar-book.ts:395-404`                        | **Real.** Strong concurrency guarantees.                                                 |
| **Approval binding** — server-computed `bindingHash` over canonicalized payload; frozen-revision dispatch; approve→dispatch-or-`recovery_required`                                                 | `binding.ts:4`; `lifecycle-dispatch.ts:79-141`; `executable-materializer.ts:29-36` | **Real.** Executed action == approved content, by construction.                          |
| **Trust-bound tool identity** — `orgId`/`contactId` injected from `SkillRequestContext`, never from LLM input                                                                                      | `calendar-book.ts:156-159,224`; `skill-request-context.ts:16-17`                   | **Real.** Closes the prompt-injection vector on the mutation.                            |
| **Meta-sourced first-touch capture** — CTWA `ctwa_clid`/`source_id` parsed from Meta's inbound webhook, persisted to `Contact.attribution`                                                         | `whatsapp-parsers.ts:23-35`; `lead-intake-store.ts:74-104`                         | **Real, externally-originated** — the strongest raw evidence in the system.              |

### 1.2 The relevant models (Prisma)

- `WorkTrace:1908` — canonical action record. **Zero relational FKs** (no `contactId`/`conversationId`/`bookingId`/`campaignId`/`consentId`). Upstream/downstream linkage lives in a `parameters` JSON blob or nowhere.
- `Booking:1982` — `status` only ever `pending_confirmation|confirmed|failed|cancelled`. `calendarEventId?` (nullable), `workTraceId?` (nullable, **never populated by the live tool**). No `held`/`no_show`/`attended`.
- `ConversionRecord:2034` — funnel events (`inquiry|lead|booked|purchased`). `bookingId?`, `sourceCampaignId?`, `sourceAdId?`, `value Float`. `value` is **CENTS-in-a-Float** (precision smell + per memory, CENTS everywhere).
- `LifecycleRevenueEvent:1829` — `amount Int` (cents), `verified Boolean @default(false)` (**never set true by any code path**), `externalReference?` (free text), `recordedBy` (enum incl. `stripe`/`integration` with **no real writer**). **No `bookingId`.**
- `Contact:1741` — customer PDPA consent lives as **mutable columns** here (`consentGrantedAt`, `consentRevokedAt`, `aiDisclosureVersionShown`, `consentUpdatedBy`), not an evidence row. `attribution Json?`, `sourceType?`, `messagingOptIn`.
- `ConsentRecord:2179` — **NAMING TRAP.** This is creator/UGC likeness-rights consent (`personName`, `mediaTypes`, `recordingUri`), unrelated to customer messaging consent and off the revenue chain. Its store `.revoke()` is cross-tenant-unscoped.
- `DispatchLog:2060` — external accept/reject receipts for conversion dispatch. Writer (`wire-ad-dispatchers.ts:25-39`) is **never called in apps/** (dormant).
- `ReconciliationReport:2077` — real drift checks, but **internal-only** (Booking vs ConversionRecord vs Opportunity counts; all written in the same tx).
- `PreSwitchboardBaseline:2328` — captures only ad **spend/impressions/clicks** for "before/after"; **no revenue baseline**.

### 1.3 The three operators (what each touches)

- **Alex** (conversation/intake/consent/booking): inbound → ChannelGateway → PlatformIngress (`intent=alex.respond`) → SkillExecutor tool-loop. Mutations (`calendar-book`, `crm-write`, `escalate`, `follow-up`) write Prisma **directly inside the tool loop** — they do **not** re-enter ingress (only `delegate` does). The enforcing booking gate is the in-loop `GovernanceHook`. `alex-flow` audit.
- **Mira** (creative/ad deployment): publish path goes through ingress (`creative.job.publish`) with a real **mandatory** approval policy; the Meta create-chain runs but **every ad object is hardcoded `PAUSED`** and `updateCampaignStatus` throws on `ACTIVE` (`meta-ads-client.ts:276,356-359`) — a structural ceiling: agents physically cannot launch a live ad. Meta ids _are_ captured on `CreativeJob`. `mira-flow` audit.
- **Riley** (economic truth/diagnosis): produces recommendations but **has no live mutation leg.** Approving a pause/budget rec only flips a `PendingActionRecord` row to `acted` (`act.ts:95`); **nothing changes on Meta** (`updateCampaignStatus` has zero production callers). The outcome ledger attributes a pre/post delta to an action **it cannot prove was applied** (`recommendation-outcome-store.ts:259` keys on `status:'acted'` alone). `riley-flow` audit.

### 1.4 What is log-only / observe-only / stored-not-enforced (NOT enforcing)

This is the crux for the thesis ("every mutating step must pass an enforcing gate"):

| Control                                                                                          | Reality                                                                                                              | Evidence                                                                             |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Score-based **trust ramp**                                                                       | computed then **discarded**; live trust = hardcoded `"guided"` + manual `trustLevelOverride`                         | `governance-gate.ts:93`; `prisma-deployment-resolver.ts:12-16`                       |
| Governance `ExecutionConstraints` (`maxLlmTurns`, `maxWritesPerExecution`)                       | **never reach the executor** — SkillMode forwards only `trustLevel`; executor uses `DEFAULT_SKILL_RUNTIME_POLICY`    | `skill-mode.ts:93`; `skill-executor.ts:332,513`; bootstrap passes `policy=undefined` |
| All **compliance gates** (deterministic safety, claim classifier, PDPA consent, WhatsApp window) | default **off**; strongest seeded posture is **observe** (record, don't block)                                       | `governance-config.ts:12,40,79`; `buildObserveGovernanceConfig:195`                  |
| **Consent at booking time**                                                                      | **absent** — `calendar-book` never reads consent; gates only suppress _revoked outbound text_, and only in `enforce` | `calendar-book.ts:215-302`; `pdpa-consent-gate.ts:134-138`                           |
| `Booking.workTraceId`                                                                            | column + store support exist; **tool omits it** → booking unjoinable to its WorkTrace                                | `calendar-book.ts:259-268`; `schema.prisma:1998`                                     |
| `LifecycleRevenueEvent.verified`                                                                 | **never set true** anywhere; revenue fully self-reported                                                             | grep-empty; `prisma-revenue-store.ts:88`                                             |
| Meta **CAPI** echo (only externally-verifiable conversion leg)                                   | wired **only if** `META_PIXEL_ID`+`META_CAPI_ACCESS_TOKEN`; live path writes **no DispatchLog**                      | `conversion-bus-bootstrap.ts:54-87`                                                  |
| `maxWritesPerHour`, `circuitBreakerThreshold`, windowed spend caps                               | stored, **unread** on live gate path                                                                                 | `governance-enforcement` audit; `governance-gate.ts:156-163`                         |
| **Post-approval execution** (lifecycle route-class)                                              | **re-runs no governance/entitlement/idempotency** — dispatches mode directly                                         | `platform-lifecycle.ts:318-374`                                                      |
| `GovernanceVerdict` rows                                                                         | **log-only** — the one acting reader (lifecycle escalate) has no producer                                            | `lifecycle.ts:112-119`                                                               |
| **Reconciliation**                                                                               | real but **internal-only** count-matching; treats zero activity as "healthy"                                         | `reconciliation-runner.ts:37-47,64`                                                  |

### 1.5 Likely-live P0 (verify against a booted stack)

**Intent mismatch.** The exported `registerSkillIntents` (`skill-intent-registrar.ts`, called at `bootstrap/skill-mode.ts:149` with array `[alexSkill, miraSkill]`) registers `skill.intent` from frontmatter = **`alex.run`** (`skills/alex/SKILL.md:4`). But `ChannelGateway` submits **`${skillSlug}.respond` = `alex.respond`** (`channel-gateway.ts:313`), and `PlatformIngress.submit` returns `intent_not_found` for an unregistered intent (`platform-ingress.ts:163-173`). A _second_, identically-named `registerSkillIntents` in `register-skill-intents.ts` does register `.respond` (Map signature) but has **no non-test caller**. The e2e test (`convergence-e2e.test.ts`) inlines its own `.respond` skill defs, masking the production registrar. → **If correct, every live managed-channel inbound to Alex 503s.** This contradicts "launch-ready" status, so either it is a recent regression or there is a runtime reconciliation static analysis can't see. **Must-verify** via `IntentRegistry.listIntents()` on a real boot, or a full-stack integration test that submits `alex.respond`.

---

## 2. Target-state architecture (minimal for "weekly receipted bookings")

The design principle: **make the chain a single connected graph of immutable evidence rows, each link carrying an externally-sourced identifier, with one query that reconstructs it.** Not a new audit table family — extend the spine that exists.

### 2.1 Canonical domain model

One identity, one chain. The load-bearing fix is **Party unification**: a single `Contact` per real person, so the CTWA lead row and the conversation row are the same row (today they are two — see §4).

```
Campaign/Ad (Meta, external id)
  └─ ClickEvidence            (ctwa_clid | leadgen_id + raw signed webhook)   [NEW, immutable]
       └─ Contact             (one per person, E.164-normalized)
            └─ Conversation   (ConversationThread, real contactId + orgId)
                 └─ ConsentReceipt   (inbound msg id + verbatim + version)    [NEW, immutable]
                      └─ WorkTrace    (the governed booking submit; +contactId FK)  [EXTEND]
                           └─ Booking (status incl. held/no_show; +workTraceId)  [EXTEND]
                                ├─ CalendarReceipt  (provider event id, re-fetched)  [STRENGTHEN]
                                ├─ HeldReceipt      (external attendance signal)      [NEW]
                                └─ PaymentReceipt   (PSP charge fetched-back, verified)[NEW]
```

### 2.2 Event model

Keep the existing `ConversionEvent → ConversionRecord` projection invariant (canonicalized in `docs/superpowers/specs/archive/2026-04-18-revenue-loop-closure-design.md`). Extend the event vocabulary so each chain hop emits exactly one immutable funnel event:

`lead` → `inquiry` → `consented` (NEW) → `booked` → `held` (NEW) → `paid` (NEW)

Each event carries the **externally-sourced id for its hop** (click id, consent message id, calendar event id, attendance signal id, PSP charge id) in addition to the internal FKs. Idempotency key derived deterministically from the source id (not `randomUUID` — today `calendar-book.ts:342` regenerates per call, so a replayed turn double-counts).

### 2.3 Receipt model (the new core primitive)

A **Receipt** is an immutable row asserting one chain link, classified by _who can forge it_. This is the single most important new abstraction. Ranked by credibility (from `verification-rails` research):

```
RECEIPT TIERS (best → worst)
  T1  re-fetched-from-source-of-record within retention   (Stripe events.retrieve by id)
  T2  provider asymmetric signature                         (rare; few providers offer)
  T3  admin-domain audit log                                (Google Workspace Admin Reports)
  T4  symmetric-HMAC webhook                                (Stripe/Square push — forgeable by key holder)
  T5  self-reported / diagnostic score                      (Meta EMQ, operator-typed) — NOT a receipt
```

`Receipt { id, chainLink: enum, contactId, bookingId?, tier, source, externalId, externalTimestamp, payloadHash, fetchedBackAt?, createdAt }` — written once, hash-chained into the existing AuditEntry ledger. **A "receipted booking" counts only links backed by T1–T3.**

### 2.4 Gate model

Replace "mode defaults to off/observe" for the **chain-critical** gates with **fail-closed enforcement on the booking hop specifically** (leave conversational-text gates on the observe→enforce bake). Minimum enforcing set:

1. **Consent precondition inside `booking.create`** — fail closed if `consentGrantedAt` null or `consentRevokedAt` set; stamp the consent receipt id on the Booking.
2. **Booking approval that persists** — guided trust must create a real parked `ApprovalLifecycle` whose approve leg runs `execute()` and writes the Booking with `approverPrincipalId` (today guided persists _nothing_; see §3/§4).
3. **Revenue write authority split** — operator path forced to `recordedBy ∈ {owner,staff}, verified=false`; only a PSP-webhook-verified path may set `verified=true`.

### 2.5 Attribution model

Bind campaign credit to an **externally-originated, non-forgeable** click identity, never to our own mutable `Contact.attribution`:

- Persist the **raw Meta-signed referral/lead webhook** (with `X-Hub-Signature`) as an immutable `ClickEvidence` row at intake (verify the signature — `ad-optimizer.ts` CTWA webhook currently shows no signature check; `attribution-conversion` open Q).
- Resolve `sourceCampaignId` for CTWA (today omitted — `main.ts:176-188` doesn't pass `resolveCampaignId`, so **every CTWA booking is campaign-unattributed**).
- A booking may claim a campaign **only if** a CAPI-accepted event id ties that contact's click id to the booking. **No click id → counted as organic, never campaign-driven** (kills the "organic walk-in stamped to a campaign" attack).

### 2.6 Consent model

Adopt the **ISO/IEC TS 27560 / Kantara consent-receipt shape** (one field set satisfies SG PDPA + MY PDPA + US A2P-10DLC simultaneously — `verification-rails` research): `{ unique id, creation timestamp+tz, verbatim prompt + version, channel identity, inbound message id, opt-in method, double-opt-in confirmation msg id }`. Capture it from a **real inbound reply** (today `recordGrant` is never called with `whatsapp_quick_reply` etc.; consent is operator-asserted only). Distinguish purposes (booking/transactional vs marketing) — today it is one blob.

### 2.7 Booking lifecycle model

Extend `Booking.status`: `pending_confirmation → confirmed → held | no_show`, plus `cancelled|failed|rescheduled`. **`held`/`no_show` writable ONLY by an external signal** (calendar watch / PMS webhook / POS / governed staff check-in), never by an agent-settable CRM stage.

### 2.8 Revenue / held-appointment extension model

- `PaymentReceipt` sourced from a **PSP webhook, then re-fetched by id** (Stripe `events.retrieve` within the ~30-day retention window — store the fetched-back object, because Stripe truncates after 30 days). `verified=true` set only here.
- Globally unique `(organizationId, externalReference)` constraint so one charge counts once (today dedup is keyed on a caller-controlled synthetic `opportunityId` → replayable).
- A `held` link prefers an attendance signal; the **minimum viable** held proof is **deposit-paid** (a PaymentReceipt at/after appointment time), since attendance webhooks are rare across PMS (`medspa-pms-rails` research).

### 2.9 Operator action model (Alex/Mira/Riley)

- **Alex**: booking/consent must go through the persisted-approval path; stamp `workTraceId` + consent receipt id on every Booking.
- **Mira**: keep the PAUSED-only ceiling; when (if) a creative becomes a live ad, capture the ad id as a `ClickEvidence` source for attribution. No new agent surface.
- **Riley**: keep advisory-only, but **stop attributing outcomes to unexecuted actions** — either build a real execution leg with a captured Meta edit-response receipt, or gate the outcome ledger on an execution receipt (today it scores phantom actions and renders them as Riley wins). No new agent.

### 2.10 WorkTrace chain shape

Add durable FK columns so one SQL query reconstructs the chain from the canonical record: `WorkTrace.contactId`, `WorkTrace.conversationThreadId` (or persist the conversation↔workTrace edge that today lives only in an **in-memory Map**, `conversation-lifecycle.ts:57`), and populate `Booking.workTraceId`. Then `WorkTrace → Booking → {CalendarReceipt, HeldReceipt, PaymentReceipt}` and `WorkTrace → Contact → ClickEvidence → ConsentReceipt` are FK-traceable.

---

## 3. Receipted Booking state machine

Strict ladder. Each state names its **required evidence**, **external source**, **WorkTrace/receipt rows**, **gate**, **failure states**, and **whether it counts**.

```
S0 UNRECEIPTED_LEAD
S1 ATTRIBUTED_CONVERSATION
S2 CONSENTED_CONVERSATION
S3 GOVERNED_BOOKING_ATTEMPT
S4 BOOKED_APPOINTMENT
S5 RECEIPTED_BOOKING        ← counts toward weekly metric (minimum bar)
S6 HELD_RECEIPTED_BOOKING
S7 RECEIPTED_REVENUE
```

| State                           | Required evidence                                                                                 | External source                                        | WorkTrace/receipt                                                  | Gate                                                     | Failure                                        | Counts?               |
| ------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------- | ---------------------------------------------- | --------------------- |
| **S0 Unreceipted lead**         | inbound message exists                                                                            | channel provider                                       | Contact + Conversation rows                                        | —                                                        | dropped/spam                                   | No                    |
| **S1 Attributed conversation**  | click id (`ctwa_clid`/`leadgen_id`) on the **same** Contact as the conversation                   | Meta signed webhook                                    | `ClickEvidence` (T2/T3) + `lead` event                             | signature-verify webhook                                 | no click id → stays organic                    | No                    |
| **S2 Consented conversation**   | inbound opt-in: verbatim + msg id + version                                                       | WhatsApp/IG message id (provider)                      | `ConsentReceipt` (T3) + `consented` event                          | consent capture handler                                  | no inbound grant → S2 not reached              | No                    |
| **S3 Governed booking attempt** | persisted approval (guided) OR earned-autonomous                                                  | internal (approver identity ideally external Slack id) | `WorkTrace` (governed submit) + `ApprovalLifecycle` w/ approver    | **enforcing**: consent precondition + approval persists  | parked-but-vanished (today's bug) → no booking | No                    |
| **S4 Booked appointment**       | external calendar event id                                                                        | Google Calendar (real provider, not local/noop)        | `Booking(confirmed)` + `Booking.workTraceId` + `booked` event      | provider≠local assert                                    | local/noop id → not external                   | No                    |
| **S5 Receipted booking**        | S4 **re-fetched-verified** calendar event (still exists, time matches) + S1 click id + S2 consent | Calendar `events.get` re-fetch                         | `CalendarReceipt(T1)` joining ClickEvidence+ConsentReceipt+Booking | reconciliation external arm                              | event deleted/not found → fails                | **YES (minimum bar)** |
| **S6 Held receipted booking**   | attendance signal OR deposit-paid at/after appt time                                              | PMS check-in / POS / Stripe / governed staff check-in  | `HeldReceipt` (T1/T3)                                              | held writable only by external signal                    | no-show → `Booking.no_show`, not held          | YES (stronger)        |
| **S7 Receipted revenue**        | PSP charge fetched-back, `verified=true`, joined to booking                                       | Stripe/Square `retrieve` by id                         | `PaymentReceipt(T1)` + `paid` event                                | global unique `(org, externalRef)`; verified-only writer | refund → net to zero                           | YES (strongest)       |

**Design decision the team must make:** is the _weekly metric_ counted at **S5** (booked + externally-verified, the achievable near-term bar), **S6** (held), or **S7** (paid)? Recommendation: **report all three as a funnel** (S5/S6/S7) so the number degrades honestly rather than overclaiming — but **sell on S7 (paid)** because that is the buyer's real unit of value (`buyer-demand` research: "can't pay rent with impressions"; the open lane no incumbent occupies is _held+paid_, not _booked_).

---

## 4. Verification & anti-fake design (the critical section)

For each soft link: current classification, the recommended external source, the **minimum viable receipt** (demo org) and the **production-grade receipt**. Anti-fake is driven by the red-team's confirmed attacks.

### 4.1 Per-link verification table

| Link                     | Today                                                                                                                                                           | External source to use                                                          | Min viable receipt (demo)                                              | Production-grade receipt                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Action source**        | self-reported — `actor{id,type}` only; client-supplied on `/ingress/submit` & `/execute`; chat actor = sessionId                                                | server-derive actor on all mutating routes (as `approvals.ts:196` already does) | structured `actionSource{kind,id,agentName?,campaignId?}` on WorkTrace | + 403 on body/auth divergence; required-non-default asserted in gate         |
| **Campaign attribution** | self-reported — copied from mutable `Contact.attribution`; CTWA campaign id not even resolved                                                                   | Meta signed referral/lead webhook                                               | `ClickEvidence` row w/ raw `ctwa_clid`+payload                         | + `X-Hub-Signature` verified; CAPI-accepted dedup id ties click→booking      |
| **Consent**              | self-reported — our clock+actor; no inbound proof; not checked at booking                                                                                       | WhatsApp/IG inbound message id                                                  | `ConsentReceipt` w/ verbatim + msg id + version                        | + ISO-27560 shape; fail-closed precondition inside `booking.create`          |
| **Human approval**       | self-reported — `ApprovalLifecycle` has **no `respondedBy` column**; survives only on WorkTrace/AuditEntry; self-approval guard silently no-fires when no trace | Slack user id (HMAC-verified)                                                   | `approverPrincipalId` column on ApprovalLifecycle                      | + persist raw Slack id + binding id; fail-closed four-eyes                   |
| **Booking**              | externally-verifiable _at insert_ (Google id) **but** never re-verified; local/noop fabricates `local-<uuid>`; `workTraceId` omitted                            | Google Calendar `events.get`                                                    | `CalendarReceipt` (re-fetch confirms exists)                           | + provider≠local assert in prod; store etag/iCalUID; periodic reconcile      |
| **Held visit**           | **absent** — no status past `confirmed`; no calendar watch; `showed` is an agent-settable CRM string                                                            | PMS check-in / POS / governed staff check-in                                    | governed staff "check-in" tool (mints HeldReceipt)                     | + PMS/calendar attendance webhook                                            |
| **Payment / revenue**    | self-reported — `verified` never true; no PSP writer; no `bookingId` on revenue; replayable dedup                                                               | Stripe/Square webhook → **re-fetch by id**                                      | `PaymentReceipt` from fetched-back charge                              | + global unique `(org, externalRef)`; verified-only writer; refund-aware net |
| **Tamper-evidence**      | self-contained — hash, anchor, verifier all our code over our Postgres                                                                                          | external time anchor                                                            | SHA-256 hash-chain (exists) + **RFC 3161** timestamp of Merkle root    | + S3 Object-Lock COMPLIANCE; periodic external chain-head publication        |

### 4.2 Confirmed fakeability attacks (red-team) and the receipt that kills each

The red-team confirmed these against source. Ranked:

**CRITICAL**

1. **Operator types revenue, labels it `recordedBy:"stripe"`** — `revenue.ts:46` passes `recordedBy` straight from params; no PSP writer exists, `verified` never set, the dollar is already counted in `sumByCampaign`/trueROAS. _Kill:_ PSP-webhook-only writer for `verified=true`; count reads only `verified=true` rows whose `externalReference` resolves via server-side Stripe GET.
2. **Replay one real charge under fresh synthetic `opportunityId`s** — dedup is keyed on caller-controlled `opportunityId` (`revenue.ts:35` defaults `rev-${contactId}-${Date.now()}`). _Kill:_ global unique `(organizationId, externalReference)`.
3. **Organic/walk-in stamped to a campaign** — `sourceCampaignId` is a free param; booked path copies mutable `Contact.attribution`. _Kill:_ campaign credit only with a CAPI-accepted click-id tie; no click id → organic.
4. **Count `booked` as `held`** — no held/no-show state exists; every confirmed booking reads as kept. _Kill:_ external held signal; `no_show` separated.

**HIGH** 5. **Local/Noop provider fabricates the "external" calendar id** (`calendar-provider-factory.ts:76-137`). _Kill:_ assert provider≠local in prod + re-fetch. 6. **Insider DB write recomputes a self-consistent hash chain** — verifier is our code over our DB. _Kill:_ external anchor (RFC3161 / S3 Object-Lock / transparency log) of chain heads. 7. **Guided-trust booking persists nothing; the only counted-booking config (autonomous) has no four-eyes** — `skill-executor.ts:550-555` returns a synthetic `pendingApproval` ToolResult, no `ApprovalLifecycle`, no resume. _Kill:_ persisted parked approval whose approve leg runs `execute()`. 8. **Consent self-stamped; not checked at booking** — _Kill:_ inbound-sourced ConsentReceipt + fail-closed booking precondition.

**MEDIUM** — reconciliation is self-referential (can't detect inflation; treats zero activity as healthy); replayed inbound webhook double-creates (gateway submit has no idempotency key; outbox eventId is `randomUUID`); fixture/demo rows can leak into the count; clock games on the weekly window (timestamps self-set). _Kills:_ external reconciliation arm; idempotency key = provider message id + deterministic outbox eventId; immutable seed/demo origin marker excluded from count; **window the count on external timestamps only** (Stripe `charge.created`, calendar event start).

### 4.3 The two structural weaknesses no single receipt fixes

1. **Two disjoint Contact universes.** CTWA lead stores `+`-prefixed phone with attribution; the conversation path resolves by **raw, non-normalized** phone (`prisma-contact-store.ts:128-134`) and mints a **second** organic Contact with no attribution; the booking attaches to the attribution-less one (`chain-walk` BREAK 1). **Until E.164 normalization unifies them, every downstream attribution receipt is moot.** This is the load-bearing fix — do it first.
2. **All verification ultimately rests on our own DB.** The only externally-rooted signals are (a) Meta `ctwa_clid`/`leadgen_id` (then copied into our mutable column), (b) Google `calendarEventId` (real-provider path only, written once, never re-verified), (c) HMAC'd Slack user id (immediately mapped to an internal principal). A vendor or anyone with DB write access can manufacture a fully self-consistent count. **Due diligence cannot trust the number without external anchoring + fetch-back.**

---

## 5. Meta threat positioning

From `meta-threat` research (Meta Business Agent went **global 2026-06-03**, free tier, qualifies/books/hands-off across WhatsApp/IG/Messenger).

### 5.1 Vulnerable to Meta-native automation → keep thin/replaceable

| Capability                                                                  | Why Meta absorbs it                                                                                    | Switchboard posture                                                                                                                                                                |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Alex conversational front-end** (qualify, FAQ, recommend, route-to-human) | now free first-party, >1M businesses                                                                   | Keep Alex a **bounded task agent** (already the locked doctrine + the _only_ shape Meta permits for non-first-party agents). Do not compete on conversational UX in Meta channels. |
| **Mira simple campaign CRUD**                                               | Meta shipped an **Ads CLI + MCP for AI agents** (2026-04-29) — sanctioned external campaign management | Riley/Mira should **consume** Meta's agentic surfaces, not re-implement campaign CRUD.                                                                                             |
| **Riley Meta-native optimization** (pause/scale on spend/CPL/CTR/learning)  | Meta's own automated rules + Advantage+ replicate this natively — and Riley doesn't even execute it    | Riley's edge is **cross-system economic truth** (booked-CAC, coverage), not Meta-signal optimization.                                                                              |
| **Simple in-channel booking / native checkout**                             | "calendar management" is on Meta's roadmap; in-chat payment exists for catalog SKUs                    | Own the **governed write into the clinic's real calendar/PMS + the receipt** — not the chat.                                                                                       |

### 5.2 Must live in Switchboard, cannot depend on Meta

- **Cross-system reconciliation.** Meta sells advertisers **self-attributed, deliberately conservative** conversions (7-day click, ~30% under CRM) and a black-box incrementality model. It is **structurally conflicted** — the seller of ads cannot be the neutral auditor of ad-driven revenue. This is the durable moat.
- **Independent source of truth.** Meta only attributes Meta. A clinic on Meta + Google + WhatsApp + walk-ins needs one reconciled ledger. Meta cannot be the neutral arbiter across rival platforms.
- **Gate enforcement + WorkTrace chain + revenue receipt + held/revenue outcome** — none of which Meta provides; its enterprise "Business Agent Platform" is connector-driven, not compliance-grade governance.
- **Regulated-vertical compliance** — Meta is actively **vacating** this: it restricts health/finance optimization to top-of-funnel and bans web-activity conversion data in healthcare. SG/MY **HCSA/HSA + PDPA**-aware claim scanning, consent, and audited approvals are logic generic BizAI has zero of. (Crucial: SG HCSAR 2021 **bans** before/after photos, testimonials, superlatives, and urgency CTAs — `buyer-demand` research — so in SG/MY a _private, regulator-safe receipt_ is the only legal form of marketing proof left. Constraint → product-market fit.)

**Meta is a dead end as a _source_ of receipts** (`verification-rails`): CAPI returns no signed artifact (`fbtrace_id` is a support trace, EMQ is self-reported). Meta is **downstream** — you send it your already-receipted booking with a stable `event_id` + stored `fbclid` purely for optimization, never for proof.

---

## 6. Architecture options

Three paths. All share the non-negotiable first move (Party unification, §4.3.1).

### Option A — Fastest path to first demo receipted booking

**Scope:** E.164 Contact unification + populate `Booking.workTraceId` + assert real Google provider + re-fetch calendar event (`CalendarReceipt`) + Stripe **deposit link** as the payment/held proxy with fetch-back. Count at **S5/S7** for one demo org.

- **Implementation risk:** Low–medium. Most is wiring existing plumbing; the demo deposit-link is net-new but small.
- **Proves:** ad-click → conversation → booking → _deposit-paid_ on one real chain, externally verifiable. Closes the "is the loop real" question.
- **Does not prove:** held attendance; multi-PMS coverage; tamper-evidence against insiders; consent inbound capture.
- **Migrations:** `Contact` phone normalization (data migration + `findByPhone` change); `Receipt` table; `Booking.workTraceId` populate.
- **Dependency risk:** Stripe account + a real Google Calendar for the demo clinic. Low.
- **Recommendation:** **This is the right first slice** — smallest thing that yields a genuine externally-verified receipt and a sellable demo.

### Option B — Strongest long-term revenue-proof substrate

**Scope:** Everything in A, plus: `Receipt` tier model as a horizontal capability over WorkTrace; ISO-27560 ConsentReceipt with inbound capture + booking precondition; persisted booking-approval (fix the guided-trust hole); external reconciliation arm (calendar/CAPI/Stripe); RFC3161 + S3 Object-Lock tamper anchoring; PSP-only verified-revenue writer with global unique constraint; held signal via PMS adapters (Square first, per `medspa-pms-rails`).

- **Implementation risk:** High. Touches consent, approval-runtime (the unbuilt mid-loop parking), PSP, multiple PMS adapters, anchoring infra.
- **Proves:** the full thesis, adversarially — a count a CPA could run agreed-upon procedures against.
- **Does not prove:** anything beyond medspa until generalized (intentionally).
- **Migrations:** large — Receipt, ConsentReceipt, ApprovalLifecycle.respondedBy, Booking status enum, revenue uniqueness, ClickEvidence.
- **Dependency risk:** PMS partner-gating (Boulevard/Zenoti/Mindbody are enterprise/review-gated; Square is self-serve — sequence accordingly), RFC3161 TSA longevity, S3 Object-Lock irreversibility.
- **Recommendation:** the **destination**, not the first PR. Build incrementally behind A.

### Option C — Balanced (recommended overall)

**Scope:** A (the demo chain), then in priority order: (1) PSP-verified revenue writer + global unique constraint (kills the two CRITICAL money attacks); (2) inbound ConsentReceipt + fail-closed booking precondition (kills consent-fraud + satisfies PDPA pitch); (3) persisted booking-approval (kills the guided-vanish / no-four-eyes structural weakness); (4) external reconciliation arm + RFC3161 anchoring (kills insider/inflation attacks). Held attendance and broad PMS coverage deferred until a design partner demands them; deposit-paid stands in for held meanwhile.

- **Implementation risk:** Medium, staged.
- **Proves:** which actions created _paid_ revenue, externally and tamper-evidently, for the medspa wedge — without over-building attendance/PMS breadth before a buyer asks.
- **Does not prove:** authoritative attendance (uses deposit-paid as the held proxy — defensible given attendance webhooks are rare anyway).
- **Recommendation:** **Adopt C.** It front-loads the highest-severity anti-fake fixes and the sellable demo, and defers the partner-gated, low-availability attendance work.

---

## 7. Sequencing (rewritten to the revenue loop)

Strict rule: _if a slice doesn't make the loop run, prove it ran, or sell more paid visits, it's off-path._ Four phases; the WTP gate precedes committing past Phase 1.

**Phase 0 — Make the live path real (precondition).**

- **P0.1 Confirm/fix the `alex.respond` intent mismatch (§1.5).** The exported registrar registers `alex.run`; the gateway submits `alex.respond` (`channel-gateway.ts:313`), which returns `intent_not_found`. Verify on a booted stack via `IntentRegistry.listIntents()`; if broken, every managed inbound 503s — fix before anything else. If fine, pin a regression test.

**Phase 1 — Close the loop on one chain (the demo + the WTP test).** _Creates + sells._

- **P1.1 One identity (E.164 Contact unification).** `findByPhone` normalize + real `contactId`/`orgId` on threads — kill the two-Contact split (`prisma-contact-store.ts:128`, `gateway-conversation-store.ts:23`). _Load-bearing; nothing attributes without it._
- **P1.2 WorkTrace chain FKs + `Booking.workTraceId`.** One query reconstructs ad → conversation → booking (`calendar-book.ts:259` omits it today).
- **P1.3 First-party paid-visit receipt.** Switchboard issues the **deposit link** (Stripe / PayNow-SG / DuitNow-MY) at booking → PSP-webhook-verified `PaymentReceipt` (`verified=true`, fetch-back by id, global-unique `(org, externalReference)`). Because Switchboard owns booking **and** payment for the no-PMS clinic, "what produced this paid visit" is a **first-party fact, not a cross-system reconciliation** — sidestepping the unsolvable-attribution problem the stress-test flagged.
- **P1.4 Owner-legible "what's working."** One line per paid visit — _this $X paid visit came from this campaign_ — not a 12-widget dashboard.
- **GATE:** take the Phase-1 pitch ("more paid visits + we show you what drove them") to **10–15 SG/MY clinics**. Do not build Phase 2+ until willingness-to-pay is confirmed. This is the load-bearing untested assumption.

**Phase 2 — Make it _act_ (the actual moat: reallocation).** _Creates._

- **P2.1 Riley execution leg.** Today approving a budget rec only flips a `PendingActionRecord` row (`act.ts:95`); nothing changes on Meta. Build the reallocation that **executes** through PlatformIngress, capturing the Meta edit-response as an execution receipt — so the loop closes: prove → act → more revenue. _This turns measurement into a loop, and it is the move neither Meta (conflicted) nor the single-PMS vertical OS can follow._
- **P2.2 Compliance constraint to control-grade.** Harden the already-wired SG/MY gate (`banned-phrases/sg.ts`+`my.ts`, `deterministic-safety-gate`, `dialogue/post-validator`); flip per-org enforce after the observe bake; mandate human hand-off for clinical content. _Constraint, not headline._

**Phase 3 — Lock + make the count trustworthy.** _Hardens._

- **P3.1 Persisted booking approval** — fix the guided-trust vanish (`skill-executor.ts:550`), record the approver (`ApprovalLifecycle.respondedBy`). Supervised co-pilot, not autonomous.
- **P3.2 External reconciliation arm + RFC3161/S3-Object-Lock anchoring + the weekly metric**, windowed on **external** timestamps, demo/seed origins excluded.

**Phase 4 — Expand (only after the loop is proven + WTP confirmed).** Up-market to PMS clinics as the **cross-channel neutral ledger on top of their Zenoti** (the one thing a POS-owner that also sells the ads can't neutrally be); then SEA aesthetics (~$3B) → adjacent regulated SMB verticals. Premature generalization is itself a kill condition.

---

## 8. Kill conditions / risk register

What makes this strategy fail (each mapped to the live evidence that makes it a real risk, not hypothetical):

| Kill condition                                        | Live status                                                                                                                               | Mitigation / which PR                                                                                                                                |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gates are log-only**                                | TRUE today — all compliance gates default off/observe; constraints never reach executor                                                   | PR 5/6 make the **booking hop** fail-closed; leave text gates on the bake                                                                            |
| **`actionSource` stays optional**                     | TRUE — only coarse `actor{id,type}`, client-supplied on some routes                                                                       | structured actionSource (cheap; fold into PR 2)                                                                                                      |
| **Calendar/PMS not owned**                            | PARTIAL — Google adapter real but per-deployment OAuth unused; local/noop fabricates ids; **no PMS at all**                               | PR 3 (assert real provider) + deferred PMS (Square self-serve first)                                                                                 |
| **Consent is just a checkbox**                        | TRUE — mutable Contact columns, self-stamped, not checked at booking                                                                      | PR 5                                                                                                                                                 |
| **Held visit manually reported**                      | WORSE — held **doesn't exist**; `showed` is an agent-settable string                                                                      | deposit-paid as held proxy (PR 4); attendance deferred                                                                                               |
| **Meta owns the full customer flow**                  | Partial threat — but Meta keeps CTWA/lead/CAPI/Marketing API **open** and is **vacating** regulated verticals                             | §5 — own reconciliation + compliance + receipt, not the chat                                                                                         |
| **Buyer wants bookings, not proof**                   | TRUE (stress-test) — owners pay for outcomes, not dashboards; attribution is the first budget cut                                         | sell _more paid visits + Riley reallocation_; receipts ride **inside** the loop, never as the SKU                                                    |
| **WorkTrace becomes generic audit sludge**            | RISK — already 4-5 parallel audit tables (`ExecutionTrace`, `GovernanceVerdict`, `ActivityLog`, `AgentEvent`) with **no FK to WorkTrace** | PR 2 makes WorkTrace the FK spine; resist new audit tables — extend Receipt                                                                          |
| **Premature abstraction**                             | RISK — don't build multi-vertical receipt taxonomy or MTA sophistication; `buyer-demand` says under-build analytics                       | medspa-only Receipt; one-line receipt UX, not a 12-widget dashboard                                                                                  |
| **Agents become the product**                         | RISK — the moat is the acting+reallocating **loop**, not the agents and not the receipt                                                   | no new agents; Riley must gain a real execution leg (today it scores phantom, unexecuted actions)                                                    |
| **Vertical OS closes the gap (Zenoti/Moxie)**         | REAL — Zenoti AI Digital Marketer does cross-channel attribution from the POS; better capitalized                                         | win the **no-PMS long tail** they won't reach; be the SoR for clinics that have none; neutrality only matters up-market (Phase 4)                    |
| **Autonomy framing**                                  | FALSE demand — buyers want a supervised co-pilot; SG/MY mandates human hand-off for clinical                                              | sell "safely let AI do _more under your control_"; persisted approval (P3.1)                                                                         |
| **Insider/vendor fabricates the count**               | TRUE — all verification is self-contained                                                                                                 | PR 7 external anchoring + fetch-back                                                                                                                 |
| **Approval-runtime rebuild is a quarter, not a week** | TRUE — mid-loop parking is "unrepresentable" per prior finding                                                                            | PR 6 is the riskiest; consider interim: route booking through the _platform_ require_approval path (which does persist) rather than the in-loop hook |

---

## 9. Recommendation (rewritten)

**Build first:** Phase 0 (prove the live path) → **Phase 1 (close the loop on one chain for a no-PMS WhatsApp clinic)**, then **stop at the gate**. Smallest sellable demo: a SG/MY clinic runs a CTWA ad → WhatsApp → Alex books → Switchboard issues a deposit link that gets paid → the owner sees _"this paid $X visit came from this ad,"_ first-party and verified. Run the 10–15-clinic WTP test before Phase 2.

**The moat to build for (Phase 2):** the _acting_ loop — Riley reallocating real budget toward what produced paid visits. A loop that only measures is an attribution tool (a vitamin); the loop that **acts** is the painkiller, and the thing neither Meta (conflicted — it will never tell you to spend _less_ on Meta) nor the single-PMS vertical OS (within-stack-only; won't reach the no-PMS long tail) can follow into.

**Demote, don't delete:** "prove which actions created revenue" is the internal moat thesis and an embedded trust signal vs Meta's self-graded numbers — never the headline SKU. Compliance is a non-negotiable constraint, not the pitch. Receipts ride inside the loop.

**Never build:** a 4th agent; a standalone attribution dashboard; campaign-CRUD duplicating Meta's Ads CLI/MCP; perfect multi-touch attribution (under-build analytics); any operator path to `verified=true`/`held` without an external signal; **becoming a PMS** (rip-and-replace loses to incumbency — win the no-PMS long tail and _become_ their first system of record instead).

**Through-line:** the owner only cares about _more money_ and _what's driving it._ Win by being the loop that does the work, keeps the honest books, and moves the money — for the clinics Meta is structurally conflicted against and the vertical OS won't serve. Defensibility = the acting loop + compounding per-clinic learning + being the system of record for clinics that had none. Not neutrality, not compliance rules, not the agents.

---

### Appendix: confidence & what I could not verify

- **Highest confidence (source-cited):** the enforcement/verification classifications in §1.4, the chain breaks in §4.3, the red-team attacks in §4.2 — all `file:line` verified by the audit agents and spot-checked against `schema.prisma`, `platform-ingress.ts`, `calendar-book.ts`, `governance-gate.ts`.
- **Needs runtime/DB/env confirmation (static analysis can't see):** (1) the `alex.respond` intent mismatch — _the single most important thing to confirm first_; (2) whether prod calendar provider is real Google vs local/noop; (3) whether `META_PIXEL_ID`/`META_CAPI_ACCESS_TOKEN` are set (CAPI dark if not); (4) whether any live deployment carries `trustLevelOverride="autonomous"` (would auto-execute bookings with no human) or `governanceConfig` in `enforce`; (5) whether `ConversionRecord.value` is divided by 100 before display (`reporting-revenue-ui` flagged a possible **100× revenue inflation** in live `/reports` mode — needs a cents-normalization trace); (6) whether `ad-optimizer.ts` CTWA webhook verifies `X-Hub-Signature`.
- **External research (spot-check before quoting externally):** Meta global-launch date and capability boundary, PMS API availability tiers, SG/MY HCSAR ad bans, verification-rail properties — all carry source URLs + dates in the per-topic agent outputs under `/tmp/wf-receipts/` (research--\*.json).
- **Not opened:** `apps/api/src/routes/webhooks.ts` (alternate CTWA capture point); production calendar-provider-factory runtime resolution; exact SG/MY PMS market-share split.
