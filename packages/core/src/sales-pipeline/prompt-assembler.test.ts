import { describe, it, expect } from "vitest";
import { assembleSystemPrompt } from "./prompt-assembler.js";
import type { AgentPersona } from "@switchboard/schemas";
import type { SalesPipelineAgentRole } from "./role-prompts.js";

const mockPersona: AgentPersona = {
  id: "p1",
  organizationId: "org1",
  businessName: "Acme Corp",
  businessType: "SaaS",
  productService: "CRM software",
  valueProposition: "Close deals faster",
  tone: "professional",
  qualificationCriteria: { problemFit: "Uses spreadsheets for CRM", timeline: "Within 3 months" },
  disqualificationCriteria: { noEnterprise: "Company over 500 employees" },
  bookingLink: "https://cal.com/acme",
  escalationRules: { onCompetitorMention: "Lead mentions Salesforce or HubSpot" },
  customInstructions: "Always mention our 14-day free trial.",
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("assembleSystemPrompt", () => {
  it("assembles prompt for speed-to-lead", () => {
    const prompt = assembleSystemPrompt("speed-to-lead", mockPersona, "");
    expect(prompt).toContain("Speed-to-Lead Rep for Acme Corp");
    expect(prompt).toContain("Uses spreadsheets for CRM");
    expect(prompt).toContain("14-day free trial");
    expect(prompt).toContain("MANDATORY RULES");
    expect(prompt).not.toContain("{businessName}");
  });

  it("assembles prompt for sales-closer", () => {
    const prompt = assembleSystemPrompt("sales-closer", mockPersona, "");
    expect(prompt).toContain("Sales Closer for Acme Corp");
    expect(prompt).toContain("cal.com/acme");
    expect(prompt).toContain("MANDATORY RULES");
  });

  it("assembles prompt for nurture-specialist", () => {
    const prompt = assembleSystemPrompt("nurture-specialist", mockPersona, "");
    expect(prompt).toContain("Nurture Specialist for Acme Corp");
    expect(prompt).toContain("MANDATORY RULES");
  });

  it("includes conversation context when provided", () => {
    const context = "Lead mentioned they use Google Sheets. Timeline: Q2.";
    const prompt = assembleSystemPrompt("sales-closer", mockPersona, context);
    expect(prompt).toContain("CONVERSATION CONTEXT");
    expect(prompt).toContain("Google Sheets");
  });

  it("omits conversation context section when empty", () => {
    const prompt = assembleSystemPrompt("speed-to-lead", mockPersona, "");
    expect(prompt).not.toContain("CONVERSATION CONTEXT");
  });

  it("replaces all template variables", () => {
    const roles: SalesPipelineAgentRole[] = ["speed-to-lead", "sales-closer", "nurture-specialist"];
    for (const role of roles) {
      const prompt = assembleSystemPrompt(role, mockPersona, "");
      expect(prompt).not.toMatch(/\{[a-zA-Z]+\}/);
    }
  });
});
