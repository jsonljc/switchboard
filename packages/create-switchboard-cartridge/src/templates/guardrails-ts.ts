import type { TemplateContext } from "../generator.js";

export function guardrailsTsTemplate(ctx: TemplateContext): string {
  return `import type { GuardrailConfig } from "@switchboard/schemas";

export const DEFAULT_${ctx.constName}_GUARDRAILS: GuardrailConfig = {
  rateLimits: [
    {
      scope: "principal",
      maxActions: 100,
      windowMs: 3_600_000, // 1 hour
    },
  ],
  cooldowns: [],
  protectedEntities: [],
};
`;
}
