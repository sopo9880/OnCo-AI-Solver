import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import vm from 'node:vm';

const root=resolve(import.meta.dirname,'..');
const content=await readFile(resolve(root,'extension/test-feedback.js'),'utf8');
const manifest=JSON.parse(await readFile(resolve(root,'extension/manifest.json'),'utf8'));
assert.ok(manifest.content_scripts.some(x=>x.js.includes('test-feedback.js')));
assert.ok(!content.includes('button[aria-label="제출"]'),'Auto debugger must never target Submit');
assert.ok(!content.includes('fetch('),'Read test results from the DOM, not undocumented private APIs');

const shim={exports:{}};
vm.runInNewContext(content,{globalThis:{},module:shim,console,Math},{filename:'test-feedback.js',timeout:3000});
const {collectCases,summarize,fingerprint,normalizeMode,normalizeRetries,currentProblem}=shim.exports;
assert.equal(typeof collectCases,'function');
assert.equal(normalizeMode(undefined),'assist');
assert.equal(normalizeMode('legacy'),'assist');
assert.equal(normalizeMode('auto'),'auto');
assert.equal(normalizeMode('off'),'off');
assert.equal(normalizeRetries(undefined),3);
assert.equal(normalizeRetries(9),5);
assert.equal(normalizeRetries(0),1);
assert.equal(normalizeRetries(2),2);

function sample(name,status,open,fields={}){
  const trigger={textContent:name+' '+status};
  const dt=Object.entries(fields).map(([label,value])=>({
    textContent:label,nextElementSibling:{tagName:'DD',textContent:value}
  }));
  const detail={querySelectorAll:()=>[{textContent:status}]};
  return {getAttribute:key=>key==='data-state'?(open?'open':'closed'):null,
    querySelector:selector=>selector==='[data-slot="accordion-trigger"]'?trigger:
      selector==='[data-slot="accordion-content"]'?(open?detail:null):null,
    querySelectorAll:selector=>selector==='dt'?(open?dt:[]):[]
  };
}
const failure=sample('테스트 케이스 1','테스트 실패',true,{
  '입력값':'10\n0 5 18 7 23 -1','예상 출력값':'27\n56\n390',
  '실제 출력값':'46\n56\n390'
});
const closed=sample('테스트 케이스 2','테스트 실패',false);
const document={querySelectorAll:selector=>selector==='[data-slot="accordion-item"]'?[failure,closed]:[]};
const parsed=collectCases(document);
assert.equal(parsed.length,2);
assert.equal(parsed[0].name,'테스트 케이스 1');
assert.equal(parsed[0].status,'fail');
assert.equal(parsed[0].input,'10\n0 5 18 7 23 -1');
assert.equal(parsed[0].expected,'27\n56\n390');
assert.equal(parsed[0].actual,'46\n56\n390');
assert.equal(parsed[1].status,'fail');
assert.equal(parsed[1].input,'');
assert.equal(parsed[1].expanded,false);
const first=summarize(document);
assert.equal(first.complete,true);
assert.equal(first.failed.length,2);
assert.ok(first.signature.includes('46'));
const pass=sample('테스트 케이스 1','테스트 성공',true,{
  '입력값':'10','예상 출력값':'27','실제 출력값':'27'
});
const passed=summarize({querySelectorAll:()=>[pass]});
assert.equal(passed.complete,true);
assert.equal(passed.failed.length,0);
assert.notEqual(first.signature,passed.signature);
const unknown=sample('테스트 케이스 1','테스트 중',false);
assert.equal(summarize({querySelectorAll:()=>[unknown]}).complete,false);
const a=fingerprint({title:'문제 1',description:'내용 123'});
assert.equal(a,fingerprint({title:'문제 1',description:'내용 123'}));
assert.notEqual(a,fingerprint({title:'문제 2',description:'내용 123'}));
assert.notEqual(a,fingerprint({title:'문제 1',description:'내용 124'}));
assert.ok(a.length<220);
const long=sample('테스트 케이스 1','테스트 실패',true,{'입력값':'X'.repeat(9000)});
assert.equal(collectCases({querySelectorAll:()=>[long]})[0].input.length,3500);
assert.equal(collectCases({querySelectorAll:()=>Array.from({length:30},()=>failure)}).length,12);

const context={title:{innerText:'문제 1',textContent:'문제 1'},description:{innerText:'문제 내용',textContent:'문제 내용'}};
const scope={OnCoProblemContext:{detect:()=>context,text:el=>el.innerText}};
const contextRun=vm.runInNewContext(content+'\n', {globalThis:scope,module:{exports:{}},console,Math},
  {filename:'test-feedback.js',timeout:3000});
assert.ok(scope.OnCoTestFeedback.currentProblem({}));
assert.equal(scope.OnCoTestFeedback.currentProblem({}).identity,
  fingerprint({title:'문제 1',description:'문제 내용'}));
console.log('PASS: v1.3.6 OnCo test results: failed cases, input/expected/actual, closed accordion, stable identity, privacy limits and safe defaults');
