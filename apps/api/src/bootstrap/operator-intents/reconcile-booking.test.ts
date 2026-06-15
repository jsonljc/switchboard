import { describe, it, expect, vi } from "vitest";
import type { ApplyReconcileResult } from "@switchboard/db";
import {
  buildReconcileBookingHandler,
  RECONCILE_BOOKING_INTENT,
  type ReconcileBookingWriter,
} from "./reconcile-booking.js";
import { OPERATOR_INTENT_ERROR_CODES } from "./shared.js";

function workUnit(parameters: Record<string, unknown>, actorId = "user_1") {
  return {
    organizationId: "org_1",
    actor: { id: actorId, type: "user" as const },
    intent: RECONCILE_BOOKING_INTENT,
    parameters,
  } as never;
}

function makeWriter(result: ApplyReconcileResult): {
  applyReconcile: ReturnType<typeof vi.fn>;
} & ReconcileBookingWriter {
  return {
    applyReconcile: vi.fn<ReconcileBookingWriter["applyReconcile"]>().mockResolvedValue(result),
  };
}

describe("buildReconcileBookingHandler", () => {
  it("override_attribution happy path: passes the AUTHENTICATED actor as actorId (never the body)", async () => {
    const writer = makeWriter({ status: "applied", created: false });
    const handler = buildReconcileBookingHandler(writer);

    const res = await handler.execute(
      workUnit(
        {
          action: "override_attribution",
          bookingId: "bk_1",
          confidence: "high",
          reason: "owner knows source",
        },
        "user_42",
      ),
    );

    expect(res.outcome).toBe("completed");
    expect(res.outputs).toMatchObject({ status: "applied", created: false });
    expect(writer.applyReconcile).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org_1",
        bookingId: "bk_1",
        actorId: "user_42",
        action: {
          action: "override_attribution",
          bookingId: "bk_1",
          confidence: "high",
          reason: "owner knows source",
        },
      }),
    );
  });

  it("override_attribution create path surfaces created=true", async () => {
    const writer = makeWriter({ status: "applied", created: true });
    const handler = buildReconcileBookingHandler(writer);
    const res = await handler.execute(
      workUnit({
        action: "override_attribution",
        bookingId: "bk_1",
        confidence: "high",
        reason: "x",
      }),
    );
    expect(res.outcome).toBe("completed");
    expect(res.outputs).toMatchObject({ created: true });
  });

  it("maps not_found to a failed outcome with BOOKING_NOT_FOUND", async () => {
    const writer = makeWriter({ status: "not_found" });
    const handler = buildReconcileBookingHandler(writer);
    const res = await handler.execute(
      workUnit({
        action: "override_attribution",
        bookingId: "missing",
        confidence: "high",
        reason: "x",
      }),
    );
    expect(res.outcome).toBe("failed");
    expect(res.error?.code).toBe(OPERATOR_INTENT_ERROR_CODES.BOOKING_NOT_FOUND);
  });

  it("maps not_issued to a failed outcome with RECEIPTED_BOOKING_NOT_ISSUED", async () => {
    const writer = makeWriter({ status: "not_issued" });
    const handler = buildReconcileBookingHandler(writer);
    const res = await handler.execute(
      workUnit({ action: "flag_duplicate", bookingId: "bk_1", detail: "dup" }),
    );
    expect(res.outcome).toBe("failed");
    expect(res.error?.code).toBe(OPERATOR_INTENT_ERROR_CODES.RECEIPTED_BOOKING_NOT_ISSUED);
  });

  it("maps unsupported_code to a failed outcome with RECONCILE_UNSUPPORTED_CODE", async () => {
    const writer = makeWriter({ status: "unsupported_code" });
    const handler = buildReconcileBookingHandler(writer);
    const res = await handler.execute(
      workUnit({ action: "resolve_exception", bookingId: "bk_1", code: "missing_source" }),
    );
    expect(res.outcome).toBe("failed");
    expect(res.error?.code).toBe(OPERATOR_INTENT_ERROR_CODES.RECONCILE_UNSUPPORTED_CODE);
  });

  it("rejects invalid parameters (bad confidence enum) by throwing (Zod), without calling the writer", async () => {
    const writer = makeWriter({ status: "applied", created: false });
    const handler = buildReconcileBookingHandler(writer);
    await expect(
      handler.execute(
        workUnit({
          action: "override_attribution",
          bookingId: "bk_1",
          confidence: "bogus",
          reason: "x",
        }),
      ),
    ).rejects.toThrow();
    expect(writer.applyReconcile).not.toHaveBeenCalled();
  });
});
