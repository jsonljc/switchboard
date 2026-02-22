import { Worker } from "bullmq";
import type { Job, ConnectionOptions } from "bullmq";
import type { LifecycleOrchestrator, StorageContext } from "@switchboard/core";
import { EXECUTION_QUEUE_NAME } from "./execution-queue.js";
import type { ExecutionJobData } from "./execution-queue.js";

export interface WorkerConfig {
  connection: ConnectionOptions;
  orchestrator: LifecycleOrchestrator;
  storage?: StorageContext;
  concurrency?: number;
}

export function createExecutionWorker(config: WorkerConfig): Worker<ExecutionJobData> {
  const { connection, orchestrator, storage, concurrency = 5 } = config;

  const worker = new Worker<ExecutionJobData>(
    EXECUTION_QUEUE_NAME,
    async (job: Job<ExecutionJobData>) => {
      const { envelopeId, traceId } = job.data;
      const attempt = job.attemptsMade + 1;
      const tracePrefix = traceId ? `[${traceId}] ` : "";

      console.log(`${tracePrefix}[worker] Executing envelope ${envelopeId} (attempt ${attempt})`);

      // Pre-flight check on retry: verify envelope is still approved
      if (attempt > 1 && storage) {
        const envelope = await storage.envelopes.getById(envelopeId);
        if (!envelope) {
          console.warn(`[worker] Envelope ${envelopeId} not found on retry, skipping`);
          return { envelopeId, success: false, summary: "Envelope not found on retry" };
        }
        if (envelope.status !== "approved" && envelope.status !== "executing") {
          console.warn(`[worker] Envelope ${envelopeId} status is ${envelope.status} on retry, skipping`);
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
        console.warn(`[worker] Non-transient failure for ${envelopeId}: ${result.summary}`);
      }

      return { envelopeId, success: result.success, summary: result.summary };
    },
    {
      connection,
      concurrency,
    },
  );

  worker.on("completed", (job) => {
    console.log(`[worker] Job ${job.id} completed for envelope ${job.data.envelopeId}`);
  });

  worker.on("failed", (job, err) => {
    if (job) {
      console.error(`[worker] Job ${job.id} failed for envelope ${job.data.envelopeId}: ${err.message}`);
      if (job.attemptsMade >= (job.opts.attempts ?? 3)) {
        console.error(`[worker] Job ${job.id} moved to DLQ after ${job.attemptsMade} attempts`);
      }
    }
  });

  worker.on("error", (err) => {
    console.error("[worker] Worker error:", err.message);
  });

  return worker;
}
