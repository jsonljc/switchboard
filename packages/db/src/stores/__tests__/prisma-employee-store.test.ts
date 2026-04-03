import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaEmployeeStore } from "../prisma-employee-store.js";

function makeMockPrisma() {
  return {
    employeeRegistration: {
      upsert: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
  };
}

function makeRegistration(overrides: Record<string, unknown> = {}) {
  return {
    id: "reg-1",
    employeeId: "emp-1",
    organizationId: "org-1",
    status: "active",
    config: {},
    createdAt: new Date("2026-04-01T00:00:00Z"),
    updatedAt: new Date("2026-04-01T00:00:00Z"),
    ...overrides,
  };
}

describe("PrismaEmployeeStore", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let store: PrismaEmployeeStore;

  beforeEach(() => {
    prisma = makeMockPrisma();
    store = new PrismaEmployeeStore(prisma as never);
  });

  describe("register", () => {
    it("upserts an employee registration", async () => {
      await store.register("emp-1", "org-1", { tone: "professional" });

      expect(prisma.employeeRegistration.upsert).toHaveBeenCalledWith({
        where: {
          employeeId_organizationId: { employeeId: "emp-1", organizationId: "org-1" },
        },
        create: expect.objectContaining({
          employeeId: "emp-1",
          organizationId: "org-1",
          status: "active",
          config: { tone: "professional" },
        }),
        update: expect.objectContaining({
          config: { tone: "professional" },
        }),
      });
    });

    it("defaults config to empty object when not provided", async () => {
      await store.register("emp-1", "org-1");

      expect(prisma.employeeRegistration.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ config: {} }),
        }),
      );
    });
  });

  describe("getByOrg", () => {
    it("returns all employees for an org", async () => {
      const rows = [makeRegistration(), makeRegistration({ id: "reg-2", employeeId: "emp-2" })];
      prisma.employeeRegistration.findMany.mockResolvedValue(rows);

      const result = await store.getByOrg("org-1");

      expect(prisma.employeeRegistration.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result).toHaveLength(2);
    });
  });

  describe("getById", () => {
    it("returns null when not found", async () => {
      const result = await store.getById("emp-999", "org-1");
      expect(result).toBeNull();
    });

    it("returns employee when found", async () => {
      const reg = makeRegistration();
      prisma.employeeRegistration.findFirst.mockResolvedValue(reg);

      const result = await store.getById("emp-1", "org-1");

      expect(result).toEqual(reg);
      expect(prisma.employeeRegistration.findFirst).toHaveBeenCalledWith({
        where: { employeeId: "emp-1", organizationId: "org-1" },
      });
    });
  });

  describe("updateStatus", () => {
    it("updates employee status", async () => {
      const existing = makeRegistration();
      prisma.employeeRegistration.findFirst.mockResolvedValue(existing);

      await store.updateStatus("emp-1", "org-1", "paused");

      expect(prisma.employeeRegistration.update).toHaveBeenCalledWith({
        where: { id: "reg-1" },
        data: { status: "paused", updatedAt: expect.any(Date) },
      });
    });

    it("throws when employee not found", async () => {
      await expect(store.updateStatus("emp-999", "org-1", "paused")).rejects.toThrow(/not found/);
    });
  });

  describe("updateConfig", () => {
    it("updates employee config", async () => {
      const existing = makeRegistration();
      prisma.employeeRegistration.findFirst.mockResolvedValue(existing);

      await store.updateConfig("emp-1", "org-1", { tone: "casual" });

      expect(prisma.employeeRegistration.update).toHaveBeenCalledWith({
        where: { id: "reg-1" },
        data: { config: { tone: "casual" }, updatedAt: expect.any(Date) },
      });
    });

    it("throws when employee not found", async () => {
      await expect(store.updateConfig("emp-999", "org-1", { tone: "casual" })).rejects.toThrow(
        /not found/,
      );
    });
  });
});
