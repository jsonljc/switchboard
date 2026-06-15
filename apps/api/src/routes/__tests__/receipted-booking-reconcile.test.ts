// apps/api/src/routes/__tests__/receipted-booking-reconcile.test.ts
// Integration tests for POST /api/:orgId/bookings/:bookingId/reconcile, the operator-direct
// production caller for receipt.reconcile_booking. Mirrors booking-attendance.test.ts: the mutation
// enters through PlatformIngress.submit (no bypass), a WorkTrace is persisted, Idempotency-Key is
// required, and the authenticated org/actor are authoritative over the body. A fake
// ReconcileBookingWriter (applyReconcile vi.fn) is injected via buildTestServer (no Postgres).
import { describe, it, expect, vi } from "vitest";
import type { ReconcileBookingWriter } from "../../bootstrap/operator-intents/reconcile-booking.js";
import { buildTestServer } from "../../__tests__/test-server.js";
import { RECONCILE_BOOKING_INTENT } from "../../bootstrap/operator-intents.js";

function makeWriter(
  result: Awaited<ReturnType<ReconcileBookingWriter["applyReconcile"]>> = {
    status: "applied",
    created: false,
  },
): { applyReconcile: ReturnType<typeof vi.fn> } & ReconcileBookingWriter {
  return {
    applyReconcile: vi.fn<ReconcileBookingWriter["applyReconcile"]>().mockResolvedValue(result),
  };
}

const hdr = {
  "Idempotency-Key": "rec-1",
  "x-org-id": "org_a",
  "x-principal-id": "user_1",
};

describe("POST /api/:orgId/bookings/:bookingId/reconcile - operator-direct ingress", () => {
  it("200 + applies an override via ingress and persists a WorkTrace", async () => {
    const reconcileBookingWriter = makeWriter({ status: "applied", created: true });
    const { app } = await buildTestServer({ reconcileBookingWriter });
    const prevCount = app.ingressTraceCount ?? 0;

    const res = await app.inject({
      method: "POST",
      url: "/api/org_a/bookings/bk_1/reconcile",
      headers: hdr,
      payload: { action: "override_attribution", confidence: "high", reason: "owner knows source" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "applied", created: true });

    expect(reconcileBookingWriter.applyReconcile).toHaveBeenCalledTimes(1);
    expect(reconcileBookingWriter.applyReconcile).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org_a",
        bookingId: "bk_1",
        actorId: "user_1",
        action: {
          action: "override_attribution",
          bookingId: "bk_1",
          confidence: "high",
          reason: "owner knows source",
        },
      }),
    );

    expect(app.ingressTraceCount).toBe(prevCount + 1);
    expect(app.lastIngressTrace!.intent).toBe(RECONCILE_BOOKING_INTENT);
    expect(app.lastIngressTrace!.mode).toBe("operator_mutation");
    expect(app.lastIngressTrace!.outcome).toBe("completed");
    expect(app.lastIngressTrace!.organizationId).toBe("org_a");

    await app.close();
  });

  it("auth org wins over a mismatched path :orgId", async () => {
    const reconcileBookingWriter = makeWriter();
    const { app } = await buildTestServer({ reconcileBookingWriter });

    const res = await app.inject({
      method: "POST",
      url: "/api/org_b/bookings/bk_1/reconcile",
      headers: hdr,
      payload: { action: "override_attribution", confidence: "high", reason: "x" },
    });

    expect(res.statusCode).toBe(200);
    expect(reconcileBookingWriter.applyReconcile).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org_a", bookingId: "bk_1" }),
    );
    await app.close();
  });

  it("404 when the booking is not found", async () => {
    const reconcileBookingWriter = makeWriter({ status: "not_found" });
    const { app } = await buildTestServer({ reconcileBookingWriter });

    const res = await app.inject({
      method: "POST",
      url: "/api/org_a/bookings/missing/reconcile",
      headers: hdr,
      payload: { action: "override_attribution", confidence: "high", reason: "x" },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("404 when the receipted-booking row is not issued (flag on an un-issued booking)", async () => {
    const reconcileBookingWriter = makeWriter({ status: "not_issued" });
    const { app } = await buildTestServer({ reconcileBookingWriter });

    const res = await app.inject({
      method: "POST",
      url: "/api/org_a/bookings/bk_1/reconcile",
      headers: hdr,
      payload: { action: "flag_duplicate", detail: "same phone" },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("400 when resolve_exception targets an unsupported code", async () => {
    const reconcileBookingWriter = makeWriter({ status: "unsupported_code" });
    const { app } = await buildTestServer({ reconcileBookingWriter });

    const res = await app.inject({
      method: "POST",
      url: "/api/org_a/bookings/bk_1/reconcile",
      headers: hdr,
      payload: { action: "resolve_exception", code: "missing_source" },
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("400 on an invalid action", async () => {
    const reconcileBookingWriter = makeWriter();
    const { app } = await buildTestServer({ reconcileBookingWriter });

    const res = await app.inject({
      method: "POST",
      url: "/api/org_a/bookings/bk_1/reconcile",
      headers: hdr,
      payload: { action: "delete_booking" },
    });

    expect(res.statusCode).toBe(400);
    expect(reconcileBookingWriter.applyReconcile).not.toHaveBeenCalled();
    await app.close();
  });

  it("400 when the Idempotency-Key header is missing", async () => {
    const reconcileBookingWriter = makeWriter();
    const { app } = await buildTestServer({ reconcileBookingWriter });

    const res = await app.inject({
      method: "POST",
      url: "/api/org_a/bookings/bk_1/reconcile",
      headers: { "x-org-id": "org_a", "x-principal-id": "user_1" },
      payload: { action: "override_attribution", confidence: "high", reason: "x" },
    });

    expect(res.statusCode).toBe(400);
    expect(reconcileBookingWriter.applyReconcile).not.toHaveBeenCalled();
    await app.close();
  });
});
