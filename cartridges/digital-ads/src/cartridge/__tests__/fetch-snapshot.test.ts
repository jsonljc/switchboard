import { describe, it, expect } from "vitest";
import { DigitalAdsCartridge } from "../index.js";
import { MockProvider } from "../providers/mock-provider.js";
import type { MetricSnapshot } from "../../core/types.js";

describe("digital-ads.snapshot.fetch", () => {
  const defaultCtx = {
    principalId: "user_1",
    organizationId: null as string | null,
    connectionCredentials: {} as Record<string, unknown>,
  };

  async function createCartridge() {
    const cartridge = new DigitalAdsCartridge();
    cartridge.registerProvider(new MockProvider("meta"));
    cartridge.registerProvider(new MockProvider("google"));
    await cartridge.initialize(defaultCtx);
    // Pre-connect meta
    await cartridge.execute(
      "digital-ads.platform.connect",
      {
        platform: "meta",
        credentials: { platform: "meta", accessToken: "test" },
        entityId: "act_123",
      },
      defaultCtx
    );
    return cartridge;
  }

  it("fetches raw metric data", async () => {
    const cartridge = await createCartridge();

    const result = await cartridge.execute(
      "digital-ads.snapshot.fetch",
      {
        platform: "meta",
        entityId: "act_123",
        vertical: "commerce",
        timeRange: { since: "2024-01-08", until: "2024-01-14" },
      },
      defaultCtx
    );

    expect(result.success).toBe(true);
    expect(result.summary).toContain("Fetched snapshot");
    expect(result.summary).toContain("act_123");
    expect(result.data).toBeDefined();

    const snapshot = result.data as MetricSnapshot;
    expect(snapshot.entityId).toBe("act_123");
    expect(snapshot.periodStart).toBe("2024-01-08");
    expect(snapshot.periodEnd).toBe("2024-01-14");
    expect(typeof snapshot.spend).toBe("number");
  });

  it("fails when no credentials available", async () => {
    const cartridge = new DigitalAdsCartridge();
    cartridge.registerProvider(new MockProvider("meta"));
    await cartridge.initialize(defaultCtx);

    const result = await cartridge.execute(
      "digital-ads.snapshot.fetch",
      {
        platform: "meta",
        entityId: "act_123",
        vertical: "commerce",
        timeRange: { since: "2024-01-08", until: "2024-01-14" },
      },
      defaultCtx
    );

    expect(result.success).toBe(false);
    expect(result.summary).toContain("No credentials");
  });

  it("works with context-provided credentials", async () => {
    const cartridge = new DigitalAdsCartridge();
    cartridge.registerProvider(new MockProvider("meta"));
    await cartridge.initialize(defaultCtx);

    const result = await cartridge.execute(
      "digital-ads.snapshot.fetch",
      {
        platform: "meta",
        entityId: "act_789",
        vertical: "commerce",
        timeRange: { since: "2024-01-01", until: "2024-01-07" },
      },
      {
        principalId: "user_1",
        organizationId: null,
        connectionCredentials: {
          meta: { platform: "meta", accessToken: "ctx_token" },
        },
      }
    );

    expect(result.success).toBe(true);
  });

  it("returns correct ExecuteResult structure", async () => {
    const cartridge = await createCartridge();

    const result = await cartridge.execute(
      "digital-ads.snapshot.fetch",
      {
        platform: "meta",
        entityId: "act_123",
        vertical: "commerce",
        timeRange: { since: "2024-01-08", until: "2024-01-14" },
      },
      defaultCtx
    );

    expect(result.rollbackAvailable).toBe(false);
    expect(result.undoRecipe).toBeNull();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.externalRefs.platform).toBe("meta");
    expect(result.partialFailures).toHaveLength(0);
  });
});
