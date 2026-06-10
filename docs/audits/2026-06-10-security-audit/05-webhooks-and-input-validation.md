# Audit 3 — Webhooks & Input Validation at the Boundary

_Question: can someone forge an inbound message/lead/payment, and is input validated? Read-only._

## Headline: the Meta lead webhook IS verified (the scary Phase-1 claim was wrong)

Phase 1 had a contradiction — one investigator called the lead webhook "open, no auth." **That was a wrong file path, not a real hole.** The real route is `POST /api/marketplace/leads/webhook` (not `/api/webhook/lead`, which doesn't exist). It verifies a timing-safe `X-Hub-Signature-256` HMAC over the raw body with `META_APP_SECRET`, **before** any Contact creation or outbound WhatsApp, and fails closed if the secret is unset (`apps/api/src/routes/ad-optimizer.ts:23-36, 67-77`). It's additionally behind the API-key layer. **Nobody can POST a fake lead.**

## Every public webhook authenticates and fails closed (verified)

| Endpoint                                      | Verified by                         | Timing-safe | Fails closed in prod         | Body validated (Zod)               |
| --------------------------------------------- | ----------------------------------- | ----------- | ---------------------------- | ---------------------------------- |
| Meta lead `/api/marketplace/leads/webhook`    | X-Hub-Signature-256 HMAC            | Yes         | Yes                          | No (guarded type-cast)             |
| Telegram `/webhook/telegram`                  | secret-token header                 | Yes         | Yes                          | No                                 |
| Managed WhatsApp `/webhook/managed/:id`       | X-Hub-Signature-256 HMAC            | Yes         | Yes                          | No                                 |
| Managed Slack `/webhook/managed/:id`          | X-Slack-Signature + 5-min timestamp | Yes         | Yes (throws at construction) | No                                 |
| Stripe billing `/api/billing/webhook`         | Stripe SDK `constructEvent`         | Yes         | Yes                          | SDK-validated                      |
| Payments PSP `/api/webhooks/payments/webhook` | HMAC over raw body                  | Yes         | Yes                          | No (amount re-fetched server-side) |
| Meta deletion `/api/meta/deletion`            | signed_request HMAC                 | Yes         | Yes                          | Partial                            |

The mutating API routes that matter (`actions/propose`, `batch`, `execute`, `recommendations/act`, `approvals/respond`) **all** validate their bodies with Zod `safeParse`. Slack correctly answers its `url_verification` handshake _without_ bypassing signature checks for real events.

## CONFIRMED findings

### F9 — WhatsApp managed-webhook verifies the signature against a re-serialised body — MEDIUM (availability, not forgery)

The chat app registers only a Slack form-encoded body parser — there's **no raw-JSON parser**. So for WhatsApp (which arrives as JSON), the HMAC is computed over `JSON.stringify(request.body)` (`managed-webhook.ts:94-96`), a re-serialisation that isn't guaranteed byte-identical to what Meta signed (key order, Unicode escaping, whitespace can differ). When it diverges, verification fails and **legitimate inbound WhatsApp messages are rejected with 401** — the channel can silently stop working. It is **not** a forgery hole (divergence fails closed). Contrast with the API-side lead webhook, which does it correctly via `fastify-raw-body`. **Fix:** register `fastify-raw-body` for JSON on the chat app and verify against the true raw bytes.

### F11 — `/api/ingress/submit` accepts an unvalidated body — MEDIUM (hardening)

`apps/api/src/routes/ingress.ts:17-47` casts `request.body` and only checks `!body.intent`; `parameters`, `actor`, `targetHint`, `surface` flow into `platformIngress.submit` with no schema. It's the one operator-mutating front door without a `safeParse`, unlike every sibling route. It's still behind API-key auth + `requireOrgForMutation` + a mandatory Idempotency-Key, and downstream handlers validate their own params — so this is defence-in-depth debt. **It is also the exact door that makes F3 (payment forgery) reachable**, so fixing F3's actor restriction and adding a schema here should be done together. **Fix:** add a Zod schema; restrict which actors/intents the raw route accepts.

## Minor notes (low weight)

- **Replay:** Slack enforces a 5-minute timestamp window; other webhooks rely on message-ID dedup + ingress idempotency keys (e.g. `psp-<id>`, `meta-lead-<id>`), which neutralise duplicate side effects. Adequate.
- **Double-gating (informational):** the lead webhook is _also_ behind the API-key middleware (it's not in the auth exclusion list), so in a locked-down prod config Meta's POST could be 401'd at the key layer before reaching the HMAC check. This is over-restrictive, not a hole — but reconcile it (either exclude the path and rely on HMAC like the other Meta/Stripe webhooks, or document that lead intake comes via managed WhatsApp).
- No Content-Type assertions and 4xx errors echo Zod field names — both low risk; production 5xx responses are scrubbed.

## Bottom line

The boundary is in good shape: nobody forges a lead, message, or payment, and signature checks are timing-safe and fail closed. Two things to fix — the WhatsApp raw-body reliability bug (F9, which can silently drop real messages) and the unvalidated ingress route (F11, tied to F3).
