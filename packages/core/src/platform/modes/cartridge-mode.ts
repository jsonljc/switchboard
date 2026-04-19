import type { Cartridge, CartridgeContext } from "@switchboard/schemas";
import type { ExecutionMode, ExecutionContext } from "../execution-context.js";
import type { ExecutionConstraints } from "../governance-types.js";
import type { ExecutionResult } from "../execution-result.js";
import type { WorkUnit } from "../work-unit.js";
import type { ExecutionModeName } from "../types.js";

export interface CartridgeRegistry {
  get(cartridgeId: string): Cartridge | null;
}

export interface CartridgeModeConfig {
  cartridgeRegistry: CartridgeRegistry;
  credentialResolver?: {
    resolve(orgId: string, cartridgeId: string): Promise<Record<string, unknown>>;
  };
}

function deriveCartridgeId(actionId: string): string {
  const dotIndex = actionId.indexOf(".");
  return dotIndex > 0 ? actionId.slice(0, dotIndex) : actionId;
}

export class CartridgeMode implements ExecutionMode {
  readonly name: ExecutionModeName = "cartridge";
  private readonly config: CartridgeModeConfig;

  constructor(config: CartridgeModeConfig) {
    this.config = config;
  }

  async execute(
    workUnit: WorkUnit,
    _constraints: ExecutionConstraints,
    context: ExecutionContext,
  ): Promise<ExecutionResult> {
    const cartridgeId = deriveCartridgeId(workUnit.intent);
    const cartridge = this.config.cartridgeRegistry.get(cartridgeId);

    if (!cartridge) {
      return {
        workUnitId: workUnit.id,
        outcome: "failed",
        summary: `Cartridge not found: ${cartridgeId}`,
        outputs: {},
        mode: "cartridge",
        durationMs: 0,
        traceId: context.traceId,
        error: { code: "CARTRIDGE_NOT_FOUND", message: `Cartridge not found: ${cartridgeId}` },
      };
    }

    let credentials: Record<string, unknown> = {};
    if (this.config.credentialResolver && workUnit.organizationId) {
      try {
        credentials = await this.config.credentialResolver.resolve(
          workUnit.organizationId,
          cartridgeId,
        );
      } catch {
        // Continue without credentials — cartridge may not need them
      }
    }

    const cartridgeContext: CartridgeContext = {
      principalId: workUnit.actor.id,
      organizationId: workUnit.organizationId ?? null,
      connectionCredentials: credentials,
    };

    const startMs = Date.now();
    try {
      const EXECUTION_TIMEOUT_MS = 30_000;
      const executeFn = () =>
        cartridge.execute(workUnit.intent, workUnit.parameters, cartridgeContext);
      const timeoutFn = () =>
        new Promise<never>((_resolve, reject) =>
          setTimeout(
            () =>
              reject(new Error(`Cartridge execution timed out after ${EXECUTION_TIMEOUT_MS}ms`)),
            EXECUTION_TIMEOUT_MS,
          ).unref(),
        );

      const result = await Promise.race([executeFn(), timeoutFn()]);
      const durationMs = Date.now() - startMs;

      if (!result.success) {
        return {
          workUnitId: workUnit.id,
          outcome: "failed",
          summary: result.summary,
          outputs: { externalRefs: result.externalRefs },
          mode: "cartridge",
          durationMs,
          traceId: context.traceId,
          error: { code: "CARTRIDGE_ERROR", message: result.summary },
        };
      }

      return {
        workUnitId: workUnit.id,
        outcome: "completed",
        summary: result.summary,
        outputs: { externalRefs: result.externalRefs, data: result.data },
        mode: "cartridge",
        durationMs,
        traceId: context.traceId,
      };
    } catch (err: unknown) {
      const durationMs = Date.now() - startMs;
      const message = err instanceof Error ? err.message : String(err);
      return {
        workUnitId: workUnit.id,
        outcome: "failed",
        summary: message,
        outputs: {},
        mode: "cartridge",
        durationMs,
        traceId: context.traceId,
        error: { code: "CARTRIDGE_ERROR", message },
      };
    }
  }
}
