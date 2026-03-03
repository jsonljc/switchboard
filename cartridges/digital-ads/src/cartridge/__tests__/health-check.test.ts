import { describe, it, expect } from "vitest";
import { DigitalAdsCartridge } from "../index.js";
import { MockProvider } from "../providers/mock-provider.js";
import type { HealthCheckResult } from "../types.js";

describe("digital-ads.health.check", () => {
  const defaultCtx = {
    principalId: "user_1",
    organizationId: null as string | null,
    connectionCredentials: {} as Record<string, unknown>,
  };

  function createCartridge() {
    const cartridge = new DigitalAdsCartridge();
    cartridge.registerProvider(new MockProvider("meta"));
    cartridge.registerProvider(new MockProvider("google"));
    cartridge.registerProvider(new MockProvider("tiktok"));
    return cartridge;
  }

  it("returns connected status when all platforms respond", async () => {
    const cartridge = createCartridge();
    await cartridge.initialize(defaultCtx);

    const result = await cartridge.execute(
      "digital-ads.health.check",
      {
        platforms: [
          {
            platform: "meta",
            credentials: { platform: "meta", accessToken: "test" },
            entityId: "act_123",
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
    expect(result.data).toBeDefined();

    const health = result.data as HealthCheckResult;
    expect(health.overall).toBe("connected");
    expect(health.platforms).toHaveLength(2);
    expect(health.capabilities.length).toBeGreaterThan(0);
  });

  it("returns degraded status when some platforms fail", async () => {
    const cartridge = new DigitalAdsCartridge();
    const failingMeta = new MockProvider("meta");
    failingMeta.shouldFail = true;
    cartridge.registerProvider(failingMeta);
    cartridge.registerProvider(new MockProvider("google"));
    await cartridge.initialize(defaultCtx);

    const result = await cartridge.execute(
      "digital-ads.health.check",
      {
        platforms: [
          {
            platform: "meta",
            credentials: { platform: "meta", accessToken: "test" },
            entityId: "act_123",
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

    const health = result.data as HealthCheckResult;
    expect(health.overall).toBe("degraded");
    expect(result.partialFailures.length).toBeGreaterThan(0);
  });

  it("returns disconnected status when all platforms fail", async () => {
    const cartridge = new DigitalAdsCartridge();
    const failingMeta = new MockProvider("meta");
    failingMeta.shouldFail = true;
    const failingGoogle = new MockProvider("google");
    failingGoogle.shouldFail = true;
    cartridge.registerProvider(failingMeta);
    cartridge.registerProvider(failingGoogle);
    await cartridge.initialize(defaultCtx);

    const result = await cartridge.execute(
      "digital-ads.health.check",
      {
        platforms: [
          {
            platform: "meta",
            credentials: { platform: "meta", accessToken: "test" },
            entityId: "act_123",
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

    expect(result.success).toBe(false);
    const health = result.data as HealthCheckResult;
    expect(health.overall).toBe("disconnected");
  });

  it("returns error for unregistered providers", async () => {
    const cartridge = new DigitalAdsCartridge();
    await cartridge.initialize(defaultCtx);

    const result = await cartridge.execute(
      "digital-ads.health.check",
      {
        platforms: [
          {
            platform: "meta",
            credentials: { platform: "meta", accessToken: "test" },
            entityId: "act_123",
          },
        ],
      },
      defaultCtx,
    );

    const health = result.data as HealthCheckResult;
    expect(health.overall).toBe("disconnected");
    expect(health.platforms[0].error).toContain("No provider");
  });

  it("uses cartridge-level healthCheck method", async () => {
    const cartridge = createCartridge();
    await cartridge.initialize(defaultCtx);

    // Connect a platform first
    await cartridge.execute(
      "digital-ads.platform.connect",
      {
        platform: "meta",
        credentials: { platform: "meta", accessToken: "test" },
        entityId: "act_123",
      },
      defaultCtx,
    );

    const health = await cartridge.healthCheck();
    expect(health.status).toBeDefined();
    expect(health.error).toBeDefined(); // null or string
    expect(health.capabilities).toBeDefined();
  });

  it("cartridge-level healthCheck returns ConnectionHealth shape", async () => {
    const cartridge = createCartridge();
    await cartridge.initialize(defaultCtx);

    // No connections — should return disconnected
    const health = await cartridge.healthCheck();
    expect(health.status).toBe("disconnected");
    expect(health.latencyMs).toBe(0);
    expect(health.error).toBeNull();
    expect(health.capabilities).toHaveLength(0);
  });

  it("returns correct ExecuteResult structure", async () => {
    const cartridge = createCartridge();
    await cartridge.initialize(defaultCtx);

    const result = await cartridge.execute(
      "digital-ads.health.check",
      {
        platforms: [
          {
            platform: "meta",
            credentials: { platform: "meta", accessToken: "test" },
            entityId: "act_123",
          },
        ],
      },
      defaultCtx,
    );

    expect(result.rollbackAvailable).toBe(false);
    expect(result.undoRecipe).toBeNull();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
