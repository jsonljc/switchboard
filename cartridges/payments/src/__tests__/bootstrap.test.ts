import { describe, it, expect } from "vitest";
import { bootstrapPaymentsCartridge } from "../bootstrap.js";
import { PaymentsCartridge } from "../index.js";

describe("bootstrapPaymentsCartridge", () => {
  it("should return an initialized cartridge", async () => {
    const result = await bootstrapPaymentsCartridge({ secretKey: "mock-key" });
    expect(result.cartridge).toBeInstanceOf(PaymentsCartridge);
    expect(result.cartridge.manifest.id).toBe("payments");
  });

  it("should throw when requireCredentials is true and no key provided", async () => {
    await expect(
      bootstrapPaymentsCartridge({ secretKey: "", requireCredentials: true }),
    ).rejects.toThrow("STRIPE_SECRET_KEY is required");
  });

  it("should not throw when requireCredentials is false and no key", async () => {
    const result = await bootstrapPaymentsCartridge({ secretKey: "", requireCredentials: false });
    expect(result.cartridge).toBeInstanceOf(PaymentsCartridge);
  });

  it("should not throw when requireCredentials is undefined and no key", async () => {
    const result = await bootstrapPaymentsCartridge({ secretKey: "" });
    expect(result.cartridge).toBeInstanceOf(PaymentsCartridge);
  });
});
