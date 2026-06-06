-- LifecycleRevenueEvent: weld a verified payment to its booking (spec 1A chain)
-- and make a replayed PSP charge an idempotent no-op. Today there is NO DB unique
-- on the external reference, so the same charge could write twice. Add a PARTIAL
-- unique on (organizationId, externalReference) WHERE externalReference IS NOT NULL
-- (Prisma 6 cannot express partial uniques; mirrors 20260603120000).
ALTER TABLE "LifecycleRevenueEvent" ADD COLUMN "bookingId" TEXT;

CREATE INDEX "LifecycleRevenueEvent_organizationId_bookingId_idx"
  ON "LifecycleRevenueEvent" ("organizationId", "bookingId");

CREATE UNIQUE INDEX "LifecycleRevenueEvent_org_externalRef_key"
  ON "LifecycleRevenueEvent" ("organizationId", "externalReference")
  WHERE "externalReference" IS NOT NULL;
