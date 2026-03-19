import { describe, it, expect } from "vitest";
import { NurtureAgentHandler } from "../handler.js";
import { createEventEnvelope } from "../../../events.js";

function makeStageEvent(stage: string, payload: Record<string, unknown> = {}) {
  return createEventEnvelope({
    organizationId: "org-1",
    eventType: "stage.advanced",
    source: { type: "agent", id: "sales-closer" },
    payload: {
      contactId: "c1",
      stage,
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

describe("NurtureAgentHandler", () => {
  it("starts consultation-reminder cadence on booking_initiated", async () => {
    const handler = new NurtureAgentHandler();
    const event = makeStageEvent("booking_initiated");

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { nurture: {} },
      },
    );

    expect(response.actions).toHaveLength(1);
    expect(response.actions[0]!.actionType).toBe("customer-engagement.cadence.start");
    expect(response.actions[0]!.parameters.cadenceId).toBe("consultation-reminder");
    expect(response.actions[0]!.parameters.contactId).toBe("c1");
  });

  it("starts post-treatment-followup cadence on service_completed", async () => {
    const handler = new NurtureAgentHandler();
    const event = makeStageEvent("service_completed");

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { nurture: {} },
      },
    );

    expect(response.actions[0]!.parameters.cadenceId).toBe("post-treatment-followup");
  });

  it("starts no-show-rebook cadence on no_show", async () => {
    const handler = new NurtureAgentHandler();
    const event = makeStageEvent("no_show");

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { nurture: {} },
      },
    );

    expect(response.actions[0]!.parameters.cadenceId).toBe("no-show-rebook");
  });

  it("starts dormant-winback cadence on dormant", async () => {
    const handler = new NurtureAgentHandler();
    const event = makeStageEvent("dormant");

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { nurture: {} },
      },
    );

    expect(response.actions[0]!.parameters.cadenceId).toBe("dormant-winback");
  });

  it("escalates with no_nurture_config when profile has no nurture", async () => {
    const handler = new NurtureAgentHandler();
    const event = makeStageEvent("booking_initiated");

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: {},
      },
    );

    expect(response.events).toHaveLength(1);
    expect(response.events[0]!.eventType).toBe("conversation.escalated");
    expect(response.events[0]!.payload).toEqual(
      expect.objectContaining({
        contactId: "c1",
        reason: "no_nurture_config",
      }),
    );
    expect(response.actions).toHaveLength(0);
  });

  it("escalates with unknown_nurture_stage for unmapped stages", async () => {
    const handler = new NurtureAgentHandler();
    const event = makeStageEvent("some_unknown_stage");

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { nurture: {} },
      },
    );

    expect(response.events[0]!.eventType).toBe("conversation.escalated");
    expect(response.events[0]!.payload).toEqual(
      expect.objectContaining({
        reason: "unknown_nurture_stage",
      }),
    );
  });

  it("escalates with cadence_not_enabled when cadence not in enabledCadences", async () => {
    const handler = new NurtureAgentHandler();
    const event = makeStageEvent("booking_initiated");

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: {
          nurture: {
            enabledCadences: ["post-treatment-followup", "no-show-rebook"],
          },
        },
      },
    );

    expect(response.events[0]!.eventType).toBe("conversation.escalated");
    expect(response.events[0]!.payload).toEqual(
      expect.objectContaining({
        reason: "cadence_not_enabled",
      }),
    );
  });

  it("allows cadence when it is in enabledCadences", async () => {
    const handler = new NurtureAgentHandler();
    const event = makeStageEvent("booking_initiated");

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: {
          nurture: {
            enabledCadences: ["consultation-reminder"],
          },
        },
      },
    );

    expect(response.events).toHaveLength(0);
    expect(response.actions).toHaveLength(1);
    expect(response.actions[0]!.parameters.cadenceId).toBe("consultation-reminder");
  });

  it("allows all cadences when enabledCadences not set", async () => {
    const handler = new NurtureAgentHandler();
    const event = makeStageEvent("dormant");

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { nurture: {} },
      },
    );

    expect(response.actions).toHaveLength(1);
    expect(response.actions[0]!.parameters.cadenceId).toBe("dormant-winback");
  });

  it("forwards attribution chain to escalation events", async () => {
    const handler = new NurtureAgentHandler();
    const event = makeStageEvent("booking_initiated");

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: {},
      },
    );

    expect(response.events[0]!.attribution).toBeDefined();
    expect(response.events[0]!.attribution!.fbclid).toBe("fb-abc");
    expect(response.events[0]!.attribution!.sourceCampaignId).toBe("camp-1");
  });

  it("sets causationId to the inbound event id", async () => {
    const handler = new NurtureAgentHandler();
    const event = makeStageEvent("booking_initiated");

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: {},
      },
    );

    expect(response.events[0]!.causationId).toBe(event.eventId);
    expect(response.events[0]!.correlationId).toBe(event.correlationId);
  });

  it("ignores non-stage.advanced events", async () => {
    const handler = new NurtureAgentHandler();

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "system", id: "test" },
      payload: {},
    });

    const response = await handler.handle(event, {}, { organizationId: "org-1" });
    expect(response.events).toHaveLength(0);
    expect(response.actions).toHaveLength(0);
  });
});
