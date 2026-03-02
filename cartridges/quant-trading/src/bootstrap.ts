import { QuantTradingCartridge } from "./index.js";

export interface BootstrapQuantTradingResult {
  cartridge: QuantTradingCartridge;
}

/**
 * Create and initialize the quant-trading cartridge.
 *
 * NOTE: Currently uses MockTradingProvider only. No real broker API
 * integration exists yet. The credential resolver maps
 * "quant-trading" → "broker-api" in PrismaCredentialResolver, but
 * credentials are not consumed here. When adding a real broker
 * provider, accept config (e.g. apiKey, accountId) and wire
 * credentials through connectionCredentials.
 */
export async function bootstrapQuantTradingCartridge(): Promise<BootstrapQuantTradingResult> {
  const cartridge = new QuantTradingCartridge();
  await cartridge.initialize({
    principalId: "system",
    organizationId: null,
    connectionCredentials: {},
  });

  return { cartridge };
}
