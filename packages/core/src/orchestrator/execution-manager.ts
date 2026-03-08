import type { ActionProposal, RiskCategory, UndoRecipe } from "@switchboard/schemas";
import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import { beginExecution, endExecution, GuardedCartridge } from "../execution-guard.js";
import { getTracer } from "../telemetry/tracing.js";
import { getMetrics } from "../telemetry/metrics.js";

import type { SharedContext } from "./shared-context.js";
import { buildCartridgeContext } from "./shared-context.js";
import type { ProposeResult } from "./lifecycle.js";
import { inferCartridgeId } from "./lifecycle.js";
import type { ProposePipeline } from "./propose-pipeline.js";
import type { CartridgeCircuitBreakerWrapper } from "./circuit-breaker-wrapper.js";

export class ExecutionManager {
  constructor(
    private ctx: SharedContext,
    private circuitBreaker: CartridgeCircuitBreakerWrapper | null = null,
  ) {}

  async executeApproved(envelopeId: string): Promise<ExecuteResult> {
    const execSpan = getTracer().startSpan("orchestrator.executeApproved", {
      "envelope.id": envelopeId,
    });
    const execStart = Date.now();

    // 1. Load envelope, verify status
    const envelope = await this.ctx.storage.envelopes.getById(envelopeId);
    if (!envelope) {
      throw new Error(`Envelope not found: ${envelopeId}`);
    }
    if (envelope.status !== "approved") {
      throw new Error(`Cannot execute: envelope status is ${envelope.status}, expected "approved"`);
    }

    const proposal = envelope.proposals[0];
    if (!proposal) {
      throw new Error("No proposals in envelope");
    }

    // 2. Look up cartridge
    const decision = envelope.decisions[0];
    const storedCartridgeId = proposal.parameters["_cartridgeId"] as string | undefined;
    const inferredCartridgeId = this.inferCartridgeId(proposal.actionType);
    const cartridge = this.ctx.storage.cartridges.get(
      storedCartridgeId ?? inferredCartridgeId ?? "",
    );
    if (!cartridge) {
      const result: ExecuteResult = {
        success: false,
        summary: `Cartridge not found for action: ${proposal.actionType}`,
        externalRefs: {},
        rollbackAvailable: false,
        partialFailures: [{ step: "execute", error: "Cartridge not found" }],
        durationMs: 0,
        undoRecipe: null,
      };
      await this.ctx.storage.envelopes.update(envelopeId, { status: "failed" });
      return result;
    }

    // 3. Execute
    await this.ctx.storage.envelopes.update(envelopeId, { status: "executing" });

    await this.ctx.ledger.record({
      eventType: "action.executing",
      actorType: "system",
      actorId: "orchestrator",
      entityType: "action",
      entityId: proposal.id,
      riskCategory: decision?.computedRiskScore.category ?? "low",
      summary: `Executing ${proposal.actionType}`,
      snapshot: {
        actionType: proposal.actionType,
        parameters: Object.fromEntries(
          Object.entries(proposal.parameters).filter(([k]) => !k.startsWith("_")),
        ),
        cartridgeId: storedCartridgeId ?? inferredCartridgeId ?? "",
      },
      envelopeId: envelope.id,
    });

    // Capture pre-mutation snapshot
    const execPrincipalId = (envelope.proposals[0]?.parameters["_principalId"] as string) ?? "";
    const execOrgId = (envelope.proposals[0]?.parameters["_organizationId"] as string) ?? null;
    const execCartridgeId = storedCartridgeId ?? inferredCartridgeId ?? "";
    let preMutationSnapshot: Record<string, unknown> | undefined;
    try {
      if (cartridge.captureSnapshot) {
        preMutationSnapshot = await cartridge.captureSnapshot(
          proposal.actionType,
          Object.fromEntries(
            Object.entries(proposal.parameters).filter(([k]) => !k.startsWith("_")),
          ),
          await buildCartridgeContext(this.ctx, execCartridgeId, execPrincipalId, execOrgId),
        );

        if (preMutationSnapshot && Object.keys(preMutationSnapshot).length > 0) {
          await this.ctx.ledger.record({
            eventType: "action.snapshot",
            actorType: "system",
            actorId: "orchestrator",
            entityType: "action",
            entityId: proposal.id,
            riskCategory: decision?.computedRiskScore.category ?? "low",
            summary: `Pre-mutation snapshot captured for ${proposal.actionType}`,
            snapshot: preMutationSnapshot,
            envelopeId: envelope.id,
            traceId: envelope.traceId,
          });
        }
      }
    } catch (err) {
      console.warn(
        `[orchestrator] captureSnapshot failed, proceeding without snapshot: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    let executeResult: ExecuteResult;
    const execToken = beginExecution();
    if (cartridge instanceof GuardedCartridge) {
      cartridge.bindToken(execToken);
    }
    try {
      const execParams = {
        ...proposal.parameters,
        _envelopeId: envelope.id,
        _actionId: proposal.id,
      };

      const cartridgeContext = await buildCartridgeContext(
        this.ctx,
        execCartridgeId,
        execPrincipalId,
        execOrgId,
      );
      const executeFn = () => cartridge.execute(proposal.actionType, execParams, cartridgeContext);

      if (this.circuitBreaker) {
        executeResult = await this.circuitBreaker.execute(execCartridgeId, executeFn);
      } else {
        executeResult = await executeFn();
      }
    } catch (err) {
      executeResult = {
        success: false,
        summary: `Execution failed: ${err instanceof Error ? err.message : String(err)}`,
        externalRefs: {},
        rollbackAvailable: false,
        partialFailures: [{ step: "execute", error: String(err) }],
        durationMs: 0,
        undoRecipe: null,
      };
    } finally {
      endExecution(execToken);
      if (cartridge instanceof GuardedCartridge) {
        cartridge.unbindToken();
      }
    }

    // 4. Update envelope
    const newStatus = executeResult.success ? "executed" : "failed";
    await this.ctx.storage.envelopes.update(envelopeId, {
      status: newStatus,
      executionResults: [
        ...envelope.executionResults,
        {
          actionId: proposal.id,
          envelopeId: envelope.id,
          success: executeResult.success,
          summary: executeResult.summary,
          externalRefs: executeResult.externalRefs,
          rollbackAvailable: executeResult.rollbackAvailable,
          partialFailures: executeResult.partialFailures,
          durationMs: executeResult.durationMs,
          undoRecipe: executeResult.undoRecipe,
          executedAt: new Date(),
          preMutationSnapshot,
        },
      ],
    });

    // 5. Update guardrail state after successful execution
    if (executeResult.success) {
      this.updateGuardrailState(proposal, storedCartridgeId ?? inferredCartridgeId ?? "");
      await this.flushGuardrailState(proposal, storedCartridgeId ?? inferredCartridgeId ?? "");
    }

    // 5b. Record competence outcome
    if (this.ctx.competenceTracker) {
      const principalId = proposal.parameters["_principalId"] as string | undefined;
      if (principalId) {
        if (executeResult.success) {
          await this.ctx.competenceTracker.recordSuccess(principalId, proposal.actionType);
        } else {
          await this.ctx.competenceTracker.recordFailure(principalId, proposal.actionType);
        }
      }
    }

    // 6. Record audit entry
    await this.ctx.ledger.record({
      eventType: executeResult.success ? "action.executed" : "action.failed",
      actorType: "system",
      actorId: "orchestrator",
      entityType: "action",
      entityId: proposal.id,
      riskCategory: decision?.computedRiskScore.category ?? "low",
      summary: executeResult.summary,
      snapshot: {
        success: executeResult.success,
        externalRefs: executeResult.externalRefs,
        durationMs: executeResult.durationMs,
      },
      evidence: [
        { type: "execution_result", data: executeResult },
        ...(decision ? [{ type: "decision_trace", data: decision }] : []),
      ],
      envelopeId: envelope.id,
      traceId: envelope.traceId,
    });

    // Record metrics
    const execMetrics = getMetrics();
    const execDuration = Date.now() - execStart;
    execMetrics.executionsTotal.inc({ actionType: proposal.actionType });
    execMetrics.executionLatencyMs.observe({ actionType: proposal.actionType }, execDuration);
    if (executeResult.success) {
      execMetrics.executionsSuccess.inc({ actionType: proposal.actionType });
    } else {
      execMetrics.executionsFailed.inc({ actionType: proposal.actionType });
    }
    execSpan.setAttribute("success", executeResult.success);
    execSpan.setAttribute("duration.ms", execDuration);
    execSpan.setStatus(executeResult.success ? "OK" : "ERROR", executeResult.summary);
    execSpan.end();

    return executeResult;
  }

  async executePlan(
    plan: import("@switchboard/schemas").DataFlowPlan,
    context: {
      principalId: string;
      organizationId?: string;
      traceId?: string;
    },
  ): Promise<import("../data-flow/executor.js").DataFlowExecutionResult> {
    if (!this.ctx.dataFlowExecutor) {
      throw new Error("DataFlowExecutor not configured — cannot execute plans");
    }
    return this.ctx.dataFlowExecutor.execute(plan, context);
  }

  async requestUndo(envelopeId: string, proposePipeline: ProposePipeline): Promise<ProposeResult> {
    const envelope = await this.ctx.storage.envelopes.getById(envelopeId);
    if (!envelope) {
      throw new Error(`Envelope not found: ${envelopeId}`);
    }

    const execResult = envelope.executionResults.find(
      (r) => r.undoRecipe !== null && r.undoRecipe !== undefined,
    );
    if (!execResult || !execResult.undoRecipe) {
      throw new Error("No undo recipe available for this action");
    }

    const undoRecipe = execResult.undoRecipe as UndoRecipe;

    if (new Date() > undoRecipe.undoExpiresAt) {
      const principalId = (envelope.proposals[0]?.parameters["_principalId"] as string) ?? "system";

      await this.ctx.ledger.record({
        eventType: "action.expired",
        actorType: "user",
        actorId: principalId,
        entityType: "action",
        entityId: envelope.proposals[0]?.id ?? envelopeId,
        riskCategory: envelope.decisions[0]?.computedRiskScore.category ?? "low",
        summary: `Undo denied: window expired for envelope ${envelopeId}`,
        snapshot: {
          envelopeId,
          undoExpiresAt: undoRecipe.undoExpiresAt.toISOString(),
          attemptedAt: new Date().toISOString(),
        },
        envelopeId,
        traceId: envelope.traceId,
      });

      throw new Error("Undo window has expired");
    }

    const originalProposal = envelope.proposals[0];
    const cartridgeId =
      (originalProposal?.parameters["_cartridgeId"] as string) ??
      this.inferCartridgeId(originalProposal?.actionType ?? undoRecipe.reverseActionType);

    if (!cartridgeId) {
      throw new Error("Cannot determine cartridge for undo action");
    }

    const principalId = (originalProposal?.parameters["_principalId"] as string) ?? "system";

    if (this.ctx.competenceTracker && originalProposal) {
      await this.ctx.competenceTracker.recordRollback(principalId, originalProposal.actionType);
    }

    await this.ctx.ledger.record({
      eventType: "action.undo_requested",
      actorType: "system",
      actorId: "orchestrator",
      entityType: "action",
      entityId: envelope.id,
      riskCategory: (envelope.decisions[0]?.computedRiskScore.category ?? "none") as RiskCategory,
      summary: `Undo requested for envelope ${envelope.id}`,
      snapshot: {
        originalEnvelopeId: envelope.id,
        reverseActionType: undoRecipe.reverseActionType,
      },
      envelopeId: envelope.id,
    });

    return proposePipeline.propose({
      actionType: undoRecipe.reverseActionType,
      parameters: undoRecipe.reverseParameters,
      principalId,
      cartridgeId,
      message: `Undo of action ${undoRecipe.originalActionId}`,
      parentEnvelopeId: envelopeId,
    });
  }

  // ── Private helpers ──

  private inferCartridgeId(actionType: string): string | null {
    return inferCartridgeId(actionType, this.ctx.storage.cartridges);
  }

  private updateGuardrailState(proposal: ActionProposal, cartridgeId: string): void {
    const cartridge = this.ctx.storage.cartridges.get(cartridgeId);
    if (!cartridge) return;

    const guardrails = cartridge.getGuardrails();
    const now = Date.now();

    for (const rl of guardrails.rateLimits) {
      const scopeKey = rl.scope === "global" ? "global" : `${rl.scope}:${proposal.actionType}`;
      const current = this.ctx.guardrailState.actionCounts.get(scopeKey);

      if (current && now - current.windowStart < rl.windowMs) {
        current.count += 1;
      } else {
        this.ctx.guardrailState.actionCounts.set(scopeKey, { count: 1, windowStart: now });
      }
    }

    for (const cd of guardrails.cooldowns) {
      if (cd.actionType === proposal.actionType || cd.actionType === "*") {
        const entityId = (proposal.parameters["entityId"] as string) ?? "unknown";
        const entityKey = `${cd.scope}:${entityId}`;
        this.ctx.guardrailState.lastActionTimes.set(entityKey, now);
      }
    }
  }

  private async flushGuardrailState(proposal: ActionProposal, cartridgeId: string): Promise<void> {
    if (!this.ctx.guardrailStateStore) return;

    const cartridge = this.ctx.storage.cartridges.get(cartridgeId);
    if (!cartridge) return;

    const guardrails = cartridge.getGuardrails();
    const writes: Promise<void>[] = [];

    for (const rl of guardrails.rateLimits) {
      const scopeKey = rl.scope === "global" ? "global" : `${rl.scope}:${proposal.actionType}`;
      const entry = this.ctx.guardrailState.actionCounts.get(scopeKey);
      if (entry) {
        writes.push(this.ctx.guardrailStateStore.setRateLimit(scopeKey, entry, rl.windowMs));
      }
    }

    for (const cd of guardrails.cooldowns) {
      if (cd.actionType === proposal.actionType || cd.actionType === "*") {
        const entityId = (proposal.parameters["entityId"] as string) ?? "unknown";
        const entityKey = `${cd.scope}:${entityId}`;
        const timestamp = this.ctx.guardrailState.lastActionTimes.get(entityKey);
        if (timestamp !== undefined) {
          writes.push(
            this.ctx.guardrailStateStore.setCooldown(entityKey, timestamp, cd.cooldownMs),
          );
        }
      }
    }

    await Promise.all(writes);
  }
}
