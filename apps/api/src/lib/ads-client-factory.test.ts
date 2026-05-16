import { describe, expect, it, vi } from "vitest";
import { buildAdsClientFactory } from "./ads-client-factory.js";

type PrismaStub = {
  connection: { findFirst: ReturnType<typeof vi.fn> };
};

function stubPrisma(connection: unknown): PrismaStub {
  return { connection: { findFirst: vi.fn(async () => connection) } };
}

describe("buildAdsClientFactory", () => {
  it("constructs a MetaAdsClient from decrypted Connection credentials", async () => {
    const prisma = stubPrisma({
      id: "conn_1",
      credentials: { encrypted: "stub" },
    });
    const decrypt = vi.fn(() => ({
      accessToken: "tok_abc",
      accountId: "act_123",
    }));
    const factory = buildAdsClientFactory(prisma as never, { decryptCredentials: decrypt });

    const client = await factory({ id: "conn_1", organizationId: "org_1" });
    expect(client).toBeDefined();
    expect(typeof client.getCampaignInsights).toBe("function");
    // Cross-org defense: the Prisma where clause must filter on BOTH id AND
    // organizationId so a forged or misrouted connection ref cannot hydrate
    // credentials from a different org.
    expect(prisma.connection.findFirst).toHaveBeenCalledWith({
      where: { id: "conn_1", organizationId: "org_1" },
      select: { credentials: true },
    });
    expect(decrypt).toHaveBeenCalledWith({ encrypted: "stub" });
  });

  it("throws when the Connection row cannot be found for the given org", async () => {
    const prisma = stubPrisma(null);
    const factory = buildAdsClientFactory(prisma as never, {
      decryptCredentials: vi.fn(),
    });
    await expect(factory({ id: "missing", organizationId: "org_1" })).rejects.toThrow(/not found/i);
  });

  it("throws when the Connection id belongs to a different organization", async () => {
    // Simulate cross-org attempt: prisma returns null because the WHERE
    // filter includes organizationId that does not match the row's org.
    const prisma = stubPrisma(null);
    const factory = buildAdsClientFactory(prisma as never, {
      decryptCredentials: vi.fn(),
    });
    await expect(factory({ id: "conn_owned_by_org_a", organizationId: "org_b" })).rejects.toThrow(
      /not found/i,
    );
    expect(prisma.connection.findFirst).toHaveBeenCalledWith({
      where: { id: "conn_owned_by_org_a", organizationId: "org_b" },
      select: { credentials: true },
    });
  });

  it("throws when decrypted credentials lack accessToken or accountId", async () => {
    const prisma = stubPrisma({ id: "conn_1", credentials: {} });
    const factory = buildAdsClientFactory(prisma as never, {
      decryptCredentials: vi.fn(() => ({})),
    });
    await expect(factory({ id: "conn_1", organizationId: "org_1" })).rejects.toThrow(
      /credentials/i,
    );
  });
});
