import { describe, it, expect } from "vitest";
import { evaluateProactiveSendEligibility } from "./proactive-eligibility.js";
import type { WhatsAppTemplate } from "../skill-runtime/templates/whatsapp-registry.js";

const APPROVED_TEMPLATE: WhatsAppTemplate = {
  name: "re_engagement_offer_sg_v1",
  metaTemplateName: "alex_re_engagement_offer_sg_v1",
  intentClass: "re-engagement-offer",
  jurisdiction: "SG",
  templateCategory: "marketing",
  approvalStatus: "approved",
  body: "Hi {{lead_name}} ...",
  variables: [
    { name: "lead_name", description: "first name" },
    { name: "business_name", description: "clinic name" },
  ],
};

const optedInContact = {
  pdpaJurisdiction: "SG" as const,
  consentGrantedAt: "2026-05-01T00:00:00.000Z",
  consentRevokedAt: null,
  messagingOptIn: true,
};

const outsideWindow = new Date(Date.now() - 48 * 60 * 60 * 1000);

describe("evaluateProactiveSendEligibility", () => {
  it("blocks when PDPA consent is revoked", () => {
    const r = evaluateProactiveSendEligibility({
      contact: { ...optedInContact, consentRevokedAt: "2026-05-10T00:00:00.000Z" },
      lastWhatsAppInboundAt: outsideWindow,
      intentClass: "re-engagement-offer",
      jurisdiction: "SG",
      allowMarketingTemplate: true,
    });
    expect(r).toEqual({ eligible: false, reason: "consent_revoked" });
  });

  it("blocks proactive sends when consent is pending (jurisdiction stamped, never granted)", () => {
    const r = evaluateProactiveSendEligibility({
      contact: { ...optedInContact, consentGrantedAt: null },
      lastWhatsAppInboundAt: outsideWindow,
      intentClass: "re-engagement-offer",
      jurisdiction: "SG",
      allowMarketingTemplate: true,
    });
    expect(r).toEqual({ eligible: false, reason: "consent_pending" });
  });

  it("blocks when outside the window without opt-in", () => {
    const r = evaluateProactiveSendEligibility({
      contact: { ...optedInContact, messagingOptIn: false },
      lastWhatsAppInboundAt: outsideWindow,
      intentClass: "re-engagement-offer",
      jurisdiction: "SG",
      allowMarketingTemplate: true,
    });
    expect(r).toEqual({ eligible: false, reason: "no_optin" });
  });

  it("blocks when no template matches the jurisdiction (null jurisdiction)", () => {
    const r = evaluateProactiveSendEligibility({
      contact: { ...optedInContact, pdpaJurisdiction: null },
      lastWhatsAppInboundAt: outsideWindow,
      intentClass: "re-engagement-offer",
      jurisdiction: null,
      allowMarketingTemplate: true,
    });
    expect(r).toEqual({ eligible: false, reason: "no_template" });
  });

  it("FAILS CLOSED on today's real registry: re-engagement template is draft", () => {
    const r = evaluateProactiveSendEligibility({
      contact: optedInContact,
      lastWhatsAppInboundAt: outsideWindow,
      intentClass: "re-engagement-offer",
      jurisdiction: "SG",
      allowMarketingTemplate: true,
    });
    expect(r).toEqual({ eligible: false, reason: "template_not_approved" });
  });

  it("blocks an approved marketing template when marketing substitution is disabled", () => {
    const r = evaluateProactiveSendEligibility({
      contact: optedInContact,
      lastWhatsAppInboundAt: outsideWindow,
      intentClass: "re-engagement-offer",
      jurisdiction: "SG",
      allowMarketingTemplate: false,
      selectTemplateFn: () => APPROVED_TEMPLATE,
    });
    expect(r).toEqual({ eligible: false, reason: "marketing_blocked" });
  });

  it("is eligible when consent + opt-in + approved template + marketing allowed all hold", () => {
    const r = evaluateProactiveSendEligibility({
      contact: optedInContact,
      lastWhatsAppInboundAt: outsideWindow,
      intentClass: "re-engagement-offer",
      jurisdiction: "SG",
      allowMarketingTemplate: true,
      selectTemplateFn: () => APPROVED_TEMPLATE,
    });
    expect(r).toEqual({ eligible: true, template: APPROVED_TEMPLATE });
  });
});
