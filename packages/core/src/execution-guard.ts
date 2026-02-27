import type { Cartridge, CartridgeContext, CartridgeInterceptor, ExecuteResult } from "@switchboard/cartridge-sdk";

/**
 * Runtime guard that wraps a Cartridge and only allows execute() when
 * the orchestrator has set an execution token. This prevents direct
 * calls to cartridge.execute() from outside executeApproved().
 *
 * Uses a Set of active tokens instead of a single global to avoid
 * race conditions under concurrent execution (e.g. BullMQ concurrency > 1).
 * Each executeApproved() call gets its own token.
 *
 * Optionally runs a chain of CartridgeInterceptors:
 * - beforeEnrich: parameter transformation before enrichContext()
 * - beforeExecute: gate check before execute() (can block execution)
 * - afterExecute: result transformation after execute()
 */

const activeTokens = new Set<symbol>();

export function beginExecution(): symbol {
  const token = Symbol("execution-token");
  activeTokens.add(token);
  return token;
}

export function endExecution(token: symbol): void {
  activeTokens.delete(token);
}

export class GuardedCartridge implements Cartridge {
  private requiredToken: symbol | null = null;
  private interceptors: CartridgeInterceptor[];

  constructor(private inner: Cartridge, interceptors?: CartridgeInterceptor[]) {
    this.interceptors = interceptors ?? [];
  }

  /**
   * Bind this cartridge instance to a specific execution token.
   * Only that token will be accepted for execute() calls.
   * Call unbindToken() after execution completes.
   */
  bindToken(token: symbol): void {
    this.requiredToken = token;
  }

  unbindToken(): void {
    this.requiredToken = null;
  }

  get manifest() {
    return this.inner.manifest;
  }

  initialize(context: CartridgeContext): Promise<void> {
    return this.inner.initialize(context);
  }

  async enrichContext(
    actionType: string,
    parameters: Record<string, unknown>,
    context: CartridgeContext,
  ): Promise<Record<string, unknown>> {
    // Run beforeEnrich interceptors (parameter transformation chain)
    let currentParams = parameters;
    for (const interceptor of this.interceptors) {
      if (interceptor.beforeEnrich) {
        const result = await interceptor.beforeEnrich(actionType, currentParams, context);
        currentParams = result.parameters;
      }
    }
    return this.inner.enrichContext(actionType, currentParams, context);
  }

  async execute(
    actionType: string,
    parameters: Record<string, unknown>,
    context: CartridgeContext,
  ): Promise<ExecuteResult> {
    // Require a bound token — bindToken() must be called before execute().
    // The orchestrator calls bindToken() in executeApproved() before each execution.
    if (!this.requiredToken || !activeTokens.has(this.requiredToken)) {
      throw new Error(
        "Cartridge.execute() called outside of orchestrator executeApproved(). " +
        "Direct execution is forbidden — all actions must go through the governance pipeline.",
      );
    }

    // Run beforeExecute interceptors (gate check chain)
    let currentParams = parameters;
    for (const interceptor of this.interceptors) {
      if (interceptor.beforeExecute) {
        const result = await interceptor.beforeExecute(actionType, currentParams, context);
        if (!result.proceed) {
          return {
            success: false,
            summary: result.reason ?? "Blocked by pre-execution interceptor",
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [{ step: "interceptor.beforeExecute", error: result.reason ?? "Blocked" }],
            durationMs: 0,
            undoRecipe: null,
          };
        }
        currentParams = result.parameters;
      }
    }

    let execResult = await this.inner.execute(actionType, currentParams, context);

    // Run afterExecute interceptors (result transformation chain)
    for (const interceptor of this.interceptors) {
      if (interceptor.afterExecute) {
        execResult = await interceptor.afterExecute(actionType, currentParams, execResult, context);
      }
    }

    return execResult;
  }

  getRiskInput(
    actionType: string,
    parameters: Record<string, unknown>,
    context: Record<string, unknown>,
  ) {
    return this.inner.getRiskInput(actionType, parameters, context);
  }

  getGuardrails() {
    return this.inner.getGuardrails();
  }

  healthCheck() {
    return this.inner.healthCheck();
  }

  async searchCampaigns(query: string): Promise<Array<{ id: string; name: string; status: string }>> {
    return this.inner.searchCampaigns?.(query) ?? [];
  }

  async resolveEntity(
    inputRef: string,
    entityType: string,
    context: Record<string, unknown>,
  ): Promise<import("@switchboard/schemas").ResolvedEntity> {
    if (!this.inner.resolveEntity) {
      return {
        id: "",
        inputRef,
        resolvedType: entityType,
        resolvedId: "",
        resolvedName: "",
        confidence: 0,
        alternatives: [],
        status: "not_found",
      };
    }
    return this.inner.resolveEntity(inputRef, entityType, context);
  }

  async captureSnapshot(
    actionType: string,
    parameters: Record<string, unknown>,
    context: CartridgeContext,
  ): Promise<Record<string, unknown>> {
    return this.inner.captureSnapshot?.(actionType, parameters, context) ?? {};
  }
}
