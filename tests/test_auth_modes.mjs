import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const src = await readFile(resolve(root, 'bridge/main.cjs'), 'utf8');
const mainCall = src.lastIndexOf('\nmain().catch(');
assert.ok(mainCall > 0, 'OAuth helper evaluation boundary must exist');
const work = await mkdtemp(join(tmpdir(), 'onco-auth-modes-'));
const processStub = { ...process, env: { ...process.env, ONCO_BRIDGE_DATA_DIR: work } };
const ctx = {
  require: createRequire(import.meta.url), process: processStub, module: { exports: {} },
  URL, URLSearchParams, Buffer, console, TextDecoder, AbortSignal,
  fetch: () => { throw new Error('Network must not be called in isolated auth tests'); },
  setTimeout, clearTimeout
};
try {
  vm.runInNewContext(src.slice(0,mainCall) + `
    // Isolate only remote OAuth exchange and persistence; actual token cryptography
    // and Native Messaging protocol are exercised by the other tests.
    persistRegistration = async () => {};
    persistSession = async () => {};
    exchangeToken = async () => mockTokenResponse;
    verifyIdToken = async () => mockIdentity;
    let mockTokenResponse;
    let mockIdentity = { subject: 'user-1', email: 'team-user@example.com' };
    module.exports = { beginSignin, completeSignin, status, dispatch,
      setResponse: x => { mockTokenResponse = x; },
      setIdentity: x => { mockIdentity = x; } };
  `, ctx, {filename: 'main.cjs', timeout: 2000});
  const { beginSignin, completeSignin, status, dispatch, setResponse, setIdentity } = ctx.module.exports;
  const callback = 'http://127.0.0.1:54321/auth/callback';

  const login = new URL(beginSignin(callback));
  assert.equal(login.searchParams.get('scope'), 'openid profile email');
  assert.ok(!login.searchParams.get('scope').includes('chatgpt.tokens.use.direct'));
  assert.equal(login.searchParams.get('prompt'),null);
  assert.equal(login.searchParams.get('client_id'),'dynamic_agent_client');
  setResponse({id_token:'verified-only',scope:'openid profile email',expires_in:3600});
  const signin = new URL(callback);
  signin.searchParams.set('state',login.searchParams.get('state'));
  signin.searchParams.set('code','opaque-code');
  signin.searchParams.set('client_id','oaiapp_team_session');
  let result = await completeSignin(signin, callback);
  assert.equal(result.connected, true);
  assert.equal(result.sharing, false);
  assert.equal(result.mode,'identity');
  let view = await status();
  assert.equal(view.identityStatus,'signed_in');
  assert.equal(view.planStatus,'not_authorized');
  await assert.rejects(dispatch({action:'models'}), /권한|permission/i);
  await assert.rejects(dispatch({action:'solve',data:{model:'fake',input:'hello'}}), /권한|permission/i);

  const upgrade = new URL(beginSignin(callback,'plan'));
  assert.equal(upgrade.searchParams.get('client_id'),'oaiapp_team_session');
  assert.equal(upgrade.searchParams.get('prompt'),'consent');
  assert.equal(upgrade.searchParams.get('id_token_hint'),'verified-only');
  assert.ok(upgrade.searchParams.get('scope').includes('chatgpt.tokens.use.direct'));
  assert.ok(upgrade.searchParams.get('scope').includes('resource.invoke'));
  const bad = new URL(callback);
  bad.searchParams.set('state','invalid-state');
  bad.searchParams.set('code','invalid-code');
  await assert.rejects(completeSignin(bad,callback), /OAuth state/);
  view = await status();
  assert.equal(view.connected,true,'denied plan attempt keeps identity session');
  assert.equal(view.sharing,false);

  // Repeated user-authorized upgrade without a sharing grant stays identity-only.
  const second = new URL(beginSignin(callback,'plan'));
  const missing = new URL(callback);
  missing.searchParams.set('state',second.searchParams.get('state'));
  missing.searchParams.set('code','new-code');
  setResponse({id_token:'verified-only-2',scope:'openid profile email',expires_in:3600});
  result = await completeSignin(missing,callback);
  assert.equal(result.connected,true);
  assert.equal(result.sharing,false);

  const third = new URL(beginSignin(callback,'plan'));
  const grant = new URL(callback);
  grant.searchParams.set('state',third.searchParams.get('state'));
  grant.searchParams.set('code','another-code');
  setResponse({id_token:'id-for-plan',scope:'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',access_token:'test-opaque-token',refresh_token:'test-refresh',expires_in:3600});
  result = await completeSignin(grant,callback);
  assert.equal(result.sharing,true);
  view = await status();
  assert.equal(view.planStatus,'scope_granted');

  // Clicking ordinary login again must not accidentally discard the already granted plan scope.
  const guardedSignin = await dispatch({ action: 'signin' });
  assert.equal(guardedSignin.alreadyConnected, true);
  assert.equal(guardedSignin.started, false);
  assert.equal((await status()).sharing, true);

  // Switching accounts must not silently replace the connected workspace.
  const fourth = new URL(beginSignin(callback,'plan'));
  const other = new URL(callback);
  other.searchParams.set('state',fourth.searchParams.get('state'));
  other.searchParams.set('code','account-change');
  setIdentity({subject:'other-account',email:'other@example.com'});
  await assert.rejects(completeSignin(other,callback));
  view = await status();
  assert.equal(view.email,'team-user@example.com');
  assert.equal(view.sharing,true);
  console.log('PASS: identity-only OAuth, explicit plan consent, denial keeps session, no implicit inference or account switch');
} finally {
  await rm(work,{recursive:true,force:true});
}
