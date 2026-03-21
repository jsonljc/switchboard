import type {
  BusinessProfile,
  JourneyDef,
  ScoringConfig,
  ObjectionTreeEntry,
  CadenceTemplateDef,
  ComplianceConfig,
  LLMContext,
  LocalisationConfig,
  BookingConfig,
  EscalationConfig,
  LearningConfig,
  ConversationConfig,
  AgentPersona,
} from "@switchboard/schemas";

/** Resolved profile ready for consumption by cartridges and interpreters. */
export interface ResolvedProfile {
  /** The original business profile. */
  profile: BusinessProfile;
  /** Journey schema resolved from profile. */
  journey: JourneyDef;
  /** Scoring configuration with defaults applied. */
  scoring: Required<ScoringConfig>;
  /** Objection trees (empty array if not defined). */
  objectionTrees: ObjectionTreeEntry[];
  /** Cadence templates (empty array if not defined). */
  cadenceTemplates: CadenceTemplateDef[];
  /** Compliance flags with defaults applied. */
  compliance: Required<ComplianceConfig>;
  /** LLM context configuration. */
  llmContext: Required<LLMContext>;
  /** Composite system prompt fragment built from profile data. */
  systemPromptFragment: string;
  /** Localisation configuration with defaults applied. */
  localisation: Required<LocalisationConfig>;
  /** Booking configuration with defaults applied. */
  booking: Required<BookingConfig>;
  /** Escalation configuration (null if not set). */
  escalationConfig: EscalationConfig | null;
  /** Learning preferences with defaults applied. */
  learningPreferences: Required<LearningConfig>;
  /** Conversation configuration with defaults applied. */
  conversationConfig: Required<ConversationConfig>;
  /** Agent persona (null if not set). */
  persona: AgentPersona | null;
}

/** Default scoring constants (matching the original customer-engagement hardcoded values). */
const DEFAULT_SCORING: Required<ScoringConfig> = {
  referralValue: 200,
  noShowCost: 75,
  retentionDecayRate: 0.85,
  projectionYears: 5,
  leadScoreWeights: {
    serviceValue: 20,
    urgency: 15,
    eventDriven: 10,
    budget: 10,
    engagement: 15,
    responseSpeed: 10,
    source: 8,
    returning: 7,
  },
};

/** Default compliance flags — all disabled. */
const DEFAULT_COMPLIANCE: Required<ComplianceConfig> = {
  enableHipaaRedactor: false,
  enableMedicalClaimFilter: false,
  enableConsentGate: false,
};

/** Default LLM context — empty. */
const DEFAULT_LLM_CONTEXT: Required<LLMContext> = {
  systemPromptExtension: "",
  persona: "",
  tone: "",
  bannedTopics: [],
};

/** Default localisation — generic market, English only. */
const DEFAULT_LOCALISATION: Required<LocalisationConfig> = {
  market: "generic",
  languages: ["en"],
  naturalness: "semi_formal",
  tone: "warm and professional",
  emoji: { allowed: false, maxPerMessage: 1, preferredSet: [] },
};

/** Default booking config. */
const DEFAULT_BOOKING: Required<BookingConfig> = {
  bookingUrl: "",
  bookingPhone: "",
  requireDeposit: false,
  depositAmount: 0,
  cancellationWindowHours: 24,
  maxAdvanceBookingDays: 90,
};

/** Default learning preferences. */
const DEFAULT_LEARNING: Required<LearningConfig> = {
  enableAutoOptimisation: false,
  optimisationFrequency: "weekly",
  autoApplyTimingChanges: true,
  requireOwnerApprovalForContent: true,
  minSampleSize: 30,
};

/** Default conversation config. */
const DEFAULT_CONVERSATION: Required<ConversationConfig> = {
  flowMode: "hybrid",
  qualificationSignals: [],
  maxTurnsBeforeEscalation: 15,
  silenceTimeoutMinutes: 30,
  reactivationWindowHours: 72,
};

/**
 * Resolves a BusinessProfile into a configuration object usable by cartridges and interpreters.
 *
 * - Applies default values for optional fields
 * - Builds a composite system prompt fragment from profile data
 *
 * Usage:
 *   const resolver = new ProfileResolver();
 *   const resolved = resolver.resolve(profile);
 */
export class ProfileResolver {
  /**
   * Resolve a business profile into a fully usable configuration.
   */
  resolve(profile: BusinessProfile): ResolvedProfile {
    const scoring = this.resolveScoring(profile.scoring);
    const compliance = this.resolveCompliance(profile.compliance);
    const llmContext = this.resolveLLMContext(profile.llmContext);
    const systemPromptFragment = this.buildSystemPromptFragment(profile);

    const localisation = this.resolveLocalisation(profile.localisation);
    const booking = this.resolveBooking(profile.booking);
    const learningPreferences = this.resolveLearning(profile.learningPreferences);
    const conversationConfig = this.resolveConversation(profile.conversationConfig);

    return {
      profile,
      journey: profile.journey,
      scoring,
      objectionTrees: profile.objectionTrees ?? [],
      cadenceTemplates: profile.cadenceTemplates ?? [],
      compliance,
      llmContext,
      systemPromptFragment,
      localisation,
      booking,
      escalationConfig: profile.escalationConfig ?? null,
      learningPreferences,
      conversationConfig,
      persona: profile.persona ?? null,
    };
  }

  private resolveLocalisation(config?: LocalisationConfig): Required<LocalisationConfig> {
    if (!config) return { ...DEFAULT_LOCALISATION };
    return {
      market: config.market ?? DEFAULT_LOCALISATION.market,
      languages: config.languages ?? DEFAULT_LOCALISATION.languages,
      naturalness: config.naturalness ?? DEFAULT_LOCALISATION.naturalness,
      tone: config.tone ?? DEFAULT_LOCALISATION.tone,
      emoji: config.emoji
        ? {
            allowed: config.emoji.allowed ?? DEFAULT_LOCALISATION.emoji.allowed,
            maxPerMessage: config.emoji.maxPerMessage ?? DEFAULT_LOCALISATION.emoji.maxPerMessage,
            preferredSet: config.emoji.preferredSet ?? DEFAULT_LOCALISATION.emoji.preferredSet,
          }
        : { ...DEFAULT_LOCALISATION.emoji },
    };
  }

  private resolveBooking(config?: BookingConfig): Required<BookingConfig> {
    if (!config) return { ...DEFAULT_BOOKING };
    return {
      bookingUrl: config.bookingUrl ?? DEFAULT_BOOKING.bookingUrl,
      bookingPhone: config.bookingPhone ?? DEFAULT_BOOKING.bookingPhone,
      requireDeposit: config.requireDeposit ?? DEFAULT_BOOKING.requireDeposit,
      depositAmount: config.depositAmount ?? DEFAULT_BOOKING.depositAmount,
      cancellationWindowHours:
        config.cancellationWindowHours ?? DEFAULT_BOOKING.cancellationWindowHours,
      maxAdvanceBookingDays: config.maxAdvanceBookingDays ?? DEFAULT_BOOKING.maxAdvanceBookingDays,
    };
  }

  private resolveLearning(config?: LearningConfig): Required<LearningConfig> {
    if (!config) return { ...DEFAULT_LEARNING };
    return {
      enableAutoOptimisation:
        config.enableAutoOptimisation ?? DEFAULT_LEARNING.enableAutoOptimisation,
      optimisationFrequency: config.optimisationFrequency ?? DEFAULT_LEARNING.optimisationFrequency,
      autoApplyTimingChanges:
        config.autoApplyTimingChanges ?? DEFAULT_LEARNING.autoApplyTimingChanges,
      requireOwnerApprovalForContent:
        config.requireOwnerApprovalForContent ?? DEFAULT_LEARNING.requireOwnerApprovalForContent,
      minSampleSize: config.minSampleSize ?? DEFAULT_LEARNING.minSampleSize,
    };
  }

  private resolveConversation(config?: ConversationConfig): Required<ConversationConfig> {
    if (!config) return { ...DEFAULT_CONVERSATION };
    return {
      flowMode: config.flowMode ?? DEFAULT_CONVERSATION.flowMode,
      qualificationSignals:
        config.qualificationSignals ?? DEFAULT_CONVERSATION.qualificationSignals,
      maxTurnsBeforeEscalation:
        config.maxTurnsBeforeEscalation ?? DEFAULT_CONVERSATION.maxTurnsBeforeEscalation,
      silenceTimeoutMinutes:
        config.silenceTimeoutMinutes ?? DEFAULT_CONVERSATION.silenceTimeoutMinutes,
      reactivationWindowHours:
        config.reactivationWindowHours ?? DEFAULT_CONVERSATION.reactivationWindowHours,
    };
  }

  private resolveScoring(scoring?: ScoringConfig): Required<ScoringConfig> {
    if (!scoring) return { ...DEFAULT_SCORING };
    return {
      referralValue: scoring.referralValue ?? DEFAULT_SCORING.referralValue,
      noShowCost: scoring.noShowCost ?? DEFAULT_SCORING.noShowCost,
      retentionDecayRate: scoring.retentionDecayRate ?? DEFAULT_SCORING.retentionDecayRate,
      projectionYears: scoring.projectionYears ?? DEFAULT_SCORING.projectionYears,
      leadScoreWeights: scoring.leadScoreWeights
        ? { ...DEFAULT_SCORING.leadScoreWeights, ...scoring.leadScoreWeights }
        : { ...DEFAULT_SCORING.leadScoreWeights },
    };
  }

  private resolveCompliance(compliance?: ComplianceConfig): Required<ComplianceConfig> {
    if (!compliance) return { ...DEFAULT_COMPLIANCE };
    return {
      enableHipaaRedactor: compliance.enableHipaaRedactor ?? DEFAULT_COMPLIANCE.enableHipaaRedactor,
      enableMedicalClaimFilter:
        compliance.enableMedicalClaimFilter ?? DEFAULT_COMPLIANCE.enableMedicalClaimFilter,
      enableConsentGate: compliance.enableConsentGate ?? DEFAULT_COMPLIANCE.enableConsentGate,
    };
  }

  private resolveLLMContext(llmContext?: LLMContext): Required<LLMContext> {
    if (!llmContext) return { ...DEFAULT_LLM_CONTEXT };
    return {
      systemPromptExtension:
        llmContext.systemPromptExtension ?? DEFAULT_LLM_CONTEXT.systemPromptExtension,
      persona: llmContext.persona ?? DEFAULT_LLM_CONTEXT.persona,
      tone: llmContext.tone ?? DEFAULT_LLM_CONTEXT.tone,
      bannedTopics: llmContext.bannedTopics ?? DEFAULT_LLM_CONTEXT.bannedTopics,
    };
  }

  private buildSystemPromptFragment(profile: BusinessProfile): string {
    const lines: string[] = [];

    lines.push("--- Business Context ---");
    lines.push(`Business: ${profile.business.name}`);
    lines.push(`Type: ${profile.business.type}`);
    if (profile.business.tagline) {
      lines.push(`Tagline: ${profile.business.tagline}`);
    }

    // Services
    if (profile.services.catalog.length > 0) {
      lines.push("");
      lines.push("Services:");
      for (const svc of profile.services.catalog) {
        const parts = [`  - ${svc.name} (${svc.category})`];
        if (svc.typicalValue != null) parts.push(`$${svc.typicalValue}`);
        if (svc.durationMinutes != null) parts.push(`${svc.durationMinutes}min`);
        lines.push(parts.join(" | "));
      }
    }

    // Team
    if (profile.team && profile.team.length > 0) {
      lines.push("");
      lines.push("Team:");
      for (const member of profile.team) {
        const specialties =
          member.specialties && member.specialties.length > 0
            ? ` — ${member.specialties.join(", ")}`
            : "";
        lines.push(`  - ${member.name}, ${member.role}${specialties}`);
      }
    }

    // Policies
    if (profile.policies && profile.policies.length > 0) {
      lines.push("");
      lines.push("Policies:");
      for (const policy of profile.policies) {
        lines.push(`  - ${policy.topic}: ${policy.content}`);
      }
    }

    // Hours
    if (profile.hours && Object.keys(profile.hours).length > 0) {
      lines.push("");
      lines.push("Hours:");
      for (const [day, entry] of Object.entries(profile.hours)) {
        lines.push(`  - ${day}: ${entry.open} - ${entry.close}`);
      }
    }

    return lines.join("\n");
  }
}
