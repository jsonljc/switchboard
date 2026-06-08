# F-11: Provisioned channel's resolved `active` status is never persisted; ManagedChannel row stays `provisioning`

- **Severity:** embarrasses-pilot (cosmetic now; restart-durability is BROKEN, latent)
- **Journey/step:** J2-S2 / J2-S3 (channel connect)
- **Verdict:** BROKEN (exercised live — channel connected, status not written back)
- **Location:**
  - `apps/api/src/routes/organizations.ts:298-306` (ManagedChannel created with NO `status` ⇒ schema default `"provisioning"`); `:505-524` (resolved `active` computed only for the HTTP response body, never `prisma.managedChannel.update({status})`).
  - `apps/chat/src/main.ts:396` → `apps/chat/src/managed/runtime-registry.ts:55-84` (`provision()` registers the in-memory gateway entry but the success path never writes `status`).
  - Consumers of the persisted status: `apps/chat/src/managed/runtime-registry.ts:34` (`loadAll` reloads only `status:"active"`); `:88` (`loadGatewayConnections` reloads only DeploymentConnection `status:"active"`); `apps/dashboard/src/components/settings/channel-management.tsx:34-43` (status badge).
  - (Verified against the worktree on 2026-06-08.)
- **Evidence:**
  - Live connect returned `status:"active"` in the HTTP body (`evidence/j2-connect-response.json`), but the persisted row is `status="provisioning"`, `updatedAt=2026-06-08 04:40:27.16` (unchanged since creation) (`evidence/j2-channel-status.txt`).
  - chat `/health` → `managedChannels:1` and `GET /webhook/managed/conn_3e991b0e` → 200 (vs 404 for a bogus id) prove the in-memory gateway entry is live (`evidence/j2-routing-wired.txt`).
  - `DeploymentConnection.status` WAS set `"active"` (`organizations.ts:330`), so `loadGatewayConnections` (conn-keyed) would re-register on restart — but the `ManagedChannel`-keyed `loadAll` would NOT, because that row is `provisioning`. The two reload paths disagree on the source of truth.

## What was exercised

Connected Telegram through the dashboard proxy (the route `useProvision()` calls) after clearing the F-02 entitlement block via deviation D-02. Inspected the persisted `ManagedChannel`, `Connection`, and `AgentDeployment` rows; confirmed the live gateway entry via chat `/health` size and the webhook GET (200 real vs 404 control); read the API provision route and the chat runtime-registry loaders.

## What happened vs expected

Expected: a successfully provisioned, `active`-resolving channel persists `status="active"` so (a) the operator sees a green/active badge and (b) the chat runtime re-registers it on restart. Observed: the resolved `active` is returned in the connect response only; the row is left at the `provisioning` default forever. The dashboard badge would show a stuck "provisioning" for a working channel, and a chat restart would drop the `ManagedChannel`-keyed gateway reload for freshly-provisioned channels (partly masked by the parallel `DeploymentConnection`-keyed loader, which is conn-keyed and does re-register).

## Suggested fix scope

In the provision route, after `resolveProvisionStatus`, write the resolved `status`/`statusDetail`/`lastHealthCheck` back to the `ManagedChannel` row in the same flow (or have the chat `/internal/provision-notify` handler persist `status="active"` after `registry.provision` succeeds). Reconcile the two registry loaders onto a single authoritative status column. Add a test asserting the persisted `ManagedChannel.status` equals the resolved status after a successful provision.
