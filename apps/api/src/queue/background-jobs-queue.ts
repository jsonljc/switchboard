import { Queue } from "bullmq";
import type { ConnectionOptions } from "bullmq";

export const BACKGROUND_JOBS_QUEUE_NAME = "switchboard:background-jobs";

export type BackgroundJobKind =
  | "diagnostic-scan"
  | "scheduled-report-scan"
  | "agent-runner-cycle"
  | "revenue-growth-cycle"
  | "intervention-outcome-check";

export interface BackgroundJobData {
  kind: BackgroundJobKind;
}

export function createBackgroundJobsQueue(connection: ConnectionOptions): Queue<BackgroundJobData> {
  return new Queue<BackgroundJobData>(BACKGROUND_JOBS_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2000,
      },
      removeOnComplete: { count: 200 },
      removeOnFail: false,
    },
  });
}

export async function scheduleBackgroundJobs(queue: Queue<BackgroundJobData>): Promise<void> {
  await queue.upsertJobScheduler(
    "diagnostic-scan",
    { every: 5 * 60 * 1000 },
    {
      name: "diagnostic-scan",
      data: { kind: "diagnostic-scan" },
      opts: {
        removeOnComplete: 100,
        removeOnFail: false,
      },
    },
  );

  await queue.upsertJobScheduler(
    "scheduled-report-scan",
    { every: 60 * 1000 },
    {
      name: "scheduled-report-scan",
      data: { kind: "scheduled-report-scan" },
      opts: {
        removeOnComplete: 100,
        removeOnFail: false,
      },
    },
  );

  await queue.upsertJobScheduler(
    "agent-runner-cycle",
    { every: 60 * 1000 },
    {
      name: "agent-runner-cycle",
      data: { kind: "agent-runner-cycle" },
      opts: {
        removeOnComplete: 100,
        removeOnFail: false,
      },
    },
  );

  await queue.upsertJobScheduler(
    "revenue-growth-cycle",
    { every: 60 * 60 * 1000 },
    {
      name: "revenue-growth-cycle",
      data: { kind: "revenue-growth-cycle" },
      opts: {
        removeOnComplete: 100,
        removeOnFail: false,
      },
    },
  );

  await queue.upsertJobScheduler(
    "intervention-outcome-check",
    { every: 6 * 60 * 60 * 1000 },
    {
      name: "intervention-outcome-check",
      data: { kind: "intervention-outcome-check" },
      opts: {
        removeOnComplete: 100,
        removeOnFail: false,
      },
    },
  );
}
