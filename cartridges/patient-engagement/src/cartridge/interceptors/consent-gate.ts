// ---------------------------------------------------------------------------
// Consent Gate — beforeExecute interceptor
// ---------------------------------------------------------------------------
// Blocks outbound communication if the patient has not granted active consent.
// ---------------------------------------------------------------------------

import type { CartridgeInterceptor, CartridgeContext } from "@switchboard/cartridge-sdk";

/** Action types that require active consent */
const CONSENT_REQUIRED_ACTIONS = [
  "patient-engagement.reminder.send",
  "patient-engagement.review.request",
  "patient-engagement.cadence.start",
];

export class ConsentGate implements CartridgeInterceptor {
  async beforeExecute(
    actionType: string,
    parameters: Record<string, unknown>,
    context: CartridgeContext,
  ): Promise<{ proceed: boolean; parameters: Record<string, unknown>; reason?: string }> {
    // Only gate outbound communication actions
    if (!CONSENT_REQUIRED_ACTIONS.includes(actionType)) {
      return { proceed: true, parameters };
    }

    // Only trust consent from verified context (identity spec trustBehaviors),
    // never from user-supplied parameters to prevent consent bypass.
    const consentStatus = (context.connectionCredentials as Record<string, unknown>)
      .consentStatus as string | undefined;

    if (consentStatus !== "active") {
      return {
        proceed: false,
        parameters,
        reason: `Consent is "${consentStatus ?? "unknown"}" — active consent required for ${actionType}. Consent must be verified through identity context, not request parameters.`,
      };
    }

    return { proceed: true, parameters };
  }
}
