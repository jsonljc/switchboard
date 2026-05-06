-- The 20260505163000_add_baseline_composite_unique migration created the unique
-- index with an explicit name "PreSwitchboardBaseline_organizationId_dimension_metric_period_key",
-- but Postgres silently truncates identifiers at 63 chars, so the actual on-disk
-- name is "PreSwitchboardBaseline_organizationId_dimension_metric_period_k".
--
-- Prisma's automatic name generation produces a different truncation that
-- preserves the "_key" suffix. Rename to match what Prisma expects so
-- `prisma migrate diff` no longer reports drift.
ALTER INDEX "PreSwitchboardBaseline_organizationId_dimension_metric_period_k" RENAME TO "PreSwitchboardBaseline_organizationId_dimension_metric_peri_key";
