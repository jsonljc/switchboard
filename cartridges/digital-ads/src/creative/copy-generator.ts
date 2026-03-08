// ---------------------------------------------------------------------------
// Ad Copy Generator — LLM-powered ad copy from business profile + campaign context
// ---------------------------------------------------------------------------
// Generates complete ad copy packages: headlines, primary text options,
// CTA recommendations, and format suggestions. Uses the business profile
// for tone/persona and the campaign context for targeting.
//
// Pattern: LLM function is dependency-injected (same as CreativeVariantGenerator).
// Compliance filtering is applied post-generation.
// ---------------------------------------------------------------------------

/** Meta Ads character limits */
const CHAR_LIMITS = {
  headline: 40,
  primaryText: 125,
  description: 30,
  cta: 20,
};

/** Standard Meta Ads CTA options */
const META_CTA_OPTIONS = [
  "Book Now",
  "Learn More",
  "Sign Up",
  "Get Offer",
  "Shop Now",
  "Contact Us",
  "Get Quote",
  "Subscribe",
  "Apply Now",
  "Download",
] as const;

/** Ad format recommendations */
const AD_FORMATS = ["single_image", "carousel", "stories", "reels", "video"] as const;

// ── Types ───────────────────────────────────────────────────────────────────

export type MetaCTA = (typeof META_CTA_OPTIONS)[number];
export type AdFormat = (typeof AD_FORMATS)[number];

export interface BusinessContext {
  businessName: string;
  businessType: string;
  services?: Array<{ name: string; typicalValue?: number }>;
  tone?: string;
  persona?: string;
  bannedTopics?: string[];
  location?: string;
}

export interface CampaignContext {
  objective: "awareness" | "traffic" | "leads" | "conversions" | "engagement";
  targetAudience: string;
  servicePromoted: string;
  budget?: number;
  platform?: string;
}

export interface AdCopyPackage {
  id: string;
  headlines: HeadlineOption[];
  primaryTexts: PrimaryTextOption[];
  ctaRecommendation: MetaCTA;
  formatRecommendation: AdFormat;
  formatReason: string;
  complianceNotes: string[];
}

export interface HeadlineOption {
  text: string;
  withinLimit: boolean;
  charCount: number;
}

export interface PrimaryTextOption {
  text: string;
  withinLimit: boolean;
  charCount: number;
}

export interface CopyGeneratorConfig {
  generateFn: (prompt: string) => Promise<string>;
}

// ── Compliance blocklist ────────────────────────────────────────────────────

const COMPLIANCE_BLOCKLIST = [
  { pattern: /guarantee[sd]?\s+results?/i, reason: "Cannot guarantee results" },
  { pattern: /cure[sd]?\s/i, reason: "Cannot claim to cure conditions" },
  { pattern: /100%\s+(?:safe|effective|success)/i, reason: "Cannot claim 100% efficacy" },
  { pattern: /no\s+(?:risk|side\s+effects?)/i, reason: "Cannot claim zero risk" },
  {
    pattern: /(?:best|#1|number\s+one)\s+(?:in|doctor|clinic|store)/i,
    reason: "Superlative claims require substantiation",
  },
  {
    pattern: /before\s+and\s+after/i,
    reason: "Before/after imagery may violate platform policies",
  },
  { pattern: /\bfree\b.*\bno\s+(?:catch|strings)/i, reason: "Misleading free claims" },
  { pattern: /limited\s+time.*(?:act|hurry|last)/i, reason: "False urgency may violate policies" },
];

// ── Generator ───────────────────────────────────────────────────────────────

export class AdCopyGenerator {
  private generateFn: (prompt: string) => Promise<string>;

  constructor(config: CopyGeneratorConfig) {
    this.generateFn = config.generateFn;
  }

  /**
   * Generate a complete ad copy package for a campaign.
   */
  async generate(business: BusinessContext, campaign: CampaignContext): Promise<AdCopyPackage> {
    const prompt = this.buildPrompt(business, campaign);

    let headlines: HeadlineOption[];
    let primaryTexts: PrimaryTextOption[];
    let ctaRecommendation: MetaCTA;
    let formatRecommendation: AdFormat;
    let formatReason: string;
    const complianceNotes: string[] = [];

    try {
      const raw = await this.generateFn(prompt);
      const parsed = this.parseResponse(raw);

      headlines = parsed.headlines.map((h) => ({
        text: h,
        withinLimit: h.length <= CHAR_LIMITS.headline,
        charCount: h.length,
      }));

      primaryTexts = parsed.primaryTexts.map((t) => ({
        text: t,
        withinLimit: t.length <= CHAR_LIMITS.primaryText,
        charCount: t.length,
      }));

      ctaRecommendation = this.validateCTA(parsed.cta);
      formatRecommendation = this.validateFormat(parsed.format);
      formatReason =
        parsed.formatReason || this.defaultFormatReason(formatRecommendation, campaign);

      // Run compliance checks on all generated text
      const allText = [...headlines.map((h) => h.text), ...primaryTexts.map((t) => t.text)];
      for (const text of allText) {
        const issues = this.checkCompliance(text, business.bannedTopics);
        complianceNotes.push(...issues);
      }
    } catch {
      // Fallback to template-based generation
      const fallback = this.fallbackGenerate(business, campaign);
      headlines = fallback.headlines;
      primaryTexts = fallback.primaryTexts;
      ctaRecommendation = fallback.cta;
      formatRecommendation = fallback.format;
      formatReason = fallback.formatReason;
    }

    return {
      id: `copy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      headlines,
      primaryTexts,
      ctaRecommendation,
      formatRecommendation,
      formatReason,
      complianceNotes: [...new Set(complianceNotes)],
    };
  }

  // ── Prompt builder ──────────────────────────────────────────────────

  private buildPrompt(business: BusinessContext, campaign: CampaignContext): string {
    const toneBlock = business.tone ? `Tone: ${business.tone}` : "Tone: Professional and warm";
    const personaBlock = business.persona ? `Brand persona: ${business.persona}` : "";
    const bannedBlock = business.bannedTopics?.length
      ? `Avoid these topics: ${business.bannedTopics.join(", ")}`
      : "";
    const locationBlock = business.location ? `Location: ${business.location}` : "";
    const servicesBlock = business.services?.length
      ? `Other services offered: ${business.services.map((s) => s.name).join(", ")}`
      : "";

    return `Generate ad copy for a ${campaign.platform ?? "Meta"} Ads campaign.

Business: ${business.businessName} (${business.businessType})
${locationBlock}
${toneBlock}
${personaBlock}
${servicesBlock}
${bannedBlock}

Campaign objective: ${campaign.objective}
Service being promoted: ${campaign.servicePromoted}
Target audience: ${campaign.targetAudience}
${campaign.budget ? `Budget: $${campaign.budget}/month` : ""}

Generate:
1. 5 headline options (max ${CHAR_LIMITS.headline} characters each)
2. 3 primary text options (max ${CHAR_LIMITS.primaryText} characters each)
3. Best CTA from: ${META_CTA_OPTIONS.join(", ")}
4. Best ad format from: ${AD_FORMATS.join(", ")}
5. Brief reason for format choice (1 sentence)

Rules:
- No superlative claims without substantiation
- No guaranteed results
- Match the brand tone
- Include a clear value proposition
- Headlines should be attention-grabbing but honest

Respond with ONLY JSON, no other text:
{
  "headlines": ["...", "...", "...", "...", "..."],
  "primaryTexts": ["...", "...", "..."],
  "cta": "...",
  "format": "...",
  "formatReason": "..."
}`;
  }

  // ── Response parser ─────────────────────────────────────────────────

  private parseResponse(raw: string): {
    headlines: string[];
    primaryTexts: string[];
    cta: string;
    format: string;
    formatReason: string;
  } {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in LLM response");
    }

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    return {
      headlines: Array.isArray(parsed.headlines) ? (parsed.headlines as string[]).slice(0, 5) : [],
      primaryTexts: Array.isArray(parsed.primaryTexts)
        ? (parsed.primaryTexts as string[]).slice(0, 3)
        : [],
      cta: typeof parsed.cta === "string" ? parsed.cta : "Learn More",
      format: typeof parsed.format === "string" ? parsed.format : "single_image",
      formatReason: typeof parsed.formatReason === "string" ? parsed.formatReason : "",
    };
  }

  // ── Validators ──────────────────────────────────────────────────────

  private validateCTA(cta: string): MetaCTA {
    const normalized = cta.trim();
    const match = META_CTA_OPTIONS.find((opt) => opt.toLowerCase() === normalized.toLowerCase());
    return match ?? "Learn More";
  }

  private validateFormat(format: string): AdFormat {
    const normalized = format.trim().toLowerCase().replace(/\s+/g, "_");
    const match = AD_FORMATS.find((f) => f === normalized);
    return match ?? "single_image";
  }

  // ── Compliance ──────────────────────────────────────────────────────

  private checkCompliance(text: string, bannedTopics?: string[]): string[] {
    const issues: string[] = [];

    for (const { pattern, reason } of COMPLIANCE_BLOCKLIST) {
      if (pattern.test(text)) {
        issues.push(reason);
      }
    }

    if (bannedTopics) {
      for (const topic of bannedTopics) {
        if (text.toLowerCase().includes(topic.toLowerCase())) {
          issues.push(`Contains banned topic: ${topic}`);
        }
      }
    }

    return issues;
  }

  // ── Format reasoning ────────────────────────────────────────────────

  private defaultFormatReason(format: AdFormat, campaign: CampaignContext): string {
    switch (format) {
      case "carousel":
        return "Carousel works well for showcasing multiple services or features.";
      case "stories":
        return "Stories format drives high engagement with younger demographics.";
      case "reels":
        return "Short-form video maximizes reach and engagement.";
      case "video":
        return "Video content builds trust and explains complex services effectively.";
      case "single_image":
      default:
        return campaign.objective === "leads"
          ? "Single image with clear CTA optimizes for lead generation."
          : "Single image format provides clean, focused messaging.";
    }
  }

  // ── Template fallback ───────────────────────────────────────────────

  private fallbackGenerate(
    business: BusinessContext,
    campaign: CampaignContext,
  ): {
    headlines: HeadlineOption[];
    primaryTexts: PrimaryTextOption[];
    cta: MetaCTA;
    format: AdFormat;
    formatReason: string;
  } {
    const name = business.businessName;
    const service = campaign.servicePromoted;

    const headlines: HeadlineOption[] = [
      `${service} at ${name}`,
      `Book Your ${service} Today`,
      `Expert ${service} Near You`,
      `Transform Your Smile Today`,
      `${name} — ${service}`,
    ].map((text) => ({
      text: text.slice(0, CHAR_LIMITS.headline),
      withinLimit: text.length <= CHAR_LIMITS.headline,
      charCount: Math.min(text.length, CHAR_LIMITS.headline),
    }));

    const primaryTexts: PrimaryTextOption[] = [
      `Looking for professional ${service.toLowerCase()}? ${name} offers expert care in a comfortable environment. Book your appointment today.`,
      `Discover why patients choose ${name} for ${service.toLowerCase()}. Experienced team, modern facilities, and personalized care.`,
      `Ready for ${service.toLowerCase()}? Our team at ${name} is here to help. Schedule your visit and see the difference.`,
    ].map((text) => ({
      text: text.slice(0, CHAR_LIMITS.primaryText),
      withinLimit: text.length <= CHAR_LIMITS.primaryText,
      charCount: Math.min(text.length, CHAR_LIMITS.primaryText),
    }));

    const cta: MetaCTA = campaign.objective === "leads" ? "Book Now" : "Learn More";
    const format: AdFormat = "single_image";

    return {
      headlines,
      primaryTexts,
      cta,
      format,
      formatReason: "Single image format provides clean, focused messaging for lead generation.",
    };
  }
}
