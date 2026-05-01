-- CreateTable
CREATE TABLE "OperatorChannelBinding" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "channelIdentifier" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdBy" TEXT NOT NULL,
    "revokedBy" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperatorChannelBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OperatorChannelBinding_organizationId_channel_channelIdenti_key" ON "OperatorChannelBinding"("organizationId", "channel", "channelIdentifier");

-- CreateIndex
CREATE INDEX "OperatorChannelBinding_organizationId_principalId_idx" ON "OperatorChannelBinding"("organizationId", "principalId");

-- CreateIndex
CREATE INDEX "OperatorChannelBinding_organizationId_status_idx" ON "OperatorChannelBinding"("organizationId", "status");
