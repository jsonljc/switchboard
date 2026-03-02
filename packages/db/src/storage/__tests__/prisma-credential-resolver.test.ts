import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaCredentialResolver } from "../prisma-credential-resolver.js";

function createMockConnectionStore() {
  return {
    getByService: vi.fn(),
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

  it("returns org-scoped credentials when found", async () => {
    connectionStore.getByService.mockResolvedValue({
      credentials: { accessToken: "org-token" },
    });

    const result = await resolver.resolve("digital-ads", "org_1");
    expect(result).toEqual({ accessToken: "org-token" });
    expect(connectionStore.getByService).toHaveBeenCalledWith("meta-ads", "org_1");
  });

  it("falls back to global when org-scoped not found", async () => {
    connectionStore.getByService
      .mockResolvedValueOnce(null) // org-scoped lookup
      .mockResolvedValueOnce({ credentials: { accessToken: "global-token" } }); // global lookup

    const result = await resolver.resolve("digital-ads", "org_1");
    expect(result).toEqual({ accessToken: "global-token" });
    expect(connectionStore.getByService).toHaveBeenCalledTimes(2);
    expect(connectionStore.getByService).toHaveBeenNthCalledWith(1, "meta-ads", "org_1");
    expect(connectionStore.getByService).toHaveBeenNthCalledWith(2, "meta-ads");
  });

  it("returns {} when both lookups return null", async () => {
    connectionStore.getByService.mockResolvedValue(null);

    const result = await resolver.resolve("payments", "org_1");
    expect(result).toEqual({});
  });

  it("skips org-scoped lookup when organizationId is null", async () => {
    connectionStore.getByService.mockResolvedValue({
      credentials: { apiKey: "key_123" },
    });

    const result = await resolver.resolve("payments", null);
    expect(result).toEqual({ apiKey: "key_123" });
    // Only one call (global), no org-scoped lookup
    expect(connectionStore.getByService).toHaveBeenCalledTimes(1);
    expect(connectionStore.getByService).toHaveBeenCalledWith("stripe");
  });

  it("returns {} on exception (catch block)", async () => {
    connectionStore.getByService.mockRejectedValue(new Error("decryption failed"));

    const result = await resolver.resolve("quant-trading", "org_1");
    expect(result).toEqual({});
  });

  it("maps cartridge IDs to correct service IDs", async () => {
    connectionStore.getByService.mockResolvedValue({
      credentials: { token: "t" },
    });

    await resolver.resolve("digital-ads", null);
    expect(connectionStore.getByService).toHaveBeenCalledWith("meta-ads");

    connectionStore.getByService.mockClear();
    await resolver.resolve("payments", null);
    expect(connectionStore.getByService).toHaveBeenCalledWith("stripe");

    connectionStore.getByService.mockClear();
    await resolver.resolve("quant-trading", null);
    expect(connectionStore.getByService).toHaveBeenCalledWith("broker-api");
  });
});
