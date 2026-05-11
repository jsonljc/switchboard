import { z } from "zod";

export const PdpaJurisdictionSchema = z.enum(["SG", "MY"]);
export type PdpaJurisdiction = z.infer<typeof PdpaJurisdictionSchema>;

export const ConsentStatusSchema = z.enum(["not_applicable", "pending", "granted", "revoked"]);
export type ConsentStatus = z.infer<typeof ConsentStatusSchema>;

export const ConsentSourceSchema = z.enum([
  "whatsapp_quick_reply",
  "ig_dm_reply",
  "web_form",
  "operator_recorded",
  "inbound_keyword_revocation",
  "operator_recorded_revocation",
]);
export type ConsentSource = z.infer<typeof ConsentSourceSchema>;

export const ContactConsentStateSchema = z.object({
  pdpaJurisdiction: PdpaJurisdictionSchema.nullable(),
  consentGrantedAt: z.string().datetime().nullable(),
  consentRevokedAt: z.string().datetime().nullable(),
  consentSource: ConsentSourceSchema.nullable(),
  aiDisclosureVersionShown: z.string().nullable(),
  aiDisclosureShownAt: z.string().datetime().nullable(),
  consentUpdatedBy: z.string().nullable(),
  consentNotes: z.string().nullable(),
});
export type ContactConsentState = z.infer<typeof ContactConsentStateSchema>;

/**
 * Versioned per-jurisdiction AI disclosure copy. Stamped onto Contact when shown.
 * Regulatory artifact — PR review is the change-management surface, NOT per-tenant config.
 */
export const AI_DISCLOSURE_VERSIONS = {
  SG: "sg-disclosure@1.0.0",
  MY: "my-disclosure@1.0.0",
} as const;

export type MessageClass = "operational" | "proactive";

export type ConsentGateDecision =
  | { action: "allow"; status: ConsentStatus }
  | {
      action: "block";
      status: ConsentStatus;
      reasonCode: "consent_pending" | "consent_revoked";
    };

/**
 * Single source of truth: revocation precedence enforced by construction.
 * Revoked short-circuits before granted is consulted.
 *
 * Re-grant after revocation is NOT supported by this function — admin
 * clearConsent must explicitly null both timestamps to start a fresh cycle.
 */
export function deriveConsentStatus(c: {
  pdpaJurisdiction: PdpaJurisdiction | null;
  consentGrantedAt: Date | string | null;
  consentRevokedAt: Date | string | null;
}): ConsentStatus {
  if (!c.pdpaJurisdiction) return "not_applicable";
  if (c.consentRevokedAt) return "revoked";
  if (c.consentGrantedAt) return "granted";
  return "pending";
}

/**
 * Canonical consent-gate policy. Imported by:
 *   - PdpaConsentGateHook (always passes messageClass="operational")
 *   - Phase 1d proactive sender (passes messageClass="proactive")
 *   - admin / dashboard preview surfaces
 *
 * Matrix (jurisdiction-agnostic — SG/MY substantive difference is expressed
 * by WHEN grant capture is requested, not by branching here):
 *
 * | messageClass | not_applicable | pending                  | granted | revoked                  |
 * |--------------|----------------|--------------------------|---------|--------------------------|
 * | operational  | allow          | allow                    | allow   | block (consent_revoked)¹ |
 * | proactive    | allow          | block (consent_pending)  | allow   | block (consent_revoked)  |
 *
 * ¹ Defense-in-depth: gateway revocation scanner flips conversation to
 *   human_override which upstream-suppresses bot turns. Hook still blocks on
 *   revoked to catch races between gateway intake and skill emission.
 */
export function evaluateConsentGate(input: {
  contact: Pick<
    ContactConsentState,
    "pdpaJurisdiction" | "consentGrantedAt" | "consentRevokedAt"
  > & {
    consentGrantedAt: Date | string | null;
    consentRevokedAt: Date | string | null;
  };
  messageClass: MessageClass;
}): ConsentGateDecision {
  const status = deriveConsentStatus(input.contact);

  if (status === "revoked") {
    return { action: "block", status, reasonCode: "consent_revoked" };
  }
  if (input.messageClass === "proactive" && status === "pending") {
    return { action: "block", status, reasonCode: "consent_pending" };
  }
  return { action: "allow", status };
}
