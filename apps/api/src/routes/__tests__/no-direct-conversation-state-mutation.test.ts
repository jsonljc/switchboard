// Regression-harness for the launch-blocker that motivated the
// ConversationStateStore boundary: any route that mutates conversationState
// MUST do so via app.conversationStateStore, never via app.prisma directly.
// This file asserts that contract by injecting a throwing spy at
// prisma.conversationState.update and confirming none of the operator-mutation
// routes ever reach it on a successful flow.

import { describe, it, expect, vi } from "vitest";
import type { AgentNotifier } from "@switchboard/core";
import { buildConversationTestApp } from "./build-conversation-test-app.js";

function makeForbiddenUpdateSpy() {
  return vi.fn().mockImplementation(() => {
    throw new Error(
      "Routes must not mutate conversationState directly — use app.conversationStateStore",
    );
  });
}

function makeWorkTraceStore() {
  return {
    persist: vi.fn(),
    getByWorkUnitId: vi.fn().mockResolvedValue({
      trace: { workUnitId: "wt_1", parameters: { message: { text: "x" } } },
      integrity: { status: "ok" as const },
    }),
    update: vi.fn().mockResolvedValue({ ok: true, trace: { workUnitId: "wt_1" } }),
    getByIdempotencyKey: vi.fn(),
  };
}

const handoff = {
  id: "esc-1",
  sessionId: "sess-1",
  organizationId: "org_1",
  leadId: "lead-1",
  status: "pending",
  reason: "human_requested",
  conversationSummary: {},
  leadSnapshot: {},
  qualificationSnapshot: {},
  slaDeadlineAt: new Date("2026-05-01"),
  acknowledgedAt: null,
  resolutionNote: null,
  resolvedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("Routes never mutate prisma.conversationState directly", () => {
  it("PATCH /override does not call prisma.conversationState.update on success", async () => {
    const updateSpy = makeForbiddenUpdateSpy();
    const setOverride = vi.fn().mockResolvedValue({
      conversationId: "c1",
      threadId: "t1",
      status: "human_override",
      workTraceId: "wt_1",
    });

    const app = await buildConversationTestApp({
      conversationStateStore: {
        setOverride,
        sendOperatorMessage: vi.fn(),
        releaseEscalationToAi: vi.fn(),
      },
      workTraceStore: makeWorkTraceStore(),
      prisma: {
        conversationState: { update: updateSpy },
        handoff: { findUnique: vi.fn(), update: vi.fn() },
      },
      organizationId: "org_1",
    });

    const res = await app.inject({
      method: "PATCH",
      url: "/api/conversations/t1/override",
      payload: { override: true },
    });

    expect(res.statusCode).toBe(200);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(setOverride).toHaveBeenCalledTimes(1);
  });

  it("POST /send does not call prisma.conversationState.update on success", async () => {
    const updateSpy = makeForbiddenUpdateSpy();
    const sendOperatorMessage = vi.fn().mockResolvedValue({
      conversationId: "c1",
      threadId: "t1",
      channel: "telegram",
      destinationPrincipalId: "p1",
      workTraceId: "wt_1",
      appendedMessage: { role: "owner", text: "hi", timestamp: "now" },
    });
    const sendProactive = vi.fn().mockResolvedValue(undefined);

    const app = await buildConversationTestApp({
      conversationStateStore: {
        setOverride: vi.fn(),
        sendOperatorMessage,
        releaseEscalationToAi: vi.fn(),
      },
      workTraceStore: makeWorkTraceStore(),
      agentNotifier: { sendProactive } as unknown as AgentNotifier,
      prisma: {
        conversationState: { update: updateSpy },
        handoff: { findUnique: vi.fn(), update: vi.fn() },
      },
      organizationId: "org_1",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/conversations/t1/send",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(200);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(sendOperatorMessage).toHaveBeenCalledTimes(1);
  });

  it("POST /escalations/:id/reply does not call prisma.conversationState.update on success", async () => {
    const updateSpy = makeForbiddenUpdateSpy();
    const releaseEscalationToAi = vi.fn().mockResolvedValue({
      conversationId: "c1",
      threadId: "sess-1",
      channel: "whatsapp",
      destinationPrincipalId: "p1",
      workTraceId: "wt_1",
      appendedReply: { role: "owner", text: "hi", timestamp: "now" },
    });
    const sendProactive = vi.fn().mockResolvedValue(undefined);
    const handoffUpdate = vi.fn().mockResolvedValue({
      ...handoff,
      status: "released",
      acknowledgedAt: new Date(),
    });

    const app = await buildConversationTestApp({
      conversationStateStore: {
        setOverride: vi.fn(),
        sendOperatorMessage: vi.fn(),
        releaseEscalationToAi,
      },
      workTraceStore: makeWorkTraceStore(),
      agentNotifier: { sendProactive } as unknown as AgentNotifier,
      prisma: {
        conversationState: { update: updateSpy },
        handoff: {
          findUnique: vi.fn().mockResolvedValue(handoff),
          update: handoffUpdate,
        },
      },
      organizationId: "org_1",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/escalations/esc-1/reply",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(200);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(releaseEscalationToAi).toHaveBeenCalledTimes(1);
  });
});
