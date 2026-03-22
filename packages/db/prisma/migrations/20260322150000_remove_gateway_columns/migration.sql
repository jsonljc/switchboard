-- DropIndex
DROP INDEX IF EXISTS "ToolEvent_sessionId_gatewayIdempotencyKey_key";

-- AlterTable: Remove gateway-specific columns from AgentSession
ALTER TABLE "AgentSession" DROP COLUMN IF EXISTS "allowedToolPack";
ALTER TABLE "AgentSession" DROP COLUMN IF EXISTS "governanceProfile";
ALTER TABLE "AgentSession" DROP COLUMN IF EXISTS "errorMessage";
ALTER TABLE "AgentSession" DROP COLUMN IF EXISTS "errorCode";

-- AlterTable: Remove gateway idempotency key from ToolEvent
ALTER TABLE "ToolEvent" DROP COLUMN IF EXISTS "gatewayIdempotencyKey";
