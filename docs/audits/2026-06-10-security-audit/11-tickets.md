# Switchboard Security Audit — Engineering Tickets

_Drafted 2026-06-10 from the read-only audit (`02-findings-and-priorities.md`). Each block is a self-contained ticket: copy one into your tracker or hand it to a developer. "Done when" is the acceptance test that proves the fix._

Priority key: 🔴 before live-patient pilot · 🟠 fix soon · 🟡 track/decide.

---

## 🔴 F1 — Workflow routes leak data across clinics

**Labels:** security, tenant-isolation, priority:high
**Impact (business):** One clinic can read — and cancel or approve — another clinic's automation workflows and approval checkpoints, just by knowing an ID. Cross-clinic data exposure.
**Where:** `apps/api/src/routes/workflows.ts:28-33, 71-76, 127-132`; underlying bare-id reads `packages/db/src/stores/prisma-workflow-store.ts:104, 254`.
**Root cause:** Ownership is checked only inside `if (request.query.organizationId)` — an _optional, client-supplied_ URL parameter. Omit it and there is no check. The routes never consult the authenticated org (`request.organizationIdFromAuth`).
**Fix:**

1. Add the `requireOrg` guard to these routes.
2. Derive the org from `request.organizationIdFromAuth`, not the query string.
3. Make the ownership comparison mandatory (delete the `if (request.query.organizationId)` condition).
4. Ideally push `organizationId` into the store read signatures so the boundary can't be forgotten again.
   **Done when:** an automated test shows that a caller authenticated as Clinic A receives 404 when requesting (and when trying to cancel/resolve) a workflow/checkpoint owned by Clinic B.
   **Effort:** Small (one route file + a test).

---

## 🔴 F2 — Ad-account / calendar OAuth endpoints skip the ownership check

**Labels:** security, tenant-isolation, credentials, priority:high
**Impact (business):** One clinic can list another clinic's Meta ad accounts and Google calendars; the server decrypts and uses the other clinic's stored tokens to do it. (The raw token isn't returned, but it's a confidentiality breach and a missing-authorization hole.)
**Where:** `apps/api/src/routes/facebook-oauth.ts:154-200` (`/facebook/:deploymentId/accounts`) and `apps/api/src/routes/google-calendar-oauth.ts:230-269` (`/google-calendar/:deploymentId/calendars`). Both have zero references to `organizationIdFromAuth`.
**Root cause:** `deploymentId` comes straight from the URL; `findByDeploymentAndType(deploymentId, …)` has no org filter; credentials are decrypted and used with no ownership check. `deploymentId` leaks in dashboard redirect URLs (`facebook-oauth.ts:140`).
**Fix:** Before using the connection, load the deployment and return **403 unless `deployment.organizationId === request.organizationIdFromAuth`**. The correct pattern already exists at `apps/api/src/routes/marketplace.ts:531-538` — mirror it. Also add org-scoped read variants to `packages/db/src/stores/prisma-deployment-connection-store.ts:29,35` so the bare-`deploymentId` reads aren't reachable.
**Done when:** a test shows a caller authenticated as Clinic A gets 403 when passing Clinic B's `deploymentId` to either endpoint.
**Effort:** Small.

---

## 🔴 F3 — "Verified payment" revenue can be forged

**Labels:** security, data-integrity, money, priority:high
**Impact (business):** Anyone holding a clinic's API key can record a fake **verified** deposit and emit a matching Meta "purchased" conversion — with no real charge — because the system trusts a caller-supplied `provider` label instead of checking the payment processor. This pollutes your proof-of-value/attribution numbers and Meta's ad optimization; if billing ever becomes performance-based, it's fraud. (Re-opens CRITICAL #1 from the 2026-06-05 receipted-bookings audit.)
**Where:** `apps/api/src/payments/resolve-payment-tier.ts:20-25` (returns `verified:true` for any provider ≠ `"noop"`); `apps/api/src/bootstrap/operator-intents/record-verified-payment.ts:42-44` (trusts `params.provider`, **no PSP fetch-back** — the file comment claiming a fetch-back is false); reachable via `apps/api/src/routes/ingress.ts:12,37-47`; auto-approved at `apps/api/src/bootstrap/operator-intents.ts` and short-circuited at `packages/core/src/platform/governance/governance-gate.ts:100-108`.
**Fix:**

1. Derive `verified` from a **server-side** `retrievePayment(externalReference)` call against the real PSP, not from `params.provider`.
2. Restrict the `payment.record_verified` intent to a service/system actor or to the HMAC-protected webhook route only (so a normal user actor via `/ingress/submit` cannot invoke it).
   **Done when:** a test shows that submitting `payment.record_verified` as a user actor with a fabricated `provider`/`externalReference` does **not** produce a `verified:true` revenue row; only the genuine PSP-verified webhook path can.
   **Effort:** Medium. **Do alongside F11.**

---

## 🔴 F5 — Deleting a patient doesn't delete everything (PDPA right-to-erasure)

**Labels:** privacy, pdpa, priority:high
**Impact (business):** After a deletion request, the patient's raw messages and phone survive in the dead-letter queue and the audit log, and their Google Calendar booking is never cancelled. "We deleted your data" would currently be untrue.
**Where:** cascade `packages/db/src/stores/prisma-contact-store.ts:177-219`; handler `apps/api/src/routes/meta-deletion.ts:88-91`. Omitted stores: `FailedMessage` (DLQ, keyed by org not contact), `WorkTrace` (has `contactId`), and the external Google Calendar event.
**Fix:** Extend the deletion path to also (a) purge `FailedMessage` rows matching the patient's phone, (b) delete `WorkTrace` rows by `contactId`, and (c) call `GoogleCalendarAdapter.cancelBooking()` for the patient's bookings.
**Done when:** a test shows that after deleting a contact, no `FailedMessage`/`WorkTrace` rows reference that patient and the calendar `cancelBooking` call was made.
**Effort:** Medium. **Pairs with F6.**

---

## 🔴 F6 — Dead-letter queue has no retention/purge (PDPA)

**Labels:** privacy, pdpa, retention, priority:high
**Impact (business):** Every inbound message that ever failed to process — full text + phone number — is kept forever. PDPA requires you not to retain personal data longer than needed.
**Where:** `apps/chat/src/dlq/failed-message-store.ts:37` (stores `rawPayload` verbatim); the only cleanup `sweepExhausted` at `:94-112` flips a status flag and never deletes. No retention job exists in `apps/api/src/services/cron/`.
**Fix:** Add a scheduled purge (e.g. delete `FailedMessage` rows with status resolved/exhausted older than N days) and document the retention window. Consider an `expiresAt` column.
**Done when:** a scheduled job deletes aged DLQ rows and a test verifies rows past the window are removed.
**Effort:** Small.

---

## 🟠 F4 — Nothing in code prevents a money-moving action from being auto-approved

**Labels:** security, governance, priority:medium
**Impact (business):** The spend-cap promise ("the agent asks before spending above $X") is enforced only by developer discipline today. The day someone wires Riley's budget-change action the obvious way, it ships with no cap and no human sign-off — and it would pass tests.
**Where:** `packages/core/src/platform/governance/governance-gate.ts:100-108` (auto-approve short-circuits _before_ the spend gate at `:178`); `packages/core/src/platform/intent-registry.ts:7-12` (validates only duplicate names); behaviour pinned by `governance-gate.test.ts:671-687`. This is the prior Riley-audit recommendation **R1**, never implemented.
**Fix:** Add a hard guard so a spend-bearing / financial intent **cannot** be registered with `approvalMode: "system_auto_approved"` — both a check in `IntentRegistry.register()` (throw at startup) and an assertion in `GovernanceGate` (defence in depth).
**Done when:** registering a spend-bearing intent as `system_auto_approved` throws at startup, with a test covering it.
**Effort:** Small–Medium.

---

## 🟠 F7 — `ALLOW_SELF_APPROVAL` has no production guardrail

**Labels:** security, governance, priority:medium
**Impact (business):** A single env flag globally disables "four-eyes" approval (lets the person who created an action approve it). Unlike the other dev flags, nothing stops it being switched on in production.
**Where:** `apps/api/src/app.ts:830`, `apps/api/src/routes/approvals.ts:163`, `apps/api/src/routes/internal-chat-approvals.ts:60`.
**Fix:** Refuse `ALLOW_SELF_APPROVAL=true` when `NODE_ENV==="production"` unless paired with an explicit acknowledgement flag — mirror the existing `assertSafeDashboardAuthEnv()` hard-fail used for `DEV_BYPASS_AUTH`.
**Done when:** a production boot with `ALLOW_SELF_APPROVAL=true` and no ack flag throws at startup.
**Effort:** Tiny.

---

## 🟠 F8 — Delegation rules are loaded across all clinics

**Labels:** security, tenant-isolation, priority:medium
**Impact (business):** An approval-authorization check considers every clinic's delegation rules, not just the relevant clinic's. Narrow to exploit, but the isolation guarantee is broken.
**Where:** `packages/db/src/storage/prisma-identity-store.ts:130-131` ignores its `organizationId` argument and does `findMany()` with no filter. The in-memory store shows the intended behaviour (`packages/core/src/storage/in-memory.ts:202-209`).
**Fix:** Filter by the grantor's org: `findMany({ where: { grantor: { organizationId } } })`.
**Done when:** a test shows `listDelegationRules(orgA)` returns only Clinic A's rules.
**Effort:** Small.

---

## 🟠 F9 — WhatsApp signature checked against a rebuilt copy of the message (can drop real messages)

**Labels:** reliability, webhooks, priority:medium
**Impact (business):** Legitimate inbound WhatsApp messages can be silently rejected, so the channel quietly stops working. (Not a forgery hole — it fails safe — but a reliability bug.)
**Where:** `apps/chat/src/routes/managed-webhook.ts:94-96` computes the HMAC over `JSON.stringify(request.body)` because the chat app registers no raw-JSON body parser (`apps/chat/src/main.ts:69-70`). The re-serialized bytes may not match what Meta signed.
**Fix:** Register `fastify-raw-body` for JSON on the chat app (mirror the API side) and verify the HMAC against the true raw bytes.
**Done when:** a real Meta WhatsApp payload verifies successfully, including a payload whose naive re-serialization would differ (key order / unicode escaping).
**Effort:** Small.

---

## 🟠 F10 — Phone numbers written to logs (PDPA)

**Labels:** privacy, pdpa, logging, priority:medium
**Impact (business):** Patient phone numbers appear in application logs, including on the deletion endpoint's error path. Widens the exposure surface (log sinks, support staff).
**Where:** `packages/core/src/notifications/proactive-sender.ts:136`; `apps/api/src/routes/meta-deletion.ts:93,115`.
**Fix:** Hash or truncate (last-4) the phone number in these log lines; keep the org id / trace id for debuggability.
**Done when:** a grep of these paths shows no full phone numbers logged.
**Effort:** Tiny.

---

## 🟠 F11 — `/api/ingress/submit` accepts an unvalidated body

**Labels:** security, hardening, priority:medium
**Impact (business):** The one mutating endpoint with no input validation — and the same door that makes F3 reachable.
**Where:** `apps/api/src/routes/ingress.ts:17-47` (casts `request.body`, only checks `!body.intent`).
**Fix:** Add a Zod schema and `safeParse` the body like the sibling routes (`actions`, `execute`, `recommendations/act`, `approvals`); restrict which actors/intents the raw route accepts.
**Done when:** a malformed/over-shaped body returns 400; tests cover it. **Do alongside F3.**
**Effort:** Small.

---

## 🟠 F12 — Local-calendar booking path can double-book

**Labels:** data-integrity, bookings, race-condition, priority:medium
**Impact (business):** For a clinic configured with business hours but no Google Calendar connected (a real pilot setup), two simultaneous requests can book the same slot for two different patients.
**Where:** `apps/api/src/bootstrap/calendar-provider-factory.ts:159-208` (overlap-check-then-insert with **no advisory lock**); double-write via `packages/core/src/skill-runtime/tools/calendar-book.ts:272,321` + `packages/core/src/calendar/local-calendar-provider.ts:89`.
**Fix:** Route the local provider's persistence through the locked `PrismaBookingStore` (which already uses `pg_advisory_xact_lock` + the partial-unique index), or add the same advisory lock + current-row exclusion to `createInTransaction`.
**Done when:** a concurrency test shows two simultaneous local-calendar bookings for the same slot result in exactly one success and one conflict.
**Effort:** Medium.

---

## 🟡 F13 — Creative-video jobs do two writes without a transaction

**Labels:** reliability, jobs, priority:low
**Impact:** A crash between two writes can leave a creative marked "complete" with no publishable asset. Self-heals on retry and publish is blocked (never mis-published), so low severity.
**Where:** `packages/creative-pipeline/src/creative-job-runner.ts:132,141`; UGC variant `…/ugc/ugc-job-runner.ts:301,313`.
**Fix:** Write `currentStage="complete"` and `durableAssetUrl` in a single update, or order the asset write before flipping to "complete."
**Done when:** no "complete-without-asset" state is reachable by a crash between the two writes.
**Effort:** Small.

---

## 🟡 F14 — Meta token refresh can keep a stale token silently

**Labels:** reliability, observability, priority:low
**Impact:** Fails safe (token still valid, next run repairs, status flips to needs-reauth), but a persistently failing org is never alerted.
**Where:** `apps/api/src/services/cron/meta-token-refresh.ts:70-83`; the `notifyOperator` hook is never wired and the job is `alert:false`.
**Fix:** Wire the operator alert / set the job's failure class so retry-exhaustion pages someone.
**Done when:** a persistently failing refresh raises an operator alert.
**Effort:** Small.

---

## 🟡 F15 — DECISION: should consent be a hard precondition for messaging/booking?

**Labels:** product-decision, privacy, pdpa, priority:low
**Impact:** Today consent is _stored_ but not _enforced_ — booking never checks it, and the consent gate defaults to "off/observe" (records, doesn't block). This may be fine or may be a PDPA requirement; it's a decision, not a bug.
**Where:** `packages/core/src/skill-runtime/tools/calendar-book.ts` (no consent read); `packages/core/src/skill-runtime/hooks/pdpa-consent-gate.ts` (defaults off/observe).
**Action:** Decide, with your PDPA position, whether consent must hard-gate messaging and/or booking before launch. If yes, raise an implementation ticket to enforce it server-side as a precondition.
**Done when:** decision recorded (and implemented if "yes").
**Effort:** Decision + (if yes) Medium.

---

## 🟡 F16 — Dependency advisories: patch + name the critical

**Labels:** dependencies, hygiene, priority:low
**Impact:** 14 advisories (1 active critical, 1 suppressed, 11 moderate, 1 low), almost all in third-party libraries (Meta/Google SDK stack, dev tools), not first-party code.
**Action:**

1. Run `pnpm update` (and `pnpm audit --fix` where safe) — most have patches (`ws ≥8.20.1`, `hono ≥4.12.21`, `qs ≥6.15.2`, `uuid ≥11.1.1`, `turbo ≥2.9.14`, `protobufjs ≥7.5.8`).
2. Run `pnpm audit` interactively to **name the active critical** (the tool counts it but doesn't print it) and confirm it isn't on a production path.
3. Document why `GHSA-5xrq-8626-4rwp` is suppressed in `package.json → auditConfig.ignoreGhsas`.
   **Done when:** criticals named and resolved/justified; moderates on the production path patched.
   **Effort:** Small.

---

_16 tickets. Suggested sprint-1 = the five 🔴 (F1, F2, F3, F5, F6). F1 and F2 are the smallest and highest-leverage — good first issues._
