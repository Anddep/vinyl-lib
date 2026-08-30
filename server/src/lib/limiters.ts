import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { env } from '../config/env';

const MINUTE = 60 * 1000;

interface LimiterOptions {
  windowMs: number;
  limit: number;
  /** Apply the real threshold under test. Only the limiter's own test needs it. */
  force?: boolean;
}

/**
 * A per-IP limiter.
 *
 * Keyed on `req.ip`, which is the real client address only because `app.ts`
 * trusts exactly as many proxies as there are (TRUST_PROXY_HOPS). Undercount
 * and every request behind the proxy chain shares one key, which makes every
 * limit here meaningless without anything appearing to be wrong.
 *
 * The default memory store is process-local. That is the whole application
 * today, one container; if this is ever run as two replicas the limits halve in
 * effectiveness and need a shared store. Said out loud in the README too.
 */
export function createLimiter({ windowMs, limit, force }: LimiterOptions): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    // Every Supertest request shares one IP, so the suite would otherwise
    // exhaust a real allowance part-way through and fail for reasons unrelated
    // to the test. The thresholds themselves are covered by limiters.test.ts,
    // which opts in with `force` and builds its own app.
    limit: env.NODE_ENV === 'test' && !force ? Number.MAX_SAFE_INTEGER : limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Try again later.' },
  });
}

/** Stops the session table filling with abandoned OAuth handshakes. */
export const oauthStartLimiter = (): RateLimitRequestHandler =>
  createLimiter({ windowMs: 15 * MINUTE, limit: 20 });

/** Code and state spraying against the callback. */
export const oauthCallbackLimiter = (): RateLimitRequestHandler =>
  createLimiter({ windowMs: 15 * MINUTE, limit: 20 });

/** Runaway scripted editing. */
export const writeLimiter = (): RateLimitRequestHandler =>
  createLimiter({ windowMs: 15 * MINUTE, limit: 300 });

/** Bulk scraping of public collections. */
export const publicReadLimiter = (): RateLimitRequestHandler =>
  createLimiter({ windowMs: 15 * MINUTE, limit: 600 });

/** Pairs with the byte quota: bounds the request rate as well as the volume. */
export const uploadLimiter = (): RateLimitRequestHandler =>
  createLimiter({ windowMs: 60 * MINUTE, limit: 60 });
