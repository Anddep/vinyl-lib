-- AlterTable
ALTER TABLE "Record" DROP COLUMN "label",
DROP COLUMN "note";

-- DropTable
DROP TABLE "FaqItem";

-- CreateTable
-- Declared so future `migrate diff` runs stop proposing to drop the session
-- table that connect-pg-simple creates at runtime.
CREATE TABLE IF NOT EXISTS "session" (
    "sid" TEXT NOT NULL,
    "sess" JSONB NOT NULL,
    "expire" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session"("expire");
