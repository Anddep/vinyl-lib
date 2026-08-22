interface Env {
  NODE_ENV: string;
  PORT: number;
  DATABASE_URL: string;
  SESSION_SECRET: string;
  ADMIN_PASSWORD_HASH: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
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

export const env: Env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: parsePort(process.env.PORT),
  DATABASE_URL: required('DATABASE_URL'),
  SESSION_SECRET: required('SESSION_SECRET'),
  ADMIN_PASSWORD_HASH: required('ADMIN_PASSWORD_HASH'),
};
