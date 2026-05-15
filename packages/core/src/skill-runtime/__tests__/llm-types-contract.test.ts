import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

describe("llm-types contract", () => {
  it("does not import from @anthropic-ai/sdk", () => {
    const source = readFileSync(join(__dirname, "../llm-types.ts"), "utf-8");
    expect(source).not.toContain("@anthropic-ai/sdk");
    expect(source).not.toContain("anthropic");
  });
});
