import type { TemplateContext } from "../generator.js";

export function riskTsTemplate(ctx: TemplateContext): string {
  return `import type { RiskInput } from "@switchboard/schemas";

export function compute${ctx.pascalName}RiskInput(
  _actionType: string,
  _parameters: Record<string, unknown>,
): RiskInput {
  return {
    baseRisk: "low",
    exposure: {
      dollarsAtRisk: 0,
      blastRadius: 1,
    },
    reversibility: "full",
    sensitivity: {
      entityVolatile: false,
      learningPhase: false,
      recentlyModified: false,
    },
  };
}
`;
}
