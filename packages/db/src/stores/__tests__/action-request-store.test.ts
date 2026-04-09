import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaActionRequestStore } from "../prisma-action-request-store.js";

function createMockPrisma() {
  return {
    actionRequest: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
  };
}

describe("PrismaActionRequestStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaActionRequestStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaActionRequestStore(prisma as never);
  });

  describe("create", () => {
    it("creates an action request", async () => {
      const input = {
        deploymentId: "dep_1",
        type: "send_message",
        surface: "telegram",
        payload: { content: "Hello" },
      };
      const expected = {
        id: "ar_1",
        ...input,
        status: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.actionRequest.create.mockResolvedValue(expected);

      const result = await store.create(input);

      expect(result).toEqual(expected);
      expect(prisma.actionRequest.create).toHaveBeenCalledWith({
        data: input,
      });
    });
  });

  describe("findById", () => {
    it("finds an action request by id", async () => {
      const expected = {
        id: "ar_1",
        deploymentId: "dep_1",
        type: "send_message",
        status: "pending",
      };
      prisma.actionRequest.findUnique.mockResolvedValue(expected);

      const result = await store.findById("ar_1");

      expect(result).toEqual(expected);
      expect(prisma.actionRequest.findUnique).toHaveBeenCalledWith({
        where: { id: "ar_1" },
      });
    });

    it("returns null when not found", async () => {
      prisma.actionRequest.findUnique.mockResolvedValue(null);

      const result = await store.findById("ar_999");

      expect(result).toBeNull();
    });
  });

  describe("listByDeployment", () => {
    it("lists all action requests for deployment", async () => {
      const mockRequests = [
        { id: "ar_1", deploymentId: "dep_1", status: "pending" },
        { id: "ar_2", deploymentId: "dep_1", status: "approved" },
      ];
      prisma.actionRequest.findMany.mockResolvedValue(mockRequests);

      const result = await store.listByDeployment("dep_1");

      expect(result).toEqual(mockRequests);
      expect(prisma.actionRequest.findMany).toHaveBeenCalledWith({
        where: { deploymentId: "dep_1" },
        orderBy: { createdAt: "asc" },
      });
    });

    it("lists pending by deployment", async () => {
      prisma.actionRequest.findMany.mockResolvedValue([]);

      await store.listByDeployment("dep_1", "pending");

      expect(prisma.actionRequest.findMany).toHaveBeenCalledWith({
        where: { deploymentId: "dep_1", status: "pending" },
        orderBy: { createdAt: "asc" },
      });
    });
  });

  describe("updateStatus", () => {
    it("updates status with review info", async () => {
      const updated = {
        id: "ar_1",
        status: "approved",
        reviewedBy: "user_1",
        reviewedAt: expect.any(Date),
      };
      prisma.actionRequest.update.mockResolvedValue(updated);

      const result = await store.updateStatus("ar_1", "approved", { reviewedBy: "user_1" });

      expect(result).toEqual(updated);
      expect(prisma.actionRequest.update).toHaveBeenCalledWith({
        where: { id: "ar_1" },
        data: {
          status: "approved",
          reviewedBy: "user_1",
          reviewedAt: expect.any(Date),
        },
      });
    });

    it("updates status to executed with timestamp", async () => {
      const updated = {
        id: "ar_1",
        status: "executed",
        executedAt: expect.any(Date),
      };
      prisma.actionRequest.update.mockResolvedValue(updated);

      await store.updateStatus("ar_1", "executed");

      expect(prisma.actionRequest.update).toHaveBeenCalledWith({
        where: { id: "ar_1" },
        data: {
          status: "executed",
          executedAt: expect.any(Date),
        },
      });
    });

    it("updates status to rejected without review info", async () => {
      const updated = {
        id: "ar_1",
        status: "rejected",
      };
      prisma.actionRequest.update.mockResolvedValue(updated);

      await store.updateStatus("ar_1", "rejected");

      expect(prisma.actionRequest.update).toHaveBeenCalledWith({
        where: { id: "ar_1" },
        data: {
          status: "rejected",
        },
      });
    });
  });

  describe("countPending", () => {
    it("counts pending action requests for deployment", async () => {
      prisma.actionRequest.count.mockResolvedValue(5);

      const result = await store.countPending("dep_1");

      expect(result).toBe(5);
      expect(prisma.actionRequest.count).toHaveBeenCalledWith({
        where: { deploymentId: "dep_1", status: "pending" },
      });
    });

    it("returns 0 when no pending requests", async () => {
      prisma.actionRequest.count.mockResolvedValue(0);

      const result = await store.countPending("dep_1");

      expect(result).toBe(0);
    });
  });
});
