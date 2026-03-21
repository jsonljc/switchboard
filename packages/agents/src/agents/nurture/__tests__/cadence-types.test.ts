import { describe, it, expect } from "vitest";
import { CADENCE_TYPES, getCadenceConfig } from "../cadence-types.js";

describe("cadence-types", () => {
  it("defines exactly 5 cadence types", () => {
    expect(Object.keys(CADENCE_TYPES)).toHaveLength(5);
  });

  it("includes consultation-reminder with 24h and 2h steps", () => {
    const cadence = CADENCE_TYPES["consultation-reminder"];
    expect(cadence).toBeDefined();
    expect(cadence!.steps).toHaveLength(2);
    expect(cadence!.steps[0]!.delayHours).toBe(0);
    expect(cadence!.steps[1]!.delayHours).toBe(22);
  });

  it("includes no-show-recovery with same-day and 3-day steps", () => {
    const cadence = CADENCE_TYPES["no-show-recovery"];
    expect(cadence).toBeDefined();
    expect(cadence!.steps).toHaveLength(2);
  });

  it("includes post-treatment-review with 7-day default", () => {
    const cadence = CADENCE_TYPES["post-treatment-review"];
    expect(cadence).toBeDefined();
    expect(cadence!.defaultDelayDays).toBe(7);
  });

  it("includes cold-lead-winback with 30-day trigger", () => {
    const cadence = CADENCE_TYPES["cold-lead-winback"];
    expect(cadence).toBeDefined();
    expect(cadence!.triggerAfterDays).toBe(30);
  });

  it("includes dormant-client with 60-day trigger", () => {
    const cadence = CADENCE_TYPES["dormant-client"];
    expect(cadence).toBeDefined();
    expect(cadence!.triggerAfterDays).toBe(60);
  });

  it("getCadenceConfig returns undefined for unknown cadence", () => {
    expect(getCadenceConfig("nonexistent")).toBeUndefined();
  });
});
