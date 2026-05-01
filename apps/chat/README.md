# @switchboard/chat

Multi-channel chat server (Telegram, WhatsApp, Instagram/Messenger, Slack). Runs on port 3001.

## Webhook secrets and failure modes

Every webhook adapter requires a signing/verification secret. Missing secrets
fail **closed** in production (incoming requests are rejected with 401), and
log a loud `console.error` at adapter initialization. Dev mode (`NODE_ENV !==
"production"`) is more permissive so local development is not blocked, but
emits a warning on every unverified request.

| Channel               | Required env var          | Header / scheme                                   | Failure mode (prod, missing secret)              |
| --------------------- | ------------------------- | ------------------------------------------------- | ------------------------------------------------ |
| Telegram              | `TELEGRAM_WEBHOOK_SECRET` | `X-Telegram-Bot-Api-Secret-Token`                 | `verifyRequest` returns `false` → 401            |
| WhatsApp Cloud API    | `WHATSAPP_APP_SECRET`     | `X-Hub-Signature-256` (HMAC-SHA256)               | `verifyRequest` returns `false` → 401            |
| Instagram / Messenger | `META_APP_SECRET`         | `X-Hub-Signature-256` (HMAC-SHA256)               | `verifyRequest` returns `false` → 401            |
| Slack                 | `SLACK_SIGNING_SECRET`    | `X-Slack-Signature` + `X-Slack-Request-Timestamp` | `verifyRequest` returns `false` → 401            |
| Stripe (billing)      | `STRIPE_WEBHOOK_SECRET`   | Handled by `stripe` SDK (300s tolerance)          | Construct fails — billing route refuses to start |

Additional verification tokens (used by the Meta GET-verification challenge):

| Channel               | Verify-token env var    | Used by                              |
| --------------------- | ----------------------- | ------------------------------------ |
| WhatsApp              | `WHATSAPP_VERIFY_TOKEN` | `GET /webhook/managed/:id` challenge |
| Instagram / Messenger | `META_VERIFY_TOKEN`     | `GET /webhook/managed/:id` challenge |

## Replay protection

All Meta-family adapters (WhatsApp, Instagram, Messenger) and the Telegram
adapter route inbound webhooks through a `(channel, messageId)` deduplication
cache (`src/dedup/redis-dedup.ts`). The cache is Redis-backed with an
in-memory fallback and a 24-hour TTL. A replayed webhook with the same
`messages[].id` (Meta) or `message_id` (Telegram) returns 200 without
re-invoking the gateway.

Stripe replay protection is handled by the `stripe` SDK's 300-second timestamp
tolerance, plus the `WebhookEventLog` idempotency table for cross-process
deduplication.

## References

- AU-1, AU-2 — `.audit/12-pre-launch-security-audit.md`
- Spec — `docs/superpowers/specs/2026-04-29-fix-launch-webhook-hardening-design.md`
