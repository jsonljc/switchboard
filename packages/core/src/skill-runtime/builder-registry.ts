import type { WorkUnit } from "../platform/work-unit.js";
import type { DeploymentContext } from "../platform/deployment-context.js";
import type { SkillStores } from "./parameter-builder.js";

export interface BuilderContext {
  workUnit: WorkUnit;
  deployment: DeploymentContext;
  conversation?: {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    sessionId?: string;
  };
  stores: SkillStores;
}

export type RegisteredBuilder = (context: BuilderContext) => Promise<Record<string, unknown>>;

export class BuilderRegistry {
  private readonly builders = new Map<string, RegisteredBuilder>();

  register(skillSlug: string, builder: RegisteredBuilder): void {
    if (this.builders.has(skillSlug)) {
      throw new Error(`Builder already registered for skill: ${skillSlug}`);
    }
    this.builders.set(skillSlug, builder);
  }

  get(skillSlug: string): RegisteredBuilder | undefined {
    return this.builders.get(skillSlug);
  }

  slugs(): string[] {
    return [...this.builders.keys()];
  }
}
