# Alex Governed Follow-Up Capability — Design

- **Date:** 2026-06-01
- **Status:** Draft (brainstormed + two-wave fan-out-verified against `main`; pending review)
- **Area:** `packages/core` skill-runtime + new `apps/api` contained-workflow + Inngest cron; one Prisma migration
- **Branch (spec):** `docs/alex-governed-followup`
- **One-liner:** Alex can schedule a WhatsApp follow-up for a hesitant/dormant lead, and a firing worker sends it when due — but **only** when PDPA consent, the WhatsApp 24h window/opt-in, and template approval all allow, and **only** through the governed `PlatformIngress.submit()` path (never a direct send).

---

## 1. Problem (verified against `main`)

A lead goes quiet mid-conversation. Today there is **no mechanism for Alex to re-engage**, so the lead dies in silence:

- **No follow-up/schedule/re-engage/nudge tool exists.** Alex's live tools are exactly `crm-query, crm-write, calendar-book, escalate, delegate` (`skills/alex/SKILL.md:48-53`; wired in `apps/api/src/bootstrap/skill-mode.ts:316-338`). The only re-engagement artifacts are passive WhatsApp _templates_ (`whatsapp-registry.ts:188-217`) and an analytics-only `ReEngagementAttributor` — neither is LLM-callable.
- **Dormancy is already detected, but nothing is sent.** `lifecycle-stalled-sweep` runs hourly (`apps/api/src/services/cron/lifecycle-stalled-sweep.ts:37-42`, `0 * * * *`), writes a `stalled` lifecycle transition (`conversation-lifecycle/cron/stalled-sweep.ts:51-64`), and stops. It has `orgId/contactId/threadId/lastOutbound` at detection but **no channel** and **no send leg**.
- **`ConversationThread.followUpSchedule.nextFollowUpAt` is plumbed-but-dead** (`schema.prisma:950`; Zod `conversation-thread.ts:50-55`) — zero product producers/consumers; every non-null value is a test fixture.
- **`scheduler/` + `ScheduledTriggerRecord` are inert** (`schema.prisma:1578-1598`) — no firing worker, no "find-due" query, no claim/dedupe primitive, and a self-contradictory action taxonomy.

### The corrected keystone premise

The original framing assumed _"submit each through `PlatformIngress.submit` so consent + WhatsApp-window gates fire automatically."_ **They do not.** Verified at `file:line`:

- `PlatformIngress.submit` (`platform-ingress.ts:89`) enforces **only** idempotency replay, billing entitlement, trigger validation, the `GovernanceGate` policy/risk decision, and WorkTrace persistence. It does **not** call any consent gate or the WhatsApp window/template gate (grep for `consent` in `platform-ingress.ts` returns nothing).
- The PDPA consent gate (`PdpaConsentGateHook`) and `WhatsAppWindowGateHook` are `afterSkill` hooks. The interactive/respond executor `SkillExecutorImpl.execute` **never calls `runAfterSkillHooks`** — only `BatchSkillHandler` does (`batch-skill-handler.ts:156`). So those hooks are dead on the submit path.
- The _live_ consent enforcement runs **outside** submit, in `ChannelGateway` egress (`runConsentEnforcementGate`, `channel-gateway.ts:71-97`). The WhatsApp window/template helpers in `apps/chat/src/adapters/whatsapp.ts` have **no live callers**.

**Consequence:** a firing cron that merely calls `submit()` would dispatch an **ungated** proactive message. "Governed" is therefore the real engineering work, and the consent/window/template gate must be applied **explicitly at the mutation site** — exactly the producer-population doctrine ("a gate is inert wherever it isn't wired").

---

## 2. Goals / non-goals

**Goals**

- Alex can **schedule** a follow-up for the current contact, with a coarse delay and a reason, as a deliberate governed agent action (each one records a row + is observable).
- A firing worker **sends** due follow-ups **autonomously when eligible**, and **records a skip reason when not** (no silent caps).
- Every outbound send flows through `PlatformIngress.submit()` → a governed `WorkflowMode` handler → WhatsApp template. No direct-send bypass. WorkTrace, governance, idempotency, audit all apply.
- The send is **fail-closed**: missing/incomplete consent, outside-window without opt-in, or an unapproved/marketing-blocked template ⇒ **no send**, reason recorded.
- "One-and-done" per dormant episode, hard-capped at **≤1 follow-up per contact per 24h**.
- Consent + window + template logic is **single-sourced** in one helper reused by every proactive-send path (no drift).

**Non-goals (explicit scope fence)**

- **Dormancy-sweep auto-scheduling.** v1 producer is the schedule-tool only (Alex decides). Auto-enqueuing a follow-up for every 24h-dormant thread is a clean follow-on, not v1.
- **Cadence / repeat nudges.** `cadenceId` (`conversation-thread.ts:50-55`) stays reserved. v1 is one-and-done.
- **Per-org credential multi-tenancy.** The send handler reads env credentials like the existing `meta.lead.greeting.send` precedent (`meta-lead-greeting-workflow.ts:22`). Per-org credential resolution via `PrismaDeploymentConnectionStore` + `decryptCredentials` (pattern at `inngest.ts:489-498`) is noted as hardening, not built here.
- **Retiring the dead `followUpSchedule` / `scheduler` paths.** Out of scope; we neither populate nor delete them.
- **Channels other than WhatsApp.** v1 is WhatsApp (Alex's live channel). The schema carries `channel`, but the eligibility/send path is WhatsApp-specific; other channels fall through to a recorded skip.
- **A new org-enablement flag.** Deliberately **not** added — it would be inert. Template `approvalStatus` + the per-deployment marketing flag are the _natural, fail-closed_ enablement gate (see §7).

---

## 3. Approach (1 of 3 considered)

**✅ Approach 1 — Dedicated `ScheduledFollowUp` due-queue + tool-producer + ingress-governed send handler + Inngest firing cron.** End-to-end clone of the proven `lead-retry` cron (`lead-retry.ts`) and `meta.lead.greeting.send` governed template send (`meta-lead-greeting-workflow.ts`). Indexed due-query, durable claim-first dedupe, fail-closed gate. Chosen.

**✗ Approach 2 — Wire `ConversationThread.followUpSchedule` (JSON).** No new table, but: single-valued per thread, a JSON column can't be cleanly indexed for the hourly cross-org "find due" scan, one producer already writes a malformed `{}` (`gateway-conversation-store.ts:45`), and there is no natural claim/dedupe primitive. Higher query risk for no real saving.

**✗ Approach 3 — Activate `scheduler/ScheduledTriggerRecord`.** Inert _and_ broken: no due-query, no claim primitive, action taxonomy disagrees with its own seed (`spawn_workflow|resume_workflow|emit_event` vs `notification.send|campaign.pause`), `#643` tenant-isolation debt, no cron parsing. Activating it is a larger, riskier lift that still needs most of Approach 1. The scheduler deserves a dedicated effort, not a piggyback.

> Mental model: instead of storing reminders in random notes (followUpSchedule) or repairing a broken calendar app (scheduler), build a small purpose-built calendar (`ScheduledFollowUp`).

---

## 4. Architecture

Two legs with a hard seam between **scheduling** (producer, Leg A) and **sending** (execution, Leg B), plus one shared eligibility helper.

```
Conversation → Alex calls follow-up tool (Leg A) → ScheduledFollowUp row (status=pending)
                                                          │
                                  hourly-ish ┌────────────┘
                                             ▼
Inngest cron (Leg B2) → claim row (pending→sending) → PlatformIngress.submit(conversation.followup.send)
                                             │
                                             ▼
WorkflowMode handler (Leg B1) → evaluateProactiveSendEligibility() → eligible? → WhatsApp template POST
                                             │                              │
                                             └── not eligible → outputs.sent=false, skipReason ──┘
                                             ▼
cron maps result → markSent / markSkipped(reason) / incrementAttempt+backoff / markFailed
```

### 4.1 Schema — `ScheduledFollowUp` (one migration, same commit)

New Prisma model, modeled on `PendingLeadRetry`. Migration hand-written (CI has no TTY for `migrate dev`); run `pnpm db:check-drift` before commit; index names must stay within the 63-char cap.

```prisma
model ScheduledFollowUp {
  id                   String    @id @default(cuid())
  organizationId       String
  contactId            String
  conversationThreadId String?
  sessionId            String?
  deploymentId         String?
  workUnitId           String?          // scheduling lineage (parent work unit, if any)
  channel              String           // "whatsapp" in v1
  jurisdiction         String?          // "SG" | "MY" — for template selection
  reason               String           // why Alex scheduled (enum-validated in app layer)
  templateIntentClass  String           // "re-engagement-offer"
  dueAt                DateTime
  status               String    @default("pending") // pending|sending|sent|skipped|failed|cancelled
  attempts             Int       @default(0)
  dedupeKey            String    @unique // followup:<org>:<contact>:<dayBucket(dueAt)>  (see §6)
  skipReason           String?          // consent_pending|consent_revoked|no_optin|no_template|template_not_approved|marketing_blocked|unsupported_channel
  lastError            String?
  nextRetryAt          DateTime?        // backoff for transient send failures
  sentAt               DateTime?
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  @@index([status, dueAt])              // the firing due-query
  @@index([organizationId, contactId])  // rate-guard + dedupe lookups
}
```

Store: `ScheduledFollowUpStore` interface in `core` + `PrismaScheduledFollowUpStore` in `db` (layering: store interface in core, impl in db — mirrors existing stores). Methods: `create`, `findPendingForContact(orgId, contactId)`, `findDue(now, limit)`, `claim(id)` (atomic `pending→sending`), `markSent(id)`, `markSkipped(id, reason)`, `markFailed(id, error, nextRetryAt?)`. `claim` uses `updateMany({ where: { id, status: "pending" }, data: { status: "sending" } })` and returns `count === 1` (honoring the `updateMany`-drops-no-match-abort gotcha — we treat `count === 0` as "lost the claim", not an error).

### 4.2 Leg A — Producer: the `schedule-follow-up` tool

New factory `createScheduleFollowUpToolFactory(deps)` in `packages/core/src/skill-runtime/tools/schedule-follow-up.ts`, modeled on `crm-write.ts` (factory-with-ctx) + `escalate.ts` (direct side-record write + duplicate guard):

- **id** `"follow-up"`, **op** `"followup.schedule"`.
- **`effectCategory: "write"`** (persists a real row → correctly **blocked in simulation** by `SimulationPolicyHook`, so dry-runs never create real follow-ups), **`idempotent: true`**. Governance matrix (`governance.ts:19-35`): `write` auto-approves at Alex's default `guided` trust.
- **Trust-bound IDs from `ctx` only** — `ctx.orgId`, `ctx.contactId`, `ctx.sessionId`, `ctx.deploymentId`, `ctx.workUnitId` (`SkillRequestContext`, `types.ts:372-387`). **Never** accept any of these as model input. Fail-closed `fail("MISSING_CONTACT", …, { retryable: false })` when `ctx.contactId` is absent (copy `calendar-book.ts:165-173`).
- **`inputSchema`** (raw JSON-Schema, **no `min`/`max`/`minLength`/`maxLength`** — Anthropic strict-schema 400 hazard, `delegation-port.ts:39-43`):
  - `reason`: `enum` of `["hesitation","price_concern","timing_not_now","awaiting_info","went_quiet"]`.
  - `delay`: `enum` of `["in_1_day","in_3_days","in_1_week"]`. The server maps this to `dueAt = now + delayMap[delay]` — **the model never supplies a raw timestamp** (avoids min/max and arbitrary times).
  - `note`: optional `string` — Alex's context, stored for trace/operator visibility (not sent raw to the customer).
- **execute** logic:
  1. Resolve `channel` + `jurisdiction` + `conversationThreadId` from the thread (deps: a thread/contact reader; channel lives in `ConversationThread.agentContext`, jurisdiction derivable from contact/org).
  2. Compute `dueAt`; compute `dedupeKey = followup:${orgId}:${contactId}:${dayBucket(dueAt)}`.
  3. **Rate-guard:** `findPendingForContact(orgId, contactId)` → if a pending follow-up exists, return `ok({ status: "already_scheduled", followUpId })` (idempotent, escalate-style guard). The `dedupeKey` UNIQUE column is the DB backstop (P2002 ⇒ treat as already-scheduled).
  4. `create(...)` the row (status `pending`). Return `ok({ followUpId, scheduledFor: dueAt, status: "scheduled" })`.
- **Direct store write, not through ingress** — deliberate, following the `escalate` precedent for internal side-records (`escalate.ts:60-77` writes via `handoffStore.save` without ingress). Scheduling an _intent to act later_ is not the mutating revenue/outbound action; the **send** is, and it goes through ingress (Leg B). Documented so a reviewer doesn't read it as a bypass.
- **Wiring:** add `scheduleFollowUpFactory` to **both** maps in `apps/api/src/bootstrap/skill-mode.ts` (runtime `toolFactories` :316-322 and schema-only `toolsMap` :327-338); **exclude** from the simulation executor maps (:665-668) like `delegate` (defense-in-depth; `write` is already sim-blocked). Export from `tools/index.ts`. Add `follow-up` to `skills/alex/SKILL.md:48-53` `tools:` list, plus a short "when to use" prompt note (schedule a check-back when a qualified lead goes hesitant/quiet — do **not** spam; one nudge).

### 4.3 Shared core helper — `evaluateProactiveSendEligibility`

New pure-ish function in `core` (proposed `packages/core/src/notifications/proactive-eligibility.ts`), composing the three primitives so the safety-critical gate is single-sourced (the alternative — re-implementing in cron + handler + any future campaign path — guarantees drift):

```ts
type ProactiveSendEligibility =
  | { eligible: true; template: WhatsAppTemplate }
  | { eligible: false; reason: ProactiveSkipReason };

async function evaluateProactiveSendEligibility(input: {
  contact: ContactConsentState & { messagingOptIn: boolean };
  lastWhatsAppInboundAt: Date | null;
  intentClass: IntentClass; // "re-engagement-offer"
  jurisdiction: "SG" | "MY";
  allowMarketingTemplate: boolean; // per-deployment flag
  clock: () => Date;
}): Promise<ProactiveSendEligibility>;
```

Composition (order matters — strictest/cheapest first):

1. **PDPA proactive consent** — `evaluateConsentGate({ contact, messageClass: "proactive" })` (`pdpa-consent.ts:86`). This is the **only** primitive that enforces the proactive bar: it blocks `pending` (jurisdiction stamped, never granted) **and** `revoked`. `runConsentEnforcementGate` (`consent-enforcement-gate.ts:33`) is revocation-only → **insufficient alone**, not used as the proactive bar. ⇒ `consent_pending` / `consent_revoked`.
2. **WhatsApp window / opt-in** — `isWithinWhatsAppWindow(lastWhatsAppInboundAt) || contact.messagingOptIn` (the `canSendWhatsAppTemplate` logic, `whatsapp.ts:81`). A dormant lead is by definition **outside** the 24h window, so a template is mandatory and opt-in is the bar. ⇒ `no_optin`.
3. **Template selection + approval** — `selectTemplate({ intentClass, jurisdiction })` (`whatsapp-registry.ts:220`); then replicate the gate's two checks (`whatsapp-window-gate.ts:173,195`): `template.approvalStatus !== "approved"` ⇒ `template_not_approved`; `template.templateCategory === "marketing" && !allowMarketingTemplate` ⇒ `marketing_blocked`; no fit ⇒ `no_template`.

**Helper promotion:** `isWithinWhatsAppWindow` / `canSendWhatsAppTemplate` currently live in `apps/chat/src/adapters/whatsapp.ts:66,81` and cannot be imported by `apps/api` (apps-import-apps is forbidden). Promote the **pure** window/opt-in helpers into `core` (surface-agnostic; re-export from `apps/chat` for back-compat) so both the live chat path and the firing leg share one window definition. The `selectTemplate` + approval/marketing checks already live in `core`.

Data sources the caller resolves by `contactId`/`threadId`: `lastWhatsAppInboundAt` from `ConversationThread` (`schema.prisma:953-956`), `messagingOptIn` from `Contact` (`schema.prisma:1679`), `ContactConsentState` via `consentStore.readOrNull(contactId, orgId)` (`consent-store.ts:20`; pass `organizationId` for cross-tenant safety).

### 4.4 Leg B1 — Send handler `conversation.followup.send` (governed mutation site)

New `buildConversationFollowUpSendWorkflow(deps)` in `apps/api/src/services/workflows/conversation-followup-send-workflow.ts`, a `WorkflowHandler` (`workflow-mode.ts:29`) modeled on `meta-lead-greeting-workflow.ts` (the live precedent for a governed WhatsApp **template** send from `apps/api`):

- `execute(workUnit)`: read params `{ orgId, contactId, conversationThreadId, channel, jurisdiction, templateIntentClass, reason, followUpId }`.
- If `channel !== "whatsapp"` ⇒ `{ outcome: "completed", outputs: { sent: false, skipReason: "unsupported_channel" } }`.
- Resolve consent/window/opt-in data; call **`evaluateProactiveSendEligibility`** — this is the **authoritative gate at the mutation site** (the cron is upstream; the handler is where the send is committed, so the gate lives here per "apply the gate on every surface that can commit the action").
- **Not eligible** ⇒ `{ outcome: "completed", outputs: { sent: false, skipReason } }`. A consent/template skip is a **successful no-op**, not a `failed` outcome (so it isn't retried as an error).
- **Eligible** ⇒ POST the approved template to `graph.facebook.com/<ver>/<phoneNumberId>/messages` (inline `fetch`, env creds `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID`, mapping `template.variables` to positional body params — copy `meta-lead-greeting-workflow.ts:22-56`). Map HTTP `ok` ⇒ `{ outcome: "completed", outputs: { sent: true, messageId } }`; non-`ok` ⇒ `{ outcome: "failed", error: {...} }`.
- **Registration** (`apps/api/src/bootstrap/contained-workflows.ts`): add `["conversation.followup.send", buildConversationFollowUpSendWorkflow(deps)]` to the handlers Map (:154-ish) and an IntentRegistry entry (:228-244 loop) that **mirrors the verified `meta.lead.greeting.send` block**: `{ intent: "conversation.followup.send", defaultMode: "workflow", allowedModes: ["workflow"], executor: { mode: "workflow", workflowId: "conversation.followup.send" }, budgetClass: "standard", approvalPolicy: "none", allowedTriggers: ["internal"], … }`. Copy the remaining `IntentRegistration` fields (`mutationClass`, `idempotent`, `timeoutMs`, etc.; shape at `intent-registration.ts:35`) from the greeting entry rather than guessing enum values — plan-level detail.
- **Governance choice (deliberate, matches the "gated-autonomous" product decision):** `approvalPolicy: "none"` ⇒ the send auto-executes with **no human in the loop**; the real gate is the deterministic consent + approved-template eligibility check in the handler. Explicitly **not** `approvalMode: "system_auto_approved"` (that short-circuit is reserved for no-outbound drafts like `creative.concept.draft` and is a trap for real sends). The `meta.lead.greeting.send` precedent already uses `approvalPolicy: "none"` for a customer template send.

### 4.5 Leg B2 — Firing cron `scheduled-follow-up-dispatch`

New `apps/api/src/services/cron/scheduled-follow-up-dispatch.ts`, cloned from `lead-retry.ts` (deps-interface + pure `executeScheduledFollowUpDispatch(step, deps)` + `createScheduledFollowUpDispatchCron(deps)` factory):

- **Schedule** `*/15 * * * *` (matches `lead-retry`; responsive without being chatty — re-engagement timing is day-scale so this is generous). Non-colliding with the intentional `0 7` ops window.
- **deps:** `failure: AsyncFailureContext`, `findDueFollowUps()`, `claimFollowUp(id)`, `markSent(id)`, `markSkipped(id, reason)`, `markFailed(id, error, nextRetryAt)`, `submitFollowUpSend(params)` (a thin closure over `platformIngress.submit`, built in bootstrap, mirroring `createSubmitChildWork` at `contained-workflows.ts:37` but top-level — no `parentWorkUnitId`, `trigger: "internal"`, `actor: { id: "system:scheduled-follow-up", type: "system" }`, `surface: { surface: "api" }`).
- **`executeScheduledFollowUpDispatch`:**
  - `due = step.run("find-due-followups", () => deps.findDueFollowUps())` — `where status:"pending", dueAt<=now, (nextRetryAt null OR <=now), attempts<MAX, take 100`. This DB due-filter is itself a rate/claim gate.
  - per item `step.run(\`followup-${f.id}\`, async () => { … })`:
    1. **Claim** `pending→sending` (`claimFollowUp`); `false` ⇒ another run/worker won it ⇒ return.
    2. `submitFollowUpSend({ ...f, idempotencyKey: \`followup-send:${f.id}\` })`⇒`PlatformIngress.submit(conversation.followup.send)`.
    3. Map result: `ok && outputs.sent === true` ⇒ `markSent`; `ok && outputs.sent === false` ⇒ `markSkipped(outputs.skipReason)`; `!ok || outcome === "failed"` ⇒ `incrementAttempt` + `markFailed(error, computeNextRetry(attempts))` (backoff: `min(BASE * 2^attempts, CAP)`, copy `lead-retry.ts:138-141`); at `attempts >= MAX` ⇒ terminal `failed`.
- **Registration:** add `createScheduledFollowUpDispatchCron(deps)` to the `functions: [...]` array in `apps/api/src/bootstrap/inngest.ts:704-813` and a deps block (~:454), constructing the store + `submitFollowUpSend` from `app.prisma` + the platform. `onFailure: makeOnFailureHandler({ functionId: "scheduled-follow-up-dispatch", eventDomain: "scheduled-follow-up", riskCategory: "high", alert: true }, deps.failure)` (`async-failure-handler.ts:84`) — customer-facing ⇒ high + alert, matching `lead-retry`.

---

## 5. Governance & invariant compliance

| Invariant                                                 | How this design satisfies it                                                                                                                                                                                     |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mutating actions enter through `PlatformIngress.submit()` | The **send** is submitted as `conversation.followup.send` (Leg B2→B1). The cron never POSTs to WhatsApp directly. Scheduling (Leg A) is an internal side-record (escalate precedent), not the outbound mutation. |
| `WorkTrace` is canonical persistence                      | Every send (and every recorded skip) produces a WorkTrace via submit. The `ScheduledFollowUp` row is operational queue state, not the canonical record of the action.                                            |
| Approval is lifecycle state                               | `approvalPolicy:"none"` is a deliberate product choice (gated-autonomous). The categorical `GovernanceGate` still evaluates on submit; the consent/template gate is the decisive, deterministic control.         |
| Tools are audited, idempotent product surfaces            | The schedule-tool is `idempotent:true` with a dedupe-keyed write; the send handler is keyed by `followup-send:${id}`.                                                                                            |
| Human escalation is first-class                           | Unchanged; `escalate` remains the operator path. Out-of-eligibility sends are recorded skips, not escalations (per your "gated-autonomous, skip-and-record" choice).                                             |
| No mutating bypass paths                                  | The only outbound path is submit→handler. `ProactiveSender` (`proactive-sender.ts`) is **not** used for lead-facing sends (it has no consent check and a non-durable in-memory rate map).                        |

---

## 6. Idempotency & rate model (defense in depth)

Four independent layers, each catching a different failure (seatbelt + airbag + ABS + traction control):

1. **Cron runs twice / overlapping runs** → Inngest `step.run(\`followup-${id}\`)` memoization.
2. **Two workers grab the same row** → atomic `claim` CAS (`pending→sending`, `count===1` wins).
3. **The same follow-up scheduled twice** → `dedupeKey` UNIQUE (`followup:${orgId}:${contactId}:${dayBucket(dueAt)}`).
4. **The same send submitted twice** → `PlatformIngress.submit` keyed replay-guard (`idempotencyKey: followup-send:${id}`).

**Rate guard = ≤1 follow-up per contact per 24h** (the `dayBucket` in the dedupe key + the pending-for-contact guard).

> **⚠️ MVP anti-spam guard, not a permanent business rule.** The `dayBucket`-per-contact ceiling means Alex cannot schedule two _different_ follow-ups for the same day. That is the correct conservative default for launch, but it must be **documented as an MVP guard** so it does not calcify into accidental product behavior. Relaxation path when product asks for it: widen the key to `followup:${orgId}:${contactId}:${reason}:${dayBucket}` (lets genuinely-distinct reasons coexist) or move to a finer time bucket — both are localized changes to the key derivation, no schema change.

---

## 7. Producer-population / activation (fails closed — by design)

The mechanism ships fully built + tested, but **sends nothing in production until the template data is populated** — verified at `file:line`:

- **Every** template in `WHATSAPP_TEMPLATES` is `approvalStatus:"draft"` today, and the re-engagement entries `re_engagement_offer_sg_v1` / `_my_v1` (`whatsapp-registry.ts:188-217`) are **both `draft` and `marketing`** ⇒ double-blocked at runtime (`template_not_approved` then `marketing_blocked`).

This is the _desired_ posture: you can deploy the entire system and **no customer is accidentally messaged**. Sending begins only when **all** of these producer conditions hold:

1. Meta approves `alex_re_engagement_offer_{sg,my}_v1`, and `approvalStatus` is flipped to `"approved"` in `whatsapp-registry.ts`.
2. Per-deployment `allowMarketingTemplate` is enabled (the marketing-substitution flag).
3. The contact is opted-in (`messagingOptIn`) or inside the 24h window, **and** PDPA-`granted`/`not_applicable`.

This matches the existing Meta-gated template-wiring blocker already tracked for launch. The spec carries this as an explicit **activation checklist**, and the helper records the precise `skipReason` per attempt (no silent caps), so the inert-but-safe state is observable. No new org-enablement flag is introduced — the template-approval state _is_ the fail-closed enablement gate.

---

## 8. Testing strategy (TDD, real-producer-driven)

- **Schedule-tool** (`schedule-follow-up.test.ts`): trusted-ctx sourcing (IDs from `ctx`, never params), `MISSING_CONTACT` fail-closed, `dueAt` per `delay` enum, dedupe/rate-guard returns `already_scheduled`, write shape. Mock deps + literal `SkillRequestContext` (mirror `delegate.test.ts`/`escalate.test.ts`).
- **Eligibility helper** (`proactive-eligibility.test.ts`): each block reason (`consent_pending`, `consent_revoked`, `no_optin`, `no_template`, `template_not_approved`, `marketing_blocked`) **driven from real registry defaults** — this test proves today's all-`draft` reality ⇒ blocked — plus the eligible happy path against a fixture-approved template.
- **Send handler** (`conversation-followup-send-workflow.test.ts`): eligible ⇒ template POST (mock `fetch`) ⇒ `completed`/`sent`; ineligible ⇒ `completed`/`sent:false`+`skipReason`; HTTP failure ⇒ `failed`; unsupported channel ⇒ skip.
- **Cron executor** (`scheduled-follow-up-dispatch.test.ts`): due-query selection, claim CAS (concurrent double-claim → one wins), `submitFollowUpSend` called per item, result mapping (sent/skipped/failed/backoff), MAX-attempts exhaustion. Mirror `lead-retry.test.ts`; drive the pure `executeScheduledFollowUpDispatch` directly (no Inngest).
- **Store** (`prisma-scheduled-follow-up-store.test.ts`): mocked Prisma (CI has no Postgres; mirror `prisma-workflow-store.test.ts`), incl. `claim` `count===0`/`count===1` branches and the P2002 dedupe path.
- **Whole-PR fail-closed integration:** drive the cron → real eligibility helper → real registry defaults, asserting **every due follow-up is skipped with a template reason** under today's data — the producer-population proof that the gate is wired, not just present.

---

## 9. File-by-file change list

**`packages/schemas`**

- `scheduled-follow-up.ts` (new): `FollowUpReason`, `FollowUpDelay`, `ProactiveSkipReason`, row Zod type.

**`packages/db`**

- `prisma/schema.prisma`: `ScheduledFollowUp` model + migration (hand-written; `db:check-drift`).
- `src/stores/prisma-scheduled-follow-up-store.ts` (new) + test.

**`packages/core`**

- `skill-runtime/tools/schedule-follow-up.ts` (new) + test; export from `skill-runtime/tools/index.ts`.
- `skill-runtime/scheduled-follow-up-store.ts` (new): store interface (core seam).
- `notifications/proactive-eligibility.ts` (new) + test; promote pure `isWithinWhatsAppWindow`/`canSendWhatsAppTemplate` window helpers into core.

**`apps/chat`**

- `src/adapters/whatsapp.ts`: re-export the promoted window helpers from core (no behavior change).

**`apps/api`**

- `src/services/workflows/conversation-followup-send-workflow.ts` (new) + test.
- `src/services/cron/scheduled-follow-up-dispatch.ts` (new) + test.
- `src/bootstrap/contained-workflows.ts`: register `conversation.followup.send` (handler map + IntentRegistry).
- `src/bootstrap/skill-mode.ts`: register `follow-up` in `toolFactories` + `toolsMap` (exclude from simulation maps); construct the store + thread/contact reader deps.
- `src/bootstrap/inngest.ts`: register the dispatch cron + deps block + `submitFollowUpSend` closure.

**`skills/alex`**

- `SKILL.md`: add `follow-up` to `tools:`; add a "when to use" instruction.

**Env**

- Reuses `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` (already used by the greeting workflow). If any **new** env var is introduced, add it to `scripts/env-allowlist.local-readiness.json` (CI lint+test both fail otherwise).

---

## 10. Open questions for the plan (none block the design)

1. **Per-deployment `allowMarketingTemplate` flag source.** Where does the marketing-allow flag live for a re-engagement send — the existing `alexMedspaSgMyGovernanceV1.whatsappWindow.allowMarketingTemplateSubstitution`, or a dedicated follow-up config key? (Plan-level; the helper takes it as a boolean parameter.)
2. **Thread/contact reader for the tool.** Exact store/port the schedule-tool uses to resolve `channel`/`jurisdiction`/`threadId` from `ctx` (reuse an existing thread store vs a thin reader). Plan decision.
3. **`submitFollowUpSend` shape.** Confirm a top-level submit closure (no parent) vs reusing an existing adapter. Plan decision; `createSubmitChildWork` (`contained-workflows.ts:37`) is the template.
4. **`MAX` attempts + backoff constants** for transient send failures (start: `MAX=3`, `BASE=15min`, `CAP=24h`, mirroring `lead-retry`).

```

```
