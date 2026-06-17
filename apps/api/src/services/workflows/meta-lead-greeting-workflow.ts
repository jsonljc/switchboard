import type { WorkflowHandler } from "@switchboard/core/platform";
import { deriveConsentStatus, evaluateConsentGate } from "@switchboard/schemas";
import type { PdpaJurisdiction } from "@switchboard/schemas";

/**
 * Consent inputs for the first-touch Meta-lead greeting, scoped to the org +
 * contact. `ctwaOptIn` is true when the lead's first-touch basis is the
 * Click-to-WhatsApp ad click itself (the ad click is the opt-in for CTWA),
 * which is a legitimate basis to greet a brand-new lead that has not yet sent
 * an inbound message and therefore has no captured PDPA grant. Revocation is
 * NEVER overridden by it.
 */
export interface GreetingSendContext {
  consentGrantedAt: Date | string | null;
  consentRevokedAt: Date | string | null;
  pdpaJurisdiction: PdpaJurisdiction | null;
  ctwaOptIn: boolean;
}

export interface MetaLeadGreetingDeps {
  /** Reads the consent + first-touch basis for (orgId, contactId). */
  getSendContext: (orgId: string, contactId: string) => Promise<GreetingSendContext>;
}

interface GreetingParams {
  contactId: string;
  phone: string;
  firstName: string;
  templateName: string;
}

/** The recorded basis on which a first-touch greeting was sent. */
type GreetingConsentDecision = "granted" | "not_applicable" | "ctwa_optin";

/**
 * First-touch greeting to a new Meta lead. The greeting is a PROACTIVE WhatsApp
 * template send, so — like its sibling reminder/follow-up workflows — it MUST be
 * gated on consent eligibility rather than sent unconditionally.
 *
 * The greeting carries its own fixed `templateName` (not a registry-selected
 * proactive template keyed by IntentClass), so the gate here is the PDPA
 * proactive consent bar (`evaluateConsentGate`), NOT registry template
 * selection. Two allow paths exist:
 *
 *   1. The consent gate ALLOWS (no PDPA jurisdiction -> not_applicable, or an
 *      explicit grant -> granted).
 *   2. The CTWA first-touch opt-in: the ad click is the opt-in basis, so a
 *      brand-new lead in a PDPA jurisdiction with no captured grant yet may be
 *      greeted — UNLESS consent has been revoked, which always wins.
 *
 * Every path records its decision in `outputs` (WorkTrace is canonical
 * persistence) — the send is GATED and the decision RECORDED, never a silent
 * unconditional send. Default is fail-closed: do NOT send when ineligible.
 */
export function buildMetaLeadGreetingWorkflow(deps: MetaLeadGreetingDeps): WorkflowHandler {
  return {
    async execute(workUnit) {
      const input = workUnit.parameters as unknown as GreetingParams;

      const ctx = await deps.getSendContext(workUnit.organizationId, input.contactId);

      // evaluateConsentGate / deriveConsentStatus accept ISO strings (the form
      // ContactConsentState carries). Normalise Date instances so the dep may
      // return either form — mirrors proactive-eligibility's `toIso`.
      const toIso = (v: Date | string | null): string | null =>
        v instanceof Date ? v.toISOString() : v;
      const consentContact = {
        pdpaJurisdiction: ctx.pdpaJurisdiction,
        consentGrantedAt: toIso(ctx.consentGrantedAt),
        consentRevokedAt: toIso(ctx.consentRevokedAt),
      };

      const gate = evaluateConsentGate({
        contact: consentContact,
        messageClass: "proactive",
      });

      let decision: GreetingConsentDecision;
      if (gate.action === "allow") {
        // not_applicable (no jurisdiction) or granted.
        decision = gate.status === "granted" ? "granted" : "not_applicable";
      } else if (gate.reasonCode === "consent_pending" && ctx.ctwaOptIn) {
        // CTWA first-touch: the ad click is the opt-in basis for a not-yet-granted
        // lead. Revocation is handled by the branch below and is never reached here.
        decision = "ctwa_optin";
      } else {
        // Fail-closed: pending without a CTWA basis, or revoked (revocation always
        // wins, even over a CTWA opt-in). Record the reason and do NOT send.
        return {
          outcome: "completed",
          summary: `Greeting skipped: ${gate.reasonCode}`,
          outputs: {
            sent: false,
            skipReason: gate.reasonCode,
            consentStatus: deriveConsentStatus(consentContact),
          },
        };
      }

      if (!input.phone) {
        // Single-attempt: record a clean skip rather than a retryable failure.
        return {
          outcome: "completed",
          summary: "Greeting skipped: contact has no phone",
          outputs: { sent: false, skipReason: "missing_contact_phone", consentDecision: decision },
        };
      }

      const accessToken = process.env["WHATSAPP_ACCESS_TOKEN"];
      const phoneNumberId = process.env["WHATSAPP_PHONE_NUMBER_ID"];
      if (!accessToken || !phoneNumberId) {
        return {
          outcome: "completed",
          summary: "WhatsApp not configured; greeting skipped",
          outputs: { sent: false, skipReason: "unsupported_channel", consentDecision: decision },
        };
      }

      const response = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: input.phone,
          type: "template",
          template: {
            name: input.templateName,
            language: { code: "en" },
            components: [
              {
                type: "body",
                parameters: [{ type: "text", text: input.firstName }],
              },
            ],
          },
        }),
      });

      if (!response.ok) {
        return {
          outcome: "failed",
          summary: "Lead greeting failed",
          error: {
            code: "WHATSAPP_TEMPLATE_SEND_FAILED",
            message: await response.text(),
          },
        };
      }

      return {
        outcome: "completed",
        summary: "Lead greeting sent",
        outputs: { sent: true, consentDecision: decision },
      };
    },
  };
}
