-- S6a: lineage link from ExecutionTrace to the canonical WorkTrace this execution ran
-- inside. Nullable: legacy rows stay NULL (honest absence). Makes the ordered toolCalls
-- queryable per work unit (findByWorkUnitId) so trajectory grading (6b) + OTel GenAI
-- spans (E4) can join the tool-call sequence to its work unit. Purely additive.
ALTER TABLE "ExecutionTrace" ADD COLUMN "workUnitId" TEXT;

CREATE INDEX "ExecutionTrace_organizationId_workUnitId_idx"
  ON "ExecutionTrace" ("organizationId", "workUnitId");
