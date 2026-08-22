/**
 * Hashes a new admin password and writes it straight into .env.
 *
 * Doing the write here rather than printing a hash to copy removes the
 * sharpest edge in the setup: Docker Compose interpolates `$` in .env values,
 * and a bcrypt hash is almost entirely `$`. A hash pasted verbatim reaches the
 * container blank, and every login then fails as "Invalid credentials" —
 * indistinguishable from simply getting the password wrong.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

const MIN_LENGTH = 4;
const KEY = 'ADMIN_PASSWORD_HASH';

const password = process.argv[2];
// Overridable so the test can point at a scratch file instead of the real one.
const envPath = process.env.ENV_FILE ?? path.join(__dirname, '..', '..', '.env');

if (!password) {
  console.error("Usage: npm run admin:set-password -w server -- 'your password'");
  process.exit(1);
}

if (password.length < MIN_LENGTH) {
  console.error(`Use at least ${MIN_LENGTH} characters.`);
  process.exit(1);
}

let env: string;
try {
  env = readFileSync(envPath, 'utf8');
} catch {
  console.error(`Could not read ${envPath}. Copy .env.example to .env first.`);
  process.exit(1);
}

// Compose reads `$$` as a literal `$`, so double them on the way in.
const escaped = bcrypt.hashSync(password, 12).replace(/\$/g, '$$$$');
const line = `${KEY}=${escaped}`;

const pattern = new RegExp(`^${KEY}=.*$`, 'm');
// Replacer function, not a replacement string: `$$` in a replacement string
// means a literal `$`, which would silently undo the escaping just added.
const next = pattern.test(env)
  ? env.replace(pattern, () => line)
  : `${env.replace(/\n*$/, '\n')}${line}\n`;

writeFileSync(envPath, next);

console.log(`Updated ${KEY} in ${envPath}`);
console.log('Restart the server for it to take effect:');
console.log('  docker compose up -d server');
console.log('');
console.log('Existing sessions stay signed in. To sign everyone out as well:');
console.log('  docker compose exec db psql -U vinyl_lib -c "DELETE FROM session;"');
