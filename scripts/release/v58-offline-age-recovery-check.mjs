#!/usr/bin/env node
// Offline-only V5.8 age identity recovery check. Never imports or prints private keys.
// Two independent media must be mounted and checked ONE AT A TIME by the operator.
// This checks synthetic encryption/decryption, not Production backup restoration.
import assert from 'node:assert/strict';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {lstatSync, realpathSync, mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve, relative, isAbsolute, join, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const repoRoot = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const x25519 = /^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/;
// Non-secret recipient pinned to main's v58-backup-oauth-preflight.mjs.
// Any rotation requires an independent release/security review.
const pinnedProductionRecipient = 'age1egjmrjvv7g3p4rp2udc5xtz62wfndzqz2jm67xqfa5mjpvlhxfqqr6z49j';

export function assertExpectedRecipient(recipient) {
  assert.equal(typeof recipient, 'string', 'A public age recipient is required');
  assert.match(recipient, x25519, 'Expected X25519 age recipient (public key only)');
  assert.equal(recipient, pinnedProductionRecipient, 'Recipient must match pinned Production public recipient');
  return recipient;
}
export function assertLocalOnly(env) {
  assert.ok(!env.CI && !env.GITHUB_ACTIONS, 'Refuse GitHub/CI execution with identities');
  assert.ok(!env.VERCEL && !env.VERCEL_ENV, 'Refuse deployment environment');
  assert.ok(Number(process.versions.node.split('.')[0]) >= 22, 'Node 22+ required');
}
export function assertIdentityPath(path) {
  assert.ok(typeof path === 'string' && isAbsolute(path), 'Absolute identity file path required');
  const stat = lstatSync(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Private identity must be a regular file');
  assert.equal(stat.mode & 0o077, 0, 'Private identity must have owner-only permissions (chmod 600)');
  const actual = realpathSync(path);
  const rel = relative(repoRoot, actual);
  assert.ok(rel === '..' || rel.startsWith('..' + sep), 'Private identity must be outside Git repository');
  return actual;
}
function invoke(binary, args) {
  const result = spawnSync(binary, args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000,
    maxBuffer: 64 * 1024, windowsHide: true
  });
  if (result.error || result.status !== 0) throw new Error('External age operation failed');
  return result.stdout.trim();
}
export function verifyOfflineCopy(env) {
  assertLocalOnly(env);
  const copy = env.V58_RECOVERY_COPY_ID;
  assert.ok(copy === 'A' || copy === 'B', 'Copy label must be A or B');
  const recipient = assertExpectedRecipient(env.V58_RECOVERY_EXPECTED_RECIPIENT);
  const identity = assertIdentityPath(env.V58_RECOVERY_IDENTITY_FILE);
  // Verify that the recovered private identity is the exact key configured to
  // encrypt future backups, not merely any valid age identity.
  assert.equal(invoke('age-keygen', ['-y', identity]), recipient, 'Public recipient mismatch');
  let temp;
  try {
    temp = mkdtempSync(join(tmpdir(), 'v58-age-recovery-'));
    chmodSync(temp, 0o700);
    const plain = join(temp, 'synthetic.dat');
    const cipher = join(temp, 'synthetic.age');
    const restored = join(temp, 'synthetic.restored');
    const expected = randomBytes(4096); // never Production or real student/accounting data
    writeFileSync(plain, expected, {mode: 0o600, flag: 'wx'});
    invoke('age', ['-r', recipient, '-o', cipher, plain]);
    invoke('age', ['-d', '-i', identity, '-o', restored, cipher]);
    const actual = readFileSync(restored);
    assert.ok(actual.length === expected.length &&
      timingSafeEqual(actual, expected), 'Synthetic decryption mismatch');
    return {
      status: 'PASS', copy, configured_recipient_match: true,
      synthetic_decrypt: true, separate_physical_media_verified: false,
      production_backup_restored: false, production_db_access: false
    };
  } finally {
    if (temp) rmSync(temp, {recursive: true, force: true});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 2, 'No key arguments accepted; use local environment only');
    const result = verifyOfflineCopy(process.env);
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch {
    // A generic error avoids accidentally leaking key paths, child stderr or contents.
    process.stderr.write('FAIL: offline age recovery check refused or failed; no keys printed\n');
    process.exitCode = 2;
  }
}
