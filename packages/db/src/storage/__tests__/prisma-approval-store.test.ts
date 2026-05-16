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

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Partial test data for approval request
const TEST_REQUEST: any = {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock Prisma client for testing
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

    it("succeeds with optimistic concurrency when version matches (count=1)", async () => {
      prisma.approvalRecord.updateMany.mockResolvedValue({ count: 1 });

      await store.updateState("apr_1", updatedState, 1, "org_1");

      expect(prisma.approvalRecord.updateMany).toHaveBeenCalledWith({
        where: { id: "apr_1", version: 1, organizationId: "org_1" },
        data: expect.objectContaining({
          status: "approved",
          version: 2,
        }),
      });
    });

    it("throws StaleVersionError when count=0", async () => {
      prisma.approvalRecord.updateMany.mockResolvedValue({ count: 0 });

      await expect(store.updateState("apr_1", updatedState, 1, "org_1")).rejects.toThrow(
        StaleVersionError,
      );
    });

    // TI-7 regression — cross-tenant isolation on optimistic updateMany WHERE.
    // Audit: docs/audits/2026-05-15-cleanup/security-sweep-delta.md (TI-7 STILL-OPEN).
    it("scopes optimistic updateMany WHERE by organizationId (TI-7)", async () => {
      prisma.approvalRecord.updateMany.mockResolvedValue({ count: 1 });

      await store.updateState("apr_1", updatedState, 1, "org_1");

      const callArgs = prisma.approvalRecord.updateMany.mock.calls[0]![0];
      expect(callArgs.where).toEqual({
        id: "apr_1",
        version: 1,
        organizationId: "org_1",
      });
    });

    it("scopes optimistic updateMany WHERE by organizationId=null when caller passes null", async () => {
      prisma.approvalRecord.updateMany.mockResolvedValue({ count: 1 });

      await store.updateState("apr_1", updatedState, 1, null);

      const callArgs = prisma.approvalRecord.updateMany.mock.calls[0]![0];
      expect(callArgs.where).toEqual({
        id: "apr_1",
        version: 1,
        organizationId: null,
      });
    });
  });

  describe("listPending", () => {
    it("lists pending records without orgId filter", async () => {
      prisma.approvalRecord.findMany.mockResolvedValue([TEST_DB_ROW]);

      const result = await store.listPending();
      expect(result).toHaveLength(1);
      expect(result[0]!.request.id).toBe("apr_1");
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

  describe("payload round-trip (A.7c-followup)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Partial test data
    const REQUEST_WITH_PAYLOAD: any = {
      ...TEST_REQUEST,
      payload: {
        kind: "regulatory",
        body: "Patient asked about FDA approval status.",
        quote: "Our laser is FDA approved.",
        quoteFrom: "Alex (draft)",
      },
    };

    it("persists request.payload via Json column on save", async () => {
      prisma.approvalRecord.create.mockResolvedValue({});

      await store.save({
        request: REQUEST_WITH_PAYLOAD,
        state: TEST_STATE,
        envelopeId: "env_1",
        organizationId: "org_1",
      });

      // Prisma persists the entire `request` shape as Json — payload survives
      // unchanged. No top-level Approval.payload column is needed.
      const callArgs = prisma.approvalRecord.create.mock.calls[0]![0];
      expect(callArgs.data.request).toBe(REQUEST_WITH_PAYLOAD);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Asserting shape
      expect((callArgs.data.request as any).payload.kind).toBe("regulatory");
    });

    it("returns request.payload on getById when present", async () => {
      prisma.approvalRecord.findUnique.mockResolvedValue({
        ...TEST_DB_ROW,
        request: REQUEST_WITH_PAYLOAD,
      });

      const result = await store.getById("apr_1");
      expect(result?.request.payload?.kind).toBe("regulatory");
      expect(result?.request.payload?.body).toBe("Patient asked about FDA approval status.");
    });

    it("returns request.payload on listPending when present", async () => {
      prisma.approvalRecord.findMany.mockResolvedValue([
        { ...TEST_DB_ROW, request: REQUEST_WITH_PAYLOAD },
      ]);

      const result = await store.listPending();
      expect(result[0]!.request.payload?.kind).toBe("regulatory");
    });

    it("returns undefined payload on listPending for legacy approvals", async () => {
      prisma.approvalRecord.findMany.mockResolvedValue([TEST_DB_ROW]);

      const result = await store.listPending();
      expect(result[0]!.request.payload).toBeUndefined();
    });
  });
});
