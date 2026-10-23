// New Codex path does not export token data, accept arbitrary login URLs, or
// inherit secrets from the parent process environment.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const source=await readFile(resolve(import.meta.dirname,'../bridge/main.cjs'),'utf8');
const entry=source.lastIndexOf('\nmain().catch(');
assert.ok(entry>0);
const shim={exports:{}};
vm.runInNewContext(source.slice(0,entry)+'\nmodule.exports={codexEnvironment,codexExecutable,safeLoginUrl,cleanError,RUNNER_ARGS};',{
  require:createRequire(import.meta.url),module:shim,process,console,Buffer,URL,setTimeout,clearTimeout
},{filename:'bridge/main.cjs',timeout:3000});
const {codexEnvironment,codexExecutable,safeLoginUrl,cleanError,RUNNER_ARGS}=shim.exports;
const env=codexEnvironment({
  PATH:'C:\\Windows\\System32',LOCALAPPDATA:'C:\\Users\\A\\AppData\\Local',
  OPENAI_API_KEY:'SECRET-API-KEY',
  CODEX_HOME:'C:\\Users\\A\\.codex',
  AWS_SECRET_ACCESS_KEY:'AWS-SECRET',CUSTOM_BEARER:'secret'
});
assert.equal(env.PATH,'C:\\Windows\\System32');
assert.equal(env.OPENAI_API_KEY,undefined);
assert.equal(env.AWS_SECRET_ACCESS_KEY,undefined);
assert.equal(env.CUSTOM_BEARER,undefined);
assert.ok(env.CODEX_HOME.toLowerCase().includes('onco ai solver'));
assert.ok(env.CODEX_HOME.toLowerCase().endsWith('codex'));
assert.ok(codexExecutable({execPath:'C:\\App\\OnCoBridge.exe'}).endsWith('bin/codex.exe')
  || codexExecutable({execPath:'C:\\App\\OnCoBridge.exe'}).endsWith('bin\\codex.exe'));
assert.ok(RUNNER_ARGS.includes('features.shell_tool=false'));
assert.ok(RUNNER_ARGS.includes('features.multi_agent=false'));
assert.ok(RUNNER_ARGS.includes('cli_auth_credentials_store="keyring"'));
assert.equal(safeLoginUrl('https://auth.openai.com/codex/device'),'https://auth.openai.com/codex/device');
assert.ok(safeLoginUrl('https://chatgpt.com/auth/login?x=y'));
for(const bad of ['https://example.com/','http://auth.openai.com/','javascript:alert(1)',
  'https://evil.com/?redirect=https://auth.openai.com','https://a@auth.openai.com/'])assert.equal(safeLoginUrl(bad),null);
assert.ok(!cleanError('failed private-person@example.com').includes('private-person@example.com'));
assert.ok(!cleanError('failed sk-very-secret-key-dummy').includes('sk-very-secret-key-dummy'));
console.log('PASS: isolated Codex keyring environment, pinned runtime path, safe URLs, secret redaction and disabled tools');
