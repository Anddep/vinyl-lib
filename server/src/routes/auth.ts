import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env';
import { asyncHandler } from '../lib/asyncHandler';

export const authRouter = Router();

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_ATTEMPTS = 10;

/**
 * One password guards every write on the site, so throttle guessing.
 *
 * Exported as a factory because the limiter is stateful per instance: the
 * suite would otherwise exhaust the real allowance part-way through and every
 * later login would 429 for reasons unrelated to the test.
 */
export function createLoginLimiter(limit = LOGIN_MAX_ATTEMPTS) {
  return rateLimit({
    windowMs: LOGIN_WINDOW_MS,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Try again later.' },
  });
}

// Every Supertest request shares one IP, so the suite runs with the limiter
// mounted but effectively open; its threshold is covered by its own test.
const loginLimiter = createLoginLimiter(
  env.NODE_ENV === 'test' ? Number.MAX_SAFE_INTEGER : LOGIN_MAX_ATTEMPTS,
);

authRouter.post(
  '/auth/login',
  loginLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const password: unknown = req.body?.password;

    // Explicit typeof: a JSON body can carry an object here, and passing one
    // to bcrypt.compare would throw rather than simply fail to match.
    if (typeof password !== 'string' || password.length === 0) {
      res.status(400).json({ error: 'Password is required' });
      return;
    }

    const valid = await bcrypt.compare(password, env.ADMIN_PASSWORD_HASH);
    if (!valid) {
      // Deliberately identical for every failure — no hint about closeness.
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    req.session.isAdmin = true;
    res.status(204).end();
  }),
);

authRouter.post('/auth/logout', (req: Request, res: Response) => {
  // destroy() removes the row from the session store, so the cookie is dead
  // even if someone kept a copy.
  req.session.destroy(() => res.status(204).end());
});

authRouter.get('/auth/me', (req: Request, res: Response) => {
  res.json({ authenticated: req.session.isAdmin === true });
});
