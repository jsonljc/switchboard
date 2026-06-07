import { describe, it, expect } from "vitest";
import { VerifiedPaymentSchema, DepositLinkSchema, DepositLinkInputSchema } from "./payment.js";

describe("VerifiedPaymentSchema", () => {
  it("validates a provider='noop' degraded payment", () => {
    const parsed = VerifiedPaymentSchema.parse({
      provider: "noop",
      amountCents: 5000,
      currency: "SGD",
      status: "paid",
      externalReference: "noop_pay_bk_1",
      bookingId: "bk_1",
    });
    expect(parsed.provider).toBe("noop");
    expect(parsed.amountCents).toBe(5000);
    expect(parsed.bookingId).toBe("bk_1");
  });

  it("accepts bookingId=null (charge with no metadata linkage)", () => {
    const parsed = VerifiedPaymentSchema.parse({
      provider: "stripe",
      amountCents: 5000,
      currency: "sgd",
      status: "paid",
      externalReference: "pi_abc",
      bookingId: null,
    });
    expect(parsed.bookingId).toBeNull();
  });

  it("rejects a negative amountCents", () => {
    expect(() =>
      VerifiedPaymentSchema.parse({
        provider: "noop",
        amountCents: -1,
        currency: "SGD",
        status: "paid",
        externalReference: "noop_pay_bk_1",
        bookingId: null,
      }),
    ).toThrow();
  });
});

describe("DepositLinkSchema", () => {
  it("requires url, externalReference and amountCents", () => {
    expect(() => DepositLinkSchema.parse({ url: "https://x" })).toThrow();
    const ok = DepositLinkSchema.parse({
      url: "https://pay.example/noop_pay_bk_1",
      externalReference: "noop_pay_bk_1",
      amountCents: 5000,
      currency: "SGD",
    });
    expect(ok.externalReference).toBe("noop_pay_bk_1");
  });
});

describe("DepositLinkInputSchema", () => {
  it("requires bookingId, organizationId, amountCents and currency", () => {
    const ok = DepositLinkInputSchema.parse({
      bookingId: "bk_1",
      organizationId: "org_1",
      amountCents: 5000,
      currency: "SGD",
    });
    expect(ok.bookingId).toBe("bk_1");
    expect(() => DepositLinkInputSchema.parse({ bookingId: "bk_1" })).toThrow();
  });
});
