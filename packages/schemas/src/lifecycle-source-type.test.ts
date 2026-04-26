import { describe, it, expect } from "vitest";
import { ContactSchema, LeadSourceTypeSchema } from "./lifecycle.js";

describe("Contact.sourceType", () => {
  it("accepts ctwa, instant_form, organic", () => {
    expect(LeadSourceTypeSchema.parse("ctwa")).toBe("ctwa");
    expect(LeadSourceTypeSchema.parse("instant_form")).toBe("instant_form");
    expect(LeadSourceTypeSchema.parse("organic")).toBe("organic");
  });

  it("rejects unknown source", () => {
    expect(() => LeadSourceTypeSchema.parse("tiktok")).toThrow();
  });

  it("Contact accepts attribution.ctwa_clid and attribution.leadgen_id", () => {
    const now = new Date();
    const c = ContactSchema.parse({
      id: "c1",
      organizationId: "o1",
      primaryChannel: "whatsapp",
      stage: "new",
      sourceType: "ctwa",
      attribution: {
        fbclid: null,
        gclid: null,
        ttclid: null,
        sourceCampaignId: null,
        sourceAdId: null,
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        ctwa_clid: "abc123",
        leadgen_id: "lg-1",
        capturedAt: "2026-04-26T00:00:00Z",
      },
      roles: [],
      firstContactAt: now,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    });
    expect(c.sourceType).toBe("ctwa");
    expect(c.attribution?.ctwa_clid).toBe("abc123");
    expect(c.attribution?.leadgen_id).toBe("lg-1");
  });
});
