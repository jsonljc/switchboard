import { describe, expect, it } from "vitest";
import {
  OperationalIntervalSchema,
  OperationalStateConfirmationSchema,
  OperationalStateSchema,
} from "../operational-state.js";

describe("OperationalStateSchema", () => {
  it("accepts a full confirmation payload", () => {
    const parsed = OperationalStateSchema.parse({
      operatingStatus: "open",
      staffing: "shortfall",
      inventory: "normal",
      promoWindows: [
        {
          start: "2026-06-01T00:00:00.000Z",
          end: "2026-06-15T23:59:59.000Z",
          label: "june glow promo",
        },
      ],
      closures: [],
      note: "lead injector away second week of june",
    });
    expect(parsed.operatingStatus).toBe("open");
    expect(parsed.promoWindows).toHaveLength(1);
    // Explicit empty array = "operator confirmed none", distinct from absent.
    expect(parsed.closures).toEqual([]);
  });

  it("accepts a partial payload and leaves unconfirmed dimensions absent (no fabricated defaults)", () => {
    const parsed = OperationalStateSchema.parse({ staffing: "shortfall" });
    expect(parsed.staffing).toBe("shortfall");
    // Honesty floor: parsing must not invent "open"/"normal"/[] for dimensions
    // the operator never confirmed.
    expect(Object.prototype.hasOwnProperty.call(parsed, "operatingStatus")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(parsed, "inventory")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(parsed, "promoWindows")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(parsed, "closures")).toBe(false);
  });

  it("rejects an empty confirmation (confirming nothing is not a confirmation)", () => {
    expect(OperationalStateSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a note-only payload (a note alone must not create freshness)", () => {
    expect(OperationalStateSchema.safeParse({ note: "all fine here" }).success).toBe(false);
  });

  it("accepts a note alongside an operational dimension", () => {
    const parsed = OperationalStateSchema.parse({ staffing: "normal", note: "back to full team" });
    expect(parsed.note).toBe("back to full team");
  });

  it("rejects inverted and zero-length intervals (end must be strictly after start)", () => {
    expect(
      OperationalStateSchema.safeParse({
        promoWindows: [{ start: "2026-06-15T00:00:00.000Z", end: "2026-06-01T00:00:00.000Z" }],
      }).success,
    ).toBe(false);
    expect(
      OperationalStateSchema.safeParse({
        closures: [{ start: "2026-06-01T00:00:00.000Z", end: "2026-06-01T00:00:00.000Z" }],
      }).success,
    ).toBe(false);
  });

  it("rejects unknown enum values", () => {
    expect(OperationalStateSchema.safeParse({ operatingStatus: "closed" }).success).toBe(false);
    expect(OperationalStateSchema.safeParse({ staffing: "full" }).success).toBe(false);
    expect(OperationalStateSchema.safeParse({ inventory: "low" }).success).toBe(false);
  });

  it("rejects non-datetime interval bounds", () => {
    expect(OperationalStateSchema.safeParse({ promoWindows: [{ start: "june 1" }] }).success).toBe(
      false,
    );
  });

  it("accepts open-ended intervals (end omitted: until further notice)", () => {
    const parsed = OperationalStateSchema.parse({
      closures: [{ start: "2026-06-20T00:00:00.000Z", label: "renovation, reopen date unknown" }],
    });
    expect(parsed.closures?.[0]?.end).toBeUndefined();
  });

  it("rejects an interval without a start", () => {
    expect(OperationalIntervalSchema.safeParse({ end: "2026-06-15T00:00:00.000Z" }).success).toBe(
      false,
    );
  });
});

describe("OperationalStateConfirmationSchema", () => {
  it("round-trips a persisted confirmation row", () => {
    const parsed = OperationalStateConfirmationSchema.parse({
      id: "osc_1",
      organizationId: "org_1",
      state: { operatingStatus: "open" },
      confirmedBy: null,
      confirmedAt: new Date("2026-06-04T10:00:00.000Z"),
      createdAt: new Date("2026-06-04T10:00:00.000Z"),
    });
    expect(parsed.confirmedAt).toBeInstanceOf(Date);
    expect(parsed.confirmedBy).toBeNull();
  });

  it("coerces ISO-string timestamps (rows that crossed a JSON boundary)", () => {
    const parsed = OperationalStateConfirmationSchema.parse({
      id: "osc_1",
      organizationId: "org_1",
      state: { staffing: "normal" },
      confirmedBy: "user_1",
      confirmedAt: "2026-06-04T10:00:00.000Z",
      createdAt: "2026-06-04T10:00:00.000Z",
    });
    expect(parsed.confirmedAt.toISOString()).toBe("2026-06-04T10:00:00.000Z");
  });

  it("rejects a row whose state is empty", () => {
    const result = OperationalStateConfirmationSchema.safeParse({
      id: "osc_1",
      organizationId: "org_1",
      state: {},
      confirmedBy: null,
      confirmedAt: new Date(),
      createdAt: new Date(),
    });
    expect(result.success).toBe(false);
  });
});
