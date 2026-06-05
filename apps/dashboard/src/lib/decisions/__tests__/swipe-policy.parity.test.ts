import { describe, expect, it } from "vitest";
import { deriveOwnership, emittedRiskContractFor } from "@switchboard/ad-optimizer";
import { AdRecommendationActionSchema, UrgencySchema } from "@switchboard/schemas";
import { canSwipeApprove, needsConfirm } from "../swipe-policy";

/**
 * Riley v3 spec-7.7 parity tripwire. The dashboard keeps its generic
 * risk-contract gate (it serves parked approvals, legacy rows, and any future
 * producer), and the backend's deriveOwnership restates the swipe predicate
 * once. This test makes that restatement IMPOSSIBLE TO DRIFT SILENTLY: it
 * enumerates the full action x urgency domain against the SAME five-field
 * contract the sink emits (emittedRiskContractFor is the sink's own producer)
 * and fails CI when either side moves (a new action, a changed elevation, an
 * URGENCY_TO_RISK change, or a swipe-policy edit).
 *
 * SCOPE (Riley emitted-contract parity): these assertions hold over the
 * contracts Riley emits. The gates' missing-contract arms (absence = unsafe /
 * confirm) guard legacy and non-Riley rows and are deliberately out of scope.
 */

const ALL_ACTIONS = AdRecommendationActionSchema.options;
const ALL_URGENCIES = UrgencySchema.options;
/** Clears both creative floors (destructive is the higher bar: 50/5/7). */
const PASSING_CONTEXT = {
  evidence: { clicks: 50, conversions: 5, days: 7 },
  learningPhaseActive: false,
};
// Two context variants suffice here: a failing context (thin evidence or
// learning-locked) falls through the handoff arm to the SAME contract-based
// logic as no context at all, so it adds no equivalence class to the
// swipe/escalation parity asserted below. The handoff arm only ever REMOVES a
// row from the operator-owned set. The full failing-context grid is exercised
// in packages/ad-optimizer/src/recommendation-ownership.test.ts.
const CONTEXT_VARIANTS = [undefined, PASSING_CONTEXT] as const;

describe("swipe-policy parity tripwire (Riley v3 ownership, spec 7.7)", () => {
  it("canSwipeApprove(emitted contract) === (ownership === operator_swipe) over the full domain", () => {
    for (const action of ALL_ACTIONS) {
      for (const urgency of ALL_URGENCIES) {
        const contract = emittedRiskContractFor(action, urgency);
        for (const handoffContext of CONTEXT_VARIANTS) {
          const ownership = deriveOwnership({ action, urgency, handoffContext });
          expect(
            canSwipeApprove(contract),
            `${action}/${urgency}/ctx=${handoffContext ? "passing" : "none"}`,
          ).toBe(ownership === "operator_swipe");
        }
      }
    }
  });

  it("needsConfirm(emitted contract) === (ownership === human_escalation) wherever the operator owns the decision", () => {
    for (const action of ALL_ACTIONS) {
      for (const urgency of ALL_URGENCIES) {
        const contract = emittedRiskContractFor(action, urgency);
        for (const handoffContext of CONTEXT_VARIANTS) {
          const ownership = deriveOwnership({ action, urgency, handoffContext });
          if (ownership === "mira_handoff") continue; // Mira owns the fix; the confirm step is approval mechanics
          expect(
            needsConfirm(contract),
            `${action}/${urgency}/ctx=${handoffContext ? "passing" : "none"}`,
          ).toBe(ownership === "human_escalation");
        }
      }
    }
  });

  it("a clearing handoff gate never coexists with a swipe-eligible contract (structural exclusivity)", () => {
    for (const action of ALL_ACTIONS) {
      for (const urgency of ALL_URGENCIES) {
        const ownership = deriveOwnership({ action, urgency, handoffContext: PASSING_CONTEXT });
        if (ownership === "mira_handoff") {
          expect(canSwipeApprove(emittedRiskContractFor(action, urgency))).toBe(false);
        }
      }
    }
  });
});
