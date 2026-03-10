import { Worker } from "bullmq";
import type { ConnectionOptions, Job } from "bullmq";
import type {
  LifecycleOrchestrator,
  ResolvedProfile,
  ResolvedSkin,
  StorageContext,
} from "@switchboard/core";
import type { AuditLedger } from "@switchboard/core";
import type { PrismaClient } from "@switchboard/db";
import type Redis from "ioredis";
import { BACKGROUND_JOBS_QUEUE_NAME } from "./background-jobs-queue.js";
import type { BackgroundJobData } from "./background-jobs-queue.js";
import { createLogger } from "../logger.js";
import type { Logger } from "../logger.js";
import { runDiagnosticScanOnce } from "../jobs/diagnostic-scanner.js";
import { runScheduledReportScanOnce } from "../jobs/scheduled-reports.js";
import { createRedisAgentRunGate, runAgentRunnerCycle } from "../jobs/agent-runner.js";
import { runRevGrowthCycleOnce } from "../jobs/revenue-growth-runner.js";
import { runOutcomeCheckOnce } from "../jobs/outcome-checker.js";

export interface BackgroundWorkerConfig {
  connection: ConnectionOptions;
  prisma: PrismaClient;
  storage: StorageContext;
  orchestrator: LifecycleOrchestrator;
  ledger: AuditLedger;
  resolvedSkin?: ResolvedSkin | null;
  resolvedProfile?: ResolvedProfile | null;
  redis?: Redis | null;
  concurrency?: number;
  logger?: Logger;
}

export function createBackgroundWorker(config: BackgroundWorkerConfig): Worker<BackgroundJobData> {
  const {
    connection,
    prisma,
    storage,
    orchestrator,
    ledger,
    resolvedSkin = null,
    resolvedProfile = null,
    redis = null,
    concurrency = 1,
    logger = createLogger("background-worker"),
  } = config;

  const worker = new Worker<BackgroundJobData>(
    BACKGROUND_JOBS_QUEUE_NAME,
    async (job: Job<BackgroundJobData>) => {
      logger.info({ jobId: job.id, kind: job.data.kind }, "Running background job");

      switch (job.data.kind) {
        case "diagnostic-scan":
          await runDiagnosticScanOnce({
            prisma,
            storageContext: storage,
            orchestrator,
            logger,
          });
          return { kind: job.data.kind, success: true };
        case "scheduled-report-scan":
          await runScheduledReportScanOnce({
            prisma,
            storageContext: storage,
            orchestrator,
            logger,
          });
          return { kind: job.data.kind, success: true };
        case "agent-runner-cycle":
          await runAgentRunnerCycle({
            storageContext: storage,
            orchestrator,
            notifier: await createAgentNotifier(),
            configLoader: await createConfigLoader(prisma),
            resolvedProfile,
            resolvedSkin,
            ledger,
            logger,
            runGate: redis ? createRedisAgentRunGate(redis) : undefined,
          });
          return { kind: job.data.kind, success: true };
        case "revenue-growth-cycle":
          await runRevGrowthCycleOnce({ prisma, logger });
          return { kind: job.data.kind, success: true };
        case "intervention-outcome-check":
          await runOutcomeCheckOnce({ prisma, logger });
          return { kind: job.data.kind, success: true };
        default:
          throw new Error(
            `Unsupported background job kind: ${(job.data as { kind?: string }).kind}`,
          );
      }
    },
    {
      connection,
      concurrency,
    },
  );

  worker.on("completed", (job) => {
    logger.info({ jobId: job.id, kind: job.data.kind }, "Background job completed");
  });
  worker.on("failed", (job, err) => {
    logger.error(
      { jobId: job?.id, kind: job?.data.kind, err: err.message },
      "Background job failed",
    );
  });

  return worker;
}

async function createConfigLoader(prisma: PrismaClient) {
  const { PrismaAdsOperatorConfigStore } = await import("@switchboard/db");
  const configStore = new PrismaAdsOperatorConfigStore(prisma);
  return () => configStore.listActive();
}

async function createAgentNotifier() {
  const { ProactiveSender } = await import("../notifications/proactive-sender.js");
  return new ProactiveSender({
    telegram: process.env["TELEGRAM_BOT_TOKEN"]
      ? { botToken: process.env["TELEGRAM_BOT_TOKEN"] }
      : undefined,
    slack: process.env["SLACK_BOT_TOKEN"]
      ? { botToken: process.env["SLACK_BOT_TOKEN"] }
      : undefined,
    whatsapp:
      process.env["WHATSAPP_TOKEN"] && process.env["WHATSAPP_PHONE_NUMBER_ID"]
        ? {
            token: process.env["WHATSAPP_TOKEN"],
            phoneNumberId: process.env["WHATSAPP_PHONE_NUMBER_ID"],
          }
        : undefined,
  });
}
