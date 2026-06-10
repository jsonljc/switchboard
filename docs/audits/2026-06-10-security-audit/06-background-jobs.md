# Audit 4 — Background-Job Correctness (retry safety)

_Question: can an automatic retry double-send a WhatsApp, double-book, double-post a lead, or double-charge? Read-only._

## The load-bearing fact: ingress is claim-first idempotent

`PlatformIngress.submit()` is idempotent on `(organizationId, idempotencyKey)` (`packages/core/src/platform/platform-ingress.ts:108-481`): a terminal trace returns the cached result without re-executing; an in-flight claim fails closed; a database unique constraint (`@@unique([organizationId, idempotencyKey])`) makes concurrent claims race-safe. There is **no `system`-actor bypass** of this. This single mechanism is what neutralises the double-send and double-post risks below.

## CONFIRMED-SAFE (the worrying claims, verified)

- **No double-charge (REFUTED as possible).** A repo-wide search for money-movement creation found only checkout-_session_ creation (a payment link), both request-driven and Stripe-idempotency-keyed — and **neither is called from any job**. Actual charges arrive _inbound_ via the Stripe webhook. The only Stripe call in a cron is a read-then-write reconciliation (idempotent). A retried job cannot create a charge.
- **No double-send of reminders/follow-ups.** Both senders check a dedup key + terminal status _before_ sending (`appointment-reminder-dispatch.ts:60-114`, `scheduled-follow-up-dispatch.ts:64-121`), backed by a `@unique` dedup column. The WhatsApp send routes through the idempotent ingress keyed on the reminder/follow-up id, so even a crash between "send" and "mark sent" re-enters the cache on retry — it does not re-hit the Graph API.
- **No duplicate lead Contact/greeting.** `lead-retry` carries an idempotency key (`leadgen:<id>`), the Contact table dedups on `(org, idempotencyKey)`, and the retry cron sends **no greeting at all** (greetings are a separate, duplicate-gated path). Triple-protected.

## CONFIRMED findings (both low/contained, both fail-safe)

### F13 — Creative video jobs do two non-transactional writes — LOW–MEDIUM

In `creative-job-runner.ts` (and the UGC variant), the final production stage writes `currentStage="complete"` (`:132`) and then `durableAssetUrl` (`:141`) as **two separate DB writes, no transaction, complete-flag first.** A crash in between leaves a creative marked complete with no publishable asset. **Mitigations:** Inngest replays the step and re-writes the asset on retry (self-heal); and the publish precondition requires _both_ fields, so such a row is **blocked from publishing, never mis-published** (`creative-publish-preconditions.ts:61-78`). So this is an under-completed write, not a double-action or a corruption. **Fix:** write both fields in one update, or order the asset write before flipping to "complete."

### F14 — Meta token refresh can keep a stale token silently — LOW

If Meta returns a new token but the DB write fails, the old token persists (`meta-token-refresh.ts:70-83`). This is **fail-safe**: refresh runs 7 days before expiry and the next daily run retries; the failure mode is "token not refreshed," recoverable by re-auth, never a wrong/duplicated action. The real gap is **observability** — the job is `alert:false` and its `notifyOperator` hook is never wired, so a persistently failing org could go unnoticed until a downstream Meta call 401s. **Fix:** wire the operator alert.

## Failure handling

Every job with retries has an `onFailure` handler (`async-failure-handler.ts:84-149`) that records a dead-letter audit entry and, for critical/customer-facing jobs, raises an operator alert — consistent with the architecture's §7 contract. The customer-facing senders (reminders, follow-ups, lead-retry) correctly carry `alert:true`. The two soft spots are the unalarmed token-refresh (F14) and the creative runners (F13).

## Bottom line

The double-action classes you'd worry about most — double-charge, double-message, double-lead — are genuinely prevented, thanks to claim-first idempotency. The only residual is the creative pipeline's two-write completion (F13), which fails safe (publish blocked, never corrupted). Nothing here blocks a pilot; fix F13/F14 as hygiene.
