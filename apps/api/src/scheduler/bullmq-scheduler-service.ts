import type { Queue } from "bullmq";
import type { SchedulerService, RegisterTriggerInput, TriggerStore } from "@switchboard/core";
import type { ScheduledTrigger, TriggerFilters } from "@switchboard/schemas";
import { validateTriggerTransition, filterMatchingTriggers } from "@switchboard/core";
import { randomUUID } from "node:crypto";
import type { SchedulerJobData } from "../queue/scheduler-queue.js";
import { computeTimerDelay, computeCronRepeatOpts } from "../queue/scheduler-queue.js";

export class BullMQSchedulerService implements SchedulerService {
  constructor(
    private readonly store: TriggerStore,
    private readonly queue: Queue<SchedulerJobData>,
  ) {}

  async registerTrigger(input: RegisterTriggerInput): Promise<string> {
    const id = randomUUID();
    const trigger: ScheduledTrigger = {
      id,
      organizationId: input.organizationId,
      type: input.type,
      fireAt: input.fireAt,
      cronExpression: input.cronExpression,
      eventPattern: input.eventPattern,
      action: input.action,
      sourceWorkflowId: input.sourceWorkflowId,
      status: "active",
      createdAt: new Date(),
      expiresAt: input.expiresAt,
    };

    await this.store.save(trigger);

    const jobData: SchedulerJobData = {
      triggerId: id,
      organizationId: input.organizationId,
      action: input.action,
    };

    if (input.type === "timer" && input.fireAt) {
      const delay = computeTimerDelay(input.fireAt);
      await this.queue.add(`timer:${id}`, jobData, { delay, jobId: `timer:${id}` });
    } else if (input.type === "cron" && input.cronExpression) {
      const repeatOpts = computeCronRepeatOpts(input.cronExpression, input.expiresAt);
      await this.queue.upsertJobScheduler(`cron:${id}`, repeatOpts, { data: jobData });
    }
    // event_match triggers have no BullMQ job — checked by EventLoop on dispatch

    return id;
  }

  async cancelTrigger(triggerId: string): Promise<void> {
    const trigger = await this.store.findById(triggerId);
    if (!trigger) {
      throw new Error(`Trigger not found: ${triggerId}`);
    }

    validateTriggerTransition(trigger.status, "cancelled");
    await this.store.updateStatus(triggerId, "cancelled");

    if (trigger.type === "timer") {
      try {
        await this.queue.remove(`timer:${triggerId}`);
      } catch {
        // Job may have already fired — safe to ignore
      }
    } else if (trigger.type === "cron") {
      try {
        await this.queue.removeJobScheduler(`cron:${triggerId}`);
      } catch {
        // Scheduler may not exist — safe to ignore
      }
    }
  }

  async listPendingTriggers(filters: TriggerFilters): Promise<ScheduledTrigger[]> {
    return this.store.findByFilters(filters);
  }

  async matchEvent(
    organizationId: string,
    eventType: string,
    eventData: Record<string, unknown>,
  ): Promise<ScheduledTrigger[]> {
    const candidates = await this.store.findByFilters({
      organizationId,
      status: "active",
      type: "event_match",
    });

    return filterMatchingTriggers(candidates, eventType, eventData);
  }
}
