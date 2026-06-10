import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaConnectionStore } from "../prisma-connection-store.js";
import { decryptCredentials } from "../../crypto/credentials.js";

// Mock the crypto module
vi.mock("../../crypto/credentials.js", () => ({
  encryptCredentials: vi.fn((creds: Record<string, unknown>) => JSON.stringify(creds)),
  decryptCredentials: vi.fn((encrypted: string) => JSON.parse(encrypted)),
}));

function createMockPrisma() {
  return {
    connection: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
}

const TEST_CONNECTION = {
  id: "conn_1",
  serviceId: "meta-ads",
  serviceName: "Meta Ads",
  organizationId: "org_1",
  authType: "oauth2",
  credentials: JSON.stringify({ accessToken: "token123" }),
  scopes: ["ads_read", "ads_management"],
  refreshStrategy: "auto",
  status: "connected",
  lastHealthCheck: new Date("2025-01-01"),
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

describe("PrismaConnectionStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaConnectionStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock Prisma client for testing
    store = new PrismaConnectionStore(prisma as any);
  });

  it("saves a connection with encrypted credentials", async () => {
    prisma.connection.upsert.mockResolvedValue(TEST_CONNECTION);

    await store.save({
      id: "conn_1",
      serviceId: "meta-ads",
      serviceName: "Meta Ads",
      organizationId: "org_1",
      authType: "oauth2",
      credentials: { accessToken: "token123" },
      scopes: ["ads_read"],
      refreshStrategy: "auto",
      status: "connected",
      lastHealthCheck: null,
    });

    expect(prisma.connection.upsert).toHaveBeenCalled();
  });

  it("retrieves a connection by id with decrypted credentials", async () => {
    prisma.connection.findUnique.mockResolvedValue(TEST_CONNECTION);

    const result = await store.getById("conn_1");
    expect(result).not.toBeNull();
    expect(result!.serviceId).toBe("meta-ads");
    expect(result!.credentials).toEqual({ accessToken: "token123" });
  });

  it("retrieves a connection by service", async () => {
    prisma.connection.findFirst.mockResolvedValue(TEST_CONNECTION);

    const result = await store.getByService("meta-ads");
    expect(result).not.toBeNull();
    expect(result!.serviceName).toBe("Meta Ads");
  });

  it("lists connections for an organization", async () => {
    prisma.connection.findMany.mockResolvedValue([TEST_CONNECTION]);

    const result = await store.list("org_1");
    expect(result).toHaveLength(1);
    expect(prisma.connection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org_1" } }),
    );
  });

  it("updates connection status", async () => {
    prisma.connection.updateMany.mockResolvedValue({ count: 1 });

    await store.updateStatus("conn_1", "error", "org_1");
    expect(prisma.connection.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "conn_1", organizationId: "org_1" },
        data: expect.objectContaining({ status: "error" }),
      }),
    );
  });

  // Sibling-isolation regression — audit follow-up to TI-7/TI-8 (issue #594).
  it("scopes updateStatus WHERE by organizationId (TI sibling)", async () => {
    prisma.connection.updateMany.mockResolvedValue({ count: 1 });

    await store.updateStatus("conn_1", "error", "org_1");

    const callArgs = prisma.connection.updateMany.mock.calls[0]![0];
    expect(callArgs.where).toEqual({ id: "conn_1", organizationId: "org_1" });
  });

  it("scopes updateStatus WHERE by organizationId=null when caller passes null", async () => {
    prisma.connection.updateMany.mockResolvedValue({ count: 1 });

    await store.updateStatus("conn_1", "error", null);

    const callArgs = prisma.connection.updateMany.mock.calls[0]![0];
    expect(callArgs.where).toEqual({ id: "conn_1", organizationId: null });
  });

  it("throws when updateStatus count=0 (tenant mismatch or missing row)", async () => {
    prisma.connection.updateMany.mockResolvedValue({ count: 0 });

    await expect(store.updateStatus("conn_1", "error", "org_X")).rejects.toThrow(
      /not found or tenant mismatch/,
    );
  });

  // #643: delete must scope WHERE by organizationId (mirrors updateStatus defense-in-depth).
  it("scopes delete WHERE by organizationId (TI defense-in-depth)", async () => {
    prisma.connection.deleteMany.mockResolvedValue({ count: 1 });

    await store.delete("conn_1", "org_1");

    const callArgs = prisma.connection.deleteMany.mock.calls[0]![0];
    expect(callArgs.where).toEqual({ id: "conn_1", organizationId: "org_1" });
    expect(prisma.connection.delete).not.toHaveBeenCalled();
  });

  it("scopes delete WHERE by organizationId=null for global connections", async () => {
    prisma.connection.deleteMany.mockResolvedValue({ count: 1 });

    await store.delete("conn_1", null);

    const callArgs = prisma.connection.deleteMany.mock.calls[0]![0];
    expect(callArgs.where).toEqual({ id: "conn_1", organizationId: null });
    expect(prisma.connection.delete).not.toHaveBeenCalled();
  });

  it("throws when delete count=0 (tenant mismatch or missing row)", async () => {
    prisma.connection.deleteMany.mockResolvedValue({ count: 0 });

    await expect(store.delete("conn_1", "org_X")).rejects.toThrow(/not found or tenant mismatch/);
  });

  describe("mergeCredentialsById", () => {
    it("merges the patch into existing credentials, preserving other keys", async () => {
      prisma.connection.findFirst.mockResolvedValue({
        id: "conn_1",
        serviceId: "meta-ads",
        credentials: JSON.stringify({ accessToken: "tok", accountId: "act_1" }),
      });
      prisma.connection.updateMany.mockResolvedValue({ count: 1 });

      const result = await store.mergeCredentialsById("conn_1", "org_1", "meta-ads", {
        pageId: "123456789012345",
      });

      expect(result).toBe("updated");
      // org-scoped on both legs
      expect(prisma.connection.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "conn_1", organizationId: "org_1" } }),
      );
      const updateArgs = prisma.connection.updateMany.mock.calls[0]![0];
      expect(updateArgs.where).toEqual({ id: "conn_1", organizationId: "org_1" });
      // the merged blob keeps accessToken/accountId and adds pageId (crypto mock round-trips via JSON)
      expect(JSON.parse(updateArgs.data.credentials)).toEqual({
        accessToken: "tok",
        accountId: "act_1",
        pageId: "123456789012345",
      });
    });

    it("returns not_found when no row matches the org (cross-org)", async () => {
      prisma.connection.findFirst.mockResolvedValue(null);

      const result = await store.mergeCredentialsById("conn_1", "org_other", "meta-ads", {
        pageId: "123456789012345",
      });

      expect(result).toBe("not_found");
      expect(prisma.connection.updateMany).not.toHaveBeenCalled();
    });

    it("returns wrong_service without decrypting when serviceId mismatches", async () => {
      vi.mocked(decryptCredentials).mockClear();
      prisma.connection.findFirst.mockResolvedValue({
        id: "conn_1",
        serviceId: "stripe",
        credentials: JSON.stringify({ secretKey: "sk_1" }),
      });

      const result = await store.mergeCredentialsById("conn_1", "org_1", "meta-ads", {
        pageId: "123456789012345",
      });

      expect(result).toBe("wrong_service");
      expect(decryptCredentials).not.toHaveBeenCalled();
      expect(prisma.connection.updateMany).not.toHaveBeenCalled();
    });

    it("returns not_found when the row is deleted between read and write", async () => {
      prisma.connection.findFirst.mockResolvedValue({
        id: "conn_1",
        serviceId: "meta-ads",
        credentials: JSON.stringify({ accessToken: "tok" }),
      });
      prisma.connection.updateMany.mockResolvedValue({ count: 0 });

      const result = await store.mergeCredentialsById("conn_1", "org_1", "meta-ads", {
        pageId: "123456789012345",
      });

      expect(result).toBe("not_found");
    });
  });

  describe("findByServiceId (riley credential resolver fallback)", () => {
    it("returns the raw encrypted credentials blob without decrypting", async () => {
      vi.mocked(decryptCredentials).mockClear();
      prisma.connection.findFirst.mockResolvedValue({
        credentials: "ENCRYPTED_BLOB",
        status: "connected",
      });

      const result = await store.findByServiceId("meta-ads", "org_1");

      expect(result).toEqual({ credentials: "ENCRYPTED_BLOB" });
      expect(decryptCredentials).not.toHaveBeenCalled();
    });

    it("scopes the query to (serviceId, organizationId)", async () => {
      prisma.connection.findFirst.mockResolvedValue({
        credentials: "ENCRYPTED_BLOB",
        status: "connected",
      });

      await store.findByServiceId("meta-ads", "org_1");

      expect(prisma.connection.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { serviceId: "meta-ads", organizationId: "org_1" } }),
      );
    });

    it("returns null for a needs_reauth connection (never a dead token)", async () => {
      prisma.connection.findFirst.mockResolvedValue({
        credentials: "ENCRYPTED_BLOB",
        status: "needs_reauth",
      });

      expect(await store.findByServiceId("meta-ads", "org_1")).toBeNull();
    });

    it("returns null for a revoked connection", async () => {
      prisma.connection.findFirst.mockResolvedValue({
        credentials: "ENCRYPTED_BLOB",
        status: "revoked",
      });

      expect(await store.findByServiceId("meta-ads", "org_1")).toBeNull();
    });

    it("returns null when no connection exists for the org", async () => {
      prisma.connection.findFirst.mockResolvedValue(null);

      expect(await store.findByServiceId("meta-ads", "org_1")).toBeNull();
    });

    it("returns null when stored credentials are not an encrypted string (legacy)", async () => {
      prisma.connection.findFirst.mockResolvedValue({
        credentials: { accessToken: "legacy" },
        status: "connected",
      });

      expect(await store.findByServiceId("meta-ads", "org_1")).toBeNull();
    });
  });
});
