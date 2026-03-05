import type {
  BusinessProfile,
  JourneyDef,
  ScoringConfig,
  ObjectionTreeEntry,
  CadenceTemplateDef,
  ComplianceConfig,
  LLMContext,
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

    return {
      profile,
      journey: profile.journey,
      scoring,
      objectionTrees: profile.objectionTrees ?? [],
      cadenceTemplates: profile.cadenceTemplates ?? [],
      compliance,
      llmContext,
      systemPromptFragment,
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
