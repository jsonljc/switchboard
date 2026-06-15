import { describe, expect, it } from "vitest";
import {
  summarizeConvertingServices,
  renderFrontlineConversionContext,
  MAX_CONVERTING_SERVICES,
} from "./frontline-conversion.js";
import type { FrontlineBookingRow } from "./frontline-conversion.js";

// Real ledger rows always carry a status; default the helper to a live booking.
const b = (service: string, bookingStatus = "confirmed"): FrontlineBookingRow => ({
  service,
  bookingStatus,
});

describe("summarizeConvertingServices", () => {
  it("returns an empty list for no rows", () => {
    expect(summarizeConvertingServices([])).toEqual([]);
  });

  it("counts bookings per service, sorted by count desc", () => {
    const rows = [b("Botox"), b("Botox"), b("Lip filler")];
    expect(summarizeConvertingServices(rows)).toEqual([
      { service: "Botox", bookedCount: 2 },
      { service: "Lip filler", bookedCount: 1 },
    ]);
  });

  it("breaks ties deterministically by service name ascending", () => {
    const rows = [b("Filler"), b("Botox")];
    expect(summarizeConvertingServices(rows)).toEqual([
      { service: "Botox", bookedCount: 1 },
      { service: "Filler", bookedCount: 1 },
    ]);
  });

  it("skips blank or whitespace-only service rows (no phantom bucket)", () => {
    const rows = [b("Botox"), b(""), b("   ")];
    expect(summarizeConvertingServices(rows)).toEqual([{ service: "Botox", bookedCount: 1 }]);
  });

  it("trims surrounding whitespace so the same service does not split", () => {
    const rows = [b("Botox"), b(" Botox ")];
    expect(summarizeConvertingServices(rows)).toEqual([{ service: "Botox", bookedCount: 2 }]);
  });

  it("excludes failed and cancelled bookings (the codebase active-booking standard)", () => {
    // Cancelled/failed bookings are not "what converts"; they must not inflate a
    // service the brief tells Mira to weight. Mirrors the booking store's
    // notIn:["failed","cancelled"] active-booking filter. pending_confirmation
    // is a live (not-yet-cancelled) booking and still counts.
    const rows = [
      b("Botox"),
      b("Botox", "cancelled"),
      b("Botox", "failed"),
      b("Lip filler", "pending_confirmation"),
    ];
    expect(summarizeConvertingServices(rows)).toEqual([
      { service: "Botox", bookedCount: 1 },
      { service: "Lip filler", bookedCount: 1 },
    ]);
  });

  it("caps at MAX_CONVERTING_SERVICES, keeping the highest-count services", () => {
    // 6 distinct services; the cap is 5. "Top6" has the most bookings (3),
    // the rest have 1 each; sorted/tied alphabetically, "Top6" leads and the
    // last alphabetical single-count service ("F") is dropped.
    const rows = [b("Top6"), b("Top6"), b("Top6"), b("A"), b("B"), b("C"), b("D"), b("F")];
    const out = summarizeConvertingServices(rows);
    expect(out).toHaveLength(MAX_CONVERTING_SERVICES);
    expect(out[0]).toEqual({ service: "Top6", bookedCount: 3 });
    expect(out.map((s) => s.service)).toEqual(["Top6", "A", "B", "C", "D"]);
  });

  it("honors an explicit topN", () => {
    const rows = [b("A"), b("B"), b("C")];
    expect(summarizeConvertingServices(rows, { topN: 2 })).toHaveLength(2);
  });
});

describe("renderFrontlineConversionContext", () => {
  it("returns an empty string when there is no signal", () => {
    expect(renderFrontlineConversionContext([])).toBe("");
  });

  it("renders a single deterministic line naming services and counts", () => {
    const line = renderFrontlineConversionContext([
      { service: "Botox", bookedCount: 2 },
      { service: "Lip filler", bookedCount: 1 },
    ]);
    expect(line).toContain("Botox");
    expect(line).toContain("2");
    expect(line).toContain("Lip filler");
    expect(line).not.toContain("\n");
  });
});
