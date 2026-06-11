# Alex Booking Outcome (F5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A successful Alex booking persists a typed, idempotent booking outcome on the canonical WorkTrace, and a shipped read-model join surfaces "Alex converted this lead, here is the trace and the revenue."

**Architecture:** Derive the outcome from the turn's tool calls in a shared pure function, persist it inline in the always-invoked `TracePersistenceHook` (energizing the previously-dead outcome-linking path), map the columns in the trace store, and add an org-scoped db read-model that joins `ExecutionTrace` to `Booking` to `ConversionRecord` by `bookingId`.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), Prisma, Vitest (mocked Prisma for db stores), pnpm + Turborepo.

Spec: `docs/superpowers/specs/2026-06-11-alex-booking-outcome-design.md`. No schema migration (verified). No new route or env var.

---

## File structure

- `packages/core/src/skill-runtime/types.ts` (Modify): add `LinkedOutcomeType` union (adds `"booking"`); widen `SkillExecutionTrace.linkedOutcomeType` to it.
- `packages/core/src/skill-runtime/outcome-linker.ts` (Modify): add `LinkedOutcome` + `deriveLinkedOutcome()` (booking branch first); refactor `OutcomeLinker.linkFromToolCalls` to delegate.
- `packages/core/src/skill-runtime/outcome-linker.test.ts` (Modify): booking tests; keep 6 existing.
- `packages/core/src/skill-runtime/index.ts` (Modify): export `deriveLinkedOutcome`, `LinkedOutcome`.
- `packages/core/src/skill-runtime/hooks/trace-persistence-hook.ts` (Modify): derive + persist `linkedOutcome*` inline in `afterSkill`.
- `packages/core/src/skill-runtime/hooks/trace-persistence-hook.test.ts` (Modify): assert persisted booking outcome.
- `packages/db/src/stores/prisma-execution-trace-store.ts` (Modify): map `linkedOutcome*` in `create`.
- `packages/db/src/stores/__tests__/prisma-execution-trace-store.test.ts` (Modify): assert mapping.
- `packages/db/src/stores/prisma-booking-outcome-ledger-store.ts` (Create): the join read-model + `BookingOutcomeLedgerRow`.
- `packages/db/src/stores/__tests__/prisma-booking-outcome-ledger-store.test.ts` (Create): producer to consumer join tests.
- `packages/db/src/index.ts` (Modify): export the store + row type.

---

## Task 1: Shared `deriveLinkedOutcome` with booking branch

**Files:**

- Modify: `packages/core/src/skill-runtime/types.ts`
- Modify: `packages/core/src/skill-runtime/outcome-linker.ts`
- Modify: `packages/core/src/skill-runtime/index.ts`
- Test: `packages/core/src/skill-runtime/outcome-linker.test.ts`

- [ ] **Step 1: Add the `LinkedOutcomeType` union to `types.ts` and widen the trace field.**

In `packages/core/src/skill-runtime/types.ts`, add near the top of the Execution Trace section (before `SkillExecutionTrace`):

```ts
/** The kinds of business outcome a skill turn can be linked to on its WorkTrace. */
export type LinkedOutcomeType = "opportunity" | "task" | "campaign" | "booking";
```

Change `SkillExecutionTrace.linkedOutcomeType?: "opportunity" | "task" | "campaign";` to:

```ts
  linkedOutcomeType?: LinkedOutcomeType;
```

- [ ] **Step 2: Write the failing booking tests in `outcome-linker.test.ts`.**

Append these tests inside the `describe("OutcomeLinker", ...)` block:

```ts
it("links a successful booking as a typed booked outcome", async () => {
  const store = makeStore();
  const linker = new OutcomeLinker(store);
  await linker.linkFromToolCalls("org_1", "trace-1", [
    makeToolCall({
      toolId: "calendar-book",
      operation: "booking.create",
      params: { service: "botox", slotStart: "2026-06-12T03:00:00Z" },
      result: ok(
        { bookingId: "bk_1", status: "confirmed" },
        { entityState: { bookingId: "bk_1", status: "confirmed" } },
      ),
    }),
  ]);
  expect(store.linkOutcome).toHaveBeenCalledWith("org_1", "trace-1", {
    id: "bk_1",
    type: "booking",
    result: "booked",
  });
});

it("prefers the booking outcome over a stage update in the same turn", async () => {
  const store = makeStore();
  const linker = new OutcomeLinker(store);
  await linker.linkFromToolCalls("org_1", "trace-1", [
    makeToolCall({
      toolId: "crm-write",
      operation: "stage.update",
      params: { opportunityId: "opp-1" },
      result: ok({ stage: "booked" }, { entityState: { opportunityId: "opp-1", stage: "booked" } }),
    }),
    makeToolCall({
      toolId: "calendar-book",
      operation: "booking.create",
      params: { service: "botox" },
      result: ok(
        { bookingId: "bk_9" },
        { entityState: { bookingId: "bk_9", status: "confirmed" } },
      ),
    }),
  ]);
  expect(store.linkOutcome).toHaveBeenCalledTimes(1);
  expect(store.linkOutcome).toHaveBeenCalledWith("org_1", "trace-1", {
    id: "bk_9",
    type: "booking",
    result: "booked",
  });
});

it("does not link a failed booking", async () => {
  const store = makeStore();
  const linker = new OutcomeLinker(store);
  await linker.linkFromToolCalls("org_1", "trace-1", [
    makeToolCall({
      toolId: "calendar-book",
      operation: "booking.create",
      params: { service: "botox" },
      result: { status: "error", error: { code: "SLOT_TAKEN", message: "taken", retryable: true } },
    }),
  ]);
  expect(store.linkOutcome).not.toHaveBeenCalled();
});

it("exposes deriveLinkedOutcome as a pure function", () => {
  expect(
    deriveLinkedOutcome(
      [
        makeToolCall({
          toolId: "calendar-book",
          operation: "booking.create",
          params: {},
          result: ok({ bookingId: "bk_2" }, { entityState: { bookingId: "bk_2" } }),
        }),
      ],
      "trace-x",
    ),
  ).toEqual({ id: "bk_2", type: "booking", result: "booked" });
  expect(deriveLinkedOutcome([], "trace-x")).toBeNull();
});
```

Add `deriveLinkedOutcome` to the import at the top:

```ts
import { OutcomeLinker, deriveLinkedOutcome } from "./outcome-linker.js";
```

- [ ] **Step 3: Run the tests to verify they fail.**

Run: `pnpm --filter @switchboard/core test -- outcome-linker`
Expected: FAIL (`deriveLinkedOutcome` is not exported; booking not linked).

- [ ] **Step 4: Implement `deriveLinkedOutcome` and delegate in `outcome-linker.ts`.**

Replace the entire body of `packages/core/src/skill-runtime/outcome-linker.ts` with:

```ts
import type { ToolCallRecord } from "./types.js";
import type { LinkedOutcomeType } from "./types.js";

export interface LinkedOutcome {
  id: string;
  type: LinkedOutcomeType;
  result: string;
}

interface TraceStoreForOutcomeLinker {
  linkOutcome(organizationId: string, traceId: string, outcome: LinkedOutcome): Promise<void>;
}

/**
 * Derives the single business outcome a skill turn should be linked to, from its
 * tool calls. Priority: a successful booking (terminal conversion) wins over a
 * stage update, which wins over an opt-out. Pure and side-effect free so both the
 * post-turn OutcomeLinker and the always-invoked TracePersistenceHook can reuse it.
 */
export function deriveLinkedOutcome(
  toolCalls: ToolCallRecord[],
  traceId: string,
): LinkedOutcome | null {
  // Booking conversion is the strongest terminal outcome: scan for it first.
  for (const call of toolCalls) {
    if (
      call.toolId === "calendar-book" &&
      call.operation === "booking.create" &&
      call.result.status === "success"
    ) {
      const entityState = call.result.entityState as { bookingId?: unknown } | undefined;
      const bookingId = entityState?.bookingId;
      if (typeof bookingId === "string" && bookingId.length > 0) {
        return { id: bookingId, type: "booking", result: "booked" };
      }
    }
  }

  // Existing behavior, preserved: first call matching stage/opt-out wins.
  for (const call of toolCalls) {
    if (call.toolId === "crm-write" && call.operation === "stage.update") {
      const params = call.params as { opportunityId?: string };
      const stage = call.result.entityState?.stage as string | undefined;
      if (params.opportunityId && stage) {
        return { id: params.opportunityId, type: "opportunity", result: `stage_${stage}` };
      }
    }

    if (call.toolId === "crm-write" && call.operation === "activity.log") {
      const params = call.params as { eventType?: string };
      if (params.eventType === "opt-out") {
        return { id: traceId, type: "task", result: "opt_out" };
      }
    }
  }

  return null;
}

export class OutcomeLinker {
  constructor(private traceStore: TraceStoreForOutcomeLinker) {}

  async linkFromToolCalls(
    organizationId: string,
    traceId: string,
    toolCalls: ToolCallRecord[],
  ): Promise<void> {
    const outcome = deriveLinkedOutcome(toolCalls, traceId);
    if (outcome) {
      await this.traceStore.linkOutcome(organizationId, traceId, outcome);
    }
  }
}
```

- [ ] **Step 5: Export `deriveLinkedOutcome` and `LinkedOutcome` from the skill-runtime index.**

In `packages/core/src/skill-runtime/index.ts`, change the OutcomeLinker export line (currently `export { OutcomeLinker } from "./outcome-linker.js";`) to:

```ts
export { OutcomeLinker, deriveLinkedOutcome } from "./outcome-linker.js";
export type { LinkedOutcome } from "./outcome-linker.js";
```

- [ ] **Step 6: Run the tests to verify they pass.**

Run: `pnpm --filter @switchboard/core test -- outcome-linker`
Expected: PASS (all 10 tests: 6 existing + 4 new).

- [ ] **Step 7: Commit.**

```bash
git add packages/core/src/skill-runtime/types.ts packages/core/src/skill-runtime/outcome-linker.ts packages/core/src/skill-runtime/outcome-linker.test.ts packages/core/src/skill-runtime/index.ts
git commit -m "feat(core): derive a typed booking outcome from skill tool calls (F5)"
```

---

## Task 2: Energize the producer in `TracePersistenceHook`

**Files:**

- Modify: `packages/core/src/skill-runtime/hooks/trace-persistence-hook.ts`
- Test: `packages/core/src/skill-runtime/hooks/trace-persistence-hook.test.ts`

- [ ] **Step 1: Write the failing test.**

In `trace-persistence-hook.test.ts`, add a booking-aware result helper and a test inside the `describe` block. After the existing `resultWith` helper, add:

```ts
function resultWithBookingCall(): SkillExecutionResult {
  const base = resultWith({ input: 10, output: 5 });
  return {
    ...base,
    toolCalls: [
      {
        toolId: "calendar-book",
        operation: "booking.create",
        params: { service: "botox" },
        result: {
          status: "success",
          data: { bookingId: "bk_77" },
          entityState: { bookingId: "bk_77", status: "confirmed" },
        },
        durationMs: 20,
        governanceDecision: "auto-approved",
      },
    ],
  };
}
```

Then add the test:

```ts
it("persists a typed booking outcome on the trace for a successful booking turn", async () => {
  const created: SkillExecutionTrace[] = [];
  const store = {
    create: async (t: SkillExecutionTrace) => {
      created.push(t);
    },
  };
  const hook = new TracePersistenceHook(store, { trigger: "chat_message" });
  await hook.afterSkill(baseCtx({}), resultWithBookingCall());
  expect(created[0]!.linkedOutcomeId).toBe("bk_77");
  expect(created[0]!.linkedOutcomeType).toBe("booking");
  expect(created[0]!.linkedOutcomeResult).toBe("booked");
});

it("leaves linkedOutcome unset for a turn with no business outcome", async () => {
  const created: SkillExecutionTrace[] = [];
  const store = {
    create: async (t: SkillExecutionTrace) => {
      created.push(t);
    },
  };
  const hook = new TracePersistenceHook(store, { trigger: "chat_message" });
  await hook.afterSkill(baseCtx({}), resultWith({ input: 1, output: 1 }));
  expect(created[0]!.linkedOutcomeId).toBeUndefined();
  expect(created[0]!.linkedOutcomeType).toBeUndefined();
  expect(created[0]!.linkedOutcomeResult).toBeUndefined();
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm --filter @switchboard/core test -- trace-persistence-hook`
Expected: FAIL (`linkedOutcomeId` is undefined for the booking turn).

- [ ] **Step 3: Implement the inline derivation in `trace-persistence-hook.ts`.**

Add the import at the top (after the existing imports):

```ts
import { deriveLinkedOutcome } from "../outcome-linker.js";
```

In `afterSkill`, replace the `const trace: SkillExecutionTrace = { id: createId(), ... }` construction so the id is computed first and the outcome is derived and spread in. Change the start of the trace object to:

```ts
const traceId = createId();
const linkedOutcome = deriveLinkedOutcome(result.toolCalls, traceId);
const trace: SkillExecutionTrace = {
  id: traceId,
  deploymentId: ctx.deploymentId,
  organizationId: ctx.orgId,
  skillSlug: ctx.skillSlug,
  skillVersion: ctx.skillVersion,
  trigger: this.traceContext.trigger,
  sessionId: ctx.sessionId,
  inputParametersHash: ctx.inputParametersHash ?? "",
  toolCalls: result.toolCalls,
  governanceDecisions: result.trace.governanceDecisions,
  tokenUsage: {
    input: result.tokenUsage.input,
    output: result.tokenUsage.output,
    cacheRead,
    cacheCreation,
    costUsd: totalCost,
    ...(model ? { model } : {}),
  },
  durationMs: result.trace.durationMs,
  turnCount: result.trace.turnCount,
  status: result.trace.status,
  error: result.trace.error,
  responseSummary: result.response.slice(0, 500),
  ...(linkedOutcome
    ? {
        linkedOutcomeId: linkedOutcome.id,
        linkedOutcomeType: linkedOutcome.type,
        linkedOutcomeResult: linkedOutcome.result,
      }
    : {}),
  writeCount: result.trace.writeCount,
  createdAt: new Date(),
};
```

(The `onError` path is left unchanged: it has no tool calls, so no outcome.)

- [ ] **Step 4: Run the test to verify it passes.**

Run: `pnpm --filter @switchboard/core test -- trace-persistence-hook`
Expected: PASS (existing tests + 2 new).

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/skill-runtime/hooks/trace-persistence-hook.ts packages/core/src/skill-runtime/hooks/trace-persistence-hook.test.ts
git commit -m "feat(core): persist the linked booking outcome on the work trace (F5)"
```

---

## Task 3: Map `linkedOutcome*` in the execution-trace store create

**Files:**

- Modify: `packages/db/src/stores/prisma-execution-trace-store.ts`
- Test: `packages/db/src/stores/__tests__/prisma-execution-trace-store.test.ts`

- [ ] **Step 1: Write the failing test.**

In `prisma-execution-trace-store.test.ts`, inside `describe("create", ...)`, add:

```ts
it("persists linked outcome fields when present", async () => {
  const trace = makeTrace({
    linkedOutcomeId: "bk_1",
    linkedOutcomeType: "booking",
    linkedOutcomeResult: "booked",
  });
  await store.create(trace);
  expect(prisma.executionTrace.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      linkedOutcomeId: "bk_1",
      linkedOutcomeType: "booking",
      linkedOutcomeResult: "booked",
    }),
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm --filter @switchboard/db test -- prisma-execution-trace-store`
Expected: FAIL (create data does not include `linkedOutcomeId`).

- [ ] **Step 3: Implement the mapping.**

In `packages/db/src/stores/prisma-execution-trace-store.ts`, inside `create`'s `data: { ... }` object, add these three lines just before `writeCount: trace.writeCount,`:

```ts
        linkedOutcomeId: trace.linkedOutcomeId,
        linkedOutcomeType: trace.linkedOutcomeType,
        linkedOutcomeResult: trace.linkedOutcomeResult,
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `pnpm --filter @switchboard/db test -- prisma-execution-trace-store`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/db/src/stores/prisma-execution-trace-store.ts packages/db/src/stores/__tests__/prisma-execution-trace-store.test.ts
git commit -m "feat(db): map linked outcome fields on execution-trace create (F5)"
```

---

## Task 4: Booking-outcome ledger read-model (the join consumer)

**Files:**

- Create: `packages/db/src/stores/prisma-booking-outcome-ledger-store.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/stores/__tests__/prisma-booking-outcome-ledger-store.test.ts`

- [ ] **Step 1: Write the failing producer to consumer test.**

Create `packages/db/src/stores/__tests__/prisma-booking-outcome-ledger-store.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { deriveLinkedOutcome } from "@switchboard/core";
import type { ToolCallRecord } from "@switchboard/core";
import { PrismaBookingOutcomeLedgerStore } from "../prisma-booking-outcome-ledger-store.js";

// A successful Alex booking tool call — the real producer input.
function bookingCall(bookingId: string): ToolCallRecord {
  return {
    toolId: "calendar-book",
    operation: "booking.create",
    params: { service: "botox" },
    result: {
      status: "success",
      data: { bookingId },
      entityState: { bookingId, status: "confirmed" },
    },
    durationMs: 20,
    governanceDecision: "auto-approved",
  };
}

function makePrisma() {
  return {
    executionTrace: { findMany: vi.fn().mockResolvedValue([]) },
    booking: { findMany: vi.fn().mockResolvedValue([]) },
    conversionRecord: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

describe("PrismaBookingOutcomeLedgerStore", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let store: PrismaBookingOutcomeLedgerStore;

  beforeEach(() => {
    prisma = makePrisma();
    store = new PrismaBookingOutcomeLedgerStore(prisma as never);
  });

  it("joins a producer-written booking outcome to its trace and revenue", async () => {
    // PRODUCER: derive the outcome exactly as TracePersistenceHook would.
    const outcome = deriveLinkedOutcome([bookingCall("bk_1")], "trace_1");
    expect(outcome).toEqual({ id: "bk_1", type: "booking", result: "booked" });

    // The persisted trace carries that producer output.
    prisma.executionTrace.findMany.mockResolvedValue([
      {
        id: "trace_1",
        deploymentId: "dep_alex",
        skillSlug: "alex",
        linkedOutcomeId: outcome!.id,
      },
    ]);
    prisma.booking.findMany.mockResolvedValue([
      {
        id: "bk_1",
        contactId: "c_1",
        service: "botox",
        status: "confirmed",
        startsAt: new Date("2026-06-12T03:00:00Z"),
      },
    ]);
    prisma.conversionRecord.findMany.mockResolvedValue([
      {
        bookingId: "bk_1",
        value: 45000,
        sourceCampaignId: "camp_9",
        sourceAdId: "ad_3",
        occurredAt: new Date("2026-06-12T03:00:00Z"),
      },
    ]);

    const rows = await store.listForOrg({ orgId: "org_1", limit: 50 });

    expect(rows).toEqual([
      {
        traceId: "trace_1",
        deploymentId: "dep_alex",
        skillSlug: "alex",
        outcome: "booked",
        bookingId: "bk_1",
        contactId: "c_1",
        service: "botox",
        bookingStatus: "confirmed",
        bookedAt: new Date("2026-06-12T03:00:00Z"),
        value: 45000,
        sourceCampaignId: "camp_9",
        sourceAdId: "ad_3",
        occurredAt: new Date("2026-06-12T03:00:00Z"),
      },
    ]);
    // org-scoped on every leg
    expect(prisma.executionTrace.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org_1", linkedOutcomeType: "booking" },
      }),
    );
    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org_1", id: { in: ["bk_1"] } },
      }),
    );
    expect(prisma.conversionRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org_1", bookingId: { in: ["bk_1"] }, type: "booked" },
      }),
    );
  });

  it("returns the booking outcome with null revenue until the conversion settles", async () => {
    prisma.executionTrace.findMany.mockResolvedValue([
      { id: "trace_2", deploymentId: "dep_alex", skillSlug: "alex", linkedOutcomeId: "bk_2" },
    ]);
    prisma.booking.findMany.mockResolvedValue([
      {
        id: "bk_2",
        contactId: "c_2",
        service: "filler",
        status: "confirmed",
        startsAt: new Date("2026-06-13T03:00:00Z"),
      },
    ]);
    // conversionRecord.findMany stays [] (async, not settled yet)

    const rows = await store.listForOrg({ orgId: "org_1", limit: 50 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).toBeNull();
    expect(rows[0]!.sourceCampaignId).toBeNull();
    expect(rows[0]!.occurredAt).toBeNull();
    expect(rows[0]!.bookingId).toBe("bk_2");
  });

  it("returns empty when no traces carry a booking outcome (today's state)", async () => {
    const rows = await store.listForOrg({ orgId: "org_1", limit: 50 });
    expect(rows).toEqual([]);
    expect(prisma.booking.findMany).not.toHaveBeenCalled();
  });

  it("skips a trace whose booking is absent in the org", async () => {
    prisma.executionTrace.findMany.mockResolvedValue([
      { id: "trace_3", deploymentId: "dep_alex", skillSlug: "alex", linkedOutcomeId: "bk_gone" },
    ]);
    prisma.booking.findMany.mockResolvedValue([]); // not found / other org
    const rows = await store.listForOrg({ orgId: "org_1", limit: 50 });
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm --filter @switchboard/db test -- prisma-booking-outcome-ledger-store`
Expected: FAIL (module does not exist).

- [ ] **Step 3: Implement the read-model store.**

Create `packages/db/src/stores/prisma-booking-outcome-ledger-store.ts`:

```ts
import type { PrismaClient } from "@prisma/client";

/**
 * One Alex booking outcome joined to its trace and revenue: the per-action
 * outcome ledger the cockpit and Riley attribution join on to render "Alex
 * converted this lead, here is the trace and the revenue" (audit F5).
 *
 * Booking outcomes are produced only by Alex's `calendar-book` tool, so
 * `skillSlug` is the agent attribution (no fabricated agentRole field). The
 * revenue leg is left-joined: it is null until the async `booked` ConversionRecord
 * settles.
 */
export interface BookingOutcomeLedgerRow {
  traceId: string;
  deploymentId: string;
  skillSlug: string;
  outcome: "booked";
  bookingId: string;
  contactId: string;
  service: string;
  bookingStatus: string;
  bookedAt: Date;
  value: number | null;
  sourceCampaignId: string | null;
  sourceAdId: string | null;
  occurredAt: Date | null;
}

export class PrismaBookingOutcomeLedgerStore {
  constructor(private readonly prisma: PrismaClient) {}

  async listForOrg(args: { orgId: string; limit: number }): Promise<BookingOutcomeLedgerRow[]> {
    const traces = await this.prisma.executionTrace.findMany({
      where: { organizationId: args.orgId, linkedOutcomeType: "booking" },
      orderBy: { createdAt: "desc" },
      take: args.limit,
      select: { id: true, deploymentId: true, skillSlug: true, linkedOutcomeId: true },
    });

    const bookingIds = traces
      .map((t) => t.linkedOutcomeId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (bookingIds.length === 0) return [];

    const [bookings, conversions] = await Promise.all([
      this.prisma.booking.findMany({
        where: { organizationId: args.orgId, id: { in: bookingIds } },
        select: { id: true, contactId: true, service: true, status: true, startsAt: true },
      }),
      this.prisma.conversionRecord.findMany({
        where: { organizationId: args.orgId, bookingId: { in: bookingIds }, type: "booked" },
        select: {
          bookingId: true,
          value: true,
          sourceCampaignId: true,
          sourceAdId: true,
          occurredAt: true,
        },
      }),
    ]);

    const bookingById = new Map(bookings.map((b) => [b.id, b]));
    const conversionByBookingId = new Map(
      conversions
        .filter((c): c is typeof c & { bookingId: string } => typeof c.bookingId === "string")
        .map((c) => [c.bookingId, c]),
    );

    const rows: BookingOutcomeLedgerRow[] = [];
    for (const t of traces) {
      const bookingId = t.linkedOutcomeId;
      if (!bookingId) continue;
      const booking = bookingById.get(bookingId);
      if (!booking) continue; // booking absent in this org — skip (honest)
      const conv = conversionByBookingId.get(bookingId) ?? null;
      rows.push({
        traceId: t.id,
        deploymentId: t.deploymentId,
        skillSlug: t.skillSlug,
        outcome: "booked",
        bookingId,
        contactId: booking.contactId,
        service: booking.service,
        bookingStatus: booking.status,
        bookedAt: booking.startsAt,
        value: conv?.value ?? null,
        sourceCampaignId: conv?.sourceCampaignId ?? null,
        sourceAdId: conv?.sourceAdId ?? null,
        occurredAt: conv?.occurredAt ?? null,
      });
    }
    return rows;
  }
}
```

- [ ] **Step 4: Export the store and row type from the db index.**

In `packages/db/src/index.ts`, add near the other store exports (for example after the `PrismaExecutionTraceStore` export, or in the store-export block around line 73):

```ts
export {
  PrismaBookingOutcomeLedgerStore,
  type BookingOutcomeLedgerRow,
} from "./stores/prisma-booking-outcome-ledger-store.js";
```

- [ ] **Step 5: Run the test to verify it passes.**

Run: `pnpm --filter @switchboard/db test -- prisma-booking-outcome-ledger-store`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit.**

```bash
git add packages/db/src/stores/prisma-booking-outcome-ledger-store.ts packages/db/src/stores/__tests__/prisma-booking-outcome-ledger-store.test.ts packages/db/src/index.ts
git commit -m "feat(db): booking-outcome ledger joining work trace, booking, and revenue (F5)"
```

---

## Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Typecheck the whole repo.**

Run: `pnpm typecheck`
Expected: PASS, no new errors. (If it reports missing exports from `@switchboard/core` or `@switchboard/db`, run `pnpm reset` first per CLAUDE.md, then re-run.)

- [ ] **Step 2: Run the affected package tests.**

Run: `pnpm --filter @switchboard/core test` and `pnpm --filter @switchboard/db test`
Expected: PASS. (Roughly 9 db `pg_advisory_xact_lock` integration tests fail locally without Postgres; that is environmental, not a regression.)

- [ ] **Step 3: Lint and format check.**

Run: `pnpm lint` and `pnpm format:check`
Expected: PASS. (`format:check` is in CI lint but not local lint; run it before pushing.)

- [ ] **Step 4: Confirm no migration drift was introduced.**

Run: `git status --short` and confirm no files under `packages/db/prisma/migrations/` changed and `schema.prisma` is untouched.
Expected: only the source/test files from Tasks 1 to 4 are modified.

---

## Self-review notes

- **Spec coverage:** D1 (typed `linkedOutcome` = Task 1), D2 (energize via TracePersistenceHook = Task 2), D3 (idempotent single create = Tasks 2 to 3), D4 (ledger join = Task 4), D5 (skillSlug attribution = Task 4 row), D6 (no migration = Task 5 step 4), D7 (defer = documented in spec, no task).
- **Type consistency:** `LinkedOutcome` / `LinkedOutcomeType` defined in Task 1 and reused in Tasks 2 (hook) and the trace field; `BookingOutcomeLedgerRow` defined in Task 4 and asserted verbatim in its test; `deriveLinkedOutcome(toolCalls, traceId)` signature is identical across all call sites.
- **No placeholders:** every code step shows complete code; commands include expected output.
