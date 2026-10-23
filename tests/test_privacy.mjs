// Regression: migrate legacy v1.3.0 DPAPI sessions without retaining optional
// profile fields or the raw ID token. Keep the existing account and plan grant.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const work = await mkdtemp(join(tmpdir(), 'onco-privacy-'));
const root = resolve(import.meta.dirname, '..');
const source = await readFile(join(root, 'bridge/main.cjs'), 'utf8');
const end = source.lastIndexOf('\nmain().catch(');
assert.ok(end > 0);
const processStub = { ...process, env: { ...process.env, ONCO_BRIDGE_DATA_DIR: work } };
const context = { process: processStub, require: createRequire(import.meta.url),
  Buffer, URL, URLSearchParams, console, TextDecoder, AbortSignal,
  setTimeout, clearTimeout, module: { exports: {} },
  fetch: () => { throw Error('Network not allowed in privacy test'); } };

// DPAPI is stubbed to an identity transform only inside this isolated VM.
// The production path still uses Windows CurrentUser DPAPI protection.
vm.runInNewContext(source.slice(0, end) + `
  dpapi = async value => value;
  module.exports = { loadRegistration, loadSession, status, minimizeSession };
`, context, { filename: 'bridge/main.cjs', timeout: 2000 });

const { loadRegistration, loadSession, status } = context.module.exports;
try {
  const hostId = 'urn:uuid:8f397755-3412-434f-922a-dc07486df411';
  const registration = { hostId, clientId: 'oaiapp_previous_account', subject: 'stable-team-sub' };
  await writeFile(join(work, 'chatgpt-registration.json'), JSON.stringify(registration));
  const legacy = {
    subject: 'stable-team-sub', clientId: registration.clientId,
    accessToken: 'existing-plan-access', refreshToken: 'existing-plan-refresh',
    expiresAt: Date.now() + 20 * 60_000,
    scopes: ['openid', 'profile', 'email', 'offline_access', 'resource.invoke', 'chatgpt.tokens.use.direct'],
    email: 'private@example.test', name: 'Private Name', picture: 'https://example.test/private.jpg',
    idToken: 'jwt-containing-profile-claims'
  };
  const sessionPath = join(work, 'chatgpt-session.dpapi');
  await writeFile(sessionPath, JSON.stringify(legacy));
  await loadRegistration();
  await loadSession();
  const result = await status();
  assert.equal(result.connected, true);
  assert.equal(result.sharing, true);
  assert.equal(Object.hasOwn(result, 'email'), false);
  const migrated = JSON.parse(await readFile(sessionPath, 'utf8'));
  assert.deepEqual(Object.keys(migrated).sort(),
    ['subject', 'clientId', 'accessToken', 'refreshToken', 'expiresAt', 'scopes'].sort());
  assert.equal(migrated.subject, legacy.subject);
  assert.equal(migrated.clientId, legacy.clientId);
  assert.equal(migrated.accessToken, legacy.accessToken);
  assert.equal(migrated.refreshToken, legacy.refreshToken);
  assert.equal(migrated.expiresAt, legacy.expiresAt);
  assert.deepEqual(Array.from(migrated.scopes),
    ['openid', 'offline_access', 'resource.invoke', 'chatgpt.tokens.use.direct']);
  for (const personal of ['email', 'name', 'picture', 'idToken']) {
    assert.ok(!JSON.stringify(migrated).includes(personal + (personal === 'idToken' ? '' : '\"')),
      `Legacy profile field should be removed: ${personal}`);
  }
  console.log('PASS: legacy session profile and raw ID token removed; account and plan grant preserved');
} finally {
  await rm(work, { recursive: true, force: true });
}
