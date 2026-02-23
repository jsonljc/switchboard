import { Queue } from "bullmq";
import type { ConnectionOptions } from "bullmq";

export const EXECUTION_QUEUE_NAME = "switchboard:execution";

export interface ExecutionJobData {
  envelopeId: string;
  enqueuedAt: string;
  traceId?: string;
}

export function createExecutionQueue(connection: ConnectionOptions): Queue<ExecutionJobData> {
  return new Queue<ExecutionJobData>(EXECUTION_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2000,
      },
      removeOnComplete: { count: 1000 },
      removeOnFail: false,
    },
  });
}
