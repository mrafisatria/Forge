// Run locally. The secret is read from stdin, never embedded in source or args.
// Treat the output hash as sensitive administration data; do not commit it.
import bcrypt from 'bcryptjs';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const secret = input.trim();
if (!secret || Buffer.byteLength(secret, 'utf8') > 72) {
  console.error('Secret must be 1–72 UTF-8 bytes.');
  process.exitCode = 1;
} else {
  // pgcrypto's Blowfish crypt format is variant 2a.
  const salt = (await bcrypt.genSalt(12)).replace('$2b$', '$2a$');
  process.stdout.write(await bcrypt.hash(secret, salt));
}
