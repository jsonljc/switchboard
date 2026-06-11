# Per-Org Agent Synergy Provisioning (F3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a real signed-up org the Alex/Riley/Mira revenue loop by provisioning Riley (day-one, at signup) and Mira (day-thirty, via an operator CLI) deployments plus the recommendation-handoff governance, reusing the existing seed functions in one atomic, idempotent transaction.

**Architecture:** A new db-layer orchestrator `provisionOrgAgentDeployments(prisma, orgId, { mira })` ensures the required marketplace listings (no-clobber), then calls the existing per-agent seeders inside a single interactive `prisma.$transaction`. Riley is wired into the existing day-one signup seam (`organizations.ts` `GET /config`, guarded). Mira is provisioned by a thin operator CLI. Entitlement stays the execution gate (enforced at ingress), so provisioning creates capability surface, not permission to act.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Prisma, Vitest (mocked Prisma; CI has no Postgres), pnpm + Turborepo.

**Spec:** `docs/superpowers/specs/2026-06-10-org-agent-synergy-provisioning-design.md`

---

## File Structure

| File                                                            | Responsibility                                                                                        |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `packages/db/src/seed/seed-riley-ad-optimizer-deployment.ts`    | (modify) Accept a tx client; return `{ deploymentId }`.                                               |
| `packages/db/src/seed/seed-mira-creative-deployment.ts`         | (modify) Accept a tx client; return `{ deploymentId }`.                                               |
| `packages/db/src/seed/seed-mira-pilot-orgs.ts`                  | (modify) Accept a tx client.                                                                          |
| `packages/db/src/seed/provision-org-agents.ts`                  | (create) Orchestrator + the two no-clobber listing ensures.                                           |
| `packages/db/src/seed/provision-org-agents.test.ts`             | (create) Orchestrator contract tests (the producer→consumer proof).                                   |
| `packages/db/src/index.ts`                                      | (modify) Export the orchestrator + result type.                                                       |
| `apps/api/src/routes/organizations.ts`                          | (modify) Guarded day-one Riley provisioning in the `GET /config` seam.                                |
| `apps/api/src/__tests__/api-organizations-provisioning.test.ts` | (create) Seam test: route invokes provisioning `{ mira: false }`; errors swallowed, config still 200. |
| `scripts/provision-mira-for-org.ts`                             | (create) Operator CLI for day-thirty Mira provisioning.                                               |

---

## Task 0: Confirm a clean baseline

**Files:** none.

- [ ] **Step 1: Install + build (Postgres is down; worktree:init skipped this)**

Run: `pnpm install && pnpm build`
Expected: install completes; Turbo build succeeds for all packages (no TS errors).

- [ ] **Step 2: Baseline typecheck**

Run: `pnpm --filter @switchboard/db typecheck && pnpm --filter api typecheck`
Expected: both exit 0 (no errors).

- [ ] **Step 3: Baseline tests for the packages we touch**

Run: `pnpm --filter @switchboard/db test && pnpm --filter api test`
Expected (baseline captured 2026-06-10 with Postgres DOWN):

- db: **982 passed, 9 pre-existing failures** in 3 Postgres-required integration suites — `prisma-work-trace-store-integrity` ("Postgres"), `prisma-ledger-storage` ("integration"), `prisma-greeting-signal-store` — which call `pg_advisory_xact_lock` against a real DB. These are environmental (no Postgres), NOT regressions, and are in none of the files this plan touches (see the memory note "pg_advisory_xact_lock test flake … don't block"). Later tasks must add no failures BEYOND these 9.
- api: **1721 passed, 0 failed, 5 skipped.**

Because those db integration suites need Postgres, prefer scoping red/green runs to the specific mocked test files (as each task below does), e.g. `pnpm --filter @switchboard/db test provision-org-agents`.

> If typecheck reports missing exports from `@switchboard/*`, or `@prisma/client has no exported member 'PrismaClient'`, the generated Prisma client is stale (worktree:init skips it when Postgres is down). Fix with `pnpm db:generate` (no DB needed) then `pnpm build`; or `pnpm reset` then `pnpm build`. Confirmed needed once in this worktree.

---

## Task 1: Make the agent seeders transaction-capable and return their deployment id

The orchestrator runs every seeder inside one `prisma.$transaction`, which passes a `Prisma.TransactionClient`. The seeders are typed `PrismaClient` today, which a tx client is not assignable to, so widen them to `PrismaDbClient` (`= PrismaClient | Prisma.TransactionClient`, already used by `ensure-alex-listing.ts`). They only call model methods present on a tx client, so this is type-safe and backward compatible (`PrismaClient` is assignable to the union, so `prisma/seed.ts` and existing tests stay green). Also return the deployment id so the orchestrator can report it.

**Files:**

- Modify: `packages/db/src/seed/seed-riley-ad-optimizer-deployment.ts`
- Modify: `packages/db/src/seed/seed-mira-creative-deployment.ts`
- Modify: `packages/db/src/seed/seed-mira-pilot-orgs.ts`
- Test: `packages/db/src/seed/seed-riley-ad-optimizer-deployment.test.ts`, `packages/db/src/seed/seed-mira-creative-deployment.test.ts`

- [ ] **Step 1: Write the failing return-value tests**

In `packages/db/src/seed/seed-riley-ad-optimizer-deployment.test.ts`, add inside the `describe("seedRileyAdOptimizerDeployment", ...)` block:

```ts
it("returns the provisioned deployment id", async () => {
  const result = await seedRileyAdOptimizerDeployment(prisma, "org_dev");
  expect(result).toEqual({ deploymentId: "deploy_riley_1" });
});
```

In `packages/db/src/seed/seed-mira-creative-deployment.test.ts`, add inside the `describe("seedMiraCreativeDeployment", ...)` block:

```ts
it("returns the provisioned deployment id", async () => {
  const result = await seedMiraCreativeDeployment(prisma, "org_dev");
  expect(result).toEqual({ deploymentId: "deploy_1" });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/db test seed-riley-ad-optimizer-deployment seed-mira-creative-deployment`
Expected: FAIL — the two new tests fail because the seeders currently return `undefined` (not `{ deploymentId }`).

- [ ] **Step 3: Widen + return in `seed-riley-ad-optimizer-deployment.ts`**

Add the import near the top (after the existing imports):

```ts
import type { PrismaDbClient } from "../prisma-db.js";
```

Change the signature line from:

```ts
export async function seedRileyAdOptimizerDeployment(
  prisma: PrismaClient,
  orgId: string,
): Promise<void> {
```

to (accepts a tx client; returns the deployment id):

```ts
export async function seedRileyAdOptimizerDeployment(
  prisma: PrismaDbClient,
  orgId: string,
): Promise<{ deploymentId: string }> {
```

Capture the deployment upsert result. Change:

```ts
await prisma.agentDeployment.upsert({
  where: {
    organizationId_listingId: { organizationId: orgId, listingId: listing.id },
  },
  create: { organizationId: orgId, listingId: listing.id, ...config },
  update: config,
});
```

to:

```ts
const deployment = await prisma.agentDeployment.upsert({
  where: {
    organizationId_listingId: { organizationId: orgId, listingId: listing.id },
  },
  create: { organizationId: orgId, listingId: listing.id, ...config },
  update: config,
});
```

At the very end of the function (after the two `prisma.policy.upsert(...)` pause-policy calls), add:

```ts
return { deploymentId: deployment.id };
```

The existing `import type { PrismaClient } from "@prisma/client";` line can stay (it is now unused for the parameter but may be referenced elsewhere; if lint flags it as unused, remove it).

- [ ] **Step 4: Widen + return in `seed-mira-creative-deployment.ts`**

Add the import:

```ts
import type { PrismaDbClient } from "../prisma-db.js";
```

Change the public signature from:

```ts
export async function seedMiraCreativeDeployment(
  prisma: PrismaClient,
  orgId: string,
): Promise<void> {
```

to:

```ts
export async function seedMiraCreativeDeployment(
  prisma: PrismaDbClient,
  orgId: string,
): Promise<{ deploymentId: string }> {
```

Change the private creator helper signature from:

```ts
async function seedDefaultCreator(prisma: PrismaClient, deploymentId: string): Promise<void> {
```

to:

```ts
async function seedDefaultCreator(prisma: PrismaDbClient, deploymentId: string): Promise<void> {
```

At the very end of `seedMiraCreativeDeployment` (after `await seedDefaultCreator(prisma, deployment.id);`), add:

```ts
return { deploymentId: deployment.id };
```

(If lint flags the `import type { PrismaClient } from "@prisma/client";` as unused, remove it.)

- [ ] **Step 5: Widen `seed-mira-pilot-orgs.ts`**

Add the import:

```ts
import type { PrismaDbClient } from "../prisma-db.js";
```

Change the signature from:

```ts
export async function seedMiraPilotOrgs(
  prisma: PrismaClient,
  pilotOrgIds: string[],
): Promise<void> {
```

to:

```ts
export async function seedMiraPilotOrgs(
  prisma: PrismaDbClient,
  pilotOrgIds: string[],
): Promise<void> {
```

(If lint flags the `@prisma/client` `PrismaClient` import as unused, remove it.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/db test seed-riley-ad-optimizer-deployment seed-mira-creative-deployment seed-mira-pilot-orgs`
Expected: PASS — all existing tests still pass (behavior unchanged) and the two new return-value tests pass.

- [ ] **Step 7: Typecheck the package**

Run: `pnpm --filter @switchboard/db typecheck`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/seed/seed-riley-ad-optimizer-deployment.ts \
        packages/db/src/seed/seed-mira-creative-deployment.ts \
        packages/db/src/seed/seed-mira-pilot-orgs.ts \
        packages/db/src/seed/seed-riley-ad-optimizer-deployment.test.ts \
        packages/db/src/seed/seed-mira-creative-deployment.test.ts
git commit -m "refactor(db): make agent seeders tx-capable and return deploymentId"
```

---

## Task 2: Add the provisioning orchestrator + no-clobber listing ensures

**Files:**

- Create: `packages/db/src/seed/provision-org-agents.ts`
- Test: `packages/db/src/seed/provision-org-agents.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write the failing orchestrator test**

Create `packages/db/src/seed/provision-org-agents.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { provisionOrgAgentDeployments } from "./provision-org-agents.js";
// Direct source import (NOT the @switchboard/db barrel) to avoid a self-referential
// cycle now that the orchestrator is also exported from index.ts.
import { recommendationHandoffApprovalPolicyId } from "./recommendation-handoff-governance.js";

interface ListingUpsertArgs {
  where: { slug: string };
  update: Record<string, unknown>;
  create: Record<string, unknown>;
}
interface DeploymentUpsertArgs {
  where: { organizationId_listingId: { organizationId: string; listingId: string } };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
}
interface PolicyUpsertArgs {
  where: { id: string };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
}
interface EnablementUpsertArgs {
  where: { orgId_agentKey: { orgId: string; agentKey: string } };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
}

/**
 * Combined in-memory prisma mock. `$transaction` invokes its callback with the same
 * mock as the tx client, so every nested seeder write lands on these arrays — the
 * "all writes go through one transaction client" proof. The mock cannot prove real
 * rollback (that is a Prisma/Postgres guarantee). agentDeployment.upsert returns a
 * distinct id per agent so Riley and Mira are distinguishable.
 */
function buildMockPrisma() {
  const listingUpserts: ListingUpsertArgs[] = [];
  const deploymentUpserts: DeploymentUpsertArgs[] = [];
  const policyUpserts: PolicyUpsertArgs[] = [];
  const enablementUpserts: EnablementUpsertArgs[] = [];
  const writeOrder: string[] = [];

  const mock = {
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(mock)),
    agentListing: {
      upsert: vi.fn(async (args: ListingUpsertArgs) => {
        listingUpserts.push(args);
        writeOrder.push(`listing:${args.where.slug}`);
        return { id: `listing_${args.where.slug}`, slug: args.where.slug };
      }),
      findUnique: vi.fn(async (args: { where: { slug: string } }) => ({
        id: `listing_${args.where.slug}`,
      })),
    },
    agentDeployment: {
      upsert: vi.fn(async (args: DeploymentUpsertArgs) => {
        deploymentUpserts.push(args);
        const skillSlug = args.create.skillSlug as string;
        writeOrder.push(`deployment:${skillSlug}`);
        return { id: skillSlug === "ad-optimizer" ? "deploy_riley" : "deploy_mira" };
      }),
    },
    policy: {
      upsert: vi.fn(async (args: PolicyUpsertArgs) => {
        policyUpserts.push(args);
        return { id: args.where.id };
      }),
    },
    orgAgentEnablement: {
      upsert: vi.fn(async (args: EnablementUpsertArgs) => {
        enablementUpserts.push(args);
        return {};
      }),
    },
    creatorIdentity: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        id: "creator_1",
        ...args.data,
      })),
    },
    _listingUpserts: listingUpserts,
    _deploymentUpserts: deploymentUpserts,
    _policyUpserts: policyUpserts,
    _enablementUpserts: enablementUpserts,
    _writeOrder: writeOrder,
  };
  return mock as unknown as PrismaClient & {
    _listingUpserts: ListingUpsertArgs[];
    _deploymentUpserts: DeploymentUpsertArgs[];
    _policyUpserts: PolicyUpsertArgs[];
    _enablementUpserts: EnablementUpsertArgs[];
    _writeOrder: string[];
  };
}

describe("provisionOrgAgentDeployments", () => {
  let prisma: ReturnType<typeof buildMockPrisma>;

  beforeEach(() => {
    prisma = buildMockPrisma();
    vi.clearAllMocks();
  });

  describe("{ mira: false } — day-one Riley", () => {
    it("ensures the ad-optimizer listing no-clobber (empty update)", async () => {
      await provisionOrgAgentDeployments(prisma, "org_acme", { mira: false });
      const listing = prisma._listingUpserts.find((l) => l.where.slug === "ad-optimizer");
      expect(listing).toBeDefined();
      expect(listing!.update).toEqual({});
    });

    it("upserts the Riley deployment keyed by org + the ad-optimizer listing", async () => {
      await provisionOrgAgentDeployments(prisma, "org_acme", { mira: false });
      expect(prisma._deploymentUpserts).toHaveLength(1);
      const dep = prisma._deploymentUpserts[0]!;
      expect(dep.where.organizationId_listingId).toEqual({
        organizationId: "org_acme",
        listingId: "listing_ad-optimizer",
      });
      expect(dep.create).toMatchObject({ skillSlug: "ad-optimizer" });
    });

    it("returns the Riley deployment id and no mira", async () => {
      const result = await provisionOrgAgentDeployments(prisma, "org_acme", { mira: false });
      expect(result).toEqual({ riley: { deploymentId: "deploy_riley" } });
    });

    it("provisions no Mira surface (no creative listing, deployment, or enablement)", async () => {
      await provisionOrgAgentDeployments(prisma, "org_acme", { mira: false });
      expect(
        prisma._listingUpserts.find((l) => l.where.slug === "performance-creative-director"),
      ).toBeUndefined();
      expect(prisma._enablementUpserts).toHaveLength(0);
      expect(prisma._deploymentUpserts).toHaveLength(1);
    });

    it("ensures the listing BEFORE the Riley deployment (protects no-clobber create)", async () => {
      await provisionOrgAgentDeployments(prisma, "org_acme", { mira: false });
      expect(prisma._writeOrder.indexOf("listing:ad-optimizer")).toBeLessThan(
        prisma._writeOrder.indexOf("deployment:ad-optimizer"),
      );
    });
  });

  describe("{ mira: true } — day-thirty Mira + handoff governance", () => {
    it("provisions both deployments with distinct ids", async () => {
      const result = await provisionOrgAgentDeployments(prisma, "org_acme", { mira: true });
      expect(result.riley.deploymentId).toBe("deploy_riley");
      expect(result.mira?.deploymentId).toBe("deploy_mira");
      const slugs = prisma._deploymentUpserts.map((d) => d.create.skillSlug);
      expect(slugs).toEqual(expect.arrayContaining(["ad-optimizer", "creative"]));
    });

    it("seeds the handoff approval policy the resolver consumes (producer→consumer)", async () => {
      await provisionOrgAgentDeployments(prisma, "org_acme", { mira: true });
      const ids = prisma._policyUpserts.map((p) => p.where.id);
      expect(ids).toContain(recommendationHandoffApprovalPolicyId("org_acme"));
    });

    it("enables Mira for exactly the provided org (strict scope, no global write)", async () => {
      await provisionOrgAgentDeployments(prisma, "org_acme", { mira: true });
      expect(prisma._enablementUpserts).toHaveLength(1);
      const en = prisma._enablementUpserts[0]!;
      expect(en.where.orgId_agentKey).toEqual({ orgId: "org_acme", agentKey: "mira" });
    });

    it("ensures the creative listing no-clobber", async () => {
      await provisionOrgAgentDeployments(prisma, "org_acme", { mira: true });
      const listing = prisma._listingUpserts.find(
        (l) => l.where.slug === "performance-creative-director",
      );
      expect(listing).toBeDefined();
      expect(listing!.update).toEqual({});
    });
  });

  describe("atomicity + idempotency", () => {
    it("issues every write through the single transaction client", async () => {
      await provisionOrgAgentDeployments(prisma, "org_acme", { mira: true });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma._deploymentUpserts.length).toBeGreaterThan(0);
      expect(prisma._policyUpserts.length).toBeGreaterThan(0);
      expect(prisma._enablementUpserts.length).toBeGreaterThan(0);
    });

    it("is idempotent: two runs produce identical Riley deployment create payloads", async () => {
      await provisionOrgAgentDeployments(prisma, "org_acme", { mira: false });
      const first = prisma._deploymentUpserts[0]!.create;
      await provisionOrgAgentDeployments(prisma, "org_acme", { mira: false });
      const second = prisma._deploymentUpserts[1]!.create;
      expect(second).toEqual(first);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/db test provision-org-agents`
Expected: FAIL — `Cannot find module './provision-org-agents.js'` (the module does not exist yet).

- [ ] **Step 3: Implement the orchestrator**

Create `packages/db/src/seed/provision-org-agents.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import type { PrismaDbClient } from "../prisma-db.js";
import { seedRileyAdOptimizerDeployment } from "./seed-riley-ad-optimizer-deployment.js";
import { seedMiraCreativeDeployment } from "./seed-mira-creative-deployment.js";
import { seedMiraPilotOrgs } from "./seed-mira-pilot-orgs.js";

export interface ProvisionOrgAgentsResult {
  riley: { deploymentId: string };
  mira?: { deploymentId: string };
}

/**
 * Idempotently ensures the ad-optimizer marketplace listing exists. No-clobber:
 * create-if-missing, never overwrite a richer production listing (`update: {}`).
 * Riley's deployment seeder resolves this listing by slug and throws if it is
 * absent, and production provisions listings lazily per org (seedMarketplace is
 * dev-only), so this guarantees the prerequisite. Mirrors ensureAlexListingForOrg.
 */
async function ensureAdOptimizerListing(db: PrismaDbClient): Promise<void> {
  await db.agentListing.upsert({
    where: { slug: "ad-optimizer" },
    update: {},
    create: {
      slug: "ad-optimizer",
      name: "Ad Optimizer",
      description:
        "Media strategist that diagnoses funnel leakage and recommends campaign actions.",
      type: "switchboard_native",
      status: "listed",
      taskCategories: ["audit", "recommendation", "draft_creation"],
      metadata: {},
    },
  });
}

/** As ensureAdOptimizerListing, for the creative listing Mira's deployment resolves. */
async function ensureCreativeListing(db: PrismaDbClient): Promise<void> {
  await db.agentListing.upsert({
    where: { slug: "performance-creative-director" },
    update: {},
    create: {
      slug: "performance-creative-director",
      name: "Performance Creative Director",
      description: "Full creative pipeline from trend analysis to produced video ads.",
      type: "switchboard_native",
      status: "listed",
      taskCategories: ["creative_strategy", "hooks", "scripts", "storyboard", "production"],
      metadata: {},
    },
  });
}

/**
 * Per-org synergy provisioning (audit F3). Creates the AgentDeployments + governance
 * that make the Alex/Riley/Mira revenue loop work for a real tenant, reusing the
 * existing per-agent seeders. Riley is day-one (always). Mira is day-thirty
 * (`opts.mira`), which additionally seeds the recommendation-handoff governance the
 * Riley→Mira handoff resolves against, plus Mira enablement.
 *
 * One interactive transaction wraps every write so deployment, governance, and
 * enablement land atomically. Idempotent upserts keyed deterministically, so the
 * whole call is safe to re-run.
 *
 * Takes the root PrismaClient (it needs `$transaction`) and passes the tx client to
 * every reused seeder (each widened to accept Prisma.TransactionClient).
 */
export async function provisionOrgAgentDeployments(
  prisma: PrismaClient,
  orgId: string,
  opts: { mira: boolean },
): Promise<ProvisionOrgAgentsResult> {
  return prisma.$transaction(async (tx): Promise<ProvisionOrgAgentsResult> => {
    await ensureAdOptimizerListing(tx);
    const riley = await seedRileyAdOptimizerDeployment(tx, orgId);
    if (!opts.mira) return { riley };

    await ensureCreativeListing(tx);
    const mira = await seedMiraCreativeDeployment(tx, orgId);
    await seedMiraPilotOrgs(tx, [orgId]);
    return { riley, mira };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/db test provision-org-agents`
Expected: PASS — all orchestrator tests green.

- [ ] **Step 5: Export the orchestrator from the package barrel**

In `packages/db/src/index.ts`, immediately after the line `export { seedMiraPilotOrgs } from "./seed/seed-mira-pilot-orgs.js";`, add:

```ts
export {
  provisionOrgAgentDeployments,
  type ProvisionOrgAgentsResult,
} from "./seed/provision-org-agents.js";
```

- [ ] **Step 6: Typecheck the package**

Run: `pnpm --filter @switchboard/db typecheck`
Expected: exit 0.

- [ ] **Step 7: Rebuild db so the new export is visible to apps/api**

Run: `pnpm --filter @switchboard/db build`
Expected: build succeeds (apps/api consumes the built `dist`, so the new export must be compiled before Task 3's typecheck).

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/seed/provision-org-agents.ts \
        packages/db/src/seed/provision-org-agents.test.ts \
        packages/db/src/index.ts
git commit -m "feat(db): add per-org agent synergy provisioning orchestrator (F3)"
```

---

## Task 3: Wire day-one Riley provisioning into the signup seam (TDD)

The `GET /:orgId/config` handler is the canonical day-one seam (it already runs `ensureAlexListingForOrg`, `seedOrgDayOneAgents`, `seedAlexSkillPack`). Add a guarded Riley provisioning call there. The seam test goes in a new, isolated file that partially mocks `@switchboard/db` to spy on the orchestrator (so we assert wiring + error-swallow without exercising the orchestrator internals, which Task 2 already covers).

**Files:**

- Create: `apps/api/src/__tests__/api-organizations-provisioning.test.ts`
- Modify: `apps/api/src/routes/organizations.ts`

- [ ] **Step 1: Write the failing seam test**

Create `apps/api/src/__tests__/api-organizations-provisioning.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

// Partial-mock @switchboard/db: keep every real export, but replace the orchestrator
// with a spy so we can assert the route wires it correctly and swallows its errors.
const provisionSpy = vi.fn().mockResolvedValue({ riley: { deploymentId: "deploy_riley" } });
vi.mock("@switchboard/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@switchboard/db")>();
  return { ...actual, provisionOrgAgentDeployments: provisionSpy };
});

import { organizationsRoutes } from "../routes/organizations.js";

describe("Organizations API — day-one Riley provisioning seam", () => {
  let app: FastifyInstance;

  const mockPrisma = {
    organizationConfig: {
      upsert: vi.fn().mockResolvedValue({ id: "org_test", name: "" }),
    },
    agentListing: {
      upsert: vi.fn().mockResolvedValue({ id: "listing_alex", slug: "alex-conversion" }),
    },
    agentDeployment: {
      upsert: vi.fn().mockResolvedValue({ id: "deployment_alex" }),
    },
    orgAgentEnablement: {
      upsert: vi.fn().mockResolvedValue({}),
    },
    knowledgeEntry: {
      upsert: vi.fn().mockResolvedValue({}),
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    provisionSpy.mockResolvedValue({ riley: { deploymentId: "deploy_riley" } });
    app = Fastify({ logger: false });
    app.decorate("prisma", mockPrisma as unknown as never);
    app.decorateRequest("organizationIdFromAuth", undefined);
    app.addHook("onRequest", async (request) => {
      request.organizationIdFromAuth = "org_test";
    });
    await app.register(organizationsRoutes, { prefix: "/api/organizations" });
  });

  it("provisions Riley (mira:false) on first config access", async () => {
    const res = await app.inject({ method: "GET", url: "/api/organizations/org_test/config" });
    expect(res.statusCode).toBe(200);
    expect(provisionSpy).toHaveBeenCalledTimes(1);
    expect(provisionSpy).toHaveBeenCalledWith(mockPrisma, "org_test", { mira: false });
  });

  it("swallows a provisioning failure and still returns the config (200)", async () => {
    provisionSpy.mockRejectedValueOnce(new Error("transient db error"));
    const res = await app.inject({ method: "GET", url: "/api/organizations/org_test/config" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).config).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter api test api-organizations-provisioning`
Expected: FAIL — the first test fails because the route does not call `provisionOrgAgentDeployments` yet (`provisionSpy` has 0 calls).

- [ ] **Step 3: Wire the route**

In `apps/api/src/routes/organizations.ts`, add `provisionOrgAgentDeployments` to the existing `@switchboard/db` import. Change:

```ts
import {
  encryptCredentials,
  decryptCredentials,
  seedOrgDayOneAgents,
  seedAlexSkillPack,
} from "@switchboard/db";
```

to:

```ts
import {
  encryptCredentials,
  decryptCredentials,
  seedOrgDayOneAgents,
  seedAlexSkillPack,
  provisionOrgAgentDeployments,
} from "@switchboard/db";
```

In the `GET /:orgId/config` handler, locate the `seedAlexSkillPack` try/catch block:

```ts
await seedOrgDayOneAgents(app.prisma, orgId);
try {
  await seedAlexSkillPack(app.prisma, orgId);
} catch (err) {
  console.warn(`[organizations] seedAlexSkillPack failed for ${orgId} (continuing):`, err);
}

return reply.send({ config });
```

and insert the guarded provisioning call between the `catch` block and the `return`:

```ts
await seedOrgDayOneAgents(app.prisma, orgId);
try {
  await seedAlexSkillPack(app.prisma, orgId);
} catch (err) {
  console.warn(`[organizations] seedAlexSkillPack failed for ${orgId} (continuing):`, err);
}

// F3: provision Riley's deployment (day-one) so the cross-agent revenue loop
// exists for a real org, not just org_dev. Idempotent + atomic. Mira
// (day-thirty) is provisioned separately via scripts/provision-mira-for-org.ts.
// Guarded like seedAlexSkillPack: a provisioning hiccup must not fail config
// load; the orchestrator is idempotent, so the retry is the next config load.
try {
  await provisionOrgAgentDeployments(app.prisma, orgId, { mira: false });
} catch (err) {
  console.warn(
    `[organizations] day-one Riley provisioning failed for ${orgId}; ` +
      `will retry on next config load:`,
    err,
  );
}

return reply.send({ config });
```

- [ ] **Step 4: Run the seam test to verify it passes**

Run: `pnpm --filter api test api-organizations-provisioning`
Expected: PASS — both seam tests green.

- [ ] **Step 5: Run the full api suite (no regressions in the existing organizations tests)**

Run: `pnpm --filter api test api-organizations`
Expected: PASS — the pre-existing `api-organizations.test.ts` suite still passes (the new partial mock lives only in the new file).

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter api typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/organizations.ts \
        apps/api/src/__tests__/api-organizations-provisioning.test.ts
git commit -m "feat(api): provision Riley at signup via the day-one seam (F3)"
```

---

## Task 4: Add the Mira day-thirty operator CLI

A thin wrapper (mirrors `scripts/riley-pause-flag.ts`, which has no co-located test by precedent; all logic + tests live in the orchestrator). It provisions Mira plus the recommendation-handoff governance and Mira enablement atomically.

**Files:**

- Create: `scripts/provision-mira-for-org.ts`

- [ ] **Step 1: Create the CLI**

Create `scripts/provision-mira-for-org.ts`:

```ts
// Provisions Mira (launchTier day-thirty) for one org: the creative deployment +
// recommendation-handoff governance + Mira enablement, in one atomic, idempotent
// call (audit F3, Wave 1). Deliberate operator action — Mira is NOT provisioned at
// signup. Riley is also (re-)ensured as a no-op so the org's loop is whole.
//
// Usage: npx tsx scripts/provision-mira-for-org.ts <orgId>
import { PrismaClient } from "@prisma/client";
import { provisionOrgAgentDeployments } from "@switchboard/db";

const [orgId] = process.argv.slice(2);
if (!orgId) {
  console.error("usage: npx tsx scripts/provision-mira-for-org.ts <orgId>");
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  const result = await provisionOrgAgentDeployments(prisma, orgId, { mira: true });
  console.warn(
    `[provision-mira-for-org] org=${orgId} provisioned ` +
      `riley=${result.riley.deploymentId} mira=${result.mira?.deploymentId ?? "(none)"}`,
  );
} finally {
  await prisma.$disconnect();
}
```

- [ ] **Step 2: Typecheck the script against the workspace**

Run: `pnpm --filter api typecheck && pnpm --filter @switchboard/db typecheck`
Expected: exit 0 (the script imports only `@prisma/client` and `@switchboard/db`; if the repo has a root-level `tsc` that includes `scripts/`, run that too).

- [ ] **Step 3: Verify the usage guard runs (no DB needed)**

Run: `npx tsx scripts/provision-mira-for-org.ts`
Expected: prints `usage: npx tsx scripts/provision-mira-for-org.ts <orgId>` and exits non-zero (argument validation path; never touches the DB).

- [ ] **Step 4: Commit**

```bash
git add scripts/provision-mira-for-org.ts
git commit -m "feat(scripts): add Mira day-thirty provisioning CLI (F3)"
```

---

## Task 5: Full verification + open the PR

**Files:** none (verification + PR).

- [ ] **Step 1: Typecheck the whole workspace**

Run: `pnpm typecheck`
Expected: all packages exit 0.

- [ ] **Step 2: Lint + format**

Run: `pnpm lint && pnpm format:check`
Expected: 0 errors. (CI lint runs prettier; `format:check` catches what local lint does not. Fix and re-`git add` if prettier rewrites anything.)

- [ ] **Step 3: Targeted tests**

Run: `pnpm --filter @switchboard/db test && pnpm --filter api test`
Expected: api 1721 passed / 0 failed; db 982 passed with ONLY the same 9 pre-existing Postgres-required failures from the Task 0 baseline (work-trace-integrity / ledger / greeting). Any NEW failure, or a failure in a `seed/` file, is a real regression to fix. New tests added by this plan (orchestrator + seam) must all pass.

- [ ] **Step 4: Route gates (routes were touched)**

Run: `CI=1 npx tsx scripts/local-verify-fast.ts`
Expected: passes. We added no new HTTP route and no new mutating bypass (we extended an existing handler), so `check-routes` should report no new findings; we added no new env var, so the env-allowlist check passes.

- [ ] **Step 5: Arch check (raw line counts on .ts)**

Run: `pnpm arch:check`
Expected: no error-level issues. `provision-org-agents.ts` is well under 600 lines; the seeders gained only a few lines.

- [ ] **Step 6: Confirm branch + diff scope**

Run: `git branch --show-current` (expect `feat/alex-synergy-provisioning`) and `git diff --stat origin/main...HEAD`
Expected: only the files in the File Structure table (plus the spec + this plan). No unrelated changes. Use the three-dot form so a moved `origin/main` does not inflate the diff.

- [ ] **Step 7: Push + open the PR**

```bash
git push -u origin feat/alex-synergy-provisioning
gh pr create --base main --title "feat: per-org agent synergy provisioning (F3)" --body "<see PR body below>"
```

PR body must record the rationale (per the goal): the F3 gap (Riley/Mira dev-seed-only), the provision-on-enablement trigger, Riley day-one at signup vs Mira day-thirty via the operator CLI, the no-clobber listing prerequisite, atomic single-transaction boundary, entitlement-stays-the-execution-gate, the producer→consumer test pinning `recommendationHandoffApprovalPolicyId`, and the out-of-scope items (F4/F5, auto day-thirty cron). Link the spec. Note the one unverified assumption (prod listing presence) and that the no-clobber ensure makes the code correct either way.

---

## Self-Review (completed during planning)

**Spec coverage:** Trigger (provision-on-enablement) → Tasks 3 + 4. Riley day-one → Task 3. Mira day-thirty + handoff governance → Task 4 (via the `{ mira: true }` orchestrator path). No-clobber listing ensures → Task 2 (`ensure*Listing`, `update: {}`). Atomic single transaction → Task 2 orchestrator + the "single transaction client" test. Idempotency → Task 1/2 upserts + idempotency tests. `seedMiraPilotOrgs` strict scope → Task 2 "exactly the provided org" test. Failure observability → Task 3 guarded warn + swallow-and-200 test. Producer→consumer proof → Task 2 `recommendationHandoffApprovalPolicyId` test. No migration / no new route / no new env var → confirmed in Task 5 gates. Out-of-scope (F4/F5) → untouched.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step shows the assertions; every command shows expected output.

**Type consistency:** `provisionOrgAgentDeployments(prisma: PrismaClient, orgId, { mira })` → `ProvisionOrgAgentsResult { riley: { deploymentId }, mira?: { deploymentId } }`. Seeders return `{ deploymentId }` (Task 1) consumed by the orchestrator (Task 2). `PrismaDbClient` import path `../prisma-db.js` is consistent across the three seeders and the orchestrator helpers. Listing slugs (`ad-optimizer`, `performance-creative-director`) match the seeders' `findUnique` lookups and the mock's id derivation.
