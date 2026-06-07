-- Spec-1A-1: canonical E.164 identity. Add the derived `phoneE164` column,
-- a lookup index, and a PARTIAL unique on (organizationId, phoneE164) that only
-- applies when phoneE164 IS NOT NULL (Prisma 6 cannot express a partial unique
-- in-schema; mirrors 20260603120000_booking_partial_unique_active).
ALTER TABLE "Contact" ADD COLUMN "phoneE164" TEXT;

CREATE INDEX "Contact_organizationId_phoneE164_idx"
  ON "Contact" ("organizationId", "phoneE164");

CREATE UNIQUE INDEX "Contact_org_phoneE164_unique"
  ON "Contact" ("organizationId", "phoneE164")
  WHERE "phoneE164" IS NOT NULL;
