import type { TemplateContext } from "../generator.js";

export function readmeMdTemplate(ctx: TemplateContext): string {
  return `# ${ctx.displayName} Cartridge

${ctx.description}

## Install

\`\`\`bash
npm install
\`\`\`

## Develop

\`\`\`bash
npm run typecheck   # Type-check
npm test            # Run tests
npm run build       # Build
\`\`\`

## Register with Switchboard

\`\`\`typescript
import { bootstrap${ctx.pascalName}Cartridge } from "./src/bootstrap.js";

const { cartridge } = bootstrap${ctx.pascalName}Cartridge();
// Register cartridge with the orchestrator
\`\`\`

## Actions

| Action Type | Name | Risk |
|-------------|------|------|
| \`${ctx.actionType}\` | ${ctx.actionName} | low |

## Connections

- \`${ctx.connectionId}\` — Configure credentials in connectionCredentials
`;
}
