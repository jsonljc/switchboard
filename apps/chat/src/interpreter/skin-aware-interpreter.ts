// ---------------------------------------------------------------------------
// SkinAwareInterpreter — dynamically builds system prompt from skin + profile
// ---------------------------------------------------------------------------

import { ClinicInterpreter } from "../clinic/interpreter.js";
import type { LLMConfig } from "./llm-base.js";
import type { ClinicContext } from "../clinic/types.js";
import type { ResolvedSkin, ResolvedProfile } from "@switchboard/core";
import type { ModelRouter } from "../clinic/model-router-types.js";
import { detectPromptInjection } from "./injection-detector.js";

export interface SkinAwareInterpreterOptions {
  skin?: ResolvedSkin | null;
  profile?: ResolvedProfile | null;
  modelRouter?: ModelRouter;
}

/**
 * An interpreter that builds its system prompt dynamically from a skin manifest
 * and business profile, rather than using a hardcoded prompt.
 *
 * System prompt composition order:
 * 1. Skin `interpreterSystemPrompt` (or default classifier prompt if absent)
 * 2. Business context from profile (name, type, services, team, policies, hours)
 * 3. Profile `systemPromptExtension` (appended)
 * 4. Campaign names for grounding
 * 5. Ad account reference
 *
 * Conversation history is appended at prompt-build time (same as ClinicInterpreter).
 */
export class SkinAwareInterpreter extends ClinicInterpreter {
  override readonly name = "skin-aware";
  private resolvedSkin: ResolvedSkin | null;
  private resolvedProfile: ResolvedProfile | null;

  constructor(
    config: LLMConfig,
    clinicContext: ClinicContext,
    options: SkinAwareInterpreterOptions = {},
  ) {
    super(config, clinicContext, options.modelRouter);
    this.resolvedSkin = options.skin ?? null;
    this.resolvedProfile = options.profile ?? null;
  }

  /** Get the resolved profile (for testing/introspection). */
  getResolvedProfile(): ResolvedProfile | null {
    return this.resolvedProfile;
  }

  /** Get the resolved skin (for testing/introspection). */
  getResolvedSkin(): ResolvedSkin | null {
    return this.resolvedSkin;
  }

  protected override buildPrompt(
    text: string,
    conversationContext: Record<string, unknown>,
    _availableActions: string[],
  ): string {
    const systemPrompt = this.composeSystemPrompt();

    // Campaign names for grounding
    const campaignNames = this.clinicContext.campaignNames?.length
      ? this.clinicContext.campaignNames.map((n) => `- ${sanitizeName(n)}`).join("\n")
      : "(no campaigns loaded yet)";

    const system = systemPrompt
      .replace("{CAMPAIGN_NAMES}", campaignNames)
      .replace("{AD_ACCOUNT_ID}", this.clinicContext.adAccountId);

    // Include recent conversation history for multi-turn context
    const recentMessages = conversationContext["recentMessages"] as
      | Array<{ role: string; text: string }>
      | undefined;

    let historyBlock = "";
    if (recentMessages && recentMessages.length > 1) {
      const priorMessages = recentMessages.slice(0, -1);
      if (priorMessages.length > 0) {
        const formatted = priorMessages
          .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`)
          .join("\n");
        historyBlock = `\nRecent conversation (resolve references like "it", "that", "the same campaign" using this):\n${formatted}\n`;
      }
    }

    return `${system}${historyBlock}\n<user_message>\n${text}\n</user_message>`;
  }

  /**
   * Compose the full system prompt from skin language + profile data.
   */
  private composeSystemPrompt(): string {
    const parts: string[] = [];

    // 1. Skin interpreter system prompt (or default)
    const skinPrompt = this.resolvedSkin?.language?.interpreterSystemPrompt;
    parts.push(skinPrompt || DEFAULT_CLASSIFIER_PROMPT);

    // 2. Business context from profile
    if (this.resolvedProfile) {
      // Sanitize profile strings to prevent prompt injection
      const fragment = this.resolvedProfile.systemPromptFragment;
      const check = detectPromptInjection(fragment);
      if (!check.detected) {
        parts.push("");
        parts.push(fragment);
      }
    }

    // 3. Profile system prompt extension
    if (this.resolvedProfile?.llmContext?.systemPromptExtension) {
      const extension = this.resolvedProfile.llmContext.systemPromptExtension;
      const check = detectPromptInjection(extension);
      if (!check.detected) {
        parts.push("");
        parts.push(extension);
      }
    }

    // 4. Persona and tone from profile
    if (this.resolvedProfile?.llmContext?.persona) {
      parts.push(`\nPersona: ${this.resolvedProfile.llmContext.persona}`);
    }
    if (this.resolvedProfile?.llmContext?.tone) {
      parts.push(`Tone: ${this.resolvedProfile.llmContext.tone}`);
    }

    // 5. Banned topics
    if (this.resolvedProfile?.llmContext?.bannedTopics?.length) {
      parts.push(
        `\nNever discuss these topics: ${this.resolvedProfile.llmContext.bannedTopics.join(", ")}`,
      );
    }

    // 6. Available tools from resolved skin
    if (this.resolvedSkin?.tools?.length) {
      parts.push("");
      parts.push("Available tools:");
      for (const tool of this.resolvedSkin.tools) {
        parts.push(`  - ${tool.actionType}: ${tool.definition.name}`);
      }
    }

    return parts.join("\n");
  }
}

/**
 * Default classifier prompt used when no skin `interpreterSystemPrompt` is provided.
 * This mirrors the original ClinicInterpreter system prompt.
 */
const DEFAULT_CLASSIFIER_PROMPT = `You are an operations classifier. Your ONLY job is to classify the user's message into one of these intents and extract relevant parameters.

Important: Your output is a classification that feeds into a governance pipeline. You do not execute actions directly. All write intents are subject to policy evaluation, risk scoring, and approval requirements before any action is taken.

Intents:
- report_performance: user wants to see how campaigns are performing (e.g. "how are my ads doing?", "weekly report")
- more_leads: user wants more leads or wants recommendations to improve lead volume
- reduce_cost: user wants to reduce ad spending or cost per lead
- check_status: user wants to know current campaign status (active/paused/learning)
- pause: user wants to pause a specific campaign
- resume: user wants to resume/unpause a specific campaign
- adjust_budget: user wants to change a campaign's budget (increase, decrease, set to specific amount)
- kill_switch: user wants to stop ALL campaigns immediately (emergency)
- revert: user wants to undo the last action
- diagnose_funnel: user wants a diagnostic analysis of their ad funnel
- diagnose_portfolio: user wants cross-platform portfolio analysis
- fetch_snapshot: user wants raw metrics/snapshot data
- analyze_structure: user wants campaign structure analysis
- unknown: the message is not related to operations

Known campaigns:
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

const MAX_NAME_LENGTH = 80;

/** Sanitize a string before injecting into the LLM system prompt. */
function sanitizeName(name: string): string {
  return name
    .replace(/[\r\n]/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\{[A-Z_]+\}/g, "")
    .slice(0, MAX_NAME_LENGTH)
    .trim();
}
