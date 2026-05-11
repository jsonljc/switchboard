ALTER TABLE "Contact" ADD COLUMN "pdpaJurisdiction" TEXT;
ALTER TABLE "Contact" ADD COLUMN "consentGrantedAt" TIMESTAMP(3);
ALTER TABLE "Contact" ADD COLUMN "consentRevokedAt" TIMESTAMP(3);
ALTER TABLE "Contact" ADD COLUMN "consentSource" TEXT;
ALTER TABLE "Contact" ADD COLUMN "aiDisclosureVersionShown" TEXT;
ALTER TABLE "Contact" ADD COLUMN "aiDisclosureShownAt" TIMESTAMP(3);
ALTER TABLE "Contact" ADD COLUMN "consentUpdatedBy" TEXT;
ALTER TABLE "Contact" ADD COLUMN "consentNotes" TEXT;

CREATE INDEX "Contact_organizationId_pdpaJurisdiction_consentRevokedAt_idx"
  ON "Contact"("organizationId", "pdpaJurisdiction", "consentRevokedAt");
CREATE INDEX "Contact_organizationId_pdpaJurisdiction_consentGrantedAt_idx"
  ON "Contact"("organizationId", "pdpaJurisdiction", "consentGrantedAt");
