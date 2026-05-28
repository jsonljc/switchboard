-- Replace the global unique on WorkTrace.idempotencyKey with an org-scoped
-- composite unique. A globally-unique idempotency key let a key reused across
-- tenants collide and, via PlatformIngress's submit-replay lookup, return
-- another org's cached WorkTrace (cross-tenant disclosure). Scoping to
-- (organizationId, idempotencyKey) confines idempotency to a single org.
-- Existing rows satisfy the new constraint a fortiori: the old global unique
-- already forbade any duplicate idempotencyKey across the table.
DROP INDEX "WorkTrace_idempotencyKey_key";

CREATE UNIQUE INDEX "WorkTrace_organizationId_idempotencyKey_key" ON "WorkTrace"("organizationId", "idempotencyKey");
