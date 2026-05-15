// apps/api/src/routes/__tests__/lifecycle-disqualifications-ingress.test.ts
// ---------------------------------------------------------------------------
// PlatformIngress migration tests for Phase 1b.3:
//   POST /api/dashboard/lifecycle/disqualifications/:threadId/confirm
//   POST /api/dashboard/lifecycle/disqualifications/:threadId/dismiss
//
// Mirrors the existing POST describe blocks from api-lifecycle-disqualifications.test.ts
// but uses buildTestServer (which wires PlatformIngress) and asserts that
// app.lastIngressTrace confirms the route went through ingress.
// ---------------------------------------------------------------------------
import { describe, it, expect, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { HookConfirmResult, HookDismissResult } from "@switchboard/core";
import { buildTestServer } from "../../__tests__/test-server.js";

// ---------------------------------------------------------------------------
// Hook factory helpers — return Pick<DisqualificationResolutionHook,"confirm"|"dismiss">
// so buildTestServer accepts them without casts (Fix #572-I5).
// ---------------------------------------------------------------------------

function makeConfirmHook(result: HookConfirmResult) {
  return {
    confirm: vi.fn(async (): Promise<HookConfirmResult> => result),
    dismiss: vi.fn(
      async (): Promise<HookDismissResult> => ({
        result: "dismissed" as const,
        restoredStatus: "unknown" as const,
      }),
    ),
  };
}

function makeDismissHook(result: HookDismissResult) {
  return {
    confirm: vi.fn(async (): Promise<HookConfirmResult> => ({ result: "confirmed" as const })),
    dismiss: vi.fn(async (): Promise<HookDismissResult> => result),
  };
}

function makeThrowingConfirmHook(message: string) {
  return {
    confirm: vi.fn(async (): Promise<HookConfirmResult> => {
      throw new Error(message);
    }),
    dismiss: vi.fn(
      async (): Promise<HookDismissResult> => ({
        result: "dismissed" as const,
        restoredStatus: "unknown" as const,
      }),
    ),
  };
}

function makeThrowingDismissHook(message: string) {
  return {
    confirm: vi.fn(async (): Promise<HookConfirmResult> => ({ result: "confirmed" as const })),
    dismiss: vi.fn(async (): Promise<HookDismissResult> => {
      throw new Error(message);
    }),
  };
}

// ---------------------------------------------------------------------------
// POST confirm — Phase 1b.3 ingress tests
// ---------------------------------------------------------------------------

describe("POST /api/dashboard/lifecycle/disqualifications/:threadId/confirm — PlatformIngress migration (Phase 1b.3)", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  it("200 confirmed (happy path) — enters PlatformIngress and persists WorkTrace", async () => {
    const { app: built } = await buildTestServer({
      disqualificationHook: makeConfirmHook({ result: "confirmed" }),
    });
    app = built;

    const res = await app.inject({
      method: "POST",
      url: "/api/dashboard/lifecycle/disqualifications/thread-1/confirm",
      headers: { "x-org-id": "org-1", "content-type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ result: "confirmed" });

    // Proves the route entered PlatformIngress:
    const last = app.lastIngressTrace;
    expect(last).toBeDefined();
    expect(last!.intent).toBe("operator.confirm_disqualification");
    expect(last!.mode).toBe("operator_mutation");
    expect(last!.organizationId).toBe("org-1");
    expect(last!.outcome).toBe("completed");
  });

  it("200 already_applied — idempotent re-confirm carries alreadyApplied flag", async () => {
    const { app: built } = await buildTestServer({
      disqualificationHook: makeConfirmHook({ result: "already_applied" }),
    });
    app = built;

    const res = await app.inject({
      method: "POST",
      url: "/api/dashboard/lifecycle/disqualifications/thread-1/confirm",
      headers: { "x-org-id": "org-1", "content-type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ result: "confirmed", alreadyApplied: true });

    const last = app.lastIngressTrace;
    expect(last?.intent).toBe("operator.confirm_disqualification");
    expect(last?.outcome).toBe("completed");
  });

  it("409 already_disqualified — conflict without lineage; WorkTrace outcome=failed", async () => {
    const { app: built } = await buildTestServer({
      disqualificationHook: makeConfirmHook({ result: "conflict", reason: "already_disqualified" }),
    });
    app = built;

    const res = await app.inject({
      method: "POST",
      url: "/api/dashboard/lifecycle/disqualifications/thread-1/confirm",
      headers: { "x-org-id": "org-1", "content-type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ reason: "already_disqualified" });

    // Conflict is a semantic failure — WorkTrace records outcome=failed (Fix #572-I3).
    const last = app.lastIngressTrace;
    expect(last?.outcome).toBe("failed");
  });

  it("409 already_booked — contact booked before operator acted; WorkTrace outcome=failed", async () => {
    const { app: built } = await buildTestServer({
      disqualificationHook: makeConfirmHook({ result: "conflict", reason: "already_booked" }),
    });
    app = built;

    const res = await app.inject({
      method: "POST",
      url: "/api/dashboard/lifecycle/disqualifications/thread-1/confirm",
      headers: { "x-org-id": "org-1", "content-type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ reason: "already_booked" });

    const last = app.lastIngressTrace;
    expect(last?.outcome).toBe("failed");
  });

  it("404 not_found — thread does not exist; WorkTrace outcome=failed", async () => {
    const { app: built } = await buildTestServer({
      disqualificationHook: makeConfirmHook({ result: "not_found" }),
    });
    app = built;

    const res = await app.inject({
      method: "POST",
      url: "/api/dashboard/lifecycle/disqualifications/thread-missing/confirm",
      headers: { "x-org-id": "org-1", "content-type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ reason: "not_found" });

    const last = app.lastIngressTrace;
    expect(last?.outcome).toBe("failed");
  });

  it("404 when capability is off (capability_disabled surfaces as not_found); WorkTrace outcome=failed", async () => {
    const { app: built } = await buildTestServer({
      disqualificationHook: makeConfirmHook({ result: "capability_disabled" }),
    });
    app = built;

    const res = await app.inject({
      method: "POST",
      url: "/api/dashboard/lifecycle/disqualifications/thread-1/confirm",
      headers: { "x-org-id": "org-1", "content-type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ reason: "not_found" });

    const last = app.lastIngressTrace;
    expect(last?.outcome).toBe("failed");
  });

  // Regression test for Fix #572-C1: hook throw must NOT propagate to 500.
  // Original route caught this and returned 404 {reason:"not_found"}.
  // New handler catches the throw and returns outcome=failed with
  // DISQUALIFICATION_HOOK_THROW; the route maps that to 404 {reason:"not_found"}.
  it("404 when confirm hook throws (downstream timeout) — regression for hook-throw → 500 bug", async () => {
    const { app: built } = await buildTestServer({
      disqualificationHook: makeThrowingConfirmHook("downstream timeout"),
    });
    app = built;

    const res = await app.inject({
      method: "POST",
      url: "/api/dashboard/lifecycle/disqualifications/thread-1/confirm",
      headers: { "x-org-id": "org-1", "content-type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ reason: "not_found" });

    // WorkTrace is persisted even for throws (governed evidence).
    const last = app.lastIngressTrace;
    expect(last?.outcome).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// POST dismiss — Phase 1b.3 ingress tests
// ---------------------------------------------------------------------------

describe("POST /api/dashboard/lifecycle/disqualifications/:threadId/dismiss — PlatformIngress migration (Phase 1b.3)", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  it("200 dismissed with restoredStatus (happy path) — enters PlatformIngress and persists WorkTrace", async () => {
    const { app: built } = await buildTestServer({
      disqualificationHook: makeDismissHook({ result: "dismissed", restoredStatus: "qualified" }),
    });
    app = built;

    const res = await app.inject({
      method: "POST",
      url: "/api/dashboard/lifecycle/disqualifications/thread-1/dismiss",
      headers: { "x-org-id": "org-1", "content-type": "application/json" },
      payload: { operatorNote: "Actually interested" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ result: "dismissed", restoredStatus: "qualified" });

    // Proves the route entered PlatformIngress:
    const last = app.lastIngressTrace;
    expect(last).toBeDefined();
    expect(last!.intent).toBe("operator.dismiss_disqualification");
    expect(last!.mode).toBe("operator_mutation");
    expect(last!.organizationId).toBe("org-1");
    expect(last!.outcome).toBe("completed");
  });

  it("200 dismissed — restoredStatus unknown is preserved", async () => {
    const { app: built } = await buildTestServer({
      disqualificationHook: makeDismissHook({ result: "dismissed", restoredStatus: "unknown" }),
    });
    app = built;

    const res = await app.inject({
      method: "POST",
      url: "/api/dashboard/lifecycle/disqualifications/thread-1/dismiss",
      headers: { "x-org-id": "org-1", "content-type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ result: "dismissed", restoredStatus: "unknown" });
  });

  it("409 not_proposed — thread is not in proposed_disqualified state; WorkTrace outcome=failed", async () => {
    const { app: built } = await buildTestServer({
      disqualificationHook: makeDismissHook({ result: "conflict", reason: "not_proposed" }),
    });
    app = built;

    const res = await app.inject({
      method: "POST",
      url: "/api/dashboard/lifecycle/disqualifications/thread-1/dismiss",
      headers: { "x-org-id": "org-1", "content-type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ reason: "not_proposed" });

    // Conflict is a semantic failure — WorkTrace records outcome=failed (Fix #572-I3).
    const last = app.lastIngressTrace;
    expect(last?.outcome).toBe("failed");
  });

  it("404 not_found — thread does not exist for dismiss; WorkTrace outcome=failed", async () => {
    const { app: built } = await buildTestServer({
      disqualificationHook: makeDismissHook({ result: "not_found" }),
    });
    app = built;

    const res = await app.inject({
      method: "POST",
      url: "/api/dashboard/lifecycle/disqualifications/thread-missing/dismiss",
      headers: { "x-org-id": "org-1", "content-type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ reason: "not_found" });

    const last = app.lastIngressTrace;
    expect(last?.outcome).toBe("failed");
  });

  it("404 when capability is off for dismiss (capability_disabled surfaces as not_found); WorkTrace outcome=failed", async () => {
    const { app: built } = await buildTestServer({
      disqualificationHook: makeDismissHook({ result: "capability_disabled" }),
    });
    app = built;

    const res = await app.inject({
      method: "POST",
      url: "/api/dashboard/lifecycle/disqualifications/thread-1/dismiss",
      headers: { "x-org-id": "org-1", "content-type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ reason: "not_found" });

    const last = app.lastIngressTrace;
    expect(last?.outcome).toBe("failed");
  });

  // Regression test for Fix #572-C1: hook throw must NOT propagate to 500.
  it("404 when dismiss hook throws (downstream timeout) — regression for hook-throw → 500 bug", async () => {
    const { app: built } = await buildTestServer({
      disqualificationHook: makeThrowingDismissHook("downstream timeout"),
    });
    app = built;

    const res = await app.inject({
      method: "POST",
      url: "/api/dashboard/lifecycle/disqualifications/thread-1/dismiss",
      headers: { "x-org-id": "org-1", "content-type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ reason: "not_found" });

    // WorkTrace is persisted even for throws (governed evidence).
    const last = app.lastIngressTrace;
    expect(last?.outcome).toBe("failed");
  });
});
