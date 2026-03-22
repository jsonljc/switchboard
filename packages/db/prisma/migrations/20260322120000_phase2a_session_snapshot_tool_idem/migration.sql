-- AlterTable
ALTER TABLE "AgentSession" ADD COLUMN "allowedToolPack" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "AgentSession" ADD COLUMN "governanceProfile" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AgentSession" ADD COLUMN "errorMessage" TEXT;
ALTER TABLE "AgentSession" ADD COLUMN "errorCode" TEXT;

-- AlterTable
ALTER TABLE "ToolEvent" ADD COLUMN "gatewayIdempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ToolEvent_sessionId_gatewayIdempotencyKey_key" ON "ToolEvent"("sessionId", "gatewayIdempotencyKey");
