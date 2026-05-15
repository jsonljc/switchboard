// apps/api/src/__tests__/api-lifecycle-disqualifications.test.ts
// ---------------------------------------------------------------------------
// Tests for the Phase 3b lifecycle disqualification API routes:
//   GET  /api/dashboard/lifecycle/disqualifications/pending
//
// POST routes (confirm/dismiss) were migrated to PlatformIngress in Phase 1b.3.
// Their ingress-style tests live in:
//   apps/api/src/routes/__tests__/lifecycle-disqualifications-ingress.test.ts
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance, FastifyError } from "fastify";
import type {
  ConversationLifecycleSnapshot,
  ConversationLifecycleTransition,
} from "@switchboard/schemas";
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

  // registerLifecycleDisqualificationsRoutes returns a Promise — must be awaited.
  // We return the app before registering and let the caller call app.ready().
  registerLifecycleDisqualificationsRoutes(app, {
    snapshotStore: mockSnapshotStore,
    transitionStore: mockTransitionStore,
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
