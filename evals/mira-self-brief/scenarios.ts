import { createHash } from "node:crypto";
import { MIRA_PARAM_KEYS, MiraScenarioSchema, type MiraScenario } from "./schema.js";

/**
 * Re-export of the canonical Mira parameter-key list (defined in schema.ts to avoid
 * a scenarios↔schema import cycle). The faithfulness test pins it to the real skill.
 */
export const REQUIRED_MIRA_PARAM_KEYS = MIRA_PARAM_KEYS;

const WEEKLY_SCAN_TRIGGER =
  "Weekly performance scan. Decide whether the week's signal warrants one new concept.";

/**
 * Golden compose scenarios at the PARAMETER level (taste, measured performance,
 * pipeline state, frontline demand, trigger). Each `params` value is authored in the
 * exact rendering format miraBuilder produces (renderTasteContext /
 * renderPerformanceContext / renderFrontlineConversionContext / renderTriggerContext)
 * so a live drive sees production-shaped context. `expectedLean` is the disciplined
 * call the judge scores; the deterministic floor (shape / no-bleed / no-banned-claim)
 * applies to every scenario regardless of lean.
 */
const RAW_SCENARIOS: MiraScenario[] = [
  {
    id: "abstain-on-thin-signal",
    expectedLean: "abstain",
    judgeFocus:
      "One soft taste signal, no measured performance, no frontline demand — composing now is guessing. Abstain is the disciplined call.",
    note: "The LLM-level thin-signal posture (the hard no_signal floor sits upstream of compose).",
    params: {
      BUSINESS_NAME: "Lumière Aesthetics",
      BUSINESS_FACTS: "Services: consultations for injectables and skin treatments.",
      TASTE_CONTEXT: "In polished mode, the operator consistently keeps question hooks (3 keeps).",
      FRONTLINE_CONVERSION_CONTEXT: "",
      PERFORMANCE_CONTEXT:
        "Shipped this week: 0 (previous week: 0). In flight: 0. Awaiting review: 0.\n" +
        "No published creatives with measured performance yet.",
      PIPELINE_STATE: "0 in flight (0 awaiting review), 0 stopped.",
      TRIGGER_CONTEXT: WEEKLY_SCAN_TRIGGER,
      CURRENT_DATETIME: "2026-06-22 (Monday) 10:00 Asia/Singapore",
    },
  },
  {
    id: "abstain-on-loaded-desk",
    expectedLean: "abstain",
    judgeFocus:
      "Four unreviewed drafts already sit on the desk (sub-cap but loaded). Adding a fifth floods the operator. Abstain until the desk clears.",
    note: "Signal IS present (a measured winner) so the upstream floor would not skip; the LLM must still abstain on desk-hygiene grounds.",
    params: {
      BUSINESS_NAME: "Lumière Aesthetics",
      BUSINESS_FACTS: "Services: anti-wrinkle injections, skin boosters, consultations.",
      TASTE_CONTEXT:
        "Measured winner in polished mode: question hooks (5 sources).\n" +
        "In polished mode, the operator consistently keeps question hooks (5 keeps).",
      FRONTLINE_CONVERSION_CONTEXT:
        "Treatments customers actually book, most to least: anti-wrinkle injections (6), skin boosters (3).",
      PERFORMANCE_CONTEXT:
        "Shipped this week: 3 (previous week: 2). In flight: 4. Awaiting review: 4.\n" +
        '"First-visit question hook" (polished): true ROAS 3.4, $140.00 spend, $980.00 booked from 7 bookings, operator kept.\n' +
        "Operator decisions so far: 5 kept, 1 passed.",
      PIPELINE_STATE: "4 in flight (4 awaiting review), 0 stopped.",
      TRIGGER_CONTEXT: WEEKLY_SCAN_TRIGGER,
      CURRENT_DATETIME: "2026-06-22 (Monday) 10:00 Asia/Singapore",
    },
  },
  {
    id: "propose-grounded-in-frontline-demand",
    expectedLean: "propose",
    judgeFocus:
      "Clear desk, strong frontline demand for HydraFacial, and a known winning hook. Propose ONE concept grounded in what customers already book, not a treatment that never books.",
    note: "The positive case: real demand + clear desk + a usable pattern should yield one grounded concept.",
    params: {
      BUSINESS_NAME: "Lumière Aesthetics",
      BUSINESS_FACTS:
        "Services: HydraFacial, anti-wrinkle injections, skin boosters. Consultations available daily.",
      TASTE_CONTEXT: "In polished mode, the operator consistently keeps question hooks (5 keeps).",
      FRONTLINE_CONVERSION_CONTEXT:
        "Treatments customers actually book, most to least: HydraFacial (9), anti-wrinkle injections (4).",
      PERFORMANCE_CONTEXT:
        "Shipped this week: 1 (previous week: 1). In flight: 0. Awaiting review: 0.\n" +
        '"Glow question hook" (polished): true ROAS 3.8, $110.00 spend, $760.00 booked from 5 bookings, operator kept.',
      PIPELINE_STATE: "0 in flight (0 awaiting review), 0 stopped.",
      TRIGGER_CONTEXT: WEEKLY_SCAN_TRIGGER,
      CURRENT_DATETIME: "2026-06-22 (Monday) 10:00 Asia/Singapore",
    },
  },
  {
    id: "measured-over-taste-on-money",
    expectedLean: "propose",
    judgeFocus:
      "Taste prefers pattern-interrupt and passes on question hooks, but the MEASURED ROAS winner is question-led. For a money question, weight the measured evidence and NAME the taste/measurement conflict in the reason.",
    note: "Tests the SKILL's 'weight measured evidence for money questions' rule against an opposing taste signal.",
    params: {
      BUSINESS_NAME: "Lumière Aesthetics",
      BUSINESS_FACTS: "Services: anti-wrinkle injections, consultations.",
      TASTE_CONTEXT:
        "In polished mode, the operator consistently keeps pattern-interrupt hooks (6 keeps).\n" +
        "In polished mode, the operator consistently passes on question hooks (4 passes).",
      FRONTLINE_CONVERSION_CONTEXT:
        "Treatments customers actually book, most to least: anti-wrinkle injections (7).",
      PERFORMANCE_CONTEXT:
        "Shipped this week: 2 (previous week: 2). In flight: 0. Awaiting review: 0.\n" +
        '"Question-led consult" (polished): true ROAS 4.1, $200.00 spend, $1640.00 booked from 9 bookings, operator passed.\n' +
        "Operator decisions so far: 2 kept, 3 passed.",
      PIPELINE_STATE: "0 in flight (0 awaiting review), 0 stopped.",
      TRIGGER_CONTEXT: WEEKLY_SCAN_TRIGGER,
      CURRENT_DATETIME: "2026-06-22 (Monday) 10:00 Asia/Singapore",
    },
  },
  {
    id: "claim-boundary-cleanliness",
    expectedLean: "propose",
    judgeFocus:
      "The treatment tempts an outcome promise. The brief must stay claim-clean: frame as a consult/experience, never 'removes/erases/guaranteed/permanent', and no superlative the facts do not substantiate.",
    note: "Drives the SKILL's non-negotiable claim boundaries; the deterministic banned-claim check backstops the judge.",
    params: {
      BUSINESS_NAME: "Lumière Aesthetics",
      BUSINESS_FACTS:
        "Services: anti-wrinkle injections (soften the appearance of expression lines), skin boosters. " +
        "Licensed practitioners. Consultations available daily.",
      TASTE_CONTEXT:
        "Measured winner in polished mode: question hooks (4 sources).\n" +
        "In polished mode, the operator consistently keeps question hooks (4 keeps).",
      FRONTLINE_CONVERSION_CONTEXT:
        "Treatments customers actually book, most to least: anti-wrinkle injections (8), skin boosters (4).",
      PERFORMANCE_CONTEXT:
        "Shipped this week: 1 (previous week: 0). In flight: 1. Awaiting review: 1.\n" +
        '"Consult-first injectables" (polished): true ROAS 3.0, $130.00 spend, $720.00 booked from 4 bookings, operator kept.',
      PIPELINE_STATE: "1 in flight (1 awaiting review), 0 stopped.",
      TRIGGER_CONTEXT: WEEKLY_SCAN_TRIGGER,
      CURRENT_DATETIME: "2026-06-22 (Monday) 10:00 Asia/Singapore",
    },
  },
  {
    id: "riley-handoff-no-contract-bleed",
    expectedLean: "propose",
    judgeFocus:
      "A Riley handoff puts cross-agent qualification/intent language in context. Mira's output must be ONLY her compose JSON — no <intent> tags, no qualification blocks bleeding from the adjacent agents.",
    note: "Stresses AGENT-9 at the seam where bleed is most likely (the Riley→Mira handoff); the deterministic bleed check applies on every scenario but this one targets it.",
    params: {
      BUSINESS_NAME: "Lumière Aesthetics",
      BUSINESS_FACTS: "Services: HydraFacial, anti-wrinkle injections, consultations.",
      TASTE_CONTEXT: "In polished mode, the operator consistently keeps question hooks (5 keeps).",
      FRONTLINE_CONVERSION_CONTEXT:
        "Treatments customers actually book, most to least: HydraFacial (10), anti-wrinkle injections (5).",
      PERFORMANCE_CONTEXT:
        "Shipped this week: 1 (previous week: 1). In flight: 1. Awaiting review: 1.\n" +
        '"Glow question hook" (polished): true ROAS 4.0, $180.00 spend, $1280.00 booked from 8 bookings, operator kept.',
      PIPELINE_STATE: "1 in flight (1 awaiting review), 0 stopped.",
      TRIGGER_CONTEXT:
        'Riley (the ads agent) recommends "scale_budget" on campaign cmp_hydra_q3. ' +
        "Rationale: the HydraFacial question-hook creative is converting at 4x ROAS and is budget-constrained; " +
        "qualified leads are tagging booking intent at an above-average rate. " +
        "Evidence: 320 clicks, 18 conversions over 14 days. Compose the concept brief that would best " +
        "support this, or abstain if the evidence or operator taste argues against it.",
      CURRENT_DATETIME: "2026-06-22 (Monday) 10:00 Asia/Singapore",
    },
  },
];

/** The validated scenario corpus. Parsing here fails the import if a scenario drifts. */
export const SCENARIOS: readonly MiraScenario[] = RAW_SCENARIOS.map((s) =>
  MiraScenarioSchema.parse(s),
);

/** SHA-256 (truncated) of the corpus, stamped into the baseline for stale visibility. */
export function corpusHash(): string {
  return createHash("sha256").update(JSON.stringify(SCENARIOS), "utf8").digest("hex").slice(0, 16);
}
