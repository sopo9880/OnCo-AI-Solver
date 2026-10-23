import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const appRoot = resolve(import.meta.dirname, '..');
const work = await mkdtemp(join(tmpdir(), 'onco-native-test-'));
async function native(message) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [join(appRoot,'bridge/main.cjs')], {
      cwd: appRoot, env: { ...process.env, ONCO_BRIDGE_DATA_DIR: work }, stdio: ['pipe','pipe','pipe']
    });
    const bytes = Buffer.from(JSON.stringify(message)); const prefix = Buffer.alloc(4); prefix.writeUInt32LE(bytes.length);
    child.stdin.end(Buffer.concat([prefix,bytes]));
    const chunks = [], errs = [];
    child.stdout.on('data', d => chunks.push(d));
    child.stderr.on('data', d => errs.push(d));
    child.once('error', reject);
    child.once('close', () => {
      const response = Buffer.concat(chunks);
      if (response.length < 4) return reject(Error('Missing native response: '+Buffer.concat(errs).toString()));
      assert.equal(response.readUInt32LE(0), response.length-4);
      resolveResult(JSON.parse(response.subarray(4).toString()));
    });
  });
}
try {
  const ping = await native({ action:'ping' });
  assert.equal(ping.ready,true);
  assert.equal(ping.version,'1.3.2');
  const status = await native({action:'status'});
  assert.equal(status.connected,false);
  assert.equal(status.sharing,false);
  assert.equal(status.identityStatus,'signed_out');
  assert.equal(status.planStatus,'not_authorized');
  const upgrade = await native({ action:'enable-plan' });
  assert.equal(upgrade.success,false);
  assert.match(upgrade.error,/Sign in first/);
  const models = await native({action:'models'});
  assert.equal(models.success,false); // no credentials, no API call
  assert.match(models.error,/로그인/);
  const unknown = await native({action:'import-cookies'});
  assert.equal(unknown.success,false);
  const registration = JSON.parse(await readFile(join(work,'chatgpt-registration.json'),'utf8'));
  assert.match(registration.hostId,/^urn:uuid:/);
  assert.equal(Object.hasOwn(registration,'access_token'),false);
  console.log('PASS: Native Messaging framing, status, no-token inference guard, registration persistence');
} finally {
  await rm(work,{recursive:true,force:true});
}
