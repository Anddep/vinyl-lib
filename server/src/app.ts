import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { env } from './config/env';
import { healthRouter } from './routes/health';
import { authRouter } from './routes/auth';
import { recordsRouter } from './routes/records';
import { statsRouter } from './routes/stats';
import { wishlistRouter } from './routes/wishlist';
import { setupRouter } from './routes/setup';
import { settingsRouter } from './routes/settings';
import { UPLOAD_DIR, uploadsRouter } from './routes/uploads';

const PgStore = connectPgSimple(session);

export const app = express();

// nginx terminates TLS in production; without this Express sees plain HTTP
// and refuses to set a Secure cookie.
app.set('trust proxy', 1);

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
      sameSite: 'strict',
      secure: env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
);
// Silenced under test: morgan would print a request line per assertion.
if (env.NODE_ENV !== 'test') {
  app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

app.use('/api', healthRouter);
app.use('/api', authRouter);
app.use('/api', recordsRouter);
app.use('/api', statsRouter);
app.use('/api', wishlistRouter);
app.use('/api', setupRouter);
app.use('/api', settingsRouter);
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
