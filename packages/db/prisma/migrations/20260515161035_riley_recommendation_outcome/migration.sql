-- CreateTable
CREATE TABLE "RecommendationOutcome" (
    "id" TEXT NOT NULL,
    "recommendationId" TEXT NOT NULL,
    "executableWorkUnitId" TEXT,
    "organizationId" TEXT NOT NULL,
    "agentRole" TEXT NOT NULL,
    "actionKind" TEXT NOT NULL,
    "anchorAt" TIMESTAMP(3) NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "windowEndedAt" TIMESTAMP(3) NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attributionMethod" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "cockpitRenderable" BOOLEAN NOT NULL DEFAULT false,
    "metricSummary" JSONB NOT NULL,
    "copyTemplate" TEXT,
    "copyValues" JSONB,
    "visibilityFlags" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecommendationOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecommendationOutcome_recommendationId_key" ON "RecommendationOutcome"("recommendationId");

-- CreateIndex
CREATE INDEX "RecommendationOutcome_organizationId_agentRole_actionKind_w_idx" ON "RecommendationOutcome"("organizationId", "agentRole", "actionKind", "windowEndedAt");

-- CreateIndex
CREATE INDEX "RecommendationOutcome_organizationId_agentRole_cockpitRende_idx" ON "RecommendationOutcome"("organizationId", "agentRole", "cockpitRenderable", "windowEndedAt");

-- CreateIndex
CREATE INDEX "RecommendationOutcome_executableWorkUnitId_idx" ON "RecommendationOutcome"("executableWorkUnitId");

-- AddForeignKey
ALTER TABLE "RecommendationOutcome" ADD CONSTRAINT "RecommendationOutcome_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "PendingActionRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
