-- AlterTable
ALTER TABLE "WorkTrace" ADD COLUMN "lockedAt" TIMESTAMP(3);

-- Backfill: existing terminal traces are considered finalized at completedAt
-- (or migration time if completedAt is missing). Per design spec
-- docs/superpowers/specs/2026-04-28-work-trace-terminal-locking-design.md §7,
-- scripts still mutating these traces post-migration must be fixed, not preserved.
UPDATE "WorkTrace"
SET "lockedAt" = COALESCE("completedAt", NOW())
WHERE "outcome" IN ('completed', 'failed');
