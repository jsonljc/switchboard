import type { StorageContext } from "@switchboard/core";
import type { LifecycleOrchestrator } from "@switchboard/core";
import type { PrismaClient } from "@switchboard/db";
import { sendProactiveNotification } from "../alerts/notifier.js";
import { createLogger } from "../logger.js";
import type { Logger } from "../logger.js";
import { executeGovernedSystemAction } from "../services/system-governed-actions.js";

interface ScheduledReportRow {
  id: string;
  name: string;
  reportType: string;
  platform?: string;
  vertical?: string;
  organizationId: string;
  deliveryChannels: string[];
  deliveryTargets: string[];
  cronExpression: string;
  timezone: string;
  nextRunAt?: Date;
  enabled: boolean;
}

interface PrismaWithScheduledReport {
  scheduledReport: {
    findMany: (args: unknown) => Promise<ScheduledReportRow[]>;
    update: (args: unknown) => Promise<unknown>;
  };
}

export interface ScheduledReportJobConfig {
  prisma: PrismaClient;
  storageContext: StorageContext;
  orchestrator: LifecycleOrchestrator;
  intervalMs?: number;
  logger?: Logger;
}

/**
 * Periodically checks for due scheduled reports, runs diagnostics,
 * formats the summary, and delivers via configured channels.
 * Returns a cleanup function that stops the interval.
 */
export async function runScheduledReportScanOnce(config: ScheduledReportJobConfig): Promise<void> {
  const {
    prisma,
    storageContext,
    orchestrator,
    logger = createLogger("scheduled-reports"),
  } = config;
  try {
    const now = new Date();

    // Find due reports
    const dueReports = await (
      prisma as unknown as PrismaWithScheduledReport
    ).scheduledReport.findMany({
      where: {
        enabled: true,
        nextRunAt: { lte: now },
      },
    });

    if (dueReports.length === 0) return;

    // Resolve channel credentials from env vars
    const channelCredentials = {
      slack: process.env["SLACK_BOT_TOKEN"]
        ? { botToken: process.env["SLACK_BOT_TOKEN"] }
        : undefined,
      telegram: process.env["TELEGRAM_BOT_TOKEN"]
        ? { botToken: process.env["TELEGRAM_BOT_TOKEN"] }
        : undefined,
      whatsapp:
        process.env["WHATSAPP_TOKEN"] && process.env["WHATSAPP_PHONE_NUMBER_ID"]
          ? {
              token: process.env["WHATSAPP_TOKEN"],
              phoneNumberId: process.env["WHATSAPP_PHONE_NUMBER_ID"],
            }
          : undefined,
    };

    for (const report of dueReports) {
      try {
        const vertical = report.vertical ?? "commerce";
        const cartridgeId = resolveCartridgeForVertical(vertical);

        const cartridge = storageContext.cartridges.get(cartridgeId);
        if (!cartridge) {
          logger.warn(
            { reportId: report.id, cartridgeId },
            `${cartridgeId} cartridge not available`,
          );
          continue;
        }

        // Run the appropriate diagnostic
        const actionId = resolveDiagnoseAction(cartridgeId, report.reportType);

        const governedAction = await executeGovernedSystemAction({
          orchestrator,
          actionType: actionId,
          cartridgeId,
          organizationId: report.organizationId,
          parameters: {
            platform: report.platform ?? "meta",
            vertical: report.vertical,
            entityId: "act_default",
          },
          message: `Run scheduled report ${report.id}`,
          idempotencyKey: `scheduled-report:${report.id}:${report.nextRunAt?.toISOString() ?? now.toISOString()}`,
        });

        if (governedAction.outcome !== "executed") {
          logger.warn(
            {
              reportId: report.id,
              outcome: governedAction.outcome,
              explanation: governedAction.explanation,
            },
            "Scheduled report did not execute",
          );
          continue;
        }

        const execResult = governedAction.executionResult;

        // Format the result
        let body = "No diagnostic data available.";
        if (execResult?.data) {
          try {
            const { formatDiagnostic } = await import("@switchboard/digital-ads");
            body = formatDiagnostic(
              execResult.data as unknown as Parameters<typeof formatDiagnostic>[0],
            );
          } catch {
            body = JSON.stringify(execResult.data, null, 2).slice(0, 2000);
          }
        }

        // Send notifications
        await sendProactiveNotification(
          {
            title: `Scheduled Report: ${report.name}`,
            body,
            severity: "info",
            channels: report.deliveryChannels,
            recipients: report.deliveryTargets,
          },
          channelCredentials,
          logger,
        );

        // Compute next run
        let nextRunAt: Date | null = null;
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
          const CronParser = require("cron-parser");
          const interval = CronParser.parseExpression(report.cronExpression, {
            currentDate: new Date(),
            tz: report.timezone,
          });
          nextRunAt = interval.next().toDate();
        } catch {
          logger.warn({ reportId: report.id }, "Failed to compute next run time");
        }

        // Update report
        await (prisma as unknown as PrismaWithScheduledReport).scheduledReport.update({
          where: { id: report.id },
          data: {
            lastRunAt: now,
            nextRunAt,
          },
        });

        logger.info({ reportId: report.id, reportName: report.name }, "Scheduled report delivered");
      } catch (err) {
        logger.error(
          { err, reportId: report.id } as Record<string, unknown>,
          "Failed to run scheduled report",
        );
      }
    }
  } catch (err) {
    logger.error({ err } as Record<string, unknown>, "Error in scheduled report job");
  }
}

export function startScheduledReportJob(config: ScheduledReportJobConfig): () => void {
  const { intervalMs = 60_000, logger = createLogger("scheduled-reports") } = config;
  let stopped = false;
  let inFlightPromise: Promise<void> | null = null;

  const timer = setInterval(() => {
    if (!stopped) {
      inFlightPromise = runScheduledReportScanOnce(config);
    }
  }, intervalMs);

  logger.info({ intervalMs }, "Scheduled report runner started");

  return () => {
    stopped = true;
    clearInterval(timer);
    if (inFlightPromise) {
      inFlightPromise.catch(() => {});
    }
    logger.info("Scheduled report runner stopped");
  };
}

/** Map vertical identifiers to their corresponding cartridge ID. */
function resolveCartridgeForVertical(vertical: string): string {
  switch (vertical) {
    case "clinic":
    case "healthcare":
    case "dental":
      return "customer-engagement";
    default:
      return "digital-ads";
  }
}

/** Resolve the diagnostic action ID for a given cartridge and report type. */
function resolveDiagnoseAction(cartridgeId: string, reportType: string): string {
  if (cartridgeId === "customer-engagement") {
    return "customer-engagement.pipeline.diagnose";
  }
  return reportType === "portfolio"
    ? "digital-ads.portfolio.diagnose"
    : "digital-ads.funnel.diagnose";
}
