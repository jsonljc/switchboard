import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaDeploymentLookup } from "../deployment-lookup.js";

// Mock the crypto module
vi.mock("@switchboard/db", () => ({
  decryptCredentials: vi.fn(),
}));

describe("PrismaDeploymentLookup", () => {
  const mockPrisma = {
    deploymentConnection: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    agentDeployment: {
      findUnique: vi.fn(),
    },
    agentListing: {
      findUnique: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no matching connection found", async () => {
    mockPrisma.deploymentConnection.findMany.mockResolvedValue([]);
    const lookup = new PrismaDeploymentLookup(mockPrisma as never);

    const result = await lookup.findByChannelToken("web_widget", "sw_unknown");

    expect(result).toBeNull();
  });

  it("returns deployment info when token matches", async () => {
    const { decryptCredentials } = await import("@switchboard/db");
    (decryptCredentials as ReturnType<typeof vi.fn>).mockReturnValue({
      token: "sw_match123",
    });

    mockPrisma.deploymentConnection.findMany.mockResolvedValue([
      {
        id: "conn-1",
        deploymentId: "dep-1",
        type: "web_widget",
        credentials: "encrypted-data",
        status: "active",
      },
    ]);
    mockPrisma.agentDeployment.findUnique.mockResolvedValue({
      id: "dep-1",
      listingId: "listing-1",
      organizationId: "org-1",
      inputConfig: {
        businessName: "Test",
        businessType: "saas",
        productService: "widgets",
        valueProposition: "best",
        tone: "professional",
        qualificationCriteria: {},
        disqualificationCriteria: {},
        escalationRules: {},
        bookingLink: null,
        customInstructions: null,
      },
      governanceSettings: { startingAutonomy: "supervised" },
      status: "active",
    });
    mockPrisma.agentListing.findUnique.mockResolvedValue({
      id: "listing-1",
      trustScore: 45,
    });

    const lookup = new PrismaDeploymentLookup(mockPrisma as never);
    const result = await lookup.findByChannelToken("web_widget", "sw_match123");

    expect(result).not.toBeNull();
    expect(result!.deployment.id).toBe("dep-1");
    expect(result!.persona.businessName).toBe("Test");
    expect(result!.trustScore).toBe(45);
    expect(result!.trustLevel).toBe("guided"); // 45 >= 30
  });

  it("caches results and avoids repeat DB queries", async () => {
    const { decryptCredentials } = await import("@switchboard/db");
    (decryptCredentials as ReturnType<typeof vi.fn>).mockReturnValue({
      token: "sw_cached",
    });

    mockPrisma.deploymentConnection.findMany.mockResolvedValue([
      {
        id: "conn-1",
        deploymentId: "dep-1",
        type: "web_widget",
        credentials: "encrypted",
        status: "active",
      },
    ]);
    mockPrisma.agentDeployment.findUnique.mockResolvedValue({
      id: "dep-1",
      listingId: "listing-1",
      organizationId: "org-1",
      inputConfig: {
        businessName: "Test",
        businessType: "saas",
        productService: "widgets",
        valueProposition: "best",
        tone: "professional",
        qualificationCriteria: {},
        disqualificationCriteria: {},
        escalationRules: {},
        bookingLink: null,
        customInstructions: null,
      },
      governanceSettings: {},
      status: "active",
    });
    mockPrisma.agentListing.findUnique.mockResolvedValue({
      id: "listing-1",
      trustScore: 50,
    });

    const lookup = new PrismaDeploymentLookup(mockPrisma as never);

    await lookup.findByChannelToken("web_widget", "sw_cached");
    await lookup.findByChannelToken("web_widget", "sw_cached");

    // DB should only be queried once due to caching
    expect(mockPrisma.deploymentConnection.findMany).toHaveBeenCalledTimes(1);
  });

  it("uses direct ID lookup for telegram channel", async () => {
    mockPrisma.deploymentConnection.findUnique.mockResolvedValue({
      id: "conn-telegram",
      deploymentId: "dep-2",
      type: "telegram",
      credentials: "encrypted",
      status: "active",
    });
    mockPrisma.agentDeployment.findUnique.mockResolvedValue({
      id: "dep-2",
      listingId: "listing-2",
      organizationId: "org-2",
      inputConfig: {
        businessName: "TG Biz",
        businessType: "retail",
        productService: "products",
        valueProposition: "fast",
        tone: "casual",
        qualificationCriteria: {},
        disqualificationCriteria: {},
        escalationRules: {},
        bookingLink: null,
        customInstructions: null,
      },
      status: "active",
    });
    mockPrisma.agentListing.findUnique.mockResolvedValue({
      id: "listing-2",
      trustScore: 60,
    });

    const lookup = new PrismaDeploymentLookup(mockPrisma as never);
    const result = await lookup.findByChannelToken("telegram", "conn-telegram");

    expect(result).not.toBeNull();
    expect(result!.deployment.id).toBe("dep-2");
    // Should use findUnique (direct ID), not findMany (scan)
    expect(mockPrisma.deploymentConnection.findUnique).toHaveBeenCalledWith({
      where: { id: "conn-telegram" },
    });
    expect(mockPrisma.deploymentConnection.findMany).not.toHaveBeenCalled();
  });
});
