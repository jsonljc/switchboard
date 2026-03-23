import { describe, it, expect } from "vitest";
import { getBehaviorOptions, getRoleDescription } from "../agent-behavior-options.js";

describe("getBehaviorOptions", () => {
  it("returns qualification threshold options for responder", () => {
    const options = getBehaviorOptions("responder");
    expect(options).toHaveLength(1);
    expect(options[0].configKey).toBe("qualificationThreshold");
    expect(options[0].choices).toHaveLength(3);
    expect(options[0].choices[1].value).toBe(40);
  });

  it("returns followUpDays options for strategist", () => {
    const options = getBehaviorOptions("strategist");
    expect(options).toHaveLength(1);
    expect(options[0].configKey).toBe("followUpDays");
    expect(options[0].choices[1].value).toEqual([1, 3, 7]);
  });

  it("returns approvalThreshold options for optimizer", () => {
    const options = getBehaviorOptions("optimizer");
    expect(options).toHaveLength(1);
    expect(options[0].configKey).toBe("approvalThreshold");
    expect(options[0].choices[0].value).toBe(50);
  });

  it("returns empty array for roles without behavior options", () => {
    expect(getBehaviorOptions("booker")).toEqual([]);
    expect(getBehaviorOptions("monitor")).toEqual([]);
    expect(getBehaviorOptions("guardian")).toEqual([]);
    expect(getBehaviorOptions("primary_operator")).toEqual([]);
  });

  it("returns empty array for unknown role", () => {
    expect(getBehaviorOptions("unknown_role")).toEqual([]);
  });
});

describe("getRoleDescription", () => {
  it("returns description for roles without behavior options", () => {
    expect(getRoleDescription("booker")).toBeTruthy();
    expect(getRoleDescription("primary_operator")).toContain("Coordinates");
  });

  it("returns null for roles with behavior options", () => {
    expect(getRoleDescription("responder")).toBeNull();
    expect(getRoleDescription("strategist")).toBeNull();
    expect(getRoleDescription("optimizer")).toBeNull();
  });
});
