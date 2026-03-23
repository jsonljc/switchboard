export interface BehaviorChoice {
  id: string;
  label: string;
  description: string;
  value: unknown;
}

export interface BehaviorOption {
  configKey: string;
  label: string;
  choices: BehaviorChoice[];
}

const RESPONDER_OPTIONS: BehaviorOption[] = [
  {
    configKey: "qualificationThreshold",
    label: "How thorough?",
    choices: [
      {
        id: "light",
        label: "Speed run",
        description: "Fewer questions, faster handoff",
        value: 25,
      },
      { id: "balanced", label: "Balanced", description: "Standard qualification", value: 40 },
      {
        id: "deep",
        label: "Deep dive",
        description: "More questions, budget & timeline",
        value: 60,
      },
    ],
  },
];

const STRATEGIST_OPTIONS: BehaviorOption[] = [
  {
    configKey: "followUpDays",
    label: "Follow-up style",
    choices: [
      { id: "gentle", label: "Gentle", description: "Spaced out, low pressure", value: [2, 5, 10] },
      { id: "steady", label: "Steady", description: "Regular check-ins", value: [1, 3, 7] },
      {
        id: "relentless",
        label: "Relentless",
        description: "Frequent, high urgency",
        value: [1, 2, 4],
      },
    ],
  },
];

const OPTIMIZER_OPTIONS: BehaviorOption[] = [
  {
    configKey: "approvalThreshold",
    label: "Spend authority",
    choices: [
      {
        id: "cautious",
        label: "Check with me first",
        description: "Over $50 needs approval",
        value: 50,
      },
      {
        id: "moderate",
        label: "I trust your judgment",
        description: "Over $200 needs approval",
        value: 200,
      },
      { id: "autonomous", label: "Go for it", description: "Over $500 needs approval", value: 500 },
    ],
  },
];

const ROLE_OPTIONS: Record<string, BehaviorOption[]> = {
  responder: RESPONDER_OPTIONS,
  strategist: STRATEGIST_OPTIONS,
  optimizer: OPTIMIZER_OPTIONS,
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  booker: "Schedules appointments based on your availability settings.",
  monitor: "Tracks revenue and flags issues automatically.",
  guardian: "Reviews risky actions before they execute.",
  primary_operator: "Coordinates the team. Its behavior is shaped by each specialist's settings.",
};

export function getBehaviorOptions(agentRole: string): BehaviorOption[] {
  return ROLE_OPTIONS[agentRole] ?? [];
}

export function getRoleDescription(agentRole: string): string | null {
  if (ROLE_OPTIONS[agentRole]) return null;
  return ROLE_DESCRIPTIONS[agentRole] ?? null;
}
