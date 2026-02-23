import type { Cartridge, CartridgeContext, ExecuteResult } from "@switchboard/cartridge-sdk";

/**
 * Runtime guard that wraps a Cartridge and only allows execute() when
 * the orchestrator has set an execution token. This prevents direct
 * calls to cartridge.execute() from outside executeApproved().
 *
 * Uses a Set of active tokens instead of a single global to avoid
 * race conditions under concurrent execution (e.g. BullMQ concurrency > 1).
 * Each executeApproved() call gets its own token.
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

  constructor(private inner: Cartridge) {}

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

  enrichContext(
    actionType: string,
    parameters: Record<string, unknown>,
    context: CartridgeContext,
  ): Promise<Record<string, unknown>> {
    return this.inner.enrichContext(actionType, parameters, context);
  }

  async execute(
    actionType: string,
    parameters: Record<string, unknown>,
    context: CartridgeContext,
  ): Promise<ExecuteResult> {
    // If a specific token is bound, check that exact token is still active.
    // Otherwise fall back to checking if ANY token is active (backward compat).
    if (this.requiredToken) {
      if (!activeTokens.has(this.requiredToken)) {
        throw new Error(
          "Cartridge.execute() called outside of orchestrator executeApproved(). " +
          "Direct execution is forbidden — all actions must go through the governance pipeline.",
        );
      }
    } else if (activeTokens.size === 0) {
      throw new Error(
        "Cartridge.execute() called outside of orchestrator executeApproved(). " +
        "Direct execution is forbidden — all actions must go through the governance pipeline.",
      );
    }
    return this.inner.execute(actionType, parameters, context);
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
}
