// Windows DPAPI subprocess contract and safe failures (also runs on Linux PR CI).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const mainSource = await readFile(join(root, 'bridge/main.cjs'), 'utf8');
const entry = mainSource.lastIndexOf('\nmain().catch(');
assert.ok(entry > 0);
const work = await mkdtemp(join(tmpdir(), 'onco-dpapi-tests-'));
const actualRequire = createRequire(import.meta.url);
let failKind = null;
const seen = [];
let credentialInArgument = false;

function fakeSpawn(file, args, options) {
  assert.equal(file, 'powershell.exe');
  assert.equal(options.windowsHide, true);
  assert.equal(options.shell, undefined);
  assert.ok(args.includes('-NoProfile') && args.includes('-NonInteractive'));
  const encodedScript = args[args.indexOf('-EncodedCommand') + 1];
  const script = Buffer.from(encodedScript, 'base64').toString('utf16le');
  seen.push(script);
  assert.match(script, /Add-Type -AssemblyName System\.Security -ErrorAction Stop/);
  assert.match(script, /System\.Security\.Cryptography\.ProtectedData/);
  assert.match(script, /DataProtectionScope\]::CurrentUser/);
  assert.match(script, /ONCO_DPAPI_ERROR:/);
  if (JSON.stringify(args).includes('PRIVATE_TOKEN_EXAMPLE')) credentialInArgument = true;

  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = { end: input => queueMicrotask(() => {
    const mode = script.includes('::Protect(') ? 'protect' : 'unprotect';
    if (mode === 'protect') {
      const decoded = Buffer.from(input, 'base64').toString('utf8');
      assert.ok(decoded === 'PRIVATE_TOKEN_EXAMPLE' || decoded.includes('"accessToken":"PRIVATE_TOKEN_EXAMPLE"'));
    } else assert.equal(input, Buffer.from('encrypted-placeholder','utf8').toString('base64'));
    if (failKind) {
      child.stderr.write('#< CLIXML <Objs S="Err"> ONCO_DPAPI_ERROR:' + failKind);
      child.stderr.end();
      child.emit('close', 1);
    } else {
      const response = mode === 'protect'
        ? Buffer.from('encrypted-placeholder','utf8').toString('base64')
        : Buffer.from('PRIVATE_TOKEN_EXAMPLE','utf8').toString('base64');
      child.stdout.write(response);
      child.stdout.end();
      child.emit('close', 0);
    }
  }) };
  return child;
}
const processStub = { ...process, platform: 'win32',
  env: { ...process.env, ONCO_BRIDGE_DATA_DIR: work } };
const ctx = {
  process: processStub,
  require: id => id === 'node:child_process' ? { spawn: fakeSpawn } : actualRequire(id),
  Buffer, module: { exports: {} }, console,
  URL, URLSearchParams, AbortSignal, TextDecoder, setTimeout, clearTimeout
};
vm.runInNewContext(mainSource.slice(0, entry) + '\nmodule.exports={dpapi,dpapiPowerShellScript,explainDpapiFailure,persistSession,setSession:value=>{session=value}};',ctx,
  { filename: 'bridge/main.cjs', timeout: 3000 });
const {dpapi,dpapiPowerShellScript,explainDpapiFailure,persistSession,setSession} = ctx.module.exports;

try {
  assert.throws(() => dpapiPowerShellScript('other'),/Invalid DPAPI operation/);
  const encrypted = await dpapi('PRIVATE_TOKEN_EXAMPLE','protect');
  assert.equal(encrypted,Buffer.from('encrypted-placeholder','utf8').toString('base64'));
  const restored = await dpapi(encrypted,'unprotect');
  assert.equal(restored,'PRIVATE_TOKEN_EXAMPLE');
  assert.equal(credentialInArgument,false,'tokens must never appear in subprocess args');
  assert.equal(seen.length,2);
  const oldSessionFile = join(work,'chatgpt-session.dpapi');
  await writeFile(oldSessionFile, 'existing-protected-session', 'utf8');
  setSession({subject:'account-id',clientId:'registered-client',accessToken:'PRIVATE_TOKEN_EXAMPLE',
    refreshToken:'refresh-secret',scopes:['openid','chatgpt.tokens.use.direct'],expiresAt:Date.now()+50000});
  failKind='System.Security.Cryptography.CryptographicException';
  await assert.rejects(persistSession(), err => {
    assert.match(err.message,/Windows DPAPI/);
    assert.match(err.message,/암호화 키/);
    assert.ok(!err.message.includes('CLIXML'));
    assert.ok(!err.message.includes('PRIVATE_TOKEN_EXAMPLE'));
    return true;
  });
  assert.equal(await readFile(oldSessionFile,'utf8'),'existing-protected-session',
    'failed encryption must never delete or overwrite an existing session');
  const formatError=explainDpapiFailure(1,'#< CLIXML Garbage');
  assert.match(formatError.message,/Windows DPAPI/);
  assert.ok(!formatError.message.includes('CLIXML'), 'untrusted PowerShell stderr must not leak into UI');
  assert.match(explainDpapiFailure(1,'ONCO_DPAPI_ERROR:System.TypeLoadException').message,/System.Security/);
  assert.match(explainDpapiFailure(1,'ONCO_DPAPI_ERROR:System.FormatException').message,/데이터 형식/);
  console.log('PASS: Windows DPAPI command, Add-Type, no token argv, safe CLIXML handling, preserve existing session');
} finally {
  await rm(work,{recursive:true,force:true});
}
