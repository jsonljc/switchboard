import { describe, it, expect } from "vitest";
import { buildBookedConversionPayload } from "./booked-conversion-payload.js";

describe("buildBookedConversionPayload", () => {
  it("maps a Meta-attributed contact (leadgen_id → lead_id)", () => {
    const result = buildBookedConversionPayload({
      email: "jane@example.com",
      phone: "+6591234567",
      attribution: {
        fbclid: "fb_abc",
        gclid: null,
        ttclid: null,
        sourceCampaignId: "camp_1",
        sourceAdId: "ad_1",
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        leadgen_id: "lead_9",
      },
    });
    expect(result).toEqual({
      sourceCampaignId: "camp_1",
      sourceAdId: "ad_1",
      customer: { email: "jane@example.com", phone: "+6591234567" },
      attribution: { fbclid: "fb_abc", lead_id: "lead_9" },
    });
  });

  it("organic contact (no attribution) still carries email/phone; attribution fields go null", () => {
    const result = buildBookedConversionPayload({
      email: "walkin@example.com",
      phone: "+6580000000",
      attribution: null,
    });
    expect(result).toEqual({
      sourceCampaignId: null,
      sourceAdId: null,
      customer: { email: "walkin@example.com", phone: "+6580000000" },
      attribution: { fbclid: null, lead_id: null },
    });
  });

  it("null/empty contact yields all-null surface with explicit null match keys", () => {
    expect(buildBookedConversionPayload(null)).toEqual({
      sourceCampaignId: null,
      sourceAdId: null,
      customer: { email: null, phone: null },
      attribution: { fbclid: null, lead_id: null },
    });
  });
});
