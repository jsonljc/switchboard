// ---------------------------------------------------------------------------
// Background job startup — cron jobs, agent runner, etc.
// ---------------------------------------------------------------------------

import type { LifecycleOrchestrator } from "@switchboard/core";
import type { StorageContext } from "@switchboard/core";
import { startApprovalExpiryJob } from "../jobs/approval-expiry.js";
import { startChainVerificationJob } from "../jobs/chain-verification.js";
import { startDiagnosticScanner } from "../jobs/diagnostic-scanner.js";
import { startScheduledReportJob } from "../jobs/scheduled-reports.js";
import { startTokenRefreshJob } from "../jobs/token-refresh.js";
import { startTtlCleanupJob } from "../jobs/ttl-cleanup.js";
import { startCadenceRunner } from "../jobs/cadence-runner.js";
import { startAgentRunner } from "../jobs/agent-runner.js";
import type { AuditLedger } from "@switchboard/core";

interface JobDeps {
  storage: StorageContext;
  ledger: AuditLedger;
  orchestrator: LifecycleOrchestrator;
  prismaClient: import("@switchboard/db").PrismaClient | null;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

/**
 * Start all background jobs and return a single cleanup function.
 */
export async function startBackgroundJobs(deps: JobDeps): Promise<() => void> {
  const { storage, ledger, orchestrator, prismaClient, logger } = deps;

  const stopExpiryJob = startApprovalExpiryJob({ storage, ledger, logger });
  const stopChainVerify = startChainVerificationJob({ ledger, logger });

  const stopDiagnosticScanner = prismaClient
    ? startDiagnosticScanner({ prisma: prismaClient, storageContext: storage, logger })
    : () => {};
  const stopScheduledReports = prismaClient
    ? startScheduledReportJob({ prisma: prismaClient, storageContext: storage, logger })
    : () => {};
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
  const stopAgentRunner = startAgentRunner({
    storageContext: storage,
    orchestrator,
    notifier: agentNotifier,
    intervalMs: 60_000,
    logger,
  });

  return () => {
    stopExpiryJob();
    stopChainVerify();
    stopDiagnosticScanner();
    stopScheduledReports();
    stopTokenRefresh();
    stopTtlCleanup();
    stopCadenceRunner();
    stopAgentRunner();
  };
}
