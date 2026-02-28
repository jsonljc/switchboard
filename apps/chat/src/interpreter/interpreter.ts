import { randomUUID } from "node:crypto";
import type { ActionProposal } from "@switchboard/schemas";
import { ActionProposalSchema } from "@switchboard/schemas";
import { z } from "zod";
import type { ReadIntentDescriptor } from "../clinic/types.js";

export interface InterpreterResult {
  proposals: ActionProposal[];
  needsClarification: boolean;
  clarificationQuestion: string | null;
  confidence: number;
  rawResponse: string;
  /** Set by clinic interpreter for read-only intents (performance reports, status checks). */
  readIntent?: ReadIntentDescriptor | null;
}

export interface Interpreter {
  interpret(
    text: string,
    conversationContext: Record<string, unknown>,
    availableActions: string[],
  ): Promise<InterpreterResult>;
}

// Schema guard: Zod-parse-or-reject for interpreter outputs
const InterpreterOutputSchema = z.object({
  proposals: z.array(ActionProposalSchema),
  needsClarification: z.boolean(),
  clarificationQuestion: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export function validateInterpreterOutput(raw: unknown): InterpreterResult | null {
  const result = InterpreterOutputSchema.safeParse(raw);
  if (!result.success) {
    return null;
  }
  return {
    ...result.data,
    rawResponse: JSON.stringify(raw),
  };
}

// Rule-based interpreter (no LLM dependency for v1)
export class RuleBasedInterpreter implements Interpreter {
  private patterns: Array<{
    regex: RegExp;
    actionType: string;
    extractParams: (match: RegExpMatchArray, text: string) => Record<string, unknown>;
  }>;

  constructor() {
    this.patterns = [
      {
        regex: /pause\s+(?:campaign\s+)?['"]?(.+?)['"]?\s*$/i,
        actionType: "ads.campaign.pause",
        extractParams: (match) => ({
          campaignRef: match[1]?.trim(),
        }),
      },
      {
        regex: /resume\s+(?:campaign\s+)?['"']?(.+?)['"']?\s*$/i,
        actionType: "ads.campaign.resume",
        extractParams: (match) => ({
          campaignRef: match[1]?.trim(),
        }),
      },
      {
        regex: /(?:set|change|adjust|update)\s+(?:the\s+)?budget\s+(?:for\s+)?['"']?(.+?)['"']?\s+(?:to\s+)?\$?(\d+(?:\.\d+)?)/i,
        actionType: "ads.budget.adjust",
        extractParams: (match) => ({
          campaignRef: match[1]?.trim(),
          newBudget: parseFloat(match[2] ?? "0"),
        }),
      },
      {
        regex: /(?:increase|raise)\s+(?:the\s+)?budget\s+(?:for\s+)?['"']?(.+?)['"']?\s+(?:by\s+)?\$?(\d+(?:\.\d+)?)/i,
        actionType: "ads.budget.adjust",
        extractParams: (match) => ({
          campaignRef: match[1]?.trim(),
          budgetChange: parseFloat(match[2] ?? "0"),
        }),
      },
      {
        regex: /(?:decrease|lower|reduce)\s+(?:the\s+)?budget\s+(?:for\s+)?['"']?(.+?)['"']?\s+(?:by\s+)?\$?(\d+(?:\.\d+)?)/i,
        actionType: "ads.budget.adjust",
        extractParams: (match) => ({
          campaignRef: match[1]?.trim(),
          budgetChange: -parseFloat(match[2] ?? "0"),
        }),
      },
      // Payment patterns
      {
        regex: /refund\s+\$?(\d+(?:\.\d+)?)\s+(?:for\s+)?(?:charge\s+)?(\S+)/i,
        actionType: "payments.refund.create",
        extractParams: (match) => ({
          amount: parseFloat(match[1] ?? "0"),
          chargeId: match[2]?.trim(),
        }),
      },
      {
        regex: /charge\s+(\S+)\s+\$?(\d+(?:\.\d+)?)/i,
        actionType: "payments.charge.create",
        extractParams: (match) => ({
          entityId: match[1]?.trim(),
          amount: parseFloat(match[2] ?? "0"),
        }),
      },
      {
        regex: /invoice\s+(\S+)\s+\$?(\d+(?:\.\d+)?)\s*(?:for\s+)?(.+)?/i,
        actionType: "payments.invoice.create",
        extractParams: (match) => ({
          entityId: match[1]?.trim(),
          amount: parseFloat(match[2] ?? "0"),
          description: match[3]?.trim() ?? undefined,
        }),
      },
      {
        regex: /cancel\s+(?:subscription\s+)?(\S+)/i,
        actionType: "payments.subscription.cancel",
        extractParams: (match) => ({
          subscriptionId: match[1]?.trim(),
        }),
      },
      {
        regex: /(?:apply|give|add)\s+\$?(\d+(?:\.\d+)?)\s+credit\s+(?:to\s+)?(\S+)/i,
        actionType: "payments.credit.apply",
        extractParams: (match) => ({
          amount: parseFloat(match[1] ?? "0"),
          entityId: match[2]?.trim(),
        }),
      },
      {
        regex: /(?:create|generate)\s+(?:a\s+)?payment\s+link\s+(?:for\s+)?\$?(\d+(?:\.\d+)?)/i,
        actionType: "payments.link.create",
        extractParams: (match) => ({
          amount: parseFloat(match[1] ?? "0"),
        }),
      },
    ];
  }

  async interpret(
    text: string,
    _conversationContext: Record<string, unknown>,
    availableActions: string[],
  ): Promise<InterpreterResult> {
    // Check for undo
    if (/^undo$/i.test(text.trim())) {
      return {
        proposals: [
          {
            id: `prop_${randomUUID()}`,
            actionType: "system.undo",
            parameters: {},
            evidence: "User requested undo",
            confidence: 1.0,
            originatingMessageId: "",
          },
        ],
        needsClarification: false,
        clarificationQuestion: null,
        confidence: 1.0,
        rawResponse: text,
      };
    }

    // Check for help
    if (/^help$/i.test(text.trim())) {
      return {
        proposals: [],
        needsClarification: false,
        clarificationQuestion: null,
        confidence: 1.0,
        rawResponse: text,
      };
    }

    // Try pattern matching
    for (const pattern of this.patterns) {
      const match = text.match(pattern.regex);
      if (match && availableActions.includes(pattern.actionType)) {
        const params = pattern.extractParams(match, text);
        return {
          proposals: [
            {
              id: `prop_${randomUUID()}`,
              actionType: pattern.actionType,
              parameters: params,
              evidence: `Matched pattern for ${pattern.actionType}`,
              confidence: 0.85,
              originatingMessageId: "",
            },
          ],
          needsClarification: false,
          clarificationQuestion: null,
          confidence: 0.85,
          rawResponse: text,
        };
      }
    }

    // No match - build dynamic clarification based on available actions
    const capabilities: string[] = [];
    if (availableActions.some((a) => a.startsWith("ads."))) {
      capabilities.push("pause/resume campaigns, adjust budgets");
    }
    if (availableActions.some((a) => a.startsWith("payments."))) {
      capabilities.push("refunds, charges, invoices, subscriptions, credits, payment links");
    }
    if (availableActions.some((a) => a.startsWith("trading."))) {
      capabilities.push("market/limit orders, position management");
    }
    const capList = capabilities.length > 0 ? capabilities.join("; ") : "various actions";

    return {
      proposals: [],
      needsClarification: true,
      clarificationQuestion:
        "I'm not sure what you're asking me to do. Could you clarify?\n" +
        `I can help with: ${capList}.\n` +
        "Reply with what you'd like, or type 'help' for the full list.",
      confidence: 0,
      rawResponse: text,
    };
  }
}
