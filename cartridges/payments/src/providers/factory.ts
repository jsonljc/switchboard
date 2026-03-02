import type { StripeConfig, StripeProvider } from "./stripe.js";
import { MockStripeProvider } from "./stripe.js";

export function createStripeProvider(config: StripeConfig): StripeProvider {
  // Real Stripe secret keys start with "sk_live_" or "sk_test_" and are 30+ chars.
  const key = config.secretKey;
  const isRealKey = key && (key.startsWith("sk_live_") || key.startsWith("sk_test_")) && key.length >= 30;

  if (isRealKey) {
    try {
      // Dynamic import to avoid requiring stripe package when using mock
      const { RealStripeProvider } = require("./real-stripe.js");
      return new RealStripeProvider(config);
    } catch {
      // Stripe package not installed — fall back to mock
      return new MockStripeProvider(config);
    }
  }

  return new MockStripeProvider(config);
}
