// ---------------------------------------------------------------------------
// F-19: escalation detail must show the lead/agent transcript.
//
// On the managed-channel (WhatsApp) path, Handoff.sessionId is the WorkUnit
// traceId of the turn that escalated (skill-mode sets sessionId = workUnit
// traceId), NOT a conversation/session key. The lead and agent turns live in
// ConversationMessage keyed by contactId. The one lineage from the traceId to
// that contactId is the escalating turn's WorkTrace (the gateway threads
// contactId onto every turn's trace), so the route resolves:
//   handoff.sessionId -> WorkTrace.traceId -> contactId -> ConversationMessage.
//
// Producer -> consumer seam: ConversationMessage rows surface as
// EscalationDetailResponse.conversationHistory turns the HandoffDetailSheet
// renders (role "user"=lead, "assistant"=agent; field "text").
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { buildConversationTestApp } from "./build-conversation-test-app.js";

interface Turn {
  role?: string;
  text?: string;
  timestamp?: string;
}

const baseHandoff = {
  id: "esc-1",
  // A WorkUnit traceId (a random cuid in production), NOT a session/phone id.
  sessionId: "trace_abc123",
  organizationId: "org_a",
  leadId: null as string | null,
  status: "pending",
  reason: "human_requested",
  conversationSummary: {},
  leadSnapshot: { channel: "whatsapp" },
  qualificationSnapshot: {},
  slaDeadlineAt: new Date("2026-05-01T00:00:00Z"),
  acknowledgedAt: null as Date | null,
  resolutionNote: null as string | null,
  resolvedAt: null as Date | null,
  createdAt: new Date("2026-04-29T10:00:00Z"),
  updatedAt: new Date("2026-04-29T10:00:00Z"),
};

async function getDetail(prisma: unknown) {
  const app = await buildConversationTestApp({
    prisma,
    organizationId: "org_a",
    principalId: "principal_a",
  });
  return app.inject({ method: "GET", url: "/api/escalations/esc-1" });
}

describe("GET /api/escalations/:id — conversation history source (F-19)", () => {
  it("renders lead and agent turns from ConversationMessage via the escalating turn's WorkTrace", async () => {
    const workTraceFindFirst = vi.fn().mockResolvedValue({ contactId: "contact-1" });
    // The route reads orderBy createdAt desc, so the store returns newest first.
    const conversationMessageFindMany = vi.fn().mockResolvedValue([
      {
        direction: "outbound",
        content: "Yes we do. Would you like to book a consult?",
        createdAt: new Date("2026-04-29T10:00:05Z"),
      },
      {
        direction: "inbound",
        content: "Hi, do you offer laser hair removal?",
        createdAt: new Date("2026-04-29T10:00:00Z"),
      },
    ]);

    const res = await getDetail({
      handoff: { findUnique: vi.fn().mockResolvedValue(baseHandoff) },
      workTrace: { findFirst: workTraceFindFirst },
      conversationMessage: { findMany: conversationMessageFindMany },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { conversationHistory: Turn[] };
    // Output is chronological (oldest first): lead then agent.
    expect(body.conversationHistory).toEqual([
      {
        role: "user",
        text: "Hi, do you offer laser hair removal?",
        timestamp: "2026-04-29T10:00:00.000Z",
      },
      {
        role: "assistant",
        text: "Yes we do. Would you like to book a consult?",
        timestamp: "2026-04-29T10:00:05.000Z",
      },
    ]);

    const msgArgs = conversationMessageFindMany.mock.calls[0]![0] as {
      where: Record<string, unknown>;
    };
    expect(msgArgs.where["contactId"]).toBe("contact-1");
    expect(msgArgs.where["orgId"]).toBe("org_a");
  });

  it("resolves the contact from a WorkTrace keyed by the handoff traceId and org, ignoring contactless traces", async () => {
    const workTraceFindFirst = vi.fn().mockResolvedValue({ contactId: "contact-1" });

    await getDetail({
      handoff: { findUnique: vi.fn().mockResolvedValue(baseHandoff) },
      workTrace: { findFirst: workTraceFindFirst },
      conversationMessage: { findMany: vi.fn().mockResolvedValue([]) },
    });

    expect(workTraceFindFirst).toHaveBeenCalledTimes(1);
    const args = workTraceFindFirst.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(args.where["traceId"]).toBe("trace_abc123");
    expect(args.where["organizationId"]).toBe("org_a");
    // Only a trace that actually carries a contact is useful.
    expect(args.where["contactId"]).toEqual({ not: null });
  });

  it("bounds the ConversationMessage read and returns it in chronological order", async () => {
    const conversationMessageFindMany = vi.fn().mockResolvedValue([
      { direction: "inbound", content: "newest", createdAt: new Date("2026-04-29T10:09:00Z") },
      { direction: "inbound", content: "older", createdAt: new Date("2026-04-29T10:00:00Z") },
    ]);

    const res = await getDetail({
      handoff: { findUnique: vi.fn().mockResolvedValue(baseHandoff) },
      workTrace: { findFirst: vi.fn().mockResolvedValue({ contactId: "contact-1" }) },
      conversationMessage: { findMany: conversationMessageFindMany },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { conversationHistory: Turn[] };
    // Newest-first input is reversed to chronological output.
    expect(body.conversationHistory.map((t) => t.text)).toEqual(["older", "newest"]);

    const args = conversationMessageFindMany.mock.calls[0]![0] as {
      orderBy: { createdAt: string };
      take: number;
    };
    expect(args.orderBy).toEqual({ createdAt: "desc" });
    expect(typeof args.take).toBe("number");
    expect(args.take).toBeGreaterThan(0);
  });

  it("returns an empty history when the escalating turn's WorkTrace has no contact", async () => {
    const conversationMessageFindMany = vi.fn();
    const res = await getDetail({
      handoff: { findUnique: vi.fn().mockResolvedValue(baseHandoff) },
      workTrace: { findFirst: vi.fn().mockResolvedValue(null) },
      conversationMessage: { findMany: conversationMessageFindMany },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { conversationHistory: Turn[] };
    expect(body.conversationHistory).toEqual([]);
    // With no resolvable contact there is nothing to fetch.
    expect(conversationMessageFindMany).not.toHaveBeenCalled();
  });

  it("returns an empty history when the contact has no messages", async () => {
    const res = await getDetail({
      handoff: { findUnique: vi.fn().mockResolvedValue(baseHandoff) },
      workTrace: { findFirst: vi.fn().mockResolvedValue({ contactId: "contact-1" }) },
      conversationMessage: { findMany: vi.fn().mockResolvedValue([]) },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { conversationHistory: Turn[] };
    expect(body.conversationHistory).toEqual([]);
  });
});
