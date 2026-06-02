# BusinessFacts Source-of-Truth Unification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make operator-entered medspa BusinessFacts actually reach live Alex by unifying on the per-org `BusinessConfig.config` the runtime already reads — with a canonical writer route, seed, backfill, render fix, graceful degrade, and a non-blocking readiness warning.

**Architecture:** `BusinessConfig.config` (per-org) is canonical. The runtime read path (`PrismaBusinessFactsStore.get` → `alexBuilder` → `renderBusinessFacts`) is unchanged except for `safeParse`-based degradation. The orphaned `inputConfig.businessFacts` write path is redirected to a new org-scoped API route backed by the store; existing data is backfilled by an idempotent SQL migration. A non-blocking readiness check surfaces missing/malformed facts. **`builders/alex.ts` and `SKILL.md` are not touched.**

**Tech Stack:** TypeScript (ESM, `.js` import suffixes outside Next), pnpm + Turborepo, Prisma/Postgres, Zod, Fastify, Next.js, Vitest 2.1.

**Spec:** `docs/superpowers/specs/2026-06-02-alex-business-facts-unification-design.md`

**Base:** `origin/main` @ `c213e370` (post-#799/#794). Run all commands from the worktree root `.claude/worktrees/alex-business-facts-unify`.

---

## File structure

| File                                                                                 | Responsibility                                                     | Action |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ------ |
| `packages/db/src/stores/prisma-business-facts-store.ts`                              | `classifyBusinessFacts` + `getWithStatus` + validate-or-null `get` | Modify |
| `packages/db/src/index.ts`                                                           | Export `classifyBusinessFacts`/types                               | Modify |
| `packages/core/src/skill-runtime/context-resolver.ts`                                | Render `advanceBookingDays`                                        | Modify |
| `packages/core/src/index.ts`                                                         | Narrow root export of `alexBuilder` for the integration test       | Modify |
| `apps/api/src/routes/marketplace.ts`                                                 | Canonical org-scoped `GET`/`PUT …/business-facts`                  | Modify |
| `apps/dashboard/src/lib/api-client/marketplace.ts`                                   | Point client at the canonical route                                | Modify |
| `apps/dashboard/.../deployments/[id]/business-facts/route.ts`                        | Pass `status` through                                              | Modify |
| `packages/db/prisma/seed-marketplace.ts`                                             | Seed a complete medspa facts blob                                  | Modify |
| `packages/db/prisma/migrations/20260602140000_backfill_business_facts/migration.sql` | Guarded idempotent backfill                                        | Create |
| `apps/api/src/routes/readiness.ts`                                                   | Non-blocking `business-facts-present` check                        | Modify |
| `apps/api/src/__tests__/alex-business-facts-live-path.test.ts`                       | Production-path proof (real store + real builder)                  | Create |

Test files modified: `prisma-business-facts-store.test.ts`, `context-resolver.test.ts`, `builders/alex.test.ts`, `readiness.test.ts`; created: `marketplace-business-facts.test.ts`, `alex-business-facts-live-path.test.ts`.

**Verified facts (no need to re-discover):** `alexBuilder` is exported from `packages/core/src/skill-runtime/index.ts` but **NOT** from the core root — Task 8 adds the root export. `BusinessConfig` (schema.prisma:563) columns are `id`(String→text), `organizationId`(unique), `config`(Json→jsonb), `activeVersionId`(nullable), `createdAt`, `updatedAt`; `id` has no DB default. The marketplace route auth accessor is `request.organizationIdFromAuth`; sibling `/deployments/:id` routes return 403 on org mismatch — this new write surface deliberately returns **404** (no existence leak).

---

## Task 1: Store — validate-or-null read + status classifier

**Files:**

- Modify: `packages/db/src/stores/prisma-business-facts-store.ts`
- Modify: `packages/db/src/index.ts:107`
- Test: `packages/db/src/stores/__tests__/prisma-business-facts-store.test.ts`

- [ ] **Step 1: Write the failing tests.** Append these `describe` blocks inside the top-level `describe("PrismaBusinessFactsStore", …)` (after the existing `upsert` describe):

```ts
describe("getWithStatus", () => {
  it("returns 'present' with parsed facts for a valid config", async () => {
    const facts = makeFacts();
    prisma.businessConfig.findUnique.mockResolvedValue({ organizationId: "org_1", config: facts });
    const result = await store.getWithStatus("org_1");
    expect(result.status).toBe("present");
    expect(result.facts).toEqual(facts);
  });

  it("returns 'missing' when no row exists", async () => {
    prisma.businessConfig.findUnique.mockResolvedValue(null);
    const result = await store.getWithStatus("org_1");
    expect(result.status).toBe("missing");
    expect(result.facts).toBeNull();
  });

  it("returns 'missing' when config is an empty object", async () => {
    prisma.businessConfig.findUnique.mockResolvedValue({ organizationId: "org_1", config: {} });
    expect((await store.getWithStatus("org_1")).status).toBe("missing");
  });

  it("returns 'malformed' (not missing) for a non-object array config", async () => {
    prisma.businessConfig.findUnique.mockResolvedValue({ organizationId: "org_1", config: [] });
    expect((await store.getWithStatus("org_1")).status).toBe("malformed");
  });

  it("returns 'malformed' with sanitized issues for an invalid config", async () => {
    prisma.businessConfig.findUnique.mockResolvedValue({
      organizationId: "org_1",
      config: { businessName: "X" },
    });
    const result = await store.getWithStatus("org_1");
    expect(result.status).toBe("malformed");
    expect(result.facts).toBeNull();
    expect(result.issues && result.issues.length).toBeGreaterThan(0);
  });
});

describe("get (runtime degrade)", () => {
  it("returns null and warns (sanitized: issues only, never the raw config)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    prisma.businessConfig.findUnique.mockResolvedValue({
      organizationId: "org_1",
      config: {
        businessName: "X",
        escalationContact: { name: "A", channel: "whatsapp", address: "+65SECRET999" },
      },
    });
    const result = await store.get("org_1");
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "[BusinessFacts] malformed BusinessConfig.config",
      expect.objectContaining({
        organizationId: "org_1",
        issues: expect.arrayContaining([
          expect.objectContaining({ path: expect.any(String), code: expect.any(String) }),
        ]),
      }),
    );
    // the raw config (phone) must NOT appear in ANY warn call
    expect(JSON.stringify(warn.mock.calls)).not.toContain("+65SECRET999");
    warn.mockRestore();
  });
});
```

- [ ] **Step 2: Run to verify failure.**

Run: `pnpm --filter @switchboard/db test prisma-business-facts-store`
Expected: FAIL — `store.getWithStatus is not a function`.

- [ ] **Step 3: Implement the store.** Replace the entire contents of `packages/db/src/stores/prisma-business-facts-store.ts` with:

```ts
import type { PrismaClient } from "@prisma/client";
import { BusinessFactsSchema, type BusinessFacts } from "@switchboard/schemas";

export type BusinessFactsStatus = "present" | "missing" | "malformed";

export interface BusinessFactsResult {
  facts: BusinessFacts | null;
  status: BusinessFactsStatus;
  issues?: Array<{ path: string; code: string }>;
}

/**
 * Pure classifier shared by the store and the readiness gate so both decide
 * present | missing | malformed identically. No DB access.
 * Note: arrays and other non-plain-object JSON fall through to safeParse and
 * are reported as `malformed` (a better diagnostic than `missing`).
 */
export function classifyBusinessFacts(config: unknown): BusinessFactsResult {
  const isEmptyObject =
    typeof config === "object" &&
    config !== null &&
    !Array.isArray(config) &&
    Object.keys(config as Record<string, unknown>).length === 0;

  if (config == null || isEmptyObject) {
    return { facts: null, status: "missing" };
  }

  const parsed = BusinessFactsSchema.safeParse(config);
  if (!parsed.success) {
    return {
      facts: null,
      status: "malformed",
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), code: i.code })),
    };
  }
  return { facts: parsed.data, status: "present" };
}

export class PrismaBusinessFactsStore {
  constructor(private prisma: PrismaClient) {}

  /** Fetch + classify without side effects (used by the API route + readiness). */
  async getWithStatus(organizationId: string): Promise<BusinessFactsResult> {
    const row = await this.prisma.businessConfig.findUnique({ where: { organizationId } });
    return classifyBusinessFacts(row?.config ?? null);
  }

  /**
   * Runtime read for the live Alex path. A malformed row degrades to null
   * (Alex escalates politely) instead of throwing mid-turn. Warns WITHOUT
   * dumping the raw config (it holds phones / addresses / escalation contacts).
   */
  async get(organizationId: string): Promise<BusinessFacts | null> {
    const result = await this.getWithStatus(organizationId);
    if (result.status === "malformed") {
      console.warn("[BusinessFacts] malformed BusinessConfig.config", {
        organizationId,
        issues: result.issues,
      });
    }
    return result.facts;
  }

  async upsert(organizationId: string, facts: BusinessFacts): Promise<void> {
    await this.prisma.businessConfig.upsert({
      where: { organizationId },
      create: { organizationId, config: facts as object },
      update: { config: facts as object },
    });
  }
}
```

- [ ] **Step 4: Export the classifier.** In `packages/db/src/index.ts`, replace line 107:

```ts
export { PrismaBusinessFactsStore } from "./stores/prisma-business-facts-store.js";
```

with:

```ts
export {
  PrismaBusinessFactsStore,
  classifyBusinessFacts,
  type BusinessFactsStatus,
  type BusinessFactsResult,
} from "./stores/prisma-business-facts-store.js";
```

- [ ] **Step 5: Run to verify pass.**

Run: `pnpm --filter @switchboard/db test prisma-business-facts-store`
Expected: PASS (the pre-existing `get`/`upsert` tests still pass — `makeFacts()` is schema-complete, so `safeParse` round-trips equal).

- [ ] **Step 6: Commit.**

```bash
git add packages/db/src/stores/prisma-business-facts-store.ts packages/db/src/index.ts packages/db/src/stores/__tests__/prisma-business-facts-store.test.ts
git commit -m "fix(db): validate-or-null business facts read + status classifier"
```

---

## Task 2: Render — `advanceBookingDays`

**Files:**

- Modify: `packages/core/src/skill-runtime/context-resolver.ts` (the `bookingPolicies` block, ~line 53-59)
- Test: `packages/core/src/skill-runtime/__tests__/context-resolver.test.ts`

- [ ] **Step 1: Write the failing tests.** In `context-resolver.test.ts`, add `renderBusinessFacts` to the existing import from `../context-resolver.js`, then add at the end of the file:

```ts
describe("renderBusinessFacts — advanceBookingDays", () => {
  it("renders advanceBookingDays as non-promissory context", () => {
    const facts = makeFacts();
    facts.bookingPolicies = { advanceBookingDays: 60 };
    expect(renderBusinessFacts(facts)).toContain(
      "Advance booking: up to 60 days ahead (subject to availability)",
    );
  });

  it("omits the advance-booking line when not set", () => {
    const facts = makeFacts();
    facts.bookingPolicies = { cancellationPolicy: "24 hours notice required" };
    expect(renderBusinessFacts(facts)).not.toContain("Advance booking");
  });
});
```

- [ ] **Step 2: Run to verify failure.**

Run: `pnpm --filter @switchboard/core test context-resolver`
Expected: FAIL — output lacks the "Advance booking" line.

- [ ] **Step 3: Implement.** In `context-resolver.ts`, inside `if (facts.bookingPolicies) { … }`, insert after the `noShowPolicy` line:

```ts
if (bp.noShowPolicy) lines.push(`No-show: ${bp.noShowPolicy}`);
if (bp.advanceBookingDays)
  lines.push(
    `Advance booking: up to ${bp.advanceBookingDays} days ahead (subject to availability)`,
  );
if (bp.prepInstructions) lines.push(`Prep: ${bp.prepInstructions}`);
```

- [ ] **Step 4: Run to verify pass.**

Run: `pnpm --filter @switchboard/core test context-resolver`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/skill-runtime/context-resolver.ts packages/core/src/skill-runtime/__tests__/context-resolver.test.ts
git commit -m "fix(core): render advanceBookingDays in business facts"
```

---

## Task 3: API — canonical org-scoped business-facts route + authz

**Files:**

- Modify: `apps/api/src/routes/marketplace.ts` (imports lines 8-22; add routes after line 317)
- Test: `apps/api/src/routes/__tests__/marketplace-business-facts.test.ts` (create)

- [ ] **Step 1: Write the failing test.** Create `apps/api/src/routes/__tests__/marketplace-business-facts.test.ts`. This uses `app.inject`; the db mock uses `importOriginal` and overrides **only** the two stores we touch (so it does not break when unrelated db imports change), and the auth org is set on the request in a hook (the real auth plugin decorates it; a bare test app does not, so we set it directly):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

const mockDeploymentStore = { findById: vi.fn() };
const mockBusinessFactsStore = { getWithStatus: vi.fn(), upsert: vi.fn() };

vi.mock("@switchboard/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@switchboard/db")>()),
  PrismaDeploymentStore: vi.fn(() => mockDeploymentStore),
  PrismaBusinessFactsStore: vi.fn(() => mockBusinessFactsStore),
}));

import { marketplaceRoutes } from "../marketplace.js";

// Schema-complete fixture (closed/currency have defaults, but be explicit).
const VALID_FACTS = {
  businessName: "Glow Aesthetics",
  timezone: "Asia/Singapore",
  locations: [{ name: "Orchard", address: "391 Orchard Rd" }],
  openingHours: { monday: { open: "10:00", close: "20:00", closed: false } },
  services: [{ name: "Botox", description: "Anti-wrinkle", currency: "SGD" }],
  escalationContact: { name: "Front desk", channel: "whatsapp", address: "+6560000000" },
  additionalFaqs: [],
};

function buildApp(orgId: string | null): FastifyInstance {
  const app = Fastify();
  app.decorate("prisma", {} as never);
  app.addHook("onRequest", async (req) => {
    (req as unknown as { organizationIdFromAuth: string | null }).organizationIdFromAuth = orgId;
  });
  app.register(marketplaceRoutes);
  return app;
}

describe("PUT /deployments/:id/business-facts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists valid facts keyed to the authenticated org", async () => {
    mockDeploymentStore.findById.mockResolvedValue({ id: "dep-1", organizationId: "org-1" });
    const app = buildApp("org-1");
    const res = await app.inject({
      method: "PUT",
      url: "/deployments/dep-1/business-facts",
      payload: VALID_FACTS,
    });
    expect(res.statusCode).toBe(200);
    expect(mockBusinessFactsStore.upsert).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ businessName: "Glow Aesthetics" }),
    );
    await app.close();
  });

  it("rejects a cross-org deployment id (404, no existence leak) and does NOT write", async () => {
    mockDeploymentStore.findById.mockResolvedValue({ id: "dep-1", organizationId: "org-OTHER" });
    const app = buildApp("org-1");
    const res = await app.inject({
      method: "PUT",
      url: "/deployments/dep-1/business-facts",
      payload: VALID_FACTS,
    });
    expect(res.statusCode).toBe(404);
    expect(mockBusinessFactsStore.upsert).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects invalid facts (400) and does NOT write", async () => {
    mockDeploymentStore.findById.mockResolvedValue({ id: "dep-1", organizationId: "org-1" });
    const app = buildApp("org-1");
    const res = await app.inject({
      method: "PUT",
      url: "/deployments/dep-1/business-facts",
      payload: { businessName: "X" },
    });
    expect(res.statusCode).toBe(400);
    expect(mockBusinessFactsStore.upsert).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("GET /deployments/:id/business-facts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns { config, status }", async () => {
    mockDeploymentStore.findById.mockResolvedValue({ id: "dep-1", organizationId: "org-1" });
    mockBusinessFactsStore.getWithStatus.mockResolvedValue({
      facts: VALID_FACTS,
      status: "present",
    });
    const app = buildApp("org-1");
    const res = await app.inject({ method: "GET", url: "/deployments/dep-1/business-facts" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ config: VALID_FACTS, status: "present" });
    await app.close();
  });
});
```

> **Harness fallback:** if Fastify rejects reading `request.organizationIdFromAuth` (e.g. a missing `decorateRequest` in this app version), add `app.decorateRequest("organizationIdFromAuth", null);` before the hook, or register the project's auth plugin/test helper instead of hand-rolling. Do **not** drop the cross-org/authz assertions.

- [ ] **Step 2: Run to verify failure.**

Run: `pnpm --filter @switchboard/api test marketplace-business-facts`
Expected: FAIL — 404 for the valid PUT (route not registered) and `upsert` never called.

- [ ] **Step 3: Implement.** In `apps/api/src/routes/marketplace.ts`:

(a) Add `PrismaBusinessFactsStore` to the `@switchboard/db` import block (lines 8-17):

```ts
  PrismaExecutionTraceStore,
  PrismaBusinessFactsStore,
  encryptCredentials,
```

(b) Add a value import for the schema after line 22:

```ts
import { BusinessFactsSchema } from "@switchboard/schemas";
```

(c) Insert the two routes immediately after the `app.patch(... "/deployments/:id" ...)` handler closes (after line 317, before `// ── Tasks ──`):

```ts
// ── Business Facts (canonical per-org clinic knowledge) ──
// BusinessFacts are ORG-LEVEL clinic facts. The :id (deployment) is used ONLY
// to anchor org ownership through the existing marketplace auth model; the
// write is keyed to the authenticated org, never to caller-supplied input.
// On org mismatch this surface returns 404 (not 403 like the sibling
// /deployments/:id routes) so it never confirms another org's deployment exists.

app.get<{ Params: { id: string } }>("/deployments/:id/business-facts", async (request, reply) => {
  if (!app.prisma) {
    return reply.code(503).send({ error: "Database not available", statusCode: 503 });
  }
  const orgId = request.organizationIdFromAuth;
  if (!orgId) {
    return reply.code(401).send({ error: "Authentication required", statusCode: 401 });
  }
  const { id } = request.params;
  const deployment = await new PrismaDeploymentStore(app.prisma).findById(id);
  if (!deployment || deployment.organizationId !== orgId) {
    return reply.code(404).send({ error: "Deployment not found", statusCode: 404 });
  }
  const { facts, status } = await new PrismaBusinessFactsStore(app.prisma).getWithStatus(orgId);
  return reply.send({ config: facts, status });
});

app.put<{ Params: { id: string }; Body: unknown }>(
  "/deployments/:id/business-facts",
  async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }
    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.code(401).send({ error: "Authentication required", statusCode: 401 });
    }
    const { id } = request.params;
    const deployment = await new PrismaDeploymentStore(app.prisma).findById(id);
    if (!deployment || deployment.organizationId !== orgId) {
      return reply.code(404).send({ error: "Deployment not found", statusCode: 404 });
    }
    const parsed = BusinessFactsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Invalid business facts", issues: parsed.error.issues, statusCode: 400 });
    }
    await new PrismaBusinessFactsStore(app.prisma).upsert(orgId, parsed.data);
    return reply.send({ ok: true });
  },
);
```

- [ ] **Step 4: Run to verify pass.**

Run: `pnpm --filter @switchboard/api test marketplace-business-facts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/routes/marketplace.ts apps/api/src/routes/__tests__/marketplace-business-facts.test.ts
git commit -m "feat(api): canonical org-scoped business-facts route (404 on cross-org)"
```

---

## Task 4: Dashboard — redirect the client off `inputConfig`

**Files:**

- Modify: `apps/dashboard/src/lib/api-client/marketplace.ts:75-91`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/business-facts/route.ts:14-15`

- [ ] **Step 1: Repoint the client methods.** Replace `getBusinessFacts`/`upsertBusinessFacts` (lines 75-91) with:

```ts
  async getBusinessFacts(deploymentId: string) {
    return this.request<{
      config: Record<string, unknown> | null;
      status: "present" | "missing" | "malformed";
    }>(`/api/marketplace/deployments/${deploymentId}/business-facts`);
  }

  async upsertBusinessFacts(deploymentId: string, facts: Record<string, unknown>) {
    return this.request<{ ok: true }>(`/api/marketplace/deployments/${deploymentId}/business-facts`, {
      method: "PUT",
      body: JSON.stringify(facts),
    });
  }
```

- [ ] **Step 2: Pass `status` through the Next route GET** (line 14-15):

```ts
const data = await client.getBusinessFacts(id);
return NextResponse.json({ facts: data.config ?? null, status: data.status });
```

(The PUT handler is unchanged — it already validates `BusinessFactsSchema` and calls `client.upsertBusinessFacts(id, parsed.data)`.)

- [ ] **Step 3: Verify the dashboard builds + type-checks.**

Run: `pnpm --filter @switchboard/dashboard build`
Expected: success (no missing-`.js`, no type error). Also `pnpm --filter @switchboard/dashboard typecheck` if present.

- [ ] **Step 4: Commit.**

```bash
git add apps/dashboard/src/lib/api-client/marketplace.ts "apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/business-facts/route.ts"
git commit -m "fix(dashboard): point business-facts client at canonical route"
```

---

## Task 5: Seed a realistic medspa facts blob

**Files:**

- Modify: `packages/db/prisma/seed-marketplace.ts` (imports near top; insert after the Alex deployment block, ~line 697)

- [ ] **Step 1: Add a type-only import** after line 3:

```ts
import type { BusinessFacts } from "@switchboard/schemas";
```

- [ ] **Step 2: Define the blob** at module scope (after the imports, before the seed function):

```ts
const GLOW_BUSINESS_FACTS: BusinessFacts = {
  businessName: "Glow Aesthetics",
  timezone: "Asia/Singapore",
  locations: [
    {
      name: "Glow Aesthetics — Orchard",
      address: "391 Orchard Road, #14-05 Ngee Ann City, Singapore 238872",
      parkingNotes:
        "Paid parking at Ngee Ann City basement; 2 hours complimentary with validation at reception.",
      accessNotes: "Take the Tower B lift to level 14; we are immediately on the right.",
    },
  ],
  openingHours: {
    monday: { open: "10:00", close: "20:00", closed: false },
    tuesday: { open: "10:00", close: "20:00", closed: false },
    wednesday: { open: "10:00", close: "20:00", closed: false },
    thursday: { open: "10:00", close: "20:00", closed: false },
    friday: { open: "10:00", close: "21:00", closed: false },
    saturday: { open: "10:00", close: "18:00", closed: false },
    sunday: { open: "00:00", close: "00:00", closed: true },
  },
  services: [
    {
      name: "Anti-wrinkle injections (Botox)",
      description: "Softens forehead lines, frown lines and crow's feet.",
      durationMinutes: 30,
      price: "from $18/unit (typically 20–40 units)",
      currency: "SGD",
      bookingBehavior: "consultation_only",
      consultationRequired: true,
      idealFor: "Dynamic wrinkles from facial expression.",
      prepInstructions: "Avoid alcohol and blood thinners for 24 hours beforehand.",
      aftercareNotes: "Stay upright for 4 hours; no strenuous exercise for 24 hours.",
    },
    {
      name: "HydraFacial",
      description: "Medical-grade cleanse, exfoliation and hydration.",
      durationMinutes: 45,
      price: "$280",
      currency: "SGD",
      bookingBehavior: "book_directly",
      idealFor: "Dull or congested skin; great for first-time visitors.",
    },
    {
      name: "Dermal fillers",
      description: "Restores volume to cheeks, lips and nasolabial folds.",
      durationMinutes: 45,
      price: "from $700/syringe",
      currency: "SGD",
      bookingBehavior: "consultation_only",
      consultationRequired: true,
    },
  ],
  bookingPolicies: {
    cancellationPolicy: "Cancel or reschedule at least 24 hours ahead to avoid a charge.",
    reschedulePolicy: "One complimentary reschedule with 24 hours notice.",
    noShowPolicy: "No-shows are charged 50% of the treatment price.",
    advanceBookingDays: 60,
    prepInstructions: "Arrive 10 minutes early to complete a short medical-history form.",
  },
  escalationContact: {
    name: "Glow Aesthetics front desk",
    channel: "whatsapp",
    address: "+65 6555 0123",
  },
  additionalFaqs: [
    {
      question: "Do you offer first-visit consultations?",
      answer: "Yes — complimentary 15-minute consultations for new clients.",
    },
    {
      question: "Are treatments performed by licensed doctors?",
      answer: "All injectable treatments are performed by MOH-licensed doctors.",
    },
  ],
};
```

- [ ] **Step 3: Write the row.** Inside `if (alexListing) { … }`, immediately after the `console.warn(\` Created deployment: …\`)` line (~line 697), add:

```ts
await prisma.businessConfig.upsert({
  where: { organizationId: ORG_ID },
  update: { config: GLOW_BUSINESS_FACTS as object },
  create: { organizationId: ORG_ID, config: GLOW_BUSINESS_FACTS as object },
});
console.warn(`  Seeded BusinessConfig facts for ${ORG_ID}`);
```

- [ ] **Step 4: Type-check (validates the blob), then populate + verify the row.**

Run: `pnpm --filter @switchboard/db typecheck`
Expected: PASS — the typed literal must satisfy `BusinessFacts` (a missing required field fails here; this is the primary correctness gate for the blob).

The seed is idempotent (all upserts) — this is how `worktree:init` runs it. **Caution:** this Postgres is shared with other active worktrees; running the full seed re-asserts demo defaults and may disturb their in-flight state. If that's a concern, **skip the full seed** and verify the single row via a targeted upsert in a node REPL or a direct SQL insert of the blob. Otherwise:

Run: `pnpm db:seed` → expect `Seeded BusinessConfig facts for org_demo`.

Verify (either way):
`pnpm --filter @switchboard/db exec prisma db execute --stdin <<< "SELECT \"organizationId\", jsonb_typeof(\"config\") FROM \"BusinessConfig\" WHERE \"organizationId\"='org_demo';"`
Expected: one row, `jsonb_typeof = object`.

- [ ] **Step 5: Commit.**

```bash
git add packages/db/prisma/seed-marketplace.ts
git commit -m "feat(db): seed realistic medspa business facts for demo org"
```

---

## Task 6: Backfill migration (guarded, idempotent)

**Files:**

- Create: `packages/db/prisma/migrations/20260602140000_backfill_business_facts/migration.sql`

> **Confirm before writing:** the SQL below targets `BusinessConfig` columns `id`(text), `organizationId`, `config`(jsonb), `createdAt`, `updatedAt` (verified at schema.prisma:563; `id` has no DB default → supply `gen_random_uuid()::text`; `activeVersionId` is nullable → omitted). If the model changed, re-confirm column names/types first.

- [ ] **Step 1: Create the migration file** with exactly this SQL:

```sql
-- Backfill legacy per-deployment AgentDeployment.inputConfig.businessFacts into the
-- canonical per-org BusinessConfig.config. Idempotent + guarded:
--   * insert when the org has no BusinessConfig row
--   * fill only when the canonical row is NULL or '{}'
--   * never overwrite a non-empty canonical row
--   * raise a notice when BOTH sources are non-empty and differ (reconcile manually)
-- No schema change. Safe to run multiple times.

DO $$
DECLARE
  conflict_count integer;
BEGIN
  SELECT count(*) INTO conflict_count
  FROM "AgentDeployment" d
  JOIN "BusinessConfig" b ON b."organizationId" = d."organizationId"
  WHERE d."inputConfig" -> 'businessFacts' IS NOT NULL
    AND d."inputConfig" -> 'businessFacts' <> '{}'::jsonb
    AND b."config" IS NOT NULL
    AND b."config" <> '{}'::jsonb
    AND b."config" <> (d."inputConfig" -> 'businessFacts');
  IF conflict_count > 0 THEN
    RAISE NOTICE 'business-facts backfill: % org(s) have BOTH legacy inputConfig.businessFacts AND a different non-empty BusinessConfig.config; left untouched — reconcile manually', conflict_count;
  END IF;

  -- Insert for orgs that have legacy facts but no canonical row (latest deployment wins).
  INSERT INTO "BusinessConfig" ("id", "organizationId", "config", "createdAt", "updatedAt")
  SELECT gen_random_uuid()::text, d."organizationId", d."inputConfig" -> 'businessFacts', now(), now()
  FROM (
    SELECT DISTINCT ON ("organizationId") "organizationId", "inputConfig"
    FROM "AgentDeployment"
    WHERE "inputConfig" -> 'businessFacts' IS NOT NULL
      AND "inputConfig" -> 'businessFacts' <> '{}'::jsonb
    ORDER BY "organizationId", "updatedAt" DESC
  ) d
  WHERE NOT EXISTS (SELECT 1 FROM "BusinessConfig" b WHERE b."organizationId" = d."organizationId");

  -- Fill canonical rows that exist but are empty.
  UPDATE "BusinessConfig" b
  SET "config" = d."inputConfig" -> 'businessFacts', "updatedAt" = now()
  FROM (
    SELECT DISTINCT ON ("organizationId") "organizationId", "inputConfig"
    FROM "AgentDeployment"
    WHERE "inputConfig" -> 'businessFacts' IS NOT NULL
      AND "inputConfig" -> 'businessFacts' <> '{}'::jsonb
    ORDER BY "organizationId", "updatedAt" DESC
  ) d
  WHERE b."organizationId" = d."organizationId"
    AND (b."config" IS NULL OR b."config" = '{}'::jsonb);
END $$;
```

- [ ] **Step 2: Apply the migration (no TTY needed).**

Run: `pnpm --filter @switchboard/db exec prisma migrate deploy`
Expected: `Applying migration 20260602140000_backfill_business_facts` … `migration(s) applied`.
If it errors on `gen_random_uuid` (Postgres < 13 without pgcrypto), prepend `CREATE EXTENSION IF NOT EXISTS pgcrypto;` to the migration and re-run. On the shared dev Postgres this is normally built-in, and the insert touches ≈0 rows in practice.

- [ ] **Step 3: Verify idempotency + no drift.**

Run again: `pnpm --filter @switchboard/db exec prisma migrate deploy` → `No pending migrations to apply.`
Run: `pnpm db:check-drift` → no drift (this migration changes no schema objects).
Run the conflict query (expect 0 rows in dev):
`pnpm --filter @switchboard/db exec prisma db execute --stdin <<< "SELECT d.\"organizationId\" FROM \"AgentDeployment\" d JOIN \"BusinessConfig\" b ON b.\"organizationId\"=d.\"organizationId\" WHERE d.\"inputConfig\"->'businessFacts' IS NOT NULL AND d.\"inputConfig\"->'businessFacts' <> '{}'::jsonb AND b.\"config\" IS NOT NULL AND b.\"config\" <> '{}'::jsonb;"`

- [ ] **Step 4: Commit.**

```bash
git add packages/db/prisma/migrations/20260602140000_backfill_business_facts/migration.sql
git commit -m "feat(db): backfill business facts into canonical BusinessConfig"
```

---

## Task 7: Readiness — non-blocking `business-facts-present` check

**Files:**

- Modify: `apps/api/src/routes/readiness.ts` (import line 7; `PrismaLike` ~line 121; `ReadinessContext` ~line 68; `buildReadinessContext` ~line 247; `checkReadiness` ~line 305; new function near line 569)
- Test: `apps/api/src/routes/__tests__/readiness.test.ts`

- [ ] **Step 1: Write the failing tests.** In `readiness.test.ts`:
      (a) Add `businessFactsStatus: "present",` to `makeContext`'s defaults (next to `alexSkillPackSeeded: true,`).
      (b) Add `businessConfig: { findUnique: async () => null },` to `makePrismaMock`'s returned object (next to `organizationConfig`).
      (c) Change `expect(report.checks).toHaveLength(12);` → `13`.
      (d) Add inside `describe("checkReadiness", …)`:

```ts
it("business-facts-present passes (non-blocking) when facts present", () => {
  const report = checkReadiness(makeContext({ businessFactsStatus: "present" }));
  const check = report.checks.find((c) => c.id === "business-facts-present")!;
  expect(check.status).toBe("pass");
  expect(check.blocking).toBe(false);
});

it("business-facts-present fails NON-blocking when missing (report stays ready)", () => {
  const report = checkReadiness(makeContext({ businessFactsStatus: "missing" }));
  const check = report.checks.find((c) => c.id === "business-facts-present")!;
  expect(check.status).toBe("fail");
  expect(check.blocking).toBe(false);
  expect(check.message).toContain("not set yet");
  expect(report.ready).toBe(true);
});

it("business-facts-present distinguishes malformed from missing", () => {
  const report = checkReadiness(makeContext({ businessFactsStatus: "malformed" }));
  const check = report.checks.find((c) => c.id === "business-facts-present")!;
  expect(check.message).toContain("invalid");
  expect(report.ready).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure.**

Run: `pnpm --filter @switchboard/api test routes/__tests__/readiness`
Expected: FAIL — `businessFactsStatus` not on `ReadinessContext`; length 12 ≠ 13.

- [ ] **Step 3: Implement.** In `readiness.ts`:

(a) Extend the db import (line 7):

```ts
import {
  assertAlexSkillPackSeeded,
  classifyBusinessFacts,
  type BusinessFactsStatus,
  type KnowledgeEntryReader,
} from "@switchboard/db";
```

(b) Add to `PrismaLike` (after the `organizationConfig` member):

```ts
  businessConfig: {
    findUnique(args: { where: { organizationId: string } }): Promise<{ config: unknown } | null>;
  };
```

(c) Add to `ReadinessContext` (after `alexSkillPackDiagnostic`):

```ts
businessFactsStatus: BusinessFactsStatus;
```

(d) In `buildReadinessContext`, after the `alexSkillPackSeeded` try/catch, add:

```ts
let businessFactsStatus: BusinessFactsStatus = "missing";
try {
  const bcRow = await prisma.businessConfig.findUnique({ where: { organizationId: orgId } });
  businessFactsStatus = classifyBusinessFacts(bcRow?.config ?? null).status;
} catch (err) {
  console.warn(
    `[readiness] business-facts check failed org=${orgId}: ${err instanceof Error ? err.message : String(err)}`,
  );
}
```

(e) Add `businessFactsStatus,` to the returned object (next to `alexSkillPackDiagnostic,`).

(f) In `checkReadiness`, after `checks.push(checkAlexSkillPackSeeded(ctx));` add:

```ts
checks.push(checkBusinessFactsPresent(ctx));
```

(g) Add the check function next to `checkAlexSkillPackSeeded`:

```ts
function checkBusinessFactsPresent(ctx: ReadinessContext): ReadinessCheck {
  const id = "business-facts-present";
  const label = "Business facts entered";
  // Non-blocking: there is no live operator editor yet, so a hard gate would
  // deadlock go-live. Surfaces the gap without blocking activation/resume.
  const blocking = false;
  if (ctx.businessFactsStatus === "present") {
    return {
      id,
      label,
      blocking,
      status: "pass",
      message: "Business facts (hours, pricing, services) are set",
    };
  }
  if (ctx.businessFactsStatus === "malformed") {
    return {
      id,
      label,
      blocking,
      status: "fail",
      message:
        "Business facts are saved but invalid — re-enter hours, services, and contact details",
    };
  }
  return {
    id,
    label,
    blocking,
    status: "fail",
    message: "Business facts not set yet — Alex will escalate hours/pricing questions until added",
  };
}
```

- [ ] **Step 4: Run to verify pass.**

Run: `pnpm --filter @switchboard/api test routes/__tests__/readiness`
Expected: PASS (existing + 3 new; length now 13).

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/routes/readiness.ts apps/api/src/routes/__tests__/readiness.test.ts
git commit -m "feat(api): non-blocking business-facts readiness check"
```

---

## Task 8: Production-path proof (the keystone)

**Files:**

- Modify: `packages/core/src/index.ts` (narrow root export of `alexBuilder`)
- Modify: `packages/core/src/skill-runtime/builders/alex.test.ts` (builder-level case)
- Create: `apps/api/src/__tests__/alex-business-facts-live-path.test.ts`

- [ ] **Step 1: Export `alexBuilder` from the core root** (it is exported from `skill-runtime/index.ts` but not the package root). Add to the end of `packages/core/src/index.ts`:

```ts
// Exposed for the apps/api production-path integration test that proves operator
// BusinessFacts reach the live Alex prompt through the real store + real builder.
// Intentional narrow export — do NOT `export *` the skill-runtime barrel here
// (collision/bloat risk against the existing root exports).
export { alexBuilder } from "./skill-runtime/builders/alex.js";
```

- [ ] **Step 2: Builder-level test.** In `builders/alex.test.ts`, add inside `describe("alexBuilder", …)` (after the last `CURRENT_DATETIME` case):

```ts
it("BUSINESS_FACTS is rendered from businessFactsStore facts (hours, price, advance booking)", async () => {
  const ctx = createMockCtx();
  const stores = createMockStores({
    businessFactsStore: {
      get: vi.fn().mockResolvedValue({
        businessName: "Glow Aesthetics",
        timezone: "Asia/Singapore",
        locations: [{ name: "Orchard", address: "391 Orchard Rd" }],
        openingHours: { monday: { open: "10:00", close: "20:00", closed: false } },
        services: [
          { name: "Botox", description: "Anti-wrinkle", price: "from $18/unit", currency: "SGD" },
        ],
        bookingPolicies: { advanceBookingDays: 60 },
        escalationContact: { name: "Front desk", channel: "whatsapp", address: "+6560000000" },
        additionalFaqs: [],
      }),
    } as never,
  });
  const result = await alexBuilder(ctx, config, stores);
  const bf = result.parameters.BUSINESS_FACTS as string;
  expect(bf).toContain("10:00");
  expect(bf).toContain("from $18/unit");
  expect(bf).toContain("Advance booking: up to 60 days ahead (subject to availability)");
});
```

- [ ] **Step 3: Production-path span.** Create `apps/api/src/__tests__/alex-business-facts-live-path.test.ts`:

```ts
/**
 * Production-path invariant: operator-written BusinessFacts reach Alex's prompt
 * through the REAL PrismaBusinessFactsStore (incl. safeParse) + the REAL alexBuilder
 * — the seam the alex-conversation eval bypasses.
 */
import { describe, it, expect, vi } from "vitest";
import { alexBuilder } from "@switchboard/core";
import { PrismaBusinessFactsStore } from "@switchboard/db";
import type { AgentContext } from "@switchboard/sdk";

const OPERATOR_FACTS = {
  businessName: "Glow Aesthetics",
  timezone: "Asia/Singapore",
  locations: [{ name: "Orchard", address: "391 Orchard Rd", parkingNotes: "Basement parking" }],
  openingHours: { monday: { open: "10:00", close: "20:00", closed: false } },
  services: [
    { name: "Botox", description: "Anti-wrinkle", price: "from $18/unit", currency: "SGD" },
  ],
  bookingPolicies: { advanceBookingDays: 60 },
  escalationContact: { name: "Front desk", channel: "whatsapp", address: "+6560000000" },
  additionalFaqs: [],
};

function storeOver(config: unknown) {
  const prisma = {
    businessConfig: {
      findUnique: vi.fn().mockResolvedValue(config ? { organizationId: "org_1", config } : null),
    },
  };
  return new PrismaBusinessFactsStore(prisma as never);
}

const ctx = {
  persona: {
    businessName: "Glow Aesthetics",
    tone: "friendly",
    qualificationCriteria: {},
    disqualificationCriteria: {},
    escalationRules: {},
    bookingLink: "",
    customInstructions: "",
  },
} as AgentContext;

const baseStores = {
  opportunityStore: {
    findActiveByContact: vi
      .fn()
      .mockResolvedValue([{ id: "opp_1", stage: "interested", createdAt: new Date() }]),
  },
  contactStore: { findById: vi.fn().mockResolvedValue({ name: "Sarah", source: "whatsapp" }) },
};
const config = { deploymentId: "dep_1", orgId: "org_1", contactId: "contact_1" };

describe("alex business-facts live path (production-path invariant)", () => {
  it("operator facts in BusinessConfig reach parameters.BUSINESS_FACTS via the real store", async () => {
    const stores = { ...baseStores, businessFactsStore: storeOver(OPERATOR_FACTS) };
    const result = await alexBuilder(ctx, config, stores as never);
    const bf = result.parameters.BUSINESS_FACTS as string;
    expect(bf).toContain("10:00");
    expect(bf).toContain("from $18/unit");
    expect(bf).toContain("Advance booking: up to 60 days ahead (subject to availability)");
  });

  it("a malformed stored config degrades to empty BUSINESS_FACTS (no throw)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stores = { ...baseStores, businessFactsStore: storeOver({ businessName: "X" }) };
    const result = await alexBuilder(ctx, config, stores as never);
    expect(result.parameters.BUSINESS_FACTS).toBe("");
    warn.mockRestore();
  });
});
```

> If, despite Step 1, `@switchboard/core` still cannot resolve `alexBuilder` at test time (stale build), run `pnpm --filter @switchboard/core build` first. Do **not** weaken this to a `renderBusinessFacts`-only test — the point is to prove the real store feeds the real builder.

- [ ] **Step 4: Run both.**

Run: `pnpm --filter @switchboard/core test builders/alex` then `pnpm --filter @switchboard/api test alex-business-facts-live-path`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/index.ts packages/core/src/skill-runtime/builders/alex.test.ts apps/api/src/__tests__/alex-business-facts-live-path.test.ts
git commit -m "test: prove operator business facts reach the live Alex prompt"
```

---

## Task 9: Full-suite verification + legacy-writer guard

**Files:** none (verification only).

- [ ] **Step 1: Confirm no product code still writes `inputConfig.businessFacts`.** Run a narrow guard AND a broad sweep (the narrow regex misses multiline `inputConfig: { businessFacts: … }`):

```bash
rg "inputConfig.*businessFacts|businessFacts.*inputConfig" --type ts   # narrow guard — expect EMPTY
rg -n "businessFacts" apps packages --type ts                          # broad sweep — inspect each hit
```

Expected: the broad sweep shows only non-writers — the schema/type defs (`marketplace.ts`, `playbook.ts`), the store, `renderBusinessFacts`, the new route/client, the seed blob, and tests. There must be **no** product code that reads or writes `inputConfig.businessFacts` (the dashboard client + Next route now use the canonical route). Manually inspect any multiline match; a real writer must be fixed.

- [ ] **Step 2: Run the full gate from the worktree root.**

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm format:check
pnpm db:check-drift
pnpm --filter @switchboard/dashboard build
```

Expected: all green (typecheck 20/20). If `pnpm typecheck` reports missing exports from `@switchboard/db`/`@switchboard/core`/`@switchboard/schemas`, run `pnpm reset` first (stale lower-layer `dist/`), then re-run.

- [ ] **Step 3: Map results to acceptance criteria** (spec §"Acceptance criteria"): valid write persists to `BusinessConfig` keyed to the authed org; cross-org **404**; `GET` returns `{config,status}`; live builder receives facts (Tasks 8b + 8a); `advanceBookingDays` rendered; malformed degrades + sanitized warn; readiness non-blocking, missing vs malformed, on activate + resume; seeded org has a full blob; backfill idempotent + no clobber + PR includes the conflict query; all gates green. If any is unmet, add a follow-up task before review.

- [ ] **Step 4 (verification only — no commit).** Proceed to `superpowers:requesting-code-review`.

---

## Notes for the implementer

- **Run everything from** `.claude/worktrees/alex-business-facts-unify`. Postgres is reachable (shared primary DB) — the migration/seed steps touch it; **never** `prisma migrate reset`, and prefer the targeted verification in Task 5 if other worktrees are mid-flight.
- **ESM:** relative imports use `.js` suffixes (except inside `apps/dashboard`, which is Next). Cross-package imports use `@switchboard/*`.
- **commitlint:** subject must start lowercase; lint-staged (prettier) reformats on commit — re-`git add` if it does. End each commit body with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer (preceded by a blank line).
- **Do not touch** `packages/core/src/skill-runtime/builders/alex.ts`, `skills/alex/SKILL.md`, the eval harness, the onboarding `PlaybookBusinessFactsSchema` flow, or add metric counters (all out of scope per the spec). The only core change is the one-line `alexBuilder` root export in Task 8.
