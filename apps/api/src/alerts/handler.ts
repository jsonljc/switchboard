import type { PrismaClient } from "@switchboard/db";
import { evaluateAlertRule } from "./evaluator.js";
import { sendProactiveNotification } from "./notifier.js";
import type { ProactiveNotification, SendResult } from "./notifier.js";
import type { Logger } from "../logger.js";

interface AlertRuleRecord {
  id: string;
  organizationId: string;
  name: string;
  metricPath: string;
  operator: string;
  threshold: number;
  notifyChannels: string[];
  notifyRecipients: string[];
  cooldownMinutes: number;
  lastTriggeredAt: Date | null;
  snoozedUntil: Date | null;
}

interface ChannelCredentials {
  slack?: { botToken: string };
  telegram?: { botToken: string };
  whatsapp?: { token: string; phoneNumberId: string };
}

/**
 * Orchestrate alert evaluation → notification → recording.
 * Respects cooldown and snooze windows.
 */
export async function handleTriggeredAlert(
  alert: AlertRuleRecord,
  diagnosticResult: Record<string, unknown>,
  prisma: PrismaClient,
  channelCredentials: ChannelCredentials,
  logger?: Logger,
): Promise<{ triggered: boolean; sent: SendResult[] }> {
  const now = new Date();

  // Check snooze
  if (alert.snoozedUntil && alert.snoozedUntil > now) {
    logger?.info({ alertRuleId: alert.id }, "Alert snoozed, skipping");
    return { triggered: false, sent: [] };
  }

  // Check cooldown
  if (alert.lastTriggeredAt) {
    const cooldownEnd = new Date(alert.lastTriggeredAt.getTime() + alert.cooldownMinutes * 60_000);
    if (cooldownEnd > now) {
      logger?.info({ alertRuleId: alert.id }, "Alert in cooldown, skipping");
      return { triggered: false, sent: [] };
    }
  }

  // Evaluate
  const evaluation = evaluateAlertRule(
    { metricPath: alert.metricPath, operator: alert.operator, threshold: alert.threshold },
    diagnosticResult,
  );

  if (!evaluation.triggered) {
    return { triggered: false, sent: [] };
  }

  // Format diagnostic summary
  let body = evaluation.description;
  try {
    const { formatDiagnostic } = await import("@switchboard/digital-ads");
    body = formatDiagnostic(diagnosticResult as any);
  } catch {
    // Fall back to evaluation description
  }

  // Determine severity
  const severity: ProactiveNotification["severity"] =
    alert.metricPath.includes("critical") ? "critical" : "warning";

  const notification: ProactiveNotification = {
    title: `Alert: ${alert.name}`,
    body,
    severity,
    channels: alert.notifyChannels,
    recipients: alert.notifyRecipients,
  };

  // Send notifications
  const sent = await sendProactiveNotification(notification, channelCredentials, logger);

  // Record alert history
  try {
    await (prisma as any).alertHistory.create({
      data: {
        alertRuleId: alert.id,
        organizationId: alert.organizationId,
        metricValue: evaluation.metricValue,
        threshold: evaluation.threshold,
        findingsSummary: evaluation.description,
        notificationsSent: sent,
      },
    });
  } catch (err) {
    logger?.error({ err, alertRuleId: alert.id }, "Failed to record alert history");
  }

  // Update lastTriggeredAt
  try {
    await (prisma as any).alertRule.update({
      where: { id: alert.id },
      data: { lastTriggeredAt: now },
    });
  } catch (err) {
    logger?.error({ err, alertRuleId: alert.id }, "Failed to update lastTriggeredAt");
  }

  logger?.info(
    { alertRuleId: alert.id, metricValue: evaluation.metricValue, threshold: evaluation.threshold },
    `Alert triggered: ${alert.name}`,
  );

  return { triggered: true, sent };
}
