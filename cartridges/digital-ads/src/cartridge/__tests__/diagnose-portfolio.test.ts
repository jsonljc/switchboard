import { describe, it, expect } from "vitest";
import { DigitalAdsCartridge } from "../index.js";
import { MockProvider } from "../providers/mock-provider.js";
import type { MultiPlatformResult } from "../../orchestrator/types.js";

describe("digital-ads.portfolio.diagnose", () => {
  const defaultCtx = {
    principalId: "user_1",
    organizationId: null as string | null,
    connectionCredentials: {} as Record<string, unknown>,
  };

  async function createCartridge() {
    const cartridge = new DigitalAdsCartridge();
    cartridge.registerProvider(new MockProvider("meta"));
    cartridge.registerProvider(new MockProvider("google"));
    cartridge.registerProvider(new MockProvider("tiktok"));
    await cartridge.initialize(defaultCtx);
    return cartridge;
  }

  it("runs a multi-platform portfolio diagnostic", async () => {
    const cartridge = await createCartridge();

    const result = await cartridge.execute(
      "digital-ads.portfolio.diagnose",
      {
        name: "Test Portfolio",
        vertical: "commerce",
        platforms: [
          {
            platform: "meta",
            credentials: { platform: "meta", accessToken: "test" },
            entityId: "act_meta_1",
          },
          {
            platform: "google",
            credentials: {
              platform: "google",
              clientId: "c",
              clientSecret: "s",
              refreshToken: "r",
              developerToken: "d",
            },
            entityId: "google_123",
          },
        ],
      },
      defaultCtx,
    );

    expect(result.success).toBe(true);
    expect(result.summary).toContain("Test Portfolio");
    expect(result.summary).toContain("2 platforms succeeded");
    expect(result.data).toBeDefined();

    const portfolio = result.data as MultiPlatformResult;
    expect(portfolio.platforms).toHaveLength(2);
    expect(portfolio.executiveSummary).toBeDefined();
  });

  it("handles partial platform failures", async () => {
    const cartridge = new DigitalAdsCartridge();
    const metaProvider = new MockProvider("meta");
    metaProvider.shouldFail = true;
    metaProvider.failError = "Token expired";
    cartridge.registerProvider(metaProvider);
    cartridge.registerProvider(new MockProvider("google"));
    await cartridge.initialize(defaultCtx);

    const result = await cartridge.execute(
      "digital-ads.portfolio.diagnose",
      {
        name: "Partial Portfolio",
        vertical: "commerce",
        platforms: [
          {
            platform: "meta",
            credentials: { platform: "meta", accessToken: "expired" },
            entityId: "act_meta_1",
          },
          {
            platform: "google",
            credentials: {
              platform: "google",
              clientId: "c",
              clientSecret: "s",
              refreshToken: "r",
              developerToken: "d",
            },
            entityId: "google_123",
          },
        ],
      },
      defaultCtx,
    );

    // Should still succeed since at least one platform worked
    expect(result.success).toBe(true);
    expect(result.summary).toContain("1 platforms succeeded");
    expect(result.summary).toContain("1 failed");
    expect(result.partialFailures.length).toBeGreaterThan(0);
  });

  it("returns correct ExecuteResult structure", async () => {
    const cartridge = await createCartridge();

    const result = await cartridge.execute(
      "digital-ads.portfolio.diagnose",
      {
        name: "Structure Test",
        vertical: "commerce",
        platforms: [
          {
            platform: "meta",
            credentials: { platform: "meta", accessToken: "test" },
            entityId: "act_1",
          },
        ],
      },
      defaultCtx,
    );

    expect(result.rollbackAvailable).toBe(false);
    expect(result.undoRecipe).toBeNull();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.externalRefs.name).toBe("Structure Test");
    expect(result.externalRefs.vertical).toBe("commerce");
  });
});
