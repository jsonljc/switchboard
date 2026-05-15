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

/**
 * PR-3.2c: parameter builders may return either:
 *  - a bare parameter map (legacy shape, kept for builders that don't surface
 *    outcome patterns), or
 *  - { parameters, metadata: { injectedPatternIds } } — the rich shape used by
 *    builders that call ContextBuilder.build() and want the surfaced pattern
 *    IDs threaded to WorkTrace at finalize for conversion-lift analysis.
 */
export interface RegisteredBuilderRichResult {
  parameters: Record<string, unknown>;
  metadata?: {
    injectedPatternIds?: string[];
  };
}

export type RegisteredBuilderResult = Record<string, unknown> | RegisteredBuilderRichResult;

export function isRichBuilderResult(
  value: RegisteredBuilderResult,
): value is RegisteredBuilderRichResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "parameters" in value &&
    typeof (value as RegisteredBuilderRichResult).parameters === "object"
  );
}

export type RegisteredBuilder = (context: BuilderContext) => Promise<RegisteredBuilderResult>;

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
