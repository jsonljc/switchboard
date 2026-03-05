// ---------------------------------------------------------------------------
// Medical Claim Filter — afterExecute interceptor
// ---------------------------------------------------------------------------
// Scans outbound messages for medical claims that could be regulatory
// violations (FTC, FDA). Flags or blocks messages containing prohibited terms.
// ---------------------------------------------------------------------------

import type {
  CartridgeInterceptor,
  CartridgeContext,
  ExecuteResult,
} from "@switchboard/cartridge-sdk";

/** Keywords that indicate medical claims */
const MEDICAL_CLAIM_KEYWORDS = [
  "cure",
  "cures",
  "guaranteed results",
  "guarantee",
  "guaranteed",
  "100% effective",
  "100% success",
  "fda approved for",
  "clinically proven to",
  "miracle",
  "permanent results",
  "risk-free",
  "no side effects",
  "eliminates all",
  "instant results",
];

/** Action types that produce outbound messages */
const OUTBOUND_ACTIONS = [
  "customer-engagement.reminder.send",
  "customer-engagement.review.request",
  "customer-engagement.review.respond",
  "customer-engagement.conversation.handle_objection",
];

export class MedicalClaimFilter implements CartridgeInterceptor {
  async afterExecute(
    actionType: string,
    parameters: Record<string, unknown>,
    result: ExecuteResult,
    _context: CartridgeContext,
  ): Promise<ExecuteResult> {
    // Only scan outbound communication actions
    if (!OUTBOUND_ACTIONS.includes(actionType)) return result;
    if (!result.success) return result;

    // Scan the message parameter and summary for medical claims
    const textsToScan: string[] = [];
    if (typeof parameters.message === "string") textsToScan.push(parameters.message);
    if (typeof parameters.responseText === "string") textsToScan.push(parameters.responseText);
    if (result.summary) textsToScan.push(result.summary);

    // Check result data for outbound text
    if (result.data && typeof result.data === "object") {
      const data = result.data as Record<string, unknown>;
      if (typeof data.response === "string") textsToScan.push(data.response);
    }

    const violations = findMedicalClaims(textsToScan);

    if (violations.length > 0) {
      return {
        ...result,
        success: false,
        summary: `[BLOCKED by MedicalClaimFilter] ${result.summary}. Detected medical claims: ${violations.join(", ")}`,
        externalRefs: {
          ...result.externalRefs,
          medicalClaimViolations: violations.join(", "),
          filteredBy: "MedicalClaimFilter",
        },
      };
    }

    return result;
  }
}

function findMedicalClaims(texts: string[]): string[] {
  const violations: string[] = [];
  const combined = texts.join(" ").toLowerCase();

  for (const keyword of MEDICAL_CLAIM_KEYWORDS) {
    if (combined.includes(keyword.toLowerCase())) {
      violations.push(keyword);
    }
  }

  return [...new Set(violations)];
}
