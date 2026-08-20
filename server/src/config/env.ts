interface Env {
  NODE_ENV: string;
  PORT: number;
  DATABASE_URL: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env: Env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: Number(process.env.PORT ?? 4000),
  DATABASE_URL: required('DATABASE_URL'),
};

if (Number.isNaN(env.PORT)) {
  throw new Error(`Invalid PORT environment variable: ${process.env.PORT}`);
}
