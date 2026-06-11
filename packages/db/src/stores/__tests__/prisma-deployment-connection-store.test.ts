import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaDeploymentConnectionStore } from "../prisma-deployment-connection-store.js";

function createMockPrisma() {
  return {
    deploymentConnection: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
}

describe("PrismaDeploymentConnectionStore tenant isolation", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaDeploymentConnectionStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock Prisma client
    store = new PrismaDeploymentConnectionStore(prisma as any);
  });

  describe("updateStatus", () => {
    it("scopes WHERE by relation-filter deployment.organizationId", async () => {
      prisma.deploymentConnection.updateMany.mockResolvedValue({ count: 1 });
      await store.updateStatus("org_1", "conn_1", "expired");
      const args = prisma.deploymentConnection.updateMany.mock.calls[0]![0];
      expect(args.where).toEqual({ id: "conn_1", deployment: { organizationId: "org_1" } });
      expect(args.data).toEqual({ status: "expired" });
    });

    it("throws StaleVersionError on count=0 (missing/tenant mismatch)", async () => {
      prisma.deploymentConnection.updateMany.mockResolvedValue({ count: 0 });
      await expect(store.updateStatus("org_X", "conn_1", "expired")).rejects.toThrow(
        /Stale version/,
      );
    });
  });

  describe("updateCredentials", () => {
    it("scopes WHERE by relation-filter and writes credentials + metadata", async () => {
      prisma.deploymentConnection.updateMany.mockResolvedValue({ count: 1 });
      await store.updateCredentials("org_1", "conn_1", "enc", { foo: "bar" });
      const args = prisma.deploymentConnection.updateMany.mock.calls[0]![0];
      expect(args.where).toEqual({ id: "conn_1", deployment: { organizationId: "org_1" } });
      expect(args.data).toEqual({ credentials: "enc", metadata: { foo: "bar" } });
    });

    it("throws StaleVersionError on count=0", async () => {
      prisma.deploymentConnection.updateMany.mockResolvedValue({ count: 0 });
      await expect(store.updateCredentials("org_X", "conn_1", "enc")).rejects.toThrow(
        /Stale version/,
      );
    });
  });

  describe("delete", () => {
    it("scopes deleteMany WHERE by relation-filter and throws on count=0", async () => {
      prisma.deploymentConnection.deleteMany.mockResolvedValue({ count: 0 });
      await expect(store.delete("org_X", "conn_1")).rejects.toThrow(/Stale version/);
      const args = prisma.deploymentConnection.deleteMany.mock.calls[0]![0];
      expect(args.where).toEqual({ id: "conn_1", deployment: { organizationId: "org_X" } });
    });
  });

  describe("findByDeploymentAndTypeForOrg", () => {
    it("scopes the read WHERE by relation-filter deployment.organizationId", async () => {
      prisma.deploymentConnection.findFirst.mockResolvedValue({ id: "conn_1", type: "meta-ads" });
      const result = await store.findByDeploymentAndTypeForOrg("org_1", "dep_1", "meta-ads");
      const args = prisma.deploymentConnection.findFirst.mock.calls[0]![0];
      expect(args.where).toEqual({
        deploymentId: "dep_1",
        type: "meta-ads",
        deployment: { organizationId: "org_1" },
      });
      expect(result).toEqual({ id: "conn_1", type: "meta-ads" });
    });

    it("returns null when the deployment is not in the caller's org (no cross-tenant read)", async () => {
      prisma.deploymentConnection.findFirst.mockResolvedValue(null);
      const result = await store.findByDeploymentAndTypeForOrg("org_other", "dep_1", "meta-ads");
      expect(result).toBeNull();
    });
  });
});
