import type { StorageContext } from "@switchboard/core";
import type { PrismaClient } from "@switchboard/db";
import { handleTriggeredAlert } from "../alerts/handler.js";
import { createLogger } from "../logger.js";
import type { Logger } from "../logger.js";

export interface DiagnosticScannerConfig {
  prisma: PrismaClient;
  storageContext: StorageContext;
  intervalMs?: number;
  logger?: Logger;
}

/**
 * Periodically scans orgs with enabled alert rules, runs diagnostics,
 * evaluates rules, and sends proactive notifications.
 * Returns a cleanup function that stops the interval.
 */
export function startDiagnosticScanner(config: DiagnosticScannerConfig): () => void {
  const {
    prisma,
    storageContext,
    intervalMs = 3_600_000,
    logger = createLogger("diagnostic-scanner"),
  } = config;

  let stopped = false;
  let inFlightPromise: Promise<void> | null = null;

  const scan = async () => {
    if (stopped) return;
    try {
      const now = new Date();

      // Find all enabled, non-snoozed alert rules
      const rules = await (prisma as any).alertRule.findMany({
        where: {
          enabled: true,
          OR: [
            { snoozedUntil: null },
            { snoozedUntil: { lt: now } },
          ],
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
        whatsapp: process.env["WHATSAPP_TOKEN"] && process.env["WHATSAPP_PHONE_NUMBER_ID"]
          ? { token: process.env["WHATSAPP_TOKEN"], phoneNumberId: process.env["WHATSAPP_PHONE_NUMBER_ID"] }
          : undefined,
      };

      for (const [orgId, orgRules] of byOrg) {
        if (stopped) break;

        try {
          // Run diagnostic for this org
          const cartridge = storageContext.cartridges.get("digital-ads");
          if (!cartridge) {
            logger.warn({ orgId }, "digital-ads cartridge not available, skipping org");
            continue;
          }

          // Determine platform from first rule (all rules in same org likely share platform)
          const platform = orgRules[0]?.platform ?? "meta";
          const vertical = orgRules[0]?.vertical ?? "commerce";

          const execResult = await cartridge.execute("digital-ads.funnel.diagnose", {
            platform,
            vertical,
            entityId: "act_default",
          }, { principalId: "system", organizationId: orgId, connectionCredentials: {} });

          if (!execResult?.data) {
            logger.warn({ orgId }, "No diagnostic data returned for org");
            continue;
          }

          // Evaluate each rule against the diagnostic result
          for (const rule of orgRules) {
            if (stopped) break;
            try {
              await handleTriggeredAlert(rule, execResult.data as Record<string, unknown>, prisma, channelCredentials, logger as any);
            } catch (err) {
              logger.error({ err, alertRuleId: rule.id } as any, "Failed to handle alert rule");
            }
          }
        } catch (err) {
          logger.error({ err, orgId } as any, "Failed to run diagnostic scan for org");
        }
      }

      logger.info({ orgsScanned: byOrg.size, rulesEvaluated: rules.length }, "Diagnostic scan complete");
    } catch (err) {
      logger.error({ err } as any, "Error in diagnostic scanner");
    }
  };

  // Initial scan after a 30-second delay
  const initialTimeout = setTimeout(() => {
    if (!stopped) {
      inFlightPromise = scan();
    }
  }, 30_000);

  const timer = setInterval(() => {
    inFlightPromise = scan();
  }, intervalMs);

  return () => {
    stopped = true;
    clearTimeout(initialTimeout);
    clearInterval(timer);
    if (inFlightPromise) {
      inFlightPromise.catch(() => {});
    }
  };
}
