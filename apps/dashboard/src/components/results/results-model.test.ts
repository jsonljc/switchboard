import { describe, it, expect } from "vitest";
import { goodFixture, quietFixture } from "@/app/(auth)/(mercury)/reports/fixtures";
import { buildResultsModel, fmtRatio } from "./results-model";

describe("buildResultsModel", () => {
  it("derives bookings from the Bookings stage BY NAME, not index 4", () => {
    const m = buildResultsModel(goodFixture);
    const bookingsRow = goodFixture.funnel.find((f) => f.stage === "Bookings")!;
    expect(m.bookings).toBe(bookingsRow.n);
    expect(m.bookingsDelta).toEqual(bookingsRow.delta);
  });

  it("returns 0 bookings (not a crash) when there is no Bookings stage", () => {
    const noBookings = {
      ...quietFixture,
      funnel: quietFixture.funnel.filter((f) => f.stage !== "Bookings"),
    };
    expect(buildResultsModel(noBookings).bookings).toBe(0);
  });

  it("computes ad spend as the SUM of campaign spend, NOT cost.paid", () => {
    const m = buildResultsModel(goodFixture);
    const sum = goodFixture.campaigns.reduce((s, c) => s + c.spend, 0);
    expect(m.adSpend).toBe(sum);
    expect(m.adSpend).not.toBe(goodFixture.cost.paid);
  });

  it("picks best/worst campaign by roas among campaigns with spend > 0", () => {
    const m = buildResultsModel(goodFixture);
    const spending = goodFixture.campaigns.filter((c) => c.spend > 0);
    const best = spending.reduce((a, b) => (b.roas > a.roas ? b : a));
    const worst = spending.reduce((a, b) => (b.roas < a.roas ? b : a));
    expect(m.bestCampaign?.name).toBe(best.name);
    expect(m.worstCampaign?.name).toBe(worst.name);
  });

  it("yields null best/worst when there are no spending campaigns", () => {
    const m = buildResultsModel({ ...goodFixture, campaigns: [] });
    expect(m.bestCampaign).toBeNull();
    expect(m.worstCampaign).toBeNull();
  });

  it("passes managedComparison through untouched (incl. null)", () => {
    expect(buildResultsModel(quietFixture).managedComparison).toBeNull();
    expect(buildResultsModel(goodFixture).managedComparison).toEqual(goodFixture.managedComparison);
  });

  it("defaults heldRate to { attended: 0, matured: 0, rate: null } when absent from a stale cached payload", () => {
    const stale = { ...goodFixture } as unknown as import("./types").ReportData;
    delete (stale as unknown as Record<string, unknown>)["heldRate"];
    const m = buildResultsModel(stale);
    expect(m.heldRate).toEqual({ attended: 0, matured: 0, rate: null });
  });
});

describe("fmtRatio", () => {
  it("formats a ratio as N×", () => {
    expect(fmtRatio(10.06)).toBe("10.1×");
    expect(fmtRatio(0)).toBe("0.0×");
  });
  it("returns — for null or undefined", () => {
    expect(fmtRatio(null)).toBe("—");
    expect(fmtRatio(undefined)).toBe("—");
  });
});
