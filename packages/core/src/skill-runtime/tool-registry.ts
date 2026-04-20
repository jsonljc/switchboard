import type { SkillTool, SkillDefinition } from "./types.js";

export class ToolRegistry {
  private tools = new Map<string, SkillTool>();

  register(tool: SkillTool): void {
    if (this.tools.has(tool.id)) {
      throw new Error(`Duplicate tool registration: ${tool.id}`);
    }
    for (const [opName, op] of Object.entries(tool.operations)) {
      if (!op.effectCategory) {
        throw new Error(`Operation ${tool.id}.${opName} missing effectCategory`);
      }
    }
    this.tools.set(tool.id, tool);
  }

  validateSkillDependencies(skills: SkillDefinition[]): void {
    const declaredToolIds = new Set(skills.flatMap((s) => s.tools));
    const registeredToolIds = new Set(this.tools.keys());

    for (const id of declaredToolIds) {
      if (!registeredToolIds.has(id)) {
        throw new Error(`Skill declares tool "${id}" but it is not registered`);
      }
    }

    for (const id of registeredToolIds) {
      if (!declaredToolIds.has(id)) {
        console.warn(`Tool "${id}" is registered but no loaded skill references it`);
      }
    }
  }

  resolve(toolIds: string[]): Map<string, SkillTool> {
    const resolved = new Map<string, SkillTool>();
    for (const id of toolIds) {
      const tool = this.tools.get(id);
      if (!tool) throw new Error(`Unknown tool: ${id}`);
      resolved.set(id, tool);
    }
    return resolved;
  }
}
