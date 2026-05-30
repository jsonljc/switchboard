-- CreateTable
CREATE TABLE "DashboardPasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardPasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DashboardPasswordResetToken_tokenHash_key" ON "DashboardPasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "DashboardPasswordResetToken_userId_idx" ON "DashboardPasswordResetToken"("userId");

-- AddForeignKey
ALTER TABLE "DashboardPasswordResetToken" ADD CONSTRAINT "DashboardPasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "DashboardUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
