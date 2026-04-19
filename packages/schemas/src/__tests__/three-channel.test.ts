import { describe, it, expect } from "vitest";
import {
  AgentEventSchema,
  ActivityLogSchema,
  TrustLevelSchema,
  NotificationTierSchema,
  AgentEventStatusSchema,
  ActivityLogEventTypeSchema,
} from "../three-channel.js";

describe("Three-Channel Schemas", () => {
  describe("TrustLevelSchema", () => {
    it("accepts valid trust levels", () => {
      expect(TrustLevelSchema.parse("observe")).toBe("observe");
      expect(TrustLevelSchema.parse("guarded")).toBe("guarded");
      expect(TrustLevelSchema.parse("autonomous")).toBe("autonomous");
    });

    it("rejects invalid trust level", () => {
      expect(() => TrustLevelSchema.parse("locked")).toThrow();
    });
  });

  describe("NotificationTierSchema", () => {
    it("accepts T1, T2, T3", () => {
      expect(NotificationTierSchema.parse("T1")).toBe("T1");
      expect(NotificationTierSchema.parse("T2")).toBe("T2");
      expect(NotificationTierSchema.parse("T3")).toBe("T3");
    });
  });

  describe("AgentEventSchema", () => {
    it("validates a complete event", () => {
      const event = {
        id: "evt-1",
        organizationId: "org-1",
        deploymentId: "dep-1",
        eventType: "conversation_end",
        payload: { messages: [], channelType: "telegram" },
        status: "pending",
        retryCount: 0,
        createdAt: new Date(),
        processedAt: null,
      };
      expect(AgentEventSchema.parse(event)).toBeDefined();
    });

    it("defaults status to pending", () => {
      const event = {
        id: "evt-1",
        organizationId: "org-1",
        deploymentId: "dep-1",
        eventType: "conversation_end",
        payload: {},
        retryCount: 0,
        createdAt: new Date(),
      };
      const parsed = AgentEventSchema.parse(event);
      expect(parsed.status).toBe("pending");
    });
  });

  describe("ActivityLogSchema", () => {
    it("validates a complete log entry", () => {
      const entry = {
        id: "log-1",
        organizationId: "org-1",
        deploymentId: "dep-1",
        eventType: "fact_learned",
        description: "Learned: busiest day is Tuesday",
        metadata: { category: "business_hours" },
        createdAt: new Date(),
      };
      expect(ActivityLogSchema.parse(entry)).toBeDefined();
    });
  });

  describe("AgentEventStatusSchema", () => {
    it("accepts all valid statuses", () => {
      for (const s of ["pending", "processing", "done", "failed", "dead_letter"]) {
        expect(AgentEventStatusSchema.parse(s)).toBe(s);
      }
    });
  });

  describe("ActivityLogEventTypeSchema", () => {
    it("accepts all valid event types", () => {
      const types = [
        "fact_learned",
        "fact_decayed",
        "faq_drafted",
        "faq_promoted",
        "summary_created",
        "correction_applied",
        "memory_deleted",
        "consolidation_run",
      ];
      for (const t of types) {
        expect(ActivityLogEventTypeSchema.parse(t)).toBe(t);
      }
    });
  });
});
