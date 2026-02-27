import type { TemplateContext } from "../generator.js";

export function testTsTemplate(ctx: TemplateContext): string {
  return `import { describe, it, expect } from "vitest";
import { ${ctx.pascalName}Cartridge } from "../index.js";
import { ${ctx.constName}_MANIFEST } from "../manifest.js";
import { CartridgeTestHarness, validateManifest } from "@switchboard/cartridge-sdk";

describe("${ctx.displayName} Cartridge", () => {
  it("manifest is valid", () => {
    const result = validateManifest(${ctx.constName}_MANIFEST);
    expect(result.valid).toBe(true);
  });

  it("passes the full lifecycle harness", async () => {
    const cartridge = new ${ctx.pascalName}Cartridge();
    await cartridge.initialize({
      principalId: "test",
      organizationId: null,
      connectionCredentials: {},
    });
    const harness = new CartridgeTestHarness(cartridge, {
      actionType: "${ctx.actionType}",
      parameters: { id: "test-123" },
    });
    await harness.runOrThrow();
  });
});
`;
}
