import { describe, expect, it } from "vitest";
import { adaptHandoff } from "../handoff-adapter.js";
import type { HandoffPackage } from "../../../handoff/types.js";
import type { ConversationThread, Contact } from "@switchboard/schemas";

function makeHandoff(overrides: Partial<HandoffPackage> = {}): HandoffPackage {
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
  } as HandoffPackage;
}

const contact = { id: "c-maya", name: "Maya R." } as unknown as Contact;
const thread = {
  id: "t-maya",
  contactId: "c-maya",
  assignedAgent: "alex",
} as unknown as ConversationThread;

describe("adaptHandoff", () => {
  it("namespaces id as 'handoff:<sourceId>'", () => {
    const decision = adaptHandoff(makeHandoff(), contact, thread);
    expect(decision.id).toBe("handoff:h-1");
    expect(decision.sourceRef).toEqual({ kind: "handoff", sourceId: "h-1" });
  });

  it("uses contact.name in humanSummary", () => {
    const decision = adaptHandoff(makeHandoff(), contact, thread);
    expect(decision.humanSummary).toContain("Maya R.");
  });

  it("falls back to 'A lead' when contact is null", () => {
    const decision = adaptHandoff(makeHandoff(), null, thread);
    expect(decision.humanSummary).toContain("A lead");
  });

  it("resolves agentKey from thread.assignedAgent", () => {
    const rileyThread = { ...thread, assignedAgent: "riley" } as ConversationThread;
    const decision = adaptHandoff(makeHandoff(), contact, rileyThread);
    expect(decision.agentKey).toBe("riley");
  });

  it("defaults agentKey to alex when thread is null", () => {
    const decision = adaptHandoff(makeHandoff(), contact, null);
    expect(decision.agentKey).toBe("alex");
  });

  it("composes presentation labels", () => {
    const decision = adaptHandoff(makeHandoff(), contact, thread);
    expect(decision.presentation.primaryLabel).toBe("Take this one");
    expect(decision.presentation.secondaryLabel).toBe("Snooze");
    expect(decision.presentation.dismissLabel).toBe("Mark resolved");
  });

  it("populates meta.slaDeadlineAt + meta.contactName", () => {
    const handoff = makeHandoff();
    const decision = adaptHandoff(handoff, contact, thread);
    expect(decision.meta.slaDeadlineAt).toBe(handoff.slaDeadlineAt);
    expect(decision.meta.contactName).toBe("Maya R.");
  });

  it("composes 'asked to talk to a human' for human_requested reason", () => {
    const decision = adaptHandoff(makeHandoff({ reason: "human_requested" }), contact, thread);
    expect(decision.humanSummary).toContain("talk to a human");
  });

  it("composes 'going back and forth' for max_turns_exceeded reason", () => {
    const decision = adaptHandoff(makeHandoff({ reason: "max_turns_exceeded" }), contact, thread);
    expect(decision.humanSummary).toContain("back and forth");
  });

  it("threadHref is null when thread is null", () => {
    const decision = adaptHandoff(makeHandoff(), contact, null);
    expect(decision.threadHref).toBeNull();
  });
});
