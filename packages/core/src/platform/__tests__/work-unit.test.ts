import { describe, it, expect } from "vitest";
import { normalizeWorkUnit } from "../work-unit.js";
import type { SubmitWorkRequest } from "../work-unit.js";

const baseRequest: SubmitWorkRequest = {
  organizationId: "org-1",
  actor: { id: "user-1", type: "user" },
  intent: "campaign.pause",
  parameters: { campaignId: "camp-123" },
  deployment: {
    deploymentId: "dep-1",
    skillSlug: "test-skill",
    trustLevel: "guided",
    trustScore: 42,
  },
  trigger: "chat",
};

describe("normalizeWorkUnit", () => {
  it("generates id, traceId, and requestedAt", () => {
    const result = normalizeWorkUnit(baseRequest, "skill");

    expect(result.id).toBeDefined();
    expect(typeof result.id).toBe("string");
    expect(result.id.length).toBeGreaterThan(0);

    expect(result.traceId).toBeDefined();
    expect(typeof result.traceId).toBe("string");
    expect(result.traceId.length).toBeGreaterThan(0);

    expect(result.requestedAt).toBeDefined();
    expect(typeof result.requestedAt).toBe("string");
    expect(() => new Date(result.requestedAt)).not.toThrow();
  });

  it("preserves all request fields", () => {
    const result = normalizeWorkUnit(baseRequest, "skill");

    expect(result.organizationId).toBe(baseRequest.organizationId);
    expect(result.actor).toEqual(baseRequest.actor);
    expect(result.intent).toBe(baseRequest.intent);
    expect(result.parameters).toEqual(baseRequest.parameters);
    expect(result.trigger).toBe(baseRequest.trigger);
  });

  it("sets resolvedMode from argument", () => {
    const result = normalizeWorkUnit(baseRequest, "pipeline");

    expect(result.resolvedMode).toBe("pipeline");
  });

  it("preserves suggestedMode from request", () => {
    const requestWithSuggestedMode: SubmitWorkRequest = {
      ...baseRequest,
      suggestedMode: "cartridge",
    };

    const result = normalizeWorkUnit(requestWithSuggestedMode, "skill");

    expect(result.suggestedMode).toBe("cartridge");
    expect(result.resolvedMode).toBe("skill");
  });

  it("uses caller traceId when provided", () => {
    const requestWithTraceId: SubmitWorkRequest = {
      ...baseRequest,
      traceId: "custom-trace-123",
    };

    const result = normalizeWorkUnit(requestWithTraceId, "skill");

    expect(result.traceId).toBe("custom-trace-123");
  });

  it("generates traceId when not provided", () => {
    const result = normalizeWorkUnit(baseRequest, "skill");

    expect(result.traceId).toBeDefined();
    expect(typeof result.traceId).toBe("string");
    expect(result.traceId.length).toBeGreaterThan(0);
  });

  it("defaults priority to normal when not provided", () => {
    const result = normalizeWorkUnit(baseRequest, "skill");

    expect(result.priority).toBe("normal");
  });

  it("preserves priority when provided", () => {
    const requestWithPriority: SubmitWorkRequest = {
      ...baseRequest,
      priority: "high",
    };

    const result = normalizeWorkUnit(requestWithPriority, "skill");

    expect(result.priority).toBe("high");
  });

  it("preserves parentWorkUnitId and idempotencyKey", () => {
    const requestWithOptionals: SubmitWorkRequest = {
      ...baseRequest,
      parentWorkUnitId: "parent-123",
      idempotencyKey: "idem-456",
    };

    const result = normalizeWorkUnit(requestWithOptionals, "skill");

    expect(result.parentWorkUnitId).toBe("parent-123");
    expect(result.idempotencyKey).toBe("idem-456");
  });
});
