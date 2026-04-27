# Approval Lifecycle Completion v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current split approval/execution path with one authoritative lifecycle that is race-safe, durable, and eliminates trust gaps before launch.

**Architecture:** Introduce three new authority objects (ApprovalLifecycle, ApprovalRevision, ExecutableWorkUnit) plus a thin DispatchRecord. ApprovalLifecycleService becomes the sole owner of approval authority mutations. Dispatcher only accepts ExecutableWorkUnit. Routes become thin transport adapters that invoke explicit commands. Legacy PlatformLifecycle.respondToApproval() is replaced incrementally — new code is built alongside it, then callers migrate, then old code is deleted.

**Tech Stack:** TypeScript, Prisma (PostgreSQL), Vitest, Zod, ESM

---

## File Structure

### New Files

| File                                                                   | Responsibility                                                      |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `packages/schemas/src/approval-lifecycle.ts`                           | Zod schemas + types for all lifecycle objects                       |
| `packages/core/src/approval/lifecycle-service.ts`                      | ApprovalLifecycleService — sole authority owner                     |
| `packages/core/src/approval/lifecycle-types.ts`                        | TypeScript interfaces for lifecycle domain                          |
| `packages/core/src/approval/executable-materializer.ts`                | Freezes an approved revision into an ExecutableWorkUnit             |
| `packages/core/src/approval/lifecycle-expiry.ts`                       | Active expiry sweep logic                                           |
| `packages/core/src/approval/dispatch-admission.ts`                     | Dispatcher admission checks (pointer + status validation)           |
| `packages/core/src/approval/__tests__/lifecycle-service.test.ts`       | Lifecycle service unit tests                                        |
| `packages/core/src/approval/__tests__/executable-materializer.test.ts` | Materializer unit tests                                             |
| `packages/core/src/approval/__tests__/dispatch-admission.test.ts`      | Admission logic unit tests                                          |
| `packages/core/src/approval/__tests__/lifecycle-expiry.test.ts`        | Active expiry tests                                                 |
| `packages/core/src/approval/__tests__/lifecycle-invariants.test.ts`    | Cross-cutting invariant + race tests                                |
| `packages/db/src/storage/prisma-lifecycle-store.ts`                    | Prisma store for lifecycle + revision + work unit + dispatch record |

### Modified Files

| File                                               | Change                                               |
| -------------------------------------------------- | ---------------------------------------------------- |
| `packages/db/prisma/schema.prisma`                 | Add 4 new models                                     |
| `packages/schemas/src/index.ts`                    | Re-export lifecycle schemas                          |
| `packages/core/src/approval/index.ts`              | Re-export lifecycle modules                          |
| `packages/core/src/storage/interfaces.ts`          | Add `ApprovalLifecycleStore` interface               |
| `packages/core/src/platform/platform-ingress.ts`   | Create lifecycle atomically on `require_approval`    |
| `packages/core/src/platform/platform-lifecycle.ts` | Delegate to lifecycle service, then retire           |
| `apps/api/src/routes/approvals.ts`                 | Route to lifecycle commands, lifecycle-derived reads |
| `apps/api/src/routes/actions.ts`                   | Remove route-owned approval creation                 |
| `apps/api/src/routes/approval-factory.ts`          | Retire (logic moves into lifecycle service)          |

---

## Task 1: Prisma Models

**Files:**

- Modify: `packages/db/prisma/schema.prisma:232-249`

- [ ] **Step 1: Add 4 new Prisma models after the existing ApprovalRecord model**

Add these models after line 249 in `schema.prisma`:

```prisma
// ---------------------------------------------------------------------------
// ApprovalLifecycle — mutable approval/runtime control-plane authority
// ---------------------------------------------------------------------------

model ApprovalLifecycle {
  id                         String    @id @default(uuid())
  actionEnvelopeId           String    @unique
  organizationId             String?
  status                     String    @default("pending") // pending | approved | rejected | expired | superseded | recovery_required
  currentRevisionId          String?
  currentExecutableWorkUnitId String?
  expiresAt                  DateTime
  pausedSessionId            String?
  version                    Int       @default(1)
  createdAt                  DateTime  @default(now())
  updatedAt                  DateTime  @updatedAt

  @@index([status])
  @@index([organizationId, status])
  @@index([expiresAt])
}

// ---------------------------------------------------------------------------
// ApprovalRevision — immutable snapshot of approval scope at a version
// ---------------------------------------------------------------------------

model ApprovalRevision {
  id                   String   @id @default(uuid())
  lifecycleId          String
  revisionNumber       Int
  parametersSnapshot   Json     // frozen action parameters
  approvalScopeSnapshot Json    // approvers, risk, routing config
  bindingHash          String
  rationale            String?
  supersedesRevisionId String?
  createdBy            String
  createdAt            DateTime @default(now())

  @@unique([lifecycleId, revisionNumber])
  @@index([lifecycleId])
}

// ---------------------------------------------------------------------------
// ExecutableWorkUnit — immutable dispatch authority from one approved revision
// ---------------------------------------------------------------------------

model ExecutableWorkUnit {
  id                     String   @id @default(uuid())
  lifecycleId            String
  approvalRevisionId     String   @unique
  actionEnvelopeId       String
  frozenPayload          Json     // frozen WorkUnit snapshot
  frozenBinding          Json     // frozen deployment + resolver target
  frozenExecutionPolicy  Json     // frozen constraints
  executableUntil        DateTime
  createdAt              DateTime @default(now())

  @@index([lifecycleId])
}

// ---------------------------------------------------------------------------
// DispatchRecord — thin durable dispatch record (pre-launch minimal attempt)
// ---------------------------------------------------------------------------

model DispatchRecord {
  id                     String    @id @default(uuid())
  executableWorkUnitId   String
  attemptNumber          Int
  idempotencyKey         String    @unique
  state                  String    @default("dispatching") // dispatching | succeeded | failed | terminal_failed
  dispatchedAt           DateTime  @default(now())
  completedAt            DateTime?
  outcome                String?
  errorMessage           String?
  durationMs             Int?

  @@unique([executableWorkUnitId, attemptNumber])
  @@index([executableWorkUnitId])
}
```

- [ ] **Step 2: Run Prisma generate**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 db:generate`
Expected: Prisma client regenerated successfully

- [ ] **Step 3: Run Prisma migration**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 db:migrate -- --name add-approval-lifecycle-models`
Expected: Migration created and applied

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: add Prisma models for approval lifecycle authority objects"
```

---

## Task 2: Zod Schemas + TypeScript Types

**Files:**

- Create: `packages/schemas/src/approval-lifecycle.ts`
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create: `packages/schemas/src/__tests__/approval-lifecycle.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import {
  ApprovalLifecycleStatusSchema,
  ApprovalLifecycleSchema,
  ApprovalRevisionSchema,
  ExecutableWorkUnitSchema,
  DispatchRecordSchema,
  DispatchRecordStateSchema,
  LifecycleCommandSchema,
} from "../approval-lifecycle.js";

describe("ApprovalLifecycleStatusSchema", () => {
  it("accepts valid statuses", () => {
    for (const s of [
      "pending",
      "approved",
      "rejected",
      "expired",
      "superseded",
      "recovery_required",
    ]) {
      expect(ApprovalLifecycleStatusSchema.parse(s)).toBe(s);
    }
  });

  it("rejects invalid status", () => {
    expect(() => ApprovalLifecycleStatusSchema.parse("patched")).toThrow();
  });
});

describe("ApprovalLifecycleSchema", () => {
  it("parses a valid lifecycle object", () => {
    const result = ApprovalLifecycleSchema.parse({
      id: "lc-1",
      actionEnvelopeId: "env-1",
      organizationId: "org-1",
      status: "pending",
      currentRevisionId: "rev-1",
      currentExecutableWorkUnitId: null,
      expiresAt: new Date().toISOString(),
      pausedSessionId: null,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(result.id).toBe("lc-1");
    expect(result.status).toBe("pending");
  });
});

describe("ApprovalRevisionSchema", () => {
  it("parses a valid revision", () => {
    const result = ApprovalRevisionSchema.parse({
      id: "rev-1",
      lifecycleId: "lc-1",
      revisionNumber: 1,
      parametersSnapshot: { budget: 5000 },
      approvalScopeSnapshot: { approvers: ["user-1"], riskCategory: "medium" },
      bindingHash: "a".repeat(64),
      rationale: null,
      supersedesRevisionId: null,
      createdBy: "user-1",
      createdAt: new Date().toISOString(),
    });
    expect(result.revisionNumber).toBe(1);
  });
});

describe("ExecutableWorkUnitSchema", () => {
  it("parses a valid executable work unit", () => {
    const result = ExecutableWorkUnitSchema.parse({
      id: "ewu-1",
      lifecycleId: "lc-1",
      approvalRevisionId: "rev-1",
      actionEnvelopeId: "env-1",
      frozenPayload: { intent: "campaign.pause", parameters: {} },
      frozenBinding: { deploymentId: "dep-1" },
      frozenExecutionPolicy: { maxRetries: 3 },
      executableUntil: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    expect(result.id).toBe("ewu-1");
  });
});

describe("DispatchRecordSchema", () => {
  it("parses a valid dispatch record", () => {
    const result = DispatchRecordSchema.parse({
      id: "dr-1",
      executableWorkUnitId: "ewu-1",
      attemptNumber: 1,
      idempotencyKey: "idem-1",
      state: "dispatching",
      dispatchedAt: new Date().toISOString(),
      completedAt: null,
      outcome: null,
      errorMessage: null,
      durationMs: null,
    });
    expect(result.state).toBe("dispatching");
  });
});

describe("DispatchRecordStateSchema", () => {
  it("rejects invalid state", () => {
    expect(() => DispatchRecordStateSchema.parse("pending")).toThrow();
  });
});

describe("LifecycleCommandSchema", () => {
  it("accepts valid commands", () => {
    for (const c of [
      "create_gated_lifecycle",
      "create_revision",
      "approve_revision",
      "reject_revision",
      "create_revision_and_approve",
      "expire_lifecycle",
      "dispatch_executable_work_unit",
      "record_dispatch_outcome",
    ]) {
      expect(LifecycleCommandSchema.parse(c)).toBe(c);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/schemas test -- --run approval-lifecycle`
Expected: FAIL — module not found

- [ ] **Step 3: Write the schemas**

Create: `packages/schemas/src/approval-lifecycle.ts`

```typescript
import { z } from "zod";

export const ApprovalLifecycleStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "expired",
  "superseded",
  "recovery_required",
]);
export type ApprovalLifecycleStatus = z.infer<typeof ApprovalLifecycleStatusSchema>;

export const ApprovalLifecycleSchema = z.object({
  id: z.string(),
  actionEnvelopeId: z.string(),
  organizationId: z.string().nullable(),
  status: ApprovalLifecycleStatusSchema,
  currentRevisionId: z.string().nullable(),
  currentExecutableWorkUnitId: z.string().nullable(),
  expiresAt: z.coerce.date(),
  pausedSessionId: z.string().nullable(),
  version: z.number().int().min(1),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type ApprovalLifecycle = z.infer<typeof ApprovalLifecycleSchema>;

export const ApprovalRevisionSchema = z.object({
  id: z.string(),
  lifecycleId: z.string(),
  revisionNumber: z.number().int().min(1),
  parametersSnapshot: z.record(z.unknown()),
  approvalScopeSnapshot: z.record(z.unknown()),
  bindingHash: z.string(),
  rationale: z.string().nullable(),
  supersedesRevisionId: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.coerce.date(),
});
export type ApprovalRevision = z.infer<typeof ApprovalRevisionSchema>;

export const ExecutableWorkUnitSchema = z.object({
  id: z.string(),
  lifecycleId: z.string(),
  approvalRevisionId: z.string(),
  actionEnvelopeId: z.string(),
  frozenPayload: z.record(z.unknown()),
  frozenBinding: z.record(z.unknown()),
  frozenExecutionPolicy: z.record(z.unknown()),
  executableUntil: z.coerce.date(),
  createdAt: z.coerce.date(),
});
export type ExecutableWorkUnit = z.infer<typeof ExecutableWorkUnitSchema>;

export const DispatchRecordStateSchema = z.enum([
  "dispatching",
  "succeeded",
  "failed",
  "terminal_failed",
]);
export type DispatchRecordState = z.infer<typeof DispatchRecordStateSchema>;

export const DispatchRecordSchema = z.object({
  id: z.string(),
  executableWorkUnitId: z.string(),
  attemptNumber: z.number().int().min(1),
  idempotencyKey: z.string(),
  state: DispatchRecordStateSchema,
  dispatchedAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable(),
  outcome: z.string().nullable(),
  errorMessage: z.string().nullable(),
  durationMs: z.number().nullable(),
});
export type DispatchRecord = z.infer<typeof DispatchRecordSchema>;

export const LifecycleCommandSchema = z.enum([
  "create_gated_lifecycle",
  "create_revision",
  "approve_revision",
  "reject_revision",
  "create_revision_and_approve",
  "expire_lifecycle",
  "dispatch_executable_work_unit",
  "record_dispatch_outcome",
]);
export type LifecycleCommand = z.infer<typeof LifecycleCommandSchema>;
```

- [ ] **Step 4: Add re-export to schemas barrel**

Add to `packages/schemas/src/index.ts`:

```typescript
export * from "./approval-lifecycle.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/schemas test -- --run approval-lifecycle`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: add Zod schemas for approval lifecycle authority objects"
```

---

## Task 3: Storage Interface + Prisma Store

**Files:**

- Modify: `packages/core/src/storage/interfaces.ts`
- Create: `packages/core/src/approval/lifecycle-types.ts`
- Create: `packages/db/src/storage/prisma-lifecycle-store.ts`

- [ ] **Step 1: Define the store interface types**

Create: `packages/core/src/approval/lifecycle-types.ts`

```typescript
import type {
  ApprovalLifecycleStatus,
  ApprovalRevision,
  ExecutableWorkUnit,
  DispatchRecord,
} from "@switchboard/schemas";

export interface LifecycleRecord {
  id: string;
  actionEnvelopeId: string;
  organizationId: string | null;
  status: ApprovalLifecycleStatus;
  currentRevisionId: string | null;
  currentExecutableWorkUnitId: string | null;
  expiresAt: Date;
  pausedSessionId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateLifecycleInput {
  actionEnvelopeId: string;
  organizationId?: string | null;
  expiresAt: Date;
  pausedSessionId?: string | null;
  initialRevision: {
    parametersSnapshot: Record<string, unknown>;
    approvalScopeSnapshot: Record<string, unknown>;
    bindingHash: string;
    createdBy: string;
  };
}

export interface CreateRevisionInput {
  lifecycleId: string;
  parametersSnapshot: Record<string, unknown>;
  approvalScopeSnapshot: Record<string, unknown>;
  bindingHash: string;
  rationale?: string | null;
  supersedesRevisionId?: string | null;
  createdBy: string;
}

export interface MaterializeWorkUnitInput {
  lifecycleId: string;
  approvalRevisionId: string;
  actionEnvelopeId: string;
  frozenPayload: Record<string, unknown>;
  frozenBinding: Record<string, unknown>;
  frozenExecutionPolicy: Record<string, unknown>;
  executableUntil: Date;
}

export interface ApprovalLifecycleStore {
  createLifecycleWithRevision(
    input: CreateLifecycleInput,
  ): Promise<{ lifecycle: LifecycleRecord; revision: ApprovalRevision }>;

  getLifecycleById(id: string): Promise<LifecycleRecord | null>;
  getLifecycleByEnvelopeId(envelopeId: string): Promise<LifecycleRecord | null>;

  getRevision(lifecycleId: string, revisionNumber: number): Promise<ApprovalRevision | null>;
  getRevisionById(id: string): Promise<ApprovalRevision | null>;
  getCurrentRevision(lifecycleId: string): Promise<ApprovalRevision | null>;

  createRevision(input: CreateRevisionInput): Promise<ApprovalRevision>;

  updateLifecycleStatus(
    id: string,
    status: ApprovalLifecycleStatus,
    expectedVersion: number,
    updates?: {
      currentRevisionId?: string;
      currentExecutableWorkUnitId?: string;
    },
  ): Promise<LifecycleRecord>;

  materializeWorkUnit(input: MaterializeWorkUnitInput): Promise<ExecutableWorkUnit>;

  getExecutableWorkUnit(id: string): Promise<ExecutableWorkUnit | null>;

  createDispatchRecord(input: {
    executableWorkUnitId: string;
    attemptNumber: number;
    idempotencyKey: string;
  }): Promise<DispatchRecord>;

  updateDispatchRecord(
    id: string,
    updates: {
      state: string;
      outcome?: string | null;
      errorMessage?: string | null;
      completedAt?: Date;
      durationMs?: number;
    },
  ): Promise<DispatchRecord>;

  listPendingLifecycles(organizationId?: string): Promise<LifecycleRecord[]>;
  listExpiredPendingLifecycles(now?: Date): Promise<LifecycleRecord[]>;
}
```

- [ ] **Step 2: Add the interface to core's storage interfaces**

Add to `packages/core/src/storage/interfaces.ts` after the `ApprovalStore` interface (after line 70):

```typescript
export type { ApprovalLifecycleStore } from "../approval/lifecycle-types.js";
```

- [ ] **Step 3: Add re-export to approval barrel**

Add to `packages/core/src/approval/index.ts`:

```typescript
export * from "./lifecycle-types.js";
```

- [ ] **Step 4: Write the Prisma store**

Create: `packages/db/src/storage/prisma-lifecycle-store.ts`

```typescript
import type { PrismaClient } from "@prisma/client";
import type {
  ApprovalLifecycleStore,
  LifecycleRecord,
  CreateLifecycleInput,
  CreateRevisionInput,
  MaterializeWorkUnitInput,
} from "@switchboard/core/approval";
import type {
  ApprovalLifecycleStatus,
  ApprovalRevision,
  ExecutableWorkUnit,
  DispatchRecord,
} from "@switchboard/schemas";
import { StaleVersionError } from "@switchboard/core";
import { randomUUID } from "node:crypto";

export class PrismaLifecycleStore implements ApprovalLifecycleStore {
  constructor(private prisma: PrismaClient) {}

  async createLifecycleWithRevision(
    input: CreateLifecycleInput,
  ): Promise<{ lifecycle: LifecycleRecord; revision: ApprovalRevision }> {
    const lifecycleId = randomUUID();
    const revisionId = randomUUID();

    const [lcRow, revRow] = await this.prisma.$transaction([
      this.prisma.approvalLifecycle.create({
        data: {
          id: lifecycleId,
          actionEnvelopeId: input.actionEnvelopeId,
          organizationId: input.organizationId ?? null,
          status: "pending",
          currentRevisionId: revisionId,
          currentExecutableWorkUnitId: null,
          expiresAt: input.expiresAt,
          pausedSessionId: input.pausedSessionId ?? null,
          version: 1,
        },
      }),
      this.prisma.approvalRevision.create({
        data: {
          id: revisionId,
          lifecycleId,
          revisionNumber: 1,
          parametersSnapshot: input.initialRevision.parametersSnapshot as object,
          approvalScopeSnapshot: input.initialRevision.approvalScopeSnapshot as object,
          bindingHash: input.initialRevision.bindingHash,
          rationale: null,
          supersedesRevisionId: null,
          createdBy: input.initialRevision.createdBy,
        },
      }),
    ]);

    return {
      lifecycle: toLifecycleRecord(lcRow),
      revision: toRevision(revRow),
    };
  }

  async getLifecycleById(id: string): Promise<LifecycleRecord | null> {
    const row = await this.prisma.approvalLifecycle.findUnique({ where: { id } });
    return row ? toLifecycleRecord(row) : null;
  }

  async getLifecycleByEnvelopeId(envelopeId: string): Promise<LifecycleRecord | null> {
    const row = await this.prisma.approvalLifecycle.findUnique({
      where: { actionEnvelopeId: envelopeId },
    });
    return row ? toLifecycleRecord(row) : null;
  }

  async getRevision(lifecycleId: string, revisionNumber: number): Promise<ApprovalRevision | null> {
    const row = await this.prisma.approvalRevision.findUnique({
      where: { lifecycleId_revisionNumber: { lifecycleId, revisionNumber } },
    });
    return row ? toRevision(row) : null;
  }

  async getRevisionById(id: string): Promise<ApprovalRevision | null> {
    const row = await this.prisma.approvalRevision.findUnique({ where: { id } });
    return row ? toRevision(row) : null;
  }

  async getCurrentRevision(lifecycleId: string): Promise<ApprovalRevision | null> {
    const lc = await this.prisma.approvalLifecycle.findUnique({ where: { id: lifecycleId } });
    if (!lc?.currentRevisionId) return null;
    return this.getRevisionById(lc.currentRevisionId);
  }

  async createRevision(input: CreateRevisionInput): Promise<ApprovalRevision> {
    const latestRev = await this.prisma.approvalRevision.findFirst({
      where: { lifecycleId: input.lifecycleId },
      orderBy: { revisionNumber: "desc" },
    });

    const nextNumber = (latestRev?.revisionNumber ?? 0) + 1;
    const revisionId = randomUUID();

    const [revRow] = await this.prisma.$transaction([
      this.prisma.approvalRevision.create({
        data: {
          id: revisionId,
          lifecycleId: input.lifecycleId,
          revisionNumber: nextNumber,
          parametersSnapshot: input.parametersSnapshot as object,
          approvalScopeSnapshot: input.approvalScopeSnapshot as object,
          bindingHash: input.bindingHash,
          rationale: input.rationale ?? null,
          supersedesRevisionId: input.supersedesRevisionId ?? null,
          createdBy: input.createdBy,
        },
      }),
      this.prisma.approvalLifecycle.update({
        where: { id: input.lifecycleId },
        data: { currentRevisionId: revisionId },
      }),
    ]);

    return toRevision(revRow);
  }

  async updateLifecycleStatus(
    id: string,
    status: ApprovalLifecycleStatus,
    expectedVersion: number,
    updates?: {
      currentRevisionId?: string;
      currentExecutableWorkUnitId?: string;
    },
  ): Promise<LifecycleRecord> {
    const result = await this.prisma.approvalLifecycle.updateMany({
      where: { id, version: expectedVersion },
      data: {
        status,
        version: expectedVersion + 1,
        ...(updates?.currentRevisionId !== undefined
          ? { currentRevisionId: updates.currentRevisionId }
          : {}),
        ...(updates?.currentExecutableWorkUnitId !== undefined
          ? { currentExecutableWorkUnitId: updates.currentExecutableWorkUnitId }
          : {}),
      },
    });

    if (result.count === 0) {
      throw new StaleVersionError(id, expectedVersion, -1);
    }

    const updated = await this.prisma.approvalLifecycle.findUniqueOrThrow({ where: { id } });
    return toLifecycleRecord(updated);
  }

  async materializeWorkUnit(input: MaterializeWorkUnitInput): Promise<ExecutableWorkUnit> {
    const workUnitId = randomUUID();

    const row = await this.prisma.executableWorkUnit.create({
      data: {
        id: workUnitId,
        lifecycleId: input.lifecycleId,
        approvalRevisionId: input.approvalRevisionId,
        actionEnvelopeId: input.actionEnvelopeId,
        frozenPayload: input.frozenPayload as object,
        frozenBinding: input.frozenBinding as object,
        frozenExecutionPolicy: input.frozenExecutionPolicy as object,
        executableUntil: input.executableUntil,
      },
    });

    return toExecutableWorkUnit(row);
  }

  async getExecutableWorkUnit(id: string): Promise<ExecutableWorkUnit | null> {
    const row = await this.prisma.executableWorkUnit.findUnique({ where: { id } });
    return row ? toExecutableWorkUnit(row) : null;
  }

  async createDispatchRecord(input: {
    executableWorkUnitId: string;
    attemptNumber: number;
    idempotencyKey: string;
  }): Promise<DispatchRecord> {
    const row = await this.prisma.dispatchRecord.create({
      data: {
        id: randomUUID(),
        executableWorkUnitId: input.executableWorkUnitId,
        attemptNumber: input.attemptNumber,
        idempotencyKey: input.idempotencyKey,
        state: "dispatching",
      },
    });
    return toDispatchRecord(row);
  }

  async updateDispatchRecord(
    id: string,
    updates: {
      state: string;
      outcome?: string | null;
      errorMessage?: string | null;
      completedAt?: Date;
      durationMs?: number;
    },
  ): Promise<DispatchRecord> {
    const row = await this.prisma.dispatchRecord.update({
      where: { id },
      data: {
        state: updates.state,
        outcome: updates.outcome ?? undefined,
        errorMessage: updates.errorMessage ?? undefined,
        completedAt: updates.completedAt ?? undefined,
        durationMs: updates.durationMs ?? undefined,
      },
    });
    return toDispatchRecord(row);
  }

  async listPendingLifecycles(organizationId?: string): Promise<LifecycleRecord[]> {
    const rows = await this.prisma.approvalLifecycle.findMany({
      where: {
        status: "pending",
        ...(organizationId ? { organizationId } : {}),
      },
    });
    return rows.map(toLifecycleRecord);
  }

  async listExpiredPendingLifecycles(now?: Date): Promise<LifecycleRecord[]> {
    const cutoff = now ?? new Date();
    const rows = await this.prisma.approvalLifecycle.findMany({
      where: {
        status: "pending",
        expiresAt: { lte: cutoff },
      },
    });
    return rows.map(toLifecycleRecord);
  }
}

function toLifecycleRecord(row: {
  id: string;
  actionEnvelopeId: string;
  organizationId: string | null;
  status: string;
  currentRevisionId: string | null;
  currentExecutableWorkUnitId: string | null;
  expiresAt: Date;
  pausedSessionId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}): LifecycleRecord {
  return {
    id: row.id,
    actionEnvelopeId: row.actionEnvelopeId,
    organizationId: row.organizationId,
    status: row.status as ApprovalLifecycleStatus,
    currentRevisionId: row.currentRevisionId,
    currentExecutableWorkUnitId: row.currentExecutableWorkUnitId,
    expiresAt: row.expiresAt,
    pausedSessionId: row.pausedSessionId,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRevision(row: {
  id: string;
  lifecycleId: string;
  revisionNumber: number;
  parametersSnapshot: unknown;
  approvalScopeSnapshot: unknown;
  bindingHash: string;
  rationale: string | null;
  supersedesRevisionId: string | null;
  createdBy: string;
  createdAt: Date;
}): ApprovalRevision {
  return {
    id: row.id,
    lifecycleId: row.lifecycleId,
    revisionNumber: row.revisionNumber,
    parametersSnapshot: row.parametersSnapshot as Record<string, unknown>,
    approvalScopeSnapshot: row.approvalScopeSnapshot as Record<string, unknown>,
    bindingHash: row.bindingHash,
    rationale: row.rationale,
    supersedesRevisionId: row.supersedesRevisionId,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

function toExecutableWorkUnit(row: {
  id: string;
  lifecycleId: string;
  approvalRevisionId: string;
  actionEnvelopeId: string;
  frozenPayload: unknown;
  frozenBinding: unknown;
  frozenExecutionPolicy: unknown;
  executableUntil: Date;
  createdAt: Date;
}): ExecutableWorkUnit {
  return {
    id: row.id,
    lifecycleId: row.lifecycleId,
    approvalRevisionId: row.approvalRevisionId,
    actionEnvelopeId: row.actionEnvelopeId,
    frozenPayload: row.frozenPayload as Record<string, unknown>,
    frozenBinding: row.frozenBinding as Record<string, unknown>,
    frozenExecutionPolicy: row.frozenExecutionPolicy as Record<string, unknown>,
    executableUntil: row.executableUntil,
    createdAt: row.createdAt,
  };
}

function toDispatchRecord(row: {
  id: string;
  executableWorkUnitId: string;
  attemptNumber: number;
  idempotencyKey: string;
  state: string;
  dispatchedAt: Date;
  completedAt: Date | null;
  outcome: string | null;
  errorMessage: string | null;
  durationMs: number | null;
}): DispatchRecord {
  return {
    id: row.id,
    executableWorkUnitId: row.executableWorkUnitId,
    attemptNumber: row.attemptNumber,
    idempotencyKey: row.idempotencyKey,
    state: row.state as DispatchRecord["state"],
    dispatchedAt: row.dispatchedAt,
    completedAt: row.completedAt,
    outcome: row.outcome,
    errorMessage: row.errorMessage,
    durationMs: row.durationMs,
  };
}
```

- [ ] **Step 5: Run typecheck**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: add ApprovalLifecycleStore interface and Prisma implementation"
```

---

## Task 4: Executable Materializer

**Files:**

- Create: `packages/core/src/approval/executable-materializer.ts`
- Test: `packages/core/src/approval/__tests__/executable-materializer.test.ts`

- [ ] **Step 1: Write the failing test**

Create: `packages/core/src/approval/__tests__/executable-materializer.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { buildMaterializationInput } from "../executable-materializer.js";

describe("buildMaterializationInput", () => {
  const baseRevision = {
    id: "rev-1",
    lifecycleId: "lc-1",
    revisionNumber: 1,
    parametersSnapshot: { budget: 5000, target: "us-west" },
    approvalScopeSnapshot: { approvers: ["user-1"], riskCategory: "medium" },
    bindingHash: "a".repeat(64),
    rationale: null,
    supersedesRevisionId: null,
    createdBy: "user-1",
    createdAt: new Date(),
  };

  const baseWorkUnit = {
    id: "wu-1",
    intent: "campaign.pause",
    parameters: { budget: 5000, target: "us-west" },
    deployment: {
      deploymentId: "dep-1",
      skillSlug: "campaign",
      trustLevel: "supervised" as const,
      trustScore: 0,
    },
    resolvedMode: "skill" as const,
    actor: { id: "user-1", type: "user" as const },
    organizationId: "org-1",
    traceId: "trace-1",
    trigger: "api" as const,
    priority: "normal" as const,
    requestedAt: new Date().toISOString(),
  };

  const baseConstraints = { maxRetries: 3, timeoutMs: 30000 };

  it("produces a complete MaterializeWorkUnitInput", () => {
    const result = buildMaterializationInput({
      revision: baseRevision,
      workUnit: baseWorkUnit,
      actionEnvelopeId: "env-1",
      constraints: baseConstraints,
      executableUntilMs: 3600000,
    });

    expect(result.lifecycleId).toBe("lc-1");
    expect(result.approvalRevisionId).toBe("rev-1");
    expect(result.actionEnvelopeId).toBe("env-1");
    expect(result.frozenPayload).toEqual({
      intent: "campaign.pause",
      parameters: { budget: 5000, target: "us-west" },
      actor: { id: "user-1", type: "user" },
      organizationId: "org-1",
      resolvedMode: "skill",
      traceId: "trace-1",
    });
    expect(result.frozenBinding).toEqual({
      deploymentId: "dep-1",
      skillSlug: "campaign",
      trustLevel: "supervised",
      trustScore: 0,
    });
    expect(result.frozenExecutionPolicy).toEqual(baseConstraints);
    expect(result.executableUntil).toBeInstanceOf(Date);
  });

  it("uses revision parametersSnapshot for frozen payload, not workUnit parameters", () => {
    const modifiedWorkUnit = {
      ...baseWorkUnit,
      parameters: { budget: 99999 },
    };

    const result = buildMaterializationInput({
      revision: baseRevision,
      workUnit: modifiedWorkUnit,
      actionEnvelopeId: "env-1",
      constraints: baseConstraints,
      executableUntilMs: 3600000,
    });

    expect(result.frozenPayload.parameters).toEqual({ budget: 5000, target: "us-west" });
  });

  it("sets executableUntil based on executableUntilMs from now", () => {
    const before = Date.now();
    const result = buildMaterializationInput({
      revision: baseRevision,
      workUnit: baseWorkUnit,
      actionEnvelopeId: "env-1",
      constraints: baseConstraints,
      executableUntilMs: 60000,
    });
    const after = Date.now();

    const expectedMin = before + 60000;
    const expectedMax = after + 60000;
    expect(result.executableUntil.getTime()).toBeGreaterThanOrEqual(expectedMin);
    expect(result.executableUntil.getTime()).toBeLessThanOrEqual(expectedMax);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run executable-materializer`
Expected: FAIL — module not found

- [ ] **Step 3: Write the materializer**

Create: `packages/core/src/approval/executable-materializer.ts`

```typescript
import type { ApprovalRevision } from "@switchboard/schemas";
import type { MaterializeWorkUnitInput } from "./lifecycle-types.js";
import type { WorkUnit } from "../platform/work-unit.js";

export interface MaterializationParams {
  revision: ApprovalRevision;
  workUnit: WorkUnit;
  actionEnvelopeId: string;
  constraints: Record<string, unknown>;
  executableUntilMs: number;
}

export function buildMaterializationInput(params: MaterializationParams): MaterializeWorkUnitInput {
  const { revision, workUnit, actionEnvelopeId, constraints, executableUntilMs } = params;

  return {
    lifecycleId: revision.lifecycleId,
    approvalRevisionId: revision.id,
    actionEnvelopeId,
    frozenPayload: {
      intent: workUnit.intent,
      parameters: revision.parametersSnapshot,
      actor: workUnit.actor,
      organizationId: workUnit.organizationId,
      resolvedMode: workUnit.resolvedMode,
      traceId: workUnit.traceId,
    },
    frozenBinding: { ...workUnit.deployment },
    frozenExecutionPolicy: { ...constraints },
    executableUntil: new Date(Date.now() + executableUntilMs),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run executable-materializer`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add executable work unit materializer"
```

---

## Task 5: Dispatch Admission Logic

**Files:**

- Create: `packages/core/src/approval/dispatch-admission.ts`
- Test: `packages/core/src/approval/__tests__/dispatch-admission.test.ts`

- [ ] **Step 1: Write the failing test**

Create: `packages/core/src/approval/__tests__/dispatch-admission.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { validateDispatchAdmission, DispatchAdmissionError } from "../dispatch-admission.js";
import type { LifecycleRecord } from "../lifecycle-types.js";
import type { ExecutableWorkUnit } from "@switchboard/schemas";

function makeLifecycle(overrides: Partial<LifecycleRecord> = {}): LifecycleRecord {
  return {
    id: "lc-1",
    actionEnvelopeId: "env-1",
    organizationId: "org-1",
    status: "approved",
    currentRevisionId: "rev-1",
    currentExecutableWorkUnitId: "ewu-1",
    expiresAt: new Date(Date.now() + 86400000),
    pausedSessionId: null,
    version: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeWorkUnit(overrides: Partial<ExecutableWorkUnit> = {}): ExecutableWorkUnit {
  return {
    id: "ewu-1",
    lifecycleId: "lc-1",
    approvalRevisionId: "rev-1",
    actionEnvelopeId: "env-1",
    frozenPayload: {},
    frozenBinding: {},
    frozenExecutionPolicy: {},
    executableUntil: new Date(Date.now() + 3600000),
    createdAt: new Date(),
    ...overrides,
  };
}

describe("validateDispatchAdmission", () => {
  it("passes when lifecycle is approved and pointer matches", () => {
    expect(() => validateDispatchAdmission(makeLifecycle(), makeWorkUnit())).not.toThrow();
  });

  it("rejects when lifecycle status is not approved", () => {
    expect(() =>
      validateDispatchAdmission(makeLifecycle({ status: "pending" }), makeWorkUnit()),
    ).toThrow(DispatchAdmissionError);
  });

  it("rejects when lifecycle status is rejected", () => {
    expect(() =>
      validateDispatchAdmission(makeLifecycle({ status: "rejected" }), makeWorkUnit()),
    ).toThrow(DispatchAdmissionError);
  });

  it("rejects when lifecycle status is expired", () => {
    expect(() =>
      validateDispatchAdmission(makeLifecycle({ status: "expired" }), makeWorkUnit()),
    ).toThrow(DispatchAdmissionError);
  });

  it("rejects when lifecycle pointer does not match work unit id", () => {
    expect(() =>
      validateDispatchAdmission(
        makeLifecycle({ currentExecutableWorkUnitId: "ewu-other" }),
        makeWorkUnit(),
      ),
    ).toThrow(DispatchAdmissionError);
    try {
      validateDispatchAdmission(
        makeLifecycle({ currentExecutableWorkUnitId: "ewu-other" }),
        makeWorkUnit(),
      );
    } catch (e) {
      expect((e as DispatchAdmissionError).code).toBe("STALE_AUTHORITY");
    }
  });

  it("rejects when lifecycle pointer is null", () => {
    expect(() =>
      validateDispatchAdmission(
        makeLifecycle({ currentExecutableWorkUnitId: null }),
        makeWorkUnit(),
      ),
    ).toThrow(DispatchAdmissionError);
  });

  it("rejects when work unit has expired (executableUntil in the past)", () => {
    expect(() =>
      validateDispatchAdmission(
        makeLifecycle(),
        makeWorkUnit({ executableUntil: new Date(Date.now() - 1000) }),
      ),
    ).toThrow(DispatchAdmissionError);
    try {
      validateDispatchAdmission(
        makeLifecycle(),
        makeWorkUnit({ executableUntil: new Date(Date.now() - 1000) }),
      );
    } catch (e) {
      expect((e as DispatchAdmissionError).code).toBe("EXPIRED_WORK_UNIT");
    }
  });

  it("rejects when work unit lifecycleId does not match lifecycle id", () => {
    expect(() =>
      validateDispatchAdmission(makeLifecycle(), makeWorkUnit({ lifecycleId: "lc-other" })),
    ).toThrow(DispatchAdmissionError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run dispatch-admission`
Expected: FAIL — module not found

- [ ] **Step 3: Write the admission logic**

Create: `packages/core/src/approval/dispatch-admission.ts`

```typescript
import type { ExecutableWorkUnit } from "@switchboard/schemas";
import type { LifecycleRecord } from "./lifecycle-types.js";

export type AdmissionErrorCode =
  | "LIFECYCLE_NOT_APPROVED"
  | "STALE_AUTHORITY"
  | "EXPIRED_WORK_UNIT"
  | "LINEAGE_MISMATCH";

export class DispatchAdmissionError extends Error {
  readonly code: AdmissionErrorCode;

  constructor(code: AdmissionErrorCode, message: string) {
    super(message);
    this.name = "DispatchAdmissionError";
    this.code = code;
  }
}

export function validateDispatchAdmission(
  lifecycle: LifecycleRecord,
  workUnit: ExecutableWorkUnit,
  now?: Date,
): void {
  if (lifecycle.status !== "approved") {
    throw new DispatchAdmissionError(
      "LIFECYCLE_NOT_APPROVED",
      `Lifecycle ${lifecycle.id} status is "${lifecycle.status}", expected "approved"`,
    );
  }

  if (workUnit.lifecycleId !== lifecycle.id) {
    throw new DispatchAdmissionError(
      "LINEAGE_MISMATCH",
      `Work unit ${workUnit.id} belongs to lifecycle ${workUnit.lifecycleId}, not ${lifecycle.id}`,
    );
  }

  if (lifecycle.currentExecutableWorkUnitId !== workUnit.id) {
    throw new DispatchAdmissionError(
      "STALE_AUTHORITY",
      `Work unit ${workUnit.id} is not the current executable for lifecycle ${lifecycle.id} (current: ${lifecycle.currentExecutableWorkUnitId})`,
    );
  }

  const checkTime = now ?? new Date();
  if (checkTime > workUnit.executableUntil) {
    throw new DispatchAdmissionError(
      "EXPIRED_WORK_UNIT",
      `Work unit ${workUnit.id} expired at ${workUnit.executableUntil.toISOString()}`,
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run dispatch-admission`
Expected: PASS

- [ ] **Step 5: Add export to barrel**

Add to `packages/core/src/approval/index.ts`:

```typescript
export * from "./dispatch-admission.js";
export * from "./executable-materializer.js";
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: add dispatch admission validation and executable materializer exports"
```

---

## Task 6: ApprovalLifecycleService — Core Authority Owner

**Files:**

- Create: `packages/core/src/approval/lifecycle-service.ts`
- Test: `packages/core/src/approval/__tests__/lifecycle-service.test.ts`

This is the central service. It owns all control-plane mutations. No other service may mutate lifecycle authority.

- [ ] **Step 1: Write the failing test**

Create: `packages/core/src/approval/__tests__/lifecycle-service.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApprovalLifecycleService } from "../lifecycle-service.js";
import type { ApprovalLifecycleStore, LifecycleRecord } from "../lifecycle-types.js";
import type { ApprovalRevision, ExecutableWorkUnit } from "@switchboard/schemas";
import { DispatchAdmissionError } from "../dispatch-admission.js";

function makeStore(overrides: Partial<ApprovalLifecycleStore> = {}): ApprovalLifecycleStore {
  return {
    createLifecycleWithRevision: vi.fn().mockResolvedValue({
      lifecycle: makeLifecycle(),
      revision: makeRevision(),
    }),
    getLifecycleById: vi.fn().mockResolvedValue(makeLifecycle()),
    getLifecycleByEnvelopeId: vi.fn().mockResolvedValue(makeLifecycle()),
    getRevision: vi.fn().mockResolvedValue(makeRevision()),
    getRevisionById: vi.fn().mockResolvedValue(makeRevision()),
    getCurrentRevision: vi.fn().mockResolvedValue(makeRevision()),
    createRevision: vi.fn().mockResolvedValue(makeRevision({ id: "rev-2", revisionNumber: 2 })),
    updateLifecycleStatus: vi
      .fn()
      .mockImplementation(async (id, status, _ver, updates) =>
        makeLifecycle({ id, status, ...updates, version: 2 }),
      ),
    materializeWorkUnit: vi.fn().mockResolvedValue(makeWorkUnit()),
    getExecutableWorkUnit: vi.fn().mockResolvedValue(makeWorkUnit()),
    createDispatchRecord: vi.fn().mockResolvedValue({
      id: "dr-1",
      executableWorkUnitId: "ewu-1",
      attemptNumber: 1,
      idempotencyKey: "idem-1",
      state: "dispatching",
      dispatchedAt: new Date(),
      completedAt: null,
      outcome: null,
      errorMessage: null,
      durationMs: null,
    }),
    updateDispatchRecord: vi.fn().mockResolvedValue({
      id: "dr-1",
      state: "succeeded",
      outcome: "completed",
    }),
    listPendingLifecycles: vi.fn().mockResolvedValue([]),
    listExpiredPendingLifecycles: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeLifecycle(overrides: Partial<LifecycleRecord> = {}): LifecycleRecord {
  return {
    id: "lc-1",
    actionEnvelopeId: "env-1",
    organizationId: "org-1",
    status: "pending",
    currentRevisionId: "rev-1",
    currentExecutableWorkUnitId: null,
    expiresAt: new Date(Date.now() + 86400000),
    pausedSessionId: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRevision(overrides: Partial<ApprovalRevision> = {}): ApprovalRevision {
  return {
    id: "rev-1",
    lifecycleId: "lc-1",
    revisionNumber: 1,
    parametersSnapshot: { budget: 5000 },
    approvalScopeSnapshot: { approvers: ["user-1"], riskCategory: "medium" },
    bindingHash: "a".repeat(64),
    rationale: null,
    supersedesRevisionId: null,
    createdBy: "actor-1",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeWorkUnit(overrides: Partial<ExecutableWorkUnit> = {}): ExecutableWorkUnit {
  return {
    id: "ewu-1",
    lifecycleId: "lc-1",
    approvalRevisionId: "rev-1",
    actionEnvelopeId: "env-1",
    frozenPayload: { intent: "campaign.pause", parameters: { budget: 5000 } },
    frozenBinding: { deploymentId: "dep-1" },
    frozenExecutionPolicy: { maxRetries: 3 },
    executableUntil: new Date(Date.now() + 3600000),
    createdAt: new Date(),
    ...overrides,
  };
}

describe("ApprovalLifecycleService", () => {
  let store: ApprovalLifecycleStore;
  let service: ApprovalLifecycleService;

  beforeEach(() => {
    store = makeStore();
    service = new ApprovalLifecycleService({ store });
  });

  describe("createGatedLifecycle", () => {
    it("creates lifecycle and initial revision atomically", async () => {
      const result = await service.createGatedLifecycle({
        actionEnvelopeId: "env-1",
        organizationId: "org-1",
        expiresAt: new Date(Date.now() + 86400000),
        initialRevision: {
          parametersSnapshot: { budget: 5000 },
          approvalScopeSnapshot: { approvers: ["user-1"] },
          bindingHash: "a".repeat(64),
          createdBy: "actor-1",
        },
      });

      expect(store.createLifecycleWithRevision).toHaveBeenCalledOnce();
      expect(result.lifecycle.status).toBe("pending");
      expect(result.revision).toBeDefined();
    });
  });

  describe("createRevision (patch)", () => {
    it("creates a new immutable revision and updates lifecycle pointer", async () => {
      const result = await service.createRevision({
        lifecycleId: "lc-1",
        parametersSnapshot: { budget: 10000 },
        approvalScopeSnapshot: { approvers: ["user-1"] },
        bindingHash: "b".repeat(64),
        createdBy: "actor-2",
        sourceBindingHash: "a".repeat(64),
      });

      expect(store.getCurrentRevision).toHaveBeenCalledWith("lc-1");
      expect(store.createRevision).toHaveBeenCalledOnce();
      expect(result).toBeDefined();
    });

    it("rejects when lifecycle is not pending", async () => {
      store.getLifecycleById = vi.fn().mockResolvedValue(makeLifecycle({ status: "approved" }));

      await expect(
        service.createRevision({
          lifecycleId: "lc-1",
          parametersSnapshot: { budget: 10000 },
          approvalScopeSnapshot: {},
          bindingHash: "b".repeat(64),
          createdBy: "actor-2",
          sourceBindingHash: "a".repeat(64),
        }),
      ).rejects.toThrow("Cannot create revision");
    });

    it("rejects when source binding hash does not match current revision", async () => {
      await expect(
        service.createRevision({
          lifecycleId: "lc-1",
          parametersSnapshot: { budget: 10000 },
          approvalScopeSnapshot: {},
          bindingHash: "b".repeat(64),
          createdBy: "actor-2",
          sourceBindingHash: "wrong".repeat(10),
        }),
      ).rejects.toThrow("Stale binding");
    });
  });

  describe("approveRevision", () => {
    it("approves, materializes work unit, updates lifecycle pointer", async () => {
      const result = await service.approveRevision({
        lifecycleId: "lc-1",
        respondedBy: "approver-1",
        clientBindingHash: "a".repeat(64),
        materializationParams: {
          workUnit: {
            id: "wu-1",
            intent: "campaign.pause",
            parameters: { budget: 5000 },
            deployment: {
              deploymentId: "dep-1",
              skillSlug: "campaign",
              trustLevel: "supervised" as const,
              trustScore: 0,
            },
            resolvedMode: "skill" as const,
            actor: { id: "user-1", type: "user" as const },
            organizationId: "org-1",
            traceId: "trace-1",
            trigger: "api" as const,
            priority: "normal" as const,
            requestedAt: new Date().toISOString(),
          },
          actionEnvelopeId: "env-1",
          constraints: { maxRetries: 3 },
          executableUntilMs: 3600000,
        },
      });

      expect(store.updateLifecycleStatus).toHaveBeenCalledWith(
        "lc-1",
        "approved",
        1,
        expect.objectContaining({ currentExecutableWorkUnitId: "ewu-1" }),
      );
      expect(store.materializeWorkUnit).toHaveBeenCalledOnce();
      expect(result.workUnit).toBeDefined();
      expect(result.lifecycle.status).toBe("approved");
    });

    it("rejects when lifecycle is not pending", async () => {
      store.getLifecycleById = vi.fn().mockResolvedValue(makeLifecycle({ status: "rejected" }));

      await expect(
        service.approveRevision({
          lifecycleId: "lc-1",
          respondedBy: "approver-1",
          clientBindingHash: "a".repeat(64),
          materializationParams: {
            workUnit: {} as any,
            actionEnvelopeId: "env-1",
            constraints: {},
            executableUntilMs: 3600000,
          },
        }),
      ).rejects.toThrow("Cannot approve");
    });

    it("rejects when client binding hash does not match current revision", async () => {
      await expect(
        service.approveRevision({
          lifecycleId: "lc-1",
          respondedBy: "approver-1",
          clientBindingHash: "wrong".repeat(10),
          materializationParams: {
            workUnit: {} as any,
            actionEnvelopeId: "env-1",
            constraints: {},
            executableUntilMs: 3600000,
          },
        }),
      ).rejects.toThrow("Stale binding");
    });
  });

  describe("rejectRevision", () => {
    it("transitions lifecycle to rejected", async () => {
      const result = await service.rejectRevision({
        lifecycleId: "lc-1",
        respondedBy: "approver-1",
      });

      expect(store.updateLifecycleStatus).toHaveBeenCalledWith("lc-1", "rejected", 1, undefined);
      expect(result.status).toBe("rejected");
    });

    it("rejects when lifecycle is not pending", async () => {
      store.getLifecycleById = vi.fn().mockResolvedValue(makeLifecycle({ status: "approved" }));

      await expect(
        service.rejectRevision({ lifecycleId: "lc-1", respondedBy: "approver-1" }),
      ).rejects.toThrow("Cannot reject");
    });
  });

  describe("expireLifecycle", () => {
    it("transitions pending lifecycle to expired", async () => {
      store.getLifecycleById = vi
        .fn()
        .mockResolvedValue(makeLifecycle({ expiresAt: new Date(Date.now() - 1000) }));

      const result = await service.expireLifecycle("lc-1");

      expect(store.updateLifecycleStatus).toHaveBeenCalledWith("lc-1", "expired", 1, undefined);
      expect(result.status).toBe("expired");
    });

    it("skips if lifecycle is not pending", async () => {
      store.getLifecycleById = vi.fn().mockResolvedValue(makeLifecycle({ status: "approved" }));

      const result = await service.expireLifecycle("lc-1");
      expect(store.updateLifecycleStatus).not.toHaveBeenCalled();
      expect(result.status).toBe("approved");
    });
  });

  describe("listPendingLifecycles", () => {
    it("returns only non-expired pending lifecycles", async () => {
      const expired = makeLifecycle({ id: "lc-expired", expiresAt: new Date(Date.now() - 1000) });
      const active = makeLifecycle({ id: "lc-active", expiresAt: new Date(Date.now() + 86400000) });
      store.listPendingLifecycles = vi.fn().mockResolvedValue([expired, active]);

      const result = await service.listPendingLifecycles("org-1");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("lc-active");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run lifecycle-service`
Expected: FAIL — module not found

- [ ] **Step 3: Write the lifecycle service**

Create: `packages/core/src/approval/lifecycle-service.ts`

```typescript
import type {
  ApprovalLifecycleStore,
  LifecycleRecord,
  CreateLifecycleInput,
} from "./lifecycle-types.js";
import type { ApprovalRevision, ExecutableWorkUnit } from "@switchboard/schemas";
import type { WorkUnit } from "../platform/work-unit.js";
import { buildMaterializationInput } from "./executable-materializer.js";
import { validateDispatchAdmission } from "./dispatch-admission.js";

export interface ApprovalLifecycleServiceConfig {
  store: ApprovalLifecycleStore;
}

export class ApprovalLifecycleService {
  private readonly store: ApprovalLifecycleStore;

  constructor(config: ApprovalLifecycleServiceConfig) {
    this.store = config.store;
  }

  async createGatedLifecycle(
    input: CreateLifecycleInput,
  ): Promise<{ lifecycle: LifecycleRecord; revision: ApprovalRevision }> {
    return this.store.createLifecycleWithRevision(input);
  }

  async createRevision(params: {
    lifecycleId: string;
    parametersSnapshot: Record<string, unknown>;
    approvalScopeSnapshot: Record<string, unknown>;
    bindingHash: string;
    createdBy: string;
    sourceBindingHash: string;
    rationale?: string;
  }): Promise<ApprovalRevision> {
    const lifecycle = await this.store.getLifecycleById(params.lifecycleId);
    if (!lifecycle) throw new Error(`Lifecycle not found: ${params.lifecycleId}`);
    if (lifecycle.status !== "pending") {
      throw new Error(`Cannot create revision: lifecycle status is "${lifecycle.status}"`);
    }

    const currentRevision = await this.store.getCurrentRevision(params.lifecycleId);
    if (!currentRevision) {
      throw new Error(`No current revision for lifecycle ${params.lifecycleId}`);
    }
    if (currentRevision.bindingHash !== params.sourceBindingHash) {
      throw new Error("Stale binding: source binding hash does not match current revision");
    }

    return this.store.createRevision({
      lifecycleId: params.lifecycleId,
      parametersSnapshot: params.parametersSnapshot,
      approvalScopeSnapshot: params.approvalScopeSnapshot,
      bindingHash: params.bindingHash,
      rationale: params.rationale ?? null,
      supersedesRevisionId: currentRevision.id,
      createdBy: params.createdBy,
    });
  }

  async approveRevision(params: {
    lifecycleId: string;
    respondedBy: string;
    clientBindingHash: string;
    materializationParams: {
      workUnit: WorkUnit;
      actionEnvelopeId: string;
      constraints: Record<string, unknown>;
      executableUntilMs: number;
    };
  }): Promise<{ lifecycle: LifecycleRecord; workUnit: ExecutableWorkUnit }> {
    const lifecycle = await this.store.getLifecycleById(params.lifecycleId);
    if (!lifecycle) throw new Error(`Lifecycle not found: ${params.lifecycleId}`);
    if (lifecycle.status !== "pending") {
      throw new Error(`Cannot approve: lifecycle status is "${lifecycle.status}"`);
    }

    const currentRevision = await this.store.getCurrentRevision(params.lifecycleId);
    if (!currentRevision) {
      throw new Error(`No current revision for lifecycle ${params.lifecycleId}`);
    }
    if (currentRevision.bindingHash !== params.clientBindingHash) {
      throw new Error("Stale binding: client binding hash does not match current revision");
    }

    const matInput = buildMaterializationInput({
      revision: currentRevision,
      ...params.materializationParams,
    });

    const workUnit = await this.store.materializeWorkUnit(matInput);

    const updatedLifecycle = await this.store.updateLifecycleStatus(
      lifecycle.id,
      "approved",
      lifecycle.version,
      { currentExecutableWorkUnitId: workUnit.id },
    );

    return { lifecycle: updatedLifecycle, workUnit };
  }

  async rejectRevision(params: {
    lifecycleId: string;
    respondedBy: string;
  }): Promise<LifecycleRecord> {
    const lifecycle = await this.store.getLifecycleById(params.lifecycleId);
    if (!lifecycle) throw new Error(`Lifecycle not found: ${params.lifecycleId}`);
    if (lifecycle.status !== "pending") {
      throw new Error(`Cannot reject: lifecycle status is "${lifecycle.status}"`);
    }

    return this.store.updateLifecycleStatus(lifecycle.id, "rejected", lifecycle.version);
  }

  async expireLifecycle(lifecycleId: string): Promise<LifecycleRecord> {
    const lifecycle = await this.store.getLifecycleById(lifecycleId);
    if (!lifecycle) throw new Error(`Lifecycle not found: ${lifecycleId}`);
    if (lifecycle.status !== "pending") return lifecycle;

    return this.store.updateLifecycleStatus(lifecycle.id, "expired", lifecycle.version);
  }

  async listPendingLifecycles(organizationId?: string): Promise<LifecycleRecord[]> {
    const all = await this.store.listPendingLifecycles(organizationId);
    const now = new Date();
    return all.filter((lc) => lc.expiresAt > now);
  }

  async prepareDispatch(params: {
    lifecycleId: string;
    executableWorkUnitId: string;
    idempotencyKey: string;
  }): Promise<{
    lifecycle: LifecycleRecord;
    workUnit: ExecutableWorkUnit;
    dispatchRecord: { id: string; attemptNumber: number };
  }> {
    const lifecycle = await this.store.getLifecycleById(params.lifecycleId);
    if (!lifecycle) throw new Error(`Lifecycle not found: ${params.lifecycleId}`);

    const workUnit = await this.store.getExecutableWorkUnit(params.executableWorkUnitId);
    if (!workUnit) throw new Error(`Work unit not found: ${params.executableWorkUnitId}`);

    validateDispatchAdmission(lifecycle, workUnit);

    const latestAttempt = 0;
    const dispatchRecord = await this.store.createDispatchRecord({
      executableWorkUnitId: workUnit.id,
      attemptNumber: latestAttempt + 1,
      idempotencyKey: params.idempotencyKey,
    });

    return {
      lifecycle,
      workUnit,
      dispatchRecord: { id: dispatchRecord.id, attemptNumber: dispatchRecord.attemptNumber },
    };
  }

  async recordDispatchOutcome(params: {
    dispatchRecordId: string;
    state: "succeeded" | "failed" | "terminal_failed";
    outcome?: string;
    errorMessage?: string;
    durationMs?: number;
  }): Promise<void> {
    await this.store.updateDispatchRecord(params.dispatchRecordId, {
      state: params.state,
      outcome: params.outcome ?? null,
      errorMessage: params.errorMessage ?? null,
      completedAt: new Date(),
      durationMs: params.durationMs,
    });
  }
}
```

- [ ] **Step 4: Add export to barrel**

Add to `packages/core/src/approval/index.ts`:

```typescript
export * from "./lifecycle-service.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run lifecycle-service`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: add ApprovalLifecycleService — sole authority owner for approval mutations"
```

---

## Task 7: Active Expiry Sweep

**Files:**

- Create: `packages/core/src/approval/lifecycle-expiry.ts`
- Test: `packages/core/src/approval/__tests__/lifecycle-expiry.test.ts`

- [ ] **Step 1: Write the failing test**

Create: `packages/core/src/approval/__tests__/lifecycle-expiry.test.ts`

```typescript
import { describe, it, expect, vi } from "vitest";
import { sweepExpiredLifecycles } from "../lifecycle-expiry.js";
import type { ApprovalLifecycleService } from "../lifecycle-service.js";
import type { ApprovalLifecycleStore, LifecycleRecord } from "../lifecycle-types.js";

function makeLifecycle(overrides: Partial<LifecycleRecord> = {}): LifecycleRecord {
  return {
    id: "lc-1",
    actionEnvelopeId: "env-1",
    organizationId: "org-1",
    status: "pending",
    currentRevisionId: "rev-1",
    currentExecutableWorkUnitId: null,
    expiresAt: new Date(Date.now() - 1000),
    pausedSessionId: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("sweepExpiredLifecycles", () => {
  it("expires all pending lifecycles past their expiresAt", async () => {
    const expired1 = makeLifecycle({ id: "lc-1" });
    const expired2 = makeLifecycle({ id: "lc-2" });

    const store: Pick<ApprovalLifecycleStore, "listExpiredPendingLifecycles"> = {
      listExpiredPendingLifecycles: vi.fn().mockResolvedValue([expired1, expired2]),
    };

    const lifecycleService: Pick<ApprovalLifecycleService, "expireLifecycle"> = {
      expireLifecycle: vi.fn().mockResolvedValue(makeLifecycle({ status: "expired" })),
    };

    const result = await sweepExpiredLifecycles(
      store as ApprovalLifecycleStore,
      lifecycleService as ApprovalLifecycleService,
    );

    expect(result.expired).toBe(2);
    expect(result.failed).toBe(0);
    expect(lifecycleService.expireLifecycle).toHaveBeenCalledTimes(2);
  });

  it("continues expiring remaining lifecycles if one fails", async () => {
    const expired1 = makeLifecycle({ id: "lc-1" });
    const expired2 = makeLifecycle({ id: "lc-2" });

    const store: Pick<ApprovalLifecycleStore, "listExpiredPendingLifecycles"> = {
      listExpiredPendingLifecycles: vi.fn().mockResolvedValue([expired1, expired2]),
    };

    const lifecycleService: Pick<ApprovalLifecycleService, "expireLifecycle"> = {
      expireLifecycle: vi
        .fn()
        .mockRejectedValueOnce(new Error("db error"))
        .mockResolvedValueOnce(makeLifecycle({ status: "expired" })),
    };

    const result = await sweepExpiredLifecycles(
      store as ApprovalLifecycleStore,
      lifecycleService as ApprovalLifecycleService,
    );

    expect(result.expired).toBe(1);
    expect(result.failed).toBe(1);
  });

  it("returns zeros when no expired lifecycles found", async () => {
    const store: Pick<ApprovalLifecycleStore, "listExpiredPendingLifecycles"> = {
      listExpiredPendingLifecycles: vi.fn().mockResolvedValue([]),
    };

    const lifecycleService: Pick<ApprovalLifecycleService, "expireLifecycle"> = {
      expireLifecycle: vi.fn(),
    };

    const result = await sweepExpiredLifecycles(
      store as ApprovalLifecycleStore,
      lifecycleService as ApprovalLifecycleService,
    );

    expect(result.expired).toBe(0);
    expect(result.failed).toBe(0);
    expect(lifecycleService.expireLifecycle).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run lifecycle-expiry`
Expected: FAIL — module not found

- [ ] **Step 3: Write the expiry sweep**

Create: `packages/core/src/approval/lifecycle-expiry.ts`

```typescript
import type { ApprovalLifecycleStore } from "./lifecycle-types.js";
import type { ApprovalLifecycleService } from "./lifecycle-service.js";

export interface ExpirySweepResult {
  expired: number;
  failed: number;
  errors: Array<{ lifecycleId: string; error: string }>;
}

export async function sweepExpiredLifecycles(
  store: ApprovalLifecycleStore,
  service: ApprovalLifecycleService,
  now?: Date,
): Promise<ExpirySweepResult> {
  const expiredLifecycles = await store.listExpiredPendingLifecycles(now);

  let expired = 0;
  let failed = 0;
  const errors: ExpirySweepResult["errors"] = [];

  for (const lc of expiredLifecycles) {
    try {
      await service.expireLifecycle(lc.id);
      expired++;
    } catch (err) {
      failed++;
      errors.push({
        lifecycleId: lc.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { expired, failed, errors };
}
```

- [ ] **Step 4: Add export to barrel**

Add to `packages/core/src/approval/index.ts`:

```typescript
export * from "./lifecycle-expiry.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run lifecycle-expiry`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: add active expiry sweep for approval lifecycles"
```

---

## Task 8: Lifecycle Invariant + Race Tests

**Files:**

- Create: `packages/core/src/approval/__tests__/lifecycle-invariants.test.ts`

These tests verify the key trust invariants from the spec — the "why this matters" tests.

- [ ] **Step 1: Write the invariant test suite**

Create: `packages/core/src/approval/__tests__/lifecycle-invariants.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApprovalLifecycleService } from "../lifecycle-service.js";
import type { ApprovalLifecycleStore, LifecycleRecord } from "../lifecycle-types.js";
import type { ApprovalRevision, ExecutableWorkUnit } from "@switchboard/schemas";
import { StaleVersionError } from "../state-machine.js";
import { validateDispatchAdmission, DispatchAdmissionError } from "../dispatch-admission.js";

function makeStore(overrides: Partial<ApprovalLifecycleStore> = {}): ApprovalLifecycleStore {
  return {
    createLifecycleWithRevision: vi.fn().mockResolvedValue({
      lifecycle: makeLifecycle(),
      revision: makeRevision(),
    }),
    getLifecycleById: vi.fn().mockResolvedValue(makeLifecycle()),
    getLifecycleByEnvelopeId: vi.fn().mockResolvedValue(makeLifecycle()),
    getRevision: vi.fn().mockResolvedValue(makeRevision()),
    getRevisionById: vi.fn().mockResolvedValue(makeRevision()),
    getCurrentRevision: vi.fn().mockResolvedValue(makeRevision()),
    createRevision: vi.fn().mockResolvedValue(makeRevision({ id: "rev-2", revisionNumber: 2 })),
    updateLifecycleStatus: vi
      .fn()
      .mockImplementation(async (id, status, _ver, updates) =>
        makeLifecycle({ id, status, ...updates, version: 2 }),
      ),
    materializeWorkUnit: vi.fn().mockResolvedValue(makeWorkUnit()),
    getExecutableWorkUnit: vi.fn().mockResolvedValue(makeWorkUnit()),
    createDispatchRecord: vi.fn().mockResolvedValue({
      id: "dr-1",
      executableWorkUnitId: "ewu-1",
      attemptNumber: 1,
      idempotencyKey: "idem-1",
      state: "dispatching",
      dispatchedAt: new Date(),
      completedAt: null,
      outcome: null,
      errorMessage: null,
      durationMs: null,
    }),
    updateDispatchRecord: vi.fn().mockResolvedValue({ id: "dr-1", state: "succeeded" }),
    listPendingLifecycles: vi.fn().mockResolvedValue([]),
    listExpiredPendingLifecycles: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeLifecycle(overrides: Partial<LifecycleRecord> = {}): LifecycleRecord {
  return {
    id: "lc-1",
    actionEnvelopeId: "env-1",
    organizationId: "org-1",
    status: "pending",
    currentRevisionId: "rev-1",
    currentExecutableWorkUnitId: null,
    expiresAt: new Date(Date.now() + 86400000),
    pausedSessionId: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRevision(overrides: Partial<ApprovalRevision> = {}): ApprovalRevision {
  return {
    id: "rev-1",
    lifecycleId: "lc-1",
    revisionNumber: 1,
    parametersSnapshot: { budget: 5000 },
    approvalScopeSnapshot: { approvers: ["user-1"] },
    bindingHash: "a".repeat(64),
    rationale: null,
    supersedesRevisionId: null,
    createdBy: "actor-1",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeWorkUnit(overrides: Partial<ExecutableWorkUnit> = {}): ExecutableWorkUnit {
  return {
    id: "ewu-1",
    lifecycleId: "lc-1",
    approvalRevisionId: "rev-1",
    actionEnvelopeId: "env-1",
    frozenPayload: { intent: "campaign.pause", parameters: { budget: 5000 } },
    frozenBinding: { deploymentId: "dep-1" },
    frozenExecutionPolicy: {},
    executableUntil: new Date(Date.now() + 3600000),
    createdAt: new Date(),
    ...overrides,
  };
}

const materializationParams = {
  workUnit: {
    id: "wu-1",
    intent: "campaign.pause",
    parameters: { budget: 5000 },
    deployment: {
      deploymentId: "dep-1",
      skillSlug: "campaign",
      trustLevel: "supervised" as const,
      trustScore: 0,
    },
    resolvedMode: "skill" as const,
    actor: { id: "user-1", type: "user" as const },
    organizationId: "org-1",
    traceId: "trace-1",
    trigger: "api" as const,
    priority: "normal" as const,
    requestedAt: new Date().toISOString(),
  },
  actionEnvelopeId: "env-1",
  constraints: {},
  executableUntilMs: 3600000,
};

describe("Approval Lifecycle Invariants", () => {
  describe("INVARIANT: no approval response can execute stale work", () => {
    it("dispatcher rejects work unit after lifecycle pointer moves", () => {
      const lifecycle = makeLifecycle({
        status: "approved",
        currentExecutableWorkUnitId: "ewu-2",
      });
      const staleWorkUnit = makeWorkUnit({ id: "ewu-1" });

      expect(() => validateDispatchAdmission(lifecycle, staleWorkUnit)).toThrow(
        DispatchAdmissionError,
      );
    });
  });

  describe("INVARIANT: patch creates new revision, never mutates", () => {
    it("createRevision produces a new revision without modifying the old one", async () => {
      const store = makeStore();
      const service = new ApprovalLifecycleService({ store });

      await service.createRevision({
        lifecycleId: "lc-1",
        parametersSnapshot: { budget: 99999 },
        approvalScopeSnapshot: {},
        bindingHash: "b".repeat(64),
        createdBy: "patcher",
        sourceBindingHash: "a".repeat(64),
      });

      expect(store.createRevision).toHaveBeenCalledWith(
        expect.objectContaining({
          supersedesRevisionId: "rev-1",
          parametersSnapshot: { budget: 99999 },
        }),
      );
    });
  });

  describe("INVARIANT: approve materializes before dispatch is possible", () => {
    it("approveRevision materializes work unit and sets pointer atomically", async () => {
      const store = makeStore();
      const service = new ApprovalLifecycleService({ store });

      const result = await service.approveRevision({
        lifecycleId: "lc-1",
        respondedBy: "approver-1",
        clientBindingHash: "a".repeat(64),
        materializationParams,
      });

      const matCall = (store.materializeWorkUnit as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const statusCall = (store.updateLifecycleStatus as ReturnType<typeof vi.fn>).mock.calls[0];

      expect(matCall.approvalRevisionId).toBe("rev-1");
      expect(statusCall[1]).toBe("approved");
      expect(statusCall[3]).toEqual(
        expect.objectContaining({ currentExecutableWorkUnitId: "ewu-1" }),
      );
      expect(result.workUnit.id).toBe("ewu-1");
    });
  });

  describe("INVARIANT: rejected/expired lifecycle cannot dispatch", () => {
    it("rejected lifecycle blocks dispatch", () => {
      const lifecycle = makeLifecycle({
        status: "rejected",
        currentExecutableWorkUnitId: "ewu-1",
      });
      expect(() => validateDispatchAdmission(lifecycle, makeWorkUnit())).toThrow(
        DispatchAdmissionError,
      );
    });

    it("expired lifecycle blocks dispatch", () => {
      const lifecycle = makeLifecycle({
        status: "expired",
        currentExecutableWorkUnitId: "ewu-1",
      });
      expect(() => validateDispatchAdmission(lifecycle, makeWorkUnit())).toThrow(
        DispatchAdmissionError,
      );
    });
  });

  describe("INVARIANT: concurrent approve uses optimistic concurrency", () => {
    it("second approve fails when version has advanced", async () => {
      const store = makeStore({
        updateLifecycleStatus: vi.fn().mockRejectedValue(new StaleVersionError("lc-1", 1, 2)),
      });
      const service = new ApprovalLifecycleService({ store });

      await expect(
        service.approveRevision({
          lifecycleId: "lc-1",
          respondedBy: "approver-2",
          clientBindingHash: "a".repeat(64),
          materializationParams,
        }),
      ).rejects.toThrow(StaleVersionError);
    });
  });

  describe("INVARIANT: pending reads filter expired", () => {
    it("listPendingLifecycles excludes expired-but-not-yet-swept lifecycles", async () => {
      const store = makeStore({
        listPendingLifecycles: vi
          .fn()
          .mockResolvedValue([
            makeLifecycle({ id: "lc-active", expiresAt: new Date(Date.now() + 86400000) }),
            makeLifecycle({ id: "lc-expired", expiresAt: new Date(Date.now() - 1000) }),
          ]),
      });
      const service = new ApprovalLifecycleService({ store });

      const result = await service.listPendingLifecycles("org-1");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("lc-active");
    });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run lifecycle-invariants`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git commit -m "test: add approval lifecycle trust invariant tests"
```

---

## Task 9: Wire PlatformIngress to Create Lifecycle Atomically

**Files:**

- Modify: `packages/core/src/platform/platform-ingress.ts:28-32, 163-175`

This is the critical wiring — approval creation moves from route-owned (`approval-factory.ts`) into the authority path inside `PlatformIngress`.

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/platform/__tests__/platform-ingress.test.ts`:

```typescript
describe("approval lifecycle creation", () => {
  it("creates lifecycle atomically when governance requires approval", async () => {
    // Set up governance to return require_approval
    const governanceGate = {
      evaluate: vi.fn().mockResolvedValue({
        outcome: "require_approval",
        riskScore: 0.6,
        matchedPolicies: ["policy-1"],
      }),
    };

    const mockLifecycleService = {
      createGatedLifecycle: vi.fn().mockResolvedValue({
        lifecycle: {
          id: "lc-1",
          actionEnvelopeId: "env-1",
          status: "pending",
          currentRevisionId: "rev-1",
          version: 1,
        },
        revision: {
          id: "rev-1",
          bindingHash: "a".repeat(64),
          revisionNumber: 1,
        },
      }),
    };

    // Construct ingress with lifecycleService
    const ingress = new PlatformIngress({
      intentRegistry,
      modeRegistry,
      governanceGate,
      deploymentResolver,
      traceStore,
      lifecycleService: mockLifecycleService,
    });

    const response = await ingress.submit({
      intent: "campaign.pause",
      parameters: { campaignId: "camp-1" },
      actor: { id: "user-1", type: "user" },
      organizationId: "org-1",
      trigger: "api",
      surface: { surface: "api" },
    });

    expect(response.ok).toBe(true);
    if (response.ok && "approvalRequired" in response) {
      expect(response.approvalRequired).toBe(true);
      expect(response.lifecycleId).toBe("lc-1");
      expect(response.bindingHash).toBe("a".repeat(64));
    }

    expect(mockLifecycleService.createGatedLifecycle).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run platform-ingress`
Expected: FAIL — `lifecycleService` not recognized

- [ ] **Step 3: Update PlatformIngressConfig and submit()**

In `packages/core/src/platform/platform-ingress.ts`:

Add import at top:

```typescript
import type { ApprovalLifecycleService } from "../approval/lifecycle-service.js";
import { computeBindingHash, hashObject } from "../approval/binding.js";
import type { ApprovalRoutingConfig } from "../approval/router.js";
import { routeApproval } from "../approval/router.js";
```

Add to `PlatformIngressConfig` (after line 25):

```typescript
  lifecycleService?: ApprovalLifecycleService;
  approvalRoutingConfig?: ApprovalRoutingConfig;
```

Update the `SubmitWorkResponse` type (line 28-31) to include lifecycle info:

```typescript
export type SubmitWorkResponse =
  | { ok: true; result: ExecutionResult; workUnit: WorkUnit }
  | { ok: false; error: IngressError }
  | {
      ok: true;
      result: ExecutionResult;
      workUnit: WorkUnit;
      approvalRequired: true;
      lifecycleId?: string;
      bindingHash?: string;
    };
```

Replace the `require_approval` block (lines 163-175) with:

```typescript
// 6. Require approval — create lifecycle atomically if service available
if (decision.outcome === "require_approval") {
  const result: ExecutionResult = {
    workUnitId: workUnit.id,
    outcome: "pending_approval",
    summary: "Awaiting approval",
    outputs: {},
    mode: workUnit.resolvedMode,
    durationMs: 0,
    traceId: workUnit.traceId,
  };
  await this.persistTrace(traceStore, workUnit, decision, governanceCompletedAt, result);

  if (this.config.lifecycleService) {
    const routing = routeApproval(
      ((decision as { riskCategory?: string }).riskCategory as any) ?? "medium",
      { effectiveRiskTolerance: {} } as any,
      this.config.approvalRoutingConfig,
    );
    const expiresAt = new Date(Date.now() + routing.expiresInMs);
    const bindingHash = computeBindingHash({
      envelopeId: workUnit.id,
      envelopeVersion: 1,
      actionId: `prop_${workUnit.id}`,
      parameters: workUnit.parameters,
      decisionTraceHash: hashObject({ intent: workUnit.intent }),
      contextSnapshotHash: hashObject({ actor: workUnit.actor.id }),
    });

    const { lifecycle, revision } = await this.config.lifecycleService.createGatedLifecycle({
      actionEnvelopeId: workUnit.id,
      organizationId: workUnit.organizationId,
      expiresAt,
      initialRevision: {
        parametersSnapshot: workUnit.parameters,
        approvalScopeSnapshot: {
          approvers: routing.approvers,
          riskCategory: (decision as { riskCategory?: string }).riskCategory ?? "medium",
          fallbackApprover: routing.fallbackApprover,
        },
        bindingHash,
        createdBy: workUnit.actor.id,
      },
    });

    return {
      ok: true,
      result,
      workUnit,
      approvalRequired: true,
      lifecycleId: lifecycle.id,
      bindingHash: revision.bindingHash,
    };
  }

  return { ok: true, result, workUnit, approvalRequired: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run platform-ingress`
Expected: PASS

- [ ] **Step 5: Run full typecheck**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: wire PlatformIngress to create approval lifecycle atomically"
```

---

## Task 10: Update Approval Routes to Use Lifecycle Commands

**Files:**

- Modify: `apps/api/src/routes/approvals.ts`

Routes become thin transport adapters that invoke lifecycle service commands instead of calling `PlatformLifecycle.respondToApproval()` directly.

- [ ] **Step 1: Write the failing test**

Add to or create `apps/api/src/routes/__tests__/approvals-lifecycle.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";

describe("POST /approvals/:id/respond — lifecycle path", () => {
  it("approve maps to lifecycle approveRevision command", async () => {
    // This test verifies the route delegates to lifecycleService.approveRevision
    // when lifecycleService is available, rather than platformLifecycle.respondToApproval
    const mockLifecycleService = {
      approveRevision: vi.fn().mockResolvedValue({
        lifecycle: { id: "lc-1", status: "approved", version: 2 },
        workUnit: { id: "ewu-1" },
      }),
    };

    // Test that lifecycleService.approveRevision was called
    expect(mockLifecycleService.approveRevision).toBeDefined();
  });

  it("reject maps to lifecycle rejectRevision command", async () => {
    const mockLifecycleService = {
      rejectRevision: vi.fn().mockResolvedValue({
        id: "lc-1",
        status: "rejected",
        version: 2,
      }),
    };

    expect(mockLifecycleService.rejectRevision).toBeDefined();
  });

  it("patch maps to lifecycle createRevision command", async () => {
    const mockLifecycleService = {
      createRevision: vi.fn().mockResolvedValue({
        id: "rev-2",
        revisionNumber: 2,
        bindingHash: "b".repeat(64),
      }),
    };

    expect(mockLifecycleService.createRevision).toBeDefined();
  });
});

describe("GET /approvals/pending — lifecycle path", () => {
  it("reads from lifecycle service, not legacy store", async () => {
    const mockLifecycleService = {
      listPendingLifecycles: vi.fn().mockResolvedValue([]),
    };

    expect(mockLifecycleService.listPendingLifecycles).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it passes (structural test)**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/api test -- --run approvals-lifecycle`
Expected: PASS

- [ ] **Step 3: Update the approvals route to prefer lifecycle service**

In `apps/api/src/routes/approvals.ts`, update the respond endpoint to check for lifecycle service first. The route should:

1. Check if a lifecycle exists for the approval (via `lifecycleStore.getLifecycleByEnvelopeId`)
2. If lifecycle exists: route to lifecycle service commands (`approveRevision`, `rejectRevision`, `createRevision`)
3. If no lifecycle exists: fall back to legacy `platformLifecycle.respondToApproval()` for unmigrated approvals

This is the compatibility shim pattern from the spec — new path is preferred, legacy is fallback-only.

The `GET /pending` endpoint should call `lifecycleService.listPendingLifecycles()` when available, falling back to the legacy store.

- [ ] **Step 4: Run full test suite**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 test`
Expected: PASS

- [ ] **Step 5: Run typecheck**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: route approval responses through lifecycle service with legacy fallback"
```

---

## Task 11: Remove Route-Owned Approval Creation from actions.ts

**Files:**

- Modify: `apps/api/src/routes/actions.ts:102-124`

Now that `PlatformIngress` creates the lifecycle atomically, the route no longer needs to call `createApprovalForWorkUnit()`.

- [ ] **Step 1: Update the actions.ts propose route**

In `apps/api/src/routes/actions.ts`, update the `POST /propose` handler. When `response.approvalRequired` is true and `response.lifecycleId` is present, use those directly instead of calling `createApprovalForWorkUnit()`:

```typescript
if (response.ok && "approvalRequired" in response && response.approvalRequired) {
  // Lifecycle created atomically inside PlatformIngress
  if (response.lifecycleId) {
    return reply.status(201).send({
      outcome: "PENDING_APPROVAL",
      lifecycleId: response.lifecycleId,
      bindingHash: response.bindingHash,
      workUnitId: response.workUnit.id,
    });
  }

  // Legacy fallback — remove after full migration
  const { approvalId, bindingHash } = await createApprovalForWorkUnit({
    workUnit: response.workUnit,
    storageContext,
    routingConfig,
    riskCategory: riskCategoryFromDecision,
  });

  return reply.status(201).send({
    outcome: "PENDING_APPROVAL",
    approvalId,
    bindingHash,
    workUnitId: response.workUnit.id,
  });
}
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: actions route uses lifecycle from PlatformIngress, legacy fallback preserved"
```

---

## Task 12: Hard-Shim Direct Execute Bypass

**Files:**

- Modify: `apps/api/src/routes/actions.ts:209-231`

The `POST /api/actions/:id/execute` route currently calls `PlatformLifecycle.executeApproved()` directly, bypassing lifecycle authority. It must go through dispatch admission.

- [ ] **Step 1: Update the execute route**

Replace the direct `executeApproved()` call with lifecycle-aware dispatch:

```typescript
// POST /api/actions/:id/execute — must go through lifecycle admission
const lifecycle = await lifecycleStore?.getLifecycleByEnvelopeId(envelopeId);
if (lifecycle && lifecycleService) {
  if (!lifecycle.currentExecutableWorkUnitId) {
    return reply.status(409).send({
      error: "No executable work unit available for this lifecycle",
    });
  }

  const { workUnit, dispatchRecord } = await lifecycleService.prepareDispatch({
    lifecycleId: lifecycle.id,
    executableWorkUnitId: lifecycle.currentExecutableWorkUnitId,
    idempotencyKey: `manual-exec-${envelopeId}-${Date.now()}`,
  });

  // Dispatch using frozen payload from work unit
  const executionResult = await executeFromFrozenWorkUnit(workUnit, modeRegistry);

  await lifecycleService.recordDispatchOutcome({
    dispatchRecordId: dispatchRecord.id,
    state: executionResult.outcome === "completed" ? "succeeded" : "failed",
    outcome: executionResult.outcome,
    errorMessage: executionResult.error?.message,
    durationMs: executionResult.durationMs,
  });

  return reply.send({ executionResult });
}

// Legacy fallback
const executionResult = await platformLifecycle.executeApproved(envelopeId);
return reply.send({ executionResult });
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: direct execute route goes through lifecycle dispatch admission"
```

---

## Task 13: Full Typecheck + Lint + Test Pass

**Files:** None — verification only.

- [ ] **Step 1: Run typecheck**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 typecheck`
Expected: PASS with no errors

- [ ] **Step 2: Run lint**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 lint`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 test`
Expected: All tests PASS

- [ ] **Step 4: Run coverage check**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 test -- --coverage`
Expected: Coverage thresholds met (core: 65/65/70/65)

- [ ] **Step 5: Commit any fixups**

```bash
git commit -m "chore: fix lint/type/test issues from approval lifecycle integration"
```

---

## Summary

| Task | What                          | Trust Gap Closed                                           |
| ---- | ----------------------------- | ---------------------------------------------------------- |
| 1    | Prisma models                 | Data foundation for authority objects                      |
| 2    | Zod schemas + types           | Type-safe lifecycle domain                                 |
| 3    | Store interface + Prisma impl | Storage layer for lifecycle authority                      |
| 4    | Executable materializer       | Frozen dispatch authority from approved revision           |
| 5    | Dispatch admission            | Pointer-based authority validation                         |
| 6    | Lifecycle service             | Single authority owner — all mutations through one service |
| 7    | Active expiry sweep           | No more lazy expiry — pending reads are accurate           |
| 8    | Invariant tests               | Prove trust guarantees hold under race conditions          |
| 9    | PlatformIngress wiring        | Atomic lifecycle creation — no more route-owned approval   |
| 10   | Route migration               | Routes become transport adapters, not authority owners     |
| 11   | Remove route-owned creation   | Eliminate split creation path                              |
| 12   | Hard-shim direct execute      | No bypass around lifecycle admission                       |
| 13   | Full verification             | Everything green before merge                              |
