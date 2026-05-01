// ---------------------------------------------------------------------------
// Cross-tenant scoping for /api/escalations/* — TI-5/TI-6
//
// Even though the Handoff org guard already gates access by organizationId,
// the conversationState lookup for transcript history must independently
// scope by organizationId. If a stale ConversationState row's organizationId
// is null or differs from the Handoff's, Org A must NOT see its conversation
// transcript via Org A's auth.
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

describe("GET /api/escalations/:id — cross-tenant ConversationState scoping", () => {
  it("returns empty conversation history when the ConversationState row's organizationId is null", async () => {
    // Org A authenticates and asks for esc-1, which belongs to org_a. The
    // ConversationState row for sess-cross-tenant exists in the DB with
    // organizationId=null — a stale row (TI-9). The route must NOT return
    // its messages.
    const findFirst = vi.fn().mockResolvedValue(null); // null because (threadId, orgId=org_a) does not match a null-org row
    const app = await buildConversationTestApp({
      prisma: {
        handoff: {
          findUnique: vi.fn().mockResolvedValue(handoffOrgA),
        },
        conversationState: { findFirst },
      },
      organizationId: "org_a",
      principalId: "principal_a",
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/escalations/esc-1",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { conversationHistory: unknown[] };
    expect(body.conversationHistory).toEqual([]);
    // Most importantly: the lookup was scoped by both threadId AND organizationId.
    expect(findFirst).toHaveBeenCalledTimes(1);
    const args = findFirst.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(args.where["threadId"]).toBe("sess-cross-tenant");
    expect(args.where["organizationId"]).toBe("org_a");
  });

  it("returns empty conversation history when the ConversationState row belongs to a different org (orgB)", async () => {
    // Same shape: a divergent ConversationState row with organizationId=org_b
    // exists for the threadId. Org A's auth must not surface its messages.
    const findFirst = vi.fn().mockResolvedValue(null);
    const app = await buildConversationTestApp({
      prisma: {
        handoff: {
          findUnique: vi.fn().mockResolvedValue(handoffOrgA),
        },
        conversationState: { findFirst },
      },
      organizationId: "org_a",
      principalId: "principal_a",
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/escalations/esc-1",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { conversationHistory: unknown[] };
    expect(body.conversationHistory).toEqual([]);

    const args = findFirst.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(args.where["organizationId"]).toBe("org_a");
  });

  it("returns 404 when the Handoff itself belongs to a different org", async () => {
    // The Handoff guard short-circuits before any conversationState lookup.
    const findFirst = vi.fn();
    const app = await buildConversationTestApp({
      prisma: {
        handoff: {
          findUnique: vi.fn().mockResolvedValue({ ...handoffOrgA, organizationId: "org_b" }),
        },
        conversationState: { findFirst },
      },
      organizationId: "org_a",
      principalId: "principal_a",
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/escalations/esc-1",
    });

    expect(res.statusCode).toBe(404);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("returns the conversation history for the matching org (org_a)", async () => {
    // Sanity check: when both Handoff and ConversationState belong to org_a,
    // the route returns the messages.
    const messages = [
      { role: "user", text: "hi", timestamp: "2026-04-29T10:00:00Z" },
      { role: "assistant", text: "hello", timestamp: "2026-04-29T10:00:01Z" },
    ];
    const findFirst = vi.fn().mockResolvedValue({
      id: "conv_a",
      threadId: "sess-cross-tenant",
      organizationId: "org_a",
      messages,
    });
    const app = await buildConversationTestApp({
      prisma: {
        handoff: {
          findUnique: vi.fn().mockResolvedValue(handoffOrgA),
        },
        conversationState: { findFirst },
      },
      organizationId: "org_a",
      principalId: "principal_a",
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/escalations/esc-1",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { conversationHistory: unknown[] };
    expect(body.conversationHistory).toHaveLength(2);
  });
});
