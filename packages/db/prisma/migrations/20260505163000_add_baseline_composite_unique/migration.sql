-- CreateIndex
CREATE UNIQUE INDEX "PreSwitchboardBaseline_organizationId_dimension_metric_period_key" ON "PreSwitchboardBaseline"("organizationId", "dimension", "metric", "periodStart", "periodEnd");
