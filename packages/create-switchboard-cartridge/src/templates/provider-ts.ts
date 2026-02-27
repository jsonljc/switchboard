import type { TemplateContext } from "../generator.js";

export function providerTsTemplate(ctx: TemplateContext): string {
  return `export interface ${ctx.pascalName}Provider {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<{ ok: boolean; latencyMs: number }>;
}

export class Mock${ctx.pascalName}Provider implements ${ctx.pascalName}Provider {
  async connect(): Promise<void> {
    // Mock connection
  }

  async disconnect(): Promise<void> {
    // Mock disconnection
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number }> {
    return { ok: true, latencyMs: 1 };
  }
}
`;
}
