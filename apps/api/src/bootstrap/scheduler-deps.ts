// ---------------------------------------------------------------------------
// Scheduler Deps Factory — builds SchedulerService with BullMQ queue + worker
// ---------------------------------------------------------------------------
// Used by API to enable scheduler capabilities.
// Returns SchedulerDeps with service, handler, and cleanup function.
// ---------------------------------------------------------------------------

import type { PrismaClient } from "@switchboard/db";
import type { SchedulerService } from "@switchboard/core";
import type { TriggerStore } from "@switchboard/core";
import { PrismaTriggerStore } from "@switchboard/db";
import { BullMQSchedulerService } from "../scheduler/bullmq-scheduler-service.js";
import { createSchedulerQueue, createSchedulerWorker } from "../queue/scheduler-queue.js";
import { createTriggerHandler } from "../scheduler/trigger-handler.js";
import type { TriggerWorkflowEngine } from "../scheduler/trigger-handler.js";
import type { SchedulerJobData } from "../queue/scheduler-queue.js";

export interface SchedulerDeps {
  service: SchedulerService;
  triggerHandler: (job: { data: SchedulerJobData }) => Promise<void>;
  cleanup: () => Promise<void>;
}

export function buildSchedulerDeps(
  prisma: PrismaClient,
  redisUrl: string,
  workflowEngine: TriggerWorkflowEngine,
): SchedulerDeps {
  const connection = { url: redisUrl };
  const store = new PrismaTriggerStore(prisma) as unknown as TriggerStore;
  const queue = createSchedulerQueue(connection);
  const service = new BullMQSchedulerService(store, queue);

  const triggerHandler = createTriggerHandler({ store, workflowEngine });
  const worker = createSchedulerWorker(connection, triggerHandler);

  return {
    service,
    triggerHandler,
    cleanup: async () => {
      await worker.close();
      await queue.close();
    },
  };
}
