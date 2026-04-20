import { describe, it, expect } from "vitest";
import { translateActivity } from "../activity-translator.js";
import type { RawAuditEntry } from "../activity-translator.js";

describe("translateActivity", () => {
  const base: RawAuditEntry = {
    id: "a1",
    eventType: "action.executed",
    timestamp: "2026-04-20T08:00:00Z",
    actorType: "agent",
    actorId: "alex",
    entityType: "booking",
    entityId: "b1",
    summary: "Booking confirmed for Sarah Chen",
    snapshot: {},
  };

  it("translates action.executed with booking entity", () => {
    const result = translateActivity({
      ...base,
      summary: "Confirmed booking: Teeth Whitening at 2:30 PM for Sarah Chen",
    });

    expect(result.description).toContain("Alex");
    expect(result.description).not.toContain("action.executed");
    expect(result.description).not.toContain("entityId");
    expect(result.dotColor).toBe("green");
  });

  it("translates action.approved", () => {
    const result = translateActivity({
      ...base,
      eventType: "action.approved",
      actorType: "owner",
      actorId: "owner-1",
      summary: "Approved booking for Sarah Chen",
    });

    expect(result.description).toContain("You");
    expect(result.dotColor).toBe("green");
  });

  it("translates action.denied", () => {
    const result = translateActivity({
      ...base,
      eventType: "action.denied",
      actorType: "owner",
      summary: "Denied booking",
    });

    expect(result.dotColor).toBe("amber");
  });

  it("never exposes internal IDs or enum values", () => {
    const result = translateActivity(base);
    expect(result.description).not.toMatch(/[a-f0-9]{8}-[a-f0-9]{4}/);
    expect(result.description).not.toContain("action.executed");
    expect(result.description).not.toContain("entityType");
  });

  it("returns all required fields", () => {
    const result = translateActivity(base);
    expect(result).toHaveProperty("id");
    expect(result).toHaveProperty("type");
    expect(result).toHaveProperty("description");
    expect(result).toHaveProperty("dotColor");
    expect(result).toHaveProperty("createdAt");
    expect(["green", "amber", "blue", "gray"]).toContain(result.dotColor);
  });
});
