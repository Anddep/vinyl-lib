import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

/**
 * Truncate every content table between tests. RESTART IDENTITY keeps
 * autoincrement ids predictable so assertions on `id` stay stable, and
 * CASCADE saves listing dependents as relations get added.
 */
export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Record", "WishlistItem", "SetupItem", "SiteSetting", "Upload", "Invite", "OAuthIdentity", "User" RESTART IDENTITY CASCADE',
  );
}
