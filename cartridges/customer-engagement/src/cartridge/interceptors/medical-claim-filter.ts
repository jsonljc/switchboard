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

/** Regex patterns that indicate medical claims (with word boundaries to prevent false positives) */
const MEDICAL_CLAIM_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bcures?\b/i, label: "cure" },
  { pattern: /\bguarantee[ds]?\s+(?:results?|outcomes?|success)/i, label: "guaranteed results" },
  { pattern: /\b100%\s+effective\b/i, label: "100% effective" },
  { pattern: /\b100%\s+success\b/i, label: "100% success" },
  { pattern: /\bfda\s+approved\s+for\b/i, label: "fda approved for" },
  { pattern: /\bclinically\s+proven\s+to\b/i, label: "clinically proven to" },
  { pattern: /\bmiracle\b/i, label: "miracle" },
  { pattern: /\bpermanent\s+results?\b/i, label: "permanent results" },
  { pattern: /\brisk[- ]free\b/i, label: "risk-free" },
  { pattern: /\bno\s+side\s+effects?\b/i, label: "no side effects" },
  { pattern: /\beliminates?\s+all\b/i, label: "eliminates all" },
  { pattern: /\binstant\s+results?\b/i, label: "instant results" },
  // FTC/FDA terms
  { pattern: /\bscientifically\s+proven\b/i, label: "scientifically proven" },
  { pattern: /\bmedically\s+proven\b/i, label: "medically proven" },
  { pattern: /\breverse[sd]?\s+aging\b/i, label: "reverse aging" },
  { pattern: /\bno\s+(?:pain|downtime|recovery)\b/i, label: "no pain/downtime/recovery" },
  { pattern: /\balways\s+works\b/i, label: "always works" },
  { pattern: /\bnever\s+fails?\b/i, label: "never fails" },
  {
    pattern: /\bbetter\s+than\s+(?:surgery|medication)\b/i,
    label: "better than surgery/medication",
  },
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

/**
 * Scan text(s) for medical claim keywords that could be regulatory violations.
 * Returns list of detected violation keywords, or empty array if clean.
 * Extracted as a standalone function so it can be reused in the lead conversation
 * path (sendFilteredReply) in addition to the afterExecute interceptor.
 */
export function findMedicalClaims(texts: string[]): string[] {
  const violations: string[] = [];
  const combined = texts.join(" ");

  for (const { pattern, label } of MEDICAL_CLAIM_PATTERNS) {
    if (pattern.test(combined)) {
      violations.push(label);
    }
  }

  return [...new Set(violations)];
}
