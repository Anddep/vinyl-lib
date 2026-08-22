import bcrypt from 'bcryptjs';

const password = process.argv[2];

if (!password) {
  console.error("Usage: npm run admin:hash -w server -- 'your password'");
  process.exit(1);
}

const MIN_LENGTH = 4;

if (password.length < MIN_LENGTH) {
  console.error(`Use at least ${MIN_LENGTH} characters.`);
  process.exit(1);
}

console.log(bcrypt.hashSync(password, 12));
