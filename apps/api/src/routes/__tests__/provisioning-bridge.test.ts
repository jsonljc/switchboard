import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

describe("Provisioning bridge → DeploymentResolver integration", () => {
  const MOCK_ORG_ID = "org_test_123";
  const MOCK_LISTING_ID = "list_alex_456";
  const MOCK_DEPLOYMENT_ID = "deploy_alex_789";
  const MOCK_CONNECTION_ID = "conn_wa_abc";
  const MOCK_ENCRYPTED = "encrypted_creds_string";

  let mockPrisma: {
    agentListing: { findUnique: ReturnType<typeof vi.fn> };
    agentDeployment: { upsert: ReturnType<typeof vi.fn> };
    deploymentConnection: {
      upsert: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
    };
  };

  let bridgeRecords: Map<
    string,
    {
      deploymentId: string;
      type: string;
      tokenHash: string;
      credentials: string;
    }
  >;

  beforeEach(() => {
    bridgeRecords = new Map();

    mockPrisma = {
      agentListing: {
        findUnique: vi.fn().mockResolvedValue({
          id: MOCK_LISTING_ID,
          slug: "alex-conversion",
        }),
      },
      agentDeployment: {
        upsert: vi.fn().mockResolvedValue({
          id: MOCK_DEPLOYMENT_ID,
          organizationId: MOCK_ORG_ID,
          listingId: MOCK_LISTING_ID,
          skillSlug: "alex",
          status: "active",
        }),
      },
      deploymentConnection: {
        upsert: vi.fn().mockImplementation(
          async (args: {
            where: {
              deploymentId_type_slot: { deploymentId: string; type: string; slot: string };
            };
            create: {
              deploymentId: string;
              type: string;
              credentials: string;
              tokenHash: string;
            };
          }) => {
            const record = {
              deploymentId: args.create.deploymentId,
              type: args.create.type,
              tokenHash: args.create.tokenHash,
              credentials: args.create.credentials,
            };
            bridgeRecords.set(args.create.tokenHash, record);
            return record;
          },
        ),
        findFirst: vi
          .fn()
          .mockImplementation(async (args: { where: { tokenHash?: string; type?: string } }) => {
            if (args.where.tokenHash) {
              return bridgeRecords.get(args.where.tokenHash) ?? null;
            }
            return null;
          }),
      },
    };
  });

  async function simulateProvisioning(connectionId: string, channel: string) {
    const alexListing = await mockPrisma.agentListing.findUnique({
      where: { slug: "alex-conversion" },
    });
    if (!alexListing) {
      throw new Error(`Cannot provision ${channel}: Alex listing (alex-conversion) not found.`);
    }

    const deployment = await mockPrisma.agentDeployment.upsert({
      where: {
        organizationId_listingId: {
          organizationId: MOCK_ORG_ID,
          listingId: alexListing.id,
        },
      },
      update: {},
      create: {
        organizationId: MOCK_ORG_ID,
        listingId: alexListing.id,
        status: "active",
        skillSlug: "alex",
      },
    });

    const tokenHash = createHash("sha256").update(connectionId).digest("hex");

    await mockPrisma.deploymentConnection.upsert({
      where: {
        deploymentId_type_slot: {
          deploymentId: deployment.id,
          type: channel,
          slot: "default",
        },
      },
      update: { credentials: MOCK_ENCRYPTED, tokenHash, status: "active" },
      create: {
        deploymentId: deployment.id,
        type: channel,
        slot: "default",
        credentials: MOCK_ENCRYPTED,
        tokenHash,
      },
    });

    return { deployment, tokenHash };
  }

  function simulateResolverLookup(channel: string, token: string) {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    return mockPrisma.deploymentConnection.findFirst({
      where: { type: channel, tokenHash },
    });
  }

  it("provisioning creates bridge records that resolver can find", async () => {
    await simulateProvisioning(MOCK_CONNECTION_ID, "whatsapp");

    // The runtime passes Connection.id as the token (see runtime-registry.ts:80)
    const resolved = await simulateResolverLookup("whatsapp", MOCK_CONNECTION_ID);

    expect(resolved).not.toBeNull();
    expect(resolved.deploymentId).toBe(MOCK_DEPLOYMENT_ID);
    expect(resolved.type).toBe("whatsapp");
    expect(resolved.credentials).toBe(MOCK_ENCRYPTED);
  });

  it("resolver cannot find bridge with wrong token", async () => {
    await simulateProvisioning(MOCK_CONNECTION_ID, "whatsapp");

    const resolved = await simulateResolverLookup("whatsapp", "conn_wrong_id");

    expect(resolved).toBeNull();
  });

  it("re-provisioning updates the bridge (same tokenHash resolves)", async () => {
    const { tokenHash: hash1 } = await simulateProvisioning(MOCK_CONNECTION_ID, "whatsapp");
    const { tokenHash: hash2 } = await simulateProvisioning(MOCK_CONNECTION_ID, "whatsapp");

    expect(hash1).toBe(hash2);

    const resolved = await simulateResolverLookup("whatsapp", MOCK_CONNECTION_ID);
    expect(resolved).not.toBeNull();
  });

  it("upsert calls use the correct Prisma composite key", async () => {
    expect(mockPrisma.agentDeployment.upsert).not.toHaveBeenCalled();

    await simulateProvisioning(MOCK_CONNECTION_ID, "whatsapp");

    expect(mockPrisma.agentDeployment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId_listingId: {
            organizationId: MOCK_ORG_ID,
            listingId: MOCK_LISTING_ID,
          },
        },
      }),
    );
  });

  it("provisioning hard-fails if listing not found", async () => {
    mockPrisma.agentListing.findUnique.mockResolvedValue(null);

    await expect(simulateProvisioning(MOCK_CONNECTION_ID, "whatsapp")).rejects.toThrow(
      "Cannot provision whatsapp",
    );
  });

  it("provisioning hard-fails if deployment upsert fails", async () => {
    mockPrisma.agentDeployment.upsert.mockRejectedValue(new Error("DB constraint violation"));

    await expect(simulateProvisioning(MOCK_CONNECTION_ID, "whatsapp")).rejects.toThrow(
      "DB constraint violation",
    );
  });
});
