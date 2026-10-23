// App-server JSON-RPC compatibility and read-only text-only coding generation.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const source=await readFile(resolve(import.meta.dirname,'../bridge/main.cjs'),'utf8');
const end=source.lastIndexOf('\nmain().catch(');
assert.ok(end>0);
const exportsShim={exports:{}};
vm.runInNewContext(source.slice(0,end)+'\nmodule.exports={codex,solve,models,normalizedModels,CodexClient};',{
  process,module:exportsShim,require:createRequire(import.meta.url),console,Buffer,URL,
  setTimeout,clearTimeout
},{filename:'bridge/main.cjs',timeout:3000});
const {codex,solve,models,normalizedModels}=exportsShim.exports;
const calls=[];
codex.start=async()=>{};
codex.notify=()=>{};
codex.call=async(method,params)=>{
  calls.push({method,params});
  if(method==='account/read')return {account:{type:'chatgpt',planType:'team'}};
  if(method==='model/list')return {data:[
    {model:'gpt-6-codex',displayName:'GPT 6 Codex',isDefault:true},
    {model:'gpt-6-codex',displayName:'Duplicate'},
    {model:'bad?model',displayName:'Bad'}]};
  if(method==='thread/start')return {thread:{id:'thread-1'}};
  if(method==='turn/start'){
    setTimeout(()=>{
      codex.receive({method:'item/agentMessage/delta',params:{threadId:'thread-1',delta:'print('}});
      codex.receive({method:'item/agentMessage/delta',params:{threadId:'thread-1',delta:'42)'}});
      codex.receive({method:'item/completed',params:{threadId:'thread-1',item:{type:'agentMessage',text:'print(42)'}}});
      codex.receive({method:'turn/completed',params:{threadId:'thread-1',turn:{status:'completed'}}});
    },1);
    return {turn:{id:'turn-1'}};
  }
  throw Error('Unexpected call '+method);
};
assert.deepEqual(Array.from((await models()).models,m=>m.id),['gpt-6-codex']);
const result=await solve({model:'gpt-6-codex',input:'Write Python to print 42',instructions:'Python 3'});
assert.equal(result.text,'print(42)');
const created=calls.find(c=>c.method==='thread/start');
assert.equal(created.params.approvalPolicy,'never');
assert.equal(created.params.sandbox,'read-only');
assert.equal(created.params.ephemeral,true);
assert.equal(created.params.config['features.shell_tool'],false);
assert.equal(created.params.config['features.multi_agent'],false);
assert.equal(created.params.config.web_search,'disabled');
const sent=calls.find(c=>c.method==='turn/start');
assert.equal(sent.params.sandboxPolicy.type,'readOnly');
assert.equal(sent.params.sandboxPolicy.networkAccess,false);
assert.ok(sent.params.input[0].text.includes('Python 3'));
await assert.rejects(solve({model:'bad?model',input:'hi'}),/모델 선택/);
await assert.rejects(solve({model:'gpt-7',input:'hi'}),/모델이 ChatGPT 계정/);
assert.equal(Array.from(normalizedModels({data:[{model:'abc'},{model:'abc'},{model:'a?b'}]})).length,1);
// Codex must never be allowed to invoke shell commands or modify local files.
const sentRpc=[];
codex.send=msg=>sentRpc.push(msg);
codex.receive({id:300,method:'item/tool/call',params:{command:'powershell Remove-Item'}});
assert.equal(sentRpc.at(-1).error.code,-32601);
assert.ok(!source.includes('api.openai.com/v1/responses'));
console.log('PASS: Codex read-only thread/turn lifecycle, text extraction, RPC tools blocked, model authorization');
