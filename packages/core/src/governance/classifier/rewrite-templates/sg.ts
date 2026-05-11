import type { RewriteTemplateEntry } from "./types.js";

export const SG_REWRITE_TEMPLATES: ReadonlyArray<RewriteTemplateEntry> = [
  {
    id: "sg_efficacy_results_vary",
    jurisdiction: "SG",
    claimType: "efficacy",
    template:
      "Results vary between individuals — the doctor will go through what's realistic for you during consultation.",
    notes: "HSA / SMC aesthetic-practice guideline — avoids implied outcome guarantee.",
  },
  {
    id: "sg_safety_doctor_consult",
    jurisdiction: "SG",
    claimType: "safety-claim",
    template:
      "Suitability and side effects depend on your skin and health — please discuss with the doctor during consultation.",
    notes: "HSA — avoids implied safety/no-side-effects assurance.",
  },
  {
    id: "sg_superiority_fit_consult",
    jurisdiction: "SG",
    claimType: "superiority",
    template:
      "We can share what makes our approach a fit for you — the doctor will walk through it during consultation.",
    notes: "SMC ethical-code — avoids comparative or superlative claim.",
  },
  {
    id: "sg_urgency_availability_check",
    jurisdiction: "SG",
    claimType: "urgency",
    template: "Let me know when works for you and I'll check availability with the team.",
    notes: "HCSA — replaces time-pressure with neutral availability check.",
  },
];
