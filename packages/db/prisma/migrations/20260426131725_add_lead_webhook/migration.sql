-- CreateTable
CREATE TABLE "LeadWebhook" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "greetingTemplateName" TEXT NOT NULL DEFAULT 'lead_welcome',
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadWebhook_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadWebhook_tokenHash_key" ON "LeadWebhook"("tokenHash");

-- CreateIndex
CREATE INDEX "LeadWebhook_organizationId_status_idx" ON "LeadWebhook"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "LeadWebhook" ADD CONSTRAINT "LeadWebhook_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "OrganizationConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
