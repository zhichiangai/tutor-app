import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, chmodSync, symlinkSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  assertExpectedRecipient, assertIdentityPath, assertLocalOnly
} from '../scripts/release/v58-offline-age-recovery-check.mjs';

test('offline age recovery refuses GitHub/CI and deployment environments', () => {
  assert.throws(() => assertLocalOnly({CI:'true'}));
  assert.throws(() => assertLocalOnly({GITHUB_ACTIONS:'true'}));
  assert.throws(() => assertLocalOnly({VERCEL_ENV:'production'}));
});
test('requires an X25519 public recipient shape, never a private identity', () => {
  const syntheticShape = 'age1' + 'q'.repeat(58);
  assert.equal(assertExpectedRecipient(syntheticShape), syntheticShape);
  assert.throws(() => assertExpectedRecipient('AGE-SECRET-KEY-1TESTPRIVATE'));
  assert.throws(() => assertExpectedRecipient(''));
});
test('offline identity gate rejects world-readable and symlink keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'v58-offline-gate-unit-'));
  try {
    const local = join(dir, 'fake-identity');
    const link = join(dir, 'fake-link');
    writeFileSync(local, 'SYNTHETIC_NOT_A_KEY', {mode:0o600});
    chmodSync(local, 0o600);
    assert.equal(assertIdentityPath(local), local);
    chmodSync(local, 0o644);
    assert.throws(() => assertIdentityPath(local));
    chmodSync(local, 0o600);
    symlinkSync(local, link);
    assert.throws(() => assertIdentityPath(link));
    assert.throws(() => assertIdentityPath('relative/path'));
  } finally {
    rmSync(dir, {recursive:true, force:true});
  }
});
