ALTER TABLE "ConversationState"
ADD COLUMN "organizationId" TEXT;

CREATE INDEX "ConversationState_organizationId_idx"
ON "ConversationState"("organizationId");
