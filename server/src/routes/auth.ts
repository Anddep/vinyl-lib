import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../lib/asyncHandler';
import { resolveSignIn } from '../lib/accounts';
import { authorizeUrl, exchangeCode } from '../lib/oauth/flow';
import { challengeFor, randomToken } from '../lib/oauth/pkce';
import { configuredProviders, getProvider } from '../lib/oauth/providers';
import { oauthCallbackLimiter, oauthStartLimiter } from '../lib/limiters';
import { prisma } from '../prisma/client';

export const authRouter = Router();

/**
 * Where to land after signing in.
 *
 * Only app-relative paths, and never protocol-relative: `//evil.example` is a
 * valid absolute URL to a browser, so `startsWith('/')` alone is not a check.
 */
function safeReturnTo(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) {
    return null;
  }
  return raw;
}

authRouter.get('/auth/providers', (_req: Request, res: Response) => {
  res.json(configuredProviders().map((provider) => provider.id));
});

// Declared before the '/auth/:provider' routes below: Express matches in order,
// so a wildcard segment would otherwise swallow /auth/me as a provider named
// "me" and answer 404.
authRouter.get(
  '/auth/me',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.session.userId;
    if (typeof userId !== 'number') {
      // "Nobody" is a valid answer to "who am I", not an error.
      res.json({ user: null });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.suspendedAt !== null) {
      res.json({ user: null });
      return;
    }

    // Deliberately not the email: the session cookie is the credential, and the
    // address is not something the client needs to render anything.
    res.json({
      user: {
        id: user.id,
        slug: user.slug,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        isPublic: user.isPublic,
      },
    });
  }),
);

authRouter.get(
  '/auth/:provider',
  oauthStartLimiter(),
  asyncHandler(async (req: Request, res: Response) => {
    const provider = getProvider(req.params.provider);
    if (!provider) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const state = randomToken();
    const verifier = provider.usesPkce ? randomToken() : null;

    req.session.oauth = {
      provider: provider.id,
      state,
      verifier,
      returnTo: safeReturnTo(req.query.next),
      // Carried through the round trip and validated only at redemption, so an
      // invalid code cannot be probed before the caller has authenticated.
      invite: typeof req.query.invite === 'string' ? req.query.invite : null,
    };

    // Saved explicitly: the browser leaves for the provider the moment this
    // response lands, and an unwritten session would lose the state.
    req.session.save(() => {
      res.redirect(
        authorizeUrl(provider, { state, challenge: verifier ? challengeFor(verifier) : null }),
      );
    });
  }),
);

authRouter.get(
  '/auth/:provider/callback',
  oauthCallbackLimiter(),
  asyncHandler(async (req: Request, res: Response) => {
    const handshake = req.session.oauth ?? null;
    // Consumed before anything can fail, so a replay finds nothing. Single use,
    // not merely single valued.
    delete req.session.oauth;

    const provider = getProvider(req.params.provider);
    if (!provider) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    // Told apart deliberately. No handshake at all is overwhelmingly a cookie
    // that did not come back — the visitor started at a different origin than
    // PUBLIC_BASE_URL, localhost against 127.0.0.1 being the classic — and that
    // has a specific fix. A handshake whose state does not match is the case
    // the parameter exists for.
    if (handshake === null) {
      res.redirect('/?error=no_session');
      return;
    }

    const state = req.query.state;
    if (
      handshake.provider !== provider.id ||
      typeof state !== 'string' ||
      state !== handshake.state
    ) {
      res.redirect('/?error=state');
      return;
    }

    const code = req.query.code;
    if (typeof code !== 'string') {
      // The user pressed cancel at the provider, or the provider sent an error.
      res.redirect('/?error=denied');
      return;
    }

    let result;
    try {
      const token = await exchangeCode(provider, { code, verifier: handshake.verifier });
      const profile = await provider.fetchProfile(token);
      result = await resolveSignIn(provider.id, profile, handshake.invite);
    } catch {
      // A provider outage or a bad code is not a 500 for the visitor: they are
      // mid-navigation, and a raw error object is a dead end.
      res.redirect('/?error=provider');
      return;
    }

    if (!result.ok) {
      res.redirect(`/?error=${result.reason}`);
      return;
    }

    const returnTo = handshake.returnTo ?? '/admin';
    const { userId } = result;

    // A new session id: the callback is reachable cross-site under SameSite=Lax,
    // so a pre-seeded session must not be promoted to an authenticated one.
    req.session.regenerate((error) => {
      if (error) {
        res.redirect('/?error=session');
        return;
      }
      req.session.userId = userId;
      req.session.save(() => res.redirect(returnTo));
    });
  }),
);

authRouter.post('/auth/logout', (req: Request, res: Response) => {
  // destroy() removes the row from the session store, so the cookie is dead
  // even if someone kept a copy.
  req.session.destroy(() => res.status(204).end());
});
