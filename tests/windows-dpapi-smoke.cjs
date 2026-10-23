// Real Windows user-profile DPAPI integration smoke for the packaged OnCoBridge.exe.
// Never uses or modifies existing OnCo credentials; a random value remains in memory.
const assert = require('node:assert/strict');
const { mkdtempSync, readdirSync, rmSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

if (process.platform !== 'win32') {
  console.log('SKIP: Windows CurrentUser DPAPI integration is Windows-only');
  process.exit(0);
}
assert.ok(process.argv[2], 'Pass the packaged Windows OnCoBridge.exe path');
const exe = resolve(process.argv[2]);
const work = mkdtempSync(join(tmpdir(), 'onco-dpapi-win32-'));
try {
  const result = spawnSync(exe, ['--dpapi-self-test'], {
    windowsHide: true,
    timeout: 75000,
    encoding: 'utf8',
    env: { ...process.env, ONCO_BRIDGE_DATA_DIR: work }
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0,
    'Packaged Windows DPAPI round-trip failed: ' + String(result.stderr || '').slice(0,500));
  assert.equal(result.stdout.trim(), 'ONCO_DPAPI_SELFTEST_OK');
  assert.deepEqual(readdirSync(work), [],
    'DPAPI self-test must not create or change any login files');
  console.log('PASS: packaged Windows CurrentUser DPAPI protect/unprotect round-trip');
} finally {
  rmSync(work, { recursive: true, force: true });
}
