# F-15: managed-channel chat→API ingress hop sends no Authorization header at prod defaults — every message 401s and falls back to "I'm having trouble"

- **Severity:** blocks-pilot
- **Journey/step:** J3-S3 (booking conversation — skill dispatch)
- **Verdict:** BROKEN (exercised live; `/api/ingress/submit` returned 401 "Missing Authorization header")
- **Location:**
  - Producer (no header): `apps/chat/src/main.ts:74` — `const apiKey = process.env["SWITCHBOARD_API_KEY"]`; `:75` constructs `HttpPlatformIngressAdapter(apiUrl, apiKey)`.
  - `apps/chat/src/gateway/http-platform-ingress-adapter.ts:19-21` — sets `Authorization: Bearer …` ONLY `if (this.apiKey)`. When unset, the POST to `/api/ingress/submit` carries no auth header.
  - Consumer (401): `apps/api/src/routes/ingress.ts:12` (`/ingress/submit`, `preHandler: requireOrgForMutation`) → `apps/api/src/middleware/auth.ts:143-144` rejects with `401 "Missing Authorization header"` (the path is NOT in the auth-skip allowlist at `auth.ts:122-141`).
  - Valid-key source the chat key would need to match: `auth.ts:208-211` — `dashboardUser.apiKeyHash` (SHA-256 of the key), or static `API_KEYS`/`API_KEY_METADATA`.
  - Prod default: `.env.example` has `SWITCHBOARD_API_KEY=` (empty). The audit worktree `.env` likewise has no `SWITCHBOARD_API_KEY` (only `INTERNAL_API_SECRET`, which is a DIFFERENT secret used by the chat-approval bridge, not this ingress hop).
    (verified against `audit/pilot-spine` worktree, 2026-06-08)

## What was exercised

After bridging F-13 (D-03) and F-14 (D-03c), I injected a Telegram inbound for the audit org. The deployment resolved, the Contact + ConversationThread were created, the inbound was persisted, and the gateway called `platformIngress.submit` → the HTTP adapter POSTed to `http://localhost:3000/api/ingress/submit` with no Authorization header. API log:

```
[HttpPlatformIngress] API error 401: {"error":"Missing Authorization header","statusCode":401}
```

The submit returned `{ ok: false, error: { type: "validation_failed" } }`, so the gateway sent the framework fallback "I'm having trouble right now. Let me connect you with the team." (`channel-gateway.ts:127`/`:136`). The Telegram send then 400'd ("chat not found") because the recipient is synthetic (expected per the audit's synthetic-inbound posture). Artifact: `evidence/j3-inbound-routing-broken.txt` (third injection block).

## What happened vs expected

Expected: the chat server authenticates to the API with an org-scoped key so the skill runs and Alex replies. Observed: at prod defaults the chat server has no API key, so EVERY managed-channel message fails the API auth gate and the customer always receives the generic "having trouble" fallback — the skill (Alex's LLM, booking tools, governance) never runs. The pilot conversation loop is dead even past F-13/F-14.

This is the third of three independent prod-default blockers on the managed-channel inbound spine (F-13 routing, F-14 contact FK, F-15 ingress auth). It shares a root cause family with F-03 (`INTERNAL_API_SECRET` unset breaks channel `active` resolution): the chat↔API trust wiring depends on operator-set secrets that are empty by default and have no provisioning producer.

## Suggested fix scope

Provision and inject `SWITCHBOARD_API_KEY` (an org-scoped key whose hash is stored on a service `DashboardUser.apiKeyHash`, or a static `API_KEYS`+`API_KEY_METADATA` entry) as part of deploy config, and document it in `.env.example`/the launch runbook as a REQUIRED secret (not blank). Consider failing chat boot loudly when `DATABASE_URL` is set (managed-channel mode) but `SWITCHBOARD_API_KEY` is empty, mirroring the API's own "API_KEYS required in production" startup guard (`auth.ts:64-68`). Add an integration test that runs a managed inbound end-to-end against an authed API and asserts a non-fallback reply.

## Cross-reference

Same secret-provisioning gap family as F-03. Sits downstream of F-13 + F-14 on the Telegram pilot spine; all three must be fixed for a self-serve Telegram pilot to function.
