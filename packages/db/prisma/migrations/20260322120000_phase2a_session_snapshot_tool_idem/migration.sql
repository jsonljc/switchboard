-- AlterTable (idempotent — columns may already exist or table may have been created without them)
ALTER TABLE "AgentSession" ADD COLUMN IF NOT EXISTS "allowedToolPack" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "AgentSession" ADD COLUMN IF NOT EXISTS "governanceProfile" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AgentSession" ADD COLUMN IF NOT EXISTS "errorMessage" TEXT;
ALTER TABLE "AgentSession" ADD COLUMN IF NOT EXISTS "errorCode" TEXT;

-- AlterTable
ALTER TABLE "ToolEvent" ADD COLUMN IF NOT EXISTS "gatewayIdempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ToolEvent_sessionId_gatewayIdempotencyKey_key" ON "ToolEvent"("sessionId", "gatewayIdempotencyKey");
