import { Worker } from "bullmq";
import type { Job, ConnectionOptions } from "bullmq";
import type { LifecycleOrchestrator, StorageContext } from "@switchboard/core";
import { EXECUTION_QUEUE_NAME } from "./execution-queue.js";
import type { ExecutionJobData } from "./execution-queue.js";
import { createLogger } from "../logger.js";
import type { Logger } from "../logger.js";

export interface WorkerConfig {
  connection: ConnectionOptions;
  orchestrator: LifecycleOrchestrator;
  storage?: StorageContext;
  concurrency?: number;
  logger?: Logger;
}

export function createExecutionWorker(config: WorkerConfig): Worker<ExecutionJobData> {
  const { connection, orchestrator, storage, concurrency = 5, logger = createLogger("worker") } = config;

  const worker = new Worker<ExecutionJobData>(
    EXECUTION_QUEUE_NAME,
    async (job: Job<ExecutionJobData>) => {
      const { envelopeId, traceId } = job.data;
      const attempt = job.attemptsMade + 1;

      logger.info({ envelopeId, attempt, traceId }, "Executing envelope");

      // Pre-flight check on retry: verify envelope is still approved
      if (attempt > 1 && storage) {
        const envelope = await storage.envelopes.getById(envelopeId);
        if (!envelope) {
          logger.warn({ envelopeId }, "Envelope not found on retry, skipping");
          return { envelopeId, success: false, summary: "Envelope not found on retry" };
        }
        if (envelope.status !== "approved" && envelope.status !== "executing") {
          logger.warn({ envelopeId, status: envelope.status }, "Envelope status changed on retry, skipping");
          return { envelopeId, success: false, summary: `Envelope status changed to ${envelope.status}` };
        }
      }

      const result = await orchestrator.executeApproved(envelopeId);

      if (!result.success) {
        // Throw to trigger BullMQ retry on transient failures
        const isTransient = result.partialFailures.some(
          (f) => f.error.includes("ETIMEDOUT") || f.error.includes("ECONNREFUSED") || f.error.includes("rate limit"),
        );
        if (isTransient) {
          throw new Error(`Transient execution failure for ${envelopeId}: ${result.summary}`);
        }
        // Non-transient failure: don't retry, the orchestrator already marked it as failed
        logger.warn({ envelopeId, summary: result.summary }, "Non-transient execution failure");
      }

      return { envelopeId, success: result.success, summary: result.summary };
    },
    {
      connection,
      concurrency,
    },
  );

  worker.on("completed", (job) => {
    logger.info({ jobId: job.id, envelopeId: job.data.envelopeId }, "Job completed");
  });

  worker.on("failed", (job, err) => {
    if (job) {
      logger.error({ jobId: job.id, envelopeId: job.data.envelopeId, err: err.message }, "Job failed");
      if (job.attemptsMade >= (job.opts.attempts ?? 3)) {
        logger.error({ jobId: job.id, attempts: job.attemptsMade }, "Job moved to DLQ");
      }
    }
  });

  worker.on("error", (err) => {
    logger.error({ err: err.message }, "Worker error");
  });

  return worker;
}
