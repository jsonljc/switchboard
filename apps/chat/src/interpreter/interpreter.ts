import { randomUUID } from "node:crypto";
import type { ActionProposal } from "@switchboard/schemas";
import { ActionProposalSchema } from "@switchboard/schemas";
import type { GoalBrief } from "@switchboard/schemas";
import { z } from "zod";
/** Lightweight descriptor for read-only intents (performance reports, status checks). */
export interface ReadIntentDescriptor {
  intent: string;
  slots: Record<string, unknown>;
  confidence: number;
}

export interface InterpreterResult {
  proposals: ActionProposal[];
  needsClarification: boolean;
  clarificationQuestion: string | null;
  confidence: number;
  rawResponse: string;
  /** Set by LLM interpreter for read-only intents (performance reports, status checks). */
  readIntent?: ReadIntentDescriptor | null;
  /** Structured goal brief for plan decomposition. */
  goalBrief?: GoalBrief | null;
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

export interface RuleBasedInterpreterConfig {
  diagnosticDefaults?: {
    platform?: string;
    entityId?: string;
    vertical?: string;
  };
}

// Rule-based interpreter (no LLM dependency for v1)
export class RuleBasedInterpreter implements Interpreter {
  private patterns: Array<{
    regex: RegExp;
    actionType: string;
    extractParams: (match: RegExpMatchArray, text: string) => Record<string, unknown>;
  }>;

  constructor(config?: RuleBasedInterpreterConfig) {
    const diagDefaults = config?.diagnosticDefaults;
    this.patterns = [
      // Diagnostic patterns (before payment patterns so they match first)
      {
        regex: /(?:diagnose|analyze)\s+(?:my\s+)?funnel/i,
        actionType: "digital-ads.funnel.diagnose",
        extractParams: () => ({
          platform: diagDefaults?.platform ?? "meta",
          entityId: diagDefaults?.entityId ?? "",
          vertical: diagDefaults?.vertical ?? "commerce",
          periodDays: 7,
        }),
      },
      {
        regex: /(?:how\s+are|what's\s+wrong\s+with)\s+(?:my\s+)?(?:ads?|campaigns?|performance)/i,
        actionType: "digital-ads.funnel.diagnose",
        extractParams: () => ({
          platform: diagDefaults?.platform ?? "meta",
          entityId: diagDefaults?.entityId ?? "",
          vertical: diagDefaults?.vertical ?? "commerce",
          periodDays: 7,
        }),
      },
      {
        regex: /(?:portfolio|cross.?platform)\s+(?:analysis|report)/i,
        actionType: "digital-ads.portfolio.diagnose",
        extractParams: () => ({
          platform: diagDefaults?.platform ?? "meta",
          entityId: diagDefaults?.entityId ?? "",
          vertical: diagDefaults?.vertical ?? "commerce",
          periodDays: 7,
        }),
      },
      {
        regex: /(?:fetch|get|show)\s+(?:my\s+)?(?:snapshot|metrics)/i,
        actionType: "digital-ads.snapshot.fetch",
        extractParams: () => ({
          platform: diagDefaults?.platform ?? "meta",
          entityId: diagDefaults?.entityId ?? "",
          vertical: diagDefaults?.vertical ?? "commerce",
          periodDays: 7,
        }),
      },
      {
        regex: /(?:analyze|check)\s+(?:my\s+)?(?:campaign|ad)\s+structure/i,
        actionType: "digital-ads.structure.analyze",
        extractParams: () => ({
          platform: diagDefaults?.platform ?? "meta",
          entityId: diagDefaults?.entityId ?? "",
          vertical: diagDefaults?.vertical ?? "commerce",
          periodDays: 7,
        }),
      },
      // Ads write patterns
      {
        regex: /pause\s+(?:campaign\s+)?['"]?(.+?)['"]?\s*$/i,
        actionType: "digital-ads.campaign.pause",
        extractParams: (match) => ({
          campaignRef: match[1]?.trim(),
        }),
      },
      {
        regex: /resume\s+(?:campaign\s+)?['"']?(.+?)['"']?\s*$/i,
        actionType: "digital-ads.campaign.resume",
        extractParams: (match) => ({
          campaignRef: match[1]?.trim(),
        }),
      },
      {
        regex:
          /(?:set|change|adjust|update)\s+(?:the\s+)?budget\s+(?:for\s+)?['"']?(.+?)['"']?\s+(?:to\s+)?\$?(\d+(?:\.\d+)?)/i,
        actionType: "digital-ads.campaign.adjust_budget",
        extractParams: (match) => ({
          campaignRef: match[1]?.trim(),
          newBudget: parseFloat(match[2] ?? "0"),
        }),
      },
      {
        regex:
          /(?:increase|raise)\s+(?:the\s+)?budget\s+(?:for\s+)?['"']?(.+?)['"']?\s+(?:by\s+)?\$?(\d+(?:\.\d+)?)/i,
        actionType: "digital-ads.campaign.adjust_budget",
        extractParams: (match) => ({
          campaignRef: match[1]?.trim(),
          budgetChange: parseFloat(match[2] ?? "0"),
        }),
      },
      {
        regex:
          /(?:decrease|lower|reduce)\s+(?:the\s+)?budget\s+(?:for\s+)?['"']?(.+?)['"']?\s+(?:by\s+)?\$?(\d+(?:\.\d+)?)/i,
        actionType: "digital-ads.campaign.adjust_budget",
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
      // CRM patterns
      {
        regex: /(?:search|find|look\s*up)\s+(?:contacts?\s+)?(?:for\s+)?['"]?(.+?)['"]?\s*$/i,
        actionType: "crm.contact.search",
        extractParams: (match) => ({ query: match[1]?.trim() }),
      },
      {
        regex: /(?:list|show|get)\s+(?:my\s+)?deals?(?:\s+(?:for|in)\s+(.+))?/i,
        actionType: "crm.deal.list",
        extractParams: (match) => (match[1] ? { pipeline: match[1]?.trim() } : {}),
      },
      {
        regex:
          /(?:list|show|get)\s+(?:my\s+)?(?:recent\s+)?activit(?:y|ies)(?:\s+(?:for|with)\s+(\S+))?/i,
        actionType: "crm.activity.list",
        extractParams: (match) => (match[1] ? { contactId: match[1]?.trim() } : {}),
      },
      {
        regex: /(?:pipeline|funnel)\s+(?:status|report|overview)/i,
        actionType: "crm.pipeline.status",
        extractParams: () => ({}),
      },
      {
        regex: /(?:create|add|new)\s+contact\s+(.+)/i,
        actionType: "crm.contact.create",
        extractParams: (_match, text) => {
          const emailMatch = text.match(/[\w.-]+@[\w.-]+/);
          const nameMatch = text.match(/(?:named?|for)\s+['"]?([^'"@]+?)['"]?(?:\s+|$)/i);
          return {
            email: emailMatch?.[0] ?? "",
            firstName: nameMatch?.[1]?.split(/\s+/)[0] ?? "",
            lastName: nameMatch?.[1]?.split(/\s+/).slice(1).join(" ") ?? "",
          };
        },
      },
      {
        regex: /(?:update|edit|change)\s+contact\s+(\S+)\s+(?:set\s+)?(.+)/i,
        actionType: "crm.contact.update",
        extractParams: (match) => ({
          contactId: match[1]?.trim(),
          data: { raw: match[2]?.trim() },
        }),
      },
      {
        regex: /(?:create|add|new)\s+deal\s+['"]?(.+?)['"]?\s+(?:for\s+)?\$?(\d+(?:\.\d+)?)/i,
        actionType: "crm.deal.create",
        extractParams: (match) => ({
          name: match[1]?.trim(),
          amount: parseFloat(match[2] ?? "0"),
        }),
      },
      {
        regex:
          /(?:log|add)\s+(?:a\s+)?(?:note|call|meeting|email|task)\s+(?:for\s+|to\s+|about\s+)?(.+)/i,
        actionType: "crm.activity.log",
        extractParams: (match, text) => {
          const typeMatch = text.match(/\b(note|call|meeting|email|task)\b/i);
          return {
            type: typeMatch?.[1]?.toLowerCase() ?? "note",
            body: match[1]?.trim(),
          };
        },
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
    if (availableActions.some((a) => a.startsWith("digital-ads."))) {
      capabilities.push("pause/resume campaigns, adjust budgets, diagnostics");
    }
    if (availableActions.some((a) => a.startsWith("payments."))) {
      capabilities.push("refunds, charges, invoices, subscriptions, credits, payment links");
    }
    if (availableActions.some((a) => a.startsWith("trading."))) {
      capabilities.push("market/limit orders, position management");
    }
    if (availableActions.some((a) => a.startsWith("crm."))) {
      capabilities.push("contact search, deal management, activity logging, pipeline status");
    }
    const capList = capabilities.length > 0 ? capabilities.join("; ") : "various actions";

    return {
      proposals: [],
      needsClarification: true,
      clarificationQuestion:
        "I didn't quite catch that. Could you rephrase?\n" +
        `I can help with: ${capList}.\n` +
        "Type 'help' to see what I can do.",
      confidence: 0,
      rawResponse: text,
    };
  }
}
