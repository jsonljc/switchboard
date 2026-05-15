import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

describe("skill-executor Anthropic decoupling", () => {
  it("does not import @anthropic-ai/sdk", () => {
    const source = readFileSync(join(__dirname, "../skill-executor.ts"), "utf-8");
    expect(source).not.toContain("@anthropic-ai/sdk");
  });

  it("does not reference Anthropic namespace types", () => {
    const source = readFileSync(join(__dirname, "../skill-executor.ts"), "utf-8");
    expect(source).not.toMatch(/Anthropic\./);
  });
});
