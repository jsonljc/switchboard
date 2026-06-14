import { describe, it, expect, vi } from "vitest";
import { computeConsentCompleteness } from "./compute-consent-completeness.js";

const ctx = {
  orgId: "o1",
  current: { start: new Date("2026-06-08"), end: new Date("2026-06-15") },
  computedAt: new Date("2026-06-14"),
} as never;

describe("computeConsentCompleteness", () => {
  it("rate = validConsent/bookable", async () => {
    const contacts = {
      countConsentCompleteness: vi.fn(async () => ({ bookable: 45, validConsent: 42 })),
    };
    expect(await computeConsentCompleteness(ctx, contacts as never)).toEqual({
      validConsent: 42,
      bookable: 45,
      rate: 42 / 45,
    });
  });

  it("bookable===0 => rate null (no NaN)", async () => {
    const contacts = {
      countConsentCompleteness: vi.fn(async () => ({ bookable: 0, validConsent: 0 })),
    };
    expect(await computeConsentCompleteness(ctx, contacts as never)).toEqual({
      validConsent: 0,
      bookable: 0,
      rate: null,
    });
  });
});
