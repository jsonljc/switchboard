/**
 * CreativeVariantGenerator — generates ad creative variants using LLM.
 *
 * Takes product/service description, audience, angle, and compliance rules.
 * Returns headline/body/CTA variants. Runs each through compliance filter.
 */

import type { CreativeAngle } from "./angle-library.js";
import { CREATIVE_ANGLES } from "./angle-library.js";

export interface CreativeVariant {
  id: string;
  angle: string;
  headline: string;
  body: string;
  callToAction: string;
  /** Whether this passed compliance filtering */
  compliant: boolean;
  /** Compliance issues if any */
  complianceIssues: string[];
}

export interface CreativeGeneratorConfig {
  /** Function to call the LLM for generation */
  generateFn: (prompt: string) => Promise<string>;
}

/** Medical/healthcare compliance patterns that should be flagged */
const COMPLIANCE_BLOCKLIST = [
  { pattern: /guarantee[sd]?\s+results?/i, reason: "Cannot guarantee medical results" },
  { pattern: /cure[sd]?\s/i, reason: "Cannot claim to cure conditions" },
  { pattern: /100%\s+(?:safe|effective|success)/i, reason: "Cannot claim 100% efficacy" },
  { pattern: /no\s+(?:risk|side\s+effects?)/i, reason: "Cannot claim zero risk" },
  {
    pattern: /(?:best|#1|number\s+one)\s+(?:in|doctor|clinic)/i,
    reason: "Superlative claims require substantiation",
  },
  {
    pattern: /before\s+and\s+after/i,
    reason: "Before/after imagery may violate platform policies",
  },
  { pattern: /\b(?:FDA|approved)\b.*(?:not|hasn't|hasn't)/i, reason: "Misleading FDA claims" },
];

export class CreativeVariantGenerator {
  private generateFn: (prompt: string) => Promise<string>;

  constructor(config: CreativeGeneratorConfig) {
    this.generateFn = config.generateFn;
  }

  /**
   * Generate creative variants for a product/service.
   */
  async generateVariants(params: {
    productDescription: string;
    targetAudience: string;
    angles?: string[];
    variantsPerAngle?: number;
    businessName?: string;
    complianceRules?: string[];
  }): Promise<CreativeVariant[]> {
    const angles = params.angles
      ? CREATIVE_ANGLES.filter((a) => params.angles!.includes(a.id))
      : CREATIVE_ANGLES.slice(0, 3); // Default: first 3 angles

    const variantsPerAngle = params.variantsPerAngle ?? 2;
    const allVariants: CreativeVariant[] = [];

    for (const angle of angles) {
      const prompt = this.buildPrompt(params, angle, variantsPerAngle);

      try {
        const raw = await this.generateFn(prompt);
        const variants = this.parseVariants(raw, angle.id);

        // Run compliance filter on each variant
        for (const variant of variants) {
          const issues = this.checkCompliance(variant, params.complianceRules);
          variant.compliant = issues.length === 0;
          variant.complianceIssues = issues;
          allVariants.push(variant);
        }
      } catch (err) {
        console.error(`[Creative] Error generating for angle ${angle.id}:`, err);
      }
    }

    return allVariants;
  }

  private buildPrompt(
    params: {
      productDescription: string;
      targetAudience: string;
      businessName?: string;
      complianceRules?: string[];
    },
    angle: CreativeAngle,
    count: number,
  ): string {
    const complianceBlock = params.complianceRules?.length
      ? `\nCompliance rules:\n${params.complianceRules.map((r) => `- ${r}`).join("\n")}`
      : "\nCompliance: No superlative claims, no guaranteed results, no before/after imagery references.";

    return `Generate ${count} ad creative variants for a service business.

Product/Service: ${params.productDescription}
Target Audience: ${params.targetAudience}
Business Name: ${params.businessName ?? "[Business Name]"}
Creative Angle: ${angle.name} — ${angle.description}
Tone Keywords: ${angle.toneKeywords.join(", ")}
${complianceBlock}

For each variant, output a JSON array of objects with: headline, body, callToAction
Keep headlines under 40 characters, body under 125 characters, CTA under 20 characters.

Respond with ONLY a JSON array, no other text:
[{"headline": "...", "body": "...", "callToAction": "..."}]`;
  }

  private parseVariants(raw: string, angleId: string): CreativeVariant[] {
    try {
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]) as Array<{
        headline: string;
        body: string;
        callToAction: string;
      }>;

      return parsed.map((p, i) => ({
        id: `cv_${angleId}_${i}_${Date.now()}`,
        angle: angleId,
        headline: p.headline,
        body: p.body,
        callToAction: p.callToAction,
        compliant: true,
        complianceIssues: [],
      }));
    } catch {
      return [];
    }
  }

  private checkCompliance(variant: CreativeVariant, _extraRules?: string[]): string[] {
    const issues: string[] = [];
    const fullText = `${variant.headline} ${variant.body} ${variant.callToAction}`;

    for (const { pattern, reason } of COMPLIANCE_BLOCKLIST) {
      if (pattern.test(fullText)) {
        issues.push(reason);
      }
    }

    return issues;
  }
}
