import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const extOrigin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const appRoot = resolve(import.meta.dirname, '..');
const tempHome = await mkdtemp(join(tmpdir(), 'onco-bridge-test-'));
const server = spawn(process.execPath, [join(appRoot, 'chatgpt_bridge/bridge.mjs')], {
  cwd: appRoot, env: { ...process.env, HOME: tempHome, USERPROFILE: tempHome },
  stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
const started = new Promise((resolveStarted, reject) => {
  const watchdog = setTimeout(() => reject(new Error('Bridge startup timeout: ' + output)), 9000);
  server.stdout.on('data', chunk => {
    output += chunk.toString('utf8');
    if (/연결 코드:\s*([0-9A-F]{12})/.test(output)) {
      clearTimeout(watchdog);
      resolveStarted(output.match(/연결 코드:\s*([0-9A-F]{12})/)[1]);
    }
  });
  server.stderr.on('data', chunk => { output += chunk.toString(); });
  server.on('exit', code => reject(new Error('Bridge early exit ' + code + ': ' + output)));
});
async function req(path, init = {}) {
  return fetch('http://127.0.0.1:18744' + path, {
    ...init, headers: { Origin: extOrigin, 'Content-Type': 'application/json', ...init.headers }
  });
}
try {
  const code = await started;
  assert.match(code, /^[0-9A-F]{12}$/);
  assert.equal((await req('/health')).status, 200);
  assert.equal((await fetch('http://127.0.0.1:18744/health', { headers: { Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await req('/status')).status, 401);
  assert.equal((await req('/pair', { method: 'POST', body: JSON.stringify({ code: 'AAAAAAAAAAAA' }) })).status, 401);
  const pairRes = await req('/pair', { method: 'POST', body: JSON.stringify({ code }) });
  assert.equal(pairRes.status, 200);
  const pair = await pairRes.json();
  assert.match(pair.token, /^[a-zA-Z0-9_-]{40,}$/);
  const headers = { 'X-OnCo-Bridge-Token': pair.token };
  assert.equal((await req('/status', { headers })).status, 200);
  const status = await (await req('/status', { headers })).json();
  assert.equal(status.connected, false);
  assert.equal(status.sharing, false);
  assert.equal((await req('/models', { headers })).status, 401);
  assert.equal((await req('/solve', { method: 'POST', headers, body: JSON.stringify({ model: 'fake', input: 'hello' }) })).status, 401);
  const signinResp = await req('/signin', { method: 'POST', headers, body: '{}' });
  assert.equal(signinResp.status, 200);
  const signIn = await signinResp.json();
  const url = new URL(signIn.url);
  assert.equal(url.origin, 'https://auth.openai.com');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:18744/auth/callback');
  assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.match(url.searchParams.get('ext_agent_host_id'), /^urn:uuid:/);
  assert.ok(url.searchParams.get('scope').includes('chatgpt.tokens.use.direct'));
  const mismatched = await req('/auth/callback?state=wrong&code=fake', { headers: {} });
  assert.equal(mismatched.status, 400);
  const logoutRes = await req('/logout', { method: 'POST', headers, body: '{}' });
  assert.equal(logoutRes.status, 200);
  const registration = JSON.parse(await readFile(join(tempHome, '.onco-ai-solver/chatgpt-registration.json'), 'utf8'));
  assert.match(registration.hostId, /^urn:uuid:/);
  assert.equal(Object.hasOwn(registration, 'access_token'), false);
  console.log('PASS: loopback origin enforcement, pairing, OAuth URI/state, no pre-login inference, token-free registration storage');
} finally {
  server.kill('SIGTERM');
  await rm(tempHome, { recursive: true, force: true, maxRetries: 2 });
}