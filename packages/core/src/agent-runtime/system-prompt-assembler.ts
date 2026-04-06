import type { AgentPersona } from "@switchboard/schemas";

function serializeCriteria(criteria: Record<string, unknown>): string | null {
  if (Object.keys(criteria).length === 0) return null;
  if (typeof criteria.description === "string") return criteria.description;
  return Object.entries(criteria)
    .map(([key, value]) => `- ${key}: ${String(value)}`)
    .join("\n");
}

function serializeEscalationRules(rules: Record<string, unknown>): string | null {
  const enabled = Object.entries(rules)
    .filter(([, value]) => value === true)
    .map(([key]) => `- ${key}`);
  return enabled.length > 0 ? enabled.join("\n") : null;
}

export function assembleSystemPrompt(persona: AgentPersona): string {
  const sections: string[] = [];

  sections.push(`You are an AI assistant for ${persona.businessName}.`);

  // Role
  sections.push(
    `## Your Role\nYou help customers with ${persona.productService}.\n${persona.valueProposition}`,
  );

  // Communication style
  let style = `## Communication Style\nTone: ${persona.tone}`;
  if (persona.customInstructions) {
    style += `\nAdditional instructions: ${persona.customInstructions}`;
  }
  sections.push(style);

  // Lead qualification
  const criteria = serializeCriteria(persona.qualificationCriteria);
  sections.push(
    `## Lead Qualification\n${criteria ?? "Use your best judgment to identify good leads."}`,
  );

  // Escalation rules
  const escalation = serializeEscalationRules(persona.escalationRules);
  if (escalation) {
    sections.push(`## Escalation Rules\nHand off to a human when:\n${escalation}`);
  }

  // Booking
  if (persona.bookingLink) {
    sections.push(
      `## Booking\nWhen a lead is qualified, direct them to book: ${persona.bookingLink}`,
    );
  }

  return sections.join("\n\n");
}
