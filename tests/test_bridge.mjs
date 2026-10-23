// v1.3.0 OAuth / Native Messaging contract regression test.
// The v1.2.0 fixed-port pairing server no longer exists.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const appRoot = resolve(import.meta.dirname, '..');
const source = await readFile(resolve(appRoot, 'bridge/main.cjs'), 'utf8');
const mainCall = source.lastIndexOf('\nmain().catch(');
assert.ok(mainCall > 0, 'Cannot isolate Native Messaging bridge for OAuth contract test');

const moduleShim = { exports: {} };
vm.runInNewContext(
  source.slice(0, mainCall) + '\nmodule.exports = { beginSignin, completeSignin };',
  {
    module: moduleShim,
    require: createRequire(import.meta.url),
    process, Buffer, console, URL, URLSearchParams, fetch, AbortSignal,
    TextDecoder, setTimeout, clearTimeout
  },
  { filename: 'bridge/main.cjs', timeout: 2000 }
);

const { beginSignin, completeSignin } = moduleShim.exports;
const redirectUri = 'http://127.0.0.1:43913/auth/callback';
const authorize = new URL(beginSignin(redirectUri));
assert.equal(authorize.origin, 'https://auth.openai.com');
assert.equal(authorize.pathname, '/api/accounts/authorize');
assert.equal(authorize.searchParams.get('client_id'), 'dynamic_agent_client');
assert.equal(authorize.searchParams.get('redirect_uri'), redirectUri);
assert.equal(authorize.searchParams.get('response_type'), 'code');
assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
assert.ok(authorize.searchParams.get('scope').split(/\s+/).includes('chatgpt.tokens.use.direct'));
assert.match(authorize.searchParams.get('state'), /^[A-Za-z0-9_-]{20,}$/);
assert.match(authorize.searchParams.get('nonce'), /^[A-Za-z0-9_-]{20,}$/);
assert.match(authorize.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{40,}$/);
assert.match(authorize.searchParams.get('ext_agent_host_id'), /^urn:uuid:/);

// Invalid callbacks must be rejected before any token request is sent.
await assert.rejects(
  completeSignin(new URL(redirectUri + '?state=invalid&code=fake'), redirectUri),
  /OAuth state/
);
const next = new URL(beginSignin(redirectUri));
assert.notEqual(next.searchParams.get('state'), authorize.searchParams.get('state'));
assert.notEqual(next.searchParams.get('code_challenge'), authorize.searchParams.get('code_challenge'));
assert.ok(source.includes('server.listen(0, HOST, resolve)'), 'Use an ephemeral callback listener port');
assert.ok(!source.includes('127.0.0.1:18744'), 'Do not restore legacy fixed-port pairing');
console.log('PASS: ChatGPT OAuth PKCE, ephemeral callback, state rejection, no legacy pairing server');
