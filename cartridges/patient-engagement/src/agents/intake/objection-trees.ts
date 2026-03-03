// ---------------------------------------------------------------------------
// Objection Trees — Deterministic keyword-matched objection handling
// ---------------------------------------------------------------------------

export interface ObjectionMatch {
  category: string;
  keywords: string[];
  response: string;
  followUp: string;
}

const OBJECTION_TREES: ObjectionMatch[] = [
  {
    category: "price",
    keywords: ["expensive", "cost", "price", "afford", "cheap", "budget", "money", "payment"],
    response:
      "We understand cost is an important factor. We offer flexible payment plans and financing options to make treatment more accessible. Many patients find that spreading payments over several months makes it very manageable.",
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
      "new patient",
    ],
    response:
      "Your comfort is our priority. Our providers are board-certified with extensive experience. We have hundreds of satisfied patients and would be happy to share before-and-after results or connect you with patients who've had similar treatments.",
    followUp: "Would you like to see our patient testimonials or provider credentials?",
  },
  {
    category: "fear",
    keywords: ["pain", "hurt", "scary", "afraid", "nervous", "anxious", "uncomfortable", "needle"],
    response:
      "It's completely normal to feel nervous. We use the latest techniques to ensure maximum comfort, including topical numbing, gentle approaches, and sedation options when appropriate. Most patients say the experience was much easier than expected.",
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
      "We focus on delivering natural-looking results tailored to your goals. During your consultation, we'll discuss realistic expectations, show you examples of similar cases, and create a personalized treatment plan.",
    followUp: "Would you like to see examples of results from similar treatments?",
  },
  {
    category: "comparison",
    keywords: [
      "other clinic",
      "competitor",
      "another doctor",
      "second opinion",
      "alternative",
      "different",
    ],
    response:
      "We encourage you to make the best choice for your care. What sets us apart is our personalized approach, advanced technology, and commitment to ongoing patient care. We'd love the opportunity to show you why our patients choose to stay with us.",
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
      "We work with many insurance plans and can verify your coverage before your appointment. For treatments not covered by insurance, we offer transparent pricing and payment plans.",
    followUp: "Would you like us to check your insurance coverage?",
  },
  {
    category: "downtime",
    keywords: ["recovery", "downtime", "heal", "rest", "time off", "work", "social"],
    response:
      "Recovery varies by treatment, but many of our procedures have minimal downtime. We'll provide you with a detailed recovery timeline during your consultation so you can plan accordingly.",
    followUp: "Would you like specific recovery information for the treatment you're considering?",
  },
];

/**
 * Match an objection text against the deterministic objection trees.
 * Returns the best match or null if no match found.
 */
export function matchObjection(text: string): ObjectionMatch | null {
  const lower = text.toLowerCase();
  let bestMatch: ObjectionMatch | null = null;
  let bestScore = 0;

  for (const tree of OBJECTION_TREES) {
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
