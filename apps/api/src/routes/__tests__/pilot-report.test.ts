import { describe, it, expect } from "vitest";

/**
 * Pure-logic tests for pilot report aggregation math.
 * These validate the calculations used in the pilot report endpoint.
 */

function computeConversionRate(leads: number, payingPatients: number): number | null {
  if (leads === 0) return null;
  return Math.round((payingPatients / leads) * 100);
}

function computeCostPerPatient(adSpend: number, payingPatients: number): number | null {
  return payingPatients > 0 ? Math.round(adSpend / payingPatients) : null;
}

function computeFunnelDropOffs(funnel: {
  leads: number;
  qualified: number;
  booked: number;
  showedUp: number;
  paid: number;
}) {
  return {
    qualifiedRate: funnel.leads > 0 ? Math.round((funnel.qualified / funnel.leads) * 100) : null,
    bookedRate: funnel.qualified > 0 ? Math.round((funnel.booked / funnel.qualified) * 100) : null,
    showRate: funnel.booked > 0 ? Math.round((funnel.showedUp / funnel.booked) * 100) : null,
    paidRate: funnel.showedUp > 0 ? Math.round((funnel.paid / funnel.showedUp) * 100) : null,
  };
}

function computeRoas(totalRevenue: number, adSpend: number): number | null {
  if (adSpend === 0) return null;
  return Math.round((totalRevenue / adSpend) * 10) / 10;
}

describe("PilotReport aggregation", () => {
  it("computes conversion rate from leads and revenue events", () => {
    expect(computeConversionRate(40, 14)).toBe(35);
  });

  it("returns null conversion rate when no leads", () => {
    expect(computeConversionRate(0, 0)).toBeNull();
  });

  it("computes cost per paying patient", () => {
    expect(computeCostPerPatient(2000, 14)).toBe(143);
  });

  it("returns null cost per paying patient when no revenue events", () => {
    expect(computeCostPerPatient(2000, 0)).toBeNull();
  });

  it("computes funnel drop-offs", () => {
    const funnel = { leads: 40, qualified: 28, booked: 18, showedUp: 16, paid: 14 };
    const dropOffs = computeFunnelDropOffs(funnel);
    expect(dropOffs.qualifiedRate).toBe(70);
    expect(dropOffs.bookedRate).toBe(64);
    expect(dropOffs.showRate).toBe(89);
    expect(dropOffs.paidRate).toBe(88);
  });

  it("handles zero values in funnel gracefully", () => {
    const funnel = { leads: 0, qualified: 0, booked: 0, showedUp: 0, paid: 0 };
    const dropOffs = computeFunnelDropOffs(funnel);
    expect(dropOffs.qualifiedRate).toBeNull();
    expect(dropOffs.bookedRate).toBeNull();
    expect(dropOffs.showRate).toBeNull();
    expect(dropOffs.paidRate).toBeNull();
  });

  it("computes ROAS correctly", () => {
    expect(computeRoas(7000, 2000)).toBe(3.5);
  });

  it("returns null ROAS when ad spend is zero", () => {
    expect(computeRoas(7000, 0)).toBeNull();
  });
});
