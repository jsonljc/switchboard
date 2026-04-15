import { describe, it, expect } from "vitest";
import { createPipelineHandoffTool } from "./pipeline-handoff.js";

const tool = createPipelineHandoffTool();
const determine = tool.operations["determine"]!;

describe("pipeline-handoff.determine", () => {
  it("returns no-action for terminal stages", async () => {
    const result = await determine.execute({
      opportunityStage: "won",
      assignedAgent: "speed-to-lead",
      lastCustomerReplyAt: null,
      dormancyThresholdHours: 24,
    });
    expect(result).toEqual({ action: "none" });
  });

  it("returns no-action for lost stage", async () => {
    const result = await determine.execute({
      opportunityStage: "lost",
      assignedAgent: "speed-to-lead",
      lastCustomerReplyAt: null,
      dormancyThresholdHours: 24,
    });
    expect(result).toEqual({ action: "none" });
  });

  it("detects dormancy when hours exceeded", async () => {
    const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const result = await determine.execute({
      opportunityStage: "interested",
      assignedAgent: "speed-to-lead",
      lastCustomerReplyAt: staleDate,
      dormancyThresholdHours: 24,
    });
    expect(result).toEqual({
      action: "go-dormant",
      toAgent: "nurture-specialist",
      reason: expect.stringContaining("No customer reply for"),
    });
  });

  it("does not trigger dormancy within threshold", async () => {
    const recentDate = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const result = await determine.execute({
      opportunityStage: "interested",
      assignedAgent: "speed-to-lead",
      lastCustomerReplyAt: recentDate,
      dormancyThresholdHours: 24,
    });
    expect(result).toEqual({ action: "none" });
  });

  it("hands off to sales-closer when stage is qualified", async () => {
    const result = await determine.execute({
      opportunityStage: "qualified",
      assignedAgent: "speed-to-lead",
      lastCustomerReplyAt: null,
      dormancyThresholdHours: 24,
    });
    expect(result).toEqual({
      action: "handoff",
      toAgent: "sales-closer",
      reason: "Lead qualified, transitioning to Sales Closer",
    });
  });

  it("hands off to nurture-specialist when stage is nurturing", async () => {
    const result = await determine.execute({
      opportunityStage: "nurturing",
      assignedAgent: "speed-to-lead",
      lastCustomerReplyAt: null,
      dormancyThresholdHours: 24,
    });
    expect(result).toEqual({
      action: "handoff",
      toAgent: "nurture-specialist",
      reason: "Lead entered nurturing stage",
    });
  });

  it("returns no-action when stage and agent are aligned", async () => {
    const result = await determine.execute({
      opportunityStage: "interested",
      assignedAgent: "speed-to-lead",
      lastCustomerReplyAt: new Date().toISOString(),
      dormancyThresholdHours: 24,
    });
    expect(result).toEqual({ action: "none" });
  });

  it("does not trigger dormancy for nurture-specialist already assigned", async () => {
    const staleDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const result = await determine.execute({
      opportunityStage: "nurturing",
      assignedAgent: "nurture-specialist",
      lastCustomerReplyAt: staleDate,
      dormancyThresholdHours: 24,
    });
    expect(result).toEqual({ action: "none" });
  });

  it("has correct inputSchema with enums", () => {
    const schema = determine.inputSchema as { properties: Record<string, { enum?: string[] }> };
    expect(schema.properties["assignedAgent"]?.enum).toEqual([
      "speed-to-lead",
      "sales-closer",
      "nurture-specialist",
    ]);
  });
});
