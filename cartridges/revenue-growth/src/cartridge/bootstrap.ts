// ---------------------------------------------------------------------------
// Bootstrap Factory — bootstrapRevenueGrowthCartridge()
// ---------------------------------------------------------------------------

import type { Cartridge } from "@switchboard/cartridge-sdk";
import { RevenueGrowthCartridge } from "./index.js";
import type { DataCollectionDeps } from "../data/normalizer.js";

export interface BootstrapRevenueGrowthConfig {
  deps?: DataCollectionDeps;
}

export interface BootstrapRevenueGrowthResult {
  cartridge: Cartridge;
}

export async function bootstrapRevenueGrowthCartridge(
  config: BootstrapRevenueGrowthConfig = {},
): Promise<BootstrapRevenueGrowthResult> {
  const cartridge = new RevenueGrowthCartridge();

  if (config.deps) {
    cartridge.setDeps(config.deps);
  }

  await cartridge.initialize({
    principalId: "system",
    organizationId: null,
    connectionCredentials: {},
  });

  return { cartridge };
}
