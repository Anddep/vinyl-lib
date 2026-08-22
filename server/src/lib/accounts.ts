import { Prisma } from '@prisma/client';
import { bootstrapOwnerEmail, maxSignupsPerHour, signupMode } from '../config/env';
import { prisma } from '../prisma/client';
import type { OAuthProfile, ProviderId } from './oauth/providers';
import { freeUserSlug } from './userSlug';

export type SignInFailure =
  'email_unverified' | 'suspended' | 'signup_closed' | 'invite_required' | 'signup_throttled';

export type SignInResult = { ok: true; userId: number } | { ok: false; reason: SignInFailure };

/** Transaction client — every query below runs inside one. */
type Tx = Prisma.TransactionClient;

const MAX_DISPLAY_NAME = 80;

/**
 * A display name is rendered in the admin chrome and returned by the public
 * profile endpoint, so it is bounded and cleaned here, at the single point
 * where a provider's string enters the database.
 *
 * \p{C} covers control, format and surrogate code points. The format ones
 * matter as much as the control ones: a bidi override would let a name render
 * as something other than what it contains.
 */
function cleanDisplayName(raw: string): string {
  const stripped = raw.replace(/\p{C}/gu, '').trim();
  return (stripped.length > 0 ? stripped : 'Collector').slice(0, MAX_DISPLAY_NAME);
}

function gate(user: { id: number; suspendedAt: Date | null }): SignInResult {
  return user.suspendedAt === null
    ? { ok: true, userId: user.id }
    : { ok: false, reason: 'suspended' };
}

async function attempt(
  provider: ProviderId,
  profile: OAuthProfile,
  email: string,
  invite: string | null,
): Promise<SignInResult> {
  return prisma.$transaction(async (tx: Tx): Promise<SignInResult> => {
    // 1. A provider account we have seen before. Every repeat sign-in ends here,
    //    which is what stops the claim and the invite below firing twice.
    const identity = await tx.oAuthIdentity.findUnique({
      where: { provider_providerUserId: { provider, providerUserId: profile.providerUserId } },
      include: { user: true },
    });
    if (identity) {
      return gate(identity.user);
    }

    const displayName = cleanDisplayName(profile.displayName);

    // 2. The same person arriving through their second provider.
    const byEmail = await tx.user.findUnique({ where: { email } });
    if (byEmail) {
      if (byEmail.suspendedAt !== null) {
        // Refuse before linking: an identity attached now would be a way back in.
        return { ok: false, reason: 'suspended' };
      }
      await tx.oAuthIdentity.create({
        data: { provider, providerUserId: profile.providerUserId, userId: byEmail.id },
      });
      return gate(byEmail);
    }

    // 3. The bootstrap claim. `email: null` can match at most once, so a second
    //    attempt updates nothing and falls through to step 4.
    const configured = bootstrapOwnerEmail();
    if (configured !== null && configured === email) {
      const claimed = await tx.user.updateMany({
        where: { bootstrap: true, email: null },
        data: { email, displayName, avatarUrl: profile.avatarUrl },
      });
      if (claimed.count === 1) {
        const owner = await tx.user.findUniqueOrThrow({ where: { email } });
        await tx.oAuthIdentity.create({
          data: { provider, providerUserId: profile.providerUserId, userId: owner.id },
        });
        return gate(owner);
      }
    }

    // 4. A genuinely new account, if the gate allows one.
    const mode = signupMode();
    if (mode === 'closed') {
      return { ok: false, reason: 'signup_closed' };
    }

    // Everything above this line resolves to an existing account, so a
    // returning collector is never throttled — only genuinely new ones are.
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    if ((await tx.user.count({ where: { createdAt: { gte: hourAgo } } })) >= maxSignupsPerHour()) {
      return { ok: false, reason: 'signup_throttled' };
    }

    let inviteId: number | null = null;
    if (mode === 'invite') {
      const row = invite === null ? null : await tx.invite.findUnique({ where: { code: invite } });
      const usable =
        row !== null &&
        row.redeemedById === null &&
        (row.expiresAt === null || row.expiresAt > new Date());
      if (!usable) {
        // One answer for unknown, expired and spent alike: a caller must not be
        // able to probe which codes exist.
        return { ok: false, reason: 'invite_required' };
      }
      inviteId = row.id;
    }

    const created = await tx.user.create({
      data: {
        slug: await freeUserSlug(tx, displayName),
        displayName,
        email,
        avatarUrl: profile.avatarUrl,
        identities: { create: { provider, providerUserId: profile.providerUserId } },
      },
    });

    if (inviteId !== null) {
      // redeemedById is unique, so a racing redemption fails here rather than
      // handing one code to two accounts.
      await tx.invite.update({
        where: { id: inviteId },
        data: { redeemedById: created.id, redeemedAt: new Date() },
      });
    }

    return { ok: true, userId: created.id };
  });
}

/**
 * Decides which account a provider profile belongs to, creating one if the
 * signup gate allows it.
 *
 * An unverified email never reaches the linking logic and is never stored:
 * linking by email is only as safe as the provider's verification claim, so a
 * provider that will not make the claim gets no account at all.
 */
export async function resolveSignIn(
  provider: ProviderId,
  profile: OAuthProfile,
  invite: string | null,
): Promise<SignInResult> {
  if (!profile.emailVerified || profile.email === null) {
    return { ok: false, reason: 'email_unverified' };
  }
  const email = profile.email.trim().toLowerCase();

  try {
    return await attempt(provider, profile, email, invite);
  } catch (error) {
    // Two callbacks for one new address can both reach step 4; the loser
    // violates User.email's unique index. Retrying finds the winner at step 2.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return attempt(provider, profile, email, invite);
    }
    throw error;
  }
}
