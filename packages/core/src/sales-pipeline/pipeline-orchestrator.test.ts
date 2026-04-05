import { describe, it, expect } from "vitest";
import {
  determineHandoff,
  type PipelineState,
  type HandoffResult,
} from "./pipeline-orchestrator.js";

describe("determineHandoff", () => {
  const base: PipelineState = {
    opportunityStage: "interested",
    assignedAgent: "speed-to-lead",
    messageCount: 5,
    lastCustomerReplyAt: new Date(),
    dormancyThresholdHours: 24,
  };

  it("hands off to sales-closer when opportunity is qualified", () => {
    const result = determineHandoff({ ...base, opportunityStage: "qualified" });
    expect(result).toEqual<HandoffResult>({
      action: "handoff",
      toAgent: "sales-closer",
      reason: "Lead qualified, transitioning to Sales Closer",
    });
  });

  it("hands off to nurture-specialist when opportunity is nurturing", () => {
    const result = determineHandoff({ ...base, opportunityStage: "nurturing" });
    expect(result).toEqual<HandoffResult>({
      action: "handoff",
      toAgent: "nurture-specialist",
      reason: "Lead entered nurturing stage",
    });
  });

  it("returns no-action when stage and agent are aligned", () => {
    const result = determineHandoff(base);
    expect(result).toEqual<HandoffResult>({ action: "none" });
  });

  it("returns no-action for terminal stages", () => {
    const result = determineHandoff({ ...base, opportunityStage: "won" });
    expect(result).toEqual<HandoffResult>({ action: "none" });
  });

  it("hands off to speed-to-lead when re-engagement needs qualification", () => {
    const result = determineHandoff({
      ...base,
      opportunityStage: "interested",
      assignedAgent: "nurture-specialist",
    });
    expect(result).toEqual<HandoffResult>({
      action: "handoff",
      toAgent: "speed-to-lead",
      reason: "Re-engaged lead needs qualification",
    });
  });

  it("detects dormancy based on time threshold", () => {
    const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago
    const result = determineHandoff({
      ...base,
      lastCustomerReplyAt: staleDate,
    });
    expect(result).toEqual<HandoffResult>({
      action: "go-dormant",
      toAgent: "nurture-specialist",
      reason: "No customer reply for 25 hours, entering nurture",
    });
  });

  it("does not trigger dormancy within threshold", () => {
    const recentDate = new Date(Date.now() - 12 * 60 * 60 * 1000); // 12 hours ago
    const result = determineHandoff({
      ...base,
      lastCustomerReplyAt: recentDate,
    });
    expect(result).toEqual<HandoffResult>({ action: "none" });
  });
});
