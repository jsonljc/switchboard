import type {
  ChildWorkSubmitter,
  DelegationRequest,
  DelegationResult,
} from "@switchboard/core/skill-runtime";
import type { ChildWorkRequest, SubmitWorkResponse } from "@switchboard/core/platform";

/**
 * Maps the platform `SubmitWorkResponse` (3-arm union) to the core
 * `DelegationResult` port shape. CRITICAL: a child that *executed* but returned
 * `outcome:"failed"` (a governance deny → GOVERNANCE_ERROR, or a handler failure
 * such as DEPLOYMENT_NOT_FOUND) is a delegation FAILURE — `submit` resolves
 * `{ ok:true, result:{ outcome:"failed" } }` in that case, so a naive `!resp.ok`
 * check would mis-report it as success and Alex would tell the lead the handoff
 * worked when nothing was created. `pending_approval` is NOT a failure.
 */
export function toDelegationResult(resp: SubmitWorkResponse): DelegationResult {
  if (!resp.ok) {
    const err = resp.error as { code?: string; message?: string };
    return { ok: false, error: err.code ?? err.message ?? "submit_failed" };
  }
  const approvalRequired = "approvalRequired" in resp && resp.approvalRequired === true;
  if (approvalRequired) {
    return { ok: true, outcome: "pending_approval", childWorkUnitId: resp.workUnit.id };
  }
  if (resp.result.outcome === "failed") {
    return {
      ok: false,
      outcome: "failed",
      childWorkUnitId: resp.workUnit.id,
      error: resp.result.error?.code ?? resp.result.error?.message ?? "execution_failed",
    };
  }
  return { ok: true, outcome: resp.result.outcome, childWorkUnitId: resp.workUnit.id };
}

/**
 * Builds the core `ChildWorkSubmitter` port over a (possibly not-yet-bound)
 * platform `submitChildWork`. The getter is late-bound because PlatformIngress
 * is constructed after SkillMode; the delegate tool only calls this at runtime
 * (mid-conversation), by which point the ref is populated. Returns a safe
 * `platform_not_ready` failure if invoked before binding.
 */
export function createChildWorkSubmitter(
  getSubmit: () => ((req: ChildWorkRequest) => Promise<SubmitWorkResponse>) | undefined,
): ChildWorkSubmitter {
  return {
    async submitChildWork(req: DelegationRequest): Promise<DelegationResult> {
      const submit = getSubmit();
      if (!submit) return { ok: false, error: "platform_not_ready" };
      const resp = await submit({
        intent: req.intent,
        organizationId: req.organizationId,
        actor: req.actor,
        parameters: req.parameters,
        parentWorkUnitId: req.parentWorkUnitId,
        idempotencyKey: req.idempotencyKey,
      });
      return toDelegationResult(resp);
    },
  };
}
