import { describe, expect, it } from "vitest";
import { adaptRecommendation } from "../recommendation-adapter.js";
import type { Recommendation } from "../../../recommendations/types.js";
import type { RouteTemplates } from "@switchboard/core";

const testRouteTemplates: RouteTemplates = {
  contactDetail: (id) => `/contacts/${id}`,
  contactConversations: (id) => `/contacts/${id}/conversations`,
  contactConversationDetail: (id, threadId) => `/contacts/${id}/conversations/${threadId}`,
};
const deps = { routeTemplates: testRouteTemplates };

function makeRec(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: "rec-1",
    orgId: "org-1",
    agentKey: "riley",
    intent: "recommendation.ad_set_pause",
    action: "pause",
    humanSummary: "Pause Q2-Lookalikes — frequency hit 4.8.",
    confidence: 0.85,
    dollarsAtRisk: 400,
    riskLevel: "medium",
    surface: "queue",
    status: "pending",
    parameters: {
      __recommendation: {
        action: "pause",
        presentation: {
          primaryLabel: "Pause",
          secondaryLabel: "Reduce 50%",
          dismissLabel: "Dismiss",
          dataLines: ["frequency 4.8", "CPA up 96%"],
        },
      },
    },
    targetEntities: { contactId: "c-maya", contactName: "Maya R." },
    sourceAgent: "riley",
    sourceWorkflow: null,
    actedBy: null,
    actedAt: null,
    note: null,
    createdAt: new Date("2026-05-01T12:00:00Z"),
    expiresAt: null,
    undoableUntil: null,
    ...overrides,
  };
}

describe("adaptRecommendation", () => {
  it("namespaces the id as 'approval:<sourceId>'", () => {
    const decision = adaptRecommendation(makeRec(), deps);
    expect(decision.id).toBe("approval:rec-1");
    expect(decision.sourceRef).toEqual({ kind: "approval", sourceId: "rec-1" });
  });

  it("passes through humanSummary, agentKey, orgId", () => {
    const decision = adaptRecommendation(makeRec(), deps);
    expect(decision.humanSummary).toBe("Pause Q2-Lookalikes — frequency hit 4.8.");
    expect(decision.agentKey).toBe("riley");
    expect(decision.orgId).toBe("org-1");
  });

  it("extracts presentation from parameters.__recommendation", () => {
    const decision = adaptRecommendation(makeRec(), deps);
    expect(decision.presentation.primaryLabel).toBe("Pause");
    expect(decision.presentation.dataLines).toEqual(["frequency 4.8", "CPA up 96%"]);
  });

  it("uses fallback presentation when parameters.__recommendation is missing", () => {
    const decision = adaptRecommendation(makeRec({ parameters: {} }), deps);
    expect(decision.presentation.primaryLabel).toBe("Approve");
    expect(decision.presentation.secondaryLabel).toBe("Edit");
    expect(decision.presentation.dismissLabel).toBe("Dismiss");
  });

  it("populates meta with riskLevel and undoableUntil", () => {
    const undoableUntil = new Date("2026-05-01T13:00:00Z");
    const decision = adaptRecommendation(makeRec({ undoableUntil }), deps);
    expect(decision.meta.riskLevel).toBe("medium");
    expect(decision.meta.undoableUntil).toBe(undoableUntil);
  });

  it("populates meta.contactName from targetEntities", () => {
    const decision = adaptRecommendation(makeRec(), deps);
    expect(decision.meta.contactName).toBe("Maya R.");
  });

  it("emits threadHref from routeTemplates when contactId is present", () => {
    const decision = adaptRecommendation(makeRec(), deps);
    expect(decision.threadHref).toBe("/contacts/c-maya/conversations");
  });

  it("emits null threadHref when targetEntities lacks contactId", () => {
    const decision = adaptRecommendation(makeRec({ targetEntities: {} }), deps);
    expect(decision.threadHref).toBeNull();
  });
});
