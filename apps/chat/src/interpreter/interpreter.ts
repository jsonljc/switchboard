import { randomUUID } from "node:crypto";
import type { ActionProposal } from "@switchboard/schemas";
import { ActionProposalSchema } from "@switchboard/schemas";
import { z } from "zod";

export interface InterpreterResult {
  proposals: ActionProposal[];
  needsClarification: boolean;
  clarificationQuestion: string | null;
  confidence: number;
  rawResponse: string;
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
        regex: /pause\s+(?:campaign\s+)?['""]?(.+?)['""]?\s*$/i,
        actionType: "ads.campaign.pause",
        extractParams: (match) => ({
          campaignRef: match[1]?.trim(),
        }),
      },
      {
        regex: /resume\s+(?:campaign\s+)?['""]?(.+?)['""]?\s*$/i,
        actionType: "ads.campaign.resume",
        extractParams: (match) => ({
          campaignRef: match[1]?.trim(),
        }),
      },
      {
        regex: /(?:set|change|adjust|update)\s+(?:the\s+)?budget\s+(?:for\s+)?['""]?(.+?)['""]?\s+(?:to\s+)?\$?(\d+(?:\.\d+)?)/i,
        actionType: "ads.budget.adjust",
        extractParams: (match) => ({
          campaignRef: match[1]?.trim(),
          newBudget: parseFloat(match[2] ?? "0"),
        }),
      },
      {
        regex: /(?:increase|raise)\s+(?:the\s+)?budget\s+(?:for\s+)?['""]?(.+?)['""]?\s+(?:by\s+)?\$?(\d+(?:\.\d+)?)/i,
        actionType: "ads.budget.adjust",
        extractParams: (match) => ({
          campaignRef: match[1]?.trim(),
          budgetChange: parseFloat(match[2] ?? "0"),
        }),
      },
      {
        regex: /(?:decrease|lower|reduce)\s+(?:the\s+)?budget\s+(?:for\s+)?['""]?(.+?)['""]?\s+(?:by\s+)?\$?(\d+(?:\.\d+)?)/i,
        actionType: "ads.budget.adjust",
        extractParams: (match) => ({
          campaignRef: match[1]?.trim(),
          budgetChange: -parseFloat(match[2] ?? "0"),
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

    // No match - ask for clarification
    return {
      proposals: [],
      needsClarification: true,
      clarificationQuestion:
        "I'm not sure what you're asking me to do. Could you clarify?\n" +
        "I can help with: pause/resume campaigns, adjust budgets.\n" +
        "Reply with what you'd like, or type 'help' for the full list.",
      confidence: 0,
      rawResponse: text,
    };
  }
}
