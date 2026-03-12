import { describe, it, expect } from "vitest";
import { packageJsonTemplate } from "../templates/package-json.js";
import { indexTsTemplate } from "../templates/index-ts.js";
import { manifestTsTemplate } from "../templates/manifest-ts.js";
import type { TemplateContext } from "../generator.js";

const ctx: TemplateContext = {
  name: "test-cartridge",
  displayName: "Test Cartridge",
  description: "A test cartridge",
  actionType: "test-action",
  actionName: "runTest",
  connectionId: "test-provider",
  author: "test-author",
  pascalName: "TestCartridge",
  constName: "TEST_CARTRIDGE",
};

describe("packageJsonTemplate", () => {
  it("generates valid JSON with correct package name", () => {
    const result = packageJsonTemplate(ctx);
    const parsed = JSON.parse(result);
    expect(parsed.name).toBe("@switchboard-cartridges/test-cartridge");
    expect(parsed.description).toBe("A test cartridge");
    expect(parsed.type).toBe("module");
  });
});

describe("indexTsTemplate", () => {
  it("generates source containing the pascal-cased cartridge class", () => {
    const result = indexTsTemplate(ctx);
    expect(result).toContain("TestCartridge");
  });
});

describe("manifestTsTemplate", () => {
  it("generates source containing the cartridge name", () => {
    const result = manifestTsTemplate(ctx);
    expect(result).toContain("test-cartridge");
  });
});
