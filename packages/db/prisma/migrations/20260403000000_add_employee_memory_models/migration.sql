-- CreateTable
CREATE TABLE "EmployeeRegistration" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeSkill" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "evidence" TEXT[],
    "channel" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "performanceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "embedding" vector(1024),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeePerformanceEvent" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "feedback" TEXT,
    "metrics" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeePerformanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentDraft" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "feedback" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "parentDraftId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentCalendarEntry" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "draftId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentCalendarEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeRegistration_employeeId_organizationId_key" ON "EmployeeRegistration"("employeeId", "organizationId");

-- CreateIndex
CREATE INDEX "EmployeeSkill_employeeId_organizationId_idx" ON "EmployeeSkill"("employeeId", "organizationId");

-- CreateIndex
CREATE INDEX "EmployeePerformanceEvent_employeeId_organizationId_idx" ON "EmployeePerformanceEvent"("employeeId", "organizationId");

-- CreateIndex
CREATE INDEX "EmployeePerformanceEvent_contentId_idx" ON "EmployeePerformanceEvent"("contentId");

-- CreateIndex
CREATE INDEX "ContentDraft_employeeId_organizationId_status_idx" ON "ContentDraft"("employeeId", "organizationId", "status");

-- CreateIndex
CREATE INDEX "ContentCalendarEntry_organizationId_scheduledFor_idx" ON "ContentCalendarEntry"("organizationId", "scheduledFor");
