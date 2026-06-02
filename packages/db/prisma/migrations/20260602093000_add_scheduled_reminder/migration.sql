-- CreateTable
CREATE TABLE "ScheduledReminder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'whatsapp',
    "templateIntentClass" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "skipReason" TEXT,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledReminder_dedupeKey_key" ON "ScheduledReminder"("dedupeKey");

-- CreateIndex
CREATE INDEX "ScheduledReminder_bookingId_idx" ON "ScheduledReminder"("bookingId");
