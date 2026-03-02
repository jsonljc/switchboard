import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaConnectionStore } from "../prisma-connection-store.js";

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
      delete: vi.fn(),
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
    prisma.connection.update.mockResolvedValue({});

    await store.updateStatus("conn_1", "error");
    expect(prisma.connection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "conn_1" },
        data: expect.objectContaining({ status: "error" }),
      }),
    );
  });

  it("deletes a connection", async () => {
    prisma.connection.delete.mockResolvedValue({});

    await store.delete("conn_1");
    expect(prisma.connection.delete).toHaveBeenCalledWith({ where: { id: "conn_1" } });
  });
});
