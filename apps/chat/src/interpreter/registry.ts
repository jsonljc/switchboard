import type { Interpreter, InterpreterResult } from "./interpreter.js";

export interface InterpreterRegistryEntry {
  name: string;
  interpreter: Interpreter;
  enabled: boolean;
  priority: number; // lower = tried first
}

export interface OrganizationRoutingConfig {
  organizationId: string;
  preferredInterpreter: string;
  fallbackChain: string[];
}

export interface InterpreterConfidencePolicy {
  actionType: string; // glob pattern or exact match, "*" for default
  minConfidence: number;
}

export class InterpreterRegistry {
  private interpreters = new Map<string, InterpreterRegistryEntry>();
  private orgRouting = new Map<string, OrganizationRoutingConfig>();
  private confidencePolicies: InterpreterConfidencePolicy[] = [];
  private defaultFallbackChain: string[] = [];

  register(name: string, interpreter: Interpreter, priority = 100): void {
    this.interpreters.set(name, {
      name,
      interpreter,
      enabled: true,
      priority,
    });
  }

  unregister(name: string): boolean {
    return this.interpreters.delete(name);
  }

  enable(name: string): void {
    const entry = this.interpreters.get(name);
    if (entry) entry.enabled = true;
  }

  disable(name: string): void {
    const entry = this.interpreters.get(name);
    if (entry) entry.enabled = false;
  }

  setOrganizationRouting(config: OrganizationRoutingConfig): void {
    this.orgRouting.set(config.organizationId, config);
  }

  removeOrganizationRouting(organizationId: string): void {
    this.orgRouting.delete(organizationId);
  }

  setDefaultFallbackChain(chain: string[]): void {
    this.defaultFallbackChain = chain;
  }

  setConfidencePolicies(policies: InterpreterConfidencePolicy[]): void {
    this.confidencePolicies = policies;
  }

  getMinConfidence(actionType: string): number {
    // Check specific match first, then wildcard
    const specific = this.confidencePolicies.find((p) => p.actionType === actionType);
    if (specific) return specific.minConfidence;
    const wildcard = this.confidencePolicies.find((p) => p.actionType === "*");
    return wildcard?.minConfidence ?? 0.5;
  }

  list(): InterpreterRegistryEntry[] {
    return [...this.interpreters.values()].sort((a, b) => a.priority - b.priority);
  }

  get(name: string): InterpreterRegistryEntry | null {
    return this.interpreters.get(name) ?? null;
  }

  /**
   * Resolve the fallback chain for a given organization.
   * Returns interpreter names in order of preference.
   */
  private resolveFallbackChain(organizationId?: string | null): string[] {
    if (organizationId) {
      const routing = this.orgRouting.get(organizationId);
      if (routing) {
        return [routing.preferredInterpreter, ...routing.fallbackChain];
      }
    }

    if (this.defaultFallbackChain.length > 0) {
      return this.defaultFallbackChain;
    }

    // Fall back to all enabled interpreters sorted by priority
    return this.list()
      .filter((e) => e.enabled)
      .map((e) => e.name);
  }

  /**
   * Interpret a message using the fallback chain.
   * Tries each interpreter in order; if confidence is below threshold,
   * tries the next interpreter in the chain.
   */
  async interpret(
    text: string,
    conversationContext: Record<string, unknown>,
    availableActions: string[],
    organizationId?: string | null,
  ): Promise<InterpreterResult & { interpreterName: string }> {
    const chain = this.resolveFallbackChain(organizationId);

    let lastResult: (InterpreterResult & { interpreterName: string }) | null = null;

    for (const name of chain) {
      const entry = this.interpreters.get(name);
      if (!entry || !entry.enabled) continue;

      try {
        const result = await entry.interpreter.interpret(
          text,
          conversationContext,
          availableActions,
        );

        const interpreterName = (result.proposals[0] as Record<string, unknown>)?.["interpreterName"] as string ?? name;

        const tagged: InterpreterResult & { interpreterName: string } = {
          ...result,
          interpreterName,
          proposals: result.proposals.map((p) => ({
            ...p,
            interpreterName: (p as Record<string, unknown>)["interpreterName"] as string ?? name,
          })),
        };

        // Check if confidence meets threshold
        const primaryActionType = result.proposals[0]?.actionType ?? "*";
        const minConfidence = this.getMinConfidence(primaryActionType);

        if (result.confidence >= minConfidence) {
          return tagged;
        }

        // Below threshold — save as fallback and try next
        console.log(
          `[registry] ${name} returned confidence ${result.confidence} < ${minConfidence} for ${primaryActionType}, trying next`,
        );
        lastResult = tagged;
      } catch (err) {
        console.error(`[registry] Interpreter ${name} failed:`, err);
        continue;
      }
    }

    // Return best result we got, or empty
    if (lastResult) return lastResult;

    return {
      proposals: [],
      needsClarification: true,
      clarificationQuestion: "No interpreter could process your request. Could you rephrase?",
      confidence: 0,
      rawResponse: "",
      interpreterName: "none",
    };
  }
}
