# Audit 1 — Multi-Tenant Data Isolation

_Question: can Clinic A ever see or affect Clinic B's data? Read-only; every claim traced to code._

## How isolation is supposed to work here

Two layers, and the distinction explains every finding:

1. **Authentication** sets the caller's org from their API key. In production this is trustworthy and non-spoofable — unscoped keys make the server refuse to boot (`apps/api/src/middleware/auth.ts:82-98`).
2. **Resource-ownership** is _not_ automatic. The `requireOrg` guard only checks the caller _has_ an org; it does **not** check that the fetched record _belongs_ to that org. Each route must compare the record's org itself, via `assertOrgAccess(...)` (`apps/api/src/utils/org-access.ts:16-51`). Reads-by-ID are safe only if the route adds this check.

The good news: ~20 endpoint families apply that check correctly and consistently. The findings are the few that don't.

## CONFIRMED findings

### F1 — `/api/workflows/*` checks ownership only if the caller supplies a query param — HIGH

The workflow CRUD routes derive ownership from a **client-supplied, optional** `?organizationId=` URL parameter instead of the authenticated org, sitting on top of bare-ID database reads with no `requireOrg` guard.

`apps/api/src/routes/workflows.ts:28-33` (GET one workflow):

```js
if (request.query.organizationId && workflow.organizationId !== request.query.organizationId) {
  return reply.status(404)...
}
```

Omit the query param and the check is skipped entirely — the workflow is returned. The route never consults `request.organizationIdFromAuth`. Same defect on:

- `POST /:id/cancel` (`:71-76`) — cancel any clinic's workflow.
- `POST /checkpoints/:id/resolve` (`:127-132`) — read **and approve/reject** any clinic's approval checkpoint, then resume its workflow (cross-tenant _write_).

Underlying store reads are org-blind: `prisma-workflow-store.ts:104` (`findUnique({where:{id}})`), `:254`.

**Exploit:** an authenticated user for Clinic A calls `GET /api/workflows/<Clinic-B-workflow-id>` with no query param → receives Clinic B's full workflow (execution plan, action parameters, metadata). **Prerequisite:** a valid API key (any org) + a target ID (a `cuid`, not easily guessed but it leaks via logs/references). **Not tracked by any prior audit.**

**Fix:** add `requireOrg`; derive org from `organizationIdFromAuth`; make the ownership check mandatory (delete the `if (request.query.organizationId)` condition); push `organizationId` into the store read signatures.

### F2 — Facebook + Google Calendar OAuth listing routes have no ownership check (credential IDOR) — HIGH

`GET /api/connections/facebook/:deploymentId/accounts` (`apps/api/src/routes/facebook-oauth.ts:154-200`) takes `deploymentId` straight from the URL, looks up that deployment's stored credentials with **no org filter**, decrypts them, and uses the Meta token to list ad accounts:

```js
const connection = await connectionStore.findByDeploymentAndType(deploymentId, "meta-ads"); // no org filter
const creds = decryptCredentials(connection.credentials);
const accounts = await listAdAccounts(creds["accessToken"]);
```

`grep -c organizationIdFromAuth` over this file = **0** (verified). Identical pattern in `google-calendar-oauth.ts:230-269` (`/:deploymentId/calendars`), also grep = 0.

**Exploit:** Clinic A passes Clinic B's `deploymentId` → sees Clinic B's Meta ad accounts (IDs, names, currency) / Google calendars; the server decrypts and uses Clinic B's stored token to do it. The raw token is not returned to the caller, but it's a confidentiality breach of another clinic's ad/calendar setup, and the missing-authorisation pattern is the concern. **Prerequisite:** a valid API key + a target `deploymentId` — and these appear in plaintext in dashboard redirect URLs (`facebook-oauth.ts:140`).

The **correct pattern already exists** elsewhere in the codebase — `marketplace.ts:531-538` loads the deployment and 403s unless `deployment.organizationId === orgId` before using it. The OAuth routes simply omit it.

**Fix:** load the deployment and return 403 unless `deployment.organizationId === request.organizationIdFromAuth`. The companion `DeploymentConnection` store read methods (`prisma-deployment-connection-store.ts:29,35`) are org-blind by construction — add org-scoped read variants so the boundary can't be forgotten again.

### F8 — Delegation rules loaded across all clinics — MEDIUM (defense-in-depth)

`packages/db/src/storage/prisma-identity-store.ts:130-131` ignores its `organizationId` argument and does `delegationRule.findMany()` with no WHERE clause. This feeds the approval-authorisation chain (`platform-lifecycle.ts:544`), so a delegation granted in another clinic is considered when authorising an approver here. The **in-memory store filters correctly** (`storage/in-memory.ts:202-209`), proving the intended contract; the Prisma implementation silently doesn't. Exploit requires an attacker-controlled delegation rule, so practical risk is bounded — but the isolation guarantee is broken. **Fix:** filter by `grantor.organizationId`.

### F-tracked — Known backlog (#643): write paths on org-less tables

`CreatorIdentity`, `AssetRecord`, `DeploymentState` updates use `where:{id}` only (no org), each carrying a `// tracked in #643` comment. These are written by server-driven creative-pipeline jobs (not user-supplied IDs), so no live cross-tenant exploit was found, but isolation rests on caller discipline. Already tracked.

## Credential encryption — important context

`packages/db/src/crypto/credentials.ts` uses correct, modern **AES-256-GCM** with scrypt key derivation and per-record salt/IV. **But the master key is a single global environment variable** — one key for the whole platform, not one per clinic. **This means encryption does NOT provide tenant isolation.** The _only_ thing stopping Clinic A from reading Clinic B's WhatsApp/Meta/Google tokens is the `organizationId` filter in the query — which is exactly why F2 (a missing filter on a credential read) matters: where the org filter is absent, there is no second line of defence.

## Verified SAFE (skepticism applied)

- **The other bare-ID store reads are guarded by their callers.** Phase 1 flagged `work-trace`, `recommendation`, and `creative-job` stores for `getById(id)` with no org filter. Traced every caller: work-trace callers use `assertOrgAccess` (`action-lifecycle.ts:38,88`); the recommendation `getById` has **no caller at all** (dead code); creative-job callers all check `job.organizationId !== orgId` (`creative-pipeline.ts:146-150`). Only the workflow routes (F1) activate the pattern.
- **~20 single-record route families correctly enforce ownership** — approvals, connections, policies, audit, DLQ, identity, escalations, agents, conversations, knowledge, deployment-memory, governance, opportunities, and more (each via `assertOrgAccess` or an inline `!== orgId → 404` or an org-scoped `findFirst`).
- **Dashboard is a true proxy.** Only 5 dashboard routes touch the database directly, all pre-authentication `/auth/*` flows (register, verify-email, password reset). No dashboard route reads/writes another tenant's business data directly.
- **`DispatchLog`, `TrustScoreRecord`, `CompetenceRecord`** are global/principal-scoped by design — no tenant to leak to.
- **Body-supplied `organizationId` and `x-org-id` header overrides** are rejected in production (see `04-auth-and-governance.md`).

## Bottom line

Cross-tenant exposure is **isolated, not systemic** — the codebase has a genuinely consistent ownership-check discipline, and most of Phase-1's worries were already defended. But three real gaps exist (F1 workflow routes, F2 OAuth credential IDOR, F8 delegation rules), and the first two are reachable by any authenticated user who knows a target ID. Fix F1 and F2 before a multi-clinic pilot.
