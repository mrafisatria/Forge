import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import bcrypt from 'bcryptjs';

test('account hash generator emits pgcrypto-compatible bcrypt without plaintext', async () => {
  const fixture = 'not-a-real-account-secret';
  const result = spawnSync(process.execPath, ['scripts/hash-account-secret.mjs'], { input: fixture, encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^\$2a\$12\$.{53}$/);
  assert.ok(!result.stdout.includes(fixture));
  assert.equal(await bcrypt.compare(fixture, result.stdout), true);
  assert.equal(await bcrypt.compare('wrong', result.stdout), false);
});
