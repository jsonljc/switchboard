# F-13: managed-channel gateway entry uses `Connection.id` as the channel token, but the deployment resolver looks it up as a `DeploymentConnection.id` — inbound dies with "No deployment connection found"

- **Severity:** blocks-pilot
- **Journey/step:** J3-S3 (booking conversation — inbound routing)
- **Verdict:** BROKEN (exercised live; inbound message produced a gateway error and was DLQ'd)
- **Location:**
  - Producer (wrong token): `apps/chat/src/managed/runtime-registry.ts:80` — `provision()` sets `deploymentConnectionId: managedChannel.connectionId` (a **`Connection`** row id, e.g. `conn_3e991b0e`).
  - Consumer (expects DeploymentConnection id): `packages/core/src/platform/prisma-deployment-resolver.ts:88-97` — for `channel==="telegram"` resolves `deploymentConnection.findFirst({ where: { id: token, type: "telegram" } })`; throws `No deployment connection found for channel=telegram` when not found.
  - Path keyer: `runtime-registry.ts:77` registers the entry under `managedChannel.webhookPath` (`/webhook/managed/conn_3e991b0e`), while the **correct** loader `loadGatewayConnections` (`:100-106`) registers under `/webhook/managed/<DeploymentConnection.id>` with the right token.
  - Registration call sites: boot `apps/chat/src/main.ts:195-196` (`loadAll` then `loadGatewayConnections`); runtime `main.ts:396` (`provision-notify` → `registry.provision`).
    (verified against `audit/pilot-spine` worktree, 2026-06-08)

## What was exercised

With the audit org's Telegram channel connected through the product in J2 (`ManagedChannel.connectionId = conn_3e991b0e`, status `active`, webhookPath `/webhook/managed/conn_3e991b0e`), I injected a real Telegram-update payload to that registered path (chat server `NODE_ENV` undefined ⇒ `verifyRequest` fails open in dev, per `telegram.ts:90-101`). The webhook accepted (200), parsed the message, and dispatched to `gateway.handleIncoming`, which threw:

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
| `ManagedChannel`       | `9ae3a6cd-…`                | telegram | `connectionId = conn_3e991b0e`                    |
| `Connection`           | `conn_3e991b0e`             | telegram | (org-level service connection)                    |
| `DeploymentConnection` | `cmq4q319c0004ko7npdi0wh3v` | telegram | `deploymentId = cmq4q31990002ko7nhdklz8zi` (alex) |

The registered gateway entry carries token `conn_3e991b0e` (the `Connection` id). The resolver looks for a `DeploymentConnection` with that id — none exists (the real one is `cmq4q…`). The webhook path that **would** work (`/webhook/managed/cmq4q319c0004ko7npdi0wh3v`) returns **404** — it was never registered, because `loadGatewayConnections` ran only at boot (before this channel existed) and the runtime `provision-notify` path registers under the `Connection`-id path instead.

## What happened vs expected

Expected: an inbound message on the connected channel's webhook routes to the org's Alex deployment and produces a reply. Observed: every inbound message on the product-exposed webhook path throws at the deployment resolver and is dropped to the DLQ. **No managed Telegram channel can receive any message** at prod defaults — the entire pilot booking spine (lead → conversation → booking) is unreachable through the real inbound path.

This is the canonical `Connection` vs `DeploymentConnection` confusion: `Connection` is org/serviceId-scoped; `DeploymentConnection` is deployment/type-scoped and is what the channel resolver keys on. The managed-channel registry conflates the two by treating `ManagedChannel.connectionId` (a `Connection` id) as the channel token.

## Suggested fix scope

In `runtime-registry.ts.provision()`, resolve the org's `DeploymentConnection` (by `deploymentId`+`type`, or store its id on `ManagedChannel`) and register the entry under that id as both the webhook path key and the token — matching `loadGatewayConnections`. Alternatively, have the resolver accept the `ManagedChannel.connectionId` → `Connection` → deployment lookup for telegram. Add a seam-pin test that feeds a real managed-channel inbound through `getGatewayByWebhookPath` → `resolveByChannelToken` and asserts a deployment resolves (not throws). Today no test exercises the managed-channel registration token against the resolver, so the two have diverged silently.

## Cross-reference

Relates to F-11 (the two registry loaders disagree on source-of-truth column). F-11 was downgraded to "design wart"; this finding shows the divergence is in fact load-bearing and BROKEN for the runtime-provisioned (non-boot) managed channel — the common pilot case (a customer connects their channel after the chat server is already running).
