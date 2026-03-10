// ---------------------------------------------------------------------------
// Bootstrap — Tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { bootstrapRevenueGrowthCartridge } from "../bootstrap.js";
import { MockConnector } from "../../data/normalizer.js";

describe("bootstrapRevenueGrowthCartridge", () => {
  it("creates a cartridge with no config", async () => {
    const { cartridge } = await bootstrapRevenueGrowthCartridge();
    expect(cartridge.manifest.id).toBe("revenue-growth");
  });

  it("creates a cartridge with deps", async () => {
    const { cartridge } = await bootstrapRevenueGrowthCartridge({
      deps: { connectors: [new MockConnector()] },
    });
    expect(cartridge.manifest.id).toBe("revenue-growth");
  });

  it("returns a working cartridge that can run diagnostics", async () => {
    const { cartridge } = await bootstrapRevenueGrowthCartridge({
      deps: {
        connectors: [
          new MockConnector({
            signalHealth: {
              pixelActive: true,
              capiConfigured: true,
              eventMatchQuality: 8,
              eventCompleteness: 0.9,
              deduplicationRate: 0.1,
              conversionLagHours: 4,
            },
            creativeAssets: {
              totalAssets: 10,
              activeAssets: 8,
              averageScore: 70,
              fatigueRate: 0.1,
              topPerformerCount: 3,
              bottomPerformerCount: 1,
              diversityScore: 65,
            },
          }),
        ],
      },
    });

    const result = await cartridge.execute(
      "revenue-growth.diagnostic.run",
      { accountId: "acc_1", organizationId: "org_1" },
      { principalId: "user_1", organizationId: "org_1", connectionCredentials: {} },
    );

    expect(result.success).toBe(true);
  });
});
