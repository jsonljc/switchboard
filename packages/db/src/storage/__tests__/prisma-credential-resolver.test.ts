import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaCredentialResolver } from "../prisma-credential-resolver.js";

function createMockConnectionStore() {
  return {
    getByService: vi.fn(),
    getByServiceGlobal: vi.fn(),
  };
}

describe("PrismaCredentialResolver", () => {
  let connectionStore: ReturnType<typeof createMockConnectionStore>;
  let resolver: PrismaCredentialResolver;

  beforeEach(() => {
    connectionStore = createMockConnectionStore();
    resolver = new PrismaCredentialResolver(connectionStore as any);
  });

  it("returns {} for unmapped cartridge", async () => {
    const result = await resolver.resolve("crm", "org_1");
    expect(result).toEqual({});
    expect(connectionStore.getByService).not.toHaveBeenCalled();
  });

  it("returns platform-keyed org-scoped credentials for digital-ads", async () => {
    connectionStore.getByService.mockImplementation(async (serviceId: string) => {
      if (serviceId === "meta-ads") {
        return { credentials: { accessToken: "meta-org-token" } };
      }
      return null;
    });
    connectionStore.getByServiceGlobal.mockResolvedValue(null);

    const result = await resolver.resolve("digital-ads", "org_1");
    expect(result).toEqual({ meta: { accessToken: "meta-org-token" } });
    expect(connectionStore.getByService).toHaveBeenCalledWith("meta-ads", "org_1");
  });

  it("returns multi-platform credentials when multiple services exist", async () => {
    connectionStore.getByService.mockImplementation(async (serviceId: string) => {
      if (serviceId === "meta-ads") {
        return { credentials: { accessToken: "meta-token" } };
      }
      if (serviceId === "google-ads") {
        return { credentials: { refreshToken: "google-token" } };
      }
      return null;
    });
    connectionStore.getByServiceGlobal.mockResolvedValue(null);

    const result = await resolver.resolve("digital-ads", "org_1");
    expect(result).toEqual({
      meta: { accessToken: "meta-token" },
      google: { refreshToken: "google-token" },
    });
  });

  it("falls back to global when org-scoped not found", async () => {
    connectionStore.getByService.mockResolvedValue(null);
    connectionStore.getByServiceGlobal.mockImplementation(async (serviceId: string) => {
      if (serviceId === "meta-ads") {
        return { credentials: { accessToken: "global-token" } };
      }
      return null;
    });

    const result = await resolver.resolve("digital-ads", "org_1");
    expect(result).toEqual({ meta: { accessToken: "global-token" } });
    expect(connectionStore.getByService).toHaveBeenCalledWith("meta-ads", "org_1");
    expect(connectionStore.getByServiceGlobal).toHaveBeenCalledWith("meta-ads");
  });

  it("no cross-org fallback: resolve for org_2 returns {} when only org_1 has connection", async () => {
    // org_2 has no connections
    connectionStore.getByService.mockResolvedValue(null);
    // No global connections either
    connectionStore.getByServiceGlobal.mockResolvedValue(null);

    const result = await resolver.resolve("digital-ads", "org_2");
    expect(result).toEqual({});
  });

  it("returns platform-keyed credentials for payments cartridge", async () => {
    connectionStore.getByService.mockResolvedValue({
      credentials: { apiKey: "sk_test_123" },
    });

    const result = await resolver.resolve("payments", "org_1");
    expect(result).toEqual({ stripe: { apiKey: "sk_test_123" } });
    expect(connectionStore.getByService).toHaveBeenCalledWith("stripe", "org_1");
  });

  it("returns {} when all service lookups return null", async () => {
    connectionStore.getByService.mockResolvedValue(null);
    connectionStore.getByServiceGlobal.mockResolvedValue(null);

    const result = await resolver.resolve("payments", "org_1");
    expect(result).toEqual({});
  });

  it("skips org-scoped lookup when organizationId is null", async () => {
    connectionStore.getByServiceGlobal.mockImplementation(async (serviceId: string) => {
      if (serviceId === "stripe") {
        return { credentials: { apiKey: "key_global" } };
      }
      return null;
    });

    const result = await resolver.resolve("payments", null);
    expect(result).toEqual({ stripe: { apiKey: "key_global" } });
    // Should NOT call getByService with org
    expect(connectionStore.getByService).not.toHaveBeenCalled();
    expect(connectionStore.getByServiceGlobal).toHaveBeenCalledWith("stripe");
  });

  it("continues resolving other services when one throws", async () => {
    connectionStore.getByService.mockImplementation(async (serviceId: string) => {
      if (serviceId === "meta-ads") {
        throw new Error("decryption failed");
      }
      if (serviceId === "google-ads") {
        return { credentials: { token: "google-ok" } };
      }
      return null;
    });
    connectionStore.getByServiceGlobal.mockResolvedValue(null);

    const result = await resolver.resolve("digital-ads", "org_1");
    // meta failed but google succeeded
    expect(result).toEqual({ google: { token: "google-ok" } });
  });

  it("maps cartridge IDs to correct service IDs", async () => {
    connectionStore.getByService.mockResolvedValue({
      credentials: { token: "t" },
    });
    connectionStore.getByServiceGlobal.mockResolvedValue(null);

    await resolver.resolve("digital-ads", "org_1");
    // digital-ads maps to meta-ads, google-ads, tiktok-ads
    expect(connectionStore.getByService).toHaveBeenCalledWith("meta-ads", "org_1");
    expect(connectionStore.getByService).toHaveBeenCalledWith("google-ads", "org_1");
    expect(connectionStore.getByService).toHaveBeenCalledWith("tiktok-ads", "org_1");

    connectionStore.getByService.mockClear();
    await resolver.resolve("payments", "org_1");
    expect(connectionStore.getByService).toHaveBeenCalledWith("stripe", "org_1");
  });
});
