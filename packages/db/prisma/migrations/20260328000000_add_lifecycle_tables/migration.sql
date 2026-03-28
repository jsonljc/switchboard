-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "primaryChannel" TEXT NOT NULL DEFAULT 'whatsapp',
    "firstTouchChannel" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'new',
    "source" TEXT,
    "attribution" JSONB,
    "roles" TEXT[] DEFAULT ARRAY['lead']::TEXT[],
    "firstContactAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'interested',
    "timeline" TEXT,
    "priceReadiness" TEXT,
    "objections" JSONB NOT NULL DEFAULT '[]',
    "qualificationComplete" BOOLEAN NOT NULL DEFAULT false,
    "estimatedValue" INTEGER,
    "revenueTotal" INTEGER NOT NULL DEFAULT 0,
    "assignedAgent" TEXT,
    "assignedStaff" TEXT,
    "lostReason" TEXT,
    "notes" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LifecycleRevenueEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SGD',
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "recordedBy" TEXT NOT NULL,
    "externalReference" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "sourceCampaignId" TEXT,
    "sourceAdId" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LifecycleRevenueEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerTask" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT,
    "opportunityId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "suggestedAction" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "triggerReason" TEXT NOT NULL,
    "sourceAgent" TEXT,
    "fallbackReason" TEXT,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerTask_pkey" PRIMARY KEY ("id")
);

-- AlterTable: Add missing columns to ConversationThread
ALTER TABLE "ConversationThread" ADD COLUMN IF NOT EXISTS "threadStatus" TEXT NOT NULL DEFAULT 'open';
ALTER TABLE "ConversationThread" ADD COLUMN IF NOT EXISTS "opportunityId" TEXT;

-- CreateIndex
CREATE INDEX "Contact_organizationId_idx" ON "Contact"("organizationId");
CREATE INDEX "Contact_organizationId_stage_idx" ON "Contact"("organizationId", "stage");
CREATE INDEX "Contact_organizationId_phone_idx" ON "Contact"("organizationId", "phone");
CREATE INDEX "Contact_organizationId_lastActivityAt_idx" ON "Contact"("organizationId", "lastActivityAt");

-- CreateIndex
CREATE INDEX "Opportunity_organizationId_idx" ON "Opportunity"("organizationId");
CREATE INDEX "Opportunity_organizationId_stage_idx" ON "Opportunity"("organizationId", "stage");
CREATE INDEX "Opportunity_contactId_idx" ON "Opportunity"("contactId");

-- CreateIndex
CREATE INDEX "LifecycleRevenueEvent_organizationId_idx" ON "LifecycleRevenueEvent"("organizationId");
CREATE INDEX "LifecycleRevenueEvent_opportunityId_idx" ON "LifecycleRevenueEvent"("opportunityId");
CREATE INDEX "LifecycleRevenueEvent_organizationId_recordedAt_idx" ON "LifecycleRevenueEvent"("organizationId", "recordedAt");

-- CreateIndex
CREATE INDEX "OwnerTask_organizationId_status_idx" ON "OwnerTask"("organizationId", "status");
CREATE INDEX "OwnerTask_organizationId_priority_idx" ON "OwnerTask"("organizationId", "priority");

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LifecycleRevenueEvent" ADD CONSTRAINT "LifecycleRevenueEvent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LifecycleRevenueEvent" ADD CONSTRAINT "LifecycleRevenueEvent_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerTask" ADD CONSTRAINT "OwnerTask_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerTask" ADD CONSTRAINT "OwnerTask_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey (ConversationThread → Contact)
ALTER TABLE "ConversationThread" ADD CONSTRAINT "ConversationThread_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
