# Alex Governance Activation (P2-A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed an all-gates-observe `governanceConfig` onto every real-org Alex deployment at provisioning, so the five afterSkill governance gates run as telemetry instead of resolving "missing" and passing through inert.

**Architecture:** Seed `buildObserveGovernanceConfig({jurisdiction, clinicType})` in the lowest-level provisioning primitive `ensureAlexListingForOrg` (covers both the GET /config lazy path and the POST /provision path); derive jurisdiction/clinicType from the org's timezone with a SG/medical default; backfill pre-existing deployments only when their config is null (never clobbering an enforce flip); add an advisory readiness check that proves the activation landed. Observe never mutates a reply, so this cannot break an existing conversation.

**Tech Stack:** TypeScript (ESM), pnpm + Turborepo, Prisma, Fastify, Vitest, Zod. No schema migration (the `governanceConfig` JSON column already exists).

## Global Constraints

- ESM only; `.js` extensions in all relative imports.
- No `any` (use `unknown` + narrowing); no `console.log` (use `console.warn`/`console.error`).
- Prettier: semi, double quotes, 2-space indent, trailing commas, 100-char width.
- Conventional Commits; commit subject lowercase, scope is the package (`feat(api): ...`).
- Every new module has a co-located `*.test.ts`.
- Pre-commit runs eslint + prettier only (NOT tsc). Run `pnpm --filter <pkg> exec tsc --noEmit` for each touched package before committing.
- No schema change → no migration, no `db:check-drift`.
- `buildObserveGovernanceConfig` (from `@switchboard/schemas`) is the single source of the observe posture. Never hand-author the config object in product code.
- Safety invariant: the seeded config is observe-only and MUST never alter or block a reply. Two tests prove it (Task 5).
- Worktree: `.claude/worktrees/fix-alex-activation`, branch `fix/alex-activation`. Read/Edit via the worktree absolute path.

---

### Task 1: `deriveAlexGovernanceSeedContext`

A pure helper that maps an org's stored context to the `{jurisdiction, clinicType}` the seed needs. OrganizationConfig has no jurisdiction field; the only proxy is `businessHours.timezone`.

**Files:**

- Create: `apps/api/src/lib/alex-governance-seed-context.ts`
- Test: `apps/api/src/lib/__tests__/alex-governance-seed-context.test.ts`

**Interfaces:**

- Consumes: `ObserveGovernanceConfigInput` (`{ jurisdiction: "SG"|"MY"; clinicType: "medical"|"nonMedical" }`) from `@switchboard/schemas`.
- Produces: `deriveAlexGovernanceSeedContext(orgConfig: { businessHours?: unknown } | null | undefined): ObserveGovernanceConfigInput`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/lib/__tests__/alex-governance-seed-context.test.ts
import { describe, it, expect } from "vitest";
import { deriveAlexGovernanceSeedContext } from "../alex-governance-seed-context.js";

describe("deriveAlexGovernanceSeedContext", () => {
  it("defaults to SG/medical when orgConfig is null", () => {
    expect(deriveAlexGovernanceSeedContext(null)).toEqual({
      jurisdiction: "SG",
      clinicType: "medical",
    });
  });

  it("defaults to SG/medical when there is no timezone", () => {
    expect(deriveAlexGovernanceSeedContext({ businessHours: {} })).toEqual({
      jurisdiction: "SG",
      clinicType: "medical",
    });
  });

  it("maps a Singapore timezone to SG", () => {
    expect(
      deriveAlexGovernanceSeedContext({ businessHours: { timezone: "Asia/Singapore" } })
        .jurisdiction,
    ).toBe("SG");
  });

  it("maps a Kuala Lumpur timezone to MY", () => {
    expect(
      deriveAlexGovernanceSeedContext({ businessHours: { timezone: "Asia/Kuala_Lumpur" } })
        .jurisdiction,
    ).toBe("MY");
  });

  it("ignores a non-string timezone and defaults to SG", () => {
    expect(deriveAlexGovernanceSeedContext({ businessHours: { timezone: 123 } }).jurisdiction).toBe(
      "SG",
    );
  });

  it("always defaults clinicType to medical (no signal available)", () => {
    expect(
      deriveAlexGovernanceSeedContext({ businessHours: { timezone: "Asia/Kuala_Lumpur" } })
        .clinicType,
    ).toBe("medical");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/api exec vitest run src/lib/__tests__/alex-governance-seed-context.test.ts`
Expected: FAIL ("Cannot find module '../alex-governance-seed-context.js'").

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/api/src/lib/alex-governance-seed-context.ts
import type { ObserveGovernanceConfigInput } from "@switchboard/schemas";

/**
 * Derive the governance seed context (jurisdiction + clinicType) for a real org.
 *
 * OrganizationConfig stores no jurisdiction/clinicType field; the only proxy is
 * businessHours.timezone (often unset at provisioning). A Malaysian timezone maps
 * to "MY"; everything else defaults to "SG". clinicType has no signal, so it
 * defaults to "medical" (the stricter posture). In observe mode these values only
 * label telemetry and select the static rule list, so a defaulted value cannot
 * affect a live reply. Capturing the real values at onboarding is a follow-up.
 */
export function deriveAlexGovernanceSeedContext(
  orgConfig: { businessHours?: unknown } | null | undefined,
): ObserveGovernanceConfigInput {
  const timezone = readTimezone(orgConfig?.businessHours);
  const jurisdiction = timezone?.includes("Kuala_Lumpur") ? "MY" : "SG";
  return { jurisdiction, clinicType: "medical" };
}

function readTimezone(businessHours: unknown): string | undefined {
  if (typeof businessHours !== "object" || businessHours === null) return undefined;
  const tz = (businessHours as Record<string, unknown>)["timezone"];
  return typeof tz === "string" ? tz : undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/api exec vitest run src/lib/__tests__/alex-governance-seed-context.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @switchboard/api exec tsc --noEmit`
Expected: no errors.

```bash
git add apps/api/src/lib/alex-governance-seed-context.ts apps/api/src/lib/__tests__/alex-governance-seed-context.test.ts
git commit -m "feat(api): derive alex governance seed context from org timezone"
```

---

### Task 2: Seed observe `governanceConfig` in `ensureAlexListingForOrg`

Set the observe config on the `create` branch; backfill pre-existing deployments only when their `governanceConfig` is null. Never clobber an existing config.

**Files:**

- Modify: `apps/api/src/lib/ensure-alex-listing.ts`
- Test: `apps/api/src/lib/__tests__/ensure-alex-listing.test.ts`

**Interfaces:**

- Consumes: `buildObserveGovernanceConfig`, `ObserveGovernanceConfigInput` from `@switchboard/schemas`.
- Produces: `ensureAlexListingForOrg(orgId: string, db: PrismaDbClient, opts?: { governanceSeedContext?: ObserveGovernanceConfigInput }): Promise<{ listingId: string; deploymentId: string }>` (return shape unchanged).

- [ ] **Step 1: Write the failing tests** (replace the whole test file)

```ts
// apps/api/src/lib/__tests__/ensure-alex-listing.test.ts
import { describe, it, expect, vi } from "vitest";
import { ensureAlexListingForOrg } from "../ensure-alex-listing.js";
import { buildObserveGovernanceConfig } from "@switchboard/schemas";

type UpsertFn = ReturnType<typeof vi.fn>;

interface MockDb {
  agentListing: { upsert: UpsertFn };
  agentDeployment: { upsert: UpsertFn; update: UpsertFn };
}

type DeploymentRow = {
  id: string;
  organizationId: string;
  listingId: string;
  governanceConfig: unknown;
};

/**
 * Stateful in-memory mock that mimics the relevant Prisma upsert semantics:
 *  - agentListing: unique on slug (global)
 *  - agentDeployment: unique on (organizationId, listingId); stores governanceConfig
 *  - agentDeployment.update: mutates governanceConfig of the matching row (backfill)
 */
function buildStatefulMockDb(): MockDb & {
  listings: Map<string, { id: string; slug: string }>;
  deployments: Map<string, DeploymentRow>;
} {
  const listings = new Map<string, { id: string; slug: string }>();
  const deployments = new Map<string, DeploymentRow>();
  let listingSeq = 0;
  let deploymentSeq = 0;

  const agentListing = {
    upsert: vi.fn(async (args: { where: { slug: string }; create: { slug: string } }) => {
      const existing = listings.get(args.where.slug);
      if (existing) return existing;
      const created = { id: `listing_${++listingSeq}`, slug: args.create.slug };
      listings.set(args.create.slug, created);
      return created;
    }),
  };
  const agentDeployment = {
    upsert: vi.fn(
      async (args: {
        where: { organizationId_listingId: { organizationId: string; listingId: string } };
        create: { organizationId: string; listingId: string; governanceConfig?: unknown };
      }) => {
        const key = `${args.where.organizationId_listingId.organizationId}::${args.where.organizationId_listingId.listingId}`;
        const existing = deployments.get(key);
        if (existing) return existing;
        const created: DeploymentRow = {
          id: `deployment_${++deploymentSeq}`,
          organizationId: args.create.organizationId,
          listingId: args.create.listingId,
          governanceConfig: args.create.governanceConfig ?? null,
        };
        deployments.set(key, created);
        return created;
      },
    ),
    update: vi.fn(async (args: { where: { id: string }; data: { governanceConfig?: unknown } }) => {
      for (const dep of deployments.values()) {
        if (dep.id === args.where.id) {
          if (args.data.governanceConfig !== undefined)
            dep.governanceConfig = args.data.governanceConfig;
          return dep;
        }
      }
      throw new Error(`deployment ${args.where.id} not found`);
    }),
  };

  return { agentListing, agentDeployment, listings, deployments };
}

const OBSERVE_SG = buildObserveGovernanceConfig({ jurisdiction: "SG", clinicType: "medical" });

describe("ensureAlexListingForOrg", () => {
  it("first call creates listing and deployment, returns ids", async () => {
    const db = buildStatefulMockDb();
    const result = await ensureAlexListingForOrg("org_a", db as never);

    expect(result.listingId).toBe("listing_1");
    expect(result.deploymentId).toBe("deployment_1");
    expect(db.agentListing.upsert).toHaveBeenCalledTimes(1);
    expect(db.agentDeployment.upsert).toHaveBeenCalledTimes(1);

    expect(db.agentListing.upsert).toHaveBeenCalledWith({
      where: { slug: "alex-conversion" },
      create: {
        slug: "alex-conversion",
        name: "Alex",
        description: "AI-powered lead conversion agent",
        type: "ai-agent",
        status: "listed",
        trustScore: 0,
        autonomyLevel: "supervised",
        priceTier: "free",
        metadata: {},
      },
      update: {},
    });

    expect(db.agentDeployment.upsert).toHaveBeenCalledWith({
      where: { organizationId_listingId: { organizationId: "org_a", listingId: "listing_1" } },
      update: {},
      create: {
        organizationId: "org_a",
        listingId: "listing_1",
        status: "active",
        skillSlug: "alex",
        governanceConfig: OBSERVE_SG,
      },
    });
  });

  it("seeds an all-gates-observe governanceConfig on a new deployment (default SG/medical)", async () => {
    const db = buildStatefulMockDb();
    await ensureAlexListingForOrg("org_a", db as never);
    const dep = db.deployments.get("org_a::listing_1")!;
    expect(dep.governanceConfig).toEqual(OBSERVE_SG);
    expect(
      (dep.governanceConfig as { deterministicGate: { mode: string } }).deterministicGate.mode,
    ).toBe("observe");
    expect(db.agentDeployment.update).not.toHaveBeenCalled(); // create carried it; no backfill
  });

  it("threads a passed governanceSeedContext into the seeded config (MY/nonMedical)", async () => {
    const db = buildStatefulMockDb();
    await ensureAlexListingForOrg("org_my", db as never, {
      governanceSeedContext: { jurisdiction: "MY", clinicType: "nonMedical" },
    });
    const dep = db.deployments.get("org_my::listing_1")!;
    expect(dep.governanceConfig).toEqual(
      buildObserveGovernanceConfig({ jurisdiction: "MY", clinicType: "nonMedical" }),
    );
  });

  it("backfills a pre-existing deployment that has a null governanceConfig", async () => {
    const db = buildStatefulMockDb();
    db.listings.set("alex-conversion", { id: "listing_1", slug: "alex-conversion" });
    db.deployments.set("org_old::listing_1", {
      id: "dep_old",
      organizationId: "org_old",
      listingId: "listing_1",
      governanceConfig: null,
    });
    await ensureAlexListingForOrg("org_old", db as never);
    expect(db.deployments.get("org_old::listing_1")!.governanceConfig).toEqual(OBSERVE_SG);
    expect(db.agentDeployment.update).toHaveBeenCalledTimes(1);
  });

  it("never overwrites an existing governanceConfig (e.g. an operator enforce flip)", async () => {
    const db = buildStatefulMockDb();
    const enforceCfg = { ...OBSERVE_SG, deterministicGate: { mode: "enforce" } };
    db.listings.set("alex-conversion", { id: "listing_1", slug: "alex-conversion" });
    db.deployments.set("org_enf::listing_1", {
      id: "dep_enf",
      organizationId: "org_enf",
      listingId: "listing_1",
      governanceConfig: enforceCfg,
    });
    await ensureAlexListingForOrg("org_enf", db as never);
    expect(db.deployments.get("org_enf::listing_1")!.governanceConfig).toBe(enforceCfg);
    expect(db.agentDeployment.update).not.toHaveBeenCalled();
  });

  it("second call for the same org returns the same ids and does not duplicate rows", async () => {
    const db = buildStatefulMockDb();
    const first = await ensureAlexListingForOrg("org_a", db as never);
    const second = await ensureAlexListingForOrg("org_a", db as never);
    expect(second.listingId).toBe(first.listingId);
    expect(second.deploymentId).toBe(first.deploymentId);
    expect(db.listings.size).toBe(1);
    expect(db.deployments.size).toBe(1);
  });

  it("two different orgs share the global listing but get distinct deployments", async () => {
    const db = buildStatefulMockDb();
    const a = await ensureAlexListingForOrg("org_a", db as never);
    const b = await ensureAlexListingForOrg("org_b", db as never);
    expect(a.listingId).toBe(b.listingId);
    expect(a.deploymentId).not.toBe(b.deploymentId);
    expect(db.listings.size).toBe(1);
    expect(db.deployments.size).toBe(2);
  });

  it("accepts a transaction-client-shaped object (same upsert surface)", async () => {
    const tx = {
      agentListing: { upsert: vi.fn().mockResolvedValue({ id: "L_TX", slug: "alex-conversion" }) },
      agentDeployment: {
        upsert: vi.fn().mockResolvedValue({ id: "D_TX", governanceConfig: null }),
        update: vi.fn().mockResolvedValue({ id: "D_TX" }),
      },
    };
    const result = await ensureAlexListingForOrg("org_tx", tx as never);
    expect(result).toEqual({ listingId: "L_TX", deploymentId: "D_TX" });
    expect(tx.agentListing.upsert).toHaveBeenCalledTimes(1);
    expect(tx.agentDeployment.upsert).toHaveBeenCalledTimes(1);
    // Returned governanceConfig was null → guarded backfill ran once.
    expect(tx.agentDeployment.update).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/api exec vitest run src/lib/__tests__/ensure-alex-listing.test.ts`
Expected: FAIL (create payload missing `governanceConfig`; `db.agentDeployment.update` not called).

- [ ] **Step 3: Modify the implementation** (replace the whole file)

```ts
// apps/api/src/lib/ensure-alex-listing.ts
import type { PrismaDbClient } from "@switchboard/db";
import {
  buildObserveGovernanceConfig,
  type ObserveGovernanceConfigInput,
} from "@switchboard/schemas";

export interface EnsureAlexListingResult {
  listingId: string;
  deploymentId: string;
}

export interface EnsureAlexListingOptions {
  /**
   * Jurisdiction + clinicType used to build the seeded observe governanceConfig.
   * Defaults to SG/medical (the pilot posture) when omitted — safe because observe
   * never blocks a reply. Callers that know the org's context (GET /config via
   * deriveAlexGovernanceSeedContext) should pass it.
   */
  governanceSeedContext?: ObserveGovernanceConfigInput;
}

const DEFAULT_SEED_CONTEXT: ObserveGovernanceConfigInput = {
  jurisdiction: "SG",
  clinicType: "medical",
};

/**
 * Idempotently ensures the Alex listing exists (global, slug-keyed) and that the
 * given org has an active Alex deployment carrying an all-gates-observe
 * governanceConfig (P2-A activation). Used by the lazy OrganizationConfig upsert
 * and the provision route. Accepts a PrismaClient or a Prisma.TransactionClient.
 *
 * The observe governanceConfig turns the five afterSkill gates from "missing"
 * (inert pass-through) into telemetry-only. Observe never alters a reply, so this
 * is safe to seed unconditionally. Enforce is a deliberate per-org ops flip.
 */
export async function ensureAlexListingForOrg(
  orgId: string,
  db: PrismaDbClient,
  opts: EnsureAlexListingOptions = {},
): Promise<EnsureAlexListingResult> {
  const listing = await db.agentListing.upsert({
    where: { slug: "alex-conversion" },
    create: {
      slug: "alex-conversion",
      name: "Alex",
      description: "AI-powered lead conversion agent",
      type: "ai-agent",
      // Canonical published AgentListingStatus is "listed" (enum has no "active"
      // — that's a DeploymentStatus). The resolver gates on listing.status === "listed".
      status: "listed",
      trustScore: 0,
      autonomyLevel: "supervised",
      priceTier: "free",
      metadata: {},
    },
    update: {},
  });

  const governanceConfig = buildObserveGovernanceConfig(
    opts.governanceSeedContext ?? DEFAULT_SEED_CONTEXT,
  );

  const deployment = await db.agentDeployment.upsert({
    where: {
      organizationId_listingId: {
        organizationId: orgId,
        listingId: listing.id,
      },
    },
    update: {},
    create: {
      organizationId: orgId,
      listingId: listing.id,
      status: "active",
      skillSlug: "alex",
      governanceConfig,
    },
  });

  // Backfill pre-P2-A deployments (created before this seed existed, governanceConfig
  // null). Guarded on the upsert's returned value, so an operator's later enforce
  // config is never overwritten. A freshly-created deployment already carries the
  // config from `create`, so the guard short-circuits and the hot path is one write.
  if (deployment.governanceConfig === null || deployment.governanceConfig === undefined) {
    await db.agentDeployment.update({
      where: { id: deployment.id },
      data: { governanceConfig },
    });
  }

  return { listingId: listing.id, deploymentId: deployment.id };
}
```

Note: if tsc rejects `governanceConfig` against Prisma's `InputJsonValue`, the `ObserveGovernanceConfig` type alias is purpose-built to be assignable; if a friction surfaces, narrow with `governanceConfig: governanceConfig as object` is NOT sufficient for Prisma Json input — instead keep the value and, only if needed, import `Prisma` type and cast `as Prisma.InputJsonValue`. Verify with the typecheck step before reaching for a cast.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/api exec vitest run src/lib/__tests__/ensure-alex-listing.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @switchboard/api exec tsc --noEmit`
Expected: no errors.

```bash
git add apps/api/src/lib/ensure-alex-listing.ts apps/api/src/lib/__tests__/ensure-alex-listing.test.ts
git commit -m "feat(api): seed observe governanceConfig on alex provisioning (P2-A)"
```

---

### Task 3: Wire GET /config to pass the derived seed context

**Files:**

- Modify: `apps/api/src/routes/organizations.ts` (import + the `ensureAlexListingForOrg` call ~line 76)
- Test: `apps/api/src/__tests__/api-organizations.test.ts` (extend mock + add assertion)

**Interfaces:**

- Consumes: `deriveAlexGovernanceSeedContext` (Task 1), `ensureAlexListingForOrg` 3rd-arg `opts` (Task 2).

- [ ] **Step 1: Update the route test mock + add the seam assertion**

In `apps/api/src/__tests__/api-organizations.test.ts`:

(a) Add the import near the top (after line 17):

```ts
import { buildObserveGovernanceConfig } from "@switchboard/schemas";
```

(b) In `beforeEach`, replace the agentDeployment.upsert default (line 66) so the backfill guard short-circuits (returned config is non-null), and add an `update` spy for safety:

```ts
mockPrisma.agentDeployment.upsert.mockResolvedValue({
  id: "deployment_alex",
  governanceConfig: buildObserveGovernanceConfig({ jurisdiction: "SG", clinicType: "medical" }),
});
```

Also add an `update` method to the `agentDeployment` mock object (line 47-49):

```ts
    agentDeployment: {
      upsert: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
```

(c) Add a test inside `describe("GET /api/organizations/:orgId/config", ...)`:

```ts
it("seeds an all-gates-observe governanceConfig on the Alex deployment (P2-A)", async () => {
  mockPrisma.organizationConfig.upsert.mockResolvedValue({
    id: "org_test",
    name: "Test Org",
    businessHours: null,
  });

  const res = await app.inject({ method: "GET", url: "/api/organizations/org_test/config" });

  expect(res.statusCode).toBe(200);
  const upsertArg = mockPrisma.agentDeployment.upsert.mock.calls[0][0] as {
    create: { governanceConfig: { deterministicGate: { mode: string }; jurisdiction: string } };
  };
  expect(upsertArg.create.governanceConfig.deterministicGate.mode).toBe("observe");
  expect(upsertArg.create.governanceConfig.jurisdiction).toBe("SG");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/api exec vitest run src/__tests__/api-organizations.test.ts -t "seeds an all-gates-observe"`
Expected: FAIL (create payload has no governanceConfig yet — the route still calls the 2-arg form).

- [ ] **Step 3: Wire the route**

In `apps/api/src/routes/organizations.ts`, add the import after line 16:

```ts
import { deriveAlexGovernanceSeedContext } from "../lib/alex-governance-seed-context.js";
```

Replace the call at line 76:

```ts
await ensureAlexListingForOrg(orgId, app.prisma, {
  governanceSeedContext: deriveAlexGovernanceSeedContext(config),
});
```

- [ ] **Step 4: Run the full route suite to verify pass + no regressions**

Run: `pnpm --filter @switchboard/api exec vitest run src/__tests__/api-organizations.test.ts`
Expected: PASS (all, including the new test). If a provision-route test fails because its tx `agentDeployment.upsert` mock returns a row without `governanceConfig` (guard then calls `tx.agentDeployment.update`), add `governanceConfig: buildObserveGovernanceConfig({ jurisdiction: "SG", clinicType: "medical" })` to that mock's resolved value so the guard short-circuits.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @switchboard/api exec tsc --noEmit`
Expected: no errors.

```bash
git add apps/api/src/routes/organizations.ts apps/api/src/__tests__/api-organizations.test.ts
git commit -m "feat(api): pass derived governance seed context from config provisioning"
```

---

### Task 4: Advisory `governance-config-seeded` readiness check

Surface, at the operator readiness surface, whether governance telemetry is active. Advisory (non-blocking): a missing config does not stop safe operation.

**Files:**

- Modify: `apps/api/src/routes/readiness.ts`
- Test: `apps/api/src/routes/__tests__/readiness.test.ts`

**Interfaces:**

- Consumes: `GovernanceConfigSchema` from `@switchboard/schemas`; `buildObserveGovernanceConfig` (tests).
- Produces: `ReadinessContext.governanceActivated: boolean`; a new check with `id: "governance-config-seeded"`, `blocking: false`.

- [ ] **Step 1: Write the failing tests**

In `apps/api/src/routes/__tests__/readiness.test.ts`:

(a) Add the import (line 2 area):

```ts
import { buildObserveGovernanceConfig } from "@switchboard/schemas";
```

(b) In `makeContext`, add to the defaults (after `proactiveGovernanceSeeded: true,`):

```ts
    governanceActivated: true,
```

(c) Extend `makePrismaMock` to accept a `deploymentRow` and return it from `agentDeployment.findFirst`:

```ts
function makePrismaMock(
  opts: {
    knowledgeRow?: { content: string } | null;
    policyRow?: { active: boolean } | null;
    deploymentRow?: {
      id: string;
      status: string;
      skillSlug: string | null;
      organizationId: string;
      listingId: string;
      governanceConfig: unknown;
    } | null;
  } = {},
): PrismaLike {
  const row = opts.knowledgeRow === undefined ? { content: "x".repeat(80) } : opts.knowledgeRow;
  const policyRow = opts.policyRow === undefined ? { active: true } : opts.policyRow;
  const deploymentRow = opts.deploymentRow === undefined ? null : opts.deploymentRow;
  return {
    managedChannel: { findMany: async () => [] },
    connection: { findMany: async () => [] },
    agentDeployment: { findFirst: async () => deploymentRow },
    organizationConfig: { findUnique: async () => null },
    businessConfig: { findUnique: async () => null },
    deploymentConnection: { findMany: async () => [] },
    dashboardUser: { findFirst: async () => null },
    knowledgeEntry: { findFirst: async () => row },
    policy: { findUnique: async () => policyRow },
  } as unknown as PrismaLike;
}
```

(d) Add the pure-check + context-builder test blocks (place after the proactive-governance describe blocks):

```ts
describe("governance-config-seeded (advisory)", () => {
  it("passes when a governanceConfig is activated", () => {
    const report = checkReadiness(makeContext({ governanceActivated: true }));
    const check = report.checks.find((c) => c.id === "governance-config-seeded")!;
    expect(check.status).toBe("pass");
    expect(check.blocking).toBe(false);
  });

  it("fails (advisory, non-blocking) when governance is not activated — ready stays true", () => {
    const report = checkReadiness(makeContext({ governanceActivated: false }));
    const check = report.checks.find((c) => c.id === "governance-config-seeded")!;
    expect(check.status).toBe("fail");
    expect(check.blocking).toBe(false);
    expect(report.ready).toBe(true);
  });

  it("message never leaks gate internals", () => {
    const report = checkReadiness(makeContext({ governanceActivated: false }));
    const check = report.checks.find((c) => c.id === "governance-config-seeded")!;
    expect(check.message).not.toContain("deterministicGate");
    expect(check.message).not.toContain("enforce");
  });
});

describe("buildReadinessContext — governance config", () => {
  const seededDep = {
    id: "dep-1",
    status: "active",
    skillSlug: "alex",
    organizationId: "org_demo",
    listingId: "l1",
    governanceConfig: buildObserveGovernanceConfig({ jurisdiction: "SG", clinicType: "medical" }),
  };

  it("sets governanceActivated=true when the deployment has a valid observe config", async () => {
    const ctx = await buildReadinessContext(
      makePrismaMock({ deploymentRow: seededDep }),
      "org_demo",
    );
    expect(ctx.governanceActivated).toBe(true);
  });

  it("sets governanceActivated=false when the deployment governanceConfig is null", async () => {
    const ctx = await buildReadinessContext(
      makePrismaMock({ deploymentRow: { ...seededDep, governanceConfig: null } }),
      "org_demo",
    );
    expect(ctx.governanceActivated).toBe(false);
  });

  it("sets governanceActivated=false when there is no deployment", async () => {
    const ctx = await buildReadinessContext(makePrismaMock({ deploymentRow: null }), "org_demo");
    expect(ctx.governanceActivated).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/api exec vitest run src/routes/__tests__/readiness.test.ts`
Expected: FAIL (`governanceActivated` not on ReadinessContext; no `governance-config-seeded` check).

- [ ] **Step 3: Implement the readiness changes**

In `apps/api/src/routes/readiness.ts`:

(a) Add the schemas import (after the `@switchboard/db` import block):

```ts
import { GovernanceConfigSchema } from "@switchboard/schemas";
```

(b) In `PrismaLike.agentDeployment.findFirst`, add `governanceConfig: true` to the `select` and `governanceConfig: unknown` to the return type:

```ts
  agentDeployment: {
    findFirst(args: {
      where: { organizationId: string; skillSlug: string };
      select: {
        id: true;
        status: true;
        skillSlug: true;
        organizationId: true;
        listingId: true;
        governanceConfig: true;
      };
    }): Promise<{
      id: string;
      status: string;
      skillSlug: string | null;
      organizationId: string;
      listingId: string;
      governanceConfig: unknown;
    } | null>;
  };
```

(c) Add `governanceActivated: boolean;` to the `ReadinessContext` interface (after `proactiveGovernanceSeeded: boolean;`):

```ts
// True iff the Alex deployment carries a valid governanceConfig (the resolver would
// return "resolved", so the five afterSkill gates run as telemetry). When false the
// gates resolve "missing" and pass through — the agent still operates, but no
// governance signal is recorded. Advisory only; seeded on the next agent-config load.
governanceActivated: boolean;
```

(d) In `buildReadinessContext`, add `governanceConfig: true` to the agentDeployment select inside the `Promise.all` (the `prisma.agentDeployment.findFirst` select), then compute `governanceActivated` after the deployment is resolved (before the `return`):

```ts
const governanceActivated = deployment
  ? GovernanceConfigSchema.safeParse(deployment.governanceConfig).success
  : false;
```

And add `governanceActivated,` to the returned object.

(e) In `checkReadiness`, add the check after `checkProactiveGovernanceSeeded` (index 14):

```ts
// 14. governance-config-seeded (advisory)
checks.push(checkGovernanceConfigSeeded(ctx));
```

(f) Add the check function (next to `checkProactiveGovernanceSeeded`):

```ts
function checkGovernanceConfigSeeded(ctx: ReadinessContext): ReadinessCheck {
  const id = "governance-config-seeded";
  const label = "Governance monitoring active";
  // Advisory: a missing governanceConfig means the afterSkill gates resolve "missing"
  // and pass through (the agent still operates safely), so this never hard-blocks
  // go-live. It surfaces that governance telemetry (claim / price / consent / window
  // checks) is not yet recording. Self-heals on the next agent-config load, which
  // seeds the observe posture. Message never leaks gate internals.
  const blocking = false;
  return {
    id,
    label,
    blocking,
    status: ctx.governanceActivated ? "pass" : "fail",
    message: ctx.governanceActivated
      ? "Governance monitoring is active (observe) — claim, price, consent and messaging checks are logging"
      : "Governance monitoring isn't active yet — reload your agent configuration to enable claim, price and consent checks.",
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/api exec vitest run src/routes/__tests__/readiness.test.ts`
Expected: PASS (all, including the new blocks). The default `makeContext` now includes `governanceActivated: true`, so the "all checks pass" test stays green.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @switchboard/api exec tsc --noEmit`
Expected: no errors.

```bash
git add apps/api/src/routes/readiness.ts apps/api/src/routes/__tests__/readiness.test.ts
git commit -m "feat(api): add advisory governance-config-seeded readiness check"
```

---

### Task 5: Prove inertness (structural + behavioural)

Two safety proofs that the seeded config cannot block a reply.

**Files:**

- Test: `packages/schemas/src/governance-config.test.ts` (parity)
- Test: `packages/core/src/skill-runtime/hooks/__tests__/price-claim-gate.test.ts` (behavioural)

- [ ] **Step 1: Add the structural parity test**

Inside the existing `describe("buildObserveGovernanceConfig", ...)` block in `packages/schemas/src/governance-config.test.ts`:

```ts
it("never puts any gate in enforce (P2-A: the seeded posture cannot block)", () => {
  const parsed = GovernanceConfigSchema.parse(cfg);
  expect(resolveGovernanceMode(parsed)).not.toBe("enforce");
  expect(resolveClaimClassifierConfig(parsed).mode).not.toBe("enforce");
  expect(resolveConsentStateConfig(parsed).mode).not.toBe("enforce");
  expect(cfg.whatsappWindow.mode).not.toBe("enforce");
  // Structural sweep: no "enforce" string anywhere in the serialized config.
  expect(JSON.stringify(cfg)).not.toContain("enforce");
});
```

- [ ] **Step 2: Add the behavioural inertness test**

In `packages/core/src/skill-runtime/hooks/__tests__/price-claim-gate.test.ts`, add the import:

```ts
import { buildObserveGovernanceConfig } from "@switchboard/schemas";
```

Add inside `describe("PriceClaimGateHook.afterSkill", ...)`:

```ts
it("P2-A inertness: the seeded observe config never blocks, even with zero approved prices", async () => {
  const { deps, spies } = buildDeps({
    resolver: async () => ({
      status: "resolved" as const,
      config: buildObserveGovernanceConfig({ jurisdiction: "SG", clinicType: "medical" }),
    }),
    approvedPrices: [], // worst case: the org has no approved prices yet
  });
  const hook = new PriceClaimGateHook(deps);
  const { ctx, result } = makeCtxAndResult("Our HydraFacial is $250.");
  await hook.afterSkill(ctx, result);

  // Telemetry only: response unchanged, no handoff, no status flip.
  expect(result.response).toBe("Our HydraFacial is $250.");
  expect(spies.conversationStore.setConversationStatus).not.toHaveBeenCalled();
  expect(spies.handoffStore.save).not.toHaveBeenCalled();
  // A verdict IS recorded (observe = log) with action "allow".
  expect(spies.verdictStore.save).toHaveBeenCalledWith(
    expect.objectContaining({ action: "allow", sourceGuard: "price_gate" }),
  );
});
```

Note: if tsc rejects `config: buildObserveGovernanceConfig(...)` against the resolver's `GovernanceConfig` return type, import the type (`import type { GovernanceConfig } from "@switchboard/schemas"`) and cast `as GovernanceConfig`. Verify with typecheck first.

- [ ] **Step 3: Run both test files to verify the new tests pass**

Run: `pnpm --filter @switchboard/schemas exec vitest run src/governance-config.test.ts`
Run: `pnpm --filter @switchboard/core exec vitest run src/skill-runtime/hooks/__tests__/price-claim-gate.test.ts`
Expected: PASS (both files, including the new cases).

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm --filter @switchboard/schemas exec tsc --noEmit && pnpm --filter @switchboard/core exec tsc --noEmit`
Expected: no errors.

```bash
git add packages/schemas/src/governance-config.test.ts packages/core/src/skill-runtime/hooks/__tests__/price-claim-gate.test.ts
git commit -m "test(core,schemas): prove the seeded observe governance config is inert"
```

---

### Task 6: Full verification

**Files:** none (verification gate).

- [ ] **Step 1: Typecheck the whole monorepo**

Run: `pnpm typecheck`
Expected: all packages pass. If it reports missing exports from a lower package, run `pnpm reset` first (stale dist), then re-run.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: 0 errors.

- [ ] **Step 3: Full test suite**

Run: `pnpm test`
Expected: all green. Investigate any failure against the touched files (most likely an over-specified mock in an api test that returns a deployment without `governanceConfig`; add the observe config to its resolved value).

- [ ] **Step 4: Update the loop-state notes** (working notes, not committed)

Mark Tasks 1-5 done in `.claude/alex-activation-loop-state.md`.

---

## Self-Review

**Spec coverage:**

- Decision (a) OBSERVE default → Task 2 seeds `buildObserveGovernanceConfig`. ✓
- Decision (b) seed governanceConfig only → Task 2 (no business-facts fabrication). ✓
- Decision (c) home = `ensureAlexListingForOrg`, create + guarded backfill → Task 2. ✓
- Decision (e) derive jurisdiction/clinicType → Task 1, wired in Task 3. ✓
- Readiness component → Task 4. ✓
- Safety inertness (structural + behavioural) → Task 5. ✓
- Coordination with F3 (decision d): no code; the same factory is reused later. No task needed. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code; commands have expected output. ✓

**Type consistency:** `ObserveGovernanceConfigInput` (Task 1 produces, Task 2 consumes), `EnsureAlexListingOptions.governanceSeedContext` (Task 2 produces, Task 3 consumes), `ReadinessContext.governanceActivated` (Task 4 produces + consumes), `buildObserveGovernanceConfig` used identically across Tasks 2/3/4/5. ✓
