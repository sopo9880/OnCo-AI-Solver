// Compatibility regression: v1.3.0 native bridge remains supported while v1.3.1
// introduces identity-only login and a separately requested ChatGPT plan grant.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const root=resolve(import.meta.dirname,'..');
const source=await readFile(resolve(root,'bridge/main.cjs'),'utf8');
const mainCall=source.lastIndexOf('\nmain().catch(');
assert.ok(mainCall>0);
const moduleShim={exports:{}};
vm.runInNewContext(source.slice(0,mainCall)+'\nmodule.exports={beginSignin,completeSignin}',{
 module:moduleShim,require:createRequire(import.meta.url),
 process,Buffer,console,URL,URLSearchParams,fetch,AbortSignal,TextDecoder,setTimeout,clearTimeout
},{filename:'bridge/main.cjs',timeout:2000});
const {beginSignin,completeSignin}=moduleShim.exports;
const callback='http://127.0.0.1:43913/auth/callback';
const first=new URL(beginSignin(callback));
assert.equal(first.origin,'https://auth.openai.com');
assert.equal(first.pathname,'/api/accounts/authorize');
assert.equal(first.searchParams.get('client_id'),'dynamic_agent_client');
assert.equal(first.searchParams.get('redirect_uri'),callback);
assert.equal(first.searchParams.get('response_type'),'code');
assert.equal(first.searchParams.get('code_challenge_method'),'S256');
assert.equal(first.searchParams.get('scope'),'openid profile email');
assert.equal(first.searchParams.has('prompt'),false);
assert.match(first.searchParams.get('state'),/^[a-zA-Z0-9_-]{20,}$/);
assert.match(first.searchParams.get('nonce'),/^[a-zA-Z0-9_-]{20,}$/);
assert.match(first.searchParams.get('code_challenge'),/^[a-zA-Z0-9_-]{40,}$/);
const plan=new URL(beginSignin(callback,'plan'));
assert.match(plan.searchParams.get('scope'),/chatgpt\.tokens\.use\.direct/);
assert.equal(plan.searchParams.get('prompt'),'consent');
assert.notEqual(first.searchParams.get('state'),plan.searchParams.get('state'));
await assert.rejects(completeSignin(new URL(callback+'?state=invalid&code=fake'),callback),/OAuth state/);
assert.match(source,/server\.listen\(0, HOST, resolve\)/);
assert.ok(!source.includes('127.0.0.1:18744'));
console.log('PASS: OAuth PKCE, identity-first authorization, explicit plan consent, ephemeral callback and state checks');
