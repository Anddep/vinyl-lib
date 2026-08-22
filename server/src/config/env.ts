interface Env {
  NODE_ENV: string;
  PORT: number;
  DATABASE_URL: string;
  SESSION_SECRET: string;
  /**
   * The origin the browser sees. Required, not inferred: the OAuth redirect_uri
   * must match what is registered at the provider byte-for-byte, and behind two
   * different proxies the server cannot work it out reliably.
   */
  PUBLIC_BASE_URL: string;
}

export type SignupMode = 'closed' | 'invite' | 'open';

export interface Limits {
  maxUploadBytes: number;
  uploadQuotaBytes: number;
  maxRecords: number;
  maxWishlist: number;
  maxSetup: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

/**
 * Compose substitutes an empty string for an unset variable, and Number('') is
 * 0 rather than NaN — so an unset SERVER_PORT would silently bind the server to
 * a random ephemeral port instead of failing. Treat empty as absent.
 */
export function parsePort(raw: string | undefined): number {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return 4000;
  }
  const parsed = Number(trimmed);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid PORT environment variable: ${raw}`);
  }
  return parsed;
}

/**
 * A positive integer ceiling, with the same empty-string caution as parsePort.
 *
 * Zero and negatives fall back rather than applying: a quota of 0 would refuse
 * every upload, which reads as a broken app rather than as a configured limit.
 * A non-numeric value throws, because it is a typo the operator should see.
 */
export function parseCount(raw: string | undefined, fallback: number): number {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return fallback;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric environment variable: ${raw}`);
  }
  return parsed > 0 ? Math.floor(parsed) : fallback;
}

export const env: Env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: parsePort(process.env.PORT),
  DATABASE_URL: required('DATABASE_URL'),
  SESSION_SECRET: required('SESSION_SECRET'),
  PUBLIC_BASE_URL: required('PUBLIC_BASE_URL'),
};

const SIGNUP_MODES: readonly SignupMode[] = ['closed', 'invite', 'open'];

/**
 * Read at call time rather than frozen onto `env`, so a test can vary it with
 * vi.stubEnv and so flipping the gate in production is a restart, not a build.
 *
 * Defaults to `invite`: an operator who has not thought about signup should not
 * discover they have opened one.
 */
export function signupMode(): SignupMode {
  const raw = optional('SIGNUP_MODE');
  if (raw === null) {
    return 'invite';
  }
  if (!SIGNUP_MODES.includes(raw as SignupMode)) {
    throw new Error(`Invalid SIGNUP_MODE: ${raw}. Expected closed, invite or open.`);
  }
  return raw as SignupMode;
}

/** Lowercased, because it is compared against an address a provider supplies. */
export function bootstrapOwnerEmail(): string | null {
  return optional('BOOTSTRAP_OWNER_EMAIL')?.toLowerCase() ?? null;
}

export function limits(): Limits {
  return {
    maxUploadBytes: parseCount(process.env.MAX_UPLOAD_BYTES, 5 * 1024 * 1024),
    uploadQuotaBytes: parseCount(process.env.UPLOAD_QUOTA_BYTES, 150 * 1024 * 1024),
    maxRecords: parseCount(process.env.MAX_RECORDS_PER_USER, 5000),
    maxWishlist: parseCount(process.env.MAX_WISHLIST_PER_USER, 500),
    maxSetup: parseCount(process.env.MAX_SETUP_PER_USER, 100),
  };
}
