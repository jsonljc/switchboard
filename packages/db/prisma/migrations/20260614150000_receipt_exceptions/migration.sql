-- Slice 5: structured provenance exceptions on the Receipt proof primitive (additive, net-new).
-- Matches Prisma's String[] @default([]) convention (cf. purchasedAgents, allowedModelTiers,
-- delegatedApprovers): TEXT[] with a DEFAULT and NO "NOT NULL" keyword -- Prisma never emits NOT NULL
-- for scalar lists, so adding it would make db:check-drift report spurious drift.
ALTER TABLE "Receipt" ADD COLUMN "exceptions" TEXT[] DEFAULT ARRAY[]::TEXT[];
