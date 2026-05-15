-- AlterTable
ALTER TABLE "WorkTrace" ADD COLUMN     "injectedPatternIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
