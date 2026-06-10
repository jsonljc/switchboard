# Tier 0: "A pilot org exists" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read [`2026-06-10-riley-remediation-00-overview.md`](./2026-06-10-riley-remediation-00-overview.md) first for the shared guardrails, the answered open decisions, and the cross-slice integration review. They are not repeated here.

**Goal:** Make it possible to take a real (non-`org_dev`) clinic and turn it into an org where Riley can be credentialed, is governed, has economic config, and whose pause/handoff paths are armed, closing the security hole that is exploitable today along the way.

**Architecture:** Two independent credential threads (a fast resolver-fallback to unblock the pilot now; an OAuth-security hardening for the durable/self-serve path) plus one shared **agent-parameterized org-provisioning seeder** that seeds deployments, governance policies, enablement, entitlement, and economic config for Alex+Riley+Mira at org creation. The seeder absorbs pilot-spine F-16 + F-02 and Alex F3/F1; it is wired into the existing lazy-provisioning hook (`organizations.ts` GET `/:orgId/config`) and the marketplace deploy route.

**Tech Stack:** Fastify (apps/api), Prisma (packages/db), Zod (packages/schemas), Vitest, `@switchboard/db` seed helpers, AES-256-GCM credential crypto, HMAC (node:crypto).

---

## Verified findings (this tier)

| #                               | Status            | Pinned location                                                                                                                                                                        | Plan owner                                        |
| ------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| D10-1                           | CONFIRMED         | resolver `apps/api/src/bootstrap/inngest.ts:393-402`; producer `routes/facebook-oauth.ts:126-136`; wall `middleware/auth.ts:123-140`                                                   | PR 0.1 (fast) + PR 0.2 (OAuth)                    |
| D10-2                           | CONFIRMED         | read `services/cron/meta-token-refresh.ts:53,57` vs write `routes/facebook-oauth.ts:115,123`                                                                                           | PR 0.2                                            |
| D10-3 + security-audit **F2**   | CONFIRMED         | listing `facebook-oauth.ts:154-200`; authorize/callback `:41,50,76`; state builder `packages/ad-optimizer/src/facebook-oauth.ts:30-38`; google twin `google-calendar-oauth.ts:230-269` | PR 0.2                                            |
| D10-4                           | CONFIRMED         | `facebook-oauth.ts:17-19` vs `bootstrap/inngest.ts:587-589`                                                                                                                            | PR 0.2                                            |
| D4-5 / D5-1                     | CONFIRMED         | policies in `packages/db/src/seed/seed-riley-ad-optimizer-deployment.ts:82-94`; deploy `routes/marketplace.ts:208-242`                                                                 | PR 0.3                                            |
| D6-2                            | CONFIRMED         | `prisma/seed.ts:95,611,620`; seeders `seed-riley-ad-optimizer-deployment.ts`, `seed-mira-creative-deployment.ts`                                                                       | PR 0.3                                            |
| pilot-spine **F-16** + **F-02** | CONFIRMED (dedup) | provision `routes/organizations.ts:83-90` seeds no Policy/IdentitySpec/entitlement                                                                                                     | PR 0.3 (absorbs)                                  |
| Alex **F3** / **F1**            | CONFIRMED (dedup) | `lib/ensure-alex-listing.ts:43-57` writes no `governanceSettings`                                                                                                                      | PR 0.3 (shared spine; Alex trust value cross-ref) |
| D9-1 / D3-2                     | CONFIRMED         | read+gate `packages/ad-optimizer/src/inngest-functions.ts:183,194`; no writer                                                                                                          | PR 0.4                                            |
| D2-6                            | CONFIRMED         | read+gate `inngest-functions.ts:187,195-197`; no writer                                                                                                                                | PR 0.4                                            |
| D8-3 (seed half)                | CONFIRMED         | `roster.config.targetCpbCents` never seeded (`prisma/seed.ts:552-557` `config:{}`)                                                                                                     | PR 0.4                                            |
| D6-1                            | CONFIRMED         | `bootstrap/inngest.ts:357-360` discards `SubmitWorkResponse`                                                                                                                           | PR 0.5                                            |
| D6-8                            | CONFIRMED         | `.env.example:331-354`                                                                                                                                                                 | PR 0.6                                            |

---

## File structure (what each PR creates/modifies)

- **PR 0.1**: `apps/api/src/bootstrap/inngest.ts` (resolver fallback + status skip), `apps/api/src/bootstrap/__tests__/riley-credential-resolver.test.ts` (new).
- **PR 0.2**: `apps/api/src/routes/facebook-oauth.ts`, `apps/api/src/routes/google-calendar-oauth.ts`, `packages/ad-optimizer/src/facebook-oauth.ts` (state HMAC), `apps/api/src/middleware/auth.ts` (skip-list), `apps/api/src/services/cron/meta-token-refresh.ts` (field), `.env.example` + `scripts/env-allowlist.local-readiness.json`, route-allowlist, co-located tests.
- **PR 0.3**: `packages/db/src/seed/provision-org-agents.ts` (new orchestrator), `packages/db/src/seed/ensure-agent-listings.ts` (new), `apps/api/src/routes/organizations.ts` (wire), `apps/api/src/routes/marketplace.ts` (wire deploy), tests.
- **PR 0.4**: `packages/schemas/src/ad-optimizer.ts` (config coercion), the deploy/settings producer surface, `packages/db/src/seed/provision-org-agents.ts` (default economic config), `apps/dashboard` settings form if present, tests.
- **PR 0.5**: `apps/api/src/bootstrap/inngest.ts:357-360` (response-aware), test.
- **PR 0.6**: `docs/runbooks/provisioning.md` (new §11), `docs/runbooks/riley-flag-flip.md` (new).

---

## PR 0.1: Credential Riley fast (resolver fallback + `needs_reauth` skip)

**Why first:** This is the cheapest path to a credentialed Riley (audit decision #2). An operator enters Meta creds in the existing Settings UI (writes an org `Connection`, `serviceId="meta-ads"`); Riley's resolver falls back to it when no `DeploymentConnection` exists. Independent of the OAuth work, ships the pilot unblock today.

**Files:**

- Modify: `apps/api/src/bootstrap/inngest.ts:393-402` (the `getDeploymentCredentials` closure in `adOptimizerDeps`)
- Create: `apps/api/src/bootstrap/__tests__/riley-credential-resolver.test.ts`

Current resolver (verified):

```ts
getDeploymentCredentials: async (deploymentId) => {
  const connections = await connectionStore.listByDeployment(deploymentId);
  const conn = connections.find((c) => c.type === "meta-ads");
  if (!conn) return null;
  const creds = decryptCredentials(conn.credentials);
  return { accessToken: creds.accessToken, accountId: creds.accountId };
},
```

- [ ] **Step 1: Write the failing test**: `riley-credential-resolver.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { buildRileyCredentialResolver } from "../riley-credential-resolver.js";

describe("riley credential resolver", () => {
  const meta = (over = {}) => ({ type: "meta-ads", status: "active", credentials: "enc", ...over });

  it("returns DeploymentConnection creds when present", async () => {
    const deploymentConn = { listByDeployment: vi.fn().mockResolvedValue([meta()]) };
    const orgConn = { findByServiceId: vi.fn() };
    const resolver = buildRileyCredentialResolver({
      deploymentConnectionStore: deploymentConn,
      connectionStore: orgConn,
      resolveOrgId: vi.fn().mockResolvedValue("org_1"),
      decrypt: () => ({ accessToken: "DC", accountId: "act_1" }),
    });
    expect(await resolver("dep_1")).toEqual({ accessToken: "DC", accountId: "act_1" });
    expect(orgConn.findByServiceId).not.toHaveBeenCalled();
  });

  it("falls back to org Connection(serviceId=meta-ads) when no DeploymentConnection", async () => {
    const deploymentConn = { listByDeployment: vi.fn().mockResolvedValue([]) };
    const orgConn = { findByServiceId: vi.fn().mockResolvedValue({ credentials: "enc-org" }) };
    const resolver = buildRileyCredentialResolver({
      deploymentConnectionStore: deploymentConn,
      connectionStore: orgConn,
      resolveOrgId: vi.fn().mockResolvedValue("org_1"),
      decrypt: () => ({ accessToken: "ORG", accountId: "act_org" }),
    });
    expect(await resolver("dep_1")).toEqual({ accessToken: "ORG", accountId: "act_org" });
    expect(orgConn.findByServiceId).toHaveBeenCalledWith("meta-ads", "org_1");
  });

  it("skips a DeploymentConnection in needs_reauth and does NOT return a dead token", async () => {
    const deploymentConn = {
      listByDeployment: vi.fn().mockResolvedValue([meta({ status: "needs_reauth" })]),
    };
    const orgConn = { findByServiceId: vi.fn().mockResolvedValue(null) };
    const resolver = buildRileyCredentialResolver({
      deploymentConnectionStore: deploymentConn,
      connectionStore: orgConn,
      resolveOrgId: vi.fn().mockResolvedValue("org_1"),
      decrypt: () => ({ accessToken: "DEAD", accountId: "x" }),
    });
    expect(await resolver("dep_1")).toBeNull();
  });

  it("returns null when neither store has a usable meta-ads connection", async () => {
    const resolver = buildRileyCredentialResolver({
      deploymentConnectionStore: { listByDeployment: vi.fn().mockResolvedValue([]) },
      connectionStore: { findByServiceId: vi.fn().mockResolvedValue(null) },
      resolveOrgId: vi.fn().mockResolvedValue("org_1"),
      decrypt: () => ({ accessToken: "x", accountId: "x" }),
    });
    expect(await resolver("dep_1")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**: `pnpm --filter @switchboard/api test riley-credential-resolver` → FAIL: `buildRileyCredentialResolver` not found.

- [ ] **Step 3: Extract + implement the resolver**: `apps/api/src/bootstrap/riley-credential-resolver.ts`

```ts
import type { DeploymentConnectionRecord } from "@switchboard/db";

export interface RileyCredentialResolverDeps {
  deploymentConnectionStore: {
    listByDeployment(id: string): Promise<DeploymentConnectionRecord[]>;
  };
  connectionStore: {
    findByServiceId(serviceId: string, orgId: string): Promise<{ credentials: string } | null>;
  };
  resolveOrgId: (deploymentId: string) => Promise<string | null>;
  decrypt: (blob: string) => { accessToken: string; accountId: string };
}

const USABLE = (status: string | undefined) => status !== "needs_reauth" && status !== "revoked";

/**
 * Resolve Riley's Meta credentials. Primary: deployment-scoped DeploymentConnection.
 * Fallback (pilot decision #2, deprecate post-pilot): org-level Connection(serviceId="meta-ads")
 * so an operator can credential Riley through the existing Settings UI before OAuth self-serve
 * is hardened. A needs_reauth/revoked DeploymentConnection is skipped (never return a dead token),
 * which also stops a dead token from poisoning the fleet audit (D2-3b).
 */
export function buildRileyCredentialResolver(deps: RileyCredentialResolverDeps) {
  return async (
    deploymentId: string,
  ): Promise<{ accessToken: string; accountId: string } | null> => {
    const dcs = await deps.deploymentConnectionStore.listByDeployment(deploymentId);
    const dc = dcs.find((c) => c.type === "meta-ads" && USABLE(c.status));
    if (dc) return deps.decrypt(dc.credentials);

    const orgId = await deps.resolveOrgId(deploymentId);
    if (!orgId) return null;
    const orgConn = await deps.connectionStore.findByServiceId("meta-ads", orgId);
    if (!orgConn) return null;
    return deps.decrypt(orgConn.credentials);
    // NOTE(deprecation): remove the org-Connection fallback once Riley is migrated to a single
    // canonical credential store post-pilot (audit decision #2).
  };
}
```

- [ ] **Step 4: Wire it in `bootstrap/inngest.ts`**: replace the inline `getDeploymentCredentials` with `buildRileyCredentialResolver({...})`, passing the existing `connectionStore` (DeploymentConnection), a `PrismaConnectionStore` (org Connection, confirm `findByServiceId(serviceId, orgId)` exists; the verified store is keyed `serviceId_organizationId` at `prisma-connection-store.ts:25-30`, add the finder if absent), `resolveOrgId` (look up `agentDeployment.organizationId` by id), and `decryptCredentials`.

- [ ] **Step 5: Run tests + typecheck**: `pnpm --filter @switchboard/api test riley-credential-resolver` → PASS; `pnpm typecheck`.

- [ ] **Step 6: Commit**: `git commit -m "feat(api): riley credential resolver falls back to org connection, skips needs_reauth"`

**Acceptance:** an org with a manually-entered `Connection(serviceId="meta-ads")` and no `DeploymentConnection` resolves Riley creds; a `needs_reauth` DeploymentConnection resolves to `null` instead of a dead token. **Integration-review seam #2.**

---

## PR 0.2: OAuth security + token-field + env consolidation (closes F2 + D10-2/3/4)

**Why bundled:** Lifting the auth wall so the OAuth producer is reachable (D10-1) _unmasks_ the unsigned-state CSRF. The listing-route IDOR (F2) is exploitable **today**. So org-scoping + signed state + auth-exempt + the field/env fixes ship as one PR; the redirect legs never go live unsigned. This is a `control-plane`/`ingress-receiver` route change → route-allowlist + `@route-class` discipline applies.

**Files:**

- Modify: `apps/api/src/routes/facebook-oauth.ts`, `apps/api/src/routes/google-calendar-oauth.ts`, `packages/ad-optimizer/src/facebook-oauth.ts`, `apps/api/src/middleware/auth.ts`, `apps/api/src/services/cron/meta-token-refresh.ts`, `.env.example`, `scripts/env-allowlist.local-readiness.json`
- Create: `apps/api/src/routes/__tests__/facebook-oauth-tenancy.test.ts`, `packages/ad-optimizer/src/facebook-oauth.test.ts` (extend)

### 0.2a: Listing-route org-scoping (closes security-audit F2; exploitable today)

- [ ] **Step 1: Failing test**: `facebook-oauth-tenancy.test.ts`

```ts
it("403s when the deployment is not owned by the caller's org", async () => {
  // deployment dep_b belongs to org_b; caller authenticated as org_a
  const res = await app.inject({
    method: "GET",
    url: "/api/connections/facebook/dep_b/accounts",
    headers: { authorization: "Bearer org_a_key" },
  });
  expect(res.statusCode).toBe(403);
  expect(decryptSpy).not.toHaveBeenCalled(); // never decrypts another tenant's token
});

it("200s for a deployment the caller owns", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/api/connections/facebook/dep_a/accounts",
    headers: { authorization: "Bearer org_a_key" },
  });
  expect(res.statusCode).toBe(200);
});
```

- [ ] **Step 2: Verify fail**: `pnpm --filter @switchboard/api test facebook-oauth-tenancy` → the 403 case currently returns 200 (IDOR).

- [ ] **Step 3: Implement the org check** at `facebook-oauth.ts:154-200` (and the google twin `google-calendar-oauth.ts:230-269`). Use the existing template at `routes/marketplace.ts:531-538`:

```ts
const deployment = await app.prisma.agentDeployment.findUnique({
  where: { id: deploymentId },
  select: { organizationId: true },
});
if (!deployment || deployment.organizationId !== request.organizationIdFromAuth) {
  return reply
    .code(403)
    .send({ error: "Forbidden: deployment not in your organization", statusCode: 403 });
}
```

Add an org-scoped read to `prisma-deployment-connection-store.ts` (`findByDeploymentAndType` already exists; add org assertion or pass `organizationId` and filter) so the store read itself is tenant-safe.

- [ ] **Step 4: Verify pass + run the store test.** `pnpm --filter @switchboard/api test facebook-oauth-tenancy` → PASS.

### 0.2b: HMAC-signed `state` + callback org-binding (closes D10-3 CSRF before D10-1 unmasks it)

- [ ] **Step 5: Failing test**: `packages/ad-optimizer/src/facebook-oauth.test.ts`

```ts
it("signs state and round-trips deploymentId", () => {
  const state = buildSignedState("dep_1", "secret");
  expect(verifySignedState(state, "secret")).toEqual({ deploymentId: "dep_1" });
});
it("rejects a tampered or wrong-secret state", () => {
  const state = buildSignedState("dep_1", "secret");
  expect(verifySignedState(state.replace("dep_1", "dep_evil"), "secret")).toBeNull();
  expect(verifySignedState(state, "other-secret")).toBeNull();
});
```

- [ ] **Step 6: Implement `buildSignedState`/`verifySignedState`** in `packages/ad-optimizer/src/facebook-oauth.ts` using `node:crypto` HMAC-SHA256 (`<base64url(deploymentId)>.<base64url(hmac)>`, constant-time compare via `crypto.timingSafeEqual`). Replace `buildAuthorizationUrl(config, deploymentId)` at `:50` so it passes `buildSignedState(deploymentId, secret)`; the callback at `:76` calls `verifySignedState` and 400s on null; on success it loads the deployment and asserts `deployment.organizationId === request.organizationIdFromAuth` before writing the `DeploymentConnection`.

- [ ] **Step 7: Auth-exempt the redirect legs**: add the authorize + callback paths to the skip-list in `middleware/auth.ts:123-140` (they cannot carry a Bearer; security now rests on the signed `state` + org-binding). The listing route at `:154-200` stays Bearer-protected. Add a route-allowlist entry; prove with `CI=1 npx tsx scripts/local-verify-fast.ts`.

### 0.2c: Token-field fix (D10-2) + env consolidation (D10-4)

- [ ] **Step 8: Failing test** for `meta-token-refresh`: feed a DeploymentConnection whose creds carry `expiresAt` (the key the OAuth writer actually writes, `facebook-oauth.ts:115,123`) and assert the cron reads it (does not warn-skip).

- [ ] **Step 9: Fix the field** at `meta-token-refresh.ts:53,57`: read `creds.expiresAt` (align reader to writer; keep writing `expiresAt` on successful refresh too). Add the missing-field branch to `notifyOperator` so a genuinely missing expiry alerts instead of silently `return`ing.

- [ ] **Step 10: Consolidate FACEBOOK*\*/META*\***: make the OAuth route config read `META_APP_ID`/`META_APP_SECRET`/`META_OAUTH_REDIRECT_URI` (the prefix the refresh cron already uses), with the `FACEBOOK_*` names accepted as deprecated aliases for one release. Update `.env.example` (mark `FACEBOOK_*` deprecated) and the env-allowlist. Authorize and refresh now read the same vars.

- [ ] **Step 11: Run full api tests + typecheck + format + local-verify-fast.** Commit: `git commit -m "fix(api): close facebook-oauth cross-tenant IDOR, sign oauth state, align token-expiry field"`

**Acceptance:** the listing route 403s on a foreign deployment and never decrypts; a forged/altered `state` is rejected; the callback binds the token to the authenticated org; the refresh cron reads the same key the writer writes; authorize and refresh read one credential prefix. **Closes F2 (note in the security tracker) + D10-2/3/4. Integration-review seam #3.**

---

## PR 0.3: Org-provisioning seeder (the shared Alex+Riley+Mira spine)

**Why:** This is the meta-finding's single workstream. Today the production provision path (`organizations.ts:83-90`) seeds only the Alex listing, day-one enablement, and the Alex skill pack: **no Policy rows, no Riley/Mira deployments, no entitlement**. So on a real org the pause path default-denies (D4-5/D5-1), the handoff is dead (D6-2), Alex's booking dead-ends (Alex F1), the approval lifecycle never fires (pilot-spine F-16), and mutating actions 402 (F-02). One seeder closes all of these.

**Files:**

- Create: `packages/db/src/seed/provision-org-agents.ts` (orchestrator), `packages/db/src/seed/ensure-agent-listings.ts` (global listing ensure), `packages/db/src/seed/__tests__/provision-org-agents.test.ts`
- Modify: `apps/api/src/routes/organizations.ts:83-90` (wire), `apps/api/src/routes/marketplace.ts:208-242` (wire deploy), `packages/db/src/index.ts` (export), `apps/api/src/lib/ensure-alex-listing.ts:43-57` (write baseline `governanceSettings`)

**Design:** `provisionOrgAgents(prisma, orgId, { entitled })` is idempotent and entitlement-gated. It composes existing, already-tested seed helpers (do not reinvent, `feedback_audit_blockers_already_done`):

- `ensureAgentListings(prisma)` (new): idempotently ensure the global `ad-optimizer` + `creative` `AgentListing` rows exist (extracted from `seedMarketplace`'s listing creation), so `seedRileyAdOptimizerDeployment`/`seedMiraCreativeDeployment` don't throw on a production DB that never ran the dev seed. **This is the hidden prerequisite the audit's seed-only finding implies.**
- `seedRileyAdOptimizerDeployment(prisma, orgId)`: Riley deployment + pause allow/approval policies (already seeds both per `seed-riley-ad-optimizer-deployment.ts:82-94`).
- `seedMiraCreativeDeployment(prisma, orgId)`: Mira deployment + handoff governance policies.
- `seedMiraPilotOrgs(prisma, [orgId])`: Mira enablement.
- `seedOrgDayOneAgents(prisma, orgId)`: Alex+Riley OrgAgentEnablement (already wired).
- **entitlement** (closes F-02): set `entitlementOverride=true` (or `subscriptionStatus="trialing"`) so mutating actions pass the 402 gate during the pilot.
- **Alex baseline `governanceSettings`** (closes Alex F1 source): `ensure-alex-listing.ts` currently writes none; write a baseline so Alex's `external_mutation` booking doesn't dead-end at `guided`. **The exact Alex trust value (autonomous vs guided+approval-lifecycle) is an Alex-product decision owned by the Alex capability-audit plan. This PR writes the hook + a safe default (`{ trustLevelOverride: "guided" }` plus a TODO cross-ref); the Alex plan finalizes it.** Do not unilaterally set Alex autonomous here.

This **supersedes pilot-spine F-16's fix-sketch** (`creative-governance.ts:21` TODO). Implement F-16 here, not separately.

- [ ] **Step 1: Failing test**: `provision-org-agents.test.ts` (mock Prisma, mirror `prisma-workflow-store.test.ts` style; CI has no Postgres)

```ts
describe("provisionOrgAgents", () => {
  it("seeds Riley + Mira deployments, pause + handoff policies, Mira enablement, and entitlement for an entitled org", async () => {
    const prisma = makeMockPrisma(); // records upserts
    await ensureAgentListings(prisma); // listings exist
    await provisionOrgAgents(prisma, "org_pilot", { entitled: true });

    // Riley + Mira deployments ACTIVE
    expect(deploymentUpserts(prisma)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ skillSlug: "ad-optimizer", status: "active" }),
        expect.objectContaining({ skillSlug: "creative", status: "active" }),
      ]),
    );
    // pause allow + approval policies present, scoped to org_pilot
    expect(policyUpserts(prisma)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          effect: "allow",
          actionType: expect.stringContaining("adoptimizer.campaign.pause"),
        }),
        expect.objectContaining({ effect: "require_approval", approvalRequirement: "mandatory" }),
      ]),
    );
    // handoff governance present (allow + mandatory approval)
    expect(policyUpserts(prisma).filter((p) => p.actionType.includes("handoff"))).toHaveLength(2);
    // Mira enablement
    expect(enablementUpserts(prisma)).toEqual(
      expect.arrayContaining([expect.objectContaining({ agentKey: "mira" })]),
    );
    // entitlement (F-02): mutating actions won't 402
    expect(prisma.organizationConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "org_pilot" },
        data: expect.objectContaining({ entitlementOverride: true }),
      }),
    );
  });

  it("is idempotent (second run is upsert no-ops, no duplicate policy rows)", async () => {
    const prisma = makeMockPrisma();
    await ensureAgentListings(prisma);
    await provisionOrgAgents(prisma, "org_pilot", { entitled: true });
    const after1 = policyUpserts(prisma).length;
    await provisionOrgAgents(prisma, "org_pilot", { entitled: true });
    expect(policyUpserts(prisma).length).toBe(after1 * 2); // same deterministic ids, upsert path
    expect(new Set(policyUpserts(prisma).map((p) => p.id)).size).toBe(after1); // no NEW ids
  });

  it("does NOT seed Riley/Mira deployments for an unentitled org (gate)", async () => {
    const prisma = makeMockPrisma();
    await provisionOrgAgents(prisma, "org_free", { entitled: false });
    expect(deploymentUpserts(prisma).filter((d) => d.skillSlug === "ad-optimizer")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Verify fail**: `pnpm --filter @switchboard/db test provision-org-agents` → FAIL: not implemented.

- [ ] **Step 3: Implement `ensureAgentListings`**: extract the `ad-optimizer` + `creative` (+ ensure Alex) listing upserts from `seed-marketplace.ts` into an idempotent standalone helper.

- [ ] **Step 4: Implement `provisionOrgAgents`**: compose the helpers above behind an `entitled` gate; set entitlement; call `ensureAgentListings` defensively first. Keep it under 200 lines; it is orchestration, not logic.

- [ ] **Step 5: Verify pass**: `pnpm --filter @switchboard/db test provision-org-agents` → PASS.

- [ ] **Step 6: Wire into the provision path**: in `organizations.ts` after `seedOrgDayOneAgents` (line 88), call `await provisionOrgAgents(app.prisma, orgId, { entitled: await isOrgEntitled(orgId) })` inside the same try/catch posture (log-and-continue, never 500 the config read). Also call it from `marketplace.ts`'s `/listings/:id/deploy` after `store.create` so an explicit deploy seeds governance too.

- [ ] **Step 7: Write Alex baseline governanceSettings**: in `ensure-alex-listing.ts:43-57`, add `governanceSettings: { trustLevelOverride: "guided" } // TODO(alex-audit F1): finalize trust value` to the Alex deployment upsert. Cross-reference the Alex plan.

- [ ] **Step 8: Migration check**: if `entitlementOverride` is a new column, add the migration in the same commit (`pnpm db:check-drift`; hand-write via `migrate diff --script`). Verify it already exists first (memory references `entitlementOverride`).

- [ ] **Step 9: Full test + typecheck + `--filter api test`** (the route now calls a new seeder). Commit: `git commit -m "feat(db): per-org agent provisioning seeder (riley+mira deployments, governance, entitlement)"`

**Acceptance:** provisioning a fresh non-`org_dev` org yields ACTIVE Riley + Mira deployments, the pause + handoff policy pairs, Mira enablement, and entitlement; a second run adds no duplicate rows; an unentitled org gets none of the paid agents. **Closes D4-5/D5-1, D6-2, pilot-spine F-16 + F-02, Alex F3, and the source of Alex F1. Integration-review seam #1.**

---

## PR 0.4: Economic config producer (`targetCostPerBooked`, `conversionActionType`, `targetCpbCents`)

**Why:** With no writer, the booked-CAC tier ladder silently falls back to CPL (D9-1/D3-2), breach detection judges Meta's aggregate `conversions` (D2-6), and the cockpit hides the cost-per-booked line (D8-3 seed half). The reader uses a strict `typeof === "number"` gate, so the producer must coerce string form fields to numbers via the schema.

**Files:**

- Modify: `packages/schemas/src/ad-optimizer.ts` (`AdOptimizerConfigSchema`: coerce `targetCostPerBooked` string→number, accept `conversionActionType`, `attributionWindows`), the deploy/settings producer surface that writes `inputConfig`, `packages/db/src/seed/provision-org-agents.ts` (seed sensible defaults), the Riley roster `config` writer for `targetCpbCents`/`avgValueCents`
- Test: `packages/schemas/src/ad-optimizer.test.ts`, `provision-org-agents.test.ts` (extend)

- [ ] **Step 1: Failing schema test**: assert `AdOptimizerConfigSchema.parse({ targetCostPerBooked: "45" })` yields `{ targetCostPerBooked: 45 }` (number), and that `conversionActionType: "offsite_conversion.fb_pixel_purchase"` and `attributionWindows` survive parsing.

- [ ] **Step 2: Implement the coercion**: `z.coerce.number().positive().optional()` for `targetCostPerBooked`; string enum/passthrough for `conversionActionType`; shape for `attributionWindows`. This is the bridge over the `inngest-functions.ts:178-182` "stored as strings" trap the verifier flagged.

- [ ] **Step 3: Failing producer test**: extend `provision-org-agents.test.ts`: after provisioning, the Riley deployment `inputConfig` carries a numeric `targetCostPerBooked` and a `conversionActionType`; the Riley `roster.config` carries `targetCpbCents`.

- [ ] **Step 4: Seed economic defaults** in `provisionOrgAgents`: derive `targetCostPerBooked` from the org's per-service price if available, else a documented default; set `conversionActionType` to the pilot's Meta purchase action; set `roster.config.targetCpbCents` (= `targetCostPerBooked * 100`) so the cockpit line shows.

- [ ] **Step 5: Settings producer**: if the dashboard exposes a Riley settings form, add the three fields routed through `AdOptimizerConfigSchema` (so an operator can override). If not in scope, document the seed-only default and the follow-up.

- [ ] **Step 6: Verify pass + cockpit smoke**: the seeded `targetCpbCents` makes `metrics-riley.ts:114` emit a real target so `key-result.tsx:166` renders the line (no longer "—"). Test + typecheck.

- [ ] **Step 7: Commit**: `git commit -m "feat: write riley economic config (targetCostPerBooked, conversionActionType, targetCpbCents) at provisioning"`

**Acceptance:** a provisioned org's weekly audit runs on the booked-CAC ladder (not CPL), breach detection uses the configured conversion action, and the cockpit shows a cost-per-booked line. **Integration-review seam #1 (config sub-seam).**

---

## PR 0.5: Response-aware handoff submitter (D6-1)

**Why:** Once policies are seeded (PR 0.3), the handoff fires for real. The initiator at `bootstrap/inngest.ts:357-360` awaits `submitRecommendationHandoff` and **discards** the `SubmitWorkResponse`. A governance deny, entitlement miss, or unexpected ungated execution all pass silently. The hardened pattern already exists next door in `buildRileyPauseSubmitter` (`:371-374`).

**Files:**

- Modify: `apps/api/src/bootstrap/inngest.ts:357-366`
- Test: `apps/api/src/bootstrap/__tests__/recommendation-handoff-submitter.test.ts` (new)

- [ ] **Step 1: Failing test**: three cases, mirroring the pause submitter's contract:

```ts
it("logs a loud alarm on an unexpected ungated execution (bare ok:true)", async () => {
  const log = makeLog();
  await runHandoffInitiator({ submit: async () => ({ ok: true, result: r, workUnit: w }), log });
  expect(log.error).toHaveBeenCalledWith(
    expect.stringContaining("UNEXPECTEDLY executed without approval"),
  );
});
it("logs a deny when ok:false", async () => {
  const log = makeLog();
  await runHandoffInitiator({
    submit: async () => ({ ok: false, error: { code: "governance_denied" } }),
    log,
  });
  expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("handoff denied"));
});
it("treats approvalRequired:true as the expected parked outcome (no alarm)", async () => {
  const log = makeLog();
  await runHandoffInitiator({
    submit: async () => ({ ok: true, result: r, workUnit: w, approvalRequired: true }),
    log,
  });
  expect(log.error).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Verify fail.** Current code discards the response → no branch fires.

- [ ] **Step 3: Implement**: assign the awaited response; branch on `!res.ok` (deny), then `"approvalRequired" in res && res.approvalRequired` (expected park), then bare `ok:true` (unexpected ungated execute → loud `log.error`). Reuse the exact branch order from `buildRileyPauseSubmitter` so the two submitters stay consistent (`feedback_ingress_route_must_handle_pending_approval`).

- [ ] **Step 4: Verify pass + typecheck.** Commit: `git commit -m "fix(api): make the riley->mira handoff submitter response-aware"`

**Acceptance:** the handoff initiator alarms on deny/ungated-execute and treats parked as expected. **Integration-review seam #5.**

---

## PR 0.6: Flag-flip plan + runbook §11 (D6-8 + runbook extension)

**Why:** Five default-off flywheel flags with no consolidated, ordered flip plan. The provisioning runbook is the right home (audit decision #1).

**Files:**

- Create: `docs/runbooks/riley-flag-flip.md`
- Modify: `docs/runbooks/provisioning.md` (new "§11 Per-org agent provisioning" pointing at `provisionOrgAgents` + the flag plan). **Soft dependency:** this edit lands after both this PR and the `docs/provisioning-runbook` PR are on `main`.

- [ ] **Step 1:** Document the five flags with their current default and the ordered, dependency-aware flip sequence:
  1. `RILEY_OUTCOME_ATTRIBUTION_ENABLED` (`.env.example:331`): flip after Tier 3 D3-1 (so attribution has real value to read).
  2. `RILEY_PAUSE_SELF_EXECUTION_ENABLED` (`:336`): env arm; **also** requires the per-org `governanceSettings.pauseSelfExecutionEnabled` flip via `scripts/riley-pause-flag.ts` (both gates, verified at `inngest.ts:387-390`). Flip only after Tier 5 (D5-2 lifecycle check) is green.
  3. `CREATIVE_ATTRIBUTION_ENABLED` (`:340`): Mira→Riley learn-back; Tier 3 stretch.
  4. `ALEX_MODEL_ROUTER_ENABLED` (`:344`): Alex-owned; out of Riley scope, listed for completeness.
  5. `MIRA_SELF_BRIEF_ENABLED` (`:349`) and `MIRA_HANDOFF_BRIEF_ENRICHMENT_ENABLED` (`:354`): the latter flips with Tier 3 D6-3.
- [ ] **Step 2:** Document the **two-gate pause arming** explicitly (env flag AND per-org flag) so no one flips one and expects pauses (the audit's exact inert-config trap).
- [ ] **Step 3: Commit**: `git commit -m "docs(runbook): riley flag-flip plan + per-org provisioning section"`

**Acceptance:** an operator has one ordered checklist to arm each flywheel layer, with the cross-tier prerequisites named.

---

## Tier 0 dependencies & sequencing

- PR 0.1 (fast credential) and PR 0.2 (OAuth security) are **parallel**; 0.1 is the pilot unblock, 0.2 is the security + durable path. Ship 0.2 before any production OAuth use.
- PR 0.3 (seeder) is the keystone; PR 0.4 (economic config) depends on 0.3's seeder existing (it adds default config to it). PR 0.5 (submitter) is independent, do alongside 0.3.
- PR 0.6 (docs) lands last, after 0.3 + the provisioning-runbook PR are on `main`.
- **Exit criteria for Tier 0:** a scripted `provision a fresh org → credential Riley → weekly audit runs on booked-CAC with the configured conversion action → a handoff parks for approval` walkthrough passes end-to-end against a real (or staging) Meta account. This is also Tier 1's entry gate.

## Self-review (per writing-plans)

- **Spec coverage:** every Tier-0 finding in the overview table maps to a PR above (D10-1→0.1/0.2, D10-2/3/4→0.2, D4-5/D5-1/D6-2→0.3, D9-1/D2-6/D8-3-seed→0.4, D6-1→0.5, D6-8→0.6). Dedup absorptions (F-16, F-02, F2, Alex F3/F1) are explicitly closed in 0.2/0.3.
- **Placeholder scan:** the Alex trust value and the dashboard settings form are deliberately marked as cross-references / conditional (not placeholders) because they are owned by the Alex plan / depend on existing UI; every code step shows the actual change.
- **Type consistency:** `buildRileyCredentialResolver` deps, `provisionOrgAgents(prisma, orgId, { entitled })`, and `AdOptimizerConfigSchema` field names are used consistently across PRs.
- **Open risk flagged for execution:** confirm `PrismaConnectionStore.findByServiceId(serviceId, orgId)` exists (PR 0.1 Step 4) and `entitlementOverride` column exists (PR 0.3 Step 8) before relying on them; both are quick greps at execution time.
