-- Anti-fake hardening (Spec-1A-5): mark every revenue-bearing row with its
-- provenance so the trustworthy metric can read only 'live'. Seed/demo factories
-- stamp 'seed'/'demo' explicitly; the DEFAULT covers production writers that do
-- not pass origin. The UPDATE backfills any pre-existing rows to 'live' (a no-op
-- when the table is empty; the DEFAULT already applies to existing rows on add).
ALTER TABLE "Booking" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'live';
UPDATE "Booking" SET "origin" = 'live' WHERE "origin" IS NULL;

ALTER TABLE "ConversionRecord" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'live';
UPDATE "ConversionRecord" SET "origin" = 'live' WHERE "origin" IS NULL;

ALTER TABLE "LifecycleRevenueEvent" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'live';
UPDATE "LifecycleRevenueEvent" SET "origin" = 'live' WHERE "origin" IS NULL;
