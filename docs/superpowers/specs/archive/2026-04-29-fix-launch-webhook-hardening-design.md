# Fix Launch — Webhook Hardening

**Date:** 2026-04-29
**Status:** Design
**Severity:** HIGH
**Source:** Pre-launch security audit, findings AU-1, AU-2 (`.audit/12-pre-launch-security-audit.md`)

## Problem

Two webhook signature verifiers have HIGH-severity gaps:

- **AU-1**: Meta-family webhook signatures (WhatsApp, Instagram) verify HMAC-SHA256 but do **not** include any timestamp/replay-protection window. A captured webhook payload can be replayed indefinitely. (`apps/chat/src/adapters/whatsapp.ts:97-113`, `apps/chat/src/adapters/instagram.ts:92-…`.)
- **AU-2**: Telegram webhook adapter `verifyRequest` returns `true` (fail-open) when `webhookSecret` is not configured. (`apps/chat/src/adapters/telegram.ts:82-83`.)

Stripe's webhook handler is unaffected — the Stripe library handles replay protection (default 300s tolerance) and `STRIPE_WEBHOOK_SECRET` is required.

The asymmetry between Telegram (fail-open) and WhatsApp/Instagram (fail-closed) is the most jarring issue and the easier of the two to fix.

## Goal

Every webhook handler fails closed if its required secret is unconfigured (in production). Meta-family webhooks gain replay protection via either (a) a deduplication window keyed by `(messageId, timestamp)` or (b) reuse of the existing `WebhookEventLog` idempotency table. Either approach is acceptable; (b) is preferred because the table already exists.

## Approach

### 1. Telegram fail-closed

In `apps/chat/src/adapters/telegram.ts:82-91`:
- Replace `if (!this.webhookSecret) return true;` with:
  - Dev mode (`NODE_ENV !== "production"`): allow with a warning log.
  - Production (`NODE_ENV === "production"`): return `false` (fail-closed).
- Add a constructor-time check: when `NODE_ENV === "production"` and `webhookSecret` is unset, log an error at adapter initialization. Do not throw (other adapters may still be functional), but make the misconfiguration loud.

### 2. Meta-family replay protection

In `apps/chat/src/adapters/whatsapp.ts` and `apps/chat/src/adapters/instagram.ts`:
- Extract the message identifier from the parsed payload (Meta sends a `messages[].id` per inbound message).
- Before processing, check `WebhookEventLog` (or the chat server's local idempotency cache, whichever the surrounding code uses) for a row with `eventId = <messageId>`. If found, return early with 200 (idempotent).
- After successful processing, insert a row into `WebhookEventLog` with the messageId.
- TTL: WebhookEventLog rows can be aged out after 7 days (cron); the audit recommends adding a cleanup job in fix-soon scope, not this spec.

If the surrounding chat code already does this (verify via `rg "WebhookEventLog" apps/chat/src`), this section is a verification-only confirmation. The audit found Stripe uses it; whether WhatsApp/Instagram do is not yet verified.

### 3. Tests

- `apps/chat/src/adapters/__tests__/telegram-fail-closed.test.ts`: `verifyRequest` returns `false` in production with no `webhookSecret`; logs a warning in dev with no secret.
- `apps/chat/src/adapters/__tests__/whatsapp-replay.test.ts`: a webhook with the same `messageId` processed twice produces only one downstream call.
- Same shape for Instagram.

### 4. Documentation

- Update `apps/chat/README.md` (or equivalent operator runbook) with required env vars per channel and the failure mode if missing.

## Acceptance criteria

- Telegram `verifyRequest` fails closed in production with no secret.
- WhatsApp and Instagram adapters skip downstream processing on duplicate `messageId` within the dedup window.
- New tests pass.
- `pnpm test --filter @switchboard/chat` and `pnpm typecheck` green.

## Out of scope

- Webhook signing-secret rotation runbooks — out of scope (mentioned in Section 3 coverage gaps; track separately).
- Webhook IP allowlists — Section 6 coverage gap; out of scope.
- WebhookEventLog cleanup cron — fix-soon scope.

## Verification

- `pnpm test --filter @switchboard/chat` passes including new tests.
- Manual: in a dev environment with `TELEGRAM_BOT_TOKEN` set but `TELEGRAM_WEBHOOK_SECRET` absent, send a Telegram webhook with `NODE_ENV=production` set; confirm 403/401. Replay an Instagram message webhook twice; confirm second is idempotent.
- Audit report's Verification Ledger updated: AU-1, AU-2 marked "shipped" with PR link.
