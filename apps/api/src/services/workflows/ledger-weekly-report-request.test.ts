import { describe, it, expect } from "vitest";
import { buildDeliverWeeklyReportSubmitRequest } from "./ledger-weekly-report-request.js";

describe("buildDeliverWeeklyReportSubmitRequest", () => {
  it("builds a schedule-triggered, seeded-system-actor operator submit with the passed key", () => {
    const req = buildDeliverWeeklyReportSubmitRequest({
      organizationId: "org_1",
      idempotencyKey: "ledger-weekly-report:org_1:2026-W24",
    });

    expect(req.organizationId).toBe("org_1");
    // Seeded system principal VERBATIM: a bespoke system:<x> id has no IdentitySpec and hard-denies.
    expect(req.actor).toEqual({ id: "system", type: "system" });
    expect(req.intent).toBe("ledger.deliver_weekly_report");
    expect(req.trigger).toBe("schedule");
    expect(req.surface).toEqual({ surface: "api" });
    expect(req.idempotencyKey).toBe("ledger-weekly-report:org_1:2026-W24");
    expect(req.parameters).toEqual({});
  });
});
