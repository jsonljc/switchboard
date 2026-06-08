# F-11: Provision route never writes resolved `active` back; badge shows `provisioning` until first health-check tick

- **Severity:** decay (transient cosmetic + design wart; self-healing)
- **Journey/step:** J2-S2 / J2-S3 (channel connect)
- **Verdict:** DECAY (exercised live — transient at capture time; self-healed by health checker within 10 s of chat boot)
- **Location:**
  - `apps/api/src/routes/organizations.ts:505-524` — resolves `active` for the HTTP response body but never calls `prisma.managedChannel.update({ status })`. The write is missing.
  - `apps/chat/src/managed/health-checker.ts:47-48` — queries `status IN ('active','error','provisioning')` (includes provisioning); line 118 writes `active` (via `updateAndAlert`, line 19) when the probe succeeds. Scheduler: `setInterval` every 5 min + `setTimeout(..., 10_000)` at boot (`health-checker.ts:135-136`).
  - `apps/chat/src/managed/runtime-registry.ts:33-34` — `loadAll` filters `status: "active"` (ManagedChannel-keyed); `runtime-registry.ts:86-88` — `loadGatewayConnections` queries `DeploymentConnection.status = "active"` (conn-keyed, independent). The two loaders disagree on the source-of-truth column.
- **Evidence:**
  - At audit capture time the row was `status="provisioning"`. Post-audit DB check (2026-06-08): `SELECT id,status,"lastHealthCheck" FROM "ManagedChannel" WHERE "organizationId"='org_4f796695-7022-4718-838f-71c50b879ad2'` returns `status=active`, `lastHealthCheck=2026-06-08 04:48:04.743` — confirming the health checker flipped it.
  - Confirming it was not a go-live flip: `onboardingComplete=f`, `provisioningStatus=pending`, zero `AuditEntry` rows for the org at the time of review.
  - Original evidence: `evidence/j2-channel-status.txt` (provisioning at capture), `evidence/j2-connect-response.json` (active in HTTP body), `evidence/j2-routing-wired.txt` (gateway entry live in memory).

## What was exercised

Connected Telegram through the dashboard proxy (the route `useProvision()` calls) after clearing the F-02 entitlement block via deviation D-02. Inspected the persisted `ManagedChannel`, `Connection`, and `AgentDeployment` rows at capture time; confirmed the live gateway entry via chat `/health` size and the webhook GET (200 real vs 404 control); read the API provision route, the chat runtime-registry loaders, and the health-checker scheduler.

## What actually happens

1. The provision route (`organizations.ts:505-524`) computes a resolved `status` for the HTTP response but never persists it. The `ManagedChannel` row is left at the schema default `"provisioning"`.
2. At chat boot, `startHealthChecker` fires `runHealthCheck` after 10 s (and every 5 min thereafter). The health checker queries all rows with `status IN ('active','error','provisioning')` — provisioning rows are included — probes the channel, and writes `active` (or `error`) back via `updateAndAlert`.
3. On any chat restart, `loadGatewayConnections` (conn-keyed on `DeploymentConnection.status="active"`) re-registers the gateway entry independently of `ManagedChannel.status`. The channel is NOT dropped on restart; the conn-keyed loader re-registers it before the health check tick.
4. The `ManagedChannel`-keyed `loadAll` (`status:"active"`) would miss a row that is still `provisioning` at restart — but `loadGatewayConnections` covers it. Both loaders are called at boot.

## Net impact

- **Transient badge** — operator sees "provisioning" in `channel-management.tsx:34-43` for up to ~10 s after chat boot (or until the first 5-min tick). Self-heals without intervention. Cosmetic during the pilot.
- **No restart-durability break** — the channel is re-registered on restart via `loadGatewayConnections` before `loadAll` would matter.
- **Design wart worth tidying** — the two registry loaders (`loadAll` on `ManagedChannel.status`; `loadGatewayConnections` on `DeploymentConnection.status`) disagree on the source-of-truth column. This is a latent confusion risk as the codebase grows; it should be reconciled, but it is not causing an observable defect today.

## Suggested fix scope

1. In the provision route, after `resolveProvisionStatus` confirms `active`, write the resolved `status`/`statusDetail`/`lastHealthCheck` back to the `ManagedChannel` row (or have the chat `/internal/provision-notify` handler persist it after `registry.provision` succeeds). This eliminates the transient badge entirely.
2. Reconcile `loadAll` and `loadGatewayConnections` onto a single authoritative status column so the two loaders agree on source of truth.
3. Add a test asserting `ManagedChannel.status` equals the resolved status immediately after a successful provision (not only after a health-check tick).
