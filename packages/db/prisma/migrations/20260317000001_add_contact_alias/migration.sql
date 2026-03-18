CREATE TABLE "ContactAlias" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactAlias_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContactAlias_contactId_idx" ON "ContactAlias"("contactId");

CREATE UNIQUE INDEX "ContactAlias_channel_externalId_key" ON "ContactAlias"("channel", "externalId");

ALTER TABLE "ContactAlias" ADD CONSTRAINT "ContactAlias_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
