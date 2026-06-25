-- Guardrail-monitoring columns on MetaMutationAttempt (Spec-1B reallocate act-leg flip-readiness).
-- deploymentId: the forward executor stamps the reallocation's deployment at claim time so the
--   guardrail monitor can resolve credentials + attribute the rollback.
-- guardrailOutcome: NULL = not yet monitored; otherwise the monitor's verdict (held / rolled_back /
--   rollback_noop / rollback_unrestorable). First-writer-wins via updateMany ... WHERE IS NULL.
-- Both nullable + additive: no backfill (the act-leg is dark, so there are no rows in prod).
ALTER TABLE "MetaMutationAttempt" ADD COLUMN     "deploymentId" TEXT,
ADD COLUMN     "guardrailOutcome" TEXT;

-- The monitor's applied + un-monitored queue scan, ordered by the apply-time proxy (updatedAt).
CREATE INDEX "MetaMutationAttempt_status_guardrailOutcome_updatedAt_idx" ON "MetaMutationAttempt"("status", "guardrailOutcome", "updatedAt");
