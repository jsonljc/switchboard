-- AlterTable
ALTER TABLE "OrganizationConfig" ADD COLUMN     "websiteTrackingToken" TEXT;

-- CreateTable
CREATE TABLE "ReportCache" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "window" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PdfCache" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "window" TEXT NOT NULL,
    "pdfBytes" BYTEA NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PdfCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreSwitchboardBaseline" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreSwitchboardBaseline_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportCache_expiresAt_idx" ON "ReportCache"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReportCache_organizationId_window_key" ON "ReportCache"("organizationId", "window");

-- CreateIndex
CREATE INDEX "PdfCache_expiresAt_idx" ON "PdfCache"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PdfCache_organizationId_window_key" ON "PdfCache"("organizationId", "window");

-- CreateIndex
CREATE INDEX "PreSwitchboardBaseline_organizationId_dimension_metric_idx" ON "PreSwitchboardBaseline"("organizationId", "dimension", "metric");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationConfig_websiteTrackingToken_key" ON "OrganizationConfig"("websiteTrackingToken");

