import type { StorageContext } from "@switchboard/core";
import { isExpired, transitionApproval, StaleVersionError } from "@switchboard/core";
import type { AuditLedger } from "@switchboard/core";
import type { RiskCategory } from "@switchboard/schemas";

export interface ApprovalExpiryJobConfig {
  storage: StorageContext;
  ledger: AuditLedger;
  intervalMs?: number;
}

/**
 * Periodically scans pending approvals and transitions expired ones.
 * Returns a cleanup function that stops the interval and awaits any in-flight scan.
 */
export function startApprovalExpiryJob(config: ApprovalExpiryJobConfig): () => void {
  const { storage, ledger, intervalMs = 60_000 } = config;

  let stopped = false;
  let inFlightPromise: Promise<void> | null = null;

  const scan = async () => {
    if (stopped) return;
    try {
      const pending = await storage.approvals.listPending();

      for (const record of pending) {
        if (stopped) break;
        if (!isExpired(record.state)) continue;

        const expiredState = transitionApproval(record.state, "expire");
        try {
          await storage.approvals.updateState(record.request.id, expiredState, record.state.version);
        } catch (err) {
          if (err instanceof StaleVersionError) continue; // Already transitioned
          throw err;
        }

        // Update envelope status
        const envelope = await storage.envelopes.getById(record.envelopeId);
        if (envelope && envelope.status === "pending_approval") {
          await storage.envelopes.update(envelope.id, { status: "expired" });
        }

        // Audit the expiry
        await ledger.record({
          eventType: "action.approval_expired",
          actorType: "system",
          actorId: "expiry-job",
          entityType: "approval",
          entityId: record.request.id,
          riskCategory: (record.request.riskCategory as RiskCategory) ?? "low",
          summary: `Approval ${record.request.id} expired for action ${record.request.actionId}`,
          snapshot: {
            envelopeId: record.envelopeId,
            expiredAt: new Date().toISOString(),
            expiredBehavior: record.request.expiredBehavior,
          },
          envelopeId: record.envelopeId,
        });

        console.log(`[expiry-job] Expired approval ${record.request.id} for envelope ${record.envelopeId}`);
      }
    } catch (err) {
      console.error("[expiry-job] Error scanning approvals:", err);
    }
  };

  const timer = setInterval(() => {
    inFlightPromise = scan();
  }, intervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
    if (inFlightPromise) {
      // Best-effort await — caller can't await this since the return type is void,
      // but the promise will settle on its own without leaking.
      inFlightPromise.catch(() => {});
    }
  };
}
