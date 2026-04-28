-- AlterTable
ALTER TABLE "CreativeJob" ADD COLUMN     "allowedOutputTier" INTEGER,
ADD COLUMN     "creatorIdentityId" TEXT,
ADD COLUMN     "effectiveTier" INTEGER,
ADD COLUMN     "fidelityTierAtGeneration" INTEGER,
ADD COLUMN     "productIdentityId" TEXT,
ADD COLUMN     "registryBackfilled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shotSpecVersion" TEXT;

-- AlterTable
ALTER TABLE "CreatorIdentity" ADD COLUMN     "consentRecordId" TEXT,
ADD COLUMN     "identityAdapter" JSONB,
ADD COLUMN     "qualityTier" TEXT;

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "personName" TEXT NOT NULL,
    "scopeOfUse" TEXT[],
    "territory" TEXT[],
    "mediaTypes" TEXT[],
    "revocable" BOOLEAN NOT NULL DEFAULT true,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "recordingUri" TEXT,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductIdentity" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "brandName" TEXT,
    "sku" TEXT,
    "packageType" TEXT,
    "canonicalPackageText" TEXT,
    "dimensionsMm" JSONB,
    "colorSpec" JSONB,
    "logoAssetId" TEXT,
    "qualityTier" TEXT NOT NULL DEFAULT 'url_imported',
    "lockStatus" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductImage" (
    "id" TEXT NOT NULL,
    "productIdentityId" TEXT NOT NULL,
    "viewType" TEXT NOT NULL,
    "uri" TEXT NOT NULL,
    "resolution" JSONB,
    "hasReadableLabel" BOOLEAN,
    "ocrText" TEXT,
    "backgroundType" TEXT,
    "approvedForGeneration" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductQcResult" (
    "id" TEXT NOT NULL,
    "productIdentityId" TEXT NOT NULL,
    "assetRecordId" TEXT NOT NULL,
    "logoSimilarityScore" DOUBLE PRECISION,
    "packageOcrMatchScore" DOUBLE PRECISION,
    "colorDeltaScore" DOUBLE PRECISION,
    "geometryMatchScore" DOUBLE PRECISION,
    "scaleConfidence" DOUBLE PRECISION,
    "passFail" TEXT NOT NULL,
    "warnings" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductQcResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PcdIdentitySnapshot" (
    "id" TEXT NOT NULL,
    "assetRecordId" TEXT NOT NULL,
    "productIdentityId" TEXT NOT NULL,
    "productTierAtGeneration" INTEGER NOT NULL,
    "productImageAssetIds" TEXT[],
    "productCanonicalTextHash" TEXT NOT NULL,
    "productLogoAssetId" TEXT,
    "creatorIdentityId" TEXT NOT NULL,
    "avatarTierAtGeneration" INTEGER NOT NULL,
    "avatarReferenceAssetIds" TEXT[],
    "voiceAssetId" TEXT,
    "consentRecordId" TEXT,
    "policyVersion" TEXT NOT NULL,
    "providerCapabilityVersion" TEXT NOT NULL,
    "selectedProvider" TEXT NOT NULL,
    "providerModelSnapshot" TEXT NOT NULL,
    "seedOrNoSeed" TEXT NOT NULL,
    "rewrittenPromptText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PcdIdentitySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsentRecord_orgId_idx" ON "ConsentRecord"("orgId");

-- CreateIndex
CREATE INDEX "ConsentRecord_revoked_idx" ON "ConsentRecord"("revoked");

-- CreateIndex
CREATE INDEX "ProductIdentity_orgId_idx" ON "ProductIdentity"("orgId");

-- CreateIndex
CREATE INDEX "ProductIdentity_qualityTier_idx" ON "ProductIdentity"("qualityTier");

-- CreateIndex
CREATE INDEX "ProductIdentity_lockStatus_idx" ON "ProductIdentity"("lockStatus");

-- CreateIndex
CREATE INDEX "ProductImage_productIdentityId_idx" ON "ProductImage"("productIdentityId");

-- CreateIndex
CREATE INDEX "ProductImage_viewType_idx" ON "ProductImage"("viewType");

-- CreateIndex
CREATE INDEX "ProductQcResult_productIdentityId_idx" ON "ProductQcResult"("productIdentityId");

-- CreateIndex
CREATE INDEX "ProductQcResult_assetRecordId_idx" ON "ProductQcResult"("assetRecordId");

-- CreateIndex
CREATE INDEX "ProductQcResult_passFail_idx" ON "ProductQcResult"("passFail");

-- CreateIndex
CREATE UNIQUE INDEX "PcdIdentitySnapshot_assetRecordId_key" ON "PcdIdentitySnapshot"("assetRecordId");

-- CreateIndex
CREATE INDEX "PcdIdentitySnapshot_productIdentityId_idx" ON "PcdIdentitySnapshot"("productIdentityId");

-- CreateIndex
CREATE INDEX "PcdIdentitySnapshot_creatorIdentityId_idx" ON "PcdIdentitySnapshot"("creatorIdentityId");

-- CreateIndex
CREATE INDEX "PcdIdentitySnapshot_selectedProvider_idx" ON "PcdIdentitySnapshot"("selectedProvider");

-- CreateIndex
CREATE INDEX "CreativeJob_productIdentityId_idx" ON "CreativeJob"("productIdentityId");

-- CreateIndex
CREATE INDEX "CreativeJob_creatorIdentityId_idx" ON "CreativeJob"("creatorIdentityId");

-- CreateIndex
CREATE INDEX "CreativeJob_registryBackfilled_idx" ON "CreativeJob"("registryBackfilled");

-- CreateIndex
CREATE INDEX "CreatorIdentity_qualityTier_idx" ON "CreatorIdentity"("qualityTier");

-- CreateIndex
CREATE INDEX "CreatorIdentity_consentRecordId_idx" ON "CreatorIdentity"("consentRecordId");

-- AddForeignKey
ALTER TABLE "CreativeJob" ADD CONSTRAINT "CreativeJob_productIdentityId_fkey" FOREIGN KEY ("productIdentityId") REFERENCES "ProductIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorIdentity" ADD CONSTRAINT "CreatorIdentity_consentRecordId_fkey" FOREIGN KEY ("consentRecordId") REFERENCES "ConsentRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productIdentityId_fkey" FOREIGN KEY ("productIdentityId") REFERENCES "ProductIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductQcResult" ADD CONSTRAINT "ProductQcResult_productIdentityId_fkey" FOREIGN KEY ("productIdentityId") REFERENCES "ProductIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PcdIdentitySnapshot" ADD CONSTRAINT "PcdIdentitySnapshot_assetRecordId_fkey" FOREIGN KEY ("assetRecordId") REFERENCES "AssetRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PcdIdentitySnapshot" ADD CONSTRAINT "PcdIdentitySnapshot_productIdentityId_fkey" FOREIGN KEY ("productIdentityId") REFERENCES "ProductIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PcdIdentitySnapshot" ADD CONSTRAINT "PcdIdentitySnapshot_creatorIdentityId_fkey" FOREIGN KEY ("creatorIdentityId") REFERENCES "CreatorIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
