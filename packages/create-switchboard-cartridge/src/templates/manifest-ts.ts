import type { TemplateContext } from "../generator.js";

export function manifestTsTemplate(ctx: TemplateContext): string {
  return `import type { CartridgeManifest } from "@switchboard/schemas";

export const ${ctx.constName}_MANIFEST: CartridgeManifest = {
  id: "${ctx.name}",
  name: "${ctx.displayName}",
  version: "0.1.0",
  description: "${ctx.description}",
  actions: [
    {
      actionType: "${ctx.actionType}",
      name: "${ctx.actionName}",
      description: "TODO: Describe this action",
      parametersSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
        },
      },
      baseRiskCategory: "low",
      reversible: true,
    },
  ],
  requiredConnections: ["${ctx.connectionId}"],
  defaultPolicies: [],
};
`;
}
