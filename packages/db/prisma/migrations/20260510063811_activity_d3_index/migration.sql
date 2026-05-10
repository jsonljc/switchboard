-- CreateIndex
CREATE INDEX "AuditEntry_organizationId_timestamp_id_idx" ON "AuditEntry"("organizationId", "timestamp" DESC, "id" DESC);
