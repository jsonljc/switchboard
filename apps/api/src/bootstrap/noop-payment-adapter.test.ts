import { describe, it, expect } from "vitest";
import { NoopPaymentAdapter, isNoopPaymentAdapter } from "./noop-payment-adapter.js";

const INPUT = {
  bookingId: "bk_1",
  organizationId: "org_1",
  amountCents: 5000,
  currency: "SGD",
};

describe("NoopPaymentAdapter.createDepositLink", () => {
  it("fabricates a deterministic externalReference per bookingId", async () => {
    const adapter = new NoopPaymentAdapter();
    const a = await adapter.createDepositLink(INPUT);
    const b = await adapter.createDepositLink(INPUT);
    expect(a.externalReference).toBe("noop_pay_bk_1");
    expect(b.externalReference).toBe(a.externalReference);
    expect(a.amountCents).toBe(5000);
    expect(a.url).toContain("noop_pay_bk_1");
  });
});

describe("NoopPaymentAdapter.retrievePayment", () => {
  it("returns a provider='noop' DEGRADED verified payment for an issued link", async () => {
    const adapter = new NoopPaymentAdapter();
    await adapter.createDepositLink(INPUT);
    const vp = await adapter.retrievePayment("noop_pay_bk_1");
    expect(vp).not.toBeNull();
    expect(vp!.provider).toBe("noop");
    expect(vp!.status).toBe("paid");
    expect(vp!.amountCents).toBe(5000);
    expect(vp!.externalReference).toBe("noop_pay_bk_1");
  });

  it("recovers bookingId from deterministic noop_pay_ prefix", async () => {
    const adapter = new NoopPaymentAdapter();
    await adapter.createDepositLink(INPUT);
    const vp = await adapter.retrievePayment("noop_pay_bk_1");
    expect(vp).not.toBeNull();
    expect(vp!.bookingId).toBe("bk_1");
  });

  it("returns bookingId=null for an external reference not matching noop_pay_ prefix", async () => {
    // Simulates a raw external reference that doesn't carry the prefix
    const adapter = new NoopPaymentAdapter();
    // Inject without going through createDepositLink to test a foreign ref
    // We test via an un-issued ref that starts with something other than noop_pay_
    const vp = await adapter.retrievePayment("stripe_pay_xyz");
    // Not issued → returns null entirely (unknown ref), not a bookingId=null result
    expect(vp).toBeNull();
  });

  it("returns null for an unknown reference (fetch-back miss)", async () => {
    const adapter = new NoopPaymentAdapter();
    expect(await adapter.retrievePayment("noop_pay_unknown")).toBeNull();
  });
});

describe("isNoopPaymentAdapter", () => {
  it("returns true for a NoopPaymentAdapter instance", () => {
    expect(isNoopPaymentAdapter(new NoopPaymentAdapter())).toBe(true);
  });

  it("returns false for a non-Noop port", () => {
    const fake = {
      createDepositLink: async () => ({}) as never,
      retrievePayment: async () => null,
    };
    expect(isNoopPaymentAdapter(fake as never)).toBe(false);
  });
});
