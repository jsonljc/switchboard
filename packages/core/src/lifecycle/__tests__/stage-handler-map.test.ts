import { describe, it, expect } from "vitest";
import { DEFAULT_STAGE_HANDLER_MAP, agentForOpportunityStage } from "../stage-handler-map.js";

describe("DEFAULT_STAGE_HANDLER_MAP", () => {
  it("maps all opportunity stages", () => {
    const stages = [
      "interested",
      "qualified",
      "quoted",
      "booked",
      "showed",
      "won",
      "lost",
      "nurturing",
    ];
    for (const stage of stages) {
      expect(
        DEFAULT_STAGE_HANDLER_MAP[stage as keyof typeof DEFAULT_STAGE_HANDLER_MAP],
      ).toBeDefined();
    }
  });

  it("booked has system handler and no fallback", () => {
    expect(DEFAULT_STAGE_HANDLER_MAP.booked.preferredAgent).toBe("system");
    expect(DEFAULT_STAGE_HANDLER_MAP.booked.fallbackType).toBe("none");
  });
});

describe("agentForOpportunityStage", () => {
  const mockRegistry: { get(orgId: string, agentId: string): { status: string } | undefined } = {
    get: (_orgId: string, agentId: string) => {
      if (agentId === "lead-responder") return { status: "active" };
      if (agentId === "sales-closer") return { status: "paused" };
      return undefined;
    },
  };

  it("returns agentId when preferred agent is active", () => {
    const result = agentForOpportunityStage(
      "interested",
      DEFAULT_STAGE_HANDLER_MAP,
      mockRegistry,
      "org-1",
    );
    expect(result).toEqual({ agentId: "lead-responder" });
  });

  it("returns fallback when preferred agent is paused", () => {
    const result = agentForOpportunityStage(
      "qualified",
      DEFAULT_STAGE_HANDLER_MAP,
      mockRegistry,
      "org-1",
    );
    expect(result).toEqual({
      fallback: true,
      missingAgent: "sales-closer",
      reason: "paused",
    });
  });

  it("returns fallback with not_configured when agent does not exist", () => {
    const result = agentForOpportunityStage(
      "nurturing",
      DEFAULT_STAGE_HANDLER_MAP,
      mockRegistry,
      "org-1",
    );
    expect(result).toEqual({
      fallback: true,
      missingAgent: "nurture",
      reason: "not_configured",
    });
  });

  it("returns system handler for booked stage", () => {
    const result = agentForOpportunityStage(
      "booked",
      DEFAULT_STAGE_HANDLER_MAP,
      mockRegistry,
      "org-1",
    );
    expect(result).toEqual({ agentId: "system" });
  });

  it("suppresses dispatch when threadStatus is waiting_on_customer", () => {
    const result = agentForOpportunityStage(
      "interested",
      DEFAULT_STAGE_HANDLER_MAP,
      mockRegistry,
      "org-1",
      "waiting_on_customer",
    );
    expect(result).toEqual({ suppress: true, reason: "waiting_on_customer" });
  });
});
