import {
  ConversationFixtureSchema,
  type ConversationFixture,
} from "../alex-conversation/schema.js";

/**
 * Deterministic medspa param bundles for the golden prompt-diff gate. We vary the
 * axes that flow into the rendered system prompt's injected slots: BusinessFacts
 * present/absent (BUSINESS_FACTS + the escalate-on-missing-fact behavior) and
 * locale SG/MY (feeds PERSONA_CONFIG.customInstructions), with the onboarding
 * playbook present on the "operator" bundles (BOOKABLE_SERVICES).
 *
 * `turns` is required by ConversationFixtureSchema but unused by resolveParameters
 * (it resolves persona/facts/playbook, not the conversation), so a minimal
 * lead->alex pair is enough. CURRENT_DATETIME is pinned in render.ts, not here.
 */
const RAW = [
  {
    id: "sg-facts-present",
    vertical: "medspa",
    locale: "sg",
    scenario: "golden render: SG, operator facts + priced playbook",
    businessFacts: "operator",
    playbook: "operator",
    turns: [
      { role: "lead", content: "hi" },
      { role: "alex", grade: {} },
    ],
  },
  {
    id: "sg-facts-absent",
    vertical: "medspa",
    locale: "sg",
    scenario: "golden render: SG, facts absent (escalate-not-fabricate posture)",
    businessFacts: "absent",
    turns: [
      { role: "lead", content: "hi" },
      { role: "alex", grade: {} },
    ],
  },
  {
    id: "my-facts-present",
    vertical: "medspa",
    locale: "my",
    scenario: "golden render: MY, operator facts + priced playbook",
    businessFacts: "operator",
    playbook: "operator",
    turns: [
      { role: "lead", content: "hi" },
      { role: "alex", grade: {} },
    ],
  },
  {
    id: "my-facts-absent",
    vertical: "medspa",
    locale: "my",
    scenario: "golden render: MY, facts absent",
    businessFacts: "absent",
    turns: [
      { role: "lead", content: "hi" },
      { role: "alex", grade: {} },
    ],
  },
];

export const GOLDEN_FIXTURES: ConversationFixture[] = RAW.map((r) =>
  ConversationFixtureSchema.parse(r),
);
