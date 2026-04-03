import { describe, it, expect } from "vitest";
import {
  ScheduledTriggerSchema,
  TriggerTypeSchema,
  TriggerStatusSchema,
  TriggerActionSchema,
  TriggerActionTypeSchema,
  EventPatternSchema,
  TriggerFiltersSchema,
  TERMINAL_TRIGGER_STATUSES,
} from "../scheduler.js";

describe("ScheduledTrigger schemas", () => {
  describe("TriggerTypeSchema", () => {
    it("accepts valid trigger types", () => {
      expect(TriggerTypeSchema.parse("timer")).toBe("timer");
      expect(TriggerTypeSchema.parse("cron")).toBe("cron");
      expect(TriggerTypeSchema.parse("event_match")).toBe("event_match");
    });

    it("rejects invalid trigger types", () => {
      expect(() => TriggerTypeSchema.parse("webhook")).toThrow();
    });
  });

  describe("TriggerStatusSchema", () => {
    it("accepts valid statuses", () => {
      expect(TriggerStatusSchema.parse("active")).toBe("active");
      expect(TriggerStatusSchema.parse("fired")).toBe("fired");
      expect(TriggerStatusSchema.parse("cancelled")).toBe("cancelled");
      expect(TriggerStatusSchema.parse("expired")).toBe("expired");
    });
  });

  describe("TERMINAL_TRIGGER_STATUSES", () => {
    it("contains fired, cancelled, expired", () => {
      expect(TERMINAL_TRIGGER_STATUSES).toContain("fired");
      expect(TERMINAL_TRIGGER_STATUSES).toContain("cancelled");
      expect(TERMINAL_TRIGGER_STATUSES).toContain("expired");
      expect(TERMINAL_TRIGGER_STATUSES).not.toContain("active");
    });
  });

  describe("TriggerActionTypeSchema", () => {
    it("accepts valid action types", () => {
      expect(TriggerActionTypeSchema.parse("spawn_workflow")).toBe("spawn_workflow");
      expect(TriggerActionTypeSchema.parse("resume_workflow")).toBe("resume_workflow");
      expect(TriggerActionTypeSchema.parse("emit_event")).toBe("emit_event");
    });

    it("rejects invalid action types", () => {
      expect(() => TriggerActionTypeSchema.parse("send_email")).toThrow();
    });
  });

  describe("TriggerActionSchema", () => {
    it("accepts spawn_workflow action", () => {
      const result = TriggerActionSchema.parse({
        type: "spawn_workflow",
        payload: { sourceAgent: "employee-c", intent: "recheck_roas" },
      });
      expect(result.type).toBe("spawn_workflow");
    });

    it("accepts resume_workflow action", () => {
      const result = TriggerActionSchema.parse({
        type: "resume_workflow",
        payload: { workflowId: "wf-123" },
      });
      expect(result.type).toBe("resume_workflow");
    });

    it("accepts emit_event action", () => {
      const result = TriggerActionSchema.parse({
        type: "emit_event",
        payload: { eventType: "follow_up.due", contactId: "c-1" },
      });
      expect(result.type).toBe("emit_event");
    });
  });

  describe("EventPatternSchema", () => {
    it("accepts a pattern with type and filters", () => {
      const result = EventPatternSchema.parse({
        type: "ad.anomaly_detected",
        filters: { severity: "high" },
      });
      expect(result.type).toBe("ad.anomaly_detected");
      expect(result.filters).toEqual({ severity: "high" });
    });

    it("accepts a pattern with empty filters", () => {
      const result = EventPatternSchema.parse({
        type: "payment.received",
        filters: {},
      });
      expect(result.filters).toEqual({});
    });
  });

  describe("ScheduledTriggerSchema", () => {
    const baseTrigger = {
      id: "trig-1",
      organizationId: "org-1",
      status: "active" as const,
      action: { type: "spawn_workflow" as const, payload: {} },
      sourceWorkflowId: null,
      createdAt: new Date(),
      expiresAt: null,
    };

    it("accepts a timer trigger", () => {
      const result = ScheduledTriggerSchema.parse({
        ...baseTrigger,
        type: "timer",
        fireAt: new Date("2026-04-01T10:00:00Z"),
        cronExpression: null,
        eventPattern: null,
      });
      expect(result.type).toBe("timer");
      expect(result.fireAt).toBeInstanceOf(Date);
    });

    it("accepts a cron trigger", () => {
      const result = ScheduledTriggerSchema.parse({
        ...baseTrigger,
        type: "cron",
        fireAt: null,
        cronExpression: "0 9 * * 1-5",
        eventPattern: null,
      });
      expect(result.type).toBe("cron");
      expect(result.cronExpression).toBe("0 9 * * 1-5");
    });

    it("accepts an event_match trigger", () => {
      const result = ScheduledTriggerSchema.parse({
        ...baseTrigger,
        type: "event_match",
        fireAt: null,
        cronExpression: null,
        eventPattern: { type: "payment.received", filters: {} },
      });
      expect(result.type).toBe("event_match");
    });

    it("rejects timer trigger without fireAt", () => {
      expect(() =>
        ScheduledTriggerSchema.parse({
          ...baseTrigger,
          type: "timer",
          fireAt: null,
          cronExpression: null,
          eventPattern: null,
        }),
      ).toThrow();
    });

    it("rejects cron trigger without cronExpression", () => {
      expect(() =>
        ScheduledTriggerSchema.parse({
          ...baseTrigger,
          type: "cron",
          fireAt: null,
          cronExpression: null,
          eventPattern: null,
        }),
      ).toThrow();
    });

    it("rejects event_match trigger without eventPattern", () => {
      expect(() =>
        ScheduledTriggerSchema.parse({
          ...baseTrigger,
          type: "event_match",
          fireAt: null,
          cronExpression: null,
          eventPattern: null,
        }),
      ).toThrow();
    });
  });

  describe("TriggerFiltersSchema", () => {
    it("accepts organizationId filter", () => {
      const result = TriggerFiltersSchema.parse({ organizationId: "org-1" });
      expect(result.organizationId).toBe("org-1");
    });

    it("accepts status filter", () => {
      const result = TriggerFiltersSchema.parse({ status: "active" });
      expect(result.status).toBe("active");
    });

    it("accepts sourceWorkflowId filter", () => {
      const result = TriggerFiltersSchema.parse({ sourceWorkflowId: "wf-1" });
      expect(result.sourceWorkflowId).toBe("wf-1");
    });

    it("accepts combined filters", () => {
      const result = TriggerFiltersSchema.parse({
        organizationId: "org-1",
        status: "active",
        type: "timer",
      });
      expect(result.organizationId).toBe("org-1");
      expect(result.status).toBe("active");
    });

    it("accepts empty filters", () => {
      const result = TriggerFiltersSchema.parse({});
      expect(result).toEqual({});
    });
  });
});
