import { describe, it, expect } from "vitest";
import type {
  BatchContextRequirement,
  BatchContextContract,
  BatchSkillResult,
} from "./batch-types.js";
import { validateBatchSkillResult } from "./batch-types.js";

describe("BatchContextRequirement", () => {
  it("accepts a valid requirement with scope", () => {
    const req: BatchContextRequirement = {
      key: "campaign_insights",
      source: "ads",
      freshnessSeconds: 3600,
      scope: "current_period",
    };
    expect(req.source).toBe("ads");
    expect(req.scope).toBe("current_period");
  });
});

describe("BatchContextContract", () => {
  it("accepts a contract with multiple requirements", () => {
    const contract: BatchContextContract = {
      required: [
        { key: "campaign_insights", source: "ads", scope: "current_period" },
        { key: "crm_funnel_data", source: "crm" },
        { key: "deployment_config", source: "deployment", freshnessSeconds: 0 },
      ],
    };
    expect(contract.required).toHaveLength(3);
  });
});

describe("validateBatchSkillResult", () => {
  it("passes for a valid result", () => {
    const result: BatchSkillResult = {
      recommendations: [
        {
          type: "scale",
          action: "Increase budget 20%",
          confidence: "high",
          reasoning: "CPA below target",
        },
      ],
      proposedWrites: [],
      summary: "One recommendation produced.",
    };
    expect(() => validateBatchSkillResult(result)).not.toThrow();
  });

  it("throws for missing recommendations", () => {
    expect(() => validateBatchSkillResult({} as unknown)).toThrow("recommendations");
  });

  it("throws for missing summary", () => {
    expect(() =>
      validateBatchSkillResult({ recommendations: [], proposedWrites: [] } as unknown),
    ).toThrow("summary");
  });

  it("passes with proposedWrites", () => {
    const result: BatchSkillResult = {
      recommendations: [],
      proposedWrites: [
        {
          tool: "ads-data",
          operation: "send-conversion-event",
          params: {},
          effectCategory: "external_send",
        },
      ],
      summary: "No recs, one write.",
    };
    expect(() => validateBatchSkillResult(result)).not.toThrow();
  });

  it("passes with nextRunHint", () => {
    const result: BatchSkillResult = {
      recommendations: [],
      proposedWrites: [],
      summary: "Nothing to do.",
      nextRunHint: "run again in 24h",
    };
    expect(result.nextRunHint).toBe("run again in 24h");
    expect(() => validateBatchSkillResult(result)).not.toThrow();
  });
});
