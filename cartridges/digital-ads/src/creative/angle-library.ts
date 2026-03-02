/**
 * Creative angle library — predefined angles for ad creative generation.
 * Each angle provides a thematic direction for headlines, body copy, and CTAs.
 */

export interface CreativeAngle {
  id: string;
  name: string;
  description: string;
  /** Tone keywords for the LLM */
  toneKeywords: string[];
  /** Example headline patterns */
  headlinePatterns: string[];
  /** Example CTA patterns */
  ctaPatterns: string[];
}

export const CREATIVE_ANGLES: CreativeAngle[] = [
  {
    id: "urgency",
    name: "Urgency",
    description: "Create time pressure to drive immediate action",
    toneKeywords: ["urgent", "limited", "act now", "don't miss"],
    headlinePatterns: [
      "Only {X} Spots Left This {Month}",
      "Last Chance: {Offer} Ends {Date}",
      "Book Before {Date} — Limited Availability",
    ],
    ctaPatterns: ["Book Now", "Claim Your Spot", "Reserve Today"],
  },
  {
    id: "social_proof",
    name: "Social Proof",
    description: "Leverage testimonials and statistics to build trust",
    toneKeywords: ["trusted", "rated", "reviewed", "recommended"],
    headlinePatterns: [
      "Join {X}+ Patients Who Trust {Clinic}",
      "Rated {X}/5 Stars by Real Patients",
      "See Why {X} Patients Choose {Clinic}",
    ],
    ctaPatterns: ["See Reviews", "Join Them Today", "Learn More"],
  },
  {
    id: "benefit_led",
    name: "Benefit-Led",
    description: "Lead with the transformation or outcome",
    toneKeywords: ["results", "transform", "achieve", "confidence"],
    headlinePatterns: [
      "Look {X} Years Younger — No Surgery Required",
      "{Treatment}: Natural Results, Zero Downtime",
      "Get the {Outcome} You've Always Wanted",
    ],
    ctaPatterns: ["See Results", "Start Your Journey", "Free Consultation"],
  },
  {
    id: "fomo",
    name: "FOMO",
    description: "Fear of missing out — emphasize exclusivity and popularity",
    toneKeywords: ["popular", "trending", "everyone", "fastest-growing"],
    headlinePatterns: [
      "{Treatment} Is Our Most Requested Service",
      "The {Treatment} Everyone's Talking About",
      "{X}% of Our Patients Come Back for More",
    ],
    ctaPatterns: ["Don't Miss Out", "Book Your Session", "See What's New"],
  },
  {
    id: "value",
    name: "Value Proposition",
    description: "Emphasize affordability, deals, or value",
    toneKeywords: ["affordable", "save", "value", "investment"],
    headlinePatterns: [
      "{Treatment} Starting at Just ${Price}",
      "Save ${Amount} on Your First {Treatment}",
      "Financing Available — {Treatment} for ${Price}/mo",
    ],
    ctaPatterns: ["See Pricing", "Get Your Quote", "Learn About Financing"],
  },
  {
    id: "educational",
    name: "Educational",
    description: "Inform and educate to build authority and trust",
    toneKeywords: ["learn", "discover", "understand", "expert"],
    headlinePatterns: [
      "{X} Things You Should Know About {Treatment}",
      "Is {Treatment} Right for You? Take Our Quiz",
      "Expert Guide: What to Expect from {Treatment}",
    ],
    ctaPatterns: ["Learn More", "Read the Guide", "Take the Quiz"],
  },
];

/**
 * Get a creative angle by ID.
 */
export function getAngle(id: string): CreativeAngle | null {
  return CREATIVE_ANGLES.find((a) => a.id === id) ?? null;
}

/**
 * Get all available creative angles.
 */
export function listAngles(): CreativeAngle[] {
  return CREATIVE_ANGLES;
}
