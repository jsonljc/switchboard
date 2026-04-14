/** Budget-aware model router for LLM usage tracking. */
export interface ModelRouter {
  shouldUseLLM(orgId?: string): Promise<boolean>;
  recordUsage(
    promptTokens: number,
    completionTokens: number,
    orgId?: string,
    modelId?: string,
  ): Promise<void>;
  getTodayUsage(orgId?: string): Promise<number>;
  getRemainingBudget(orgId?: string): Promise<number>;
  readonly organizationId: string;
}
import { detectPromptInjectionInOutput } from "../interpreter/injection-detector.js";
import { composeWelcomeMessage, composeUncertainReply } from "./reply.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ResponseType =
  | "result_success"
  | "result_failure"
  | "denial"
  | "clarification"
  | "uncertain"
  | "welcome"
  | "error"
  | "read_data"
  | "diagnostic";

export interface ResponseContext {
  type: ResponseType;
  actionType?: string;
  summary?: string;
  explanation?: string;
  denialDetail?: string;
  clarificationQuestion?: string;
  data?: string;
  /** Structured diagnostic result for report generation */
  diagnosticResult?: Record<string, unknown>;
  /** Recommendations from the recommendation engine */
  recommendations?: Record<string, unknown>;
  conversationHistory?: Array<{ role: string; text: string }>;
  userMessage?: string;
  availableActions?: string[];
  errorMessage?: string;
  /** Business name for report headers */
  businessName?: string;
}

export interface GeneratedResponse {
  text: string;
  usedLLM: boolean;
  usage?: { promptTokens: number; completionTokens: number };
}

/** Minimal resolved profile shape used by ResponseGenerator. */
export interface ResponseGeneratorProfile {
  llmContext: {
    persona?: string;
    tone?: string;
    systemPromptExtension?: string;
    bannedTopics: string[];
  };
  systemPromptFragment?: string;
  objectionTrees?: Array<{
    keywords: string[];
    response: string;
    followUp?: string;
  }>;
  profile?: {
    business?: { name?: string };
  };
}

/** Minimal resolved skin shape used by ResponseGenerator. */
export interface ResponseGeneratorSkin {
  language?: {
    replyTemplates?: Record<string, string>;
    welcomeMessage?: string;
  };
  manifest?: { name?: string };
  config?: Record<string, unknown>;
}

export interface ResponseGeneratorConfig {
  llmConfig: {
    apiKey: string;
    model: string;
    maxTokens?: number;
    temperature?: number;
    baseUrl?: string;
  };
  resolvedProfile: ResponseGeneratorProfile | null;
  resolvedSkin: ResponseGeneratorSkin | null;
  modelRouter: ModelRouter | null;
}

// ---------------------------------------------------------------------------
// ResponseGenerator
// ---------------------------------------------------------------------------

export class ResponseGenerator {
  private config: ResponseGeneratorConfig;
  private systemPrompt: string;

  constructor(config: ResponseGeneratorConfig) {
    this.config = config;
    this.systemPrompt = this.buildSystemPrompt();
  }

  /**
   * Main entry point. Checks LLM availability, calls LLM if available,
   * falls back to templates otherwise.
   */
  async generate(
    context: ResponseContext,
    orgId?: string,
    modelOverride?: { model: string; maxTokens?: number; temperature?: number },
  ): Promise<GeneratedResponse> {
    if (!this.isLLMAvailable(orgId)) {
      return this.fallback(context);
    }

    // Check budget via model router
    if (this.config.modelRouter) {
      const canUse = await this.config.modelRouter.shouldUseLLM(orgId);
      if (!canUse) {
        return this.fallback(context);
      }
    }

    try {
      const userPrompt = this.buildUserPrompt(context);
      const result = await this.callLLM(this.systemPrompt, userPrompt, modelOverride);

      // Output injection check
      const injectionCheck = detectPromptInjectionInOutput(result.text);
      if (injectionCheck.detected) {
        console.warn(
          `[ResponseGenerator] Injection detected in LLM output: ${injectionCheck.patterns.join(", ")}`,
        );
        return this.fallback(context);
      }

      // Record usage if model router is available
      if (this.config.modelRouter && result.usage) {
        await this.config.modelRouter.recordUsage(
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
      console.warn("[ResponseGenerator] LLM call failed, using template fallback:", err);
      return this.fallback(context);
    }
  }

  /**
   * Build system prompt from business profile. Cached at construction time.
   * Terminology is NOT included — it's applied after by ResponseHumanizer.
   */
  private buildSystemPrompt(): string {
    const profile = this.config.resolvedProfile;
    const parts: string[] = [];

    parts.push("You are composing short, conversational replies for a business chat assistant.");
    parts.push(
      "Write concise replies (1-3 sentences). Do not mention policy names, risk scores, or internal systems.",
    );

    if (profile) {
      if (profile.llmContext.persona) {
        parts.push(`Persona: ${profile.llmContext.persona}.`);
      }
      if (profile.llmContext.tone) {
        parts.push(`Tone: ${profile.llmContext.tone}.`);
      }
      if (profile.systemPromptFragment) {
        parts.push(profile.systemPromptFragment);
      }
      if (profile.llmContext.systemPromptExtension) {
        parts.push(profile.llmContext.systemPromptExtension);
      }
      if (profile.llmContext.bannedTopics.length > 0) {
        parts.push(`Never discuss these topics: ${profile.llmContext.bannedTopics.join(", ")}.`);
      }
    }

    return parts.join("\n");
  }

  /**
   * Build per-response-type user prompt with structured context.
   */
  private buildUserPrompt(context: ResponseContext): string {
    const parts: string[] = [];

    // Include conversation history for continuity
    if (context.conversationHistory && context.conversationHistory.length > 0) {
      const history = context.conversationHistory
        .slice(-5)
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`)
        .join("\n");
      parts.push(`Recent conversation:\n${history}`);
    }

    switch (context.type) {
      case "result_success":
        parts.push(`The following action was completed successfully.`);
        if (context.actionType) parts.push(`Action: ${context.actionType}`);
        if (context.summary) parts.push(`Result: ${context.summary}`);
        parts.push(`Write a brief confirmation message.`);
        this.addReplyTemplateGuidance(parts, context.actionType);
        break;

      case "result_failure":
        parts.push(`The following action failed.`);
        if (context.actionType) parts.push(`Action: ${context.actionType}`);
        if (context.summary) parts.push(`Error: ${context.summary}`);
        parts.push(`Write a brief, empathetic message explaining the failure.`);
        break;

      case "denial":
        parts.push(`The user's request was denied by the system.`);
        if (context.denialDetail) parts.push(`Reason: ${context.denialDetail}`);
        if (context.explanation) parts.push(`Details: ${context.explanation}`);
        parts.push(
          `Explain why this can't be done in a helpful way. Don't be apologetic — be clear and direct.`,
        );
        this.addObjectionGuidance(parts, context.denialDetail, context.explanation);
        break;

      case "clarification":
        if (context.clarificationQuestion) {
          parts.push(
            `The system needs clarification from the user. The question is: ${context.clarificationQuestion}`,
          );
        }
        parts.push(`Rephrase this as a natural, conversational question.`);
        break;

      case "uncertain":
        parts.push(`The user's message wasn't understood.`);
        if (context.userMessage) parts.push(`Their message: "${context.userMessage}"`);
        if (context.availableActions && context.availableActions.length > 0) {
          parts.push(`Available capabilities: ${context.availableActions.join(", ")}`);
        }
        parts.push(
          `Write a friendly reply asking them to rephrase. Briefly mention what you can help with.`,
        );
        break;

      case "welcome":
        parts.push(`A new user has started a conversation.`);
        if (context.availableActions && context.availableActions.length > 0) {
          parts.push(`Available capabilities: ${context.availableActions.join(", ")}`);
        }
        parts.push(
          `Write a warm, brief welcome message. Mention 1-2 things you can help with. End with an invitation to get started.`,
        );
        break;

      case "diagnostic":
        parts.push(`Diagnostic data was requested and retrieved.`);
        if (context.data) parts.push(`Data:\n${context.data}`);
        parts.push(`Present this data in a clear, readable format. Keep it concise.`);
        break;

      case "read_data":
        parts.push(`Data was requested and retrieved.`);
        if (context.data) parts.push(`Data:\n${context.data}`);
        parts.push(`Summarize this data clearly and concisely.`);
        break;

      case "error":
        if (context.errorMessage) parts.push(`Error: ${context.errorMessage}`);
        parts.push(`Write a brief, helpful error message.`);
        break;
    }

    return parts.join("\n");
  }

  /**
   * Look up matching reply template from skin for guidance.
   */
  private addReplyTemplateGuidance(parts: string[], actionType?: string): void {
    if (!actionType || !this.config.resolvedSkin?.language?.replyTemplates) return;
    const templates = this.config.resolvedSkin.language.replyTemplates;
    const template = templates[actionType];
    if (template) {
      parts.push(`Reference format (adapt naturally, don't copy verbatim): ${template}`);
    }
  }

  /**
   * Match denial keywords against objection trees and include suggested response.
   */
  private addObjectionGuidance(parts: string[], detail?: string, explanation?: string): void {
    const trees = this.config.resolvedProfile?.objectionTrees;
    if (!trees || trees.length === 0) return;

    const text = `${detail ?? ""} ${explanation ?? ""}`.toLowerCase();
    for (const entry of trees) {
      const matched = entry.keywords.some((kw) => text.includes(kw.toLowerCase()));
      if (matched) {
        parts.push(`Suggested approach: ${entry.response}`);
        if (entry.followUp) {
          parts.push(`Follow up with: ${entry.followUp}`);
        }
        return;
      }
    }
  }

  /**
   * Call LLM with system + user prompt. Uses AbortController with 5s timeout.
   * Detects Anthropic vs OpenAI by checking if baseUrl contains "openai".
   */
  private async callLLM(
    system: string,
    user: string,
    modelOverride?: { model: string; maxTokens?: number; temperature?: number },
  ): Promise<{ text: string; usage?: { promptTokens: number; completionTokens: number } }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const baseUrl = this.config.llmConfig.baseUrl ?? "https://api.anthropic.com";
      const isOpenAI = baseUrl.includes("openai");

      if (isOpenAI) {
        return await this.callOpenAI(system, user, controller.signal, modelOverride);
      }
      return await this.callAnthropic(system, user, controller.signal, modelOverride);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async callAnthropic(
    system: string,
    user: string,
    signal: AbortSignal,
    modelOverride?: { model: string; maxTokens?: number; temperature?: number },
  ): Promise<{ text: string; usage?: { promptTokens: number; completionTokens: number } }> {
    const baseUrl = this.config.llmConfig.baseUrl ?? "https://api.anthropic.com";
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.config.llmConfig.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: modelOverride?.model ?? this.config.llmConfig.model,
        max_tokens: modelOverride?.maxTokens ?? this.config.llmConfig.maxTokens ?? 256,
        system,
        messages: [{ role: "user", content: user }],
        temperature: modelOverride?.temperature ?? this.config.llmConfig.temperature ?? 0.4,
      }),
      signal,
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
        ? { promptTokens: data.usage.input_tokens, completionTokens: data.usage.output_tokens }
        : undefined,
    };
  }

  private async callOpenAI(
    system: string,
    user: string,
    signal: AbortSignal,
    modelOverride?: { model: string; maxTokens?: number; temperature?: number },
  ): Promise<{ text: string; usage?: { promptTokens: number; completionTokens: number } }> {
    const baseUrl = this.config.llmConfig.baseUrl ?? "https://api.openai.com";
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.llmConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: modelOverride?.model ?? this.config.llmConfig.model,
        max_tokens: modelOverride?.maxTokens ?? this.config.llmConfig.maxTokens ?? 256,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: modelOverride?.temperature ?? this.config.llmConfig.temperature ?? 0.4,
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };

    const text = data.choices?.[0]?.message?.content ?? "";

    return {
      text,
      usage: data.usage
        ? { promptTokens: data.usage.prompt_tokens, completionTokens: data.usage.completion_tokens }
        : undefined,
    };
  }

  /**
   * Template-based fallback matching current behavior.
   */
  fallback(context: ResponseContext): GeneratedResponse {
    let text: string;

    switch (context.type) {
      case "welcome":
        text = composeWelcomeMessage(
          this.config.resolvedSkin,
          this.config.resolvedProfile?.profile?.business?.name,
          context.availableActions,
        );
        break;

      case "uncertain":
        text = composeUncertainReply(context.availableActions);
        break;

      case "clarification":
        text = context.clarificationQuestion ?? composeUncertainReply(context.availableActions);
        break;

      case "denial": {
        const detail = context.denialDetail ?? context.explanation ?? "that action is not allowed";
        text = `I can't do that \u2014 ${lowercaseFirst(detail)}.`;
        break;
      }

      case "result_success":
        text = `All set! ${context.summary ?? "Action completed."}`;
        break;

      case "result_failure":
        text = `Something went wrong: ${lowercaseFirst(context.summary ?? "the action failed")}.`;
        break;

      case "diagnostic":
        text = context.data ?? "No diagnostic data available.";
        break;

      case "read_data":
        text = context.data ?? "No data available.";
        break;

      case "error":
        text = context.errorMessage
          ? `Error: ${context.errorMessage}`
          : "An unexpected error occurred.";
        break;

      default:
        text = "I'm not sure how to respond to that.";
    }

    return { text, usedLLM: false };
  }

  /**
   * Check whether the LLM is available (API key present).
   * Budget check is done separately in generate().
   */
  private isLLMAvailable(_orgId?: string): boolean {
    return Boolean(this.config.llmConfig.apiKey);
  }
}

function lowercaseFirst(s: string): string {
  if (!s) return s;
  return s[0]!.toLowerCase() + s.slice(1);
}
