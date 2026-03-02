import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaApprovalStore } from "../prisma-approval-store.js";
import { StaleVersionError } from "@switchboard/core";

function createMockPrisma() {
  return {
    approvalRecord: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

const TEST_REQUEST = {
  id: "apr_1",
  envelopeId: "env_1",
  actionType: "ad.create",
  riskCategory: "medium" as const,
  summary: "Create ad campaign",
  requiredApprovers: ["user_1"],
  quorum: null,
};

const TEST_STATE = {
  status: "pending" as const,
  respondedBy: null,
  respondedAt: null,
  patchValue: null,
  expiresAt: new Date("2025-12-31"),
  quorum: null,
  version: 1,
};

const TEST_DB_ROW = {
  id: "apr_1",
  envelopeId: "env_1",
  organizationId: "org_1",
  request: TEST_REQUEST,
  status: "pending",
  respondedBy: null,
  respondedAt: null,
  patchValue: null,
  expiresAt: new Date("2025-12-31"),
  version: 1,
};

describe("PrismaApprovalStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaApprovalStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaApprovalStore(prisma as any);
  });

  describe("save", () => {
    it("creates an approval record", async () => {
      prisma.approvalRecord.create.mockResolvedValue({});

      await store.save({
        request: TEST_REQUEST,
        state: TEST_STATE,
        envelopeId: "env_1",
        organizationId: "org_1",
      });

      expect(prisma.approvalRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: "apr_1",
          envelopeId: "env_1",
          organizationId: "org_1",
          request: TEST_REQUEST,
          status: "pending",
          respondedBy: null,
          respondedAt: null,
          expiresAt: TEST_STATE.expiresAt,
          version: 1,
        }),
      });
    });
  });

  describe("getById", () => {
    it("returns mapped object when found", async () => {
      prisma.approvalRecord.findUnique.mockResolvedValue(TEST_DB_ROW);

      const result = await store.getById("apr_1");
      expect(result).not.toBeNull();
      expect(result!.request.id).toBe("apr_1");
      expect(result!.state.status).toBe("pending");
      expect(result!.envelopeId).toBe("env_1");
      expect(result!.organizationId).toBe("org_1");
      expect(prisma.approvalRecord.findUnique).toHaveBeenCalledWith({ where: { id: "apr_1" } });
    });

    it("returns null when not found", async () => {
      prisma.approvalRecord.findUnique.mockResolvedValue(null);

      const result = await store.getById("apr_missing");
      expect(result).toBeNull();
    });
  });

  describe("updateState", () => {
    const updatedState = {
      status: "approved" as const,
      respondedBy: "user_1",
      respondedAt: new Date("2025-06-01"),
      patchValue: null,
      expiresAt: new Date("2025-12-31"),
      quorum: null,
      version: 2,
    };

    it("uses update when no expectedVersion provided", async () => {
      prisma.approvalRecord.update.mockResolvedValue({});

      await store.updateState("apr_1", updatedState);

      expect(prisma.approvalRecord.update).toHaveBeenCalledWith({
        where: { id: "apr_1" },
        data: expect.objectContaining({
          status: "approved",
          respondedBy: "user_1",
          version: 2,
        }),
      });
      expect(prisma.approvalRecord.updateMany).not.toHaveBeenCalled();
    });

    it("succeeds with optimistic concurrency when version matches (count=1)", async () => {
      prisma.approvalRecord.updateMany.mockResolvedValue({ count: 1 });

      await store.updateState("apr_1", updatedState, 1);

      expect(prisma.approvalRecord.updateMany).toHaveBeenCalledWith({
        where: { id: "apr_1", version: 1 },
        data: expect.objectContaining({
          status: "approved",
          version: 2,
        }),
      });
    });

    it("throws StaleVersionError when count=0", async () => {
      prisma.approvalRecord.updateMany.mockResolvedValue({ count: 0 });

      await expect(store.updateState("apr_1", updatedState, 1)).rejects.toThrow(StaleVersionError);
    });
  });

  describe("listPending", () => {
    it("lists pending records without orgId filter", async () => {
      prisma.approvalRecord.findMany.mockResolvedValue([TEST_DB_ROW]);

      const result = await store.listPending();
      expect(result).toHaveLength(1);
      expect(result[0].request.id).toBe("apr_1");
      expect(prisma.approvalRecord.findMany).toHaveBeenCalledWith({
        where: { status: "pending" },
      });
    });

    it("lists pending records with orgId filter", async () => {
      prisma.approvalRecord.findMany.mockResolvedValue([TEST_DB_ROW]);

      const result = await store.listPending("org_1");
      expect(result).toHaveLength(1);
      expect(prisma.approvalRecord.findMany).toHaveBeenCalledWith({
        where: { status: "pending", organizationId: "org_1" },
      });
    });
  });
});
