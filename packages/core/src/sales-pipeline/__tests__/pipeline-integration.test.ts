import { describe, it, expect } from "vitest";
import { assembleSystemPrompt } from "../prompt-assembler.js";
import { determineHandoff, type PipelineState } from "../pipeline-orchestrator.js";
import type { AgentPersona } from "@switchboard/schemas";

const persona: AgentPersona = {
  id: "p1",
  organizationId: "org1",
  businessName: "TestCo",
  businessType: "Services",
  productService: "Web design",
  valueProposition: "Beautiful websites in 2 weeks",
  tone: "casual",
  qualificationCriteria: { budget: "Over $5k", timeline: "Within 1 month" },
  disqualificationCriteria: { scope: "Enterprise redesigns" },
  bookingLink: null,
  escalationRules: { onFrustration: true },
  customInstructions: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("Sales Pipeline Integration", () => {
  it("assembles speed-to-lead prompt, then hands off to sales-closer on qualification", () => {
    // Phase 1: Speed-to-Lead is active
    const state1: PipelineState = {
      opportunityStage: "interested",
      assignedAgent: "speed-to-lead",
      messageCount: 8,
      lastCustomerReplyAt: new Date(),
      dormancyThresholdHours: 24,
    };
    const prompt1 = assembleSystemPrompt("speed-to-lead", persona, "");
    expect(prompt1).toContain("Speed-to-Lead Rep for TestCo");
    expect(determineHandoff(state1)).toEqual({ action: "none" });

    // Phase 2: Lead qualifies → handoff
    const state2: PipelineState = { ...state1, opportunityStage: "qualified" };
    const handoff = determineHandoff(state2);
    expect(handoff).toEqual({
      action: "handoff",
      toAgent: "sales-closer",
      reason: "Lead qualified, transitioning to Sales Closer",
    });

    // Phase 3: Sales Closer picks up with context
    const prompt2 = assembleSystemPrompt(
      "sales-closer",
      persona,
      "Lead interested in homepage redesign. Budget: $8k. Timeline: 3 weeks.",
    );
    expect(prompt2).toContain("Sales Closer for TestCo");
    expect(prompt2).toContain("homepage redesign");
  });

  it("transitions to nurture on dormancy, then re-engages", () => {
    // Lead goes cold
    const staleDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const state: PipelineState = {
      opportunityStage: "interested",
      assignedAgent: "speed-to-lead",
      messageCount: 5,
      lastCustomerReplyAt: staleDate,
      dormancyThresholdHours: 24,
    };
    const dormancy = determineHandoff(state);
    expect(dormancy.action).toBe("go-dormant");

    // Nurture specialist active
    const nurture: PipelineState = {
      ...state,
      opportunityStage: "nurturing",
      assignedAgent: "nurture-specialist",
      lastCustomerReplyAt: new Date(),
    };
    expect(determineHandoff(nurture)).toEqual({ action: "none" });

    // Re-engagement → back to qualification
    const reEngage: PipelineState = {
      ...nurture,
      opportunityStage: "interested",
    };
    const backToQual = determineHandoff(reEngage);
    expect(backToQual).toEqual({
      action: "handoff",
      toAgent: "speed-to-lead",
      reason: "Re-engaged lead needs qualification",
    });
  });

  it("stops pipeline on terminal stages", () => {
    const won: PipelineState = {
      opportunityStage: "won",
      assignedAgent: "sales-closer",
      messageCount: 20,
      lastCustomerReplyAt: new Date(),
      dormancyThresholdHours: 24,
    };
    expect(determineHandoff(won)).toEqual({ action: "none" });

    const lost: PipelineState = { ...won, opportunityStage: "lost" };
    expect(determineHandoff(lost)).toEqual({ action: "none" });
  });
});
