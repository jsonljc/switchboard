import { describe, expect, it } from "vitest";
import { adaptHandoff } from "../handoff-adapter.js";
import type { Handoff } from "../../../handoff/types.js";
import type { ConversationThread, Contact } from "@switchboard/schemas";
import type { RouteTemplates } from "@switchboard/core";

const testRouteTemplates: RouteTemplates = {
  contactDetail: (id) => `/contacts/${id}`,
  contactConversations: (id) => `/contacts/${id}/conversations`,
  contactConversationDetail: (id, threadId) => `/contacts/${id}/conversations/${threadId}`,
};
const deps = { routeTemplates: testRouteTemplates };

function makeHandoff(overrides: Partial<Handoff> = {}): Handoff {
  return {
    id: "h-1",
    organizationId: "org-1",
    sessionId: "s-1",
    status: "pending" as const,
    reason: "human_requested",
    leadSnapshot: { leadId: "c-maya", channel: "whatsapp" },
    qualificationSnapshot: {
      signalsCaptured: {},
      qualificationStage: "new",
    },
    conversationSummary: {
      turnCount: 0,
      keyTopics: [],
      objectionHistory: [],
      sentiment: "neutral",
    },
    slaDeadlineAt: new Date(Date.now() + 4 * 3_600_000), // 4h out
    createdAt: new Date(),
    ...overrides,
  } as Handoff;
}

const contact = { id: "c-maya", name: "Maya R." } as unknown as Contact;
const thread = {
  id: "t-maya",
  contactId: "c-maya",
  assignedAgent: "alex",
} as unknown as ConversationThread;

describe("adaptHandoff", () => {
  it("namespaces id as 'handoff:<sourceId>'", () => {
    const decision = adaptHandoff(makeHandoff(), contact, thread, deps);
    expect(decision.id).toBe("handoff:h-1");
    expect(decision.sourceRef).toEqual({ kind: "handoff", sourceId: "h-1" });
  });

  it("uses contact.name in humanSummary", () => {
    const decision = adaptHandoff(makeHandoff(), contact, thread, deps);
    expect(decision.humanSummary).toContain("Maya R.");
  });

  it("falls back to 'A lead' when contact is null", () => {
    const decision = adaptHandoff(makeHandoff(), null, thread, deps);
    expect(decision.humanSummary).toContain("A lead");
  });

  it("resolves agentKey from thread.assignedAgent", () => {
    const rileyThread = { ...thread, assignedAgent: "riley" } as ConversationThread;
    const decision = adaptHandoff(makeHandoff(), contact, rileyThread, deps);
    expect(decision.agentKey).toBe("riley");
  });

  it("defaults agentKey to alex when thread is null", () => {
    const decision = adaptHandoff(makeHandoff(), contact, null, deps);
    expect(decision.agentKey).toBe("alex");
  });

  it("composes presentation labels", () => {
    const decision = adaptHandoff(makeHandoff(), contact, thread, deps);
    expect(decision.presentation.primaryLabel).toBe("Take this one");
    expect(decision.presentation.secondaryLabel).toBe("Snooze");
    expect(decision.presentation.dismissLabel).toBe("Mark resolved");
  });

  it("populates meta.slaDeadlineAt + meta.contactName", () => {
    const handoff = makeHandoff();
    const decision = adaptHandoff(handoff, contact, thread, deps);
    expect(decision.meta.slaDeadlineAt).toBe(handoff.slaDeadlineAt);
    expect(decision.meta.contactName).toBe("Maya R.");
  });

  it("composes 'asked to talk to a human' for human_requested reason", () => {
    const decision = adaptHandoff(
      makeHandoff({ reason: "human_requested" }),
      contact,
      thread,
      deps,
    );
    expect(decision.humanSummary).toContain("talk to a human");
  });

  it("composes 'going back and forth' for max_turns_exceeded reason", () => {
    const decision = adaptHandoff(
      makeHandoff({ reason: "max_turns_exceeded" }),
      contact,
      thread,
      deps,
    );
    expect(decision.humanSummary).toContain("back and forth");
  });

  it("threadHref is null when thread is null", () => {
    const decision = adaptHandoff(makeHandoff(), contact, null, deps);
    expect(decision.threadHref).toBeNull();
  });

  it("emits threadHref from routeTemplates when both contact and thread are present", () => {
    const decision = adaptHandoff(makeHandoff(), contact, thread, deps);
    expect(decision.threadHref).toBe("/contacts/c-maya/conversations/t-maya");
  });

  it("threadHref is null when thread is present but contact is null (no malformed /contacts// URL)", () => {
    // Pre-injection code produced `/contacts/undefined/conversations/<id>` here.
    // PR-2.5 deliberately tightens the guard: missing contact resolves to null
    // rather than formalising the broken /contacts// shape via the routeTemplates
    // call. This test locks the new behaviour.
    const decision = adaptHandoff(makeHandoff(), null, thread, deps);
    expect(decision.threadHref).toBeNull();
  });

  describe("meta.riskContract", () => {
    it("sets derived default riskContract for handoffs", () => {
      const decision = adaptHandoff(makeHandoff(), contact, thread, deps);
      expect(decision.meta.riskContract).toEqual({
        riskLevel: "medium",
        externalEffect: false,
        financialEffect: false,
        clientFacing: true,
        requiresConfirmation: false,
      });
    });

    it("handoff riskContract.clientFacing is true (handoffs are client-facing by nature)", () => {
      const decision = adaptHandoff(makeHandoff(), contact, thread, deps);
      expect(decision.meta.riskContract?.clientFacing).toBe(true);
    });

    it("handoff riskContract.financialEffect is false (conservative default)", () => {
      const decision = adaptHandoff(makeHandoff(), contact, thread, deps);
      expect(decision.meta.riskContract?.financialEffect).toBe(false);
    });
  });
});
