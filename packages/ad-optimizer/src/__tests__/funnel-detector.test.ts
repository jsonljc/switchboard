import { describe, it, expect } from "vitest";
import { detectFunnelShape, getFunnelStageTemplate } from "../funnel-detector.js";

describe("detectFunnelShape", () => {
  it("maps WEBSITE to website", () => {
    expect(detectFunnelShape("WEBSITE")).toBe("website");
  });

  it("maps ON_AD to instant_form", () => {
    expect(detectFunnelShape("ON_AD")).toBe("instant_form");
  });

  it("maps WHATSAPP to whatsapp", () => {
    expect(detectFunnelShape("WHATSAPP")).toBe("whatsapp");
  });

  it("maps MESSAGING_MESSENGER_WHATSAPP to whatsapp", () => {
    expect(detectFunnelShape("MESSAGING_MESSENGER_WHATSAPP")).toBe("whatsapp");
  });

  it("maps MESSAGING_INSTAGRAM_DIRECT_WHATSAPP to whatsapp", () => {
    expect(detectFunnelShape("MESSAGING_INSTAGRAM_DIRECT_WHATSAPP")).toBe("whatsapp");
  });

  it("maps UNKNOWN to website (default)", () => {
    expect(detectFunnelShape("UNKNOWN")).toBe("website");
  });

  it("maps UNDEFINED to website (default)", () => {
    expect(detectFunnelShape("UNDEFINED")).toBe("website");
  });
});

describe("getFunnelStageTemplate", () => {
  it("returns 6 stages for website", () => {
    const stages = getFunnelStageTemplate("website");
    expect(stages).toHaveLength(6);
    expect(stages.map((s) => s.name)).toEqual([
      "Impressions",
      "Clicks",
      "Landing Page Views",
      "Leads",
      "Qualified",
      "Closed",
    ]);
  });

  it("returns 5 stages for instant_form", () => {
    const stages = getFunnelStageTemplate("instant_form");
    expect(stages).toHaveLength(5);
    expect(stages.map((s) => s.name)).toEqual([
      "Impressions",
      "Clicks",
      "Leads",
      "Qualified",
      "Closed",
    ]);
  });

  it("returns 6 stages for whatsapp", () => {
    const stages = getFunnelStageTemplate("whatsapp");
    expect(stages).toHaveLength(6);
    expect(stages.map((s) => s.name)).toEqual([
      "Impressions",
      "Clicks",
      "Conversations Started",
      "First Reply",
      "Qualified",
      "Closed",
    ]);
  });

  it("each stage has a metricKey", () => {
    for (const shape of ["website", "instant_form", "whatsapp"] as const) {
      const stages = getFunnelStageTemplate(shape);
      for (const stage of stages) {
        expect(stage.metricKey).toBeTruthy();
      }
    }
  });
});
