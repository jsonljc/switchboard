// apps/api/src/routes/__tests__/booking-attendance.test.ts
// ---------------------------------------------------------------------------
// Integration tests for POST /api/:orgId/bookings/:bookingId/attendance —
// the operator-direct production caller (Slice 1). Mirrors
// revenue-ingress.test.ts: PlatformIngress submit, WorkTrace persistence,
// idempotency enforcement, not-found mapping, and auth-org authority over the
// path param. A fake BookingAttendanceWriter (recordAttendance vi.fn) is
// injected via buildTestServer so no Postgres is required.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi } from "vitest";
import { StaleVersionError } from "@switchboard/core";
import type { BookingAttendanceWriter } from "../../bootstrap/operator-intents/attendance.js";
import { buildTestServer } from "../../__tests__/test-server.js";
import { RECORD_ATTENDANCE_INTENT } from "../../bootstrap/operator-intents.js";

function makeWriter(
  recordImpl?: BookingAttendanceWriter["recordAttendance"],
): BookingAttendanceWriter {
  return {
    recordAttendance: vi.fn(
      recordImpl ?? (async (_orgId, bookingId) => ({ id: bookingId, attendance: "attended" })),
    ),
  };
}

describe("POST /api/:orgId/bookings/:bookingId/attendance — operator-direct ingress", () => {
  it("200 + records the outcome via ingress and persists a WorkTrace", async () => {
    const bookingAttendanceWriter = makeWriter();
    const { app } = await buildTestServer({ bookingAttendanceWriter });
    const prevCount = app.ingressTraceCount ?? 0;

    const res = await app.inject({
      method: "POST",
      url: "/api/org_a/bookings/b1/attendance",
      headers: {
        "Idempotency-Key": "att-happy-1",
        "x-org-id": "org_a",
        "x-principal-id": "u1",
      },
      payload: { outcome: "attended" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { booking: { id: string; attendance: string | null } };
    expect(body.booking).toEqual({ id: "b1", attendance: "attended" });

    // Writer called once, scoped to the authenticated org + path booking id.
    expect(bookingAttendanceWriter.recordAttendance).toHaveBeenCalledTimes(1);
    expect(bookingAttendanceWriter.recordAttendance).toHaveBeenCalledWith(
      "org_a",
      "b1",
      "attended",
    );

    // WorkTrace persisted with the expected shape.
    expect(app.ingressTraceCount).toBe(prevCount + 1);
    expect(app.lastIngressTrace).toBeDefined();
    expect(app.lastIngressTrace!.intent).toBe(RECORD_ATTENDANCE_INTENT);
    expect(app.lastIngressTrace!.mode).toBe("operator_mutation");
    expect(app.lastIngressTrace!.outcome).toBe("completed");
    expect(app.lastIngressTrace!.organizationId).toBe("org_a");

    await app.close();
  });

  it("writer throws StaleVersionError (missing booking) → 404", async () => {
    const bookingAttendanceWriter = makeWriter(async () => {
      throw new StaleVersionError("b1", -1, -1);
    });
    const { app } = await buildTestServer({ bookingAttendanceWriter });

    const res = await app.inject({
      method: "POST",
      url: "/api/org_a/bookings/b1/attendance",
      headers: {
        "Idempotency-Key": "att-404-1",
        "x-org-id": "org_a",
        "x-principal-id": "u1",
      },
      payload: { outcome: "no_show" },
    });

    expect(res.statusCode).toBe(404);
    expect(bookingAttendanceWriter.recordAttendance).toHaveBeenCalledWith("org_a", "b1", "no_show");

    await app.close();
  });

  it("invalid outcome ('maybe') → 400, writer not called", async () => {
    const bookingAttendanceWriter = makeWriter();
    const { app } = await buildTestServer({ bookingAttendanceWriter });

    const res = await app.inject({
      method: "POST",
      url: "/api/org_a/bookings/b1/attendance",
      headers: {
        "Idempotency-Key": "att-bad-1",
        "x-org-id": "org_a",
        "x-principal-id": "u1",
      },
      payload: { outcome: "maybe" },
    });

    expect(res.statusCode).toBe(400);
    expect(bookingAttendanceWriter.recordAttendance).not.toHaveBeenCalled();

    await app.close();
  });

  it("missing Idempotency-Key → 400 missing_idempotency_key; writer not called", async () => {
    const bookingAttendanceWriter = makeWriter();
    const { app } = await buildTestServer({ bookingAttendanceWriter });

    const res = await app.inject({
      method: "POST",
      url: "/api/org_a/bookings/b1/attendance",
      headers: {
        "x-org-id": "org_a",
        "x-principal-id": "u1",
        // intentionally NO Idempotency-Key header
      },
      payload: { outcome: "attended" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "missing_idempotency_key" });
    expect(bookingAttendanceWriter.recordAttendance).not.toHaveBeenCalled();

    await app.close();
  });

  it("auth org wins over a mismatched path :orgId — writer scoped to the AUTHENTICATED org", async () => {
    const bookingAttendanceWriter = makeWriter();
    const { app } = await buildTestServer({ bookingAttendanceWriter });
    const prevCount = app.ingressTraceCount ?? 0;

    // Path param says org_b but auth header says org_a — auth must win.
    const res = await app.inject({
      method: "POST",
      url: "/api/org_b/bookings/b1/attendance",
      headers: {
        "Idempotency-Key": "att-xtenant-1",
        "x-org-id": "org_a",
        "x-principal-id": "u1",
      },
      payload: { outcome: "attended" },
    });

    expect(res.statusCode).toBe(200);

    // Writer called with organizationId from auth (org_a), not path param (org_b).
    expect(bookingAttendanceWriter.recordAttendance).toHaveBeenCalledTimes(1);
    expect(bookingAttendanceWriter.recordAttendance).toHaveBeenCalledWith(
      "org_a",
      "b1",
      "attended",
    );

    // WorkTrace also attributed to the auth org.
    expect(app.ingressTraceCount).toBe(prevCount + 1);
    expect(app.lastIngressTrace?.organizationId).toBe("org_a");

    await app.close();
  });
});
