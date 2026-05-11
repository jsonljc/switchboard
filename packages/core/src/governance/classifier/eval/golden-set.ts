import type { ClaimType } from "@switchboard/schemas";

/**
 * Golden-set fixture for the offline classifier eval harness.
 *
 * Each entry pairs a real-world sentence from the SG/MY medical aesthetic
 * context with the expected claim type and the jurisdiction that prompted
 * the example. Used by `run-eval.ts` (EVAL=1 gated) to measure per-model
 * accuracy and cross-model drift.
 *
 * Authoring rules:
 * - ≥40 entries total
 * - All 9 ClaimType values represented
 * - Both "SG" and "MY" jurisdictions present
 * - Sentences are ≤2 sentences each (single semantic unit)
 * - expectedConfidenceFloor: minimum acceptable confidence score for a pass
 */

export interface GoldenEntry {
  id: string;
  sentence: string;
  expectedClaimType: ClaimType;
  jurisdiction: "SG" | "MY";
  /** Minimum confidence the model must return for this to be a "high-confidence pass". */
  expectedConfidenceFloor: number;
  notes?: string;
}

export const GOLDEN_SET: GoldenEntry[] = [
  // ── efficacy (8 entries) ────────────────────────────────────────────────
  {
    id: "eff-01",
    sentence:
      "Ultherapy lifts and tightens the skin by stimulating collagen production deep in the SMAS layer.",
    expectedClaimType: "efficacy",
    jurisdiction: "SG",
    expectedConfidenceFloor: 0.85,
  },
  {
    id: "eff-02",
    sentence:
      "Most clients see a visible reduction in pore size after just one HydraFacial session.",
    expectedClaimType: "efficacy",
    jurisdiction: "MY",
    expectedConfidenceFloor: 0.85,
  },
  {
    id: "eff-03",
    sentence:
      "Our Pico laser breaks down pigmentation and melasma with fewer sessions than traditional lasers.",
    expectedClaimType: "efficacy",
    jurisdiction: "SG",
    expectedConfidenceFloor: 0.8,
  },
  {
    id: "eff-04",
    sentence: "Botox injections visibly reduce forehead lines within 5–7 days of treatment.",
    expectedClaimType: "efficacy",
    jurisdiction: "MY",
    expectedConfidenceFloor: 0.85,
  },
  {
    id: "eff-05",
    sentence:
      "HIFU contours the jawline and reduces submental fat with a single 45-minute session.",
    expectedClaimType: "efficacy",
    jurisdiction: "SG",
    expectedConfidenceFloor: 0.85,
  },
  {
    id: "eff-06",
    sentence:
      "Threadlifts can achieve results comparable to a surgical facelift without going under the knife.",
    expectedClaimType: "efficacy",
    jurisdiction: "MY",
    expectedConfidenceFloor: 0.8,
    notes: "Superiority-adjacent but primary claim is outcome (efficacy).",
  },
  {
    id: "eff-07",
    sentence:
      "PRP therapy accelerates skin rejuvenation by using your own growth factors to stimulate cell renewal.",
    expectedClaimType: "efficacy",
    jurisdiction: "SG",
    expectedConfidenceFloor: 0.8,
  },
  {
    id: "eff-08",
    sentence:
      "Our filler treatment restores cheek volume and reduces nasolabial folds for a more youthful appearance.",
    expectedClaimType: "efficacy",
    jurisdiction: "MY",
    expectedConfidenceFloor: 0.85,
  },

  // ── safety-claim (5 entries) ────────────────────────────────────────────
  {
    id: "safe-01",
    sentence:
      "This procedure is non-invasive and has minimal downtime, so you can return to work the same day.",
    expectedClaimType: "safety-claim",
    jurisdiction: "SG",
    expectedConfidenceFloor: 0.8,
  },
  {
    id: "safe-02",
    sentence:
      "Radiofrequency microneedling is safe for all Fitzpatrick skin types, including darker complexions common in Malaysia.",
    expectedClaimType: "safety-claim",
    jurisdiction: "MY",
    expectedConfidenceFloor: 0.85,
  },
  {
    id: "safe-03",
    sentence: "The numbing cream we apply beforehand ensures the treatment is virtually painless.",
    expectedClaimType: "safety-claim",
    jurisdiction: "SG",
    expectedConfidenceFloor: 0.75,
  },
  {
    id: "safe-04",
    sentence:
      "Hyaluronic acid fillers are fully reversible with hyaluronidase if you are unhappy with the result.",
    expectedClaimType: "safety-claim",
    jurisdiction: "MY",
    expectedConfidenceFloor: 0.8,
  },
  {
    id: "safe-05",
    sentence:
      "There is no risk of hyperpigmentation post-treatment because we use a cooling handpiece throughout.",
    expectedClaimType: "safety-claim",
    jurisdiction: "SG",
    expectedConfidenceFloor: 0.8,
    notes: "Bold safety guarantee — a high-severity flag.",
  },

  // ── superiority (5 entries) ─────────────────────────────────────────────
  {
    id: "sup-01",
    sentence: "We are the only clinic in Singapore with the FDA-cleared Sofwave device.",
    expectedClaimType: "superiority",
    jurisdiction: "SG",
    expectedConfidenceFloor: 0.85,
  },
  {
    id: "sup-02",
    sentence:
      "Our doctors have more combined years of aesthetic experience than any other clinic on Orchard Road.",
    expectedClaimType: "superiority",
    jurisdiction: "SG",
    expectedConfidenceFloor: 0.85,
  },
  {
    id: "sup-03",
    sentence: "This is the best anti-aging treatment available in Kuala Lumpur.",
    expectedClaimType: "superiority",
    jurisdiction: "MY",
    expectedConfidenceFloor: 0.85,
  },
  {
    id: "sup-04",
    sentence:
      "Our Pico laser delivers superior pigmentation clearance compared to Q-switched Nd:YAG technology.",
    expectedClaimType: "superiority",
    jurisdiction: "MY",
    expectedConfidenceFloor: 0.8,
  },
  {
    id: "sup-05",
    sentence:
      "No other filler brand on the market matches the longevity and safety profile of Juvederm Voluma.",
    expectedClaimType: "superiority",
    jurisdiction: "SG",
    expectedConfidenceFloor: 0.8,
  },

  // ── urgency (4 entries) ─────────────────────────────────────────────────
  {
    id: "urg-01",
    sentence: "This promotion ends on Friday — book now to lock in the $299 package price.",
    expectedClaimType: "urgency",
    jurisdiction: "SG",
    expectedConfidenceFloor: 0.9,
  },
  {
    id: "urg-02",
    sentence: "Only 3 slots left this month at the discounted rate, so do not wait too long.",
    expectedClaimType: "urgency",
    jurisdiction: "MY",
    expectedConfidenceFloor: 0.9,
  },
  {
    id: "urg-03",
    sentence: "The Hari Raya promotion is for a limited time only — grab it before it expires.",
    expectedClaimType: "urgency",
    jurisdiction: "MY",
    expectedConfidenceFloor: 0.85,
  },
  {
    id: "urg-04",
    sentence: "Act fast: our National Day bundle is only available through August 9th.",
    expectedClaimType: "urgency",
    jurisdiction: "SG",
    expectedConfidenceFloor: 0.9,
  },

  // ── testimonial (4 entries) ─────────────────────────────────────────────
  {
    id: "test-01",
    sentence:
      "One of our regular clients told us her colleagues thought she looked ten years younger after her Ultherapy session.",
    expectedClaimType: "testimonial",
    jurisdiction: "SG",
    expectedConfidenceFloor: 0.85,
  },
  {
    id: "test-02",
    sentence:
      "Many clients have shared that their skin felt firmer and more radiant after just three PRP sessions.",
    expectedClaimType: "testimonial",
    jurisdiction: "MY",
    expectedConfidenceFloor: 0.85,
  },
  {
    id: "test-03",
    sentence: "Our Google reviews consistently mention how natural the filler results look.",
    expectedClaimType: "testimonial",
    jurisdiction: "SG",
    expectedConfidenceFloor: 0.8,
  },
  {
    id: "test-04",
    sentence:
      "Patients often tell us this is the most comfortable laser treatment they have ever experienced.",
    expectedClaimType: "testimonial",
    jurisdiction: "MY",
    expectedConfidenceFloor: 0.8,
  },

  // ── medical-advice (5 entries) ──────────────────────────────────────────
  {
    id: "adv-01",
    sentence:
      "I would recommend starting with three Pico sessions spaced four weeks apart to address your melasma.",
    expectedClaimType: "medical-advice",
    jurisdiction: "SG",
    expectedConfidenceFloor: 0.85,
  },
  {
    id: "adv-02",
    sentence:
      "For your skin type, a combination of HIFU and RF microneedling will give you the best outcome.",
    expectedClaimType: "medical-advice",
    jurisdiction: "MY",
    expectedConfidenceFloor: 0.85,
  },
  {
    id: "adv-03",
    sentence:
      "You should avoid sun exposure for at least two weeks after any laser treatment to prevent post-inflammatory hyperpigmentation.",
    expectedClaimType: "medical-advice",
    jurisdiction: "SG",
    expectedConfidenceFloor: 0.8,
  },
  {
    id: "adv-04",
    sentence: "I suggest topping up your fillers every 9 to 12 months to maintain volume.",
    expectedClaimType: "medical-advice",
    jurisdiction: "MY",
    expectedConfidenceFloor: 0.85,
  },
  {
    id: "adv-05",
    sentence:
      "Based on what you've described, a course of oral whitening supplements combined with laser would be most effective.",
    expectedClaimType: "medical-advice",
    jurisdiction: "SG",
    expectedConfidenceFloor: 0.8,
  },

  // ── diagnosis (4 entries) ───────────────────────────────────────────────
  {
    id: "diag-01",
    sentence: "From the photos you shared, it looks like you have melasma on your upper cheeks.",
    expectedClaimType: "diagnosis",
    jurisdiction: "SG",
    expectedConfidenceFloor: 0.85,
  },
  {
    id: "diag-02",
    sentence: "That redness and flushing pattern is consistent with rosacea.",
    expectedClaimType: "diagnosis",
    jurisdiction: "MY",
    expectedConfidenceFloor: 0.9,
  },
  {
    id: "diag-03",
    sentence: "Your skin concerns sound like hormonal acne, which is common in your age group.",
    expectedClaimType: "diagnosis",
    jurisdiction: "SG",
    expectedConfidenceFloor: 0.85,
  },
  {
    id: "diag-04",
    sentence:
      "Those dark patches on your forehead are most likely solar lentigines from sun damage.",
    expectedClaimType: "diagnosis",
    jurisdiction: "MY",
    expectedConfidenceFloor: 0.85,
  },

  // ── credentials (4 entries) ─────────────────────────────────────────────
  {
    id: "cred-01",
    sentence:
      "Dr. Lim is a Fellow of the Academy of Medicine Singapore and has 15 years of aesthetic experience.",
    expectedClaimType: "credentials",
    jurisdiction: "SG",
    expectedConfidenceFloor: 0.9,
  },
  {
    id: "cred-02",
    sentence:
      "Our clinic is accredited by the Malaysian Medical Council and fully licensed under the Private Healthcare Facilities Act.",
    expectedClaimType: "credentials",
    jurisdiction: "MY",
    expectedConfidenceFloor: 0.85,
  },
  {
    id: "cred-03",
    sentence:
      "We only use FDA-cleared and HSA-approved devices — all sourced from authorised distributors.",
    expectedClaimType: "credentials",
    jurisdiction: "SG",
    expectedConfidenceFloor: 0.85,
  },
  {
    id: "cred-04",
    sentence: "Dr. Tan received her aesthetic fellowship training at the National Skin Centre.",
    expectedClaimType: "credentials",
    jurisdiction: "MY",
    expectedConfidenceFloor: 0.85,
  },

  // ── none (6 entries) ────────────────────────────────────────────────────
  {
    id: "none-01",
    sentence: "Our clinic is located at 25 Scotts Road, #06-01, Singapore 228220.",
    expectedClaimType: "none",
    jurisdiction: "SG",
    expectedConfidenceFloor: 0.9,
  },
  {
    id: "none-02",
    sentence: "We are open Monday to Saturday, 10am to 7pm.",
    expectedClaimType: "none",
    jurisdiction: "MY",
    expectedConfidenceFloor: 0.95,
  },
  {
    id: "none-03",
    sentence: "Would you like me to check our next available appointment slot for you?",
    expectedClaimType: "none",
    jurisdiction: "SG",
    expectedConfidenceFloor: 0.9,
  },
  {
    id: "none-04",
    sentence: "Your appointment is confirmed for Thursday, 14 November at 2:30pm.",
    expectedClaimType: "none",
    jurisdiction: "MY",
    expectedConfidenceFloor: 0.95,
  },
  {
    id: "none-05",
    sentence: "Could you tell me more about what skin concerns are bothering you most right now?",
    expectedClaimType: "none",
    jurisdiction: "SG",
    expectedConfidenceFloor: 0.9,
  },
  {
    id: "none-06",
    sentence:
      "Thank you for reaching out — I will get back to you shortly with the pricing details.",
    expectedClaimType: "none",
    jurisdiction: "MY",
    expectedConfidenceFloor: 0.9,
  },
] as const;
