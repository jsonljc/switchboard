-- CreateTable
CREATE TABLE "CreativeJob" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "productDescription" TEXT NOT NULL,
    "targetAudience" TEXT NOT NULL,
    "platforms" TEXT[],
    "brandVoice" TEXT,
    "productImages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "references" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pastPerformance" JSONB,
    "currentStage" TEXT NOT NULL DEFAULT 'trends',
    "stageOutputs" JSONB NOT NULL DEFAULT '{}',
    "stoppedAt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreativeJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreativeJob_taskId_key" ON "CreativeJob"("taskId");

-- CreateIndex
CREATE INDEX "CreativeJob_organizationId_idx" ON "CreativeJob"("organizationId");

-- AddForeignKey
ALTER TABLE "CreativeJob" ADD CONSTRAINT "CreativeJob_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AgentTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
