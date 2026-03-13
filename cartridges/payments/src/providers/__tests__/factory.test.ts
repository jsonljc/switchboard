import { describe, it, expect } from "vitest";
import { createStripeProvider } from "../factory.js";
import { MockStripeProvider } from "../stripe.js";

describe("createStripeProvider", () => {
  it("should return MockStripeProvider for empty key", () => {
    const provider = createStripeProvider({ secretKey: "" });
    expect(provider).toBeInstanceOf(MockStripeProvider);
  });

  it("should return MockStripeProvider for short key", () => {
    const provider = createStripeProvider({ secretKey: "sk_test_short" });
    expect(provider).toBeInstanceOf(MockStripeProvider);
  });

  it("should return MockStripeProvider for non-stripe key", () => {
    const provider = createStripeProvider({ secretKey: "some-random-api-key-that-is-long-enough" });
    expect(provider).toBeInstanceOf(MockStripeProvider);
  });

  it("should fall back to MockStripeProvider when stripe package is not installed", () => {
    // sk_test_ + 22+ chars = 30+ total → triggers the "real key" path
    const provider = createStripeProvider({
      secretKey: "sk_test_1234567890123456789012",
    });
    // Since stripe SDK isn't installed in test env, it should fall back to mock
    expect(provider).toBeInstanceOf(MockStripeProvider);
  });

  it("should fall back to MockStripeProvider for sk_live_ keys without stripe SDK", () => {
    const provider = createStripeProvider({
      secretKey: "sk_live_1234567890123456789012",
    });
    expect(provider).toBeInstanceOf(MockStripeProvider);
  });
});
