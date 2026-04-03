type TonePreset = "warm-professional" | "casual-conversational" | "direct-efficient";

const GREETINGS: Record<TonePreset, (name: string) => string> = {
  "warm-professional": (n) =>
    `"Hi there! Welcome to ${n}. I'd love to help you find the perfect service. What are you looking for today?"`,
  "casual-conversational": (n) =>
    `"Hey! Thanks for reaching out to ${n}. What can I help you with?"`,
  "direct-efficient": (n) => `"Hello. How can I assist you with ${n}'s services today?"`,
};

const QUALIFICATION_SUFFIX: Record<string, string> = {
  light: `"Great — let me connect you with someone who can help right away."`,
  deep: `"To find the best fit, could you share your budget range and preferred timeline?"`,
};

const FOLLOW_UP_TEMPLATES: Record<TonePreset, (days: number) => string> = {
  "warm-professional": (d) =>
    `"Hi again! Just wanted to follow up from our chat. I'll check back in ${d === 1 ? "tomorrow" : `${d} days`} if I don't hear from you."`,
  "casual-conversational": (d) =>
    `"Hey! Just checking in. I'll ping you again ${d === 1 ? "tomorrow" : `in ${d} days`} if needed."`,
  "direct-efficient": (d) =>
    `"Following up on our conversation. Next check-in: ${d === 1 ? "tomorrow" : `${d} days`}."`,
};

const OPTIMIZER_TEMPLATES: Record<TonePreset, (threshold: number) => string> = {
  "warm-professional": (t) =>
    `"I noticed campaign 'Summer Sale' is underperforming. I'll adjust spend up to $${t} on my own — anything larger, I'll check with you first."`,
  "casual-conversational": (t) =>
    `"Heads up — 'Summer Sale' isn't doing great. I can tweak up to $${t} without bothering you. Bigger changes, I'll ask!"`,
  "direct-efficient": (t) =>
    `"Campaign 'Summer Sale' underperforming. Auto-adjusting spend up to $${t}. Larger changes require your approval."`,
};

// Map onboarding agent IDs (e.g. "employee-a") to roster roles (e.g. "responder")
const ONBOARDING_TO_ROLE: Record<string, string> = {
  "employee-a": "responder",
  "employee-b": "strategist",
  "employee-c": "optimizer",
  "employee-d": "monitor",
  "employee-e": "booker",
};

function normalizeRole(agentRole: string): string {
  return ONBOARDING_TO_ROLE[agentRole] ?? agentRole;
}

export function getPreviewMessage(
  agentRole: string,
  tonePreset: string,
  config: Record<string, unknown>,
  businessName: string,
): string {
  const role = normalizeRole(agentRole);
  const tone = (tonePreset || "warm-professional") as TonePreset;
  const name = businessName || "your business";

  if (role === "responder") {
    const greeting = GREETINGS[tone](name);
    const threshold = config.qualificationThreshold as number | undefined;
    if (threshold !== undefined && threshold <= 25)
      return `${greeting}\n\n${QUALIFICATION_SUFFIX.light}`;
    if (threshold !== undefined && threshold >= 60)
      return `${greeting}\n\n${QUALIFICATION_SUFFIX.deep}`;
    return greeting;
  }

  if (role === "strategist") {
    const days = config.followUpDays as number[] | undefined;
    const firstDay = days?.[0] ?? 1;
    return FOLLOW_UP_TEMPLATES[tone](firstDay);
  }

  if (role === "optimizer") {
    const threshold = (config.approvalThreshold as number) ?? 200;
    return OPTIMIZER_TEMPLATES[tone](threshold);
  }

  // All other roles: tone-only greeting
  return GREETINGS[tone](name);
}
