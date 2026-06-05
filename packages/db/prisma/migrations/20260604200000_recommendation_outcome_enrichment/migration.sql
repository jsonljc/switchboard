-- Slice-3 OutcomeLedger enrichments: three nullable advisory columns.
-- Legacy rows stay NULL (honest absence); the attribution engine populates
-- all three on every new row. No new indexes (query patterns unchanged).
-- CHECK constraints pin the legal value sets at the database layer (ledger
-- fields resist corruption; "corroborated" is reserved for slice 4 but legal
-- so the slice-4 writer needs no migration). Prisma cannot express CHECK
-- constraints in-schema (same pattern as 20260603120000_booking_partial_unique_active).
ALTER TABLE "RecommendationOutcome"
  ADD COLUMN "causalStrength" TEXT,
  ADD COLUMN "businessContextStable" TEXT,
  ADD COLUMN "trustDelta" TEXT,
  ADD CONSTRAINT "RecommendationOutcome_causalStrength_check"
    CHECK ("causalStrength" IS NULL OR "causalStrength" IN ('directional', 'corroborated', 'inconclusive')),
  ADD CONSTRAINT "RecommendationOutcome_businessContextStable_check"
    CHECK ("businessContextStable" IS NULL OR "businessContextStable" IN ('stable', 'unstable', 'unknown')),
  ADD CONSTRAINT "RecommendationOutcome_trustDelta_check"
    CHECK ("trustDelta" IS NULL OR "trustDelta" IN ('up', 'none', 'down'));
