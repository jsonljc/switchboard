import { describe, it, expect, vi } from "vitest";
import type { WorkUnit } from "@switchboard/core/platform";
import { StaleVersionError } from "@switchboard/core";
import { buildRecordAttendanceHandler, type BookingAttendanceWriter } from "./attendance.js";

function makeWorkUnit(params: Record<string, unknown>): WorkUnit {
  return {
    id: "wu-1",
    requestedAt: new Date(0).toISOString(),
    organizationId: "org-1",
    actor: { id: "u1", type: "user" as never },
    intent: "booking.record_attendance",
    parameters: params,
    deployment: {} as never,
    resolvedMode: "operator_mutation",
    traceId: "t-1",
    trigger: "api",
    priority: "normal",
  } as WorkUnit;
}

describe("buildRecordAttendanceHandler", () => {
  it("records the outcome scoped to the work unit's org and completes", async () => {
    const writer: BookingAttendanceWriter = {
      recordAttendance: vi.fn(async () => ({ id: "b1", attendance: "attended" })),
    };
    const result = await buildRecordAttendanceHandler(writer).execute(
      makeWorkUnit({ bookingId: "b1", outcome: "attended", recordedBy: "owner" }),
    );
    expect(writer.recordAttendance).toHaveBeenCalledWith("org-1", "b1", "attended");
    expect(result.outcome).toBe("completed");
    expect(result.outputs?.booking).toEqual({ id: "b1", attendance: "attended" });
  });

  it("maps a missing booking (StaleVersionError) to failed BOOKING_NOT_FOUND", async () => {
    const writer: BookingAttendanceWriter = {
      recordAttendance: vi.fn(async () => {
        throw new StaleVersionError("b1", -1, -1);
      }),
    };
    const result = await buildRecordAttendanceHandler(writer).execute(
      makeWorkUnit({ bookingId: "b1", outcome: "no_show" }),
    );
    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("BOOKING_NOT_FOUND");
  });
});
