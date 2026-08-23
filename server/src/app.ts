import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { env, trustProxyHops } from './config/env';
import { healthRouter } from './routes/health';
import { accountRouter } from './routes/account';
import { authRouter } from './routes/auth';
import { recordsRouters } from './routes/records';
import { statsRouters } from './routes/stats';
import { wishlistRouters } from './routes/wishlist';
import { setupRouters } from './routes/setup';
import { settingsRouters } from './routes/settings';
import { publicReadLimiter, writeLimiter } from './lib/limiters';
import { publicCollectionRouter } from './routes/publicCollection';
import { sameOrigin } from './middleware/sameOrigin';
import { UPLOAD_DIR, uploadsRouter } from './routes/uploads';

const PgStore = connectPgSimple(session);

export const app = express();

// Count the proxies in front of us, do not guess. In the public deployment
// Caddy terminates TLS and forwards to the client nginx, which forwards here —
// two hops. Laptop prod mode has only nginx, so it is one, which is the default.
//
// A count rather than `true`: `trust proxy: true` makes Express believe the
// leftmost X-Forwarded-For entry, and the client writes that header. Both
// failure modes here are silent — too few hops and req.ip is a bridge address,
// so every per-IP limiter shares one bucket and the Secure cookie is never set;
// too many, or `true`, and a visitor can forge the address they are limited by.
app.set('trust proxy', trustProxyHops());

app.use(helmet());
// No CORS middleware. The site and its API are same-origin in both
// environments — the Vite dev server proxies /api, nginx proxies it in
// production — so a CORS header would only ever grant access to origins
// that should not have it, and every write here carries a session cookie.
app.use(express.json());
app.use(
  session({
    name: 'sid',
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    // Sessions live in Postgres so logout genuinely revokes; a stateless
    // signed cookie would stay valid until it expired no matter what.
    store: new PgStore({
      conString: env.DATABASE_URL,
      tableName: 'session',
      createTableIfMissing: true,
    }),
    cookie: {
      httpOnly: true,
      // Lax, not Strict. The OAuth callback is a cross-site top-level
      // navigation, and Strict withholds the cookie from exactly that — so the
      // session carrying the state and PKCE verifier would never arrive and
      // every sign-in would fail validation. Lax still withholds the cookie
      // from cross-site non-GET requests, which is every write here; the
      // sameOrigin middleware and the OAuth state parameter cover the rest.
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
);
app.use(sameOrigin);

// Silenced under test: morgan would print a request line per assertion.
if (env.NODE_ENV !== 'test') {
  app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

app.use('/api', healthRouter);
app.use('/api', authRouter);
app.use('/api', accountRouter);

// Someone else's collection, by slug. Read-only: the write routes live on the
// own tree, where the owner comes from the session rather than the URL.
app.use('/api/u/:slug', publicReadLimiter(), publicCollectionRouter);

// Non-GET only: a limiter on reads would punish the admin screens, which fetch
// several endpoints per page load. One instance at module scope, so the store
// persists across requests rather than starting fresh each time.
const writes = writeLimiter();
app.use('/api', (req, res, next) => (req.method === 'GET' ? next() : writes(req, res, next)));

// The signed-in user's own collection. Every route inside carries requireUser
// individually, so an unknown /api path still reaches the 404 handler below
// rather than answering 401.
app.use('/api', recordsRouters.own);
app.use('/api', statsRouters.own);
app.use('/api', wishlistRouters.own);
app.use('/api', setupRouters.own);
app.use('/api', settingsRouters.own);
app.use('/api', uploadsRouter);

// Uploaded covers. index:false and dotfiles:deny so the directory is not
// browsable and a stray dotfile cannot be served.
app.use('/uploads', express.static(UPLOAD_DIR, { index: false, dotfiles: 'deny' }));

app.use((req: Request, res: Response) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});
