import { describe, it, expect, beforeEach } from "vitest";
import type { SchedulerService, RegisterTriggerInput } from "../scheduler-service.js";
import type { TriggerStore } from "../trigger-store.js";
import type { ScheduledTrigger, TriggerFilters, TriggerStatus } from "@switchboard/schemas";
import { createSchedulerService } from "../scheduler-service.js";
import {
  canTriggerTransition,
  validateTriggerTransition,
  TriggerTransitionError,
  isTerminalTriggerStatus,
  filterMatchingTriggers,
} from "../trigger-types.js";

function createInMemoryTriggerStore(): TriggerStore {
  const triggers = new Map<string, ScheduledTrigger>();

  return {
    async save(trigger: ScheduledTrigger): Promise<void> {
      triggers.set(trigger.id, { ...trigger });
    },
    async findById(id: string): Promise<ScheduledTrigger | null> {
      return triggers.get(id) ?? null;
    },
    async findByFilters(filters: TriggerFilters): Promise<ScheduledTrigger[]> {
      let result = Array.from(triggers.values());
      if (filters.organizationId) {
        result = result.filter((t) => t.organizationId === filters.organizationId);
      }
      if (filters.status) {
        result = result.filter((t) => t.status === filters.status);
      }
      if (filters.type) {
        result = result.filter((t) => t.type === filters.type);
      }
      if (filters.sourceWorkflowId) {
        result = result.filter((t) => t.sourceWorkflowId === filters.sourceWorkflowId);
      }
      return result;
    },
    async updateStatus(id: string, status: TriggerStatus): Promise<void> {
      const trigger = triggers.get(id);
      if (trigger) {
        triggers.set(id, { ...trigger, status });
      }
    },
    async deleteExpired(before: Date): Promise<number> {
      let count = 0;
      for (const [id, trigger] of triggers) {
        if (
          trigger.expiresAt &&
          trigger.expiresAt < before &&
          ["fired", "cancelled", "expired"].includes(trigger.status)
        ) {
          triggers.delete(id);
          count++;
        }
      }
      return count;
    },
    async expireOverdue(now: Date): Promise<number> {
      let count = 0;
      for (const [id, trigger] of triggers) {
        if (trigger.status === "active" && trigger.expiresAt && trigger.expiresAt < now) {
          triggers.set(id, { ...trigger, status: "expired" });
          count++;
        }
      }
      return count;
    },
  };
}

describe("Trigger state transitions", () => {
  it("allows active -> fired", () => {
    expect(canTriggerTransition("active", "fired")).toBe(true);
  });

  it("allows active -> cancelled", () => {
    expect(canTriggerTransition("active", "cancelled")).toBe(true);
  });

  it("allows active -> expired", () => {
    expect(canTriggerTransition("active", "expired")).toBe(true);
  });

  it("rejects fired -> active", () => {
    expect(canTriggerTransition("fired", "active")).toBe(false);
  });

  it("rejects cancelled -> active", () => {
    expect(canTriggerTransition("cancelled", "active")).toBe(false);
  });

  it("validates transition throws on invalid", () => {
    expect(() => validateTriggerTransition("fired", "active")).toThrow(TriggerTransitionError);
  });

  it("identifies terminal statuses", () => {
    expect(isTerminalTriggerStatus("fired")).toBe(true);
    expect(isTerminalTriggerStatus("cancelled")).toBe(true);
    expect(isTerminalTriggerStatus("expired")).toBe(true);
    expect(isTerminalTriggerStatus("active")).toBe(false);
  });
});

describe("SchedulerService (in-memory)", () => {
  let service: SchedulerService;
  let store: TriggerStore;

  beforeEach(() => {
    store = createInMemoryTriggerStore();
    service = createSchedulerService({ store });
  });

  describe("registerTrigger", () => {
    it("registers a timer trigger and returns its id", async () => {
      const input: RegisterTriggerInput = {
        organizationId: "org-1",
        type: "timer",
        fireAt: new Date("2026-04-01T10:00:00Z"),
        cronExpression: null,
        eventPattern: null,
        action: { type: "spawn_workflow", payload: { agent: "employee-e" } },
        sourceWorkflowId: null,
        expiresAt: null,
      };

      const id = await service.registerTrigger(input);
      expect(id).toBeTruthy();

      const trigger = await store.findById(id);
      expect(trigger).not.toBeNull();
      expect(trigger!.type).toBe("timer");
      expect(trigger!.status).toBe("active");
      expect(trigger!.organizationId).toBe("org-1");
    });

    it("registers a cron trigger", async () => {
      const id = await service.registerTrigger({
        organizationId: "org-1",
        type: "cron",
        fireAt: null,
        cronExpression: "0 9 * * 1-5",
        eventPattern: null,
        action: { type: "emit_event", payload: { type: "daily_check" } },
        sourceWorkflowId: null,
        expiresAt: null,
      });

      const trigger = await store.findById(id);
      expect(trigger!.type).toBe("cron");
      expect(trigger!.cronExpression).toBe("0 9 * * 1-5");
    });

    it("registers an event_match trigger", async () => {
      const id = await service.registerTrigger({
        organizationId: "org-1",
        type: "event_match",
        fireAt: null,
        cronExpression: null,
        eventPattern: { type: "payment.received", filters: { amount_gt: 100 } },
        action: { type: "resume_workflow", payload: { workflowId: "wf-1" } },
        sourceWorkflowId: "wf-1",
        expiresAt: new Date("2026-04-15T00:00:00Z"),
      });

      const trigger = await store.findById(id);
      expect(trigger!.type).toBe("event_match");
      expect(trigger!.eventPattern).toEqual({
        type: "payment.received",
        filters: { amount_gt: 100 },
      });
    });
  });

  describe("cancelTrigger", () => {
    it("cancels an active trigger", async () => {
      const id = await service.registerTrigger({
        organizationId: "org-1",
        type: "timer",
        fireAt: new Date("2026-04-01T10:00:00Z"),
        cronExpression: null,
        eventPattern: null,
        action: { type: "spawn_workflow", payload: {} },
        sourceWorkflowId: null,
        expiresAt: null,
      });

      await service.cancelTrigger(id);
      const trigger = await store.findById(id);
      expect(trigger!.status).toBe("cancelled");
    });

    it("throws on cancelling a non-existent trigger", async () => {
      await expect(service.cancelTrigger("nonexistent")).rejects.toThrow();
    });

    it("throws on cancelling an already-fired trigger", async () => {
      const id = await service.registerTrigger({
        organizationId: "org-1",
        type: "timer",
        fireAt: new Date("2026-04-01T10:00:00Z"),
        cronExpression: null,
        eventPattern: null,
        action: { type: "spawn_workflow", payload: {} },
        sourceWorkflowId: null,
        expiresAt: null,
      });

      await store.updateStatus(id, "fired");
      await expect(service.cancelTrigger(id)).rejects.toThrow(TriggerTransitionError);
    });
  });

  describe("listPendingTriggers", () => {
    it("returns triggers matching filters", async () => {
      await service.registerTrigger({
        organizationId: "org-1",
        type: "timer",
        fireAt: new Date("2026-04-01T10:00:00Z"),
        cronExpression: null,
        eventPattern: null,
        action: { type: "spawn_workflow", payload: {} },
        sourceWorkflowId: null,
        expiresAt: null,
      });
      await service.registerTrigger({
        organizationId: "org-2",
        type: "cron",
        fireAt: null,
        cronExpression: "0 9 * * *",
        eventPattern: null,
        action: { type: "emit_event", payload: {} },
        sourceWorkflowId: null,
        expiresAt: null,
      });

      const org1 = await service.listPendingTriggers({ organizationId: "org-1" });
      expect(org1).toHaveLength(1);
      expect(org1[0]!.organizationId).toBe("org-1");

      const all = await service.listPendingTriggers({});
      expect(all).toHaveLength(2);
    });
  });

  describe("matchEvent", () => {
    it("returns matching event_match triggers for an event", async () => {
      await service.registerTrigger({
        organizationId: "org-1",
        type: "event_match",
        fireAt: null,
        cronExpression: null,
        eventPattern: { type: "payment.received", filters: {} },
        action: { type: "resume_workflow", payload: { workflowId: "wf-1" } },
        sourceWorkflowId: "wf-1",
        expiresAt: null,
      });
      await service.registerTrigger({
        organizationId: "org-1",
        type: "event_match",
        fireAt: null,
        cronExpression: null,
        eventPattern: { type: "ad.anomaly_detected", filters: {} },
        action: { type: "spawn_workflow", payload: {} },
        sourceWorkflowId: null,
        expiresAt: null,
      });

      const matches = await service.matchEvent("org-1", "payment.received", {});
      expect(matches).toHaveLength(1);
      expect(matches[0]!.action.payload).toEqual({ workflowId: "wf-1" });
    });

    it("returns empty array when no triggers match", async () => {
      const matches = await service.matchEvent("org-1", "unknown.event", {});
      expect(matches).toHaveLength(0);
    });

    it("filters by event pattern filters", async () => {
      await service.registerTrigger({
        organizationId: "org-1",
        type: "event_match",
        fireAt: null,
        cronExpression: null,
        eventPattern: { type: "payment.received", filters: { currency: "USD" } },
        action: { type: "resume_workflow", payload: {} },
        sourceWorkflowId: null,
        expiresAt: null,
      });

      const matchUsd = await service.matchEvent("org-1", "payment.received", {
        currency: "USD",
        amount: 100,
      });
      expect(matchUsd).toHaveLength(1);

      const matchEur = await service.matchEvent("org-1", "payment.received", { currency: "EUR" });
      expect(matchEur).toHaveLength(0);
    });
  });

  describe("expireOverdue", () => {
    it("marks active triggers past expiresAt as expired", async () => {
      const id = await service.registerTrigger({
        organizationId: "org-1",
        type: "event_match",
        fireAt: null,
        cronExpression: null,
        eventPattern: { type: "payment.received", filters: {} },
        action: { type: "resume_workflow", payload: {} },
        sourceWorkflowId: null,
        expiresAt: new Date("2026-03-01T00:00:00Z"),
      });

      const expired = await store.expireOverdue(new Date("2026-03-23T00:00:00Z"));
      expect(expired).toBe(1);

      const trigger = await store.findById(id);
      expect(trigger!.status).toBe("expired");
    });

    it("does not expire triggers without expiresAt", async () => {
      await service.registerTrigger({
        organizationId: "org-1",
        type: "timer",
        fireAt: new Date("2026-04-01T10:00:00Z"),
        cronExpression: null,
        eventPattern: null,
        action: { type: "spawn_workflow", payload: {} },
        sourceWorkflowId: null,
        expiresAt: null,
      });

      const expired = await store.expireOverdue(new Date("2026-03-23T00:00:00Z"));
      expect(expired).toBe(0);
    });

    it("does not expire already-cancelled triggers", async () => {
      const id = await service.registerTrigger({
        organizationId: "org-1",
        type: "timer",
        fireAt: new Date("2026-04-01T10:00:00Z"),
        cronExpression: null,
        eventPattern: null,
        action: { type: "spawn_workflow", payload: {} },
        sourceWorkflowId: null,
        expiresAt: new Date("2026-03-01T00:00:00Z"),
      });

      await service.cancelTrigger(id);
      const expired = await store.expireOverdue(new Date("2026-03-23T00:00:00Z"));
      expect(expired).toBe(0);
    });
  });
});

describe("filterMatchingTriggers", () => {
  const makeTrigger = (eventPattern: ScheduledTrigger["eventPattern"]): ScheduledTrigger => ({
    id: "t-1",
    organizationId: "org-1",
    type: "event_match",
    fireAt: null,
    cronExpression: null,
    eventPattern,
    action: { type: "emit_event", payload: {} },
    sourceWorkflowId: null,
    status: "active",
    createdAt: new Date(),
    expiresAt: null,
  });

  it("matches triggers with matching event type and empty filters", () => {
    const triggers = [makeTrigger({ type: "order.placed", filters: {} })];
    expect(filterMatchingTriggers(triggers, "order.placed", {})).toHaveLength(1);
  });

  it("rejects triggers with different event type", () => {
    const triggers = [makeTrigger({ type: "order.placed", filters: {} })];
    expect(filterMatchingTriggers(triggers, "order.cancelled", {})).toHaveLength(0);
  });

  it("rejects triggers when filter values don't match event data", () => {
    const triggers = [makeTrigger({ type: "order.placed", filters: { region: "US" } })];
    expect(filterMatchingTriggers(triggers, "order.placed", { region: "EU" })).toHaveLength(0);
  });

  it("matches when all filter values are present in event data", () => {
    const triggers = [makeTrigger({ type: "order.placed", filters: { region: "US" } })];
    expect(
      filterMatchingTriggers(triggers, "order.placed", { region: "US", amount: 50 }),
    ).toHaveLength(1);
  });

  it("skips triggers with null eventPattern", () => {
    const triggers = [makeTrigger(null)];
    expect(filterMatchingTriggers(triggers, "order.placed", {})).toHaveLength(0);
  });
});
