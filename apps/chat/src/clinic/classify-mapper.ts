import { randomUUID } from "node:crypto";
import type { GoalBrief } from "@switchboard/schemas";
import {
  AllowedIntent,
  READ_INTENTS,
  WRITE_INTENTS,
  DIAGNOSTIC_INTENTS,
  DIAGNOSTIC_INTENT_TO_ACTION,
} from "./types.js";
import type { ReadIntentDescriptor } from "./types.js";
import { INTENT_TO_ACTION } from "./clinic-prompt.js";

/**
 * Map a classified intent + slots to the interpreter output structure.
 * This is the core routing logic: determines whether the intent maps to
 * a read descriptor, a system command, a diagnostic action, or a write proposal.
 */
export function mapClassifyToInterpreterOutput(
  intent: AllowedIntent,
  confidence: number,
  slots: Record<string, unknown>,
  availableActions: string[],
  adAccountId: string,
): unknown {
  // Low confidence → clarification
  if (confidence < 0.5 || intent === AllowedIntent.UNKNOWN) {
    return {
      proposals: [],
      needsClarification: true,
      clarificationQuestion:
        "I'm not sure what you're asking. I can help with:\n" +
        "- Campaign performance reports\n" +
        "- Pausing or resuming campaigns\n" +
        "- Adjusting budgets\n" +
        "- Getting more leads\n" +
        "- Funnel diagnostics and portfolio analysis\n\n" +
        "What would you like to do?",
      confidence,
    };
  }

  // Read intents → readIntent descriptor, no proposals
  if (READ_INTENTS.has(intent)) {
    const readIntent: ReadIntentDescriptor = { intent, slots, confidence };
    const goalBrief = intentToGoalBrief(intent, slots);
    return {
      proposals: [],
      needsClarification: false,
      clarificationQuestion: null,
      confidence,
      readIntent,
      goalBrief,
    };
  }

  // REVERT → system.undo
  if (intent === AllowedIntent.REVERT) {
    return {
      proposals: [
        {
          id: `prop_${randomUUID()}`,
          actionType: "system.undo",
          parameters: {},
          evidence: "User requested undo/revert",
          confidence,
          originatingMessageId: "",
        },
      ],
      needsClarification: false,
      clarificationQuestion: null,
      confidence,
    };
  }

  // KILL_SWITCH → system.kill_switch
  if (intent === AllowedIntent.KILL_SWITCH) {
    return {
      proposals: [
        {
          id: `prop_${randomUUID()}`,
          actionType: "system.kill_switch",
          parameters: {},
          evidence: "Emergency kill switch requested",
          confidence,
          originatingMessageId: "",
        },
      ],
      needsClarification: false,
      clarificationQuestion: null,
      confidence,
    };
  }

  // Diagnostic intents → ActionProposal (auto-approve via low risk)
  if (DIAGNOSTIC_INTENTS.has(intent)) {
    const actionType = DIAGNOSTIC_INTENT_TO_ACTION[intent];
    if (!actionType || !availableActions.includes(actionType)) {
      return {
        proposals: [],
        needsClarification: true,
        clarificationQuestion: "That diagnostic action is not available right now.",
        confidence: 0.3,
      };
    }

    return {
      proposals: [
        {
          id: `prop_${randomUUID()}`,
          actionType,
          parameters: {
            platform: "meta",
            entityId: adAccountId,
            vertical: (slots["vertical"] as string) ?? "commerce",
            periodDays: (slots["periodDays"] as number) ?? 7,
          },
          evidence: `Diagnostic intent: ${intent}`,
          confidence,
          originatingMessageId: "",
        },
      ],
      needsClarification: false,
      clarificationQuestion: null,
      confidence,
    };
  }

  // Write intents → ActionProposal
  if (WRITE_INTENTS.has(intent)) {
    const actionType = INTENT_TO_ACTION[intent];
    if (!actionType || !availableActions.includes(actionType)) {
      return {
        proposals: [],
        needsClarification: true,
        clarificationQuestion: "That action is not available right now.",
        confidence: 0.3,
      };
    }

    // Map slots to parameters
    const parameters: Record<string, unknown> = {};
    if (slots["campaignRef"]) parameters["campaignRef"] = slots["campaignRef"];
    if (slots["budgetAmount"] !== undefined) parameters["newBudget"] = slots["budgetAmount"];
    if (slots["newBudget"] !== undefined) parameters["newBudget"] = slots["newBudget"];
    if (slots["budgetChange"] !== undefined) parameters["budgetChange"] = slots["budgetChange"];

    return {
      proposals: [
        {
          id: `prop_${randomUUID()}`,
          actionType,
          parameters,
          evidence: `Clinic intent: ${intent}`,
          confidence,
          originatingMessageId: "",
        },
      ],
      needsClarification: false,
      clarificationQuestion: null,
      confidence,
    };
  }

  // Fallback
  return {
    proposals: [],
    needsClarification: true,
    clarificationQuestion: "I'm not sure what you're asking. Could you rephrase?",
    confidence: 0,
  };
}

/**
 * Map a classified intent + slots to a structured GoalBrief.
 * Returns null for intents that don't map to decomposable goals.
 */
export function intentToGoalBrief(
  intent: AllowedIntent,
  slots: Record<string, unknown>,
): GoalBrief | null {
  const id = `goal_${randomUUID()}`;
  const entityRefs: Record<string, string> = {};
  if (slots["campaignRef"]) entityRefs["campaign"] = String(slots["campaignRef"]);

  switch (intent) {
    case AllowedIntent.REPORT_PERFORMANCE:
      return {
        id,
        type: "report",
        objective: "Report on campaign performance",
        constraints: [],
        successMetrics: [],
        decomposable: true,
        entityRefs,
        slots,
      };
    case AllowedIntent.MORE_LEADS:
      return {
        id,
        type: "optimize",
        objective: "Increase patient lead volume",
        constraints: slots["maxCpl"]
          ? [
              {
                field: "cpl",
                operator: "lte",
                value: Number(slots["maxCpl"]),
                unit: "USD",
              },
            ]
          : [],
        successMetrics: [{ name: "leads", direction: "increase" }],
        decomposable: true,
        entityRefs,
        slots,
      };
    case AllowedIntent.REDUCE_COST:
      return {
        id,
        type: "optimize",
        objective: "Reduce ad spend or cost per lead",
        constraints: [],
        successMetrics: [{ name: "cpl", direction: "decrease" }],
        decomposable: true,
        entityRefs,
        slots,
      };
    case AllowedIntent.CHECK_STATUS:
      return {
        id,
        type: "report",
        objective: "Check current campaign status",
        constraints: [],
        successMetrics: [],
        decomposable: true,
        entityRefs,
        slots,
      };
    case AllowedIntent.DIAGNOSE_FUNNEL:
      return {
        id,
        type: "investigate",
        objective: "Diagnose ad funnel performance issues",
        constraints: [],
        successMetrics: [],
        decomposable: true,
        entityRefs,
        slots,
      };
    case AllowedIntent.DIAGNOSE_PORTFOLIO:
      return {
        id,
        type: "investigate",
        objective: "Analyze cross-platform portfolio performance",
        constraints: [],
        successMetrics: [],
        decomposable: true,
        entityRefs,
        slots,
      };
    default:
      return null;
  }
}
