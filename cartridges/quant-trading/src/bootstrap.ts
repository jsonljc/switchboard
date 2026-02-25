import { QuantTradingCartridge } from "./index.js";

export interface BootstrapQuantTradingResult {
  cartridge: QuantTradingCartridge;
}

export async function bootstrapQuantTradingCartridge(): Promise<BootstrapQuantTradingResult> {
  const cartridge = new QuantTradingCartridge();
  await cartridge.initialize({
    principalId: "system",
    organizationId: null,
    connectionCredentials: {},
  });

  return { cartridge };
}
