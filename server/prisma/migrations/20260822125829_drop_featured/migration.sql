-- DropIndex
DROP INDEX "Record_featured_position_idx";

-- AlterTable
ALTER TABLE "Record" DROP COLUMN "featured";

-- CreateIndex
CREATE INDEX "Record_position_idx" ON "Record"("position");

