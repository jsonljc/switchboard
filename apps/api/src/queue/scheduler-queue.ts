import { Queue, Worker } from "bullmq";
import type { ConnectionOptions, Job } from "bullmq";
import type { TriggerAction } from "@switchboard/schemas";

export const SCHEDULER_QUEUE_NAME = "switchboard:scheduler";

export interface SchedulerJobData {
  triggerId: string;
  organizationId: string;
  action: TriggerAction;
}

export function createSchedulerJobData(input: SchedulerJobData): SchedulerJobData {
  return {
    triggerId: input.triggerId,
    organizationId: input.organizationId,
    action: input.action,
  };
}

export function computeTimerDelay(fireAt: Date, now: Date = new Date()): number {
  return Math.max(0, fireAt.getTime() - now.getTime());
}

export function computeCronRepeatOpts(
  cronExpression: string,
  expiresAt?: Date | null,
): { pattern: string; endDate?: Date } {
  const opts: { pattern: string; endDate?: Date } = { pattern: cronExpression };
  if (expiresAt) {
    opts.endDate = expiresAt;
  }
  return opts;
}

export function createSchedulerQueue(connection: ConnectionOptions): Queue<SchedulerJobData> {
  return new Queue<SchedulerJobData>(SCHEDULER_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 200 },
    },
  });
}

export type SchedulerJobHandler = (job: Job<SchedulerJobData>) => Promise<void>;

export function createSchedulerWorker(
  connection: ConnectionOptions,
  handler: SchedulerJobHandler,
): Worker<SchedulerJobData> {
  return new Worker<SchedulerJobData>(SCHEDULER_QUEUE_NAME, handler, {
    connection,
    concurrency: 3,
  });
}
