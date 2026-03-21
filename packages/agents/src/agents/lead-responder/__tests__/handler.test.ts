import { describe, it, expect, vi } from "vitest";
import { LeadResponderHandler } from "../handler.js";
import { createEventEnvelope } from "../../../events.js";
import { PayloadValidationError } from "../../../validate-payload.js";
import type { LeadResponderDeps } from "../types.js";

function makeDeps(overrides: Partial<LeadResponderDeps> = {}): LeadResponderDeps {
  return {
    scoreLead: vi.fn().mockReturnValue({
      score: 75,
      tier: "hot" as const,
      factors: [{ factor: "engagement", contribution: 15 }],
    }),
    ...overrides,
  };
}

function makeLeadEvent(payload: Record<string, unknown> = {}) {
  return createEventEnvelope({
    organizationId: "org-1",
    eventType: "lead.received",
    source: { type: "webhook", id: "telegram" },
    payload: {
      contactId: "c1",
      email: "john@example.com",
      firstName: "John",
      source: "paid",
      engagementScore: 8,
      ...payload,
    },
    attribution: {
      fbclid: "fb-abc",
      gclid: null,
      ttclid: null,
      sourceCampaignId: "camp-1",
      sourceAdId: "ad-1",
      utmSource: "meta",
      utmMedium: "paid",
      utmCampaign: "spring",
    },
  });
}

describe("LeadResponderHandler", () => {
  it("emits lead.qualified when score meets threshold", async () => {
    const deps = makeDeps();
    const handler = new LeadResponderHandler(deps);

    const event = makeLeadEvent();
    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(response.events).toHaveLength(1);
    expect(response.events[0]!.eventType).toBe("lead.qualified");
    expect(response.events[0]!.organizationId).toBe("org-1");
    expect(response.events[0]!.payload).toEqual(
      expect.objectContaining({
        contactId: "c1",
        score: 75,
        tier: "hot",
      }),
    );
  });

  it("forwards attribution chain to outbound events", async () => {
    const deps = makeDeps();
    const handler = new LeadResponderHandler(deps);

    const event = makeLeadEvent();
    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(response.events[0]!.attribution).toBeDefined();
    expect(response.events[0]!.attribution!.sourceCampaignId).toBe("camp-1");
    expect(response.events[0]!.attribution!.fbclid).toBe("fb-abc");
  });

  it("emits lead.disqualified when score below threshold", async () => {
    const deps = makeDeps({
      scoreLead: vi.fn().mockReturnValue({
        score: 20,
        tier: "cold" as const,
        factors: [],
      }),
    });
    const handler = new LeadResponderHandler(deps);

    const event = makeLeadEvent();
    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(response.events).toHaveLength(1);
    expect(response.events[0]!.eventType).toBe("lead.disqualified");
    expect(response.events[0]!.payload).toEqual(
      expect.objectContaining({
        contactId: "c1",
        score: 20,
        tier: "cold",
        reason: "below_threshold",
      }),
    );
  });

  it("uses custom qualification threshold from config", async () => {
    const deps = makeDeps({
      scoreLead: vi.fn().mockReturnValue({
        score: 55,
        tier: "warm" as const,
        factors: [],
      }),
    });
    const handler = new LeadResponderHandler(deps);

    // Default threshold is 40, so score 55 qualifies
    const r1 = await handler.handle(makeLeadEvent(), {}, { organizationId: "org-1" });
    expect(r1.events[0]!.eventType).toBe("lead.qualified");

    // Raise threshold to 60, so score 55 disqualifies
    const r2 = await handler.handle(
      makeLeadEvent(),
      { qualificationThreshold: 60 },
      { organizationId: "org-1" },
    );
    expect(r2.events[0]!.eventType).toBe("lead.disqualified");
  });

  it("does not emit action requests for read-only scoring", async () => {
    const deps = makeDeps();
    const handler = new LeadResponderHandler(deps);

    const event = makeLeadEvent();
    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    // Scoring is a read — no action requests for it
    const qualifyActions = response.actions.filter(
      (a) => a.actionType === "customer-engagement.lead.qualify",
    );
    expect(qualifyActions).toHaveLength(0);
  });

  it("passes event payload to scoreLead", async () => {
    const scoreFn = vi.fn().mockReturnValue({ score: 50, tier: "warm", factors: [] });
    const handler = new LeadResponderHandler({ scoreLead: scoreFn });

    const event = makeLeadEvent({ serviceValue: 200, urgencyLevel: 8 });
    await handler.handle(event, {}, { organizationId: "org-1" });

    expect(scoreFn).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceValue: 200,
        urgencyLevel: 8,
      }),
    );
  });

  it("sets causationId to the inbound event id", async () => {
    const deps = makeDeps();
    const handler = new LeadResponderHandler(deps);

    const event = makeLeadEvent();
    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(response.events[0]!.causationId).toBe(event.eventId);
    expect(response.events[0]!.correlationId).toBe(event.correlationId);
  });

  it("ignores non-lead.received events", async () => {
    const deps = makeDeps();
    const handler = new LeadResponderHandler(deps);

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "revenue.recorded",
      source: { type: "system", id: "test" },
      payload: {},
    });

    const response = await handler.handle(event, {}, { organizationId: "org-1" });
    expect(response.events).toHaveLength(0);
    expect(response.actions).toHaveLength(0);
  });

  it("handles message.received by scoring and qualifying", async () => {
    const handler = new LeadResponderHandler({
      scoreLead: () => ({ score: 80, tier: "hot" as const, factors: [] }),
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "message.received",
      source: { type: "webhook", id: "whatsapp" },
      payload: { contactId: "c1", messageText: "I want a consultation" },
    });

    const result = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(result.events.length).toBeGreaterThanOrEqual(1);
    expect(result.events[0]!.eventType).toBe("lead.qualified");
  });

  it("adds objection handling action when objectionText present", async () => {
    const deps = makeDeps({
      matchObjection: vi.fn().mockReturnValue({
        matched: true,
        category: "price",
        response: "We offer flexible payment plans",
        followUp: "Would you like to see our pricing?",
      }),
    });
    const handler = new LeadResponderHandler(deps);

    const event = makeLeadEvent({ objectionText: "too expensive" });
    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(response.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "customer-engagement.conversation.handle_objection",
          parameters: expect.objectContaining({
            contactId: "c1",
            objectionText: "too expensive",
          }),
        }),
      ]),
    );
    // No escalation when objection matched
    expect(response.events.find((e) => e.eventType === "conversation.escalated")).toBeUndefined();
  });

  it("emits conversation.escalated when objection not matched", async () => {
    const deps = makeDeps({
      matchObjection: vi.fn().mockReturnValue({ matched: false }),
    });
    const handler = new LeadResponderHandler(deps);

    const event = makeLeadEvent({ objectionText: "I have an alien condition" });
    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    const escalation = response.events.find((e) => e.eventType === "conversation.escalated");
    expect(escalation).toBeDefined();
    expect(escalation!.payload).toEqual(
      expect.objectContaining({
        contactId: "c1",
        reason: "unmatched_objection",
      }),
    );
  });

  it("emits conversation.escalated when max turns exceeded", async () => {
    const deps = makeDeps();
    const handler = new LeadResponderHandler(deps);

    const history = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `message ${i}`,
    }));

    const event = makeLeadEvent();
    const response = await handler.handle(
      event,
      { maxTurnsBeforeEscalation: 10 },
      { organizationId: "org-1", conversationHistory: history },
    );

    const escalation = response.events.find((e) => e.eventType === "conversation.escalated");
    expect(escalation).toBeDefined();
    expect(escalation!.payload).toEqual(
      expect.objectContaining({
        reason: "max_turns_exceeded",
        turnCount: 12,
      }),
    );
  });

  it("does not escalate when under max turns and no objection", async () => {
    const deps = makeDeps();
    const handler = new LeadResponderHandler(deps);

    const history = [
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!" },
    ];

    const event = makeLeadEvent();
    const response = await handler.handle(
      event,
      {},
      { organizationId: "org-1", conversationHistory: history },
    );

    expect(response.events.find((e) => e.eventType === "conversation.escalated")).toBeUndefined();
  });

  it("prioritizes unmatched_objection reason when both escalation conditions are true", async () => {
    const deps = makeDeps({
      matchObjection: vi.fn().mockReturnValue({ matched: false }),
    });
    const handler = new LeadResponderHandler(deps);

    const history = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `message ${i}`,
    }));

    const event = makeLeadEvent({ objectionText: "unknown concern" });
    const response = await handler.handle(
      event,
      { maxTurnsBeforeEscalation: 10 },
      { organizationId: "org-1", conversationHistory: history },
    );

    const escalation = response.events.find((e) => e.eventType === "conversation.escalated");
    expect(escalation).toBeDefined();
    expect(escalation!.payload).toEqual(
      expect.objectContaining({
        reason: "unmatched_objection",
      }),
    );
  });

  it("qualifies when score exactly equals threshold", async () => {
    const deps = makeDeps({
      scoreLead: vi.fn().mockReturnValue({
        score: 40,
        tier: "warm" as const,
        factors: [],
      }),
    });
    const handler = new LeadResponderHandler(deps);

    const event = makeLeadEvent();
    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(response.events[0]!.eventType).toBe("lead.qualified");
  });

  it("preserves handler state with score info", async () => {
    const deps = makeDeps();
    const handler = new LeadResponderHandler(deps);

    const event = makeLeadEvent();
    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(response.state).toEqual({
      lastScore: 75,
      lastTier: "hot",
      qualified: true,
    });
  });

  describe("dependency error handling", () => {
    it("escalates when scoreLead throws", async () => {
      const deps = makeDeps({
        scoreLead: vi.fn().mockImplementation(() => {
          throw new Error("scoring service down");
        }),
      });
      const handler = new LeadResponderHandler(deps);

      const event = makeLeadEvent();
      const response = await handler.handle(event, {}, { organizationId: "org-1" });

      expect(response.events).toHaveLength(1);
      expect(response.events[0]!.eventType).toBe("conversation.escalated");
      expect(response.events[0]!.payload).toEqual(
        expect.objectContaining({
          contactId: "c1",
          reason: "scoring_error",
          error: "scoring service down",
        }),
      );
      expect(response.actions).toHaveLength(0);
    });

    it("skips objection handling when matchObjection throws", async () => {
      const deps = makeDeps({
        matchObjection: vi.fn().mockImplementation(() => {
          throw new Error("objection service down");
        }),
      });
      const handler = new LeadResponderHandler(deps);

      const event = makeLeadEvent({ objectionText: "too expensive" });
      const response = await handler.handle(event, {}, { organizationId: "org-1" });

      // Should still return the scoring result
      expect(response.events[0]!.eventType).toBe("lead.qualified");
      // No escalation from objection error — it's non-critical
      expect(response.events.find((e) => e.eventType === "conversation.escalated")).toBeUndefined();
    });

    it("skips FAQ matching when matchFAQ throws", async () => {
      const deps = makeDeps({
        matchFAQ: vi.fn().mockImplementation(() => {
          throw new Error("FAQ service down");
        }),
      });
      const handler = new LeadResponderHandler(deps);

      const event = makeLeadEvent({ messageText: "what are your hours?" });
      const response = await handler.handle(event, {}, { organizationId: "org-1" });

      // Should still return the scoring result
      expect(response.events[0]!.eventType).toBe("lead.qualified");
      expect(response.state).not.toHaveProperty("faqResponse");
    });
  });

  describe("payload validation", () => {
    it("throws PayloadValidationError when contactId is missing", async () => {
      const deps = makeDeps();
      const handler = new LeadResponderHandler(deps);

      const event = createEventEnvelope({
        organizationId: "org-1",
        eventType: "lead.received",
        source: { type: "webhook", id: "telegram" },
        payload: { email: "john@example.com" },
      });

      await expect(handler.handle(event, {}, { organizationId: "org-1" })).rejects.toThrow(
        PayloadValidationError,
      );
    });

    it("includes agent name in validation error", async () => {
      const deps = makeDeps();
      const handler = new LeadResponderHandler(deps);

      const event = createEventEnvelope({
        organizationId: "org-1",
        eventType: "lead.received",
        source: { type: "webhook", id: "telegram" },
        payload: {},
      });

      let caught: Error | undefined;
      try {
        await handler.handle(event, {}, { organizationId: "org-1" });
      } catch (err) {
        caught = err as Error;
      }

      expect(caught).toBeInstanceOf(PayloadValidationError);
      expect(caught!.message).toContain("lead-responder");
    });
  });

});
