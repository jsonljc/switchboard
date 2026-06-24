import { describe, it, expect } from "vitest";
import { resolveAuditNumerics } from "../audit-config-resolver.js";

describe("resolveAuditNumerics (A21: weekly-audit numeric config coercion)", () => {
  it("coerces the seeder's string shape to numbers (targetCPA:'30' -> 30)", () => {
    // seed-marketplace.ts stores these as `type:"text"` form values, i.e. strings.
    const result = resolveAuditNumerics({
      targetCPA: "30",
      targetROAS: "2.5",
      monthlyBudget: "3000",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.targetCPA).toBe(30);
    expect(typeof result.targetCPA).toBe("number");
    expect(result.targetROAS).toBe(2.5);
  });

  it("applies the historical defaults when fields are absent", () => {
    const result = resolveAuditNumerics({});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.targetCPA).toBe(100);
    expect(result.targetROAS).toBe(3);
    expect(result.targetCostPerBooked).toBeUndefined();
  });

  it("includes a positive coerced targetCostPerBooked but omits a zero/absent one", () => {
    const present = resolveAuditNumerics({ targetCostPerBooked: "1500" });
    expect(present.ok && present.targetCostPerBooked).toBe(1500);

    const zero = resolveAuditNumerics({ targetCostPerBooked: "0" });
    expect(zero.ok).toBe(true);
    if (!zero.ok) throw new Error("expected ok");
    // 0 is "not set" for the booked-CAC tier; the cron's `cpb > 0` guard would drop it,
    // so the resolver omits it rather than passing a meaningless 0 through.
    expect(zero.targetCostPerBooked).toBeUndefined();
  });

  it("fails CLOSED on a malformed numeric (currency/percent text), never NaN", () => {
    // The bug: an un-coerced "$1,500" reaches budget-analyzer as a string; `cpa > "$1,500"`
    // is `cpa > NaN` (always false) so every breach/pause/add_creative rec is silently
    // suppressed, and the first real breach hits `targetCPA.toFixed(2)` -> throws.
    const result = resolveAuditNumerics({ targetCPA: "$1,500" });
    expect(result.ok).toBe(false);
  });

  it("treats empty/whitespace form fields as unset (defaults), not malformed", () => {
    const result = resolveAuditNumerics({ targetCPA: "", targetROAS: "  " });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.targetCPA).toBe(100);
    expect(result.targetROAS).toBe(3);
  });

  it("tolerates a null inputConfig (defaults, no throw)", () => {
    const result = resolveAuditNumerics(null);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.targetCPA).toBe(100);
  });
});
