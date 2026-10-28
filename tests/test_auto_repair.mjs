import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import vm from 'node:vm';
const root=resolve(import.meta.dirname,'..');
const bg=await readFile(resolve(root,'extension/background.js'),'utf8');
const content=await readFile(resolve(root,'extension/test-feedback.js'),'utf8');
const parser={exports:{}};
vm.runInNewContext(content,{globalThis:{},module:parser,Math},{timeout:2000});
const getId=parser.exports.fingerprint;
const problem={title:'그래프 비용 최소화',description:'간선 비용을 읽어 최적 합계를 출력하는 코딩 테스트입니다.',language:'Python 3',testCases:'1 -> 1'};
const identity=getId(problem);
const failure={name:'테스트 케이스 1',status:'fail',input:'3\n1 2 3',
  expected:'27\n56',actual:'46\n56',detail:'테스트 실패'};
const storage={onco_test_mode:'assist',onco_test_max_retries:3,
  onco_provider:'openai',onco_openai_api_key:'TEST-OPENAI-KEY',
  onco_api_key:'TEST-GEMINI-KEY'};
let currentCode='print(0)';
let listener;
let hanging=false,releaseFetch=null;
const network=[],native=[],injected=[];
const chrome={
 commands:{onCommand:{addListener(){}}},
 storage:{local:{
   async get(keys,callback){
     const data={};
     for(const key of typeof keys==='string'?[keys]:keys)
       if(Object.hasOwn(storage,key))data[key]=storage[key];
     if(callback)callback(data);
     return data;
   },
   async set(data){Object.assign(storage,data);},
   async remove(keys){for(const key of Array.isArray(keys)?keys:[keys])delete storage[key];}
 }},
 runtime:{onMessage:{addListener(fn){listener=fn;}},
   connectNative:host=>{
     assert.equal(host,'org.onco.ai_solver');
     const port={onMessage:{addListener(fn){port.listener=fn;}},
       onDisconnect:{addListener(){}},
       postMessage(message){
         native.push(message);
         const values={
           status:{connected:true,sharing:true,available:true},
           models:{models:[{id:'gpt-6-codex',isDefault:true}]},
           solve:{text:'print(33)'}
         };
         queueMicrotask(()=>port.listener({id:message.id,success:true,...values[message.action]}));
       }};
     return port;
   }},
 tabs:{async sendMessage(tabId,message){
   assert.equal(tabId,17);assert.equal(message.action,'SCRAPE_PROBLEM');
   return {success:true,data:problem};
 }},
 scripting:{async executeScript(data){
   assert.equal(data.target.tabId,17);
   if(data.func.name==='guardedMonacoReplace'){
     assert.equal(data.world,'MAIN');
     const [next,previous]=data.args;
     if(currentCode.replace(/\r\n?/g,'\n')!==previous.replace(/\r\n?/g,'\n'))
       return [{result:{success:false,error:'[ESTALE] Code changed'}}];
     currentCode=next;injected.push(next);return [{result:{success:true,code:currentCode}}];
   }
   const fn=String(data.func);
   if(fn.includes('getEditors'))return [{result:currentCode}];
   return [{result:{success:true}}];
 }}
};
const respond=(body,status=200)=>({ok:status>=200&&status<300,status,
 json:async()=>body,text:async()=>JSON.stringify(body)});
async function fetchMock(url,init={}){
 network.push({url,init});
 if(url==='https://api.openai.com/v1/models')return respond({data:[{id:'gpt-6'}]});
 if(url==='https://api.openai.com/v1/responses'){
   if(hanging)await new Promise(resolve=>{releaseFetch=resolve;});
   return respond({status:'completed',
     output:[{type:'message',content:[{type:'output_text',text:'print(11)'}]}]});
 }
 if(url.includes('generativelanguage.googleapis.com')&&url.includes('/models?'))
   return respond({models:[{name:'models/gemini-4.3-flash',supportedGenerationMethods:['generateContent']}]});
 if(url.includes('generativelanguage.googleapis.com')&&url.includes(':generateContent'))
   return respond({candidates:[{content:{parts:[{text:'print(22)'}]}}]});
 throw Error('Unexpected fetch '+url);
}
vm.runInNewContext(bg,{chrome,fetch:fetchMock,URL,AbortSignal,console,
 Date,setTimeout,clearTimeout,Promise,queueMicrotask},{filename:'background.js',timeout:3000});
function send(message,sender={tab:{id:17,url:'https://dau.on-co.net/practice'}}){
 return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Timeout '+message.action)),10000);
   listener(message,sender,result=>{clearTimeout(timer);resolve(result);});
 });
}
const base={action:'REVISE_TEST_FAILURE',identity,expectedCode:'print(0)',
 feedback:[failure],attempt:0,requestId:'test-1'};
const denial=await send(base,{});
assert.equal(denial.success,false,'popup must not pretend to be a tested OnCo tab');
let preview=await send(base);
assert.equal(preview.success,true,preview.error);
assert.equal(preview.mode,'assist');
assert.equal(preview.applied,false);
assert.equal(preview.code,'print(11)');
assert.equal(currentCode,'print(0)');
assert.ok(network.some(x=>x.url.endsWith('/responses')));
const prompt=JSON.parse(network.find(x=>x.url.endsWith('/responses')).init.body);
assert.ok(prompt.input.includes('예상'));
assert.ok(prompt.input.includes('46'));
assert.ok(prompt.input.includes('print(0)'));
assert.equal(prompt.store,false);
let applied=await send({action:'APPLY_TEST_REVISION',requestId:'test-1',
 identity,expectedCode:'print(0)',code:preview.code});
assert.equal(applied.success,true,applied.error);
assert.equal(applied.applied,true);
assert.equal(currentCode,'print(11)');
let stale=await send({action:'APPLY_TEST_REVISION',requestId:'test-1',
 identity,expectedCode:'print(0)',code:'print(100)'});
assert.equal(stale.success,false,'Never overwrite a human code edit');
assert.equal(currentCode,'print(11)');
stale=await send({...base,requestId:'test-2',expectedCode:currentCode,identity:'other-problem'});
assert.equal(stale.success,false);
assert.ok(stale.error.includes('ESTALE'));
storage.onco_provider='gemini';storage.onco_test_mode='replace';currentCode='print(0)';
const replaced=await send({...base,requestId:'test-3'});
assert.equal(replaced.success,true,replaced.error);
assert.equal(replaced.mode,'replace');
assert.equal(replaced.applied,true);
assert.equal(currentCode,'print(22)');
assert.equal(injected.at(-1),'print(22)');
storage.onco_provider='chatgpt';storage.onco_test_mode='auto';currentCode='print(0)';
const auto=await send({...base,requestId:'test-4'});
assert.equal(auto.success,true,auto.error);
assert.equal(auto.mode,'auto');
assert.equal(auto.applied,true);
assert.equal(currentCode,'print(33)');
assert.ok(native.some(x=>x.action==='solve'),'ChatGPT must use existing Codex native bridge');
const limited=await send({...base,requestId:'test-5',attempt:3});
assert.equal(limited.success,false,'auto-retry cap must be enforced');
const malformed=await send({...base,requestId:'test-6',feedback:[{name:'fake',status:'pass'}]});
assert.equal(malformed.success,false);
storage.onco_test_mode='off';
const disabled=await send({...base,requestId:'test-7'});
assert.equal(disabled.success,false);
storage.onco_provider='openai';storage.onco_test_mode='assist';
currentCode='print(0)';hanging=true;
const pending=send({...base,requestId:'test-cancel'});
for(let i=0;i<25&&!releaseFetch;i++)await new Promise(r=>setTimeout(r,3));
assert.equal(typeof releaseFetch,'function');
const cancel=await send({action:'CANCEL_TEST_REVISION',requestId:'test-cancel'});
assert.equal(cancel.success,true);
assert.equal(cancel.cancelled,true);
releaseFetch();
const cancelled=await pending;
assert.equal(cancelled.success,false);
assert.ok(cancelled.error.includes('ECANCEL'));
assert.equal(currentCode,'print(0)');
// v1.3.7: submission source snapshots are session-only and never auto-submit.
hanging=false;
storage.onco_provider='openai';
storage.onco_submit_mode='suggest';
storage.onco_submit_history=true;
currentCode='print(0)';
const submissionId='submit-123456-1';
const submission={id:submissionId,identity,title:problem.title,
  description:problem.description,language:problem.language,
  code:'print(0)',baseline:'',originPath:'/practice'};
const badSender=await send({action:'GET_PENDING_SUBMISSION'},{tab:{id:17,url:'https://evil.example/'}});
assert.equal(badSender.success,false,'Only an OnCo tab may inspect submission snapshots');
const recorded=await send({action:'CAPTURE_SUBMISSION',snapshot:submission});
assert.equal(recorded.success,true,recorded.error);
const pendingSubmission=await send({action:'GET_PENDING_SUBMISSION'});
assert.equal(pendingSubmission.success,true);
assert.equal(pendingSubmission.pending.id,submissionId);
assert.ok(!Object.hasOwn(pendingSubmission.pending,'code'),
  'Never send stored submitted code to a result page');
const invalidVerdict=await send({action:'REVISE_SUBMISSION_FAILURE',
  id:submissionId,requestId:submissionId,verdict:'accepted'});
assert.equal(invalidVerdict.success,false,'Never repair an accepted submission');
const submittedFailure=await send({action:'REVISE_SUBMISSION_FAILURE',
  id:submissionId,requestId:submissionId,verdict:'wrong',detail:'채점 결과: 오답'});
assert.equal(submittedFailure.success,true,submittedFailure.error);
assert.equal(submittedFailure.applied,false);
assert.equal(submittedFailure.code,'print(11)');
assert.equal(currentCode,'print(0)','Suggest mode must preserve editor contents');
const applySubmission=await send({action:'APPLY_SUBMISSION_REVISION',
  id:submissionId,code:submittedFailure.code});
assert.equal(applySubmission.applied,true,applySubmission.error);
assert.equal(currentCode,'print(11)');
const repeatApply=await send({action:'APPLY_SUBMISSION_REVISION',
  id:submissionId,code:submittedFailure.code});
assert.equal(repeatApply.success,false,'Never overwrite an edited editor');
const cleared=await send({action:'CLEAR_SUBMISSION_SNAPSHOT',id:submissionId});
assert.equal(cleared.cleared,true);
assert.equal((await send({action:'GET_PENDING_SUBMISSION'})).pending,null);
const missingSubmission=await send({action:'REVISE_SUBMISSION_FAILURE',
  id:submissionId,requestId:submissionId,verdict:'wrong'});
assert.equal(missingSubmission.success,false,'Stale submission revisions must stop');
currentCode='print(0)';
const precheck=await send({action:'REVIEW_BEFORE_SUBMIT',
  requestId:'precheck-123-1',problem:{title:problem.title,description:problem.description,
    language:problem.language,identity},code:'print(0)'});
assert.equal(precheck.success,true,precheck.error);
assert.equal(precheck.unchanged,false);
assert.equal(precheck.code,'print(11)');
assert.equal(currentCode,'print(0)','Precheck does not submit or change the editor');
storage.onco_submit_precheck=false;
const disabledPrecheck=await send({action:'REVIEW_BEFORE_SUBMIT',
  requestId:'precheck-123-2',problem:{title:problem.title,description:problem.description,
    language:problem.language,identity},code:'print(0)'});
assert.equal(disabledPrecheck.success,false,'Precheck opt-out must be respected');

assert.ok(!bg.includes('button[aria-label="제출"]'));
console.log('PASS: OpenAI preview/apply, Gemini replacement, Codex auto mode, no submit, stale check, invalid feedback, retry cap, cancellation');
