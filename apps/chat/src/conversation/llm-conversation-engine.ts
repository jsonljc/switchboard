// ---------------------------------------------------------------------------
// LLM Conversation Engine — generates natural responses using Claude Haiku
// ---------------------------------------------------------------------------

import type { ModelRouter } from "../composer/response-generator.js";
import { detectPromptInjectionInOutput } from "../interpreter/injection-detector.js";

export interface BusinessProfile {
  businessName: string;
  personaName: string;
  services?: string;
  hours?: string;
  address?: string;
  bookingMethod?: string;
  faqs?: string;
}

export interface LLMConversationContext {
  stateGoal: string;
  businessProfile: BusinessProfile;
  conversationHistory: Array<{ role: "user" | "assistant"; text: string }>;
  userMessage: string;
  leadProfile?: Record<string, unknown>;
  objectionContext?: string;
}

export interface LLMConversationResult {
  text: string;
  usedLLM: boolean;
  usage?: { promptTokens: number; completionTokens: number };
}

interface EngineConfig {
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  baseUrl?: string;
}

export class LLMConversationEngine {
  private config: EngineConfig;
  private modelRouter: ModelRouter | null;

  constructor(config: EngineConfig, modelRouter?: ModelRouter) {
    this.config = config;
    this.modelRouter = modelRouter ?? null;
  }

  buildSystemPrompt(ctx: LLMConversationContext): string {
    const bp = ctx.businessProfile;
    const parts: string[] = [];

    parts.push(
      `You are ${bp.personaName} at ${bp.businessName}. You're the friendly face`,
      `people first talk to — warm, helpful, and genuinely happy to help.`,
      ``,
      `You talk like a real person at a local clinic, not a chatbot. Short`,
      `sentences. Natural responses. If someone says "hi" you don't launch`,
      `into a pitch — you just say hi back and ask how you can help.`,
    );

    // What you know
    parts.push(``, `## What you know`);
    if (bp.services) parts.push(`- Services: ${bp.services}`);
    if (bp.hours) parts.push(`- Hours: ${bp.hours}`);
    if (bp.address) parts.push(`- Location: ${bp.address}`);
    if (bp.bookingMethod) parts.push(`- Booking: ${bp.bookingMethod}`);
    if (bp.faqs) parts.push(``, bp.faqs);

    // About this person
    parts.push(``, `## About this person`);
    if (ctx.leadProfile && Object.keys(ctx.leadProfile).length > 0) {
      for (const [key, value] of Object.entries(ctx.leadProfile)) {
        if (value !== undefined && value !== null) {
          parts.push(`- ${key}: ${String(value)}`);
        }
      }
    } else {
      parts.push(`This is a new conversation.`);
    }

    // Behavior rules
    parts.push(
      ``,
      `## How to behave`,
      `- Be brief. 1-2 sentences usually. 3 max if they asked something detailed.`,
      `- Match their energy. If they're casual, be casual. If they're formal, adjust.`,
      `- Don't sell. Help. If they're a good fit, the booking happens naturally.`,
      `- Say "let me check with the team" if you're unsure. Never guess.`,
      `- If they mention anything medical (medications, pregnancy, conditions),`,
      `  let them know a provider will follow up personally.`,
      `- Use their name sometimes, not every message.`,
    );

    // Current goal
    parts.push(``, `## Right now`, ctx.stateGoal);

    return parts.join("\n");
  }

  buildUserPrompt(ctx: LLMConversationContext): string {
    const parts: string[] = [];

    // Conversation history (last 10 messages)
    const history = ctx.conversationHistory.slice(-10);
    if (history.length > 0) {
      parts.push(`Conversation so far:`);
      for (const msg of history) {
        const label = msg.role === "user" ? "Them" : "You";
        parts.push(`${label}: ${msg.text}`);
      }
      parts.push(``);
    }

    parts.push(`Their latest message: "${ctx.userMessage}"`);

    if (ctx.objectionContext) {
      parts.push(``, `Context: ${ctx.objectionContext}`);
    }

    parts.push(``, `Respond naturally. Stay focused on: ${ctx.stateGoal}`);

    return parts.join("\n");
  }

  async generate(ctx: LLMConversationContext, orgId?: string): Promise<LLMConversationResult> {
    if (!this.config.apiKey) {
      return this.fallback(ctx);
    }

    // Check budget
    if (this.modelRouter) {
      const canUse = await this.modelRouter.shouldUseLLM(orgId);
      if (!canUse) {
        return this.fallback(ctx);
      }
    }

    try {
      const systemPrompt = this.buildSystemPrompt(ctx);
      const userPrompt = this.buildUserPrompt(ctx);
      const result = await this.callAnthropic(systemPrompt, userPrompt);

      // Output injection check
      const injectionCheck = detectPromptInjectionInOutput(result.text);
      if (injectionCheck.detected) {
        console.warn(
          `[LLMConversationEngine] Injection detected in output: ${injectionCheck.patterns.join(", ")}`,
        );
        return this.fallback(ctx);
      }

      // Record usage
      if (this.modelRouter && result.usage) {
        await this.modelRouter.recordUsage(
          result.usage.promptTokens,
          result.usage.completionTokens,
          orgId,
        );
      }

      return {
        text: result.text,
        usedLLM: true,
        usage: result.usage,
      };
    } catch (err) {
      console.warn("[LLMConversationEngine] LLM call failed, using fallback:", err);
      return this.fallback(ctx);
    }
  }

  private async callAnthropic(
    system: string,
    user: string,
  ): Promise<{ text: string; usage?: { promptTokens: number; completionTokens: number } }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const baseUrl = this.config.baseUrl ?? "https://api.anthropic.com";
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.config.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: this.config.maxTokens ?? 200,
          system,
          messages: [{ role: "user", content: user }],
          temperature: this.config.temperature ?? 0.6,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
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
          ? {
              promptTokens: data.usage.input_tokens,
              completionTokens: data.usage.output_tokens,
            }
          : undefined,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private fallback(ctx: LLMConversationContext): LLMConversationResult {
    const name = ctx.businessProfile.personaName;
    const biz = ctx.businessProfile.businessName;
    return {
      text: `Hi! This is ${name} from ${biz}. How can I help you today?`,
      usedLLM: false,
    };
  }
}
