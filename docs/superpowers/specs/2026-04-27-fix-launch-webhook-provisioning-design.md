# Fix: Launch Webhook Provisioning — Design

Date: 2026-04-27
Branch: `fix/launch-webhook-provisioning`
Source audits: `.audit/07-refactor-plan.md`, `.audit/08-launch-blocker-sequence.md`, `.audit/09-channel-provisioning-trace.md`
Status: Draft — awaiting review

## Goal

Make a self-serve beta org's first channel connection actually work end-to-end: connect → channel reported live → real inbound webhook routed to the right org/deployment, without founder DB edits.

## Customer journey enabled

1. New org signs up.
2. From the dashboard, owner pastes Meta token + phone number ID and clicks Connect.
3. Provision route persists the channel, registers the webhook with Meta, performs a synchronous health check, and notifies the chat server.
4. Dashboard shows the channel as **live** (or shows a clear blocking reason) within one HTTP response cycle.
5. Inbound message from Meta hits `/webhook/managed/:connectionId` on the chat server, resolves to the right org + deployment, and Alex handles it.
6. From day 1 (before any channel is provisioned), the dashboard already lists Alex as available so the org knows what to provision toward.

## Scope (in)

Exactly the six blockers from `08-launch-blocker-sequence.md` items #1–#6:

| #   | Blocker                       | Reality after trace                                                                                                                                                                                                                          | Fix shape                                                                                                                                                                                                                                                                                                              |
| --- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Webhook URL mismatch          | All current call sites use `/webhook/managed/:id`. The mismatch the original audit named is **not present in code today**.                                                                                                                   | Add a **regression test** that pins the format end-to-end (provision route output ↔ chat server route pattern). No code change.                                                                                                                                                                                        |
| 2   | WhatsApp ESU routes           | Routes are registered (`bootstrap/routes.ts:63-92`) but no integration test proves the flow. UI discovery is **out of scope** for controlled beta — founder-assisted token entry is acceptable.                                              | Add an integration test that exercises `POST /api/whatsapp/onboard` with mocked Meta calls; document the manual entry flow in onboarding ops doc.                                                                                                                                                                      |
| 3   | Meta auto-registration        | Standard provision route (`organizations.ts:201-284`) does **not** call Meta to register the webhook. Only the ESU flow does (`whatsapp-onboarding.ts:100-103`).                                                                             | Extract the Meta `/subscribed_apps` call into a shared helper and invoke it from the provision route. WABA ID derived from token via `/debug_token`. Failure of the Meta call **degrades** the channel status to `pending_meta_register`, does not crash the provision.                                                |
| 4   | provision-notify never called | `organizations.ts:287-310` silently skips notify if `CHAT_PUBLIC_URL` or `INTERNAL_API_SECRET` env vars unset (line 289). On non-2xx or thrown error it logs `console.warn` but reports the channel as `status: "active"` anyway (line 318). | (a) If env vars missing, return `status: "config_error"` with a specific reason instead of silently succeeding. (b) On notify failure, return `status: "pending_chat_register"`. (c) One retry with 200ms backoff inside the provision request.                                                                        |
| 5   | `lastHealthCheck` never set   | Line 320 hardcodes `lastHealthCheck: null`. Background health-checker takes up to 5 min to populate it. Dashboard "Go Live" check fails for the first 5 minutes.                                                                             | Reuse the existing health-checker probe (`apps/chat/src/managed/health-checker.ts`) as a synchronous call during provision. On success, write `Connection.lastHealthCheck = now` inside the same transaction extension and return it in the response. On failure, set `status: "health_check_failed"` with the reason. |
| 6   | Alex listing seed             | Listing is upserted on provision (`organizations.ts:227-241`). New orgs that haven't provisioned see an **empty marketplace** and don't know what to provision toward.                                                                       | Move the Alex listing+deployment upsert from the provision route into **org creation** (`apps/api/src/routes/setup.ts` or wherever orgs are created). Keep an idempotent upsert in provision as a safety net.                                                                                                          |

## Scope (out)

Per the user's instructions, this branch does **not** touch:

- Billing, Stripe, metering
- Governance error handling, WorkTrace integrity
- Ad-optimizer / Meta CAPI
- Calendar provider
- Creative pipeline
- Dashboard UI redesign (the new "Connect" button is the **only** UI change considered, and even that is gated below)
- Adding a dashboard discovery button for ESU (deferred — founder-assisted manual token entry covers controlled beta)

## Architecture

### Files touched (new + modified)

**Modified:**

- `apps/api/src/routes/organizations.ts` — provision flow gets webhook registration, sync health check, structured statuses, env-var validation.
- `apps/api/src/routes/setup.ts` (or wherever orgs are first created — to be confirmed by Task 1) — Alex listing+deployment seed on org creation.
- `apps/api/src/__tests__/provision-fixes.test.ts` — replace mock-shape tests with real route-level integration tests (current file tests are theater; see "Decisions" §1).
- `apps/chat/src/__tests__/whatsapp-wiring.test.ts` — add end-to-end webhook-path-pin test.

**New:**

- `apps/api/src/lib/whatsapp-meta.ts` (or extend an existing helper if one exists — Task 1 confirms) — extracts the `/subscribed_apps` registration call and `debug_token` WABA-ID lookup. Used by both `organizations.ts` and `whatsapp-onboarding.ts`.
- `apps/api/src/lib/whatsapp-health-probe.ts` — wraps the synchronous health probe used by the provision route. May import directly from `apps/chat/src/managed/health-checker.ts` if cross-app imports are clean; otherwise a sibling implementation in api with shared types from `packages/schemas`.
- `apps/api/src/__tests__/provision-end-to-end.test.ts` — single integration test that walks the whole journey with mocked Meta + mocked chat-server.

### Provision response shape (new)

The route currently returns `status: "active"` even on partial success. New shape:

```ts
{
  id: string;                            // ManagedChannel.id
  channel: "whatsapp" | "telegram" | "slack";
  webhookPath: string;
  webhookRegistered: boolean;            // true only if Meta /subscribed_apps succeeded
  status:
    | "active"                           // all post-create steps succeeded
    | "config_error"                     // env vars / required config missing — platform can't operate
    | "pending_chat_register"            // provision-notify failed — chat server has no entry, inbound cannot route
    | "health_check_failed"              // sync health probe returned non-OK — credentials/phoneNumberId likely invalid
    | "pending_meta_register"            // Meta /subscribed_apps failed — operator-retry may unblock
    | "error";                           // transaction rolled back
  statusDetail: string | null;           // human-readable reason; never null when status !== "active"
  lastHealthCheck: string | null;        // ISO timestamp; non-null when status === "active"
  createdAt: string;
}
```

**Status precedence (most blocking first), when multiple post-create steps fail:**
`config_error` > `pending_chat_register` > `health_check_failed` > `pending_meta_register` > `active`.

Reasoning: `config_error` = platform can't operate at all; `pending_chat_register` = Switchboard cannot route inbound (Meta might POST and the chat server has no entry); `health_check_failed` = customer credentials likely invalid; `pending_meta_register` = Meta subscription gap, but operator-retry can unblock. A dedicated test asserts mixed-failure precedence.

The dashboard component that consumes the provision response renders `statusDetail` whenever `status !== "active"` (see Decision 8 and Task 11 in the plan).

### Decisions

1. **Replace the existing `provision-fixes.test.ts` mocks with real integration tests.** The current file (189 lines) tests string templates and `vi.fn()` shapes — it cannot catch any of the bugs we're fixing. Keep the file path; replace contents.
2. **Automatic Meta webhook registration over manual fallback.** Manual fallback adds founder ops burden per org and we already have working code for the automatic path in the ESU flow. Failure is non-fatal: channel reports `pending_meta_register`, dashboard shows the reason, retry available.
3. **Synchronous health probe in the provision request.** Yes, this adds ~1 Meta API call to the provision latency. Acceptable for controlled beta because it eliminates the 5-minute "is this live yet?" gap. Net win for activation truth.
4. **Alex listing on org creation, not on first provision.** This makes Alex discoverable before any channel exists. Keep the provision-time upsert as belt-and-suspenders for orgs created before the change.
5. **Single transaction boundary unchanged.** Webhook registration, provision-notify, and health probe all run **outside** the Prisma transaction (they make HTTP calls). The transaction only rolls back DB writes. Side-effect failures yield non-`active` statuses but do not roll back the channel record — operators can retry.
6. **Token model — explicit, no silent system-token fallback.** For self-serve provisioning, the **decrypted customer-provided Meta token** is the access token used for `debug_token` lookup and `/subscribed_apps` registration. Task 1 confirms this against the existing ESU flow (`whatsapp-onboarding.ts`); if that flow proves a different token model is required (e.g., `WHATSAPP_GRAPH_TOKEN` is the Meta **app** access token used only for system-level operations and NOT customer asset operations), the helper signatures and naming reflect that distinction explicitly. **The provision route MUST NOT silently fall back to `WHATSAPP_GRAPH_TOKEN` as the customer-asset access token** — doing so produces tests that pass in dev (where the system token has access to dev assets) and fail in prod (where the system token has no access to a customer's WABA). If a system token IS required for one specific call (e.g., `debug_token`), the helper takes both `appToken: string` and `userToken: string` parameters with documented purposes.
7. **Status precedence (most blocking first):** `config_error` > `pending_chat_register` > `health_check_failed` > `pending_meta_register` > `active`. Reasoning: `config_error` = platform can't operate; `pending_chat_register` = Switchboard can't route inbound at all (Meta might POST and the chat server has no entry); `health_check_failed` = customer credentials likely invalid; `pending_meta_register` = Meta subscription gap, but inbound delivery may still work and operator retry can unblock. A dedicated test asserts mixed-failure precedence.
8. **Minimal UI surfacing in scope.** The existing provision-consumer UI (the component that calls the provision endpoint and currently reports "active") MUST render `statusDetail` when `status !== "active"`. No redesign, no new navigation, no module card work. Scope is one component: identify in Task 1, change in Task 11.

## Acceptance criteria (verifiable)

| #   | Criterion                                                                 | How tested                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | A new org can connect a WhatsApp channel without founder DB edits.        | Integration test in `provision-end-to-end.test.ts` walks org-create → provision → asserts response status === "active".                                                                                                                                                                                                     |
| A2  | The dashboard shows channel as connected/live OR a clear blocking reason. | Same integration test asserts `statusDetail` is non-null when status !== "active"; dashboard component test asserts the reason renders.                                                                                                                                                                                     |
| A3  | A test inbound webhook reaches the correct deployment.                    | `whatsapp-wiring.test.ts` extended: provision a channel, simulate inbound POST to `/webhook/managed/:id`, assert it resolves to the right `orgId` and `deploymentConnectionId`.                                                                                                                                             |
| A4  | No duplicate channel records on retry.                                    | Integration test: call provision twice with the same `(orgId, channel, phoneNumberId)`, assert exactly one ManagedChannel row exists and the second call returns the existing row idempotently. **Provisioning a different `phoneNumberId` for the same org+channel succeeds** (multi-number orgs supported). See Risks #1. |
| A5  | `lastHealthCheck` is set on success.                                      | Integration test asserts response body has non-null `lastHealthCheck` and the DB row matches.                                                                                                                                                                                                                               |
| A6  | provision-notify is invoked after successful provisioning.                | Integration test injects a mocked chat-server fetch and asserts it was called once with `{ managedChannelId, ... }`.                                                                                                                                                                                                        |
| A7  | Alex appears in marketplace listings for a new org with **no** channels.  | New test in `setup.test.ts` (or equivalent): create org, fetch listings, assert Alex present.                                                                                                                                                                                                                               |
| A8  | Failure states surface to the user (no silent success).                   | Integration test: induce a Meta-API failure, assert status === "pending_meta_register" and statusDetail mentions the reason.                                                                                                                                                                                                |

## Risks

1. **Idempotency on retry (A4).** The natural key for "this org already has this WhatsApp number connected" is `(organizationId, channel, phoneNumberId)`. If the schema lacks `phoneNumberId` on `ManagedChannel`, use the closest persisted credential/metadata field that uniquely identifies the customer asset and document the limitation. Default approach: a runtime `findFirst` guard at the top of the provision per-channel loop. **No migration unless Task 1 proves runtime guard is unworkable** — and any migration is escalated to the user before being added.
2. **App boundary hygiene.** Two specific cases:
   - **Health probe code:** `apps/api` MUST NOT import from `apps/chat/src/managed/health-checker.ts`. Either factor the probe into `packages/schemas` / a shared package OR duplicate a small function in `apps/api/src/lib/whatsapp-health-probe.ts` with a parity-pinning test. Default: duplicate.
   - **Cross-app test pinning:** `apps/chat/__tests__` MUST NOT import from `apps/api`. The webhook-path contract is pinned on **both sides** by independent regex assertions plus a comment naming the external contract. No cross-app dependency is created for tests.
3. **Synchronous health probe latency.** Adds ~300-800ms (Meta `/v17.0/{phoneNumberId}` GET) to provision. Acceptable for beta. If it becomes a problem, gate behind a `?probe=skip` query param later — out of scope here.
4. **Meta `debug_token` rate limits.** One call per provision. Beta size (10 orgs) makes this trivial. Document the call in the test mock.
5. **Migration on org creation.** Moving the Alex seed into setup means existing orgs without an Alex deployment may exist in dev/staging DBs. Keep the upsert-on-provision as a safety net so existing orgs aren't broken.
6. **Token model.** See Decision 6. The biggest risk vector is "tests pass with `WHATSAPP_GRAPH_TOKEN` because dev assets are owned by that token's app, but production fails because customer assets aren't." Mitigation: Task 1 explicitly inspects the existing ESU flow's token usage; the Meta helper has typed parameters with documented purposes; integration tests **inject a customer-token mock distinct from any system-token mock** so the path is exercised under the right credential.

## Open questions

1. Where exactly is "org creation" today? Provision and onboarding routes both create org rows. Task 1 of the plan must trace this and confirm the single source of truth before the Alex seed move.
2. Is there a unique constraint or natural key for "this org already has a WhatsApp channel for this phone number"? If not, A4 needs either a migration or a guard.
3. Should `pending_meta_register` automatically retry via Inngest, or is operator-triggered retry sufficient for beta? Default: operator-triggered (one less moving part).

## Out-of-scope confirmation

This branch does **not** modify:

- `packages/core/src/platform/platform-ingress.ts` (governance error handling)
- Anything in `packages/creative-pipeline/`
- Anything in `packages/ad-optimizer/`
- `packages/db/prisma/schema.prisma` for fields unrelated to provision flow (the only acceptable schema change here is adding a unique constraint per Risk #1, and only if Task 1 proves it's needed)
- Stripe / billing routes
- WorkTrace / audit ledger
