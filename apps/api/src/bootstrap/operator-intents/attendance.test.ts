import { describe, it, expect, vi } from "vitest";
import type { WorkUnit } from "@switchboard/core/platform";
import { StaleVersionError } from "@switchboard/core";
import {
  buildRecordAttendanceHandler,
  type BookingAttendanceWriter,
  type ReceiptHeldPromoter,
} from "./attendance.js";

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

  it("promotes the booking's calendar receipt booked->held when attendance is attended", async () => {
    const writer: BookingAttendanceWriter = {
      recordAttendance: vi.fn(async () => ({ id: "b1", attendance: "attended" })),
    };
    const promoter: ReceiptHeldPromoter = {
      promoteCalendarBookedToHeld: vi.fn(async () => 1),
      demoteCalendarHeldToBooked: vi.fn(async () => 0),
    };
    const result = await buildRecordAttendanceHandler(writer, promoter).execute(
      makeWorkUnit({ bookingId: "b1", outcome: "attended", recordedBy: "owner" }),
    );
    expect(promoter.promoteCalendarBookedToHeld).toHaveBeenCalledWith("org-1", "b1");
    expect(result.outcome).toBe("completed");
    expect(result.outputs?.receiptsPromoted).toBe(1);
  });

  it("demotes the calendar receipt held->booked (and does NOT promote) when the outcome is no_show", async () => {
    const writer: BookingAttendanceWriter = {
      recordAttendance: vi.fn(async () => ({ id: "b1", attendance: "no_show" })),
    };
    const promoter: ReceiptHeldPromoter = {
      promoteCalendarBookedToHeld: vi.fn(async () => 0),
      demoteCalendarHeldToBooked: vi.fn(async () => 1),
    };
    const result = await buildRecordAttendanceHandler(writer, promoter).execute(
      makeWorkUnit({ bookingId: "b1", outcome: "no_show", recordedBy: "owner" }),
    );
    // A7 rank12: a no_show corrects a prior "attended" so the held receipt reverts to booked,
    // never overstating attendance. Promote stays untouched on this path.
    expect(promoter.demoteCalendarHeldToBooked).toHaveBeenCalledWith("org-1", "b1");
    expect(promoter.promoteCalendarBookedToHeld).not.toHaveBeenCalled();
    expect(result.outcome).toBe("completed");
    expect(result.outputs?.receiptsDemoted).toBe(1);
  });

  it("completes without promotion when no promoter is wired (back-compat)", async () => {
    const writer: BookingAttendanceWriter = {
      recordAttendance: vi.fn(async () => ({ id: "b1", attendance: "attended" })),
    };
    const result = await buildRecordAttendanceHandler(writer).execute(
      makeWorkUnit({ bookingId: "b1", outcome: "attended", recordedBy: "owner" }),
    );
    expect(result.outcome).toBe("completed");
  });

  it("propagates a promoter failure (fail loud; attendance is idempotent on retry)", async () => {
    const writer: BookingAttendanceWriter = {
      recordAttendance: vi.fn(async () => ({ id: "b1", attendance: "attended" })),
    };
    const promoter: ReceiptHeldPromoter = {
      promoteCalendarBookedToHeld: vi.fn(async () => {
        throw new Error("db down");
      }),
      demoteCalendarHeldToBooked: vi.fn(async () => 0),
    };
    await expect(
      buildRecordAttendanceHandler(writer, promoter).execute(
        makeWorkUnit({ bookingId: "b1", outcome: "attended", recordedBy: "owner" }),
      ),
    ).rejects.toThrow("db down");
  });

  it("propagates a demoter failure on no_show (fail loud; attendance is idempotent on retry)", async () => {
    const writer: BookingAttendanceWriter = {
      recordAttendance: vi.fn(async () => ({ id: "b1", attendance: "no_show" })),
    };
    const promoter: ReceiptHeldPromoter = {
      promoteCalendarBookedToHeld: vi.fn(async () => 0),
      demoteCalendarHeldToBooked: vi.fn(async () => {
        throw new Error("db down");
      }),
    };
    await expect(
      buildRecordAttendanceHandler(writer, promoter).execute(
        makeWorkUnit({ bookingId: "b1", outcome: "no_show", recordedBy: "owner" }),
      ),
    ).rejects.toThrow("db down");
  });
});
