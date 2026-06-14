import { describe, it, expect } from "vitest";
import { scoreAttribution } from "./score-attribution.js";

describe("scoreAttribution", () => {
  it("deterministic: a hard lead/ad id ties the booking to one ad", () => {
    expect(scoreAttribution({ leadgenId: "L1" })).toBe("deterministic");
    expect(scoreAttribution({ sourceAdId: "ad_1" })).toBe("deterministic");
  });

  it("high: first-party source type with a campaign id, no single click id", () => {
    expect(scoreAttribution({ sourceType: "ctwa", sourceCampaignId: "c1" })).toBe("high");
    expect(scoreAttribution({ sourceType: "instant_form", sourceCampaignId: "c1" })).toBe("high");
  });

  it("medium: a campaign or channel is known but not a first-party click", () => {
    expect(scoreAttribution({ sourceCampaignId: "c1" })).toBe("medium");
    expect(scoreAttribution({ sourceChannel: "whatsapp" })).toBe("medium");
  });

  it("low: only a coarse self-reported / organic source type", () => {
    expect(scoreAttribution({ sourceType: "organic" })).toBe("low");
    expect(scoreAttribution({ sourceType: "web" })).toBe("low");
  });

  it("unattributed: no usable source evidence", () => {
    expect(scoreAttribution({})).toBe("unattributed");
    expect(scoreAttribution({ leadgenId: null, sourceAdId: null, sourceType: null })).toBe(
      "unattributed",
    );
  });

  it("precedence: a hard id outranks a first-party campaign", () => {
    expect(scoreAttribution({ leadgenId: "L1", sourceType: "ctwa", sourceCampaignId: "c1" })).toBe(
      "deterministic",
    );
  });
});
