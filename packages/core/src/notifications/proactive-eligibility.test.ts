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

  it("is eligible when an org-resolvable approval overlay flips the static draft template to approved", () => {
    // No selectTemplateFn override: this exercises the REAL registry (all draft)
    // plus the org-resolvable approvalOverlay. The overlay must promote the matched
    // utility template so a Meta-approved template can actually send.
    const r = evaluateProactiveSendEligibility({
      contact: optedInContact,
      lastWhatsAppInboundAt: outsideWindow,
      intentClass: "appointment-reminder",
      jurisdiction: "SG",
      allowMarketingTemplate: false,
      approvalOverlay: { alex_appointment_reminder_sg_v1: "approved" },
    });
    expect(r.eligible).toBe(true);
    if (r.eligible) {
      expect(r.template.metaTemplateName).toBe("alex_appointment_reminder_sg_v1");
      expect(r.template.approvalStatus).toBe("approved");
    }
  });

  it("stays blocked on the real registry when the overlay reports a non-approved status", () => {
    const r = evaluateProactiveSendEligibility({
      contact: optedInContact,
      lastWhatsAppInboundAt: outsideWindow,
      intentClass: "appointment-reminder",
      jurisdiction: "SG",
      allowMarketingTemplate: false,
      approvalOverlay: { alex_appointment_reminder_sg_v1: "submitted" },
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

// firstTouch relaxation: a brand-new lead (Instant-Form or CTWA) has no captured PDPA
// grant yet (status "pending"), but its lawful basis is the source-aware opt-in/window
// checked downstream. firstTouch=true relaxes ONLY the consent_pending block; revocation
// always wins; the opt-in/window floor + the approved-template gate are NOT bypassed.
describe("evaluateProactiveSendEligibility — firstTouch (first-touch greeting, D2)", () => {
  const withinWindow = new Date(Date.now() - 60 * 60 * 1000);
  const pendingContact = {
    pdpaJurisdiction: "SG" as const,
    consentGrantedAt: null,
    consentRevokedAt: null,
    messagingOptIn: true,
  };

  it("relaxes consent_pending for a first-touch lead with an opt-in basis + approved template", () => {
    const r = evaluateProactiveSendEligibility({
      contact: pendingContact, // pending: jurisdiction stamped, no grant yet
      lastWhatsAppInboundAt: outsideWindow, // no inbound window; messagingOptIn is the basis
      intentClass: "first-touch-greeting",
      jurisdiction: "SG",
      allowMarketingTemplate: true,
      approvalOverlay: { alex_first_touch_greeting_sg_v1: "approved" },
      firstTouch: true,
    });
    expect(r.eligible).toBe(true);
    if (r.eligible) {
      expect(r.template.metaTemplateName).toBe("alex_first_touch_greeting_sg_v1");
    }
  });

  it("NEVER relaxes a consent revocation, even for a first-touch lead (revocation precedence)", () => {
    const r = evaluateProactiveSendEligibility({
      contact: { ...pendingContact, consentRevokedAt: "2026-06-01T00:00:00.000Z" },
      lastWhatsAppInboundAt: outsideWindow,
      intentClass: "first-touch-greeting",
      jurisdiction: "SG",
      allowMarketingTemplate: true,
      approvalOverlay: { alex_first_touch_greeting_sg_v1: "approved" },
      firstTouch: true,
    });
    expect(r).toEqual({ eligible: false, reason: "consent_revoked" });
  });

  it("still blocks consent_pending when firstTouch is false/absent (established-contact gate unchanged)", () => {
    const r = evaluateProactiveSendEligibility({
      contact: pendingContact,
      lastWhatsAppInboundAt: outsideWindow,
      intentClass: "first-touch-greeting",
      jurisdiction: "SG",
      allowMarketingTemplate: true,
      approvalOverlay: { alex_first_touch_greeting_sg_v1: "approved" },
      firstTouch: false,
    });
    expect(r).toEqual({ eligible: false, reason: "consent_pending" });
  });

  it("does NOT bypass the opt-in/window floor: relaxed pending + no opt-in + outside window → no_optin", () => {
    const r = evaluateProactiveSendEligibility({
      contact: { ...pendingContact, messagingOptIn: false },
      lastWhatsAppInboundAt: outsideWindow,
      intentClass: "first-touch-greeting",
      jurisdiction: "SG",
      allowMarketingTemplate: true,
      approvalOverlay: { alex_first_touch_greeting_sg_v1: "approved" },
      firstTouch: true,
    });
    expect(r).toEqual({ eligible: false, reason: "no_optin" });
  });

  it("recognizes the CTWA free-entry-point window as the basis (inbound within 24h, no messagingOptIn)", () => {
    const r = evaluateProactiveSendEligibility({
      contact: { ...pendingContact, messagingOptIn: false },
      lastWhatsAppInboundAt: withinWindow, // a genuine inbound: user-initiated CTWA
      intentClass: "first-touch-greeting",
      jurisdiction: "SG",
      allowMarketingTemplate: true,
      approvalOverlay: { alex_first_touch_greeting_sg_v1: "approved" },
      firstTouch: true,
    });
    expect(r.eligible).toBe(true);
  });

  it("does NOT bypass the approved-template gate: relaxed pending + opt-in but draft template → template_not_approved", () => {
    const r = evaluateProactiveSendEligibility({
      contact: pendingContact,
      lastWhatsAppInboundAt: outsideWindow,
      intentClass: "first-touch-greeting",
      jurisdiction: "SG",
      allowMarketingTemplate: true,
      // No overlay → the static first-touch template stays draft → blocked.
      firstTouch: true,
    });
    expect(r).toEqual({ eligible: false, reason: "template_not_approved" });
  });
});
