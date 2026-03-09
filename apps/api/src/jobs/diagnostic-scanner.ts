import type { StorageContext } from "@switchboard/core";
import type { LifecycleOrchestrator } from "@switchboard/core";
import type { PrismaClient } from "@switchboard/db";
import { handleTriggeredAlert } from "../alerts/handler.js";
import { createLogger } from "../logger.js";
import type { Logger } from "../logger.js";
import { executeGovernedSystemAction } from "../services/system-governed-actions.js";

export interface DiagnosticScannerConfig {
  prisma: PrismaClient;
  storageContext: StorageContext;
  orchestrator: LifecycleOrchestrator;
  intervalMs?: number;
  logger?: Logger;
}

/**
 * Periodically scans orgs with enabled alert rules, runs diagnostics,
 * evaluates rules, and sends proactive notifications.
 * Returns a cleanup function that stops the interval.
 */
export async function runDiagnosticScanOnce(config: DiagnosticScannerConfig): Promise<void> {
  const {
    prisma,
    storageContext,
    orchestrator,
    logger = createLogger("diagnostic-scanner"),
  } = config;
  try {
    const now = new Date();

    // Find all enabled, non-snoozed alert rules
    const rules = await (prisma as any).alertRule.findMany({
      where: {
        enabled: true,
        OR: [{ snoozedUntil: null }, { snoozedUntil: { lt: now } }],
      },
    });

    if (rules.length === 0) return;

    // Group by organizationId
    const byOrg = new Map<string, typeof rules>();
    for (const rule of rules) {
      const orgRules = byOrg.get(rule.organizationId) ?? [];
      orgRules.push(rule);
      byOrg.set(rule.organizationId, orgRules);
    }

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

    for (const [orgId, orgRules] of byOrg) {
      try {
        // Determine cartridge based on the alert rule's vertical
        const vertical = orgRules[0]?.vertical ?? "commerce";
        const cartridgeId = resolveCartridgeForVertical(vertical);

        const cartridge = storageContext.cartridges.get(cartridgeId);
        if (!cartridge) {
          logger.warn(
            { orgId, cartridgeId },
            `${cartridgeId} cartridge not available, skipping org`,
          );
          continue;
        }

        // Determine platform from first rule (all rules in same org likely share platform)
        const platform = orgRules[0]?.platform ?? "meta";

        const actionId = resolveDiagnoseAction(cartridgeId);

        const governedAction = await executeGovernedSystemAction({
          orchestrator,
          actionType: actionId,
          cartridgeId,
          organizationId: orgId,
          parameters: {
            platform,
            vertical,
            entityId: "act_default",
          },
          message: "Run scheduled diagnostic scan",
          idempotencyKey: `diagnostic-scan:${orgId}:${actionId}:${platform}:${now.toISOString().slice(0, 13)}`,
        });

        if (governedAction.outcome !== "executed") {
          logger.warn(
            {
              orgId,
              actionId,
              outcome: governedAction.outcome,
              explanation: governedAction.explanation,
            },
            "Diagnostic scan was not executed",
          );
          continue;
        }

        const execResult = governedAction.executionResult;

        if (!execResult?.data) {
          logger.warn({ orgId }, "No diagnostic data returned for org");
          continue;
        }

        // Evaluate each rule against the diagnostic result
        for (const rule of orgRules) {
          try {
            await handleTriggeredAlert(
              rule,
              execResult.data as Record<string, unknown>,
              prisma,
              channelCredentials,
              logger as any,
            );
          } catch (err) {
            logger.error({ err, alertRuleId: rule.id } as any, "Failed to handle alert rule");
          }
        }
      } catch (err) {
        logger.error({ err, orgId } as any, "Failed to run diagnostic scan for org");
      }
    }

    logger.info(
      { orgsScanned: byOrg.size, rulesEvaluated: rules.length },
      "Diagnostic scan complete",
    );
  } catch (err) {
    logger.error({ err } as any, "Error in diagnostic scanner");
  }
}

export function startDiagnosticScanner(config: DiagnosticScannerConfig): () => void {
  const { intervalMs = 3_600_000, logger = createLogger("diagnostic-scanner") } = config;
  let stopped = false;
  let inFlightPromise: Promise<void> | null = null;

  // Initial scan after a 30-second delay
  const initialTimeout = setTimeout(() => {
    if (!stopped) {
      inFlightPromise = runDiagnosticScanOnce(config);
    }
  }, 30_000);

  const timer = setInterval(() => {
    inFlightPromise = runDiagnosticScanOnce(config);
  }, intervalMs);

  logger.info({ intervalMs }, "Diagnostic scanner started");

  return () => {
    stopped = true;
    clearTimeout(initialTimeout);
    clearInterval(timer);
    if (inFlightPromise) {
      inFlightPromise.catch(() => {});
    }
    logger.info("Diagnostic scanner stopped");
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

/** Resolve the diagnostic action ID for a given cartridge. */
function resolveDiagnoseAction(cartridgeId: string): string {
  switch (cartridgeId) {
    case "customer-engagement":
      return "customer-engagement.pipeline.diagnose";
    default:
      return "digital-ads.funnel.diagnose";
  }
}
