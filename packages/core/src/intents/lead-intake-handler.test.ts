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
});
