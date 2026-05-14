// apps/dashboard/src/lib/cockpit/__tests__/activity-kind-map.test.ts
import { describe, it, expect } from "vitest";
import { translatedActionToActivityRow } from "../activity-kind-map";
import type { TranslatedAction } from "@/hooks/use-agent-activity";

const NOW = new Date("2026-05-14T12:00:00Z");

function makeAction(overrides: Partial<TranslatedAction> = {}): TranslatedAction {
  return {
    id: "a1",
    agentRole: "alex",
    text: "Confirmed Saturday 10 AM tour",
    icon: "success",
    timestamp: "2026-05-14T11:42:00Z",
    eventType: "booking.created",
    entityType: "Booking",
    entityId: "b1",
    ...overrides,
  };
}

describe("translatedActionToActivityRow", () => {
  it("maps booking.created → booked kind", () => {
    const row = translatedActionToActivityRow(makeAction(), NOW);
    expect(row.kind).toBe("booked");
    expect(row.head).toBe("Confirmed Saturday 10 AM tour");
  });

  it("maps lifecycle qualified events → qualified", () => {
    const row = translatedActionToActivityRow(
      makeAction({ eventType: "lifecycle.qualified" }),
      NOW,
    );
    expect(row.kind).toBe("qualified");
  });

  it("maps message.sent → replied", () => {
    const row = translatedActionToActivityRow(makeAction({ eventType: "message.sent" }), NOW);
    expect(row.kind).toBe("replied");
  });

  it("maps approval.created → waiting", () => {
    const row = translatedActionToActivityRow(makeAction({ eventType: "approval.created" }), NOW);
    expect(row.kind).toBe("waiting");
  });

  it("maps escalate events → escalated", () => {
    const row = translatedActionToActivityRow(makeAction({ eventType: "escalation.created" }), NOW);
    expect(row.kind).toBe("escalated");
  });

  it("falls back to sent for unknown eventTypes", () => {
    const row = translatedActionToActivityRow(makeAction({ eventType: "unknown.thing" }), NOW);
    expect(row.kind).toBe("sent");
  });

  it("renders absolute time HH:MM for same-day, weekday for older", () => {
    const sameDay = translatedActionToActivityRow(
      makeAction({ timestamp: "2026-05-14T11:42:00Z" }),
      NOW,
    );
    expect(sameDay.time).toMatch(/^\d{2}:\d{2}$/);
    const oldRow = translatedActionToActivityRow(
      makeAction({ timestamp: "2026-05-09T11:42:00Z" }),
      NOW,
    );
    expect(oldRow.time).toBe("Sat");
  });
});
