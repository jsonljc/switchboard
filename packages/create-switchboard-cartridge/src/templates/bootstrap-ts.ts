import type { TemplateContext } from "../generator.js";

export function bootstrapTsTemplate(ctx: TemplateContext): string {
  return `import { ${ctx.pascalName}Cartridge } from "./index.js";

export function bootstrap${ctx.pascalName}Cartridge(): {
  cartridge: ${ctx.pascalName}Cartridge;
} {
  const cartridge = new ${ctx.pascalName}Cartridge();
  return { cartridge };
}
`;
}
