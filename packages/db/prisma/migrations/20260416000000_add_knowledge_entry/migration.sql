-- CreateEnum
CREATE TYPE "KnowledgeKind" AS ENUM ('playbook', 'policy', 'knowledge');

-- CreateTable
CREATE TABLE "KnowledgeEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "KnowledgeKind" NOT NULL,
    "scope" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeEntry_organizationId_kind_scope_version_key" ON "KnowledgeEntry"("organizationId", "kind", "scope", "version");

-- CreateIndex
CREATE INDEX "KnowledgeEntry_organizationId_kind_scope_active_idx" ON "KnowledgeEntry"("organizationId", "kind", "scope", "active");
