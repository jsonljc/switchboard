import { describe, it, expect, vi } from "vitest";
import type { WorkUnit } from "@switchboard/core/platform";
import type { DeliveryResult } from "../../services/reports/weekly-report-delivery.js";
import {
  buildDeliverWeeklyReportHandler,
  type WeeklyReportDeliveryWriter,
} from "./deliver-weekly-report.js";
import { OPERATOR_INTENT_ERROR_CODES } from "./shared.js";

function makeWorkUnit(overrides?: Partial<WorkUnit>): WorkUnit {
  return {
    id: "wu_weekly",
    requestedAt: "2026-06-15T13:00:00.000Z",
    organizationId: "org_acme",
    actor: { id: "system", type: "system" },
    intent: "ledger.deliver_weekly_report",
    parameters: {},
    deployment: {
      deploymentId: "dep_x",
      skillSlug: "ledger",
      trustLevel: "guided",
      trustScore: 100,
    },
    resolvedMode: "operator_mutation",
    traceId: "trace_weekly",
    trigger: "schedule",
    priority: "normal",
    ...overrides,
  };
}

function makeWriter(result: DeliveryResult): WeeklyReportDeliveryWriter {
  return {
    deliverReport: vi.fn<(input: { orgId: string; actorId: string }) => Promise<DeliveryResult>>(
      () => Promise.resolve(result),
    ),
  };
}

describe("buildDeliverWeeklyReportHandler", () => {
  it("delivered -> completed with recipientCount in summary + outputs", async () => {
    const writer = makeWriter({ status: "delivered", recipientCount: 3 });
    const handler = buildDeliverWeeklyReportHandler(writer);

    const result = await handler.execute(makeWorkUnit());

    expect(writer.deliverReport).toHaveBeenCalledWith({ orgId: "org_acme", actorId: "system" });
    expect(result.outcome).toBe("completed");
    expect(result.summary).toContain("3");
    expect(result.outputs).toEqual({ delivered: true, recipientCount: 3 });
  });

  it("no_recipients -> completed (nothing sent) with delivered:false", async () => {
    const writer = makeWriter({ status: "no_recipients" });
    const handler = buildDeliverWeeklyReportHandler(writer);

    const result = await handler.execute(makeWorkUnit());

    expect(result.outcome).toBe("completed");
    expect(result.outputs).toEqual({ delivered: false, recipientCount: 0 });
  });

  it("not_configured -> failed with WEEKLY_REPORT_DELIVERY_FAILED", async () => {
    const writer = makeWriter({ status: "not_configured" });
    const handler = buildDeliverWeeklyReportHandler(writer);

    const result = await handler.execute(makeWorkUnit());

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe(OPERATOR_INTENT_ERROR_CODES.WEEKLY_REPORT_DELIVERY_FAILED);
  });

  it("send_failed -> failed with WEEKLY_REPORT_DELIVERY_FAILED and the reason in the message", async () => {
    const writer = makeWriter({ status: "send_failed", reason: "send_error" });
    const handler = buildDeliverWeeklyReportHandler(writer);

    const result = await handler.execute(makeWorkUnit());

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe(OPERATOR_INTENT_ERROR_CODES.WEEKLY_REPORT_DELIVERY_FAILED);
    expect(result.error?.message).toContain("send_error");
  });
});
