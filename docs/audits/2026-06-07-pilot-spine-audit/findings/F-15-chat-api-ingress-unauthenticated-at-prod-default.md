# F-15: `SWITCHBOARD_API_KEY` not provisioned in deploy config — chat-to-API ingress hop sends no Authorization header, so `/api/ingress/submit` 401s on every managed-channel message

- **Severity:** blocks-pilot (by-config, all-channel, launch-checklist) — same config-gap family as F-03; adapter code is correct when the key is set
- **Journey/step:** J3-S3 (booking conversation — skill dispatch)
- **Verdict:** BROKEN at prod defaults (exercised live; `/api/ingress/submit` returned 401 "Missing Authorization header") — **this is a deployment-config / launch gap, NOT a code bug in the adapter**
- **Scope:** all-channel — hits WhatsApp and Telegram equally; the missing env var is channel-agnostic
- **Location (config gap, not code bug):**
  - Adapter code (correct): `apps/chat/src/gateway/http-platform-ingress-adapter.ts:19-21` — sets `Authorization: Bearer <key>` only `if (this.apiKey)`. When the key is set, the code works correctly.
  - Key source: `apps/chat/src/main.ts:74-75` — reads `process.env["SWITCHBOARD_API_KEY"]`; passes it to `HttpPlatformIngressAdapter(apiUrl, apiKey)`.
  - Gap 1 — default empty: `.env.example:146` has `SWITCHBOARD_API_KEY=` (blank); no default value is shipped.
  - Gap 2 — not in deploy config: `render.yaml` `switchboard-chat` service (lines 149-213) defines no `SWITCHBOARD_API_KEY` entry — the key is simply absent from the deploy manifest, so a fresh Render deploy silently omits it.
  - Gap 3 — no matching API_KEYS on api side: `render.yaml` `switchboard-api` service likewise defines no `API_KEYS` or `API_KEY_METADATA` entry. The API auth gate at `apps/api/src/middleware/auth.ts:208-211` validates the key against `dashboardUser.apiKeyHash` (SHA-256 of the key) or static `API_KEYS`/`API_KEY_METADATA`; neither is provisioned for the chat service in the deploy config.
  - Consumer (401): `apps/api/src/routes/ingress.ts:12` (`/ingress/submit`, `preHandler: requireOrgForMutation`) -> `apps/api/src/middleware/auth.ts:143-144` rejects with `401 "Missing Authorization header"` (the path is NOT in the auth-skip allowlist at `auth.ts:122-141`).
    (verified against `audit/pilot-spine` worktree, 2026-06-08)

## This is a config gap, not a code bug

The adapter at `http-platform-ingress-adapter.ts:19-21` is correctly written: it sends the `Authorization` header when the key is present. The defect is that:

1. The key is blank in `.env.example` with no guidance that it is REQUIRED in managed-channel mode.
2. The `render.yaml` `switchboard-chat` service omits the `SWITCHBOARD_API_KEY` entry entirely — a fresh deploy has no key set.
3. The `render.yaml` `switchboard-api` service has no corresponding `API_KEYS` / `API_KEY_METADATA` entry — even if the chat service sets a key, the API has nowhere to validate it (short of creating a `DashboardUser` with `apiKeyHash` out-of-band).

The fix is provisioning — not rewriting the adapter. This is in the same family as F-03 (`INTERNAL_API_SECRET` unset), where the chat-to-API trust wiring depends on operator-set secrets that are empty by default with no provisioning producer.

## What was exercised

After bridging F-13 (D-03) and F-14 (D-03c), I injected a Telegram inbound for the audit org. The deployment resolved, the Contact + ConversationThread were created, the inbound was persisted, and the gateway called `platformIngress.submit` -> the HTTP adapter POSTed to `http://localhost:3000/api/ingress/submit` with no Authorization header. API log:

```
[HttpPlatformIngress] API error 401: {"error":"Missing Authorization header","statusCode":401}
```

The submit returned `{ ok: false, error: { type: "validation_failed" } }`, so the gateway sent the framework fallback "I'm having trouble right now. Let me connect you with the team." (`channel-gateway.ts:127`/`:136`). The Telegram send then 400'd ("chat not found") because the recipient is synthetic (expected per the audit's synthetic-inbound posture). Artifact: `evidence/j3-inbound-routing-broken.txt` (third injection block).

Note: this finding was reached on the Telegram path only because F-13/F-14 block Telegram earlier (and were bridged for testing). The 401 gap is channel-agnostic — the same `SWITCHBOARD_API_KEY` omission would cause the same 401 on an otherwise-working WhatsApp inbound.

## What happened vs expected

Expected: the chat server authenticates to the API with an org-scoped key so the skill runs and Alex replies. Observed: at prod defaults the chat server has no API key, so EVERY managed-channel message fails the API auth gate and the customer always receives the generic "having trouble" fallback — the skill (Alex's LLM, booking tools, governance) never runs regardless of channel.

## Required fix (launch-checklist items)

The fix is purely provisioning + documentation:

1. **`render.yaml` `switchboard-chat`**: add `SWITCHBOARD_API_KEY` with `sync: false` so the operator is prompted to enter a value at deploy time.
2. **`render.yaml` `switchboard-api`**: add `API_KEYS` and `API_KEY_METADATA` with `sync: false` (or document the `DashboardUser.apiKeyHash` provisioning path) so the API can validate the key the chat service sends.
3. **`.env.example`**: mark `SWITCHBOARD_API_KEY` as REQUIRED when `DATABASE_URL` is set (managed-channel mode), with a note describing how to generate and register the matching key on the API side.
4. **Boot guard (recommended)**: fail chat boot loudly when `DATABASE_URL` is set but `SWITCHBOARD_API_KEY` is empty, mirroring the API's own "API_KEYS required in production" startup guard (`auth.ts:64-68`). This is a code-side improvement, but not the root cause of the gap.
5. **Integration test (recommended)**: run a managed inbound end-to-end against an authed API and assert a non-fallback reply.

## Cross-reference

Same secret-provisioning gap family as F-03. Unlike F-13/F-14 (Telegram-only), this gap hits ALL channels including WhatsApp — it is the one J3-S3 blocker that directly threatens the WhatsApp pilot. Once F-15 is resolved (key provisioned), WhatsApp inbound should flow end-to-end without hitting F-13 or F-14 (which are Telegram-only by code read).

## Resolution (2026-06-08)

Fixed on `fix/f-15-chat-ingress-auth`. While implementing the recommended fix, the literal
"provision a single `SWITCHBOARD_API_KEY` + matching `API_KEYS`" path was found to be
multi-tenant-incorrect: the API derives the org from the auth key (`requireOrgForMutation`
sets `request.orgId = organizationIdFromAuth`, and `resolveAuthoritativeDeployment` resolves
the deployment via `resolveByOrgAndSlug(request.organizationId, ...)`), and a static API key
is single-org by construction (`auth.ts:82-98` refuses to boot on an unscoped key). One
org-scoped key on the shared, multi-tenant chat service would route every tenant's inbound
to one org. The audit did not surface this because it exercised only the single audit org.

Shipped instead: the chat-to-API ingress hop authenticates as a trusted internal service via
`INTERNAL_API_SECRET` (already provisioned on both Render services) on a new
`POST /api/internal/ingress/submit` route that honors the chat-resolved `body.organizationId`
and still flows through `PlatformIngress.submit` (entitlement + GovernanceGate + idempotency
unchanged; not a bypass). The chat adapter is re-tiered to that route, and a chat boot guard
fails fast when `DATABASE_URL` is set but `INTERNAL_API_SECRET` is empty. The fix also carries
`contactId`/`conversationThreadId` (Spec-1A lineage) through the hop, which the old route
dropped. F-15 alone yields working, authenticated inbound that still default-denies until
F-16/F-02 land (expected). Design + plan:
`docs/superpowers/specs/2026-06-08-f-15-chat-ingress-auth-design.md`,
`docs/superpowers/plans/2026-06-08-f-15-chat-ingress-auth.md`.
