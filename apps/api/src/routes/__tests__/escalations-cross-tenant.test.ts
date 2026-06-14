// ---------------------------------------------------------------------------
// Cross-tenant scoping for /api/escalations/* (TI-5/TI-6)
//
// The Handoff org guard gates access by organizationId, but every lookup that
// assembles transcript history must independently scope by org. The GET /:id
// route reads two tables (the contact id from the escalating turn's WorkTrace,
// then the transcript from ConversationMessage), so a stale or divergent-org
// row in either must not surface via another tenant's auth.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { buildConversationTestApp } from "./build-conversation-test-app.js";

const handoffOrgA = {
  id: "esc-1",
  sessionId: "sess-cross-tenant",
  organizationId: "org_a",
  leadId: "lead-1",
  status: "pending",
  reason: "human_requested",
  conversationSummary: {},
  leadSnapshot: {},
  qualificationSnapshot: {},
  slaDeadlineAt: new Date("2026-05-01"),
  acknowledgedAt: null as Date | null,
  resolutionNote: null as string | null,
  resolvedAt: null as Date | null,
  createdAt: new Date("2026-04-29T10:00:00Z"),
  updatedAt: new Date("2026-04-29T10:00:00Z"),
};

describe("GET /api/escalations/:id — cross-tenant conversation-history scoping", () => {
  // The route resolves the contact from the escalating turn's WorkTrace (by
  // traceId == handoff.sessionId), then reads the transcript from
  // ConversationMessage. Both lookups must carry the caller org so a stale or
  // divergent-org WorkTrace or message cannot leak across tenants.
  function buildPrisma(overrides: Record<string, unknown> = {}) {
    return {
      handoff: { findUnique: vi.fn().mockResolvedValue(handoffOrgA) },
      workTrace: { findFirst: vi.fn().mockResolvedValue(null) },
      conversationMessage: { findMany: vi.fn().mockResolvedValue([]) },
      ...overrides,
    };
  }

  it("scopes the WorkTrace contact lookup by org and traceId: a non-matching trace yields nothing", async () => {
    // A WorkTrace with the same traceId may exist under a different org. Scoped
    // by (traceId, org_a) it does not match, so no contact (and no turns) leak.
    const findFirst = vi.fn().mockResolvedValue(null);
    const app = await buildConversationTestApp({
      prisma: buildPrisma({ workTrace: { findFirst } }),
      organizationId: "org_a",
      principalId: "principal_a",
    });

    const res = await app.inject({ method: "GET", url: "/api/escalations/esc-1" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { conversationHistory: unknown[] };
    expect(body.conversationHistory).toEqual([]);
    expect(findFirst).toHaveBeenCalledTimes(1);
    const args = findFirst.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(args.where["traceId"]).toBe("sess-cross-tenant");
    expect(args.where["organizationId"]).toBe("org_a");
  });

  it("scopes the ConversationMessage lookup by org and by the resolved contact", async () => {
    const messageFindMany = vi
      .fn()
      .mockResolvedValue([
        { direction: "inbound", content: "hi", createdAt: new Date("2026-04-29T10:00:00Z") },
      ]);
    const app = await buildConversationTestApp({
      prisma: buildPrisma({
        workTrace: { findFirst: vi.fn().mockResolvedValue({ contactId: "contact_a" }) },
        conversationMessage: { findMany: messageFindMany },
      }),
      organizationId: "org_a",
      principalId: "principal_a",
    });

    const res = await app.inject({ method: "GET", url: "/api/escalations/esc-1" });

    expect(res.statusCode).toBe(200);
    const msgArgs = messageFindMany.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(msgArgs.where["orgId"]).toBe("org_a");
    expect(msgArgs.where["contactId"]).toBe("contact_a");
  });

  it("returns 404 when the Handoff belongs to a different org and reads no conversation table", async () => {
    // The Handoff guard short-circuits before any conversation lookup.
    const workTrace = { findFirst: vi.fn() };
    const conversationMessage = { findMany: vi.fn() };
    const app = await buildConversationTestApp({
      prisma: {
        handoff: {
          findUnique: vi.fn().mockResolvedValue({ ...handoffOrgA, organizationId: "org_b" }),
        },
        workTrace,
        conversationMessage,
      },
      organizationId: "org_a",
      principalId: "principal_a",
    });

    const res = await app.inject({ method: "GET", url: "/api/escalations/esc-1" });

    expect(res.statusCode).toBe(404);
    expect(workTrace.findFirst).not.toHaveBeenCalled();
    expect(conversationMessage.findMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/escalations/:id/resolve cross-tenant scoping", () => {
  it("returns 404 cross-tenant and never mutates", async () => {
    const updateMany = vi.fn();
    const app = await buildConversationTestApp({
      prisma: {
        handoff: {
          findUnique: vi.fn().mockResolvedValue({ ...handoffOrgA, organizationId: "org_b" }),
          updateMany,
          findFirst: vi.fn(),
        },
      },
      organizationId: "org_a",
      principalId: "principal_a",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/escalations/esc-1/resolve",
      payload: {},
    });

    expect(res.statusCode).toBe(404);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("scopes the status mutation to the caller org (org in the updateMany where-clause)", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const resolvedRow = {
      ...handoffOrgA,
      status: "resolved",
      resolutionNote: "done",
      resolvedAt: new Date("2026-05-02T00:00:00Z"),
    };
    const app = await buildConversationTestApp({
      prisma: {
        handoff: {
          findUnique: vi.fn().mockResolvedValue(handoffOrgA),
          updateMany,
          findFirst: vi.fn().mockResolvedValue(resolvedRow),
        },
      },
      organizationId: "org_a",
      principalId: "principal_a",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/escalations/esc-1/resolve",
      payload: { resolutionNote: "done" },
    });

    expect(res.statusCode).toBe(200);
    expect(updateMany).toHaveBeenCalledTimes(1);
    const args = updateMany.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(args.where["id"]).toBe("esc-1");
    expect(args.where["organizationId"]).toBe("org_a");
  });

  it("returns 404 when the org-scoped updateMany matches no row (fail-closed on count===0)", async () => {
    const app = await buildConversationTestApp({
      prisma: {
        handoff: {
          // The Handoff guard passes (same org), but the scoped write matches no
          // row, so the count===0 guard must 404 rather than report a fake success.
          findUnique: vi.fn().mockResolvedValue(handoffOrgA),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          findFirst: vi.fn(),
        },
      },
      organizationId: "org_a",
      principalId: "principal_a",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/escalations/esc-1/resolve",
      payload: {},
    });

    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/escalations/:id/reply cross-tenant scoping", () => {
  it("returns 404 cross-tenant and never mutates or releases", async () => {
    const updateMany = vi.fn();
    const releaseEscalationToAi = vi.fn();
    const app = await buildConversationTestApp({
      conversationStateStore: {
        setOverride: vi.fn(),
        sendOperatorMessage: vi.fn(),
        releaseEscalationToAi,
      },
      prisma: {
        handoff: {
          findUnique: vi.fn().mockResolvedValue({ ...handoffOrgA, organizationId: "org_b" }),
          updateMany,
          findFirst: vi.fn(),
        },
      },
      organizationId: "org_a",
      principalId: "principal_a",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/escalations/esc-1/reply",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(404);
    expect(updateMany).not.toHaveBeenCalled();
    expect(releaseEscalationToAi).not.toHaveBeenCalled();
  });

  it("scopes the release mutation to the caller org and 404s (fail-closed) when it matches no row", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const releaseEscalationToAi = vi.fn();
    const app = await buildConversationTestApp({
      conversationStateStore: {
        setOverride: vi.fn(),
        sendOperatorMessage: vi.fn(),
        releaseEscalationToAi,
      },
      prisma: {
        handoff: {
          findUnique: vi.fn().mockResolvedValue(handoffOrgA),
          updateMany,
          findFirst: vi.fn(),
        },
      },
      organizationId: "org_a",
      principalId: "principal_a",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/escalations/esc-1/reply",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(404);
    expect(updateMany).toHaveBeenCalledTimes(1);
    const args = updateMany.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(args.where["id"]).toBe("esc-1");
    expect(args.where["organizationId"]).toBe("org_a");
    // Mutation failed closed before any downstream release/delivery work.
    expect(releaseEscalationToAi).not.toHaveBeenCalled();
  });
});
