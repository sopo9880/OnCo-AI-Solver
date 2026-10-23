// The final packaged native host must open and initialize the bundled official
// Codex app-server on Windows. No live OAuth, model calls, credentials or API keys.
const {spawnSync} = require('node:child_process');
const {mkdtempSync,readFileSync,readdirSync,rmSync} = require('node:fs');
const {resolve,join} = require('node:path');
const {tmpdir} = require('node:os');
const assert = require('node:assert/strict');
if(process.platform!=='win32'){
  console.log('SKIP: packaged Windows Codex smoke requires windows-latest');
  process.exit(0);
}
assert.ok(process.argv[2],'Expected OnCoBridge.exe path');
assert.ok(process.argv[3],'Expected Codex executable path');
const bridge=resolve(process.argv[2]),codex=resolve(process.argv[3]);
assert.ok(readFileSync(bridge).subarray(0,2).equals(Buffer.from('MZ')));
assert.ok(readFileSync(codex).subarray(0,2).equals(Buffer.from('MZ')));
const home=mkdtempSync(join(tmpdir(),'onco-codex-smoke-'));
function framed(message){
  const payload=Buffer.from(JSON.stringify(message),'utf8');
  const head=Buffer.alloc(4);head.writeUInt32LE(payload.length);
  return Buffer.concat([head,payload]);
}
try{
  const result=spawnSync(bridge,[],{
    cwd:home,
    env:{...process.env,ONCO_BRIDGE_DATA_DIR:home},
    windowsHide:true,timeout:110000,maxBuffer:2000000,
    input:Buffer.concat([framed({id:1,action:'ping'}),framed({id:2,action:'status'})])
  });
  if(result.error)throw result.error;
  assert.equal(result.status,0,String(result.stderr||'').slice(0,350));
  let bytes=result.stdout,frames=[];
  while(bytes.length>=4){
    const n=bytes.readUInt32LE(0);
    assert.ok(n>0&&n<900000);
    assert.ok(bytes.length>=n+4,'Native host returned a truncated response');
    frames.push(JSON.parse(bytes.subarray(4,4+n).toString('utf8')));
    bytes=bytes.subarray(n+4);
  }
  assert.equal(bytes.length,0);
  assert.equal(frames.length,2);
  const ping=frames.find(x=>x.id===1),status=frames.find(x=>x.id===2);
  assert.equal(ping?.ready,true);
  assert.equal(ping?.version,'1.3.4');
  assert.equal(ping?.codexVersion,'0.163.0');
  assert.equal(status?.success,true,status?.error||'Native status unavailable');
  assert.equal(status.available,true,status.error||'Codex app-server did not initialize');
  assert.equal(typeof status.connected,'boolean');
  assert.equal(Object.hasOwn(status,'email'),false);
  assert.equal(Object.hasOwn(status,'accessToken'),false);
  for(const file of readdirSync(home)){
    assert.notEqual(file,'chatgpt-session.dpapi','must not write legacy auth token files');
    assert.notEqual(file,'chatgpt-registration.json','must not overwrite previous OAuth client');
  }
  console.log('PASS: packaged OnCoBridge.exe + pinned Codex app-server, account status and persistent native framing');
}finally{rmSync(home,{recursive:true,force:true});}
