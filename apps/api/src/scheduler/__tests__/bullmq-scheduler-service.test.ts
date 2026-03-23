import { describe, it, expect, vi, beforeEach } from "vitest";
import { BullMQSchedulerService } from "../bullmq-scheduler-service.js";
import type { TriggerStore } from "@switchboard/core";
import type { ScheduledTrigger, TriggerFilters, TriggerStatus } from "@switchboard/schemas";

function createMockStore(): TriggerStore {
  const triggers = new Map<string, ScheduledTrigger>();
  return {
    save: vi.fn(async (trigger: ScheduledTrigger) => {
      triggers.set(trigger.id, { ...trigger });
    }),
    findById: vi.fn(async (id: string) => triggers.get(id) ?? null),
    findByFilters: vi.fn(async (filters: TriggerFilters) => {
      let result = Array.from(triggers.values());
      if (filters.organizationId)
        result = result.filter((t) => t.organizationId === filters.organizationId);
      if (filters.status) result = result.filter((t) => t.status === filters.status);
      if (filters.type) result = result.filter((t) => t.type === filters.type);
      return result;
    }),
    updateStatus: vi.fn(async (id: string, status: TriggerStatus) => {
      const t = triggers.get(id);
      if (t) triggers.set(id, { ...t, status });
    }),
    deleteExpired: vi.fn(async () => 0),
    expireOverdue: vi.fn(async () => 0),
  };
}

function createMockQueue() {
  return {
    add: vi.fn(async () => ({ id: "job-1" })),
    upsertJobScheduler: vi.fn(async () => ({ id: "job-cron-1" })),
    removeJobScheduler: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
}

describe("BullMQSchedulerService", () => {
  let store: ReturnType<typeof createMockStore>;
  let queue: ReturnType<typeof createMockQueue>;
  let service: BullMQSchedulerService;

  beforeEach(() => {
    store = createMockStore();
    queue = createMockQueue();
    service = new BullMQSchedulerService(store, queue as never);
  });

  describe("registerTrigger", () => {
    it("registers a timer trigger with delayed BullMQ job", async () => {
      const id = await service.registerTrigger({
        organizationId: "org-1",
        type: "timer",
        fireAt: new Date(Date.now() + 60_000),
        cronExpression: null,
        eventPattern: null,
        action: { type: "spawn_workflow", payload: {} },
        sourceWorkflowId: null,
        expiresAt: null,
      });

      expect(id).toBeTruthy();
      expect(store.save).toHaveBeenCalledTimes(1);
      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(queue.add).toHaveBeenCalledWith(
        expect.stringContaining("timer:"),
        expect.objectContaining({ triggerId: id }),
        expect.objectContaining({ delay: expect.any(Number) }),
      );
    });

    it("registers a cron trigger with BullMQ job scheduler", async () => {
      const id = await service.registerTrigger({
        organizationId: "org-1",
        type: "cron",
        fireAt: null,
        cronExpression: "0 9 * * 1-5",
        eventPattern: null,
        action: { type: "emit_event", payload: {} },
        sourceWorkflowId: null,
        expiresAt: null,
      });

      expect(id).toBeTruthy();
      expect(store.save).toHaveBeenCalledTimes(1);
      expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
      expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
        expect.stringContaining("cron:"),
        expect.objectContaining({ pattern: "0 9 * * 1-5" }),
        expect.objectContaining({
          data: expect.objectContaining({ triggerId: id }),
        }),
      );
    });

    it("registers an event_match trigger without BullMQ job", async () => {
      const id = await service.registerTrigger({
        organizationId: "org-1",
        type: "event_match",
        fireAt: null,
        cronExpression: null,
        eventPattern: { type: "payment.received", filters: {} },
        action: { type: "resume_workflow", payload: {} },
        sourceWorkflowId: null,
        expiresAt: null,
      });

      expect(id).toBeTruthy();
      expect(store.save).toHaveBeenCalledTimes(1);
      expect(queue.add).not.toHaveBeenCalled();
      expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
    });
  });

  describe("cancelTrigger", () => {
    it("cancels timer trigger and removes BullMQ job", async () => {
      const id = await service.registerTrigger({
        organizationId: "org-1",
        type: "timer",
        fireAt: new Date(Date.now() + 60_000),
        cronExpression: null,
        eventPattern: null,
        action: { type: "spawn_workflow", payload: {} },
        sourceWorkflowId: null,
        expiresAt: null,
      });

      await service.cancelTrigger(id);
      expect(store.updateStatus).toHaveBeenCalledWith(id, "cancelled");
    });

    it("cancels cron trigger and removes BullMQ job scheduler", async () => {
      const id = await service.registerTrigger({
        organizationId: "org-1",
        type: "cron",
        fireAt: null,
        cronExpression: "0 9 * * *",
        eventPattern: null,
        action: { type: "emit_event", payload: {} },
        sourceWorkflowId: null,
        expiresAt: null,
      });

      await service.cancelTrigger(id);
      expect(store.updateStatus).toHaveBeenCalledWith(id, "cancelled");
      expect(queue.removeJobScheduler).toHaveBeenCalledWith(expect.stringContaining("cron:"));
    });
  });

  describe("listPendingTriggers", () => {
    it("delegates to store.findByFilters", async () => {
      await service.listPendingTriggers({ organizationId: "org-1" });
      expect(store.findByFilters).toHaveBeenCalledWith({ organizationId: "org-1" });
    });
  });

  describe("matchEvent", () => {
    it("finds matching event_match triggers", async () => {
      await service.registerTrigger({
        organizationId: "org-1",
        type: "event_match",
        fireAt: null,
        cronExpression: null,
        eventPattern: { type: "payment.received", filters: {} },
        action: { type: "resume_workflow", payload: { workflowId: "wf-1" } },
        sourceWorkflowId: null,
        expiresAt: null,
      });

      const matches = await service.matchEvent("org-1", "payment.received", {});
      expect(matches).toHaveLength(1);
    });
  });
});
