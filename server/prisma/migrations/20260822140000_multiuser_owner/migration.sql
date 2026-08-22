-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "avatarUrl" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "suspendedAt" TIMESTAMP(3),
    "bootstrap" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthIdentity" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "issuedById" INTEGER,
    "redeemedById" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedAt" TIMESTAMP(3),

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Upload" (
    "id" SERIAL NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_slug_key" ON "User"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "OAuthIdentity_userId_idx" ON "OAuthIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthIdentity_provider_providerUserId_key" ON "OAuthIdentity"("provider", "providerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Invite_code_key" ON "Invite"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Invite_redeemedById_key" ON "Invite"("redeemedById");

-- CreateIndex
CREATE UNIQUE INDEX "Upload_path_key" ON "Upload"("path");

-- CreateIndex
CREATE INDEX "Upload_ownerId_idx" ON "Upload"("ownerId");

-- The bootstrap owner. Inserted unconditionally: on an empty database the
-- backfill below updates nothing, but the foreign keys must still be
-- satisfiable, and the claim in lib/accounts.ts needs a row to claim.
INSERT INTO "User" ("slug", "displayName", "bootstrap", "updatedAt")
VALUES ('collection', 'The Collection', true, CURRENT_TIMESTAMP);

-- AddColumn, nullable, so existing rows survive the statement.
ALTER TABLE "Record" ADD COLUMN "ownerId" INTEGER;
ALTER TABLE "WishlistItem" ADD COLUMN "ownerId" INTEGER;
ALTER TABLE "SetupItem" ADD COLUMN "ownerId" INTEGER;
ALTER TABLE "SiteSetting" ADD COLUMN "ownerId" INTEGER;

-- Backfill every existing row to the bootstrap owner.
UPDATE "Record" SET "ownerId" = (SELECT "id" FROM "User" WHERE "bootstrap");
UPDATE "WishlistItem" SET "ownerId" = (SELECT "id" FROM "User" WHERE "bootstrap");
UPDATE "SetupItem" SET "ownerId" = (SELECT "id" FROM "User" WHERE "bootstrap");
UPDATE "SiteSetting" SET "ownerId" = (SELECT "id" FROM "User" WHERE "bootstrap");

-- Only now can it be required.
ALTER TABLE "Record" ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "WishlistItem" ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "SetupItem" ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "SiteSetting" ALTER COLUMN "ownerId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "OAuthIdentity" ADD CONSTRAINT "OAuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_redeemedById_fkey" FOREIGN KEY ("redeemedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Record" ADD CONSTRAINT "Record_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SetupItem" ADD CONSTRAINT "SetupItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteSetting" ADD CONSTRAINT "SiteSetting_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Record.slug becomes unique per owner rather than site-wide.
DROP INDEX "Record_slug_key";
CREATE UNIQUE INDEX "Record_ownerId_slug_key" ON "Record"("ownerId", "slug");

-- Owner-leading indexes replace the standalone ones.
DROP INDEX "Record_addedAt_idx";
DROP INDEX "Record_position_idx";
CREATE INDEX "Record_ownerId_addedAt_idx" ON "Record"("ownerId", "addedAt");
CREATE INDEX "Record_ownerId_position_idx" ON "Record"("ownerId", "position");
CREATE INDEX "WishlistItem_ownerId_position_idx" ON "WishlistItem"("ownerId", "position");
CREATE INDEX "SetupItem_ownerId_position_idx" ON "SetupItem"("ownerId", "position");

-- SiteSetting: key alone is no longer unique.
ALTER TABLE "SiteSetting" DROP CONSTRAINT "SiteSetting_pkey";
ALTER TABLE "SiteSetting" ADD CONSTRAINT "SiteSetting_pkey" PRIMARY KEY ("ownerId", "key");
