import type { RewriteTemplateEntry } from "./types.js";

export const MY_REWRITE_TEMPLATES: ReadonlyArray<RewriteTemplateEntry> = [
  {
    id: "my_efficacy_results_vary",
    jurisdiction: "MY",
    claimType: "efficacy",
    template:
      "Results differ from person to person — the doctor will walk you through what to expect during consultation.",
    notes: "MAB / MMC ethical guidelines — avoids implied outcome guarantee.",
  },
  {
    id: "my_safety_doctor_consult",
    jurisdiction: "MY",
    claimType: "safety-claim",
    template:
      "Suitability and side effects depend on each person — the doctor will go through this with you during consultation.",
    notes: "MDA — avoids implied safety/no-side-effects assurance.",
  },
  {
    id: "my_superiority_fit_consult",
    jurisdiction: "MY",
    claimType: "superiority",
    template:
      "Happy to share what makes our approach right for you — the doctor will explain during consultation.",
    notes: "MMC ethical-code — avoids comparative or superlative claim.",
  },
  {
    id: "my_urgency_availability_check",
    jurisdiction: "MY",
    claimType: "urgency",
    template: "Tell me a time that works and I'll check with the team.",
    notes: "KKM / Act 586 — replaces time-pressure with neutral availability check.",
  },
];
