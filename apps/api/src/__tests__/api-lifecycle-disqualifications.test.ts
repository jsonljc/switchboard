// apps/api/src/__tests__/api-lifecycle-disqualifications.test.ts
// ---------------------------------------------------------------------------
// Tests for the Phase 3b lifecycle disqualification API routes:
//   GET  /api/dashboard/lifecycle/disqualifications/pending
//   POST /api/dashboard/lifecycle/disqualifications/:threadId/confirm
//   POST /api/dashboard/lifecycle/disqualifications/:threadId/dismiss
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance, FastifyError } from "fastify";
import type {
  ConversationLifecycleSnapshot,
  ConversationLifecycleTransition,
} from "@switchboard/schemas";
import type { HookConfirmResult, HookDismissResult } from "@switchboard/core";
import { registerLifecycleDisqualificationsRoutes } from "../routes/lifecycle-disqualifications.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSnapshot(
  overrides: Partial<ConversationLifecycleSnapshot> = {},
): ConversationLifecycleSnapshot {
  return {
    conversationThreadId: "thread-1",
    organizationId: "org-1",
    contactId: "contact-1",
    currentState: "active",
    qualificationStatus: "proposed_disqualified",
    bookingStatus: "not_booked",
    dropoffReason: null,
    lastTransitionAt: new Date("2026-05-01T10:00:00Z"),
    lastEvaluatedAt: new Date("2026-05-01T10:00:00Z"),
    updatedAt: new Date("2026-05-01T10:00:00Z"),
    ...overrides,
  };
}

const baseProposal: ConversationLifecycleTransition = {
  id: "trans-1",
  organizationId: "org-1",
  conversationThreadId: "thread-1",
  contactId: "contact-1",
  fromState: "active",
  toState: "active",
  trigger: "system_proposed_disqualification",
  actor: "system",
  evidence: { reason: "price_sensitivity", score: 0.82 },
  workTraceId: null,
  occurredAt: new Date("2026-05-01T10:00:00Z"),
};

// ---------------------------------------------------------------------------
// Test builder — lightweight Fastify + mocked deps (no real Prisma)
// ---------------------------------------------------------------------------

function buildApp(
  overrides: {
    listPendingDisqualifications?: () => Promise<ConversationLifecycleSnapshot[]>;
    findLatestProposal?: () => Promise<ConversationLifecycleTransition | null>;
    confirm?: () => Promise<HookConfirmResult>;
    dismiss?: () => Promise<HookDismissResult>;
  } = {},
): FastifyInstance {
  const app = Fastify({ logger: false });

  // Simulate dev mode (mirrors test-server.ts pattern)
  app.decorate("authDisabled", true);

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const message = statusCode >= 500 ? "Internal server error" : error.message;
    return reply.code(statusCode).send({ error: message, statusCode });
  });

  const mockSnapshotStore = {
    listPendingDisqualifications: vi.fn(overrides.listPendingDisqualifications ?? (async () => [])),
  };

  const mockTransitionStore = {
    findLatestProposal: vi.fn(
      overrides.findLatestProposal ??
        (async (): Promise<ConversationLifecycleTransition | null> => null),
    ),
  };

  const mockDisqualificationHook = {
    confirm: vi.fn(
      overrides.confirm ??
        (async (): Promise<HookConfirmResult> => ({ result: "confirmed" as const })),
    ),
    dismiss: vi.fn(
      overrides.dismiss ??
        (async (): Promise<HookDismissResult> => ({
          result: "dismissed" as const,
          restoredStatus: "unknown" as const,
        })),
    ),
  };

  // registerLifecycleDisqualificationsRoutes returns a Promise — must be awaited.
  // We return the app before registering and let the caller call app.ready().
  registerLifecycleDisqualificationsRoutes(app, {
    snapshotStore: mockSnapshotStore,
    transitionStore: mockTransitionStore,
    disqualificationHook: mockDisqualificationHook,
  });

  return app;
}

// ---------------------------------------------------------------------------
// GET /api/dashboard/lifecycle/disqualifications/pending
// ---------------------------------------------------------------------------

describe("GET /api/dashboard/lifecycle/disqualifications/pending", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = buildApp({
      listPendingDisqualifications: async () => [
        makeSnapshot(),
        // This one has currentState=disqualified — isPendingDisqualification returns false
        makeSnapshot({
          conversationThreadId: "thread-already-done",
          currentState: "disqualified",
        }),
      ],
      findLatestProposal: async () => baseProposal,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns pending items for the org", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/lifecycle/disqualifications/pending",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<Record<string, unknown>> };
    // thread-already-done is filtered out by isPendingDisqualification
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      conversationThreadId: "thread-1",
      contactId: "contact-1",
      currentState: "active",
      evidence: { reason: "price_sensitivity", score: 0.82 },
    });
  });

  it("excludes snapshots where currentState=disqualified (§8.1 doctrine predicate)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/lifecycle/disqualifications/pending",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ conversationThreadId: string }> };
    const ids = body.items.map((i) => i.conversationThreadId);
    expect(ids).not.toContain("thread-already-done");
  });

  it("returns empty items when capability is off (no snapshots)", async () => {
    const emptyApp = buildApp({ listPendingDisqualifications: async () => [] });
    await emptyApp.ready();
    const res = await emptyApp.inject({
      method: "GET",
      url: "/api/dashboard/lifecycle/disqualifications/pending",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: unknown[] };
    expect(body.items).toHaveLength(0);
    await emptyApp.close();
  });
});

// ---------------------------------------------------------------------------
// POST /api/dashboard/lifecycle/disqualifications/:threadId/confirm
// ---------------------------------------------------------------------------

describe("POST /api/dashboard/lifecycle/disqualifications/:threadId/confirm", () => {
  afterEach(async () => {
    await app?.close();
  });

  let app: FastifyInstance;

  it("200 confirmed — happy path", async () => {
    app = buildApp({
      confirm: async (): Promise<HookConfirmResult> => ({ result: "confirmed" }),
    });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/dashboard/lifecycle/disqualifications/thread-1/confirm",
      headers: { "x-org-id": "org-1", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ result: "confirmed" });
  });

  it("200 already_applied — idempotent re-confirm carries alreadyApplied flag", async () => {
    app = buildApp({
      confirm: async (): Promise<HookConfirmResult> => ({ result: "already_applied" }),
    });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/dashboard/lifecycle/disqualifications/thread-1/confirm",
      headers: { "x-org-id": "org-1", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ result: "confirmed", alreadyApplied: true });
  });

  it("409 already_disqualified — conflict without lineage", async () => {
    app = buildApp({
      confirm: async (): Promise<HookConfirmResult> => ({
        result: "conflict",
        reason: "already_disqualified",
      }),
    });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/dashboard/lifecycle/disqualifications/thread-1/confirm",
      headers: { "x-org-id": "org-1", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ reason: "already_disqualified" });
  });

  it("409 already_booked — contact booked before operator acted", async () => {
    app = buildApp({
      confirm: async (): Promise<HookConfirmResult> => ({
        result: "conflict",
        reason: "already_booked",
      }),
    });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/dashboard/lifecycle/disqualifications/thread-1/confirm",
      headers: { "x-org-id": "org-1", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ reason: "already_booked" });
  });

  it("404 not_found — thread does not exist", async () => {
    app = buildApp({
      confirm: async (): Promise<HookConfirmResult> => ({ result: "not_found" }),
    });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/dashboard/lifecycle/disqualifications/thread-missing/confirm",
      headers: { "x-org-id": "org-1", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ reason: "not_found" });
  });

  it("404 when capability is off (capability_disabled surfaces as not_found)", async () => {
    app = buildApp({
      confirm: async (): Promise<HookConfirmResult> => ({ result: "capability_disabled" }),
    });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/dashboard/lifecycle/disqualifications/thread-1/confirm",
      headers: { "x-org-id": "org-1", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ reason: "not_found" });
  });
});

// ---------------------------------------------------------------------------
// POST /api/dashboard/lifecycle/disqualifications/:threadId/dismiss
// ---------------------------------------------------------------------------

describe("POST /api/dashboard/lifecycle/disqualifications/:threadId/dismiss", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  it("200 dismissed with restoredStatus", async () => {
    app = buildApp({
      dismiss: async (): Promise<HookDismissResult> => ({
        result: "dismissed",
        restoredStatus: "qualified",
      }),
    });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/dashboard/lifecycle/disqualifications/thread-1/dismiss",
      headers: { "x-org-id": "org-1", "content-type": "application/json" },
      body: JSON.stringify({ operatorNote: "Actually interested" }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ result: "dismissed", restoredStatus: "qualified" });
  });

  it("409 not_proposed — thread is not in proposed_disqualified state", async () => {
    app = buildApp({
      dismiss: async (): Promise<HookDismissResult> => ({
        result: "conflict",
        reason: "not_proposed",
      }),
    });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/dashboard/lifecycle/disqualifications/thread-1/dismiss",
      headers: { "x-org-id": "org-1", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ reason: "not_proposed" });
  });
});
