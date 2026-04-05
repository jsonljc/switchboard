import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaEnvelopeStore } from "../prisma-envelope-store.js";

function createMockPrisma() {
  return {
    actionEnvelope: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test data construction helper
function createTestEnvelope(overrides: Record<string, any> = {}) {
  return {
    id: "env_test_1",
    version: 1,
    incomingMessage: null,
    conversationId: "conv_1",
    proposals: [
      {
        id: "prop_1",
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "123", _organizationId: "org_1" },
        evidence: "test",
        confidence: 0.9,
        originatingMessageId: "",
      },
    ],
    resolvedEntities: [],
    plan: null,
    decisions: [],
    approvalRequests: [],
    executionResults: [],
    auditEntryIds: [],
    status: "proposed",
    parentEnvelopeId: null,
    traceId: null,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

describe("PrismaEnvelopeStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaEnvelopeStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock Prisma client for testing
    store = new PrismaEnvelopeStore(prisma as any);
  });

  it("saves an envelope via upsert", async () => {
    const envelope = createTestEnvelope();
    prisma.actionEnvelope.upsert.mockResolvedValue(envelope);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test data matches interface
    await store.save(envelope as any);

    expect(prisma.actionEnvelope.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "env_test_1" },
        create: expect.objectContaining({ id: "env_test_1", organizationId: "org_1" }),
        update: expect.objectContaining({ version: 1 }),
      }),
    );
  });

  it("returns null for non-existent envelope", async () => {
    prisma.actionEnvelope.findUnique.mockResolvedValue(null);

    const result = await store.getById("nonexistent");
    expect(result).toBeNull();
  });

  it("retrieves an envelope by id", async () => {
    const row = createTestEnvelope();
    prisma.actionEnvelope.findUnique.mockResolvedValue(row);

    const result = await store.getById("env_test_1");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("env_test_1");
    expect(result!.status).toBe("proposed");
  });

  it("updates envelope status", async () => {
    prisma.actionEnvelope.update.mockResolvedValue({});

    await store.update("env_test_1", { status: "executed" });

    expect(prisma.actionEnvelope.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "env_test_1" },
        data: expect.objectContaining({ status: "executed" }),
      }),
    );
  });

  it("lists envelopes with filters", async () => {
    const envelopes = [createTestEnvelope(), createTestEnvelope({ id: "env_test_2" })];
    prisma.actionEnvelope.findMany.mockResolvedValue(envelopes);

    const result = await store.list({ status: "proposed", limit: 10 });
    expect(result).toHaveLength(2);
    expect(prisma.actionEnvelope.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "proposed" },
        take: 10,
        orderBy: { createdAt: "desc" },
      }),
    );
  });

  it("filters by conversationId via proposals", async () => {
    const envelopes = [createTestEnvelope()];
    prisma.actionEnvelope.findMany.mockResolvedValue(envelopes);

    const result = await store.list({ organizationId: "org_1" });
    expect(result).toHaveLength(1);
  });
});
