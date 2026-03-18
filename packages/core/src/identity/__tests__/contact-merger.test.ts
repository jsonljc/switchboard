import { describe, it, expect, vi, beforeEach } from "vitest";
import { ContactMerger } from "../contact-merger.js";
import type { CrmContact } from "@switchboard/schemas";

function makeContact(overrides?: Partial<CrmContact>): CrmContact {
  return {
    id: "ct_1",
    externalId: "ext_1",
    channel: "whatsapp",
    email: null,
    firstName: null,
    lastName: null,
    company: null,
    phone: "+60123456789",
    tags: [],
    status: "active",
    assignedStaffId: null,
    sourceAdId: null,
    sourceCampaignId: null,
    gclid: null,
    fbclid: null,
    ttclid: null,
    normalizedPhone: "+60123456789",
    normalizedEmail: null,
    utmSource: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    properties: {},
    ...overrides,
  };
}

describe("ContactMerger", () => {
  let mockCrm: {
    searchContacts: ReturnType<typeof vi.fn>;
    findByNormalizedPhone: ReturnType<typeof vi.fn>;
    findByNormalizedEmail: ReturnType<typeof vi.fn>;
    createContact: ReturnType<typeof vi.fn>;
    updateContact: ReturnType<typeof vi.fn>;
    addAlias: ReturnType<typeof vi.fn>;
  };
  let merger: ContactMerger;

  beforeEach(() => {
    mockCrm = {
      searchContacts: vi.fn().mockResolvedValue([]),
      findByNormalizedPhone: vi.fn().mockResolvedValue(null),
      findByNormalizedEmail: vi.fn().mockResolvedValue(null),
      createContact: vi.fn().mockResolvedValue(makeContact()),
      updateContact: vi.fn().mockResolvedValue(makeContact()),
      addAlias: vi.fn().mockResolvedValue(undefined),
    };
    merger = new ContactMerger(mockCrm);
  });

  it("creates a new contact when no match exists", async () => {
    const result = await merger.resolveContact({
      phone: "+60 123-456-789",
      channel: "whatsapp",
      externalId: "wa_123",
    });

    expect(mockCrm.createContact).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "+60 123-456-789",
        normalizedPhone: "+60123456789",
      }),
    );
    expect(result.isNew).toBe(true);
  });

  it("merges into existing contact matched by phone", async () => {
    const existing = makeContact({ id: "ct_existing", sourceAdId: "ad_1" });
    mockCrm.findByNormalizedPhone.mockResolvedValue(existing);
    mockCrm.updateContact.mockResolvedValue(makeContact({ id: "ct_existing" }));

    const result = await merger.resolveContact({
      phone: "+60 123-456-789",
      channel: "instagram",
      externalId: "ig_456",
      email: "jane@example.com",
    });

    expect(result.isNew).toBe(false);
    expect(result.contact.id).toBe("ct_existing");
    expect(mockCrm.addAlias).toHaveBeenCalledWith("ct_existing", "instagram", "ig_456");
    // Should enrich with email (fill null)
    expect(mockCrm.updateContact).toHaveBeenCalledWith(
      "ct_existing",
      expect.objectContaining({
        email: "jane@example.com",
        normalizedEmail: "jane@example.com",
      }),
    );
  });

  it("falls back to email match when phone doesn't match", async () => {
    const existing = makeContact({ id: "ct_email", email: "jane@example.com" });
    mockCrm.findByNormalizedEmail.mockResolvedValue(existing);

    const result = await merger.resolveContact({
      email: "  Jane@Example.COM  ",
      channel: "web",
      externalId: "form_789",
    });

    expect(result.isNew).toBe(false);
    expect(result.contact.id).toBe("ct_email");
  });

  it("preserves first-touch attribution on merge", async () => {
    const existing = makeContact({
      id: "ct_attributed",
      sourceAdId: "ad_original",
      sourceCampaignId: "camp_original",
    });
    mockCrm.findByNormalizedPhone.mockResolvedValue(existing);

    await merger.resolveContact({
      phone: "+60123456789",
      channel: "telegram",
      externalId: "tg_1",
      sourceAdId: "ad_newer",
    });

    // Should NOT overwrite existing attribution
    const updateCall = mockCrm.updateContact.mock.calls[0]?.[1] ?? {};
    expect(updateCall.sourceAdId).toBeUndefined();
  });

  it("copies attribution to unattributed contact on merge", async () => {
    const existing = makeContact({
      id: "ct_no_attr",
      sourceAdId: null,
      sourceCampaignId: null,
    });
    mockCrm.findByNormalizedPhone.mockResolvedValue(existing);

    await merger.resolveContact({
      phone: "+60123456789",
      channel: "web",
      externalId: "form_1",
      sourceAdId: "ad_from_form",
      sourceCampaignId: "camp_from_form",
    });

    expect(mockCrm.updateContact).toHaveBeenCalledWith(
      "ct_no_attr",
      expect.objectContaining({
        sourceAdId: "ad_from_form",
        sourceCampaignId: "camp_from_form",
      }),
    );
  });
});
