-- Spec-1A chain weld: lineage/index columns on WorkTrace. Both nullable; legacy
-- rows stay NULL (honest absence). These columns are in the WorkTrace
-- EXCLUDED_BASE (packages/core/src/platform/work-trace-hash.ts) and land in the
-- SAME commit as that exclusion, so every existing row's contentHash stays
-- byte-identical and no hashInputVersion bump is required.
ALTER TABLE "WorkTrace"
  ADD COLUMN "contactId" TEXT,
  ADD COLUMN "conversationThreadId" TEXT;

CREATE INDEX "WorkTrace_organizationId_contactId_idx"
  ON "WorkTrace" ("organizationId", "contactId");

CREATE INDEX "WorkTrace_organizationId_conversationThreadId_idx"
  ON "WorkTrace" ("organizationId", "conversationThreadId");
