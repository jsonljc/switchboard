ALTER TABLE "CrmContact"
ADD COLUMN "fbclid" TEXT,
ADD COLUMN "ttclid" TEXT,
ADD COLUMN "normalizedPhone" TEXT,
ADD COLUMN "normalizedEmail" TEXT;

CREATE INDEX "CrmContact_normalizedPhone_idx"
ON "CrmContact"("normalizedPhone");

CREATE INDEX "CrmContact_normalizedEmail_idx"
ON "CrmContact"("normalizedEmail");
