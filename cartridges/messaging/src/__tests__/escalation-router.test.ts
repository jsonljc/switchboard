import { describe, it, expect } from "vitest";
import { EscalationRouter } from "../escalation-router.js";
import type { EscalationMessage, OwnerReply } from "../escalation-router.js";

function makeEscalation(overrides: Partial<EscalationMessage> = {}): EscalationMessage {
  return {
    escalationId: "esc-1",
    organizationId: "org-1",
    contactId: "c1",
    agentId: "lead-responder",
    reason: "low_confidence",
    messageId: "msg-100",
    correlationId: "corr-1",
    createdAt: new Date().toISOString(),
    status: "open",
    ...overrides,
  };
}

describe("EscalationRouter", () => {
  it("matches by WhatsApp reply-to threading (context.message_id)", () => {
    const router = new EscalationRouter();
    router.addEscalation(makeEscalation({ messageId: "msg-100" }));

    const reply: OwnerReply = {
      message: "Tell them we have availability on Thursday",
      contextMessageId: "msg-100",
    };

    const match = router.matchReply("org-1", reply);
    expect(match).toBeDefined();
    expect(match!.escalationId).toBe("esc-1");
  });

  it("matches by [REF:xxx] pattern in message body", () => {
    const router = new EscalationRouter();
    router.addEscalation(makeEscalation({ escalationId: "esc-abc" }));

    const reply: OwnerReply = {
      message: "[REF:esc-abc] Yes, we can offer 20% off",
    };

    const match = router.matchReply("org-1", reply);
    expect(match).toBeDefined();
    expect(match!.escalationId).toBe("esc-abc");
  });

  it("falls back to single open escalation when no threading or ref", () => {
    const router = new EscalationRouter();
    router.addEscalation(makeEscalation({ escalationId: "esc-only" }));

    const reply: OwnerReply = {
      message: "Sounds good, go ahead",
    };

    const match = router.matchReply("org-1", reply);
    expect(match).toBeDefined();
    expect(match!.escalationId).toBe("esc-only");
  });

  it("returns null when multiple open escalations and no specific match", () => {
    const router = new EscalationRouter();
    router.addEscalation(
      makeEscalation({
        escalationId: "esc-old",
        createdAt: "2026-03-19T00:00:00.000Z",
      }),
    );
    router.addEscalation(
      makeEscalation({
        escalationId: "esc-new",
        createdAt: "2026-03-20T00:00:00.000Z",
      }),
    );

    const reply: OwnerReply = {
      message: "Sounds good, go ahead",
    };

    // With multiple open, should NOT silently pick most recent — should ambiguate
    const match = router.matchReply("org-1", reply);
    expect(match).toBeNull();
  });

  it("returns null with ambiguity list when multiple open escalations exist and no match", () => {
    const router = new EscalationRouter();
    router.addEscalation(makeEscalation({ escalationId: "esc-1", contactId: "c1" }));
    router.addEscalation(makeEscalation({ escalationId: "esc-2", contactId: "c2" }));
    router.addEscalation(makeEscalation({ escalationId: "esc-3", contactId: "c3" }));

    const reply: OwnerReply = {
      message: "Yes, go ahead",
    };

    const result = router.matchReplyOrAmbiguate("org-1", reply);
    expect(result.match).toBeNull();
    expect(result.ambiguous).toBe(true);
    expect(result.openEscalations).toHaveLength(3);
  });

  it("handles numbered list selection for ambiguity resolution", () => {
    const router = new EscalationRouter();
    router.addEscalation(makeEscalation({ escalationId: "esc-1", contactId: "c1" }));
    router.addEscalation(makeEscalation({ escalationId: "esc-2", contactId: "c2" }));
    router.addEscalation(makeEscalation({ escalationId: "esc-3", contactId: "c3" }));

    const reply: OwnerReply = {
      message: "2",
    };

    const match = router.matchReply("org-1", reply);
    expect(match).toBeDefined();
    expect(match!.escalationId).toBe("esc-2");
  });

  it("marks resolved escalations as closed", () => {
    const router = new EscalationRouter();
    router.addEscalation(makeEscalation({ escalationId: "esc-1" }));

    router.resolve("org-1", "esc-1");

    const reply: OwnerReply = {
      message: "hello",
    };

    const match = router.matchReply("org-1", reply);
    expect(match).toBeNull();
  });
});
