// ---------------------------------------------------------------------------
// Dialogue Middleware — composes all new AI agent system modules
// ---------------------------------------------------------------------------

import {
  classifyEmotionalSignal,
  NaturalnessPacketAssembler,
  PostGenerationValidator,
  VariationPool,
  detectLanguage,
} from "@switchboard/core";
import type { EmotionalSignal, PrimaryMove, NaturalnessPacket } from "@switchboard/core";
import type { ConversationStateData } from "../conversation/state.js";

/** Minimal profile shape needed by DialogueMiddleware. */
interface DialogueProfile {
  profile?: {
    llmContext?: { bannedTopics?: string[] };
  };
  llmContext: { bannedTopics: string[] };
  localisation?: {
    market: string;
    naturalness: string;
    emoji: {
      allowed?: boolean;
      maxPerMessage?: number;
      preferredSet?: string[];
    };
  };
}

export interface DialogueMiddlewareConfig {
  resolvedProfile: DialogueProfile | null;
}

export interface BeforeInterpretResult {
  emotionalSignal: EmotionalSignal;
  detectedLanguage: string;
  machineState: string | null;
}

export interface AfterGenerateResult {
  text: string;
  blocked: boolean;
  primaryMove: PrimaryMove;
}

export class DialogueMiddleware {
  private assembler = new NaturalnessPacketAssembler();
  private validator: PostGenerationValidator;
  private variationPool = new VariationPool();
  private config: DialogueMiddlewareConfig;

  constructor(config: DialogueMiddlewareConfig) {
    this.config = config;
    const profile = config.resolvedProfile?.profile;
    this.validator = new PostGenerationValidator({
      forbiddenPhrases: profile?.llmContext?.bannedTopics,
      bannedTopics: profile?.llmContext?.bannedTopics,
    });
  }

  /** Pre-interpret: classify emotional signal, detect language, check handoff. */
  beforeInterpret(message: string, conversation: ConversationStateData): BeforeInterpretResult {
    const recentMessages = conversation.messages.slice(-5).map((m) => ({
      role: m.role,
      text: m.text,
    }));

    const emotionalSignal = classifyEmotionalSignal({
      message,
      recentMessages,
      channel: conversation.channel,
    });

    const langResult = detectLanguage(message);

    return {
      emotionalSignal,
      detectedLanguage: langResult.detected,
      machineState: conversation.machineState,
    };
  }

  /** Build a naturalness packet for LLM response generation. */
  buildNaturalnessPacket(
    primaryMove: PrimaryMove,
    approvedContent: string,
    emotionalSignal: EmotionalSignal,
    conversation: ConversationStateData,
  ): NaturalnessPacket {
    const sessionId = conversation.id;
    const variation = this.variationPool.getVariationControl(sessionId, primaryMove);
    const profile = this.config.resolvedProfile;

    return this.assembler.assemble({
      primaryMove,
      approvedContent,
      emotionalSignal,
      sessionHistory: conversation.messages.map((m) => ({
        role: m.role,
        text: m.text,
      })),
      channel: conversation.channel,
      leadContext: {
        serviceInterest:
          (conversation.leadProfile?.serviceInterest as string | undefined) ?? undefined,
        previousTurnCount: conversation.messages.filter((m) => m.role === "user").length,
      },
      localisationConfig: profile?.localisation
        ? {
            market: profile.localisation.market,
            naturalness: profile.localisation.naturalness,
            emoji: profile.localisation.emoji,
          }
        : undefined,
      forbiddenPhrases: profile?.llmContext.bannedTopics,
      bannedTopics: profile?.llmContext.bannedTopics,
      variationControl: variation,
    });
  }

  /** Post-generation: validate, record outcome, record variation. */
  afterGenerate(
    text: string,
    primaryMove: PrimaryMove,
    sessionId: string,
    maxWords?: number,
  ): AfterGenerateResult {
    const validation = this.validator.validate(text, primaryMove, maxWords);

    // Record used phrases for variation tracking
    const firstWords = text.split(/[.!?]/)[0]?.trim();
    if (firstWords) {
      this.variationPool.recordUsed(sessionId, [firstWords]);
    }

    if (!validation.valid && validation.fallbackMessage) {
      return {
        text: validation.fallbackMessage,
        blocked: true,
        primaryMove,
      };
    }

    return {
      text,
      blocked: false,
      primaryMove,
    };
  }

  /** Clean up variation pool for a completed session. */
  clearSession(sessionId: string): void {
    this.variationPool.clearSession(sessionId);
  }
}
