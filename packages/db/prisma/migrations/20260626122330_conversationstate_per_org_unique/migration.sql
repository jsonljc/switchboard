-- Tenant isolation (adversarial audit #2): ConversationState.threadId (the bare
-- customer MSISDN) was globally UNIQUE, so a phone shared across two orgs collapsed
-- to one row — org A's human_override leaked into / clobbered org B. Make threadId
-- unique PER ORG instead.
--
-- organizationId stays nullable so the compound unique can be added without a
-- not-null backfill on un-derivable rows. Postgres treats NULLs as DISTINCT in a
-- unique index, so any row left null-org coexists with a fresh (org, phone) row and
-- is reaped by the expiresAt TTL.

-- DropIndex
DROP INDEX "ConversationState_threadId_key";

-- DropIndex
DROP INDEX "ConversationState_organizationId_idx";

-- Backfill org for legacy null-org rows where it is UNAMBIGUOUSLY derivable from the
-- gateway's own org-stamped ConversationThread (keyed by the same sessionId, which IS
-- the ConversationState.threadId). The old gateway write created ConversationState
-- rows without an organizationId; once the read becomes org-scoped, an active
-- human_override (a safety-gate escalation) on such a row would otherwise be silently
-- un-paused (the bot resumes on a conversation a human had taken over). Single-org
-- only — this NEVER misassigns: a sessionId mapping to two+ orgs, or only to the
-- identity-unresolved "gateway" literal, is left null (no org can be correctly
-- inferred, so an operator re-engages those rare conversations). A buggy/empty match
-- degrades to the null/leave-inert case, never to a wrong tenant.
UPDATE "ConversationState" cs
SET "organizationId" = sub.org
FROM (
  SELECT ct."agentContext" ->> 'sessionId' AS sid,
         min(ct."organizationId") AS org
  FROM "ConversationThread" ct
  WHERE ct."organizationId" IS NOT NULL
    AND ct."organizationId" <> 'gateway'
  GROUP BY ct."agentContext" ->> 'sessionId'
  HAVING count(DISTINCT ct."organizationId") = 1
) sub
WHERE cs."organizationId" IS NULL
  AND cs."threadId" = sub.sid;

-- CreateIndex
CREATE UNIQUE INDEX "ConversationState_organizationId_threadId_key" ON "ConversationState"("organizationId", "threadId");
