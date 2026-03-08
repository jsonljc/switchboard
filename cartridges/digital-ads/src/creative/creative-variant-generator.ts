// ---------------------------------------------------------------------------
// Creative Variant Generator — Text variant generation for ad creatives
// ---------------------------------------------------------------------------

export interface CreativeVariant {
  headline: string;
  primaryText: string;
  description: string;
  callToAction: string;
  angle: string;
}

export interface GenerateVariantsParams {
  productDescription: string;
  targetAudience: string;
  angles?: string[];
  variantsPerAngle?: number;
}

export interface GenerateVariantsResult {
  variants: CreativeVariant[];
  angles: string[];
  totalGenerated: number;
}

const DEFAULT_ANGLES = [
  "benefit-driven",
  "problem-solution",
  "social-proof",
  "urgency",
  "curiosity",
];

const CTA_OPTIONS = ["Shop Now", "Learn More", "Sign Up", "Get Started", "Try Free"];

export class CreativeVariantGenerator {
  generateVariants(params: GenerateVariantsParams): GenerateVariantsResult {
    const angles = params.angles ?? DEFAULT_ANGLES;
    const perAngle = params.variantsPerAngle ?? 2;
    const variants: CreativeVariant[] = [];

    for (const angle of angles) {
      for (let i = 0; i < perAngle; i++) {
        variants.push(
          this.generateVariant(params.productDescription, params.targetAudience, angle, i),
        );
      }
    }

    return {
      variants,
      angles,
      totalGenerated: variants.length,
    };
  }

  private generateVariant(
    product: string,
    audience: string,
    angle: string,
    index: number,
  ): CreativeVariant {
    const productShort = product.slice(0, 60);
    const audienceShort = audience.slice(0, 40);
    const cta = CTA_OPTIONS[index % CTA_OPTIONS.length]!;

    switch (angle) {
      case "benefit-driven":
        return {
          headline: `Transform Your ${audienceShort} Experience`,
          primaryText: `Discover how ${productShort} can help you achieve more. Built for ${audienceShort}.`,
          description: `See why thousands trust ${productShort}`,
          callToAction: cta,
          angle,
        };
      case "problem-solution":
        return {
          headline: `Tired of the Same Old Results?`,
          primaryText: `${productShort} solves the challenges ${audienceShort} face every day. Start seeing results.`,
          description: `The solution you've been looking for`,
          callToAction: cta,
          angle,
        };
      case "social-proof":
        return {
          headline: `Join Thousands of Happy Customers`,
          primaryText: `${audienceShort} everywhere are switching to ${productShort}. See what the buzz is about.`,
          description: `Rated #1 by real customers`,
          callToAction: cta,
          angle,
        };
      case "urgency":
        return {
          headline: `Don't Miss Out — Limited Time`,
          primaryText: `${productShort} is available now for ${audienceShort}. Act before this opportunity ends.`,
          description: `Offer ends soon — act now`,
          callToAction: cta,
          angle,
        };
      case "curiosity":
        return {
          headline: `What ${audienceShort} Are Saying About This`,
          primaryText: `There's a reason ${productShort} is getting so much attention. Find out why ${audienceShort} can't stop talking.`,
          description: `The secret is out`,
          callToAction: cta,
          angle,
        };
      default:
        return {
          headline: `Discover ${productShort}`,
          primaryText: `Made for ${audienceShort}. ${productShort} delivers results you can count on.`,
          description: `Start your journey today`,
          callToAction: cta,
          angle,
        };
    }
  }
}
