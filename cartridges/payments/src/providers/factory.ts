import type { StripeConfig, StripeProvider } from "./stripe.js";
import { MockStripeProvider } from "./stripe.js";

export function createStripeProvider(config: StripeConfig): StripeProvider {
  // Real Stripe secret keys start with "sk_live_" or "sk_test_" and are 30+ chars.
  // Short keys, empty keys, or known test values use the mock provider.
  const key = config.secretKey;
  if (!key || key.length < 20 || key === "mock-key") {
    return new MockStripeProvider(config);
  }
  // Real provider would be imported and returned here.
  // For now, always use mock since RealStripeProvider is not yet implemented.
  return new MockStripeProvider(config);
}
