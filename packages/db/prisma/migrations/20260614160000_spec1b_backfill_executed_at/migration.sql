-- Spec-1B 1B-2: backfill executedAt for historical operator-acted recommendations.
-- The executedAt column + its index shipped in 20260614140000_spec1b_reallocation_marker, but only
-- the machine path (markActedByExecution) populated it going forward. The outcome scorer now gates on
-- executedAt IS NOT NULL ("score only executed moves"); without this backfill every recommendation
-- acted by an operator BEFORE applyAct began stamping executedAt would silently drop out of the
-- learning loop. An acted row's resolvedAt is its execution time, so it is the correct anchor.
-- Data-only migration (no DDL): the column already exists, so `prisma migrate diff` produces no
-- schema delta; this UPDATE is authored by hand.
UPDATE "PendingActionRecord"
SET "executedAt" = "resolvedAt"
WHERE "status" = 'acted'
  AND "executedAt" IS NULL
  AND "resolvedAt" IS NOT NULL;
