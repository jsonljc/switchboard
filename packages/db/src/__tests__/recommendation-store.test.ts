import { describe, expect, it, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaRecommendationStore } from "../recommendation-store.js";
import type { PersistRecommendationInput } from "@switchboard/core";

const prisma = new PrismaClient();

async function clean() {
  await prisma.auditEntry.deleteMany({ where: { eventType: "recommendation.act" } });
  await prisma.pendingActionRecord.deleteMany({
    where: { intent: { startsWith: "recommendation." } },
  });
  // Clean up non-recommendation rows inserted by the listBySurface test.
  await prisma.pendingActionRecord.deleteMany({ where: { idempotencyKey: "workflow-key-1" } });
}

const baseInsert = (
  overrides: Partial<PersistRecommendationInput> = {},
): PersistRecommendationInput => ({
  orgId: "org-1",
  agentKey: "nova",
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

describe("PrismaRecommendationStore", () => {
  beforeEach(clean);

  it("inserts and reads a row, reconstructing action from parameters.__recommendation", async () => {
    const store = new PrismaRecommendationStore(prisma);
    const inserted = await store.insert(baseInsert());
    expect(inserted.idempotent).toBe(false);
    expect(inserted.row.surface).toBe("shadow_action");
    expect(inserted.row.action).toBe("pause");
    const fetched = await store.getById(inserted.row.id);
    expect(fetched?.id).toBe(inserted.row.id);
    expect(fetched?.action).toBe("pause");
  });

  it("idempotency key collision returns existing row", async () => {
    const store = new PrismaRecommendationStore(prisma);
    const first = await store.insert(baseInsert({ idempotencyKey: "test-key-2" }));
    const second = await store.insert(
      baseInsert({ idempotencyKey: "test-key-2", humanSummary: "different" }),
    );
    expect(second.idempotent).toBe(true);
    expect(second.row.id).toBe(first.row.id);
    expect(second.row.humanSummary).toBe("Pause it"); // first write wins
  });

  it("listBySurface filters out non-recommendation rows", async () => {
    // Insert a non-recommendation pending action.
    await prisma.pendingActionRecord.create({
      data: {
        idempotencyKey: "workflow-key-1",
        status: "pending",
        intent: "workflow.do_something",
        targetEntities: {},
        parameters: {},
        humanSummary: "workflow row",
        confidence: 1.0,
        riskLevel: "low",
        approvalRequired: "none",
        sourceAgent: "system",
        organizationId: "org-1",
      },
    });
    const store = new PrismaRecommendationStore(prisma);
    await store.insert(
      baseInsert({
        surface: "queue",
        undoableUntil: null,
        idempotencyKey: "rec-key-3",
        humanSummary: "rec row",
      }),
    );
    const rows = await store.listBySurface({ orgId: "org-1", surface: "queue" });
    expect(rows.every((r) => r.intent.startsWith("recommendation."))).toBe(true);
    expect(rows.some((r) => r.humanSummary === "rec row")).toBe(true);
    expect(rows.some((r) => r.humanSummary === "workflow row")).toBe(false);
  });

  it("applyAct updates row and writes AuditEntry atomically with a unique entryHash", async () => {
    const store = new PrismaRecommendationStore(prisma);
    const { row } = await store.insert(
      baseInsert({
        surface: "queue",
        undoableUntil: null,
        idempotencyKey: "rec-key-4",
      }),
    );
    const updated = await store.applyAct({
      id: row.id,
      actor: { principalId: "user-1", type: "operator" },
      fromStatus: "pending",
      toStatus: "acted",
      note: "noted",
    });
    expect(updated.status).toBe("acted");
    expect(updated.actedBy).toBe("user-1");
    expect(updated.note).toBe("noted");
    const audits = await prisma.auditEntry.findMany({
      where: { entityId: row.id, eventType: "recommendation.act" },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.summary).toBe("Pause it");
    expect(audits[0]?.entryHash).toMatch(/^[0-9a-f]{64}$/); // proper sha256
    expect(audits[0]?.entryHash).not.toBe("v1-no-chain");
  });

  it("applyAct rejects stale fromStatus and reads back current row", async () => {
    const store = new PrismaRecommendationStore(prisma);
    const { row } = await store.insert(
      baseInsert({ surface: "queue", undoableUntil: null, idempotencyKey: "race-key-1" }),
    );
    // Simulate another writer transitioning the row first
    await store.applyAct({
      id: row.id,
      actor: { principalId: "user-A", type: "operator" },
      fromStatus: "pending",
      toStatus: "acted",
      note: undefined,
    });
    // Now a "stale" act with fromStatus: "pending" should throw RecommendationStaleStatusError
    await expect(
      store.applyAct({
        id: row.id,
        actor: { principalId: "user-B", type: "operator" },
        fromStatus: "pending",
        toStatus: "dismissed",
        note: undefined,
      }),
    ).rejects.toThrow(/stale|status changed/i);
  });

  it("two acts on different rows produce different entryHashes", async () => {
    const store = new PrismaRecommendationStore(prisma);
    const a = await store.insert(
      baseInsert({ surface: "queue", undoableUntil: null, idempotencyKey: "rec-key-5a" }),
    );
    const b = await store.insert(
      baseInsert({ surface: "queue", undoableUntil: null, idempotencyKey: "rec-key-5b" }),
    );
    await store.applyAct({
      id: a.row.id,
      actor: { principalId: "u", type: "operator" },
      fromStatus: "pending",
      toStatus: "acted",
      note: undefined,
    });
    await store.applyAct({
      id: b.row.id,
      actor: { principalId: "u", type: "operator" },
      fromStatus: "pending",
      toStatus: "dismissed",
      note: undefined,
    });
    const audits = await prisma.auditEntry.findMany({
      where: { eventType: "recommendation.act" },
      orderBy: { createdAt: "asc" },
    });
    expect(audits).toHaveLength(2);
    expect(audits[0]?.entryHash).not.toBe(audits[1]?.entryHash);
  });
});
