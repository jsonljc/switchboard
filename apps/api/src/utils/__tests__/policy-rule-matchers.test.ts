import { describe, it, expect } from "vitest";
import type { PolicyRule } from "@switchboard/schemas";
import { extractActionTypeMatchers } from "../policy-rule-matchers.js";

describe("extractActionTypeMatchers", () => {
  it("collects the actionType matcher from a flat rule (the seeded pause shape)", () => {
    const rule: PolicyRule = {
      conditions: [
        { field: "actionType", operator: "matches", value: "^adoptimizer\\.campaign\\.pause$" },
      ],
    };
    expect(extractActionTypeMatchers(rule)).toEqual(["^adoptimizer\\.campaign\\.pause$"]);
  });

  it("collects from nested children (composed rules)", () => {
    const rule: PolicyRule = {
      composition: "AND",
      conditions: [{ field: "riskCategory", operator: "eq", value: "high" }],
      children: [
        {
          conditions: [
            { field: "actionType", operator: "eq", value: "adoptimizer.campaign.pause" },
          ],
        },
      ],
    };
    expect(extractActionTypeMatchers(rule)).toEqual(["adoptimizer.campaign.pause"]);
  });

  it("ignores non-actionType conditions", () => {
    const rule: PolicyRule = {
      conditions: [
        { field: "spendAmount", operator: "gt", value: 100 },
        { field: "actionType", operator: "matches", value: "^x$" },
      ],
    };
    expect(extractActionTypeMatchers(rule)).toEqual(["^x$"]);
  });

  it("expands an `in` operator's array of actionType values", () => {
    const rule: PolicyRule = {
      conditions: [{ field: "actionType", operator: "in", value: ["a.pause", "a.scale"] }],
    };
    expect(extractActionTypeMatchers(rule)).toEqual(["a.pause", "a.scale"]);
  });

  it("returns [] when no actionType condition is present", () => {
    const rule: PolicyRule = {
      conditions: [{ field: "riskCategory", operator: "eq", value: "high" }],
    };
    expect(extractActionTypeMatchers(rule)).toEqual([]);
  });
});
