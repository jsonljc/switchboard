import type { CanonicalSubmitRequest } from "@switchboard/core/platform";

/** The narrow adapter call shape (IngressLike) emitted by the CTWA lead-intake adapter. */
export interface CtwaIngressReq {
  intent: string;
  payload: unknown;
  idempotencyKey: string;
  parentWorkUnitId?: string;
}

/**
 * Build the canonical submit request for a CTWA-originated lead intake (inbound
 * WhatsApp tagged with ctwa_clid). This is an internal-trigger system write with
 * no parent work unit, so it must carry a resolvable seeded actor itself: a
 * bespoke `system:<x>` id has no seeded IdentitySpec → GovernanceGate.loadIdentitySpec
 * throws → GOVERNANCE_ERROR deny → the paid lead is silently dropped. Use the
 * seeded `system` principal (ensureSystemIdentity → "default" IdentitySpec).
 */
export function buildCtwaIngressSubmitRequest(req: CtwaIngressReq): CanonicalSubmitRequest {
  const payload = req.payload as { organizationId: string; deploymentId: string };
  return {
    organizationId: payload.organizationId,
    // principal "system" → seeded "default" IdentitySpec (ensureSystemIdentity)
    actor: { id: "system", type: "system" },
    intent: req.intent,
    parameters: req.payload as Record<string, unknown>,
    trigger: "internal",
    surface: { surface: "chat" },
    idempotencyKey: req.idempotencyKey,
    targetHint: { deploymentId: payload.deploymentId },
    ...(req.parentWorkUnitId ? { parentWorkUnitId: req.parentWorkUnitId } : {}),
  };
}
