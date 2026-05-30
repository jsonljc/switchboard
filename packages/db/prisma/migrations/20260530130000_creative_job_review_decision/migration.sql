-- Phase-2 Mira Keep/Pass review decision on creative drafts.
ALTER TABLE "CreativeJob" ADD COLUMN "reviewDecision" TEXT;
ALTER TABLE "CreativeJob" ADD COLUMN "reviewDecidedAt" TIMESTAMP(3);

-- Index name must match what Prisma generates for @@index([organizationId, reviewDecision])
-- or db:check-drift fails ([[feedback_prisma_index_name_63_char_limit]]).
CREATE INDEX "CreativeJob_organizationId_reviewDecision_idx" ON "CreativeJob"("organizationId", "reviewDecision");
