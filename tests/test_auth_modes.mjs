// No custom OAuth client: Codex owns the ChatGPT account and permissions.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const source=await readFile(resolve(import.meta.dirname,'../bridge/main.cjs'),'utf8');
const end=source.lastIndexOf('\nmain().catch(');
assert.ok(end>0);
const box={exports:{}};
vm.runInNewContext(source.slice(0,end) + '\nmodule.exports={status,beginCodexLogin,cancelCodexLogin,dispatch,codex};',{
  module:box,require:createRequire(import.meta.url),process,Buffer,console,URL,
  setTimeout,clearTimeout
},{filename:'bridge/main.cjs',timeout:3000});
const {status,beginCodexLogin,cancelCodexLogin,dispatch,codex}=box.exports;
let account=null;
const seen=[];
codex.start=async()=>{};
codex.notify=()=>{};
codex.call=async(method,params)=>{
  seen.push({method,params});
  if(method==='account/read')return {account};
  if(method==='account/login/start'&&params.type==='chatgptDeviceCode')
    return {type:'chatgptDeviceCode',loginId:'device-1',verificationUrl:'https://auth.openai.com/codex/device',userCode:'ABCD-1234'};
  if(method==='account/login/start'&&params.type==='chatgpt')
    return {type:'chatgpt',loginId:'browser-1',authUrl:'https://chatgpt.com/auth/login?code=opaque'};
  if(method==='account/login/cancel')return {};
  if(method==='account/logout'){account=null;return {};}
  if(method==='model/list')return {data:[{model:'gpt-6-codex',displayName:'GPT 6 Codex',isDefault:true}]};
  throw Error('Unexpected Codex method '+method);
};
let current=await status();
assert.equal(current.connected,false);
assert.equal(current.planStatus,'not_authorized');
let login=await beginCodexLogin('device');
assert.equal(login.login.mode,'device');
assert.equal(login.login.userCode,'ABCD-1234');
assert.equal(login.login.verificationUrl,'https://auth.openai.com/codex/device');
assert.equal(seen.at(-1).params.type,'chatgptDeviceCode');
const existing=await beginCodexLogin('browser');
assert.equal(existing.started,false);
assert.equal(existing.login.mode,'device');
await cancelCodexLogin();
login=await beginCodexLogin('browser');
assert.equal(login.login.mode,'browser');
assert.equal(seen.at(-1).params.type,'chatgpt');
assert.equal(seen.at(-1).params.useHostedLoginSuccessPage,true);
codex.receive({method:'account/login/completed',params:{loginId:'browser-1',success:true}});
assert.equal(codex.login,null);
account={type:'chatgpt',planType:'team',email:'private-user@example.test',access_token:'PRIVATE-TOKEN'};
current=await status();
assert.equal(current.connected,true);
assert.equal(current.sharing,true);
assert.equal(current.planType,'team');
assert.equal(Object.hasOwn(current,'email'),false);
assert.equal(Object.hasOwn(current,'access_token'),false);
assert.ok(!JSON.stringify(current).includes('private-user@example.test'));
assert.equal((await dispatch({action:'signin'})).alreadyConnected,true);
const models=await dispatch({action:'models'});
assert.deepEqual(Array.from(models.models,m=>m.id),['gpt-6-codex']);
assert.equal((await dispatch({action:'ping'})).version,'1.3.6');
await dispatch({action:'logout'});
assert.equal((await status()).connected,false);
account={type:'apiKey',planType:'',apiKey:'dont-export'};
assert.equal((await status()).connected,false,'API key authentication cannot impersonate a ChatGPT plan');
await assert.rejects(dispatch({action:'models'}),/로그인/);
await assert.rejects(dispatch({action:'enable-plan'}),/허용되지 않은/);
await assert.rejects(dispatch({action:'import-cookies'}),/허용되지 않은/);
assert.ok(!source.includes('dynamic_agent_client'),'no obsolete OAuth client allowed');
assert.ok(!source.includes('/api/accounts/authorize'),'no obsolete OAuth authorization path allowed');
console.log('PASS: Codex-only device/browser sign-in, completion, account isolation, model listing and API-key separation');
