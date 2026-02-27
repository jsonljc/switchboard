import type { TemplateContext } from "../generator.js";

export function policiesTsTemplate(ctx: TemplateContext): string {
  return `export const DEFAULT_${ctx.constName}_POLICIES = [
  {
    id: "${ctx.name}-standard",
    name: "${ctx.displayName} Standard Approval",
    description: "Standard approval policy for ${ctx.displayName} actions",
    rules: [],
  },
];
`;
}
