import type { AgentPersona } from "@switchboard/schemas";
import { getRolePrompt, type SalesPipelineAgentRole } from "./role-prompts.js";
import { GOVERNANCE_CONSTRAINTS } from "./governance-constraints.js";

function formatJson(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .map(([key, value]) => `- ${key}: ${String(value)}`)
    .join("\n");
}

function interpolate(template: string, persona: AgentPersona): string {
  return template
    .replace(/\{businessName\}/g, persona.businessName)
    .replace(/\{tone\}/g, persona.tone)
    .replace(/\{bookingLink\}/g, persona.bookingLink ?? "No booking link configured")
    .replace(
      /\{qualificationCriteria\}/g,
      formatJson(persona.qualificationCriteria as Record<string, unknown>),
    )
    .replace(
      /\{disqualificationCriteria\}/g,
      formatJson(persona.disqualificationCriteria as Record<string, unknown>),
    )
    .replace(/\{escalationRules\}/g, formatJson(persona.escalationRules as Record<string, unknown>))
    .replace(/\{customInstructions\}/g, persona.customInstructions ?? "");
}

export function assembleSystemPrompt(
  role: SalesPipelineAgentRole,
  persona: AgentPersona,
  conversationContext: string,
): string {
  const rolePrompt = interpolate(getRolePrompt(role), persona);

  const sections = [rolePrompt];

  if (conversationContext.trim()) {
    sections.push(`\nCONVERSATION CONTEXT:\n${conversationContext}`);
  }

  sections.push(`\n${GOVERNANCE_CONSTRAINTS}`);

  return sections.join("\n");
}
