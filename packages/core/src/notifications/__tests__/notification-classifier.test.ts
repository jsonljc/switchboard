import { describe, it, expect } from "vitest";
import { classifyNotification } from "../notification-classifier.js";
import type { NotificationEvent } from "../notification-classifier.js";

describe("classifyNotification", () => {
  // T1 — Act Now
  it("classifies pending_approval as T1", () => {
    const event: NotificationEvent = { type: "pending_approval", deploymentId: "d1", metadata: {} };
    expect(classifyNotification(event)).toBe("T1");
  });

  it("classifies action_failed as T1", () => {
    const event: NotificationEvent = { type: "action_failed", deploymentId: "d1", metadata: {} };
    expect(classifyNotification(event)).toBe("T1");
  });

  it("classifies escalation as T1", () => {
    const event: NotificationEvent = { type: "escalation", deploymentId: "d1", metadata: {} };
    expect(classifyNotification(event)).toBe("T1");
  });

  it("classifies revenue_event as T1", () => {
    const event: NotificationEvent = { type: "revenue_event", deploymentId: "d1", metadata: {} };
    expect(classifyNotification(event)).toBe("T1");
  });

  // T2 — Confirm
  it("classifies fact_learned as T2", () => {
    const event: NotificationEvent = { type: "fact_learned", deploymentId: "d1", metadata: {} };
    expect(classifyNotification(event)).toBe("T2");
  });

  it("classifies faq_drafted as T2", () => {
    const event: NotificationEvent = { type: "faq_drafted", deploymentId: "d1", metadata: {} };
    expect(classifyNotification(event)).toBe("T2");
  });

  it("classifies agent_contradicted as T2", () => {
    const event: NotificationEvent = {
      type: "agent_contradicted",
      deploymentId: "d1",
      metadata: {},
    };
    expect(classifyNotification(event)).toBe("T2");
  });

  // T3 — FYI
  it("classifies weekly_summary as T3", () => {
    const event: NotificationEvent = { type: "weekly_summary", deploymentId: "d1", metadata: {} };
    expect(classifyNotification(event)).toBe("T3");
  });

  it("classifies milestone as T3", () => {
    const event: NotificationEvent = { type: "milestone", deploymentId: "d1", metadata: {} };
    expect(classifyNotification(event)).toBe("T3");
  });

  it("classifies unknown event type as T3 (safe default)", () => {
    const event: NotificationEvent = {
      type: "something_else" as NotificationEvent["type"],
      deploymentId: "d1",
      metadata: {},
    };
    expect(classifyNotification(event)).toBe("T3");
  });

  // Trust level modifiers
  it("upgrades T2 to T1 at observe trust level", () => {
    const event: NotificationEvent = { type: "fact_learned", deploymentId: "d1", metadata: {} };
    expect(classifyNotification(event, "observe")).toBe("T1");
  });

  it("keeps T1 as T1 at autonomous trust level", () => {
    const event: NotificationEvent = { type: "pending_approval", deploymentId: "d1", metadata: {} };
    expect(classifyNotification(event, "autonomous")).toBe("T1");
  });

  it("downgrades T2 to T3 at autonomous trust level", () => {
    const event: NotificationEvent = { type: "fact_learned", deploymentId: "d1", metadata: {} };
    expect(classifyNotification(event, "autonomous")).toBe("T3");
  });
});
