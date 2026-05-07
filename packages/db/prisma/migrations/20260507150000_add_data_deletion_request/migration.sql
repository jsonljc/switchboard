-- Meta Data Deletion Callback request log.
-- Persisted so the user-facing confirmation_code can be verified at the
-- public status URL we return from the callback.

-- CreateTable
CREATE TABLE "DataDeletionRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "confirmationCode" TEXT NOT NULL,
    "deletedContactIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'completed',
    "failureReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataDeletionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DataDeletionRequest_confirmationCode_key" ON "DataDeletionRequest"("confirmationCode");

-- CreateIndex
CREATE INDEX "DataDeletionRequest_userId_idx" ON "DataDeletionRequest"("userId");
