import { describe, expect, it, vi, beforeEach } from "vitest";
import { PrismaRecommendationStore } from "../recommendation-store.js";
import type { PersistRecommendationInput } from "@switchboard/core";
import { RecommendationStaleStatusError } from "@switchboard/core";

function mockPrisma() {
  return {
    pendingActionRecord: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    auditEntry: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  } as unknown as import("@prisma/client").PrismaClient;
}

const FIXED_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

const baseInsert = (
  overrides: Partial<PersistRecommendationInput> = {},
): PersistRecommendationInput => ({
  orgId: "org-1",
  agentKey: "alex",
  intent: "recommendation.ad_set_pause",
  action: "pause",
  humanSummary: "Pause it",
  confidence: 0.9,
  dollarsAtRisk: 10,
  riskLevel: "low",
  parameters: {
    __recommendation: {
      action: "pause",
      presentation: {
        primaryLabel: "Pause",
        secondaryLabel: "Reduce 50%",
        dismissLabel: "Dismiss",
        dataLines: [],
      },
    },
  },
  targetEntities: undefined,
  sourceWorkflow: undefined,
  surface: "shadow_action",
  idempotencyKey: "test-key-1",
  undoableUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  ...overrides,
});

function makeDbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: FIXED_UUID,
    organizationId: "org-1",
    sourceAgent: "alex",
    intent: "recommendation.ad_set_pause",
    humanSummary: "Pause it",
    confidence: 0.9,
    dollarsAtRisk: 10,
    riskLevel: "low",
    surface: "shadow_action",
    status: "pending",
    parameters: {
      __recommendation: {
        action: "pause",
        presentation: {
          primaryLabel: "Pause",
          secondaryLabel: "Reduce 50%",
          dismissLabel: "Dismiss",
          dataLines: [],
        },
      },
    },
    targetEntities: {},
    sourceWorkflow: null,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    undoableUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

describe("PrismaRecommendationStore", () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let store: PrismaRecommendationStore;

  beforeEach(() => {
    prisma = mockPrisma();
    store = new PrismaRecommendationStore(prisma);
  });

  it("inserts and reads a row, reconstructing action from parameters.__recommendation", async () => {
    const row = makeDbRow();
    (prisma.pendingActionRecord.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce(row);
    const inserted = await store.insert(baseInsert());

    expect(inserted.idempotent).toBe(false);
    expect(inserted.row.surface).toBe("shadow_action");
    expect(inserted.row.action).toBe("pause");

    // Verify create was called with the __recommendation.action present in parameters
    const createCall = (prisma.pendingActionRecord.create as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    expect((createCall.data.parameters as Record<string, unknown>).__recommendation).toMatchObject({
      action: "pause",
    });

    // getById should read action from parameters.__recommendation
    (prisma.pendingActionRecord.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(row);
    const fetched = await store.getById(row.id);
    expect(fetched?.id).toBe(row.id);
    expect(fetched?.action).toBe("pause");
  });

  it("idempotency key collision returns existing row", async () => {
    const existingRow = makeDbRow({ humanSummary: "Pause it" });
    // First insert succeeds
    (prisma.pendingActionRecord.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      existingRow,
    );
    const first = await store.insert(baseInsert({ idempotencyKey: "test-key-2" }));

    // Second insert throws P2002 (unique constraint), then findUnique returns existing
    (prisma.pendingActionRecord.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce({
      code: "P2002",
      message: "Unique constraint failed on the fields: (`idempotencyKey`)",
    });
    (prisma.pendingActionRecord.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      existingRow,
    );
    const second = await store.insert(
      baseInsert({ idempotencyKey: "test-key-2", humanSummary: "different" }),
    );

    expect(second.idempotent).toBe(true);
    expect(second.row.id).toBe(first.row.id);
    expect(second.row.humanSummary).toBe("Pause it"); // first write wins
  });

  it("listBySurface filters by intent.startsWith('recommendation.')", async () => {
    const recRow = makeDbRow({ surface: "queue", humanSummary: "rec row" });
    (prisma.pendingActionRecord.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      recRow,
    ]);

    const rows = await store.listBySurface({ orgId: "org-1", surface: "queue" });

    // Assert findMany was called with intent.startsWith filter
    const findManyCall = (prisma.pendingActionRecord.findMany as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    expect(findManyCall.where.intent).toMatchObject({ startsWith: "recommendation." });

    // Results should all have recommendation. intents
    expect(rows.every((r) => r.intent.startsWith("recommendation."))).toBe(true);
    expect(rows.some((r) => r.humanSummary === "rec row")).toBe(true);
  });

  it("applyAct updates row and writes AuditEntry atomically with a unique entryHash", async () => {
    const row = makeDbRow({
      id: "aaaaaaaa-0000-0000-0000-000000000001",
      surface: "queue",
      undoableUntil: null,
      humanSummary: "Pause it",
      status: "pending",
    });

    // $transaction calls the callback with prisma itself as the tx
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) => callback(prisma),
    );

    (prisma.pendingActionRecord.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(row);
    const updatedRow = {
      ...row,
      status: "acted",
      resolvedBy: "user-1",
      resolvedAt: new Date(),
      parameters: { __recommendation: { action: "pause", note: "noted" } },
    };
    (prisma.pendingActionRecord.update as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      updatedRow,
    );
    (prisma.auditEntry.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: "audit-1" });

    const result = await store.applyAct({
      id: row.id,
      actor: { principalId: "user-1", type: "operator" },
      fromStatus: "pending",
      toStatus: "acted",
      note: "noted",
    });

    expect(result.status).toBe("acted");
    expect(result.actedBy).toBe("user-1");
    expect(result.note).toBe("noted");

    // Assert update was called with where: { id, status: fromStatus }
    const updateCall = (prisma.pendingActionRecord.update as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    expect(updateCall.where).toMatchObject({ id: row.id, status: "pending" });

    // Assert auditEntry.create was called with a valid sha256 entryHash
    const auditCall = (prisma.auditEntry.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(auditCall.data.entryHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("two acts on different rows produce different entryHashes", async () => {
    const rowA = makeDbRow({
      id: "aaaaaaaa-0000-0000-0000-000000000001",
      surface: "queue",
      undoableUntil: null,
      status: "pending",
    });
    const rowB = makeDbRow({
      id: "bbbbbbbb-0000-0000-0000-000000000002",
      surface: "queue",
      undoableUntil: null,
      status: "pending",
    });

    const capturedHashes: string[] = [];

    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) => callback(prisma),
    );

    // First applyAct on rowA
    (prisma.pendingActionRecord.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(rowA);
    (prisma.pendingActionRecord.update as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...rowA,
      status: "acted",
      resolvedBy: "u",
      resolvedAt: new Date(),
    });
    (prisma.auditEntry.create as ReturnType<typeof vi.fn>).mockImplementationOnce(
      ({ data }: { data: { entryHash: string } }) => {
        capturedHashes.push(data.entryHash);
        return Promise.resolve({ id: "audit-1" });
      },
    );

    await store.applyAct({
      id: rowA.id,
      actor: { principalId: "u", type: "operator" },
      fromStatus: "pending",
      toStatus: "acted",
      note: undefined,
    });

    // Second applyAct on rowB
    (prisma.pendingActionRecord.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(rowB);
    (prisma.pendingActionRecord.update as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...rowB,
      status: "dismissed",
      resolvedBy: "u",
      resolvedAt: new Date(),
    });
    (prisma.auditEntry.create as ReturnType<typeof vi.fn>).mockImplementationOnce(
      ({ data }: { data: { entryHash: string } }) => {
        capturedHashes.push(data.entryHash);
        return Promise.resolve({ id: "audit-2" });
      },
    );

    await store.applyAct({
      id: rowB.id,
      actor: { principalId: "u", type: "operator" },
      fromStatus: "pending",
      toStatus: "dismissed",
      note: undefined,
    });

    expect(capturedHashes).toHaveLength(2);
    expect(capturedHashes[0]).not.toBe(capturedHashes[1]);
  });

  it("applyAct stale fromStatus throws RecommendationStaleStatusError", async () => {
    const row = makeDbRow({
      id: "cccccccc-0000-0000-0000-000000000003",
      surface: "queue",
      undoableUntil: null,
      status: "acted",
    });

    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) => callback(prisma),
    );

    // findUnique for the initial lookup (before update attempt)
    (prisma.pendingActionRecord.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(row);
    // update throws P2025 (record not found with that status)
    (prisma.pendingActionRecord.update as ReturnType<typeof vi.fn>).mockRejectedValueOnce({
      code: "P2025",
      message: "Record to update not found.",
    });
    // findUnique for the stale re-read
    (prisma.pendingActionRecord.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(row);

    await expect(
      store.applyAct({
        id: row.id,
        actor: { principalId: "user-B", type: "operator" },
        fromStatus: "pending",
        toStatus: "dismissed",
        note: undefined,
      }),
    ).rejects.toThrow(RecommendationStaleStatusError);
  });

  describe("listResolvedForAgent", () => {
    it("filters by org, sourceAgent, status set, and non-null resolvedAt >= resolvedSince", async () => {
      (prisma.pendingActionRecord.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      await store.listResolvedForAgent({
        orgId: "org-1",
        agentKey: "alex",
        statuses: ["acted", "confirmed"],
        resolvedSince: new Date("2026-05-07T00:00:00.000Z"),
        limit: 6,
      });
      expect(prisma.pendingActionRecord.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          organizationId: "org-1",
          sourceAgent: "alex",
          status: { in: ["acted", "confirmed"] },
          resolvedAt: { not: null, gte: new Date("2026-05-07T00:00:00.000Z") },
          intent: { startsWith: "recommendation." },
        }),
        orderBy: { resolvedAt: "desc" },
        take: 6,
      });
    });

    it("caps limit at 200", async () => {
      (prisma.pendingActionRecord.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      await store.listResolvedForAgent({
        orgId: "org-1",
        agentKey: "riley",
        statuses: ["acted"],
        resolvedSince: new Date(),
        limit: 9999,
      });
      expect(prisma.pendingActionRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 200 }),
      );
    });

    it("returns mapped Recommendation rows", async () => {
      const resolvedDate = new Date("2026-05-07T06:55:00.000Z");
      (prisma.pendingActionRecord.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        makeDbRow({
          id: "r1",
          sourceAgent: "alex",
          organizationId: "org-1",
          status: "confirmed",
          resolvedAt: resolvedDate,
          resolvedBy: "user-1",
          humanSummary: "Sent tour invite to Maya",
          confidence: 0.7,
          riskLevel: "low",
          dollarsAtRisk: 0,
          surface: "queue",
          undoableUntil: new Date("2026-05-07T07:00:00.000Z"),
        }),
      ]);
      const rows = await store.listResolvedForAgent({
        orgId: "org-1",
        agentKey: "alex",
        statuses: ["acted", "confirmed"],
        resolvedSince: new Date(0),
        limit: 5,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe("r1");
      expect(rows[0]!.agentKey).toBe("alex");
      expect(rows[0]!.status).toBe("confirmed");
    });
  });
});
