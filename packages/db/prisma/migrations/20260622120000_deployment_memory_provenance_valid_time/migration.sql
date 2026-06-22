-- S8a: provenance (`source`) + bi-temporal valid-time (`validFrom`/`validTo`/`invalidatedAt`)
-- on DeploymentMemory. Enables invalidate-not-delete (decay/evict soft-remove, preserving
-- history + the provenance of "who asserted this fact"). All nullable: legacy rows stay NULL
-- (honest absence); the store populates source/validFrom on create and validTo/invalidatedAt
-- on invalidation. Purely additive — no backfill, no index change (the existing
-- [organizationId, deploymentId] index covers the read predicate; invalidatedAt IS NULL is a
-- cheap residual on the <=500-row-per-deployment cap).
ALTER TABLE "DeploymentMemory" ADD COLUMN "source" TEXT,
ADD COLUMN "validFrom" TIMESTAMP(3),
ADD COLUMN "validTo" TIMESTAMP(3),
ADD COLUMN "invalidatedAt" TIMESTAMP(3);
