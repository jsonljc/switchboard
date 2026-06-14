# Per-Org Agent Synergy Provisioning (F3)

**Date:** 2026-06-10
**Branch:** `feat/alex-synergy-provisioning` (off `origin/main` `8ae27e6a`)
**Status:** Design approved; pending spec review before implementation plan.
**Source:** Fix F3 from the 2026-06-10 Alex capability audit (`docs/audits/2026-06-10-alex-capability-audit/README.md`, PR #960). Out of scope: F4 (`revenue_proven` writer) and F5 (booking to outcome link).

## 1. Problem

For a real signed-up org, the Alex/Riley/Mira revenue loop is dead because only Alex is provisioned. Two per-org concepts are decoupled:

- **Enablement** (`OrgAgentEnablement` rows, `schema.prisma:464-474`): signup sets Riley to `enabled` via `seedOrgDayOneAgents` (`apps/api/src/routes/organizations.ts:88`). Mira is never enabled for real orgs (only `seedMiraPilotOrgs`, which is called only by the dev seed, `packages/db/prisma/seed.ts:95`).
- **Deployment** (`AgentDeployment` rows, which crons and resolvers actually read): signup creates only Alex's, via `ensureAlexListingForOrg` (`organizations.ts:83`). Riley's and Mira's deployments are seeded only for `org_dev`, via `seedRileyAdOptimizerDeployment` / `seedMiraCreativeDeployment` (`seed.ts:611,620`).

Consequence: Riley has an enablement flag but no deployment, so the weekly-audit cron's `listActiveDeployments` filter finds nothing and no handoff candidate is ever emitted. Mira has neither, so `Alex to Mira` delegation and `Riley to Mira` handoff fail closed in production. The "synergy across Alex/Riley/Mira" north star does not exist for a paying tenant.

The **recommendation-handoff governance** (the `Riley to Mira` allow + mandatory-approval policies) is seeded **inside** `seedMiraCreativeDeployment` (`packages/db/src/seed/seed-mira-creative-deployment.ts:107-121`, builders in `recommendation-handoff-governance.ts`). So provisioning the handoff governance is the same act as provisioning Mira; the `Riley to Mira` edge needs both endpoints.

### Hidden dependency (not called out in the audit)

`seedRileyAdOptimizerDeployment` and `seedMiraCreativeDeployment` both do `agentListing.findUnique({ where: { slug } })` and **throw if the listing is absent** (`seed-riley-ad-optimizer-deployment.ts:42-47`, `seed-mira-creative-deployment.ts:47-52`). The "ad-optimizer" and "performance-creative-director" listings are created only by `seedMarketplace`, which has **no production caller** (it runs only from `packages/db/prisma/seed.ts`). Production provisions listings lazily per org, which is exactly why `ensureAlexListingForOrg` upserts the Alex listing on first config access rather than assuming it exists. So a naive call to either seeder in production would throw `listing ... not found`. The provisioning path must ensure the listings first.

## 2. Goal and non-goals

**Goal:** an entitlement-aware, idempotent, atomic per-org provisioning path that gives a real org Riley (day-one) and, through a deliberate operator action, Mira plus the recommendation-handoff governance (day-thirty), reusing the existing seed functions, so the cross-agent revenue loop works in production for entitled orgs.

**Non-goals (explicitly out of scope):**
- F4 (`revenue_proven` writer) and F5 (structured Alex booking outcome).
- An automated 30-day backfill cron for Mira. The Mira trigger is a deliberate operator action in v1; an entitlement-driven job is a future extension.
- Changing the booking trust model (F1/F2, already addressed in PR #961).
- Any UI surface.

## 3. Design decisions (locked)

1. **Trigger = provision-on-enablement.** Provisioning follows enablement. Riley is enabled day-one, so it provisions at the existing signup seam. Mira is enabled day-thirty through a deliberate operator path, and provisions there. No new HTTP route is introduced; we extend the seam that `seedOrgDayOneAgents` already occupies.
2. **Scope = Riley at signup + Mira gated path, in one PR.** The handoff governance rides Mira, so both endpoints are required to satisfy the goal.
3. **Listings = ensure idempotently (minimal, no-clobber).** The provisioner upserts each required listing with `update: {}` (create if missing, never overwrite a richer production listing), mirroring `ensureAlexListingForOrg`.
4. **Atomic.** The orchestrator wraps all writes in a single interactive `prisma.$transaction`, for both `{ mira: false }` and `{ mira: true }`. Idempotent upserts prevent duplicate rows but do not guarantee that enablement, deployment, and governance land together; the transaction does. One provisioning function, one atomic mutation boundary.
5. **Riley `trustLevelOverride: "autonomous"` is intended for real orgs.** It is the documented SMB launch posture (`seed-riley-ad-optimizer-deployment.ts:58-62`), and the handoff's mandatory approval is non-downgradeable, so the `Riley to Mira` handoff still parks for a human regardless of trust posture.
6. **Entitlement stays the execution gate.** Provisioning creates capability surface, not permission to act. Billing entitlement (`subscriptionStatus` / `entitlementOverride` on `OrganizationConfig`, resolved by `evaluateEntitlement`, `packages/core/src/billing/entitlement.ts`) is enforced at ingress (`platform-ingress-entitlement`), so a not-yet-paying org with a Riley deployment still cannot execute Riley actions. Riley also needs a Meta Ads connection before its cron does anything. Provisioning Riley unconditionally at signup is therefore safe and mirrors how `seedOrgDayOneAgents` grants Riley enablement unconditionally.

## 4. Components

### 4.1 Orchestrator (new): `packages/db/src/seed/provision-org-agents.ts`

```ts
export interface ProvisionOrgAgentsResult {
  riley: { deploymentId: string };
  mira?: { deploymentId: string };
}

export async function provisionOrgAgentDeployments(
  prisma: PrismaClient,            // root client: needs $transaction
  orgId: string,
  opts: { mira: boolean },
): Promise<ProvisionOrgAgentsResult> {
  return prisma.$transaction(async (tx) => {
    await ensureAdOptimizerListing(tx);
    const riley = await seedRileyAdOptimizerDeployment(tx, orgId);
    if (!opts.mira) return { riley };

    await ensureCreativeListing(tx);
    const mira = await seedMiraCreativeDeployment(tx, orgId);
    await seedMiraPilotOrgs(tx, [orgId]);   // strictly scoped to [orgId]
    return { riley, mira };
  });
}
```

The orchestrator takes the root `PrismaClient` (it needs `$transaction`), opens one interactive transaction, and passes the `tx` client to every step. Because all writes share one transaction, the listing upsert is visible to the seeder's subsequent `findUnique` in the same transaction.

### 4.2 Listing ensures (new, co-located in the same module)

`ensureAdOptimizerListing(db: PrismaDbClient)` and `ensureCreativeListing(db: PrismaDbClient)` upsert the listing keyed by slug, with `update: {}` (no-clobber). They write the minimal fields the loop needs (slug, name, description, type, status `"listed"`, taskCategories, metadata `{}`); they do not attempt to reproduce the full marketplace metadata. If a richer listing already exists in production, `update: {}` leaves it untouched. This keeps the blast radius minimal and does not modify `seed-marketplace.ts`.

### 4.3 Seeder signature widening (minimal change to existing files)

To accept the `tx` client, widen the reused seeders from `PrismaClient` to `PrismaDbClient` (`= PrismaClient | Prisma.TransactionClient`, `packages/db/src/prisma-db.ts`). They only call model methods present on a transaction client (`agentListing`, `agentDeployment`, `policy`, `orgAgentEnablement`, `creatorIdentity`), so the widening is type-safe and backward compatible (`PrismaClient` is assignable to `PrismaDbClient`, so `prisma/seed.ts` and existing tests still pass).

- `seedRileyAdOptimizerDeployment(db: PrismaDbClient, orgId)`: widen param; capture and `return { deploymentId }` from the deployment upsert.
- `seedMiraCreativeDeployment(db: PrismaDbClient, orgId)`: widen param (and its private `seedDefaultCreator` helper); `return { deploymentId }` (the upsert already binds `deployment.id`).
- `seedMiraPilotOrgs(db: PrismaDbClient, orgIds)`: widen param. Behavior is already strictly scoped: it maps over the passed `orgIds` and upserts `OrgAgentEnablement` keyed by `(orgId, "mira")`, with no global or default write (`seed-mira-pilot-orgs.ts:12-20`). The spec requires a test that proves only the passed org is touched.

### 4.4 Exports

Export `provisionOrgAgentDeployments` and `ProvisionOrgAgentsResult` from `@switchboard/db` (`packages/db/src/index.ts`). The public provisioning surface is the single orchestrator. Note for tests: code inside `packages/db` (including the orchestrator's own test) imports sibling modules by direct source path, never through the `@switchboard/db` barrel, to avoid a self-referential import cycle now that the orchestrator is itself exported from `index.ts`. Only consumer packages (apps/api) import from the barrel.

### 4.5 Signup wiring (Riley, day-one): `apps/api/src/routes/organizations.ts`

In the lazy `GET /:orgId/config` seam, immediately after `seedOrgDayOneAgents` (`:88`), call:

```ts
try {
  await provisionOrgAgentDeployments(app.prisma, orgId, { mira: false });
} catch (err) {
  console.warn(
    `[organizations] day-one Riley provisioning failed for ${orgId}; ` +
      `will retry on next config load:`,
    err,
  );
}
```

This is the canonical day-one seam (the same place day-one enablement happens). The try/catch mirrors the existing `seedAlexSkillPack` guard (`:89-93`): org config load must not fail because of a provisioning hiccup. The retry path is the next config load (the orchestrator is idempotent, so a retry is safe). The warning is emitted **only in the catch** (the happy path is silent, so it is not noisy), and names the phase (day-one Riley) and the org id.

This seam runs on every `GET /config`, so provisioning is attempted (idempotently) on each load. That matches the seam's existing behavior: `ensureAlexListingForOrg`, `seedOrgDayOneAgents`, and `seedAlexSkillPack` already run unconditional idempotent upserts here. If config-load write volume becomes a concern, a cheap "already provisioned" short-circuit (skip when the Riley deployment already exists) is a documented future optimization; v1 keeps it simple and consistent with the existing seam. The seam test must prove a thrown provisioning error is swallowed while config still returns 200.

### 4.6 Mira gated path (day-thirty): `scripts/provision-mira-for-org.ts`

A thin operator CLI mirroring `scripts/riley-pause-flag.ts`:

```
npx tsx scripts/provision-mira-for-org.ts <orgId>
```

It constructs a `PrismaClient` and calls `provisionOrgAgentDeployments(prisma, orgId, { mira: true })`, then logs the provisioned deployment ids. This is the deliberate day-thirty action. It enables Mira, creates the Mira deployment, and seeds the handoff + creative governance in one atomic call, so enablement, deployment, and governance cannot drift. The CLI itself is a thin wrapper (no co-located test, matching `scripts/riley-pause-flag.ts`); all logic and tests live in the orchestrator.

## 5. Atomicity, idempotency, ordering

- **Atomic:** one `prisma.$transaction` per call. A failure at any step rolls back the whole provisioning, so we never persist a deployment without its governance or enablement.
- **Idempotent:** every write is an upsert keyed deterministically (listing by slug; deployment by `organizationId_listingId`; policies by per-org deterministic id; enablement by `(orgId, agentKey)`). Re-running is a no-op on data.
- **Ordering that matters:** within the transaction, `ensure<X>Listing` must run before the corresponding seeder, because the seeder looks the listing up by slug and throws if absent. This is the one order constraint the tests should pin.

## 6. Testing strategy (TDD, red to green)

CI has no Postgres, so db tests mock Prisma (mirror `seed-riley-ad-optimizer-deployment.test.ts`). The `$transaction` mock invokes its callback with the mock as the tx client: `$transaction: vi.fn(async (cb) => cb(mock))`.

### 6.1 Orchestrator: `provision-org-agents.test.ts`

Assert **contract facts**, not internal call order (except the listing-before-seeder ordering that protects no-clobber creation):

- `{ mira: false }`: ad-optimizer listing ensured with `update: {}`; Riley deployment upserted keyed by `organizationId_listingId` (org + the looked-up listing id) carrying `governanceSettings: { trustLevelOverride: "autonomous" }`; result is `{ riley: { deploymentId } }` with no `mira`.
- `{ mira: true }`: additionally the creative listing is ensured; Mira deployment upserted keyed by `organizationId_listingId`; Mira enablement upserted for exactly `orgId` (and no other org); result includes `mira.deploymentId`.
- **Deployment identity (do not over-assert `skillSlug`):** `AgentDeployment` stores both `listingId` and `skillSlug` (`schema.prisma:1126,1133`). Assert the listing lookup/upsert by slug AND the deployment linkage (`organizationId_listingId`) as the primary contract, since that is how resolvers find the deployment. `skillSlug` (`"ad-optimizer"` / `"creative"`) is asserted as a secondary fact, mirroring `seed-riley-ad-optimizer-deployment.test.ts:83-88`; it must not be the only proof.
- **Producer to consumer proof:** the upserted handoff-approval policy id equals `recommendationHandoffApprovalPolicyId(orgId)`, the exact key the recommendation-handoff governance resolver consumes. Inside `packages/db` tests, import the id builder by **direct source path** (`./recommendation-handoff-governance.js`), not the `@switchboard/db` barrel, to avoid a self-referential cycle now that the orchestrator is also exported from `index.ts`. Consumer-package tests (apps/api) may import from the barrel.
- **Transaction boundary (not rollback):** assert all model writes are issued through the single transaction client (the `$transaction` callback runs once and every upsert is invoked on the `tx` passed to it). The mock cannot prove rollback; the real rollback guarantee comes from Prisma/Postgres. So the test claim is "all writes go through one transaction client," not "rollback is proven."
- **Idempotency:** two runs produce identical create payloads (mirror the existing seeder idempotency test).
- **Listing-before-seeder ordering:** the ad-optimizer listing upsert is recorded before the Riley deployment upsert (this order protects the no-clobber create).

### 6.2 Signup seam: extend `apps/api/src/__tests__/api-organizations.test.ts`

Assert the `GET /:orgId/config` path invokes `provisionOrgAgentDeployments` with `{ mira: false }` for the org, and that a thrown provisioning error is swallowed (config still returns 200). Mock the orchestrator at the module boundary.

### 6.3 Scoping proof for `seedMiraPilotOrgs`

A focused assertion (in the orchestrator test or the existing `seed-mira-pilot-orgs.test.ts`) that calling with `[orgId]` upserts enablement for that org only and performs no global or default write.

## 7. File-by-file change plan

| File | Change |
| --- | --- |
| `packages/db/src/seed/provision-org-agents.ts` | New orchestrator + `ensureAdOptimizerListing` + `ensureCreativeListing`. |
| `packages/db/src/seed/provision-org-agents.test.ts` | New tests (section 6.1, 6.3). |
| `packages/db/src/seed/seed-riley-ad-optimizer-deployment.ts` | Widen param to `PrismaDbClient`; return `{ deploymentId }`. |
| `packages/db/src/seed/seed-mira-creative-deployment.ts` | Widen param (and `seedDefaultCreator`) to `PrismaDbClient`; return `{ deploymentId }`. |
| `packages/db/src/seed/seed-mira-pilot-orgs.ts` | Widen param to `PrismaDbClient`. |
| `packages/db/src/index.ts` | Export `provisionOrgAgentDeployments` + `ProvisionOrgAgentsResult`. |
| `apps/api/src/routes/organizations.ts` | Call orchestrator (`{ mira: false }`) after `seedOrgDayOneAgents`, guarded. |
| `apps/api/src/__tests__/api-organizations.test.ts` | Extend seam test (section 6.2). |
| `scripts/provision-mira-for-org.ts` | New operator CLI (day-thirty Mira). |
| existing seeder tests | Update only if widening or the new return type requires it (no behavior change expected). |

No schema migration (rows on existing models only). No new HTTP route (extends an existing seam, so no route-allowlist entry). No new env var (gating is DB state, so no env-allowlist entry).

## 8. Risks and assumptions

- **Production listing state is unverified** (Postgres is down locally). The no-clobber `update: {}` ensure makes the code correct whether or not the two listings already exist in production, so this is not a blocker; it is worth a prod sanity check before rollout. If the listings already exist, the ensure is a harmless no-op.
- **Signature widening touches three tested files.** The change is a type broadening plus a return value; existing tests assert behavior and contract, not return values, so they should stay green. Run the db package tests to confirm.
- **Day-thirty automation is deferred.** Existing orgs that should get Mira are handled by the operator CLI in v1. The automated entitlement-driven backfill is a named future extension, not part of this PR.

## 9. Delivery and verification

- TDD: write failing tests, then implement to green.
- Run `pnpm typecheck`, `pnpm --filter @switchboard/db test`, `pnpm --filter api test` (the seam test), and, because routes are touched, `CI=1 npx tsx scripts/local-verify-fast.ts` (check-routes, env-allowlist).
- One focused PR to `main`, with the design rationale recorded (this spec plus the PR body). Per the branch doctrine, a spec can land as its own small PR; the default here is to include it in the focused implementation PR, since the goal calls for a single focused PR with the rationale recorded. Confirm preference at finish.
