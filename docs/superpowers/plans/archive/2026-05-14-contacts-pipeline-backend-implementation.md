# Contacts Pipeline Backend (PR-C2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `/api/dashboard/opportunities` Fastify endpoints, core projection module, atomic store mutation, audit emission via `store_recorded_operator_mutation`, and the dashboard proxy routes the PR-C1 hooks already target.

**Architecture:** Layer 3 (core) defines the `OpportunityStore` interface and the projection module. Layer 4 (db) implements `findOrgBoard` (org-scoped SQL with joined minimal `Contact`) and `transitionStage` (Prisma `$transaction` that updates the row and writes a `WorkTrace` via `WorkTraceStore.recordOperatorMutation` atomically). Layer 5 (apps/api) wires Fastify routes; apps/dashboard adds Next.js proxy routes mirroring the existing `/contacts`, `/reports` patterns. Spec: [`docs/superpowers/specs/2026-05-14-contacts-pipeline-backend-design.md`](../specs/2026-05-14-contacts-pipeline-backend-design.md).

**Tech Stack:** TypeScript, Fastify 4, Prisma, Zod, vitest (mocked Prisma per `feedback_api_test_mocked_prisma.md`), Next.js 14 App Router (proxy layer), TanStack React Query (already wired in PR-C1).

**Branching:** Cut `feat/contacts-pipeline-pr-c2` from **`feat/contacts-pipeline-pr-c1`** at execution time (the C1 schema + lock test live there, not yet on main). Rebase to main after PR-C1 merges.

---

## Reference: existing precedent the implementer should read first

These three files together define everything PR-C2 needs and exactly mirror the patterns this plan instructs the implementer to follow. Read in this order before starting Task 1:

1. **`packages/db/src/stores/prisma-conversation-state-store.ts` lines 50–136** — `setOverride` is the closest precedent: org-scoped Prisma `$transaction`, atomic row update + `WorkTrace` insert via `workTraceStore.recordOperatorMutation(trace, { tx })`, two-phase trace (write as `running` inside tx, finalize to `completed` via `workTraceStore.update` after tx commits). PR-C2's `transitionStage` mirrors this end-to-end.
2. **`packages/db/src/stores/prisma-work-trace-store.ts` lines 106–163** — `recordOperatorMutation` signature and rejection rule: caller must set `trace.ingressPath = "store_recorded_operator_mutation"` or it throws. The trace's `actor.type` is `"user" | "system" | "service"` (not `"kind"`).
3. **`apps/api/src/routes/dashboard-contacts.ts`** + **`apps/api/src/routes/dashboard-reports.ts`** — the `preHandler` + `requireOrganizationScope` route conventions.

The spec's §13 lists the same reading order with additional context.

---

## File Structure

Files this plan creates or modifies, with the responsibility of each:

```
packages/core/src/lifecycle/opportunity-store.ts             MODIFY  — extend OpportunityStore with findOrgBoard + transitionStage; add OpportunityBoardRow, TransitionStageInput/Result, OpportunityNotFoundError types
packages/core/src/lifecycle/opportunity-board.ts             NEW     — listOpportunitiesForBoard + transitionOpportunityStage; ISO conversion + contact-name fallback
packages/core/src/lifecycle/__tests__/opportunity-board.test.ts  NEW — unit tests for the projection module

packages/db/src/stores/prisma-opportunity-store.ts           MODIFY  — implement findOrgBoard + transitionStage; constructor takes (prismaClient, workTraceStore?)
packages/db/src/stores/__tests__/prisma-opportunity-store.test.ts  NEW/MODIFY — mocked-Prisma tests for new methods

apps/api/src/routes/dashboard-opportunities.ts               NEW     — GET + PATCH Fastify routes; mirrors dashboard-contacts.ts preHandler shape
apps/api/src/__tests__/api-opportunities-board.test.ts       NEW     — GET integration tests with buildTestServer
apps/api/src/__tests__/api-opportunities-stage.test.ts       NEW     — PATCH integration tests including trace-emission assertion
apps/api/src/__tests__/test-stores.ts                        MODIFY  — implement findOrgBoard + transitionStage on TestOpportunityStore

apps/api/src/app.ts                                          MODIFY  — register dashboardOpportunitiesRoutes, pass workTraceStore to PrismaOpportunityStore (×2 call sites)
apps/api/src/bootstrap/skill-mode.ts                         MODIFY  — pass workTraceStore to PrismaOpportunityStore

apps/dashboard/src/app/api/dashboard/opportunities/route.ts                MODIFY (NEW file) — Next.js GET proxy
apps/dashboard/src/app/api/dashboard/opportunities/[id]/stage/route.ts     NEW     — Next.js PATCH proxy
apps/dashboard/src/lib/get-api-client.ts                                   MODIFY  — add getOpportunitiesBoard + patchOpportunityStage methods
```

---

## Task 1 — Extend `OpportunityStore` interface (types + error class only)

**Files:**

- Modify: `packages/core/src/lifecycle/opportunity-store.ts`

This task is interface-only — no implementations, no tests. Tests follow in Task 2.

- [ ] **Step 1: Add new types and the error class**

Open `packages/core/src/lifecycle/opportunity-store.ts` and replace its contents with:

```ts
import type { Opportunity, OpportunityStage, ObjectionRecord } from "@switchboard/schemas";

export interface CreateOpportunityInput {
  organizationId: string;
  contactId: string;
  serviceId: string;
  serviceName: string;
  estimatedValue?: number | null;
  assignedAgent?: string | null;
}

/**
 * Raw board row returned by OpportunityStore.findOrgBoard — mirrors Opportunity
 * but with the joined minimal contact projection and dates left as Date
 * objects. Core's listOpportunitiesForBoard converts to ISO strings before
 * shipping over the wire.
 */
export interface OpportunityBoardRow {
  id: string;
  organizationId: string;
  contactId: string;
  serviceId: string;
  serviceName: string;
  stage: OpportunityStage;
  timeline: "immediate" | "soon" | "exploring" | "unknown" | null;
  priceReadiness: "ready" | "flexible" | "price_sensitive" | "unknown" | null;
  objections: ObjectionRecord[];
  qualificationComplete: boolean;
  estimatedValue: number | null;
  revenueTotal: number;
  assignedAgent: string | null;
  assignedStaff: string | null;
  lostReason: string | null;
  notes: string | null;
  openedAt: Date;
  closedAt: Date | null;
  updatedAt: Date;
  contact: {
    id: string;
    name: string;
    primaryChannel: "whatsapp" | "telegram" | "dashboard";
  };
}

export interface TransitionStageInput {
  orgId: string;
  id: string;
  stage: OpportunityStage;
  /** Operator actor — type matches WorkTrace.actor shape ("user" | "system" | "service"). */
  actor: { id: string; type: "user" | "system" | "service" };
}

export interface TransitionStageResult {
  opportunity: OpportunityBoardRow;
  workTraceId: string;
}

/** Thrown by transitionStage when the id is missing or belongs to a different org. */
export class OpportunityNotFoundError extends Error {
  readonly code = "OPPORTUNITY_NOT_FOUND";
  constructor(message: string) {
    super(message);
    this.name = "OpportunityNotFoundError";
  }
}

export interface OpportunityStore {
  create(input: CreateOpportunityInput): Promise<Opportunity>;
  findById(orgId: string, id: string): Promise<Opportunity | null>;
  findByContact(orgId: string, contactId: string): Promise<Opportunity[]>;
  findActiveByContact(orgId: string, contactId: string): Promise<Opportunity[]>;
  updateStage(
    orgId: string,
    id: string,
    stage: OpportunityStage,
    closedAt?: Date | null,
  ): Promise<Opportunity>;
  updateRevenueTotal(orgId: string, id: string): Promise<void>;
  countByStage(
    orgId: string,
  ): Promise<Array<{ stage: OpportunityStage; count: number; totalValue: number }>>;

  /**
   * Org-wide flat-list projection for the Mercury /contacts pipeline board.
   * Returns every opportunity for the org, sorted by updatedAt DESC, with the
   * joined minimal Contact projection. No paging in v1 — pilot data is 50–200
   * cards per org (see backend spec §2 OPEN-A1).
   */
  findOrgBoard(orgId: string): Promise<OpportunityBoardRow[]>;

  /**
   * Atomically transition an opportunity's stage AND write an operator-mutation
   * WorkTrace. Implementations must use a transaction so that a trace-write
   * failure rolls back the row update. Throws OpportunityNotFoundError when
   * the id is missing or belongs to a different org.
   */
  transitionStage(input: TransitionStageInput): Promise<TransitionStageResult>;
}
```

- [ ] **Step 2: Typecheck the package builds**

Run: `pnpm --filter @switchboard/core typecheck`
Expected: PASS. Existing call sites still compile because the new methods are added to the interface — but every implementation of `OpportunityStore` (Prisma + test stores) will now be a typecheck error in its respective package. That's fine; those packages are addressed in Tasks 4–6. The core package itself is green.

If a different package (`@switchboard/db` or `@switchboard/api`) fails this typecheck because of the new interface members, that's expected and resolved in Tasks 4–6. Run `pnpm --filter @switchboard/core typecheck` specifically, not the whole monorepo.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/lifecycle/opportunity-store.ts
git commit -m "feat(core): extend OpportunityStore with findOrgBoard + transitionStage types"
```

---

## Task 2 — Core projection: `listOpportunitiesForBoard` (TDD)

**Files:**

- Create: `packages/core/src/lifecycle/opportunity-board.ts`
- Create: `packages/core/src/lifecycle/__tests__/opportunity-board.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `packages/core/src/lifecycle/__tests__/opportunity-board.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { PipelineBoardResponseSchema } from "@switchboard/schemas";
import type { OpportunityBoardRow, OpportunityStore } from "../opportunity-store.js";
import { listOpportunitiesForBoard } from "../opportunity-board.js";

function mkRow(overrides: Partial<OpportunityBoardRow> = {}): OpportunityBoardRow {
  return {
    id: "opp_1",
    organizationId: "org_acme",
    contactId: "c_1",
    serviceId: "svc_profhilo",
    serviceName: "Profhilo · 2-session protocol",
    stage: "quoted",
    timeline: "soon",
    priceReadiness: "flexible",
    objections: [
      { category: "price", raisedAt: new Date("2026-05-12T02:00:00Z"), resolvedAt: null },
    ],
    qualificationComplete: true,
    estimatedValue: 168000,
    revenueTotal: 0,
    assignedAgent: "alex",
    assignedStaff: "Dr. Yeo",
    lostReason: null,
    notes: "Quote sent Monday",
    openedAt: new Date("2026-05-06T05:00:00Z"),
    closedAt: null,
    updatedAt: new Date("2026-05-13T07:19:00Z"),
    contact: { id: "c_1", name: "Felicia Goh", primaryChannel: "whatsapp" },
    ...overrides,
  };
}

function mkStore(rows: OpportunityBoardRow[]): Pick<OpportunityStore, "findOrgBoard"> {
  return { findOrgBoard: vi.fn().mockResolvedValue(rows) };
}

describe("listOpportunitiesForBoard", () => {
  it("returns rows parseable by PipelineBoardResponseSchema", async () => {
    const store = mkStore([mkRow()]);
    const result = await listOpportunitiesForBoard(
      { orgId: "org_acme" },
      { opportunityStore: store },
    );
    expect(() => PipelineBoardResponseSchema.parse(result)).not.toThrow();
  });

  it("converts every Date field to an ISO string", async () => {
    const store = mkStore([mkRow()]);
    const result = await listOpportunitiesForBoard(
      { orgId: "org_acme" },
      { opportunityStore: store },
    );
    const row = result.rows[0]!;
    expect(typeof row.openedAt).toBe("string");
    expect(row.openedAt).toBe("2026-05-06T05:00:00.000Z");
    expect(typeof row.updatedAt).toBe("string");
    expect(row.closedAt).toBeNull();
    expect(typeof row.objections[0]!.raisedAt).toBe("string");
    expect(row.objections[0]!.resolvedAt).toBeNull();
  });

  it("preserves closedAt as ISO when present", async () => {
    const store = mkStore([
      mkRow({ stage: "won", closedAt: new Date("2026-05-14T10:00:00Z"), revenueTotal: 168000 }),
    ]);
    const result = await listOpportunitiesForBoard(
      { orgId: "org_acme" },
      { opportunityStore: store },
    );
    expect(result.rows[0]!.closedAt).toBe("2026-05-14T10:00:00.000Z");
  });

  it("substitutes 'Unknown' for empty contact names", async () => {
    const store = mkStore([
      mkRow({ contact: { id: "c_1", name: "   ", primaryChannel: "whatsapp" } }),
    ]);
    const result = await listOpportunitiesForBoard(
      { orgId: "org_acme" },
      { opportunityStore: store },
    );
    expect(result.rows[0]!.contact.name).toBe("Unknown");
  });

  it("calls findOrgBoard with the requested orgId", async () => {
    const store = mkStore([]);
    await listOpportunitiesForBoard({ orgId: "org_xyz" }, { opportunityStore: store });
    expect(store.findOrgBoard).toHaveBeenCalledWith("org_xyz");
  });

  it("returns { rows: [] } for an org with no opportunities", async () => {
    const store = mkStore([]);
    const result = await listOpportunitiesForBoard(
      { orgId: "org_acme" },
      { opportunityStore: store },
    );
    expect(result).toEqual({ rows: [] });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- opportunity-board`
Expected: FAIL with "Cannot find module '../opportunity-board.js'"

- [ ] **Step 3: Implement `opportunity-board.ts`**

Create `packages/core/src/lifecycle/opportunity-board.ts`:

```ts
import type { PipelineBoardOpportunity, PipelineBoardResponse } from "@switchboard/schemas";
import type { OpportunityStore, OpportunityBoardRow } from "./opportunity-store.js";

function toBoardRow(row: OpportunityBoardRow): PipelineBoardOpportunity {
  return {
    id: row.id,
    contactId: row.contactId,
    serviceId: row.serviceId,
    serviceName: row.serviceName,
    stage: row.stage,
    timeline: row.timeline ?? undefined,
    priceReadiness: row.priceReadiness ?? undefined,
    objections: row.objections.map((o) => ({
      category: o.category,
      raisedAt: o.raisedAt instanceof Date ? o.raisedAt.toISOString() : o.raisedAt,
      resolvedAt:
        o.resolvedAt === null || o.resolvedAt === undefined
          ? null
          : o.resolvedAt instanceof Date
            ? o.resolvedAt.toISOString()
            : o.resolvedAt,
    })),
    qualificationComplete: row.qualificationComplete,
    estimatedValue: row.estimatedValue,
    revenueTotal: row.revenueTotal,
    assignedAgent: row.assignedAgent,
    assignedStaff: row.assignedStaff,
    lostReason: row.lostReason,
    notes: row.notes,
    openedAt: row.openedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    contact: {
      id: row.contact.id,
      name: row.contact.name.trim() === "" ? "Unknown" : row.contact.name,
      primaryChannel: row.contact.primaryChannel,
    },
  };
}

export async function listOpportunitiesForBoard(
  input: { orgId: string },
  deps: { opportunityStore: Pick<OpportunityStore, "findOrgBoard"> },
): Promise<PipelineBoardResponse> {
  const rows = await deps.opportunityStore.findOrgBoard(input.orgId);
  return { rows: rows.map(toBoardRow) };
}
```

Note: `PipelineBoardOpportunitySchema` (in `@switchboard/schemas`) has `timeline` / `priceReadiness` as `z.optional` (inherited from `OpportunitySchema.shape`), so passing `undefined` is correct. If the schema rejects `undefined` and requires the key be absent, switch to a conditional spread — verify via test run.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- opportunity-board`
Expected: PASS (all 6 cases).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lifecycle/opportunity-board.ts packages/core/src/lifecycle/__tests__/opportunity-board.test.ts
git commit -m "feat(core): listOpportunitiesForBoard projection with ISO date conversion"
```

---

## Task 3 — Core projection: `transitionOpportunityStage` (TDD)

**Files:**

- Modify: `packages/core/src/lifecycle/opportunity-board.ts`
- Modify: `packages/core/src/lifecycle/__tests__/opportunity-board.test.ts`

- [ ] **Step 1: Append the failing tests**

Append to `packages/core/src/lifecycle/__tests__/opportunity-board.test.ts`:

```ts
import {
  OpportunityNotFoundError,
  type TransitionStageInput,
  type TransitionStageResult,
} from "../opportunity-store.js";
import { transitionOpportunityStage } from "../opportunity-board.js";

function mkTransitioningStore(
  result: TransitionStageResult | OpportunityNotFoundError,
): Pick<OpportunityStore, "transitionStage"> {
  return {
    transitionStage: vi.fn().mockImplementation((_: TransitionStageInput) => {
      if (result instanceof OpportunityNotFoundError) return Promise.reject(result);
      return Promise.resolve(result);
    }),
  };
}

describe("transitionOpportunityStage", () => {
  it("returns { opportunity } with the wire shape", async () => {
    const store = mkTransitioningStore({
      opportunity: mkRow({ stage: "booked" }),
      workTraceId: "trace_1",
    });
    const result = await transitionOpportunityStage(
      { orgId: "org_acme", id: "opp_1", stage: "booked", actor: { id: "user_42", type: "user" } },
      { opportunityStore: store },
    );
    expect(result.opportunity.stage).toBe("booked");
    expect(typeof result.opportunity.updatedAt).toBe("string");
  });

  it("propagates OpportunityNotFoundError from the store", async () => {
    const err = new OpportunityNotFoundError("opp_missing");
    const store = mkTransitioningStore(err);
    await expect(
      transitionOpportunityStage(
        { orgId: "org_acme", id: "opp_missing", stage: "booked", actor: { id: "u", type: "user" } },
        { opportunityStore: store },
      ),
    ).rejects.toBeInstanceOf(OpportunityNotFoundError);
  });

  it("forwards the input verbatim to the store", async () => {
    const store = mkTransitioningStore({ opportunity: mkRow(), workTraceId: "t" });
    const input = {
      orgId: "org_acme",
      id: "opp_1",
      stage: "won" as const,
      actor: { id: "user_42", type: "user" as const },
    };
    await transitionOpportunityStage(input, { opportunityStore: store });
    expect(store.transitionStage).toHaveBeenCalledWith(input);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- opportunity-board`
Expected: FAIL — `transitionOpportunityStage` is not exported from `opportunity-board.ts`.

- [ ] **Step 3: Add the implementation**

Append to `packages/core/src/lifecycle/opportunity-board.ts`:

```ts
import type { OpportunityStage } from "@switchboard/schemas";
import type { TransitionStageInput } from "./opportunity-store.js";
export { OpportunityNotFoundError } from "./opportunity-store.js";

export async function transitionOpportunityStage(
  input: {
    orgId: string;
    id: string;
    stage: OpportunityStage;
    actor: TransitionStageInput["actor"];
  },
  deps: { opportunityStore: Pick<OpportunityStore, "transitionStage"> },
): Promise<{ opportunity: PipelineBoardOpportunity }> {
  const result = await deps.opportunityStore.transitionStage({
    orgId: input.orgId,
    id: input.id,
    stage: input.stage,
    actor: input.actor,
  });
  return { opportunity: toBoardRow(result.opportunity) };
}
```

(The `import type { OpportunityStage }` line is additive; the existing imports stay. If TS complains about duplicate imports from `./opportunity-store.js`, merge them into one line.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- opportunity-board`
Expected: PASS (all 9 cases).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lifecycle/opportunity-board.ts packages/core/src/lifecycle/__tests__/opportunity-board.test.ts
git commit -m "feat(core): transitionOpportunityStage with wire-shape conversion"
```

---

## Task 4 — Implement new methods on `TestOpportunityStore`

**Files:**

- Modify: `apps/api/src/__tests__/test-stores.ts`

Required before Tasks 8–9 (API integration tests use the test store).

- [ ] **Step 1: Add the implementations**

Open `apps/api/src/__tests__/test-stores.ts` and locate `TestOpportunityStore`. Replace the `not implemented` throws for `findOrgBoard` and `transitionStage` (or add them if currently missing):

```ts
import type {
  OpportunityBoardRow,
  TransitionStageInput,
  TransitionStageResult,
} from "@switchboard/core/lifecycle";
import { OpportunityNotFoundError } from "@switchboard/core/lifecycle";
import { randomUUID } from "node:crypto";

// inside class TestOpportunityStore:

private boardRows: OpportunityBoardRow[] = [];
public lastTraceWritten: { ingressPath: string; intent: string; parameters: Record<string, unknown> } | null = null;

seedBoard(rows: OpportunityBoardRow[]): void {
  this.boardRows = rows;
}

async findOrgBoard(orgId: string): Promise<OpportunityBoardRow[]> {
  return this.boardRows
    .filter((r) => r.organizationId === orgId)
    .slice()
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

async transitionStage(input: TransitionStageInput): Promise<TransitionStageResult> {
  const idx = this.boardRows.findIndex(
    (r) => r.id === input.id && r.organizationId === input.orgId,
  );
  if (idx === -1) {
    throw new OpportunityNotFoundError(`Opportunity not found: ${input.id} (org: ${input.orgId})`);
  }
  const existing = this.boardRows[idx]!;
  const now = new Date();
  const isTerminal = input.stage === "won" || input.stage === "lost";
  const updated: OpportunityBoardRow = {
    ...existing,
    stage: input.stage,
    closedAt: isTerminal ? (existing.closedAt ?? now) : null,
    updatedAt: now,
  };
  this.boardRows[idx] = updated;
  this.lastTraceWritten = {
    ingressPath: "store_recorded_operator_mutation",
    intent: "opportunity.stage_transition",
    parameters: {
      opportunityId: input.id,
      contactId: existing.contactId,
      fromStage: existing.stage,
      toStage: input.stage,
    },
  };
  return { opportunity: updated, workTraceId: randomUUID() };
}
```

The `lastTraceWritten` capture is what integration tests assert against — it stands in for the WorkTrace store mock at this layer. If the test-store contract changes (e.g., the integration tests inspect `app.workTraceStore.persist` directly instead), drop this and pass an injected recorder hook through the constructor — see Task 8 for the chosen approach.

- [ ] **Step 2: Run the api tests to confirm compile**

Run: `pnpm --filter @switchboard/api typecheck`
Expected: PASS. (Tests don't yet exercise the new methods; they will in Tasks 8–9.)

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/__tests__/test-stores.ts
git commit -m "test(api): implement findOrgBoard + transitionStage on TestOpportunityStore"
```

---

## Task 5 — Prisma store: `findOrgBoard` (TDD with mocked Prisma)

**Files:**

- Modify: `packages/db/src/stores/prisma-opportunity-store.ts`
- Create or extend: `packages/db/src/stores/__tests__/prisma-opportunity-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/stores/__tests__/prisma-opportunity-store.test.ts` if absent, or append to it:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaOpportunityStore } from "../prisma-opportunity-store.js";
import type { PrismaDbClient } from "../../prisma-db.js";

function mkPrismaMock() {
  return {
    opportunity: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        opportunity: { findFirst: vi.fn(), update: vi.fn() },
        workTrace: { create: vi.fn() },
      }),
    ),
  } as unknown as PrismaDbClient;
}

describe("PrismaOpportunityStore.findOrgBoard", () => {
  it("filters by organizationId and includes the contact projection", async () => {
    const prisma = mkPrismaMock();
    (prisma.opportunity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const store = new PrismaOpportunityStore(prisma, null);
    await store.findOrgBoard("org_acme");
    const call = (prisma.opportunity.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.where).toEqual({ organizationId: "org_acme" });
    expect(call.include).toEqual({
      contact: { select: { id: true, name: true, primaryChannel: true } },
    });
    expect(call.orderBy).toEqual({ updatedAt: "desc" });
  });

  it("maps rows to OpportunityBoardRow shape with Date fields preserved", async () => {
    const prisma = mkPrismaMock();
    const opened = new Date("2026-05-06T05:00:00Z");
    const updated = new Date("2026-05-13T07:19:00Z");
    (prisma.opportunity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "opp_1",
        organizationId: "org_acme",
        contactId: "c_1",
        serviceId: "svc",
        serviceName: "Service",
        stage: "quoted",
        timeline: "soon",
        priceReadiness: "flexible",
        objections: [],
        qualificationComplete: true,
        estimatedValue: 168000,
        revenueTotal: 0,
        assignedAgent: "alex",
        assignedStaff: null,
        lostReason: null,
        notes: null,
        openedAt: opened,
        closedAt: null,
        updatedAt: updated,
        contact: { id: "c_1", name: "Felicia", primaryChannel: "whatsapp" },
      },
    ]);
    const store = new PrismaOpportunityStore(prisma, null);
    const rows = await store.findOrgBoard("org_acme");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("opp_1");
    expect(rows[0]!.openedAt).toBeInstanceOf(Date);
    expect(rows[0]!.openedAt.toISOString()).toBe("2026-05-06T05:00:00.000Z");
    expect(rows[0]!.contact.name).toBe("Felicia");
  });

  it("returns [] for an org with no rows", async () => {
    const prisma = mkPrismaMock();
    (prisma.opportunity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const store = new PrismaOpportunityStore(prisma, null);
    const rows = await store.findOrgBoard("org_empty");
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/db test -- prisma-opportunity-store`
Expected: FAIL — `store.findOrgBoard is not a function`, or the constructor errors on the second argument.

- [ ] **Step 3: Implement `findOrgBoard` + constructor change**

Open `packages/db/src/stores/prisma-opportunity-store.ts`. Update the constructor to accept an optional `WorkTraceStore`:

```ts
import type { PrismaDbClient } from "../prisma-db.js";
import type { Opportunity, OpportunityStage, ObjectionRecord } from "@switchboard/schemas";
import type {
  OpportunityBoardRow,
  TransitionStageInput,
  TransitionStageResult,
} from "@switchboard/core/lifecycle";
import { OpportunityNotFoundError } from "@switchboard/core/lifecycle";
import type { PrismaWorkTraceStore } from "./prisma-work-trace-store.js";

// near the top of the class, replace the existing constructor:
constructor(
  private prisma: PrismaDbClient,
  private workTraceStore: PrismaWorkTraceStore | null,
) {}
```

Add the `findOrgBoard` method on the class:

```ts
async findOrgBoard(orgId: string): Promise<OpportunityBoardRow[]> {
  const rows = await this.prisma.opportunity.findMany({
    where: { organizationId: orgId },
    include: { contact: { select: { id: true, name: true, primaryChannel: true } } },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(mapRowToBoardRow);
}
```

Add a sibling mapper at the bottom of the file (alongside `mapRowToOpportunity`):

```ts
function mapRowToBoardRow(row: {
  id: string;
  organizationId: string;
  contactId: string;
  serviceId: string;
  serviceName: string;
  stage: string;
  timeline: string | null;
  priceReadiness: string | null;
  objections: unknown;
  qualificationComplete: boolean;
  estimatedValue: number | null;
  revenueTotal: number;
  assignedAgent: string | null;
  assignedStaff: string | null;
  lostReason: string | null;
  notes: string | null;
  openedAt: Date;
  closedAt: Date | null;
  updatedAt: Date;
  contact: { id: string; name: string; primaryChannel: string };
}): OpportunityBoardRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    contactId: row.contactId,
    serviceId: row.serviceId,
    serviceName: row.serviceName,
    stage: row.stage as OpportunityStage,
    timeline: (row.timeline as OpportunityBoardRow["timeline"]) ?? null,
    priceReadiness: (row.priceReadiness as OpportunityBoardRow["priceReadiness"]) ?? null,
    objections: (row.objections as ObjectionRecord[]) ?? [],
    qualificationComplete: row.qualificationComplete,
    estimatedValue: row.estimatedValue,
    revenueTotal: row.revenueTotal,
    assignedAgent: row.assignedAgent,
    assignedStaff: row.assignedStaff,
    lostReason: row.lostReason,
    notes: row.notes,
    openedAt: row.openedAt,
    closedAt: row.closedAt,
    updatedAt: row.updatedAt,
    contact: {
      id: row.contact.id,
      name: row.contact.name,
      primaryChannel: row.contact.primaryChannel as "whatsapp" | "telegram" | "dashboard",
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/db test -- prisma-opportunity-store`
Expected: PASS for the 3 `findOrgBoard` tests.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/prisma-opportunity-store.ts packages/db/src/stores/__tests__/prisma-opportunity-store.test.ts
git commit -m "feat(db): findOrgBoard on PrismaOpportunityStore with joined contact projection"
```

---

## Task 6 — Prisma store: `transitionStage` (TDD with mocked transaction)

**Files:**

- Modify: `packages/db/src/stores/prisma-opportunity-store.ts`
- Modify: `packages/db/src/stores/__tests__/prisma-opportunity-store.test.ts`

The precedent: `prisma-conversation-state-store.ts:50-136` (`setOverride`). Read it before starting.

- [ ] **Step 1: Append the failing tests**

Append to `packages/db/src/stores/__tests__/prisma-opportunity-store.test.ts`:

```ts
import { OpportunityNotFoundError } from "@switchboard/core/lifecycle";

function mkTxClient(opts: { existing?: Record<string, unknown> | null }) {
  return {
    opportunity: {
      findFirst: vi.fn().mockResolvedValue(opts.existing ?? null),
      update: vi.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          ...(opts.existing ?? {}),
          ...data,
          contact: (opts.existing as { contact?: unknown })?.contact ?? {
            id: "c_1",
            name: "Felicia",
            primaryChannel: "whatsapp",
          },
        }),
      ),
    },
    workTrace: { create: vi.fn().mockResolvedValue({}) },
  };
}

function mkPrismaWithTx(txClient: ReturnType<typeof mkTxClient>) {
  return {
    opportunity: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(txClient)),
  } as unknown as PrismaDbClient;
}

function mkTraceStore() {
  return {
    recordOperatorMutation: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue({ ok: true }),
  } as unknown as PrismaWorkTraceStore;
}

describe("PrismaOpportunityStore.transitionStage", () => {
  const existing = {
    id: "opp_1",
    organizationId: "org_acme",
    contactId: "c_1",
    serviceId: "svc",
    serviceName: "Service",
    stage: "quoted",
    timeline: "soon",
    priceReadiness: "flexible",
    objections: [],
    qualificationComplete: true,
    estimatedValue: 168000,
    revenueTotal: 0,
    assignedAgent: "alex",
    assignedStaff: null,
    lostReason: null,
    notes: null,
    openedAt: new Date("2026-05-06T05:00:00Z"),
    closedAt: null,
    updatedAt: new Date("2026-05-13T07:19:00Z"),
    contact: { id: "c_1", name: "Felicia", primaryChannel: "whatsapp" },
  };

  it("updates the row and records an operator-mutation WorkTrace inside a single transaction", async () => {
    const tx = mkTxClient({ existing });
    const prisma = mkPrismaWithTx(tx);
    const traceStore = mkTraceStore();
    const store = new PrismaOpportunityStore(prisma, traceStore);

    const result = await store.transitionStage({
      orgId: "org_acme",
      id: "opp_1",
      stage: "booked",
      actor: { id: "user_42", type: "user" },
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.opportunity.update).toHaveBeenCalledTimes(1);
    expect(traceStore.recordOperatorMutation).toHaveBeenCalledTimes(1);

    const traceArg = (traceStore.recordOperatorMutation as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    expect(traceArg.ingressPath).toBe("store_recorded_operator_mutation");
    expect(traceArg.intent).toBe("opportunity.stage_transition");
    expect(traceArg.organizationId).toBe("org_acme");
    expect(traceArg.actor).toEqual({ id: "user_42", type: "user" });
    expect(traceArg.parameters).toEqual({
      opportunityId: "opp_1",
      contactId: "c_1",
      fromStage: "quoted",
      toStage: "booked",
    });

    expect(result.opportunity.stage).toBe("booked");
    expect(result.workTraceId).toBeTruthy();
  });

  it("sets closedAt when transitioning to a terminal stage", async () => {
    const tx = mkTxClient({ existing });
    const prisma = mkPrismaWithTx(tx);
    const store = new PrismaOpportunityStore(prisma, mkTraceStore());
    await store.transitionStage({
      orgId: "org_acme",
      id: "opp_1",
      stage: "won",
      actor: { id: "u", type: "user" },
    });
    const updateCall = tx.opportunity.update.mock.calls[0]![0];
    expect(updateCall.data.closedAt).toBeInstanceOf(Date);
  });

  it("clears closedAt when transitioning away from terminal", async () => {
    const tx = mkTxClient({ existing: { ...existing, stage: "won", closedAt: new Date() } });
    const prisma = mkPrismaWithTx(tx);
    const store = new PrismaOpportunityStore(prisma, mkTraceStore());
    await store.transitionStage({
      orgId: "org_acme",
      id: "opp_1",
      stage: "quoted",
      actor: { id: "u", type: "user" },
    });
    const updateCall = tx.opportunity.update.mock.calls[0]![0];
    expect(updateCall.data.closedAt).toBeNull();
  });

  it("throws OpportunityNotFoundError when the id is missing", async () => {
    const tx = mkTxClient({ existing: null });
    const prisma = mkPrismaWithTx(tx);
    const store = new PrismaOpportunityStore(prisma, mkTraceStore());
    await expect(
      store.transitionStage({
        orgId: "org_acme",
        id: "opp_missing",
        stage: "booked",
        actor: { id: "u", type: "user" },
      }),
    ).rejects.toBeInstanceOf(OpportunityNotFoundError);
  });

  it("throws OpportunityNotFoundError for cross-tenant id (findFirst with org filter returns null)", async () => {
    // The mock's findFirst returns null because the orgId in the where-clause won't match.
    const tx = mkTxClient({ existing: null });
    const prisma = mkPrismaWithTx(tx);
    const store = new PrismaOpportunityStore(prisma, mkTraceStore());
    await expect(
      store.transitionStage({
        orgId: "org_other",
        id: "opp_1",
        stage: "booked",
        actor: { id: "u", type: "user" },
      }),
    ).rejects.toBeInstanceOf(OpportunityNotFoundError);

    // Verify the findFirst was called with org-scoping.
    expect(tx.opportunity.findFirst).toHaveBeenCalledWith({
      where: { id: "opp_1", organizationId: "org_other" },
      include: { contact: { select: { id: true, name: true, primaryChannel: true } } },
    });
  });

  it("throws when workTraceStore is null", async () => {
    const tx = mkTxClient({ existing });
    const prisma = mkPrismaWithTx(tx);
    const store = new PrismaOpportunityStore(prisma, null);
    await expect(
      store.transitionStage({
        orgId: "org_acme",
        id: "opp_1",
        stage: "booked",
        actor: { id: "u", type: "user" },
      }),
    ).rejects.toThrow(/workTraceStore/i);
  });

  it("emits a WorkTrace even on same-stage no-op (idempotency per spec §A6)", async () => {
    const tx = mkTxClient({ existing });
    const prisma = mkPrismaWithTx(tx);
    const traceStore = mkTraceStore();
    const store = new PrismaOpportunityStore(prisma, traceStore);
    await store.transitionStage({
      orgId: "org_acme",
      id: "opp_1",
      stage: "quoted", // same as existing.stage
      actor: { id: "u", type: "user" },
    });
    expect(traceStore.recordOperatorMutation).toHaveBeenCalledTimes(1);
    const traceArg = (traceStore.recordOperatorMutation as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    expect(traceArg.parameters).toMatchObject({ fromStage: "quoted", toStage: "quoted" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/db test -- prisma-opportunity-store`
Expected: FAIL — `transitionStage is not a function`.

- [ ] **Step 3: Implement `transitionStage`**

Add the method on `PrismaOpportunityStore`. Mirrors `setOverride` in `prisma-conversation-state-store.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { WorkTrace } from "@switchboard/core/platform";
import type { Prisma } from "@prisma/client";

async transitionStage(input: TransitionStageInput): Promise<TransitionStageResult> {
  if (!this.workTraceStore) {
    throw new Error("PrismaOpportunityStore.transitionStage requires workTraceStore");
  }
  const { orgId, id, stage, actor } = input;
  const requestedAt = new Date();
  const executionStartedAt = new Date();

  const txResult = await this.prisma.$transaction(async (tx) => {
    const existing = await tx.opportunity.findFirst({
      where: { id, organizationId: orgId },
      include: { contact: { select: { id: true, name: true, primaryChannel: true } } },
    });
    if (!existing) {
      throw new OpportunityNotFoundError(`Opportunity not found: ${id} (org: ${orgId})`);
    }

    const isTerminal = stage === "won" || stage === "lost";
    const updated = await tx.opportunity.update({
      where: { id },
      data: {
        stage,
        closedAt: isTerminal ? (existing.closedAt ?? requestedAt) : null,
        updatedAt: requestedAt,
      },
      include: { contact: { select: { id: true, name: true, primaryChannel: true } } },
    });

    const workUnitId = randomUUID();
    const trace: WorkTrace = {
      workUnitId,
      traceId: workUnitId,
      intent: "opportunity.stage_transition",
      mode: "operator_mutation",
      organizationId: orgId,
      actor,
      trigger: "api",
      parameters: {
        opportunityId: id,
        contactId: existing.contactId,
        fromStage: existing.stage,
        toStage: stage,
      },
      governanceOutcome: "execute",
      riskScore: 0,
      matchedPolicies: [],
      outcome: "running",
      durationMs: 0,
      executionSummary: `operator ${actor.id} transitioned opportunity ${id} from ${existing.stage} to ${stage}`,
      modeMetrics: { governanceMode: "operator_auto_allow" },
      ingressPath: "store_recorded_operator_mutation",
      hashInputVersion: 2,
      requestedAt: requestedAt.toISOString(),
      governanceCompletedAt: requestedAt.toISOString(),
    };

    // workTraceStore type is non-null inside this branch because we checked above.
    await this.workTraceStore!.recordOperatorMutation(trace, {
      tx: tx as Prisma.TransactionClient,
    });

    return { workUnitId, updated };
  });

  const completedAt = new Date();
  const finalizeResult = await this.workTraceStore.update(
    txResult.workUnitId,
    {
      outcome: "completed",
      executionStartedAt: executionStartedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: Math.max(0, completedAt.getTime() - executionStartedAt.getTime()),
    },
    { caller: "PrismaOpportunityStore.transitionStage" },
  );
  if (!finalizeResult.ok) {
    console.warn(
      `[prisma-opportunity-store] transitionStage finalize rejected for ${txResult.workUnitId}: ${finalizeResult.reason}`,
    );
  }

  return {
    opportunity: mapRowToBoardRow(txResult.updated as Parameters<typeof mapRowToBoardRow>[0]),
    workTraceId: txResult.workUnitId,
  };
}
```

The `Prisma` type import is from `@prisma/client`. The `WorkTrace` type import is from `@switchboard/core/platform`. If the existing imports block contains them, merge; otherwise add them.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/db test -- prisma-opportunity-store`
Expected: PASS for all 7 `transitionStage` tests + 3 `findOrgBoard` tests = 10 total.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/prisma-opportunity-store.ts packages/db/src/stores/__tests__/prisma-opportunity-store.test.ts
git commit -m "feat(db): transitionStage with atomic WorkTrace via recordOperatorMutation"
```

---

## Task 7 — Update existing `PrismaOpportunityStore` callers (constructor signature)

**Files:**

- Modify: `apps/api/src/app.ts` (two call sites: lines ~534-545 and ~589-596)
- Modify: `apps/api/src/bootstrap/skill-mode.ts` (line ~86, 113)

The constructor now takes `(prisma, workTraceStore | null)`. Every existing call passes the workTraceStore (already constructed elsewhere in these files).

- [ ] **Step 1: Find the call sites**

Run: `grep -n "new PrismaOpportunityStore" apps/api/src/`
Expected output: 3 or 4 hits across `app.ts` and `bootstrap/skill-mode.ts`.

- [ ] **Step 2: Update each call site**

For each `new PrismaOpportunityStore(prismaClient)` add the `workTraceStore` argument. In `apps/api/src/app.ts`, the `workTraceStore` decorator is already constructed earlier in the file; pass it. Example:

```ts
// before
const opportunityStore = new PrismaOpportunityStore(prismaClient);

// after
const opportunityStore = new PrismaOpportunityStore(prismaClient, workTraceStore);
```

If a particular call site is in a code path that doesn't have `workTraceStore` in scope (rare — typically tests), pass `null` and the runtime will throw on `transitionStage` calls but read paths still work. For production paths, always pass the real store.

In `apps/api/src/bootstrap/skill-mode.ts`, the same pattern applies — locate the `workTraceStore` instance (constructed earlier in `bootstrap/`) and pass it.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS across the monorepo.

- [ ] **Step 4: Run existing api + db tests**

Run: `pnpm --filter @switchboard/api test` and `pnpm --filter @switchboard/db test`
Expected: PASS — no behavior change for existing callers; constructor signature is the only diff.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/app.ts apps/api/src/bootstrap/skill-mode.ts
git commit -m "refactor(api): pass workTraceStore to PrismaOpportunityStore constructor"
```

---

## Task 8 — Fastify route: `GET /api/dashboard/opportunities` (TDD)

**Files:**

- Create: `apps/api/src/routes/dashboard-opportunities.ts`
- Create: `apps/api/src/__tests__/api-opportunities-board.test.ts`

Mirrors `dashboard-contacts.ts` shape exactly.

- [ ] **Step 1: Write the failing integration test**

Create `apps/api/src/__tests__/api-opportunities-board.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { PipelineBoardResponseSchema } from "@switchboard/schemas";
import { buildTestServer } from "./test-server.js";
import type { FastifyInstance } from "fastify";
import type { OpportunityBoardRow } from "@switchboard/core/lifecycle";

function mkRow(overrides: Partial<OpportunityBoardRow> = {}): OpportunityBoardRow {
  return {
    id: "opp_1",
    organizationId: "org_acme",
    contactId: "c_1",
    serviceId: "svc",
    serviceName: "Service",
    stage: "quoted",
    timeline: "soon",
    priceReadiness: "flexible",
    objections: [],
    qualificationComplete: true,
    estimatedValue: 168000,
    revenueTotal: 0,
    assignedAgent: "alex",
    assignedStaff: null,
    lostReason: null,
    notes: null,
    openedAt: new Date("2026-05-06T05:00:00Z"),
    closedAt: null,
    updatedAt: new Date("2026-05-13T07:19:00Z"),
    contact: { id: "c_1", name: "Felicia", primaryChannel: "whatsapp" },
    ...overrides,
  };
}

describe("GET /api/dashboard/opportunities", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildTestServer();
  });

  it("returns { rows } parseable by PipelineBoardResponseSchema", async () => {
    // The test-server's TestOpportunityStore is registered on app.opportunityStore.
    // Seed it with one row.
    const store = app.opportunityStore as unknown as {
      seedBoard: (rows: OpportunityBoardRow[]) => void;
    };
    store.seedBoard([mkRow()]);

    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/opportunities",
      headers: { "x-org-id": "org_acme" },
    });
    expect(res.statusCode).toBe(200);
    const parsed = PipelineBoardResponseSchema.parse(res.json());
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]!.id).toBe("opp_1");
    expect(typeof parsed.rows[0]!.openedAt).toBe("string");
  });

  it("scopes to the request's organizationId — cross-tenant rows are excluded", async () => {
    const store = app.opportunityStore as unknown as {
      seedBoard: (rows: OpportunityBoardRow[]) => void;
    };
    store.seedBoard([
      mkRow({ id: "opp_a", organizationId: "org_acme" }),
      mkRow({ id: "opp_b", organizationId: "org_other" }),
    ]);

    const resAcme = await app.inject({
      method: "GET",
      url: "/api/dashboard/opportunities",
      headers: { "x-org-id": "org_acme" },
    });
    expect(resAcme.json().rows.map((r: { id: string }) => r.id)).toEqual(["opp_a"]);

    const resOther = await app.inject({
      method: "GET",
      url: "/api/dashboard/opportunities",
      headers: { "x-org-id": "org_other" },
    });
    expect(resOther.json().rows.map((r: { id: string }) => r.id)).toEqual(["opp_b"]);
  });

  it("returns [] for an org with no opportunities (not 404)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/opportunities",
      headers: { "x-org-id": "org_empty" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ rows: [] });
  });

  it("returns 503 when app.opportunityStore is null", async () => {
    // Build a server without the opportunity store decorator.
    const appNoStore = await buildTestServer({ opportunityStore: null });
    const res = await appNoStore.inject({
      method: "GET",
      url: "/api/dashboard/opportunities",
      headers: { "x-org-id": "org_acme" },
    });
    expect(res.statusCode).toBe(503);
  });
});
```

Note on `buildTestServer`: this helper exists at `apps/api/src/__tests__/test-server.ts`. If its signature doesn't accept `{ opportunityStore: null }` as an override knob, the implementer should add the option (it accepts other store-override knobs already — mirror the pattern).

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/api test -- api-opportunities-board`
Expected: FAIL — 404 on the route (not registered), or "Cannot find module".

- [ ] **Step 3: Implement the route**

Create `apps/api/src/routes/dashboard-opportunities.ts`:

```ts
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { OpportunitySchema } from "@switchboard/schemas";
import {
  listOpportunitiesForBoard,
  transitionOpportunityStage,
  OpportunityNotFoundError,
} from "@switchboard/core/lifecycle";
import { requireOrganizationScope } from "../utils/require-org.js";

const StageTransitionRequestSchema = z.object({
  stage: OpportunitySchema.shape.stage,
});

export const dashboardOpportunitiesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request) => {
    if (app.authDisabled === true) {
      const headerVal = request.headers["x-org-id"];
      if (typeof headerVal === "string" && headerVal.trim()) {
        request.organizationIdFromAuth = headerVal.trim();
      } else if (!request.organizationIdFromAuth) {
        request.organizationIdFromAuth = "default";
      }
      if (!request.principalIdFromAuth) {
        request.principalIdFromAuth = "default";
      }
    }
  });

  app.get("/api/dashboard/opportunities", async (request, reply) => {
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;
    if (!app.opportunityStore) {
      return reply.code(503).send({ error: "Opportunity store not available" });
    }
    return await listOpportunitiesForBoard({ orgId }, { opportunityStore: app.opportunityStore });
  });

  // PATCH route added in Task 9
};
```

- [ ] **Step 4: Register the route in `test-server.ts`**

Open `apps/api/src/__tests__/test-server.ts` and find where other dashboard routes are registered (search for `dashboardContactsRoutes`). Add:

```ts
import { dashboardOpportunitiesRoutes } from "../routes/dashboard-opportunities.js";
// ...
await app.register(dashboardOpportunitiesRoutes);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/api test -- api-opportunities-board`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/dashboard-opportunities.ts apps/api/src/__tests__/api-opportunities-board.test.ts apps/api/src/__tests__/test-server.ts
git commit -m "feat(api): GET /api/dashboard/opportunities returns org-wide board projection"
```

---

## Task 9 — Fastify route: `PATCH /api/dashboard/opportunities/:id/stage` (TDD)

**Files:**

- Modify: `apps/api/src/routes/dashboard-opportunities.ts`
- Create: `apps/api/src/__tests__/api-opportunities-stage.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `apps/api/src/__tests__/api-opportunities-stage.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { PipelineBoardOpportunitySchema } from "@switchboard/schemas";
import { buildTestServer } from "./test-server.js";
import type { FastifyInstance } from "fastify";
import type { OpportunityBoardRow } from "@switchboard/core/lifecycle";

function mkRow(overrides: Partial<OpportunityBoardRow> = {}): OpportunityBoardRow {
  return {
    id: "opp_1",
    organizationId: "org_acme",
    contactId: "c_1",
    serviceId: "svc",
    serviceName: "Service",
    stage: "quoted",
    timeline: null,
    priceReadiness: null,
    objections: [],
    qualificationComplete: true,
    estimatedValue: 168000,
    revenueTotal: 0,
    assignedAgent: null,
    assignedStaff: null,
    lostReason: null,
    notes: null,
    openedAt: new Date("2026-05-06T05:00:00Z"),
    closedAt: null,
    updatedAt: new Date("2026-05-13T07:19:00Z"),
    contact: { id: "c_1", name: "Felicia", primaryChannel: "whatsapp" },
    ...overrides,
  };
}

describe("PATCH /api/dashboard/opportunities/:id/stage", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildTestServer();
    const store = app.opportunityStore as unknown as {
      seedBoard: (rows: OpportunityBoardRow[]) => void;
    };
    store.seedBoard([
      mkRow({ id: "opp_1", organizationId: "org_acme" }),
      mkRow({ id: "opp_other_org", organizationId: "org_other" }),
    ]);
  });

  it("returns 200 { opportunity } parseable by PipelineBoardOpportunitySchema", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/dashboard/opportunities/opp_1/stage",
      headers: { "x-org-id": "org_acme", "content-type": "application/json" },
      payload: { stage: "booked" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { opportunity: unknown };
    const opp = PipelineBoardOpportunitySchema.parse(body.opportunity);
    expect(opp.stage).toBe("booked");
  });

  it("writes a WorkTrace with ingressPath store_recorded_operator_mutation", async () => {
    const store = app.opportunityStore as unknown as {
      lastTraceWritten: {
        ingressPath: string;
        intent: string;
        parameters: Record<string, unknown>;
      } | null;
    };
    await app.inject({
      method: "PATCH",
      url: "/api/dashboard/opportunities/opp_1/stage",
      headers: { "x-org-id": "org_acme", "content-type": "application/json" },
      payload: { stage: "booked" },
    });
    expect(store.lastTraceWritten).toEqual({
      ingressPath: "store_recorded_operator_mutation",
      intent: "opportunity.stage_transition",
      parameters: {
        opportunityId: "opp_1",
        contactId: "c_1",
        fromStage: "quoted",
        toStage: "booked",
      },
    });
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/dashboard/opportunities/opp_does_not_exist/stage",
      headers: { "x-org-id": "org_acme", "content-type": "application/json" },
      payload: { stage: "booked" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "OPPORTUNITY_NOT_FOUND" });
  });

  it("returns 404 for cross-tenant id (org A's opportunity from org B's session)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/dashboard/opportunities/opp_other_org/stage",
      headers: { "x-org-id": "org_acme", "content-type": "application/json" },
      payload: { stage: "booked" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for invalid stage", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/dashboard/opportunities/opp_1/stage",
      headers: { "x-org-id": "org_acme", "content-type": "application/json" },
      payload: { stage: "not_a_valid_stage" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "INVALID_BODY" });
  });

  it("returns 400 for missing stage", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/dashboard/opportunities/opp_1/stage",
      headers: { "x-org-id": "org_acme", "content-type": "application/json" },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 503 when opportunityStore is null", async () => {
    const appNoStore = await buildTestServer({ opportunityStore: null });
    const res = await appNoStore.inject({
      method: "PATCH",
      url: "/api/dashboard/opportunities/opp_1/stage",
      headers: { "x-org-id": "org_acme", "content-type": "application/json" },
      payload: { stage: "booked" },
    });
    expect(res.statusCode).toBe(503);
  });

  it("emits a WorkTrace on idempotent same-stage PATCH (quoted → quoted)", async () => {
    const store = app.opportunityStore as unknown as {
      lastTraceWritten: { parameters: Record<string, unknown> } | null;
    };
    const res = await app.inject({
      method: "PATCH",
      url: "/api/dashboard/opportunities/opp_1/stage",
      headers: { "x-org-id": "org_acme", "content-type": "application/json" },
      payload: { stage: "quoted" },
    });
    expect(res.statusCode).toBe(200);
    expect(store.lastTraceWritten?.parameters).toMatchObject({
      fromStage: "quoted",
      toStage: "quoted",
    });
  });

  it("sets closedAt on terminal transition (quoted → won)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/dashboard/opportunities/opp_1/stage",
      headers: { "x-org-id": "org_acme", "content-type": "application/json" },
      payload: { stage: "won" },
    });
    const body = res.json() as { opportunity: { closedAt: string | null } };
    expect(body.opportunity.closedAt).toBeTruthy();
    expect(typeof body.opportunity.closedAt).toBe("string");
  });

  it("clears closedAt when leaving a terminal stage", async () => {
    // Seed the store with a won row, then move it back to quoted.
    const store = app.opportunityStore as unknown as {
      seedBoard: (rows: OpportunityBoardRow[]) => void;
    };
    store.seedBoard([
      mkRow({ id: "opp_w", organizationId: "org_acme", stage: "won", closedAt: new Date() }),
    ]);
    const res = await app.inject({
      method: "PATCH",
      url: "/api/dashboard/opportunities/opp_w/stage",
      headers: { "x-org-id": "org_acme", "content-type": "application/json" },
      payload: { stage: "quoted" },
    });
    const body = res.json() as { opportunity: { closedAt: string | null } };
    expect(body.opportunity.closedAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/api test -- api-opportunities-stage`
Expected: FAIL — 404 on PATCH (route not registered yet).

- [ ] **Step 3: Add the PATCH route to `dashboard-opportunities.ts`**

Inside the existing plugin (after the GET handler):

```ts
app.patch("/api/dashboard/opportunities/:id/stage", async (request, reply) => {
  const orgId = requireOrganizationScope(request, reply);
  if (!orgId) return;
  if (!app.opportunityStore) {
    return reply.code(503).send({ error: "Opportunity store not available" });
  }
  const parsed = StageTransitionRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "INVALID_BODY" });
  }
  const { id } = request.params as { id: string };
  const principalId = request.principalIdFromAuth ?? "unknown";
  try {
    return await transitionOpportunityStage(
      { orgId, id, stage: parsed.data.stage, actor: { id: principalId, type: "user" } },
      { opportunityStore: app.opportunityStore },
    );
  } catch (err) {
    if (err instanceof OpportunityNotFoundError) {
      return reply.code(404).send({ error: "OPPORTUNITY_NOT_FOUND" });
    }
    throw err;
  }
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/api test -- api-opportunities-stage`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/dashboard-opportunities.ts apps/api/src/__tests__/api-opportunities-stage.test.ts
git commit -m "feat(api): PATCH /api/dashboard/opportunities/:id/stage with audit emission"
```

---

## Task 10 — Wire the route into `app.ts`

**Files:**

- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Register the route in production app**

Open `apps/api/src/app.ts`, locate the block where dashboard routes are registered (search for `dashboardContactsRoutes` or `dashboardReportsRoutes`), and add:

```ts
import { dashboardOpportunitiesRoutes } from "./routes/dashboard-opportunities.js";
// ...
await app.register(dashboardOpportunitiesRoutes);
```

The registration line goes alongside the other `dashboard-*` route registrations.

- [ ] **Step 2: Typecheck + test**

Run: `pnpm --filter @switchboard/api typecheck && pnpm --filter @switchboard/api test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/app.ts
git commit -m "chore(api): register dashboardOpportunitiesRoutes in app"
```

---

## Task 11 — Dashboard API client: add `getOpportunitiesBoard` + `patchOpportunityStage`

**Files:**

- Modify: `apps/dashboard/src/lib/get-api-client.ts`

- [ ] **Step 1: Inspect the existing API client to learn its pattern**

Run: `grep -n "getContacts\|getReports\|getReport\|fetch\b" apps/dashboard/src/lib/get-api-client.ts | head`
Then read the function body of `getContacts` (or whichever GET method already exists) and the function body of any existing POST/PATCH method to learn the exact return-type pattern (raw JSON vs parsed schema) and how auth headers are forwarded.

- [ ] **Step 2: Add the two methods**

In `apps/dashboard/src/lib/get-api-client.ts`, add (location: alongside the existing dashboard methods):

```ts
async getOpportunitiesBoard(): Promise<unknown> {
  const res = await this.fetch("/api/dashboard/opportunities", { method: "GET" });
  if (!res.ok) throw new Error(`opportunities/board ${res.status}`);
  return res.json();
}

async patchOpportunityStage(id: string, stage: string): Promise<unknown> {
  const res = await this.fetch(`/api/dashboard/opportunities/${encodeURIComponent(id)}/stage`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ stage }),
  });
  if (!res.ok) {
    if (res.status === 404) throw new Error("not found");
    if (res.status === 400) throw new Error("invalid");
    throw new Error(`opportunities/stage ${res.status}`);
  }
  return res.json();
}
```

If the existing pattern wraps results in a typed return (e.g., `Promise<ContactsListResponse>`), reuse the same pattern with `PipelineBoardResponse` / `{ opportunity: PipelineBoardOpportunity }` types imported from `@switchboard/schemas`. The above signatures use `unknown` because the proxy route does its own JSON pass-through; both work.

- [ ] **Step 3: Typecheck dashboard**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/lib/get-api-client.ts
git commit -m "feat(dashboard): API client methods for opportunities board + stage"
```

---

## Task 12 — Dashboard proxy: GET route (TDD)

**Files:**

- Create: `apps/dashboard/src/app/api/dashboard/opportunities/route.ts`
- Create: `apps/dashboard/src/app/api/dashboard/opportunities/__tests__/route.test.ts`

Mirrors `apps/dashboard/src/app/api/dashboard/contacts/route.ts` exactly.

- [ ] **Step 1: Read the precedent**

Read `apps/dashboard/src/app/api/dashboard/contacts/route.ts` end-to-end (it's 27 lines). The new proxy is structurally identical.

- [ ] **Step 2: Write the failing test**

Create `apps/dashboard/src/app/api/dashboard/opportunities/__tests__/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/get-api-client", () => ({
  getApiClient: vi.fn().mockResolvedValue({
    getOpportunitiesBoard: vi.fn().mockResolvedValue({ rows: [] }),
  }),
}));

import { GET } from "../route";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";

describe("GET /api/dashboard/opportunities (proxy)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards to client.getOpportunitiesBoard() and returns 200 JSON", async () => {
    const res = await GET();
    expect(requireSession).toHaveBeenCalledTimes(1);
    expect(getApiClient).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ rows: [] });
  });

  it("returns 401 when requireSession throws Unauthorized", async () => {
    vi.mocked(requireSession).mockRejectedValueOnce(new Error("Unauthorized"));
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 500 for other errors", async () => {
    vi.mocked(requireSession).mockRejectedValueOnce(new Error("Boom"));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- opportunities/__tests__/route`
Expected: FAIL — "Cannot find module '../route'".

- [ ] **Step 4: Implement the proxy route**

Create `apps/dashboard/src/app/api/dashboard/opportunities/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { proxyError } from "@/lib/proxy-error";

export async function GET() {
  try {
    await requireSession();
    const client = await getApiClient();
    const data = await client.getOpportunitiesBoard();
    return NextResponse.json(data);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
```

Note: this file imports without `.js` extensions per memory `feedback_dashboard_no_js_on_any_import.md` — Next.js rejects relative paths with `.js`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- opportunities/__tests__/route`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/app/api/dashboard/opportunities/
git commit -m "feat(dashboard): proxy route GET /api/dashboard/opportunities"
```

---

## Task 13 — Dashboard proxy: PATCH route (TDD)

**Files:**

- Create: `apps/dashboard/src/app/api/dashboard/opportunities/[id]/stage/route.ts`
- Create: `apps/dashboard/src/app/api/dashboard/opportunities/[id]/stage/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/app/api/dashboard/opportunities/[id]/stage/__tests__/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn().mockResolvedValue(undefined) }));
const patchMock = vi.fn();
vi.mock("@/lib/get-api-client", () => ({
  getApiClient: vi.fn().mockResolvedValue({ patchOpportunityStage: patchMock }),
}));

import { PATCH } from "../route";
import { requireSession } from "@/lib/session";

function mkReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/dashboard/opportunities/opp_1/stage", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/dashboard/opportunities/:id/stage (proxy)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patchMock.mockReset();
  });

  it("forwards { stage } to client.patchOpportunityStage(id, stage)", async () => {
    patchMock.mockResolvedValueOnce({ opportunity: { id: "opp_1", stage: "booked" } });
    const res = await PATCH(mkReq({ stage: "booked" }), { params: { id: "opp_1" } });
    expect(patchMock).toHaveBeenCalledWith("opp_1", "booked");
    expect(res.status).toBe(200);
  });

  it("returns 401 on Unauthorized", async () => {
    vi.mocked(requireSession).mockRejectedValueOnce(new Error("Unauthorized"));
    const res = await PATCH(mkReq({ stage: "booked" }), { params: { id: "opp_1" } });
    expect(res.status).toBe(401);
  });

  it("maps upstream 'not found' to 404", async () => {
    patchMock.mockRejectedValueOnce(new Error("not found"));
    const res = await PATCH(mkReq({ stage: "booked" }), { params: { id: "opp_x" } });
    expect(res.status).toBe(404);
  });

  it("maps upstream 'invalid' to 400", async () => {
    patchMock.mockRejectedValueOnce(new Error("invalid"));
    const res = await PATCH(mkReq({ stage: "garbage" }), { params: { id: "opp_1" } });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- "stage/__tests__/route"`
Expected: FAIL — "Cannot find module '../route'".

- [ ] **Step 3: Implement the PATCH proxy**

Create `apps/dashboard/src/app/api/dashboard/opportunities/[id]/stage/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { proxyError } from "@/lib/proxy-error";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireSession();
    const client = await getApiClient();
    const body = (await req.json()) as { stage?: string };
    const data = await client.patchOpportunityStage(params.id, body.stage ?? "");
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "Unauthorized") return proxyError({ error: message }, 401);
    if (/not found/i.test(message)) return proxyError({ error: message }, 404);
    if (/invalid/i.test(message)) return proxyError({ error: message }, 400);
    return proxyError({ error: message }, 500);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- "stage/__tests__/route"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/api/dashboard/opportunities/
git commit -m "feat(dashboard): proxy route PATCH /api/dashboard/opportunities/:id/stage"
```

---

## Task 14 — Full verification

**Files:** none — verification-only.

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: ALL pass. If `feedback_db_integrity_tests_pg_advisory_lock` failures appear in `prisma-work-trace-store-integrity` / `prisma-ledger-storage` / `prisma-greeting-signal-store` — those are pre-existing and unrelated; document in PR body that they reproduce on baseline.

- [ ] **Step 2: Typecheck the whole monorepo**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 4: Dashboard build** (memory `feedback_dashboard_build_not_in_ci.md`)

Run: `pnpm --filter @switchboard/dashboard build`
Expected: PASS. This catches the `.js`-extension regressions that lint+test miss.

- [ ] **Step 5: Confirm the C1 wire-shape lock test passed in step 1**

The test at `packages/schemas/src/pipeline-board.test.ts` `describe("PipelineBoardResponseSchema — locked PR-C2 wire shape")` is the cross-PR contract gate. Confirm it's green in the step-1 output by searching the test report for "locked PR-C2 wire shape".

- [ ] **Step 6: Confirm `NEXT_PUBLIC_CONTACTS_LIVE` is unchanged**

Run: `git diff <merge-base> -- $(git ls-files | xargs grep -l CONTACTS_LIVE 2>/dev/null) | head`
Expected: no functional diff to any line containing `CONTACTS_LIVE`. (Test files may add references; that's fine — the flag value in production paths must be the same.)

- [ ] **Step 7: Confirm `apps/dashboard/src/app/(auth)/(mercury)/contacts/**` is byte-for-byte untouched\*\*

Run: `git diff <merge-base> -- 'apps/dashboard/src/app/(auth)/(mercury)/contacts'`
Expected: empty output, or only test-snapshot whitespace changes (very unlikely — none should be introduced).

- [ ] **Step 8: Open the PR**

````bash
git push -u origin feat/contacts-pipeline-pr-c2
gh pr create --base <c1-branch-or-main> --title "feat(contacts-pipeline): backend (PR-C2)" --body "$(cat <<'EOF'
## Summary

Backend layer for the Mercury /contacts opportunity pipeline board. Ships:

- Two Fastify endpoints (GET org-wide board, PATCH stage transition)
- Core projection module (`@switchboard/core/lifecycle` → `listOpportunitiesForBoard`, `transitionOpportunityStage`)
- Atomic Prisma store mutation with WorkTrace via `ingressPath: "store_recorded_operator_mutation"`
- Dashboard proxy routes mirroring the /contacts and /reports proxy pattern

**Flag:** `NEXT_PUBLIC_CONTACTS_LIVE` unchanged (still OFF). PR-C3 flips.

**Audit path chosen:** `store_recorded_operator_mutation`, not `PlatformIngress.submit()`. See spec §2 OPEN-A2 for the justification — operator-direct UI edits use the documented second ingress path, matching the precedent set by `conversationStateStore.releaseEscalationToAi` and the escalations route.

**C1 wire-shape lock test passes:** `packages/schemas/src/pipeline-board.test.ts` (the "locked PR-C2 wire shape" describe block).

## Curl examples

GET (SGD-medspa pilot, 2 cards):
```bash
curl -s http://localhost:3000/api/dashboard/opportunities -H "x-org-id: org_acme" | jq
# { "rows": [ { "id": "opp_1", "serviceName": "Profhilo · 2-session protocol", "stage": "quoted", ... } ] }
````

PATCH (stage transition):

```bash
curl -s -X PATCH http://localhost:3000/api/dashboard/opportunities/opp_1/stage \
  -H "x-org-id: org_acme" -H "content-type: application/json" \
  -d '{"stage": "booked"}' | jq
# { "opportunity": { "id": "opp_1", "stage": "booked", "updatedAt": "2026-05-14T08:12:33.000Z", ... } }
```

## Test plan

- [x] `pnpm test` — all green except pre-existing pg_advisory_lock flakes (memory `feedback_db_integrity_tests_pg_advisory_lock.md`)
- [x] `pnpm typecheck`
- [x] `pnpm lint`
- [x] `pnpm --filter @switchboard/dashboard build`
- [x] C1 wire-shape lock test still passes
- [x] `apps/dashboard/src/app/(auth)/(mercury)/contacts/**` byte-for-byte untouched

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"

```

The base ref depends on whether PR-C1 has merged when PR-C2 opens. If C1 is still open, base `feat/contacts-pipeline-pr-c1`; if merged, rebase to main and base `main`.

---

## Self-review notes

Verified against the spec:

- §A1 (no paging, all stages) → Task 5 `findOrgBoard` filters only by `organizationId`, sorts `updatedAt DESC`.
- §A2 (audit path) → Task 6 uses `recordOperatorMutation` with `ingressPath: "store_recorded_operator_mutation"`.
- §A3, A4 (envelopes) → Tasks 8, 9 return `{ rows }` and `{ opportunity }`.
- §A5 (error codes) → Task 9 covers 200/400/404/503; no 409.
- §A6 (same-stage emits trace) → Task 6 + Task 9 both have explicit tests.
- §A7, A8 (store split) → Task 1 interface + Task 6 implementation; `updateStage` untouched.
- §A9 (cross-tenant safety) → Task 5 test + Task 6 test + Task 9 test all assert it.
- §A10, A11, A12 (trace fields) → Task 6 implementation pins them; Task 9 test asserts via `lastTraceWritten`.
- §7.1 (wire-shape lock) → Task 14 step 5 confirms.
- §12 (acceptance criteria) → Task 14 covers all 9 criteria.

No placeholders. Type names match across tasks: `OpportunityBoardRow`, `TransitionStageInput`, `TransitionStageResult`, `OpportunityNotFoundError`, `listOpportunitiesForBoard`, `transitionOpportunityStage` consistent in Tasks 1–13.
```
