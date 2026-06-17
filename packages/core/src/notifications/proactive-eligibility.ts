import { evaluateConsentGate } from "@switchboard/schemas";
import type { IntentClass, PdpaJurisdiction } from "@switchboard/schemas";
import type { ProactiveSkipReason } from "@switchboard/schemas";
import { canSendWhatsAppTemplate } from "./whatsapp-window.js";
import {
  selectTemplate as defaultSelectTemplate,
  type WhatsAppTemplate,
  type Jurisdiction,
  type TemplateApprovalOverlay,
} from "../skill-runtime/templates/whatsapp-registry.js";

export type ProactiveSendEligibility =
  | { eligible: true; template: WhatsAppTemplate }
  | { eligible: false; reason: ProactiveSkipReason };

export interface ProactiveEligibilityInput {
  contact: {
    pdpaJurisdiction: PdpaJurisdiction | null;
    consentGrantedAt: Date | string | null;
    consentRevokedAt: Date | string | null;
    messagingOptIn: boolean;
  };
  lastWhatsAppInboundAt: Date | null;
  intentClass: IntentClass;
  jurisdiction: Jurisdiction | null;
  allowMarketingTemplate: boolean;
  /** Injectable for tests; defaults to the real registry lookup. */
  selectTemplateFn?: (args: {
    intentClass: IntentClass;
    jurisdiction: Jurisdiction;
  }) => WhatsAppTemplate | null;
  /**
   * Org-resolvable approval source (metaTemplateName -> status) overlaid onto the
   * selected template. Lets a Meta-APPROVED template actually send. Omitted/empty →
   * the static registry default (draft) governs and the send stays blocked.
   */
  approvalOverlay?: TemplateApprovalOverlay;
}

/**
 * The single source of truth for "may we send this proactive WhatsApp template
 * now?". Composes the PDPA proactive consent bar, the 24h-window/opt-in bar, and
 * the approved-template + marketing-substitution checks, in strictest-first
 * order. Every block path returns a recorded reason — never a silent skip.
 */
export function evaluateProactiveSendEligibility(
  input: ProactiveEligibilityInput,
): ProactiveSendEligibility {
  // 1. PDPA proactive consent (blocks pending AND revoked).
  // evaluateConsentGate expects string | null (ISO datetime strings from ContactConsentState).
  // We normalise Date instances to ISO strings here so callers may pass either form.
  const toIso = (v: Date | string | null): string | null =>
    v instanceof Date ? v.toISOString() : v;
  const consent = evaluateConsentGate({
    contact: {
      pdpaJurisdiction: input.contact.pdpaJurisdiction,
      consentGrantedAt: toIso(input.contact.consentGrantedAt),
      consentRevokedAt: toIso(input.contact.consentRevokedAt),
    },
    messageClass: "proactive",
  });
  if (consent.action === "block") {
    return { eligible: false, reason: consent.reasonCode };
  }

  // 2. WhatsApp 24h window / opt-in.
  const window = canSendWhatsAppTemplate({
    contact: { messagingOptIn: input.contact.messagingOptIn },
    lastInboundAt: input.lastWhatsAppInboundAt,
  });
  if (!window.allowed) {
    return { eligible: false, reason: "no_optin" };
  }

  // 3. Approved-template selection + marketing-substitution.
  if (input.jurisdiction === null) {
    return { eligible: false, reason: "no_template" };
  }
  const selectTemplate = input.selectTemplateFn ?? defaultSelectTemplate;
  const selected = selectTemplate({
    intentClass: input.intentClass,
    jurisdiction: input.jurisdiction,
  });
  if (!selected) {
    return { eligible: false, reason: "no_template" };
  }
  // Overlay the org-resolvable approval status (keyed by metaTemplateName). A missing
  // entry preserves the static default (draft), so the send stays blocked by default.
  const overlaidStatus = input.approvalOverlay?.[selected.metaTemplateName];
  const template: WhatsAppTemplate =
    overlaidStatus !== undefined && overlaidStatus !== selected.approvalStatus
      ? { ...selected, approvalStatus: overlaidStatus }
      : selected;
  if (template.approvalStatus !== "approved") {
    return { eligible: false, reason: "template_not_approved" };
  }
  if (template.templateCategory === "marketing" && !input.allowMarketingTemplate) {
    return { eligible: false, reason: "marketing_blocked" };
  }

  return { eligible: true, template };
}
