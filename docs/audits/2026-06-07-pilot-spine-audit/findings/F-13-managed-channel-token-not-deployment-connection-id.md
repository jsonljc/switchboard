# F-13: managed-channel gateway entry uses `Connection.id` as the channel token, but the Telegram deployment resolver looks it up as a `DeploymentConnection.id` — Telegram inbound dies with "No deployment connection found"

- **Severity:** blocks-Telegram (pre-Telegram-launch) — Telegram-ONLY; WhatsApp inbound is NOT affected (see scope note below)
- **Journey/step:** J3-S3 (booking conversation — inbound routing)
- **Verdict:** BROKEN for Telegram (exercised live; inbound message produced a gateway error and was DLQ'd). WhatsApp resolver path is code-read sound but NOT live-proven locally.
- **Location:**
  - Producer (wrong token for Telegram): `apps/chat/src/managed/runtime-registry.ts:80` — `provision()` sets `deploymentConnectionId: managedChannel.connectionId` (a **`Connection`** row id, e.g. `conn_3e991b0e`).
  - Consumer — Telegram branch (breaks): `packages/core/src/platform/prisma-deployment-resolver.ts:88-90` — for `channel === "telegram"` resolves `deploymentConnection.findFirst({ where: { id: token, type: "telegram" } })`; throws `No deployment connection found for channel=telegram` when not found, because `conn_xxxx` is a `Connection` id, not a `DeploymentConnection` id.
  - Consumer — non-Telegram branch (works for WhatsApp): `prisma-deployment-resolver.ts:91-93` — the else-branch queries `{ type: channel, tokenHash: sha256(token) }`. For WhatsApp, the connect flow at `apps/api/src/routes/organizations.ts:317` stores `tokenHash = sha256(connection.id)` on `DeploymentConnection`, so `sha256("conn_xxxx")` matches what was stored — the resolver succeeds.
  - Path keyer: `runtime-registry.ts:77` registers the entry under `managedChannel.webhookPath` (`/webhook/managed/conn_3e991b0e`), while the **correct** loader `loadGatewayConnections` (`:100-106`) registers under `/webhook/managed/<DeploymentConnection.id>` with the right token.
  - Registration call sites: boot `apps/chat/src/main.ts:195-196` (`loadAll` then `loadGatewayConnections`); runtime `main.ts:396` (`provision-notify` → `registry.provision`).
    (verified against `audit/pilot-spine` worktree, 2026-06-08)

## Scope: Telegram-only; WhatsApp code-read sound

The resolver has an explicit fork at `prisma-deployment-resolver.ts:88`:

- **Telegram branch** (`:88-90`): queries `{ id: token, type }` — i.e., treats the token as the `DeploymentConnection` primary key. The managed-channel registry passes a `Connection` id here, which will never match — **BROKEN**.
- **Non-Telegram / WhatsApp branch** (`:91-93`): queries `{ type, tokenHash: sha256(token) }`. The connect flow stores `tokenHash = sha256(connection.id)` at `organizations.ts:317`, so the same `Connection` id, when hashed, resolves correctly — **code-read sound**.

**Honesty caveat:** WhatsApp's soundness is inferred from code read. WhatsApp cannot run locally (no Meta sandbox), so the WhatsApp inbound path through the managed-channel registry has NOT been exercised live. The code-read conclusion is that it avoids this bug; any WhatsApp pilot validation must include a real round-trip to confirm.

## What was exercised

With the audit org's Telegram channel connected through the product in J2 (`ManagedChannel.connectionId = conn_3e991b0e`, status `active`, webhookPath `/webhook/managed/conn_3e991b0e`), I injected a real Telegram-update payload to that registered path (chat server `NODE_ENV` undefined => `verifyRequest` fails open in dev, per `telegram.ts:90-101`). The webhook accepted (200), parsed the message, and dispatched to `gateway.handleIncoming`, which threw:

```
ERROR Gateway webhook processing error
  message: "No deployment connection found for channel=telegram"
  at PrismaDeploymentResolver.resolveByChannelToken (prisma-deployment-resolver.js:44)
  at ChannelGateway.handleIncoming (channel-gateway.js:107)
```

The message was written to the `FailedMessage` DLQ. Artifact: `evidence/j3-inbound-routing-broken.txt`.

DB state confirming the seam (artifact `evidence/j3-conn-vs-deploymentconnection.txt`):

| table                  | id                          | type     | points to                                         |
| ---------------------- | --------------------------- | -------- | ------------------------------------------------- |
| `ManagedChannel`       | `9ae3a6cd-...`              | telegram | `connectionId = conn_3e991b0e`                    |
| `Connection`           | `conn_3e991b0e`             | telegram | (org-level service connection)                    |
| `DeploymentConnection` | `cmq4q319c0004ko7npdi0wh3v` | telegram | `deploymentId = cmq4q31990002ko7nhdklz8zi` (alex) |

The registered gateway entry carries token `conn_3e991b0e` (the `Connection` id). The Telegram-branch resolver looks for a `DeploymentConnection` with `id = conn_3e991b0e` — none exists (the real one is `cmq4q...`). The webhook path that **would** work (`/webhook/managed/cmq4q319c0004ko7npdi0wh3v`) returns **404** — it was never registered, because `loadGatewayConnections` ran only at boot (before this channel existed) and the runtime `provision-notify` path registers under the `Connection`-id path instead.

## What happened vs expected

Expected: an inbound Telegram message on the connected channel's webhook routes to the org's Alex deployment and produces a reply. Observed: every Telegram inbound on the product-exposed webhook path throws at the deployment resolver and is dropped to the DLQ. **No managed Telegram channel can receive any message** at prod defaults — the entire Telegram inbound spine is broken at the routing seam.

This is the canonical `Connection` vs `DeploymentConnection` confusion: `Connection` is org/serviceId-scoped; `DeploymentConnection` is deployment/type-scoped and is what the channel resolver keys on. The managed-channel registry conflates the two by treating `ManagedChannel.connectionId` (a `Connection` id) as the channel token. The Telegram resolver branch is strict (`id` PK lookup), while the WhatsApp/non-Telegram branch uses `tokenHash` and happens to work because the connect flow hashes the same `Connection` id.

## Suggested fix scope

In `runtime-registry.ts.provision()`, resolve the org's `DeploymentConnection` (by `deploymentId`+`type`, or store its id on `ManagedChannel`) and register the entry under that id as both the webhook path key and the token — matching `loadGatewayConnections`. Alternatively, update the Telegram resolver branch to accept the `ManagedChannel.connectionId` → `Connection` → deployment lookup path, mirroring how WhatsApp tolerates the `Connection` id via `tokenHash`. Add a seam-pin test that feeds a real managed-channel Telegram inbound through `getGatewayByWebhookPath` → `resolveByChannelToken` and asserts a deployment resolves (not throws). Today no test exercises the managed-channel registration token against the Telegram resolver branch, so the two have diverged silently.

## Cross-reference

Relates to F-11 (the two registry loaders disagree on source-of-truth column). F-11 was downgraded to "design wart"; this finding shows the divergence is in fact load-bearing and BROKEN for the runtime-provisioned (non-boot) Telegram managed channel — the common pilot case (a customer connects their channel after the chat server is already running). F-14 is a downstream FK blocker that would surface next on Telegram after this is fixed.
