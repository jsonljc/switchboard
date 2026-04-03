import { describe, it, expect } from "vitest";
import { createEventEnvelope, AGENT_EVENT_TYPES } from "../events.js";
import type { AttributionChain } from "@switchboard/schemas";

describe("createEventEnvelope", () => {
  it("creates an envelope with generated eventId and idempotencyKey", () => {
    const envelope = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "webhook", id: "telegram-adapter" },
      payload: { contactId: "c1", message: "Hi" },
    });

    expect(envelope.eventId).toBeTruthy();
    expect(envelope.idempotencyKey).toBeTruthy();
    expect(envelope.correlationId).toBeTruthy();
    expect(envelope.organizationId).toBe("org-1");
    expect(envelope.eventType).toBe("lead.received");
    expect(envelope.source.type).toBe("webhook");
    expect(envelope.occurredAt).toBeTruthy();
  });

  it("preserves explicit correlationId and causationId", () => {
    const envelope = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.qualified",
      source: { type: "agent", id: "employee-a" },
      correlationId: "corr-abc",
      causationId: "event-xyz",
      payload: { contactId: "c1", score: 85 },
    });

    expect(envelope.correlationId).toBe("corr-abc");
    expect(envelope.causationId).toBe("event-xyz");
  });

  it("attaches attribution chain when provided", () => {
    const attribution: AttributionChain = {
      fbclid: "fb-123",
      gclid: null,
      ttclid: null,
      sourceCampaignId: "camp-1",
      sourceAdId: "ad-1",
      utmSource: "meta",
      utmMedium: "paid",
      utmCampaign: "spring-promo",
    };

    const envelope = createEventEnvelope({
      organizationId: "org-1",
      eventType: "revenue.recorded",
      source: { type: "system", id: "deal-stage-handler" },
      attribution,
      payload: { amount: 350 },
    });

    expect(envelope.attribution).toEqual(attribution);
  });

  it("generates unique eventIds for each call", () => {
    const e1 = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "webhook", id: "wa" },
      payload: {},
    });
    const e2 = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "webhook", id: "wa" },
      payload: {},
    });

    expect(e1.eventId).not.toBe(e2.eventId);
  });
});

describe("AGENT_EVENT_TYPES", () => {
  it("contains all canonical event types", () => {
    expect(AGENT_EVENT_TYPES).toContain("lead.received");
    expect(AGENT_EVENT_TYPES).toContain("lead.qualified");
    expect(AGENT_EVENT_TYPES).toContain("lead.disqualified");
    expect(AGENT_EVENT_TYPES).toContain("stage.advanced");
    expect(AGENT_EVENT_TYPES).toContain("stage.reverted");
    expect(AGENT_EVENT_TYPES).toContain("revenue.recorded");
    expect(AGENT_EVENT_TYPES).toContain("revenue.attributed");
    expect(AGENT_EVENT_TYPES).toContain("ad.optimized");
    expect(AGENT_EVENT_TYPES).toContain("conversation.escalated");
    expect(AGENT_EVENT_TYPES).toContain("message.received");
    expect(AGENT_EVENT_TYPES).toContain("message.sent");
    expect(AGENT_EVENT_TYPES).toContain("escalation.owner_replied");
  });
});
