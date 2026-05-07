import { describe, it, expect, vi, beforeEach } from "vitest";
import { LeadIntakeHandler } from "./lead-intake-handler.js";
import type { LeadIntake } from "@switchboard/schemas";

const makeIntake = (overrides: Partial<LeadIntake> = {}): LeadIntake => ({
  source: "ctwa",
  organizationId: "o1",
  deploymentId: "d1",
  contact: { phone: "+6591234567", channel: "whatsapp" },
  attribution: {
    ctwa_clid: "abc",
    sourceCampaignId: "c1",
    capturedAt: "2026-04-26T00:00:00Z",
  },
  idempotencyKey: "+6591234567:abc",
  ...overrides,
});

describe("LeadIntakeHandler", () => {
  let store: {
    upsertContact: ReturnType<typeof vi.fn>;
    createActivity: ReturnType<typeof vi.fn>;
    findContactByIdempotency: ReturnType<typeof vi.fn>;
  };
  let handler: LeadIntakeHandler;

  beforeEach(() => {
    store = {
      upsertContact: vi.fn().mockResolvedValue({ id: "contact_1" }),
      createActivity: vi.fn().mockResolvedValue({ id: "act_1" }),
      findContactByIdempotency: vi.fn().mockResolvedValue(null),
    };
    handler = new LeadIntakeHandler({ store });
  });

  it("creates a Contact with sourceType + attribution", async () => {
    await handler.handle(makeIntake());
    expect(store.upsertContact).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "o1",
        sourceType: "ctwa",
        attribution: expect.objectContaining({ ctwa_clid: "abc" }),
      }),
    );
  });

  it("writes lead_received activity", async () => {
    await handler.handle(makeIntake());
    expect(store.createActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "lead_received",
        contactId: "contact_1",
        organizationId: "o1",
        deploymentId: "d1",
      }),
    );
  });

  it("is idempotent on repeated key", async () => {
    store.findContactByIdempotency.mockResolvedValueOnce({ id: "existing" });
    const result = await handler.handle(makeIntake());
    expect(store.upsertContact).not.toHaveBeenCalled();
    expect(store.createActivity).not.toHaveBeenCalled();
    expect(result.contactId).toBe("existing");
    expect(result.duplicate).toBe(true);
  });

  it("flags messagingOptIn for CTWA leads on whatsapp (click is consent)", async () => {
    await handler.handle(
      makeIntake({ source: "ctwa", contact: { phone: "+1", channel: "whatsapp" } }),
    );
    expect(store.upsertContact).toHaveBeenCalledWith(
      expect.objectContaining({
        messagingOptIn: true,
        messagingOptInSource: "ctwa",
      }),
    );
  });

  it("flags messagingOptIn for Instant Form leads on whatsapp (form has WA opt-in)", async () => {
    await handler.handle(
      makeIntake({ source: "instant_form", contact: { phone: "+1", channel: "whatsapp" } }),
    );
    expect(store.upsertContact).toHaveBeenCalledWith(
      expect.objectContaining({
        messagingOptIn: true,
        messagingOptInSource: "web_form",
      }),
    );
  });

  it("does not flag messagingOptIn when channel is not whatsapp", async () => {
    await handler.handle(
      makeIntake({ source: "ctwa", contact: { email: "a@b.co", channel: "email" } }),
    );
    const callArgs = store.upsertContact.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs.messagingOptIn).toBeUndefined();
    expect(callArgs.messagingOptInSource).toBeUndefined();
  });
});
