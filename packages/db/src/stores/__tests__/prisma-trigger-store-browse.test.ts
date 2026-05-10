import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaTriggerStore } from "../prisma-trigger-store.js";

const now = new Date("2026-05-09T12:00:00Z");

function makeMockPrisma() {
  return {
    scheduledTriggerRecord: {
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]),
    },
  };
}

function makeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "t-1",
    organizationId: "org-A",
    type: "cron",
    fireAt: null,
    cronExpression: "0 7 * * *",
    eventPattern: null,
    action: { type: "spawn_workflow", payload: {} },
    sourceWorkflowId: null,
    status: "active",
    createdAt: now,
    expiresAt: null,
    ...overrides,
  };
}

describe("PrismaTriggerStore.listForBrowse — call shape", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let store: PrismaTriggerStore;

  beforeEach(() => {
    prisma = makeMockPrisma();
    store = new PrismaTriggerStore(prisma as never);
  });

  const baseQuery = {
    orgId: "org-A",
    sort: "createdAt" as const,
    direction: "desc" as const,
    limit: 50,
  };

  it("scopes findMany to organizationId", async () => {
    await store.listForBrowse(baseQuery);
    const call = prisma.scheduledTriggerRecord.findMany.mock.calls[0]![0]!;
    expect(call.where.organizationId).toBe("org-A");
  });

  it("applies status filter when provided", async () => {
    await store.listForBrowse({ ...baseQuery, status: "fired" });
    const call = prisma.scheduledTriggerRecord.findMany.mock.calls[0]![0]!;
    expect(call.where.status).toBe("fired");
  });

  it("omits status from where when not provided", async () => {
    await store.listForBrowse(baseQuery);
    const call = prisma.scheduledTriggerRecord.findMany.mock.calls[0]![0]!;
    expect(call.where.status).toBeUndefined();
  });

  it("uses (createdAt, id) keyset for cursor (desc => lt + tied lt-id tiebreak)", async () => {
    const cursorTs = new Date("2026-05-01T00:00:00Z");
    await store.listForBrowse({
      ...baseQuery,
      cursor: { ts: cursorTs, id: "t-7" },
    });
    const call = prisma.scheduledTriggerRecord.findMany.mock.calls[0]![0]!;
    expect(call.where.OR).toEqual([
      { createdAt: { lt: cursorTs } },
      { createdAt: cursorTs, id: { lt: "t-7" } },
    ]);
  });

  it("uses gt for asc direction", async () => {
    const cursorTs = new Date("2026-05-01T00:00:00Z");
    await store.listForBrowse({
      ...baseQuery,
      direction: "asc",
      cursor: { ts: cursorTs, id: "t-7" },
    });
    const call = prisma.scheduledTriggerRecord.findMany.mock.calls[0]![0]!;
    expect(call.where.OR).toEqual([
      { createdAt: { gt: cursorTs } },
      { createdAt: cursorTs, id: { gt: "t-7" } },
    ]);
  });

  it("orders by (createdAt, id) tuple matching the direction", async () => {
    await store.listForBrowse(baseQuery);
    const call = prisma.scheduledTriggerRecord.findMany.mock.calls[0]![0]!;
    expect(call.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
  });

  it("orders ascending when direction is asc", async () => {
    await store.listForBrowse({ ...baseQuery, direction: "asc" });
    const call = prisma.scheduledTriggerRecord.findMany.mock.calls[0]![0]!;
    expect(call.orderBy).toEqual([{ createdAt: "asc" }, { id: "asc" }]);
  });

  it("fetches limit+1 rows so the projector can detect hasMore", async () => {
    await store.listForBrowse({ ...baseQuery, limit: 50 });
    const call = prisma.scheduledTriggerRecord.findMany.mock.calls[0]![0]!;
    expect(call.take).toBe(51);
  });

  it("groupBy is org-scoped only — not narrowed by status filter (chip counts span the org)", async () => {
    await store.listForBrowse({ ...baseQuery, status: "active" });
    expect(prisma.scheduledTriggerRecord.groupBy).toHaveBeenCalledWith({
      by: ["status"],
      where: { organizationId: "org-A" },
      _count: { _all: true },
    });
  });

  it("aggregates groupBy results into TriggerStatusCounts shape", async () => {
    prisma.scheduledTriggerRecord.findMany.mockResolvedValue([]);
    prisma.scheduledTriggerRecord.groupBy.mockResolvedValue([
      { status: "active", _count: { _all: 5 } },
      { status: "fired", _count: { _all: 3 } },
      { status: "cancelled", _count: { _all: 1 } },
      { status: "expired", _count: { _all: 2 } },
    ]);
    const result = await store.listForBrowse(baseQuery);
    expect(result.statusCounts).toEqual({
      all: 11,
      active: 5,
      fired: 3,
      cancelled: 1,
      expired: 2,
    });
  });

  it("zeroes missing status buckets and treats no rows as all-zero counts", async () => {
    const result = await store.listForBrowse(baseQuery);
    expect(result.statusCounts).toEqual({
      all: 0,
      active: 0,
      fired: 0,
      cancelled: 0,
      expired: 0,
    });
  });

  it("returns rows mapped through toScheduledTrigger (Date types preserved)", async () => {
    const rec = makeRecord({ id: "t-x", createdAt: now, fireAt: now });
    prisma.scheduledTriggerRecord.findMany.mockResolvedValue([rec]);
    const result = await store.listForBrowse(baseQuery);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.id).toBe("t-x");
    expect(result.rows[0]!.createdAt).toBeInstanceOf(Date);
    expect(result.rows[0]!.fireAt).toBeInstanceOf(Date);
  });
});
