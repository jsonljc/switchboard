// ---------------------------------------------------------------------------
// Execution Queue — BullMQ-based queue and worker for background execution
// ---------------------------------------------------------------------------
import { Queue, Worker } from "bullmq";
import type { LifecycleOrchestrator } from "@switchboard/core";

interface QueueConnection {
  url: string;
}

interface WorkerOptions {
  connection: QueueConnection;
  orchestrator: LifecycleOrchestrator;
  storage: unknown;
  logger: { info: (msg: string) => void; error: (obj: unknown, msg: string) => void };
}

const QUEUE_NAME = "switchboard:execution";

export function createExecutionQueue(connection: QueueConnection): Queue {
  return new Queue(QUEUE_NAME, { connection: { url: connection.url } });
}

export function createExecutionWorker(options: WorkerOptions): Worker {
  const { connection, orchestrator, logger } = options;
  return new Worker(
    QUEUE_NAME,
    async (job) => {
      const { envelopeId } = job.data as { envelopeId: string };
      logger.info(`[worker] Processing envelope ${envelopeId}`);
      await orchestrator.executeApproved(envelopeId);
    },
    { connection: { url: connection.url } },
  );
}
