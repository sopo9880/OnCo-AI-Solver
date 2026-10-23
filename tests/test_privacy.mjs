// Codex migration preserves old encrypted OAuth credentials without reading them.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const root=resolve(import.meta.dirname,'..');
const source=await readFile(join(root,'bridge/main.cjs'),'utf8');
const entry=source.lastIndexOf('\nmain().catch(');
const work=await mkdtemp(join(tmpdir(),'onco-legacy-'));
const processStub={...process,env:{...process.env,ONCO_BRIDGE_DATA_DIR:work}};
const registry=join(work,'chatgpt-registration.json');
const legacy=join(work,'chatgpt-session.dpapi');
const registryPayload=JSON.stringify({hostId:'urn:uuid:old',clientId:'old-id',subject:'old-user'});
const legacyPayload='DPAPI_EXISTING_ENCRYPTED_DATA_DO_NOT_TOUCH';
try{
  await writeFile(registry,registryPayload);
  await writeFile(legacy,legacyPayload);
  const shim={exports:{}};
  vm.runInNewContext(source.slice(0,entry)+'\nmodule.exports={status,codex,CODEX_HOME};',{
    require:createRequire(import.meta.url),process:processStub,console,module:shim,Buffer,URL,setTimeout,clearTimeout
  },{filename:'bridge/main.cjs',timeout:3000});
  const {status,codex,CODEX_HOME}=shim.exports;
  codex.start=async()=>{};
  codex.call=async method=>{
    if(method==='account/read')return {account:{
      type:'chatgpt',planType:'team',email:'private@example.test',
      name:'Private User',picture:'https://example.test/user.png',
      accessToken:'sensitive-access',refreshToken:'sensitive-refresh'
    }};
    throw Error('Unexpected '+method);
  };
  const state=await status();
  assert.equal(state.connected,true);
  for(const name of ['email','name','picture','accessToken','refreshToken','clientId','subject']){
    assert.equal(Object.hasOwn(state,name),false,name+' must not leave the native host');
  }
  const json=JSON.stringify(state);
  for(const bad of ['private@example.test','Private User','sensitive-access','sensitive-refresh'])assert.ok(!json.includes(bad));
  assert.equal(await readFile(registry,'utf8'),registryPayload);
  assert.equal(await readFile(legacy,'utf8'),legacyPayload);
  assert.equal(CODEX_HOME,join(work,'codex'),'Codex credentials must use an OnCo-isolated home');
  assert.ok(!/\b(?:readFile|writeFile|rename|rm)\s*\(\s*[^)]*(?:chatgpt-session\.dpapi|chatgpt-registration\.json)/.test(source),
    'new login path must never read, delete or overwrite legacy credential files');
  console.log('PASS: legacy DPAPI and registration files preserved; no ChatGPT identity or tokens exposed');
}finally{await rm(work,{recursive:true,force:true});}
