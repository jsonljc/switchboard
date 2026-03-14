// ---------------------------------------------------------------------------
// Objection Trees — Deterministic keyword-matched objection handling
// ---------------------------------------------------------------------------

export interface ObjectionMatch {
  category: string;
  keywords: string[];
  response: string;
  followUp: string;
}

/** Default objection trees (used when no profile-specific trees are provided). */
export const DEFAULT_OBJECTION_TREES: ObjectionMatch[] = [
  {
    category: "price",
    keywords: ["expensive", "cost", "price", "afford", "cheap", "budget", "money", "payment"],
    response:
      "We understand cost is an important factor. We offer flexible payment plans and financing options to make our services more accessible. Many customers find that spreading payments over several months makes it very manageable.",
    followUp: "Would you like to learn more about our financing options?",
  },
  {
    category: "timing",
    keywords: ["busy", "schedule", "time", "later", "wait", "not now", "next month", "too soon"],
    response:
      "We completely understand that timing matters. We offer flexible scheduling including early morning, evening, and weekend appointments to work around your schedule.",
    followUp: "Would you like me to check availability for times that work best for you?",
  },
  {
    category: "trust",
    keywords: [
      "reviews",
      "experience",
      "qualified",
      "credentials",
      "trust",
      "reputation",
      "new customer",
    ],
    response:
      "Your comfort is our priority. Our team is qualified and experienced with extensive expertise. We have hundreds of satisfied customers and would be happy to share results or connect you with customers who've had similar services.",
    followUp: "Would you like to see our customer testimonials or team credentials?",
  },
  {
    category: "comfort",
    keywords: ["nervous", "anxious", "uncomfortable", "worried", "scared", "afraid", "hesitant"],
    response:
      "It's completely normal to have concerns. We prioritize your comfort throughout the process and use the latest techniques to ensure the best experience. Most customers say it was much easier than expected.",
    followUp: "Would a consultation help address your specific concerns about comfort?",
  },
  {
    category: "results",
    keywords: [
      "results",
      "work",
      "effective",
      "guarantee",
      "last",
      "duration",
      "outcome",
      "natural",
    ],
    response:
      "We focus on delivering natural-looking results tailored to your goals. During your consultation, we'll discuss realistic expectations, show you examples of similar cases, and create a personalized service plan.",
    followUp: "Would you like to see examples of results from similar services?",
  },
  {
    category: "comparison",
    keywords: [
      "other provider",
      "competitor",
      "another option",
      "second opinion",
      "alternative",
      "different",
    ],
    response:
      "We encourage you to make the best choice for your needs. What sets us apart is our personalized approach, advanced methods, and commitment to ongoing customer care. We'd love the opportunity to show you why our customers choose to stay with us.",
    followUp:
      "Would you like to schedule a complimentary consultation to experience our approach firsthand?",
  },
  {
    category: "insurance",
    keywords: [
      "insurance",
      "coverage",
      "covered",
      "out of pocket",
      "deductible",
      "copay",
      "in-network",
    ],
    response:
      "We work with many insurance plans and can verify your coverage before your appointment. For services not covered by insurance, we offer transparent pricing and payment plans.",
    followUp: "Would you like us to check your insurance coverage?",
  },
  {
    category: "downtime",
    keywords: ["recovery", "downtime", "heal", "rest", "time off", "work", "social"],
    response:
      "Results vary by service — we'll walk you through what to expect. Many of our services have minimal downtime. We'll provide you with a detailed timeline during your consultation so you can plan accordingly.",
    followUp:
      "Would you like specific details about what to expect for the service you're considering?",
  },
];

/**
 * Match an objection text against objection trees.
 * When `trees` is provided (from a business profile), uses those trees.
 * Falls back to DEFAULT_OBJECTION_TREES otherwise.
 */
export function matchObjection(text: string, trees?: ObjectionMatch[]): ObjectionMatch | null {
  const lower = text.toLowerCase();
  let bestMatch: ObjectionMatch | null = null;
  let bestScore = 0;

  for (const tree of trees ?? DEFAULT_OBJECTION_TREES) {
    let score = 0;
    for (const keyword of tree.keywords) {
      if (lower.includes(keyword)) {
        score++;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = tree;
    }
  }

  return bestScore > 0 ? bestMatch : null;
}
