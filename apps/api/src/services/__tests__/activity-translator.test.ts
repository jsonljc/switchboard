import { describe, it, expect } from "vitest";
import { resolveAgentKey, translateActivity, type RawAuditEntry } from "../activity-translator.js";

function entry(overrides: Partial<RawAuditEntry> = {}): RawAuditEntry {
  return {
    id: "a-1",
    eventType: "action.executed",
    timestamp: "2026-05-01T10:00:00Z",
    actorType: "agent",
    actorId: "alex",
    entityType: "x",
    entityId: "y",
    summary: "did a thing",
    snapshot: {},
    ...overrides,
  };
}

describe("resolveAgentKey", () => {
  it("returns 'alex' for actorType=agent + actorId starting with alex", () => {
    expect(resolveAgentKey(entry({ actorType: "agent", actorId: "alex" }))).toBe("alex");
    expect(resolveAgentKey(entry({ actorType: "agent", actorId: "alex_456" }))).toBe("alex");
  });
  it("returns 'nova' for actorId nova / nova-anything", () => {
    expect(resolveAgentKey(entry({ actorType: "agent", actorId: "nova" }))).toBe("nova");
  });
  it("returns 'mira' for actorId mira", () => {
    expect(resolveAgentKey(entry({ actorType: "agent", actorId: "mira" }))).toBe("mira");
  });
  it("returns null for system actor", () => {
    expect(resolveAgentKey(entry({ actorType: "system", actorId: "" }))).toBeNull();
  });
  it("returns null for owner / operator (these are the human, not an agent)", () => {
    expect(resolveAgentKey(entry({ actorType: "owner", actorId: "u-1" }))).toBeNull();
    expect(resolveAgentKey(entry({ actorType: "operator", actorId: "u-1" }))).toBeNull();
  });
  it("returns null for an unknown agent actorId (not Alex/Nova/Mira)", () => {
    expect(resolveAgentKey(entry({ actorType: "agent", actorId: "unknown" }))).toBeNull();
  });
});

describe("translateActivity carries the structured agent field", () => {
  it("attaches agent='alex' for an Alex-actor entry", () => {
    const t = translateActivity(entry({ actorType: "agent", actorId: "alex" }));
    expect(t.agent).toBe("alex");
  });
});
