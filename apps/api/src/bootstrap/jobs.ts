// ---------------------------------------------------------------------------
// Background job startup — cron jobs, agent runner, etc.
// ---------------------------------------------------------------------------

import type { LifecycleOrchestrator, ResolvedSkin, ResolvedProfile } from "@switchboard/core";
import type { StorageContext } from "@switchboard/core";
import type { AgentNotifier } from "@switchboard/core";
import type { Queue, Worker } from "bullmq";
import { startApprovalExpiryJob } from "../jobs/approval-expiry.js";
import { startChainVerificationJob } from "../jobs/chain-verification.js";
import { startDiagnosticScanner } from "../jobs/diagnostic-scanner.js";
import { startScheduledReportJob } from "../jobs/scheduled-reports.js";
import { startTokenRefreshJob } from "../jobs/token-refresh.js";
import { startTtlCleanupJob } from "../jobs/ttl-cleanup.js";
import { startCadenceRunner } from "../jobs/cadence-runner.js";
import { startAgentRunner } from "../jobs/agent-runner.js";
import { startRevGrowthRunner } from "../jobs/revenue-growth-runner.js";
import { startOutcomeChecker } from "../jobs/outcome-checker.js";
import { startOptimisationRunner } from "../jobs/optimisation-runner.js";
import type { AuditLedger } from "@switchboard/core";
import {
  createBackgroundJobsQueue,
  createBackgroundWorker,
  scheduleBackgroundJobs,
} from "../queue/index.js";

interface JobDeps {
  storage: StorageContext;
  ledger: AuditLedger;
  orchestrator: LifecycleOrchestrator;
  prismaClient: import("@switchboard/db").PrismaClient | null;
  redis: import("ioredis").default | null;
  resolvedSkin?: ResolvedSkin | null;
  resolvedProfile?: ResolvedProfile | null;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

/**
 * Start all background jobs and return a cleanup function + agentNotifier.
 */
export async function startBackgroundJobs(deps: JobDeps): Promise<{
  stop: () => Promise<void>;
  agentNotifier: AgentNotifier;
  backgroundQueue: Queue | null;
  backgroundWorker: Worker | null;
}> {
  const {
    storage,
    ledger,
    orchestrator,
    prismaClient,
    redis,
    resolvedSkin,
    resolvedProfile,
    logger,
  } = deps;

  const stopExpiryJob = startApprovalExpiryJob({ storage, ledger, logger });
  const stopChainVerify = startChainVerificationJob({ ledger, logger });

  let stopDiagnosticScanner = () => {};
  let stopScheduledReports = () => {};
  const stopTokenRefresh = prismaClient
    ? startTokenRefreshJob({ prisma: prismaClient, logger })
    : () => {};
  const stopTtlCleanup = prismaClient
    ? startTtlCleanupJob({ prisma: prismaClient, logger })
    : () => {};

  // Cadence runner
  let cadenceStore: import("@switchboard/db").CadenceStore | undefined;
  if (prismaClient) {
    const { PrismaCadenceStore } = await import("@switchboard/db");
    cadenceStore = new PrismaCadenceStore(prismaClient);
  }
  const stopCadenceRunner = startCadenceRunner({
    storageContext: storage,
    cadenceStore,
    intervalMs: 60_000,
    logger,
  });

  // Agent runner (autonomous ads operator agents)
  const { ProactiveSender } = await import("../notifications/proactive-sender.js");
  const agentNotifier = new ProactiveSender({
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

  // Build async config loader that fetches active configs from DB each cycle
  let configLoader: (() => Promise<import("@switchboard/schemas").AdsOperatorConfig[]>) | undefined;
  if (prismaClient) {
    const { PrismaAdsOperatorConfigStore } = await import("@switchboard/db");
    const configStore = new PrismaAdsOperatorConfigStore(prismaClient);
    configLoader = () => configStore.listActive();
  }

  let stopAgentRunner = () => {};
  let stopRevGrowthRunner = () => {};
  let stopOutcomeChecker = () => {};
  let stopOptimisationRunner = () => {};
  let backgroundQueue: Queue | null = null;
  let backgroundWorker: Worker | null = null;

  if (prismaClient && redis) {
    const connection = { url: process.env["REDIS_URL"]! };
    backgroundQueue = createBackgroundJobsQueue(connection);
    backgroundWorker = createBackgroundWorker({
      connection,
      prisma: prismaClient,
      storage,
      orchestrator,
      ledger,
      resolvedProfile: resolvedProfile ?? null,
      resolvedSkin: resolvedSkin ?? null,
      redis,
      logger,
    });
    await scheduleBackgroundJobs(backgroundQueue);
  } else {
    stopDiagnosticScanner = prismaClient
      ? startDiagnosticScanner({
          prisma: prismaClient,
          storageContext: storage,
          orchestrator,
          logger,
        })
      : () => {};
    stopScheduledReports = prismaClient
      ? startScheduledReportJob({
          prisma: prismaClient,
          storageContext: storage,
          orchestrator,
          logger,
        })
      : () => {};
    stopAgentRunner = startAgentRunner({
      storageContext: storage,
      orchestrator,
      notifier: agentNotifier,
      configLoader,
      resolvedProfile: resolvedProfile ?? null,
      resolvedSkin: resolvedSkin ?? null,
      ledger,
      intervalMs: 60_000,
      logger,
    });
    if (prismaClient) {
      stopRevGrowthRunner = startRevGrowthRunner({
        prisma: prismaClient,
        intervalMs: 60 * 60 * 1000,
        logger,
      });
      stopOutcomeChecker = startOutcomeChecker({
        prisma: prismaClient,
        intervalMs: 6 * 60 * 60 * 1000,
        logger,
      });
      stopOptimisationRunner = startOptimisationRunner({
        prisma: prismaClient,
        intervalMs: 24 * 60 * 60 * 1000,
        logger,
      });
    }
  }

  return {
    stop: async () => {
      stopExpiryJob();
      stopChainVerify();
      stopDiagnosticScanner();
      stopScheduledReports();
      stopTokenRefresh();
      stopTtlCleanup();
      stopCadenceRunner();
      stopAgentRunner();
      stopRevGrowthRunner();
      stopOutcomeChecker();
      stopOptimisationRunner();
      if (backgroundWorker) {
        await backgroundWorker.close();
      }
      if (backgroundQueue) {
        await backgroundQueue.close();
      }
    },
    agentNotifier,
    backgroundQueue,
    backgroundWorker,
  };
}
