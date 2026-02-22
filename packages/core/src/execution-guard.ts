import type { Cartridge, CartridgeContext, ExecuteResult } from "@switchboard/cartridge-sdk";

/**
 * Runtime guard that wraps a Cartridge and only allows execute() when
 * the orchestrator has set the execution token. This prevents direct
 * calls to cartridge.execute() from outside executeApproved().
 */

let executionToken: symbol | null = null;

export function beginExecution(): symbol {
  const token = Symbol("execution-token");
  executionToken = token;
  return token;
}

export function endExecution(token: symbol): void {
  if (executionToken === token) {
    executionToken = null;
  }
}

export class GuardedCartridge implements Cartridge {
  constructor(private inner: Cartridge) {}

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
    if (!executionToken) {
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
