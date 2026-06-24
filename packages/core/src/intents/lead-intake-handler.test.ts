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
    findByPhoneOrEmail: ReturnType<typeof vi.fn>;
  };
  let handler: LeadIntakeHandler;

  beforeEach(() => {
    store = {
      upsertContact: vi.fn().mockResolvedValue({ id: "contact_1" }),
      createActivity: vi.fn().mockResolvedValue({ id: "act_1" }),
      findContactByIdempotency: vi.fn().mockResolvedValue(null),
      // Default: no identity match -> create path (existing tests unchanged). Matcher cases set this per-test.
      findByPhoneOrEmail: vi.fn().mockResolvedValue([]),
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
    expect(result.outcome).toBe("idempotent_duplicate");
  });

  it("scopes the idempotency lookup by organizationId (cross-tenant safety)", async () => {
    // The Contact unique is (organizationId, idempotencyKey); the pre-check MUST
    // be org-scoped so org B's intake never dedupes against — or leaks the id of —
    // org A's contact when they happen to share an idempotency key.
    await handler.handle(makeIntake({ organizationId: "o1", idempotencyKey: "k1" }));
    expect(store.findContactByIdempotency).toHaveBeenCalledWith("o1", "k1");
  });

  it("does NOT set a durable messagingOptIn for CTWA leads (ad-click rides the 24h window, not a permanent opt-in)", async () => {
    // P1-5: a click-to-WhatsApp ad-click is NOT a durable opt-in. A genuine CTWA lead arrives as a
    // real WhatsApp inbound, so it rides the 24h lastWhatsAppInboundAt free-entry-point window; it
    // must NOT be stamped messagingOptIn=true (which would let us send proactively forever).
    await handler.handle(
      makeIntake({ source: "ctwa", contact: { phone: "+1", channel: "whatsapp" } }),
    );
    const callArgs = store.upsertContact.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs.messagingOptIn).toBeUndefined();
    expect(callArgs.messagingOptInSource).toBeUndefined();
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

  // --- A4 identity matcher ---

  it("reuses an existing contact on a corroborated match and does not create a new one", async () => {
    store.findByPhoneOrEmail.mockResolvedValueOnce([
      { id: "existing", name: "Jane Tan", phoneE164: "+6591234567", email: null },
    ]);
    const res = await handler.handle(
      makeIntake({ contact: { phone: "91234567", name: "jane tan", channel: "whatsapp" } }),
    );
    expect(res).toEqual({ contactId: "existing", duplicate: false, outcome: "reused" });
    expect(store.upsertContact).not.toHaveBeenCalled();
    expect(store.createActivity).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: "existing", kind: "lead_received" }),
    );
  });

  it("does not widen consent on reuse (performs no write to the matched contact)", async () => {
    // The matched contact may be opted-out/revoked; reuse must preserve it. Lead intake only carries an
    // opt-in/neutral signal, so the most-restrictive consolidation is to write nothing to it on reuse.
    store.findByPhoneOrEmail.mockResolvedValueOnce([
      { id: "existing", name: "Jane", phoneE164: "+6591234567", email: null },
    ]);
    await handler.handle(
      makeIntake({
        source: "ctwa",
        contact: { phone: "91234567", name: "Jane", channel: "whatsapp" },
      }),
    );
    expect(store.upsertContact).not.toHaveBeenCalled();
  });

  it("flags a same-phone-different-name lead and creates a separate contact (not merged)", async () => {
    store.findByPhoneOrEmail.mockResolvedValueOnce([
      { id: "other", name: "Bob", phoneE164: "+6591234567", email: null },
    ]);
    store.upsertContact.mockResolvedValueOnce({ id: "new" });
    const res = await handler.handle(
      makeIntake({ contact: { phone: "91234567", name: "Jane", channel: "whatsapp" } }),
    );
    expect(res.contactId).toBe("new");
    expect(store.upsertContact).toHaveBeenCalledWith(
      expect.objectContaining({ duplicateContactRisk: true }),
    );
  });

  it("creates a new contact with name threaded and flag false when nothing matches", async () => {
    store.upsertContact.mockResolvedValueOnce({ id: "new" });
    const res = await handler.handle(
      makeIntake({ contact: { phone: "91234567", name: "Jane Tan", channel: "whatsapp" } }),
    );
    expect(store.upsertContact).toHaveBeenCalledWith(
      expect.objectContaining({ duplicateContactRisk: false, name: "Jane Tan" }),
    );
    expect(res.outcome).toBe("created");
  });

  it("reuses on an email-only corroborated match and queries with a normalized email", async () => {
    store.findByPhoneOrEmail.mockResolvedValueOnce([
      { id: "existing", name: "Jane", phoneE164: null, email: "jane@x.com" },
    ]);
    const res = await handler.handle(
      makeIntake({
        source: "instant_form",
        contact: { email: "Jane@X.com", name: "Jane", channel: "whatsapp" },
      }),
    );
    expect(res.contactId).toBe("existing");
    expect(store.findByPhoneOrEmail).toHaveBeenCalledWith(
      expect.objectContaining({ email: "jane@x.com", phoneE164: null }),
    );
    expect(store.upsertContact).not.toHaveBeenCalled();
  });
});
