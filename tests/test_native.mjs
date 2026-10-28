// Native Messaging long-lived port framing, privileged action allowlist and migration.
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..');
const work=await mkdtemp(join(tmpdir(),'onco-native-v134-'));
const oldPath=join(work,'chatgpt-registration.json');
const oldBlob=join(work,'chatgpt-session.dpapi');
function send(messages){
 return new Promise((resolveResult,reject)=>{
   const child=spawn(process.execPath,[join(root,'bridge/main.cjs')],{
     cwd:root,env:{...process.env,ONCO_BRIDGE_DATA_DIR:work},
     stdio:['pipe','pipe','pipe'],windowsHide:true
   });
   const chunks=[],errors=[];
   child.stdout.on('data',b=>chunks.push(b));
   child.stderr.on('data',b=>errors.push(b));
   child.once('error',reject);
   const packet=Buffer.concat(messages.map(msg=>{
     const data=Buffer.from(JSON.stringify(msg));
     const prefix=Buffer.alloc(4);prefix.writeUInt32LE(data.length);
     return Buffer.concat([prefix,data]);
   }));
   child.stdin.end(packet);
   child.once('close',(code,signal)=>{
     if(code!==0)return reject(Error('Native host non-zero exit '+code+': '+Buffer.concat(errors).toString()));
     let remaining=Buffer.concat(chunks),out=[];
     while(remaining.length>=4){
       const length=remaining.readUInt32LE(0);
       if(remaining.length<length+4)return reject(Error('Truncated native frame'));
       out.push(JSON.parse(remaining.subarray(4,4+length).toString('utf8')));
       remaining=remaining.subarray(length+4);
     }
     if(remaining.length) return reject(Error('Unexpected trailing Native Messaging bytes'));
     resolveResult(out);
   });
 });
}
try{
 await writeFile(oldPath,'old registration');
 await writeFile(oldBlob,'encrypted legacy');
 const results=await send([{id:1,action:'ping'},{id:2,action:'status'},
   {id:3,action:'enable-plan'},{id:4,action:'import-cookies'},{id:5,action:'models'}]);
 assert.equal(results.length,5);
 const byId=new Map(results.map(response=>[response.id,response]));
 assert.deepEqual(Array.from(byId.keys()).sort(),[1,2,3,4,5]);
 assert.equal(byId.get(1).ready,true);
 assert.equal(byId.get(1).version,'1.3.6');
 assert.equal(byId.get(2).connected,false);
 assert.equal(byId.get(2).sharing,false);
 assert.equal(byId.get(2).identityStatus,'signed_out');
 assert.equal(byId.get(3).success,false,'retired self-managed OAuth permission action blocked');
 assert.equal(byId.get(4).success,false,'cookie import not supported');
 assert.equal(byId.get(5).success,false,'models must require a Codex account');
 assert.ok(!JSON.stringify(results).includes('access_token'));
 assert.equal(await readFile(oldPath,'utf8'),'old registration');
 assert.equal(await readFile(oldBlob,'utf8'),'encrypted legacy');
 console.log('PASS: persistent native host multiple frames, Codex status, old OAuth blocked, legacy files preserved');
}finally{await rm(work,{recursive:true,force:true});}
