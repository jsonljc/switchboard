// ---------------------------------------------------------------------------
// Naturalness Packet Assembler — builds NaturalnessPacket for LLM generation
// ---------------------------------------------------------------------------

import type {
  PrimaryMove,
  EmotionalSignal,
  NaturalnessPacket,
  VoiceConfig,
  ResponseConstraints,
  VariationControl,
} from "./types.js";

export interface AssemblerParams {
  primaryMove: PrimaryMove;
  approvedContent: string;
  emotionalSignal: EmotionalSignal;
  sessionHistory: Array<{ role: string; text: string }>;
  channel: string;
  leadContext: NaturalnessPacket["leadContext"];
  localisationConfig?: {
    market?: string;
    naturalness?: string;
    emoji?: { allowed?: boolean; maxPerMessage?: number; preferredSet?: string[] };
  };
  forbiddenPhrases?: string[];
  bannedTopics?: string[];
  variationControl?: VariationControl;
}

/** Channel-specific response constraints. */
const CHANNEL_CONSTRAINTS: Record<
  string,
  Pick<ResponseConstraints, "maxSentences" | "maxWords">
> = {
  whatsapp: { maxSentences: 3, maxWords: 60 },
  telegram: { maxSentences: 4, maxWords: 80 },
  instagram_dm: { maxSentences: 2, maxWords: 45 },
  facebook_messenger: { maxSentences: 3, maxWords: 60 },
  sms: { maxSentences: 2, maxWords: 40 },
  web_chat: { maxSentences: 4, maxWords: 80 },
};

export class NaturalnessPacketAssembler {
  assemble(params: AssemblerParams): NaturalnessPacket {
    const move = this.applyEmotionalOverrides(params.primaryMove, params.emotionalSignal);
    const voice = this.buildVoice(params.localisationConfig);
    const constraints = this.buildConstraints(
      params.channel,
      params.forbiddenPhrases,
      params.bannedTopics,
    );
    const variation = params.variationControl ?? {
      openingStyle: "direct" as const,
      recentlyUsedPhrases: [],
      avoidPatterns: [],
    };

    return {
      primaryMove: move,
      approvedContent: params.approvedContent,
      voice,
      constraints,
      leadContext: params.leadContext,
      variation,
    };
  }

  /** Override primaryMove based on emotional signal. */
  applyEmotionalOverrides(move: PrimaryMove, signal: EmotionalSignal): PrimaryMove {
    // Declining engagement -> slow down
    if (signal.engagement === "declining" && move !== "escalate_to_human") {
      return "acknowledge_and_hold";
    }
    // Ready now -> advance to booking
    if (signal.urgencySignal === "ready_now" && move === "ask_qualification_question") {
      return "advance_to_booking";
    }
    // Objection detected -> handle
    if (signal.concernType !== "none" && move === "ask_qualification_question") {
      return "handle_objection";
    }
    return move;
  }

  private buildVoice(config?: AssemblerParams["localisationConfig"]): VoiceConfig {
    return {
      naturalness: (config?.naturalness as VoiceConfig["naturalness"]) ?? "semi_formal",
      market: (config?.market as VoiceConfig["market"]) ?? "generic",
      emojiPolicy: {
        allowed: config?.emoji?.allowed ?? false,
        maxPerMessage: config?.emoji?.maxPerMessage ?? 1,
        preferredSet: config?.emoji?.preferredSet ?? [],
      },
    };
  }

  private buildConstraints(
    channel: string,
    forbiddenPhrases?: string[],
    bannedTopics?: string[],
  ): ResponseConstraints {
    const channelLimits = CHANNEL_CONSTRAINTS[channel] ?? CHANNEL_CONSTRAINTS["web_chat"]!;
    return {
      maxSentences: channelLimits.maxSentences,
      maxWords: channelLimits.maxWords,
      forbiddenPhrases: [
        // Platform defaults
        "I understand your concern",
        "As an AI",
        "I'd be happy to help",
        ...(forbiddenPhrases ?? []),
      ],
      bannedTopics: bannedTopics ?? [],
      singleQuestionOnly: true,
      noEmDashes: true,
    };
  }
}
