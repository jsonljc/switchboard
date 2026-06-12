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

  describe("provisionStripeConnection", () => {
    it("creates a new stripe Connection with externalAccountId := connectedAccountId and encrypted creds", async () => {
      prisma.connection.findFirst.mockResolvedValue(null);
      prisma.connection.upsert.mockResolvedValue({ id: "conn_new" });

      const result = await store.provisionStripeConnection({
        organizationId: "org_1",
        connectedAccountId: "acct_test123",
        secretKey: "sk_test_abc",
      });

      expect(result).toEqual({ id: "conn_new", created: true });
      const args = prisma.connection.upsert.mock.calls[0]![0];
      expect(args.where).toEqual({
        serviceId_organizationId: { serviceId: "stripe", organizationId: "org_1" },
      });
      expect(args.create).toMatchObject({
        serviceId: "stripe",
        serviceName: "stripe",
        organizationId: "org_1",
        authType: "api_key",
        status: "connected",
        externalAccountId: "acct_test123",
        scopes: [],
      });
      expect(args.create.id).toMatch(/^conn_/);
      expect(JSON.parse(args.create.credentials)).toEqual({
        connectedAccountId: "acct_test123",
        secretKey: "sk_test_abc",
      });
      // #999 invariant: the account the adapter transacts on === the account the webhook
      // resolves the org by.
      expect(JSON.parse(args.create.credentials).connectedAccountId).toBe(
        args.create.externalAccountId,
      );
    });

    it("accepts a restricted key (rk_) as the per-org secret", async () => {
      prisma.connection.findFirst.mockResolvedValue(null);
      prisma.connection.upsert.mockResolvedValue({ id: "conn_rk" });

      const result = await store.provisionStripeConnection({
        organizationId: "org_1",
        connectedAccountId: "acct_rk",
        secretKey: "rk_test_restricted",
      });

      expect(result.created).toBe(true);
      const args = prisma.connection.upsert.mock.calls[0]![0];
      expect(JSON.parse(args.create.credentials).secretKey).toBe("rk_test_restricted");
    });

    it("merges into existing creds on re-provision, preserving other keys and updating externalAccountId", async () => {
      prisma.connection.findFirst.mockResolvedValue({
        id: "conn_existing",
        credentials: JSON.stringify({
          connectedAccountId: "acct_old",
          secretKey: "sk_test_old",
          webhookSecret: "whsec_keepme",
        }),
      });
      prisma.connection.upsert.mockResolvedValue({ id: "conn_existing" });

      const result = await store.provisionStripeConnection({
        organizationId: "org_1",
        connectedAccountId: "acct_new",
        secretKey: "sk_test_new",
      });

      expect(result).toEqual({ id: "conn_existing", created: false });
      const args = prisma.connection.upsert.mock.calls[0]![0];
      expect(JSON.parse(args.update.credentials)).toEqual({
        connectedAccountId: "acct_new",
        secretKey: "sk_test_new",
        webhookSecret: "whsec_keepme",
      });
      expect(args.update.externalAccountId).toBe("acct_new");
      expect(args.update.status).toBe("connected");
    });

    it("preserves keys from a legacy unencrypted (object) existing credentials row", async () => {
      // A legacy/manual row whose credentials column is a JSON object, not an encrypted
      // string. The read must carry its keys through (like mergeCredentialsById), not drop them.
      prisma.connection.findFirst.mockResolvedValue({
        id: "conn_legacy",
        credentials: {
          connectedAccountId: "acct_old",
          secretKey: "sk_test_old",
          webhookSecret: "whsec_legacy",
        },
      });
      prisma.connection.upsert.mockResolvedValue({ id: "conn_legacy" });

      await store.provisionStripeConnection({
        organizationId: "org_1",
        connectedAccountId: "acct_new",
        secretKey: "sk_test_new",
      });

      const args = prisma.connection.upsert.mock.calls[0]![0];
      expect(JSON.parse(args.update.credentials)).toEqual({
        connectedAccountId: "acct_new",
        secretKey: "sk_test_new",
        webhookSecret: "whsec_legacy",
      });
    });

    it("is org-scoped on the credential pre-read", async () => {
      prisma.connection.findFirst.mockResolvedValue(null);
      prisma.connection.upsert.mockResolvedValue({ id: "conn_new" });

      await store.provisionStripeConnection({
        organizationId: "org_42",
        connectedAccountId: "acct_x",
        secretKey: "sk_test_x",
      });

      expect(prisma.connection.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { serviceId: "stripe", organizationId: "org_42" } }),
      );
    });

    it("fail-closed: throws and writes nothing when secretKey is empty", async () => {
      await expect(
        store.provisionStripeConnection({
          organizationId: "org_1",
          connectedAccountId: "acct_x",
          secretKey: "",
        }),
      ).rejects.toThrow(/secretKey must be a Stripe secret/);
      expect(prisma.connection.findFirst).not.toHaveBeenCalled();
      expect(prisma.connection.upsert).not.toHaveBeenCalled();
    });

    it("fail-closed: throws when secretKey has no sk_/rk_ prefix", async () => {
      await expect(
        store.provisionStripeConnection({
          organizationId: "org_1",
          connectedAccountId: "acct_x",
          secretKey: "totally-not-a-key",
        }),
      ).rejects.toThrow(/sk_\.\.\.\) or restricted \(rk_/);
      expect(prisma.connection.upsert).not.toHaveBeenCalled();
    });

    it("fail-closed: throws when connectedAccountId is not an acct_ id", async () => {
      await expect(
        store.provisionStripeConnection({
          organizationId: "org_1",
          connectedAccountId: "not-an-acct",
          secretKey: "sk_test_x",
        }),
      ).rejects.toThrow(/acct_/);
      expect(prisma.connection.upsert).not.toHaveBeenCalled();
    });

    it("fail-closed: throws when organizationId is empty", async () => {
      await expect(
        store.provisionStripeConnection({
          organizationId: "",
          connectedAccountId: "acct_x",
          secretKey: "sk_test_x",
        }),
      ).rejects.toThrow(/organizationId is required/);
      expect(prisma.connection.upsert).not.toHaveBeenCalled();
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

    it("returns null for an expired connection", async () => {
      prisma.connection.findFirst.mockResolvedValue({
        credentials: "ENCRYPTED_BLOB",
        status: "expired",
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
