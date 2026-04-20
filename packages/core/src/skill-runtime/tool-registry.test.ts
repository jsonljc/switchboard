import { describe, it, expect, vi } from "vitest";
import { ToolRegistry } from "./tool-registry.js";
import type { SkillTool, SkillDefinition } from "./types.js";
import { ok } from "./tool-result.js";

function makeTool(id: string, ops?: Record<string, { effectCategory: string }>): SkillTool {
  const operations: Record<string, any> = {};
  for (const [name, config] of Object.entries(
    ops ?? { "default-op": { effectCategory: "read" } },
  )) {
    operations[name] = {
      description: `${name} op`,
      inputSchema: { type: "object", properties: {} },
      effectCategory: config.effectCategory,
      execute: async () => ok(),
    };
  }
  return { id, operations };
}

function makeSkill(tools: string[]): SkillDefinition {
  return {
    name: "test",
    slug: "test",
    version: "1.0.0",
    description: "test",
    author: "test",
    parameters: [],
    tools,
    body: "test body",
    context: [],
  };
}

describe("ToolRegistry", () => {
  describe("register", () => {
    it("registers a tool successfully", () => {
      const registry = new ToolRegistry();
      const tool = makeTool("crm-query");
      registry.register(tool);
      const resolved = registry.resolve(["crm-query"]);
      expect(resolved.get("crm-query")).toBe(tool);
    });

    it("throws on duplicate tool ID", () => {
      const registry = new ToolRegistry();
      registry.register(makeTool("crm-query"));
      expect(() => registry.register(makeTool("crm-query"))).toThrow(
        "Duplicate tool registration: crm-query",
      );
    });

    it("throws when operation missing effectCategory", () => {
      const registry = new ToolRegistry();
      const tool: SkillTool = {
        id: "bad-tool",
        operations: {
          "do-thing": {
            description: "missing tier",
            inputSchema: { type: "object", properties: {} },
            execute: async () => ok(),
          } as any,
        },
      };
      expect(() => registry.register(tool)).toThrow("missing effectCategory");
    });
  });

  describe("resolve", () => {
    it("resolves multiple tools", () => {
      const registry = new ToolRegistry();
      registry.register(makeTool("crm-query"));
      registry.register(makeTool("crm-write"));
      const resolved = registry.resolve(["crm-query", "crm-write"]);
      expect(resolved.size).toBe(2);
    });

    it("throws for unknown tool ID", () => {
      const registry = new ToolRegistry();
      expect(() => registry.resolve(["nonexistent"])).toThrow("Unknown tool: nonexistent");
    });
  });

  describe("validateSkillDependencies", () => {
    it("passes when all declared tools exist", () => {
      const registry = new ToolRegistry();
      registry.register(makeTool("crm-query"));
      registry.register(makeTool("crm-write"));
      expect(() =>
        registry.validateSkillDependencies([makeSkill(["crm-query", "crm-write"])]),
      ).not.toThrow();
    });

    it("throws when a skill references an unregistered tool", () => {
      const registry = new ToolRegistry();
      registry.register(makeTool("crm-query"));
      expect(() =>
        registry.validateSkillDependencies([makeSkill(["crm-query", "web-scanner"])]),
      ).toThrow('Skill declares tool "web-scanner" but it is not registered');
    });

    it("warns about orphan tools (registered but not referenced)", () => {
      const registry = new ToolRegistry();
      registry.register(makeTool("crm-query"));
      registry.register(makeTool("orphan-tool"));
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      registry.validateSkillDependencies([makeSkill(["crm-query"])]);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("orphan-tool"));
      warnSpy.mockRestore();
    });
  });
});
