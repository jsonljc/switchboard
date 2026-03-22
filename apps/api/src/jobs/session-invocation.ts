import { Queue } from "bullmq";
import type { ConnectionOptions } from "bullmq";

export interface SessionInvocationJobData {
  sessionId: string;
  runId: string;
  resumeToken: string;
  attempt: number;
}

export const SESSION_INVOCATION_QUEUE = "session-invocation";

export function createSessionInvocationQueue(connection: ConnectionOptions): Queue {
  return new Queue<SessionInvocationJobData>(SESSION_INVOCATION_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { count: 500 },
      removeOnFail: false,
    },
  });
}
// Gateway invocation worker removed — will be replaced by WorkflowEngine in Phase 3.
