import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { CAPIDispatcher, hashForCAPI, buildUserData } from "../capi-dispatcher.js";
import { InMemoryConversionBus } from "@switchboard/core";
import type { ConversionEvent } from "@switchboard/core";
import type { CrmContact } from "@switchboard/schemas";
import type { MetaAdsWriteProvider } from "../../cartridge/types.js";

function makeContact(overrides?: Partial<CrmContact>): CrmContact {
  return {
    id: "ct_1",
    externalId: "ext_1",
    channel: "telegram",
    email: "jane@example.com",
    firstName: "Jane",
    lastName: "Doe",
    company: null,
    phone: "+15551234567",
    tags: [],
    status: "active",
    assignedStaffId: null,
    sourceAdId: "ad_whitening",
    sourceCampaignId: "camp_spring",
    gclid: null,
    fbclid: null,
    ttclid: null,
    normalizedPhone: null,
    normalizedEmail: null,
    utmSource: "meta_ads",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    properties: {},
    ...overrides,
  };
}

function makeConversionEvent(overrides?: Partial<ConversionEvent>): ConversionEvent {
  return {
    type: "booked",
    contactId: "ct_1",
    organizationId: "org_1",
    value: 250,
    sourceAdId: "ad_whitening",
    sourceCampaignId: "camp_spring",
    timestamp: new Date("2026-03-08T14:00:00Z"),
    metadata: {},
    ...overrides,
  };
}

function createMockAdsProvider(): MetaAdsWriteProvider {
  return {
    createCampaign: vi.fn(),
    updateCampaign: vi.fn(),
    createAdSet: vi.fn(),
    createAd: vi.fn(),
    getCampaigns: vi.fn(),
    getAdSets: vi.fn(),
    connectAccount: vi.fn(),
    getLeadForms: vi.fn(),
    getLeadFormData: vi.fn(),
    sendConversionEvent: vi.fn().mockResolvedValue({ eventsReceived: 1, success: true }),
    getAccountInsights: vi.fn(),
    getCampaignInsights: vi.fn(),
    healthCheck: vi.fn(),
    createCustomAudience: vi.fn(),
    createLookalikeAudience: vi.fn(),
    createAdCreative: vi.fn(),
    createAdStudy: vi.fn(),
    createAdRule: vi.fn(),
  } as unknown as MetaAdsWriteProvider;
}

function createMockCrmProvider(contact: CrmContact | null = makeContact()) {
  return {
    getContact: vi.fn().mockResolvedValue(contact),
    searchContacts: vi.fn().mockResolvedValue([]),
    findByExternalId: vi.fn().mockResolvedValue(null),
    listDeals: vi.fn().mockResolvedValue([]),
    listActivities: vi.fn().mockResolvedValue([]),
    getPipelineStatus: vi.fn().mockResolvedValue([]),
    createContact: vi.fn(),
    updateContact: vi.fn(),
    archiveContact: vi.fn(),
    createDeal: vi.fn(),
    archiveDeal: vi.fn(),
    logActivity: vi.fn(),
    healthCheck: vi.fn(),
  };
}

describe("hashForCAPI", () => {
  it("returns SHA-256 hex of lowercased trimmed input", () => {
    const expected = createHash("sha256").update("jane@example.com").digest("hex");
    expect(hashForCAPI("Jane@Example.com")).toBe(expected);
    expect(hashForCAPI("  jane@example.com  ")).toBe(expected);
  });
});

describe("buildUserData", () => {
  it("hashes email, phone, first/last name and includes externalId", () => {
    const contact = makeContact();
    const userData = buildUserData(contact);

    expect(userData.em).toHaveLength(1);
    expect(userData.ph).toHaveLength(1);
    expect(userData.fn).toHaveLength(1);
    expect(userData.ln).toHaveLength(1);
    expect(userData.externalId).toEqual(["ext_1"]);

    // Verify hashing
    const expectedEmail = createHash("sha256").update("jane@example.com").digest("hex");
    expect(userData.em![0]).toBe(expectedEmail);
  });

  it("omits fields that are null", () => {
    const contact = makeContact({ email: null, phone: null, firstName: null, lastName: null });
    const userData = buildUserData(contact);

    expect(userData.em).toBeUndefined();
    expect(userData.ph).toBeUndefined();
    expect(userData.fn).toBeUndefined();
    expect(userData.ln).toBeUndefined();
  });

  it("strips non-numeric characters from phone (except +)", () => {
    const contact = makeContact({ phone: "+1 (555) 123-4567" });
    const userData = buildUserData(contact);

    const expectedPhone = createHash("sha256").update("+15551234567").digest("hex");
    expect(userData.ph![0]).toBe(expectedPhone);
  });
});

describe("CAPIDispatcher", () => {
  let adsProvider: ReturnType<typeof createMockAdsProvider>;
  let crmProvider: ReturnType<typeof createMockCrmProvider>;
  let dispatcher: CAPIDispatcher;

  beforeEach(() => {
    adsProvider = createMockAdsProvider();
    crmProvider = createMockCrmProvider();
    dispatcher = new CAPIDispatcher({
      adsProvider: adsProvider as unknown as MetaAdsWriteProvider,
      crmProvider,
      pixelId: "pixel_123",
    });
  });

  describe("handleEvent", () => {
    it("sends CAPI event for a conversion with Meta attribution", async () => {
      const result = await dispatcher.handleEvent(makeConversionEvent());

      expect(result.sent).toBe(true);
      expect(result.eventName).toBe("Schedule"); // "booked" maps to "Schedule"
      expect(adsProvider.sendConversionEvent).toHaveBeenCalledWith(
        "pixel_123",
        expect.objectContaining({
          eventName: "Schedule",
          actionSource: "system_generated",
          userData: expect.objectContaining({
            em: expect.any(Array),
          }),
          customData: expect.objectContaining({
            value: 250,
            currency: "USD",
          }),
        }),
      );
    });

    it("maps conversion types to correct Meta event names", async () => {
      const typeMap: Array<[ConversionEvent["type"], string]> = [
        ["inquiry", "Lead"],
        ["qualified", "Lead"],
        ["booked", "Schedule"],
        ["purchased", "Purchase"],
        ["completed", "Purchase"],
      ];

      for (const [type, expectedName] of typeMap) {
        vi.clearAllMocks();
        crmProvider.getContact.mockResolvedValue(makeContact());
        (adsProvider.sendConversionEvent as ReturnType<typeof vi.fn>).mockResolvedValue({
          eventsReceived: 1,
          success: true,
        });

        const result = await dispatcher.handleEvent(makeConversionEvent({ type }));
        expect(result.eventName).toBe(expectedName);
      }
    });

    it("skips events without Meta ad attribution", async () => {
      crmProvider.getContact.mockResolvedValue(makeContact({ sourceAdId: null }));

      const result = await dispatcher.handleEvent(makeConversionEvent({ sourceAdId: undefined }));

      expect(result.sent).toBe(false);
      expect(result.reason).toBe("No Meta ad attribution");
      expect(adsProvider.sendConversionEvent).not.toHaveBeenCalled();
    });

    it("uses contact sourceAdId as fallback when event has no sourceAdId", async () => {
      const result = await dispatcher.handleEvent(makeConversionEvent({ sourceAdId: undefined }));

      expect(result.sent).toBe(true);
    });

    it("returns error when CRM contact not found", async () => {
      crmProvider.getContact.mockResolvedValue(null);

      const result = await dispatcher.handleEvent(makeConversionEvent());

      expect(result.sent).toBe(false);
      expect(result.reason).toBe("Contact not found");
    });

    it("returns error when CRM lookup fails", async () => {
      crmProvider.getContact.mockRejectedValue(new Error("DB down"));

      const result = await dispatcher.handleEvent(makeConversionEvent());

      expect(result.sent).toBe(false);
      expect(result.reason).toBe("CRM lookup failed");
    });

    it("returns error when CAPI send fails", async () => {
      (adsProvider.sendConversionEvent as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("API error"),
      );

      const result = await dispatcher.handleEvent(makeConversionEvent());

      expect(result.sent).toBe(false);
      expect(result.reason).toContain("CAPI send failed");
    });

    it("returns error when CAPI rejects event", async () => {
      (adsProvider.sendConversionEvent as ReturnType<typeof vi.fn>).mockResolvedValue({
        eventsReceived: 0,
        success: false,
      });

      const result = await dispatcher.handleEvent(makeConversionEvent());

      expect(result.sent).toBe(false);
      expect(result.reason).toBe("CAPI rejected event");
    });

    it("includes campaignId in custom_data when present", async () => {
      await dispatcher.handleEvent(makeConversionEvent({ sourceCampaignId: "camp_99" }));

      const call = (adsProvider.sendConversionEvent as ReturnType<typeof vi.fn>).mock.calls[0]![1];
      expect(call.customData.campaign_id).toBe("camp_99");
    });

    it("uses custom currency when configured", async () => {
      const eurDispatcher = new CAPIDispatcher({
        adsProvider: adsProvider as unknown as MetaAdsWriteProvider,
        crmProvider,
        pixelId: "pixel_123",
        currency: "EUR",
      });

      await eurDispatcher.handleEvent(makeConversionEvent());

      const call = (adsProvider.sendConversionEvent as ReturnType<typeof vi.fn>).mock.calls[0]![1];
      expect(call.customData.currency).toBe("EUR");
    });
  });

  describe("register", () => {
    it("subscribes to conversion bus and processes events", async () => {
      const bus = new InMemoryConversionBus();
      dispatcher.register(bus);

      bus.emit(makeConversionEvent());

      // Wait for async handler to complete
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(adsProvider.sendConversionEvent).toHaveBeenCalledTimes(1);
    });
  });
});
