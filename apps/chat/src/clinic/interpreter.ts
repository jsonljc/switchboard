import { randomUUID } from "node:crypto";
import { LLMInterpreter } from "../interpreter/llm-base.js";
import type { LLMConfig, LLMResponse } from "../interpreter/llm-base.js";
import type { InterpreterResult } from "../interpreter/interpreter.js";
import {
  AllowedIntent,
  READ_INTENTS,
  WRITE_INTENTS,
} from "./types.js";
import type {
  ClassifyResult,
  ClinicContext,
  ReadIntentDescriptor,
} from "./types.js";
import type { ModelRouter } from "./model-router.js";

/** Maps write intents to cartridge action types. */
const INTENT_TO_ACTION: Record<string, string> = {
  [AllowedIntent.PAUSE]: "ads.campaign.pause",
  [AllowedIntent.RESUME]: "ads.campaign.resume",
  [AllowedIntent.ADJUST_BUDGET]: "ads.budget.adjust",
};

/** All valid intent values for validation. */
const VALID_INTENTS = new Set(Object.values(AllowedIntent));

/** Regex fallback patterns (subset of RuleBasedInterpreter). */
const FALLBACK_PATTERNS: Array<{
  regex: RegExp;
  intent: AllowedIntent;
  extractSlots: (match: RegExpMatchArray) => Record<string, unknown>;
}> = [
  {
    regex: /pause\s+(?:campaign\s+)?['"]?(.+?)['"]?\s*$/i,
    intent: AllowedIntent.PAUSE,
    extractSlots: (m) => ({ campaignRef: m[1]?.trim() }),
  },
  {
    regex: /resume\s+(?:campaign\s+)?['"]?(.+?)['"]?\s*$/i,
    intent: AllowedIntent.RESUME,
    extractSlots: (m) => ({ campaignRef: m[1]?.trim() }),
  },
  {
    regex: /(?:set|change|adjust)\s+(?:the\s+)?budget\s+(?:for\s+)?['"]?(.+?)['"]?\s+(?:to\s+)?\$?(\d+(?:\.\d+)?)/i,
    intent: AllowedIntent.ADJUST_BUDGET,
    extractSlots: (m) => ({ campaignRef: m[1]?.trim(), newBudget: parseFloat(m[2] ?? "0") }),
  },
  {
    regex: /how\s+(?:are|is)\s+(?:my\s+)?(?:campaigns?|ads?|performance)/i,
    intent: AllowedIntent.REPORT_PERFORMANCE,
    extractSlots: () => ({}),
  },
  {
    regex: /(?:status|check)\s+(?:of\s+)?(?:my\s+)?(?:campaigns?|ads?)/i,
    intent: AllowedIntent.CHECK_STATUS,
    extractSlots: () => ({}),
  },
  {
    regex: /more\s+(?:patient\s+)?leads/i,
    intent: AllowedIntent.MORE_LEADS,
    extractSlots: () => ({}),
  },
  {
    regex: /(?:reduce|lower|cut)\s+(?:my\s+)?(?:ad\s+)?(?:cost|spend|cpl)/i,
    intent: AllowedIntent.REDUCE_COST,
    extractSlots: () => ({}),
  },
  {
    regex: /^undo$/i,
    intent: AllowedIntent.REVERT,
    extractSlots: () => ({}),
  },
];

const SYSTEM_PROMPT = `You are a clinic ad operations classifier. Your ONLY job is to classify the user's message into one of these intents and extract relevant parameters.

Intents:
- report_performance: user wants to see how campaigns are performing (e.g. "how are my ads doing?", "weekly report")
- more_leads: user wants more patient leads or wants recommendations to improve lead volume
- reduce_cost: user wants to reduce ad spending or cost per lead
- check_status: user wants to know current campaign status (active/paused/learning)
- pause: user wants to pause a specific campaign
- resume: user wants to resume/unpause a specific campaign
- adjust_budget: user wants to change a campaign's budget (increase, decrease, set to specific amount)
- kill_switch: user wants to stop ALL campaigns immediately (emergency)
- revert: user wants to undo the last action
- unknown: the message is not related to ad management

Known campaigns for this clinic:
{CAMPAIGN_NAMES}

Ad account: {AD_ACCOUNT_ID}

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "intent": "<one of the intent values above>",
  "confidence": <0.0 to 1.0>,
  "slots": { "campaignRef": "...", "period": "...", "budgetAmount": ... },
  "reasoning": "<brief explanation>"
}

Rules:
- Only use intents from the list above
- Extract campaign names, budget amounts, and time periods into slots
- If the user mentions a specific campaign, put it in slots.campaignRef
- If the user mentions a budget amount, put it in slots.budgetAmount
- If you are unsure, set confidence below 0.5`;

export class ClinicInterpreter extends LLMInterpreter {
  readonly name = "clinic-haiku";
  private clinicContext: ClinicContext;
  private modelRouter: ModelRouter | null;

  constructor(
    config: LLMConfig,
    clinicContext: ClinicContext,
    modelRouter?: ModelRouter,
  ) {
    super({
      ...config,
      model: config.model || "claude-3-5-haiku-20241022",
      maxTokens: config.maxTokens ?? 512,
      temperature: 0.0,
    });
    this.clinicContext = clinicContext;
    this.modelRouter = modelRouter ?? null;
  }

  /** Update campaign names for LLM grounding. Called by runtime on refresh. */
  updateCampaignNames(names: string[]): void {
    this.clinicContext.campaignNames = names;
  }

  async interpret(
    text: string,
    conversationContext: Record<string, unknown>,
    availableActions: string[],
  ): Promise<InterpreterResult> {
    // Check model budget — fall back to regex if exceeded
    if (this.modelRouter && !this.modelRouter.shouldUseLLM()) {
      return this.fallbackInterpret(text, availableActions);
    }

    // Delegate to LLMInterpreter.interpret() which handles:
    // 1. Injection detection on input
    // 2. callLLM()
    // 3. Injection detection on output
    // 4. parseStructuredOutput()
    // 5. Schema guard
    // 6. Proposal tagging
    const result = await super.interpret(text, conversationContext, availableActions);

    // Record usage if model router is available
    if (this.modelRouter && result.rawResponse) {
      // Estimate tokens: ~4 chars per token for input, actual from response
      const estimatedInputTokens = Math.ceil(text.length / 4) + 200; // +200 for system prompt
      const estimatedOutputTokens = Math.ceil(result.rawResponse.length / 4);
      this.modelRouter.recordUsage(estimatedInputTokens, estimatedOutputTokens);
    }

    return result;
  }

  protected async callLLM(prompt: string): Promise<LLMResponse> {
    const response = await fetch(`${this.config.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: this.config.maxTokens ?? 512,
        messages: [{ role: "user", content: prompt }],
        temperature: this.config.temperature ?? 0.0,
      }),
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    };

    const text = data.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");

    return {
      text,
      usage: data.usage
        ? { promptTokens: data.usage.input_tokens, completionTokens: data.usage.output_tokens }
        : undefined,
    };
  }

  protected buildPrompt(
    text: string,
    _conversationContext: Record<string, unknown>,
    _availableActions: string[],
  ): string {
    const campaignNames = this.clinicContext.campaignNames?.length
      ? this.clinicContext.campaignNames.map((n) => `- ${n}`).join("\n")
      : "(no campaigns loaded yet)";

    const system = SYSTEM_PROMPT
      .replace("{CAMPAIGN_NAMES}", campaignNames)
      .replace("{AD_ACCOUNT_ID}", this.clinicContext.adAccountId);

    // Structural separation: user text in a clearly delimited block
    return `${system}\n\n<user_message>\n${text}\n</user_message>`;
  }

  protected parseStructuredOutput(
    rawText: string,
    availableActions: string[],
  ): unknown {
    // Extract JSON from response
    const jsonMatch = rawText.match(/```json\s*([\s\S]*?)```/) ??
      rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in LLM output");
    }
    const jsonStr = jsonMatch[1] ?? jsonMatch[0];
    const classify = JSON.parse(jsonStr) as ClassifyResult;

    // Validate intent is in our enum
    const intent = VALID_INTENTS.has(classify.intent as AllowedIntent)
      ? (classify.intent as AllowedIntent)
      : AllowedIntent.UNKNOWN;

    const confidence = typeof classify.confidence === "number" ? classify.confidence : 0;
    const slots = classify.slots && typeof classify.slots === "object" ? classify.slots : {};

    return this.mapClassifyToInterpreterOutput(intent, confidence, slots, availableActions);
  }

  private mapClassifyToInterpreterOutput(
    intent: AllowedIntent,
    confidence: number,
    slots: Record<string, unknown>,
    availableActions: string[],
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
          "- Getting more leads\n\n" +
          "What would you like to do?",
        confidence,
      };
    }

    // Read intents → readIntent descriptor, no proposals
    if (READ_INTENTS.has(intent)) {
      const readIntent: ReadIntentDescriptor = { intent, slots, confidence };
      return {
        proposals: [],
        needsClarification: false,
        clarificationQuestion: null,
        confidence,
        readIntent,
      };
    }

    // REVERT → system.undo
    if (intent === AllowedIntent.REVERT) {
      return {
        proposals: [{
          id: `prop_${randomUUID()}`,
          actionType: "system.undo",
          parameters: {},
          evidence: "User requested undo/revert",
          confidence,
          originatingMessageId: "",
        }],
        needsClarification: false,
        clarificationQuestion: null,
        confidence,
      };
    }

    // KILL_SWITCH → system.kill_switch
    if (intent === AllowedIntent.KILL_SWITCH) {
      return {
        proposals: [{
          id: `prop_${randomUUID()}`,
          actionType: "system.kill_switch",
          parameters: {},
          evidence: "Emergency kill switch requested",
          confidence,
          originatingMessageId: "",
        }],
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
        proposals: [{
          id: `prop_${randomUUID()}`,
          actionType,
          parameters,
          evidence: `Clinic intent: ${intent}`,
          confidence,
          originatingMessageId: "",
        }],
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

  /** Regex-based fallback when LLM budget is exceeded. */
  private fallbackInterpret(
    text: string,
    availableActions: string[],
  ): InterpreterResult {
    for (const pattern of FALLBACK_PATTERNS) {
      const match = text.match(pattern.regex);
      if (match) {
        const slots = pattern.extractSlots(match);
        const output = this.mapClassifyToInterpreterOutput(
          pattern.intent,
          0.7,
          slots,
          availableActions,
        );
        return {
          ...(output as InterpreterResult),
          rawResponse: `[FALLBACK_REGEX] ${text}`,
        };
      }
    }

    return {
      proposals: [],
      needsClarification: true,
      clarificationQuestion:
        "I'm running in limited mode right now. Please try a specific command like:\n" +
        "- \"pause [campaign name]\"\n" +
        "- \"set budget for [campaign] to $[amount]\"\n" +
        "- \"how are my campaigns doing?\"",
      confidence: 0,
      rawResponse: `[FALLBACK_NO_MATCH] ${text}`,
    };
  }
}
