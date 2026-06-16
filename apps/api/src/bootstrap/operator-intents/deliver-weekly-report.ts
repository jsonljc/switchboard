// apps/api/src/bootstrap/operator-intents/deliver-weekly-report.ts
// ---------------------------------------------------------------------------
// ledger.deliver_weekly_report handler. A system-initiated (cron) operator-direct
// mutation: assemble + email the completed-week owner report. system_auto_approved,
// non-financial (no outbound spend), fully audited via the WorkTrace PlatformIngress
// writes around the handler. The delivery itself lives in the injected writer; this
// adapter maps its DeliveryResult to the governed outcome contract.
//
// "no_recipients" is a COMPLETED outcome (there was nothing to send, not a failure);
// "not_configured" / "send_failed" are genuine failures so the cron's run history and
// the WorkTrace record an honest non-delivery.
// ---------------------------------------------------------------------------
import type { OperatorMutationHandler } from "@switchboard/core/platform";
import type { DeliveryResult } from "../../services/reports/weekly-report-delivery.js";
import { OPERATOR_INTENT_ERROR_CODES } from "./shared.js";

/** Minimal writer surface; createWeeklyReportDeliveryService satisfies it structurally. */
export interface WeeklyReportDeliveryWriter {
  deliverReport(input: { orgId: string; actorId: string }): Promise<DeliveryResult>;
}

export function buildDeliverWeeklyReportHandler(
  writer: WeeklyReportDeliveryWriter,
): OperatorMutationHandler {
  return {
    async execute(workUnit) {
      const res = await writer.deliverReport({
        orgId: workUnit.organizationId,
        actorId: workUnit.actor.id,
      });

      switch (res.status) {
        case "delivered":
          return {
            outcome: "completed" as const,
            summary: `Weekly report delivered to ${res.recipientCount} recipient(s)`,
            outputs: { delivered: true, recipientCount: res.recipientCount },
          };
        case "no_recipients":
          return {
            outcome: "completed" as const,
            summary: "No verified recipients; nothing sent",
            outputs: { delivered: false, recipientCount: 0 },
          };
        case "not_configured":
          return {
            outcome: "failed" as const,
            summary: "Email sending is not configured",
            error: {
              code: OPERATOR_INTENT_ERROR_CODES.WEEKLY_REPORT_DELIVERY_FAILED,
              message: "Email not configured",
            },
          };
        case "send_failed":
          return {
            outcome: "failed" as const,
            summary: `Weekly report send failed: ${res.reason}`,
            error: {
              code: OPERATOR_INTENT_ERROR_CODES.WEEKLY_REPORT_DELIVERY_FAILED,
              message: res.reason,
            },
          };
      }
    },
  };
}
