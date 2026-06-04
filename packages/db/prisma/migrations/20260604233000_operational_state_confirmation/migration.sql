-- Riley v3 slice 4a: append-only operator confirmations of operational state.
-- Rows are never updated; a confirmation's validity is derived as
-- [confirmedAt, next row's confirmedAt), with same-instant ties broken by
-- createdAt then id (the later row supersedes). No backfill: zero rows for an
-- org = honest absence (unknown). The 20260602140000_backfill_business_facts
-- migration is precedent for SHAPE only; fabricating freshness for existing
-- orgs would violate the slice honesty floor, so this migration creates
-- structure only and adds no data rows. CHECK constraints pin the enum value
-- sets AND the nonempty-state floor at the database layer (Prisma cannot
-- express CHECKs in-schema; same pattern as
-- 20260604200000_recommendation_outcome_enrichment).
CREATE TABLE "OperationalStateConfirmation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "operatingStatus" TEXT,
    "staffing" TEXT,
    "inventory" TEXT,
    "promoWindows" JSONB,
    "closures" JSONB,
    "note" TEXT,
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationalStateConfirmation_pkey" PRIMARY KEY ("id")
);

-- 59 chars, under the PostgreSQL 63-char identifier cap, and matches the
-- name Prisma derives for @@index([organizationId, confirmedAt]).
CREATE INDEX "OperationalStateConfirmation_organizationId_confirmedAt_idx"
    ON "OperationalStateConfirmation"("organizationId", "confirmedAt");

-- The nonempty_state floor deliberately EXCLUDES "note": a free-text note
-- alone must not create a freshness anchor. This mirrors the Zod refine so
-- the floor holds even against hand-written SQL, admin edits, or future bulk
-- tools that bypass the store.
ALTER TABLE "OperationalStateConfirmation"
  ADD CONSTRAINT "OperationalStateConfirmation_operatingStatus_check"
    CHECK ("operatingStatus" IS NULL OR "operatingStatus" IN ('open', 'temporarily_closed')),
  ADD CONSTRAINT "OperationalStateConfirmation_staffing_check"
    CHECK ("staffing" IS NULL OR "staffing" IN ('normal', 'shortfall')),
  ADD CONSTRAINT "OperationalStateConfirmation_inventory_check"
    CHECK ("inventory" IS NULL OR "inventory" IN ('normal', 'outage')),
  ADD CONSTRAINT "OperationalStateConfirmation_nonempty_state_check"
    CHECK (
      "operatingStatus" IS NOT NULL
      OR "staffing" IS NOT NULL
      OR "inventory" IS NOT NULL
      OR "promoWindows" IS NOT NULL
      OR "closures" IS NOT NULL
    );
