// A12: cross-package contract for the count-vs-value gate wiring. The weekly audit (inngest.ts)
// wires the SAME PrismaConversionRecordStore instance as both the booked-value AND the paid-value
// provider. This test pins the assignability the wiring relies on: the db store (Layer 4) must
// satisfy the ad-optimizer (Layer 2) PaidValueByCampaignProvider port, and the method must return a
// per-campaign cents Map. If the port and store signatures drift, this reds (tsc on the assignment).
import { describe, it, expect, vi } from "vitest";
import { PrismaConversionRecordStore } from "@switchboard/db";
import type { PaidValueByCampaignProvider } from "@switchboard/ad-optimizer";

describe("A12 paid-value provider wiring (apps/api)", () => {
  it("PrismaConversionRecordStore satisfies the PaidValueByCampaignProvider port the weekly audit consumes", async () => {
    const groupBy = vi
      .fn()
      .mockResolvedValue([{ sourceCampaignId: "camp-1", _sum: { value: 50_000 } }]);
    const store = new PrismaConversionRecordStore({ conversionRecord: { groupBy } } as never);
    // Structural: the store IS assignable to the port (the inngest.ts wiring depends on this).
    const provider: PaidValueByCampaignProvider = store;
    const out = await provider.queryPaidValueCentsByCampaign({
      orgId: "org-1",
      from: new Date("2026-05-01"),
      to: new Date("2026-06-01"),
      campaignIds: ["camp-1"],
    });
    expect(out.get("camp-1")).toBe(50_000);
  });
});
