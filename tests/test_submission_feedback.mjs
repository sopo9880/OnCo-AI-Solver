import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const script = await readFile(resolve(root,'extension/submission-feedback.js'),'utf8');
const main = await readFile(resolve(root,'extension/submission-capture-main.js'),'utf8');
const manifest = JSON.parse(await readFile(resolve(root,'extension/manifest.json'),'utf8'));

assert.ok(manifest.content_scripts.some(item =>
  item.world === 'MAIN' && item.js.includes('submission-capture-main.js') &&
  item.run_at === 'document_start'));
assert.ok(manifest.content_scripts.some(item => item.js.includes('submission-feedback.js')));
assert.ok(!/\.click\(\)\s*;.*제출/.test(script),'Extension never automatically submits');
assert.ok(!script.includes('fetch('),'No private OnCo verdict API');
assert.ok(main.includes('getEditors'),'Capture the Monaco editor before navigation');
assert.ok(!main.includes('fetch('),'MAIN-world bridge does not access any endpoints');

const shim={exports:{}};
vm.runInNewContext(script,{globalThis:{},module:shim,Math,console},{timeout:2000});
const {classifyVerdict,extractVerdict,normalizeMode,normalizeVerdict}=shim.exports;
assert.equal(normalizeMode(undefined),'suggest');
assert.equal(normalizeMode('replace'),'replace');
assert.equal(normalizeMode('auto'),'suggest','Submit auto-retry must not be supported');
assert.equal(normalizeVerdict('accepted'),null,'Accepted is not a failure');
assert.equal(normalizeVerdict('wrong'),'wrong');

for(const [source,kind] of [
  ['채점 결과: 오답','wrong'],
  ['제출 결과: Wrong Answer','wrong'],
  ['제출 결과: 실행 시간 초과','time'],
  ['Time Limit Exceeded','time'],
  ['메모리 초과','memory'],
  ['Runtime Error','runtime'],
  ['컴파일 오류','compile'],
  ['부분 점수','partial'],
  ['제출 결과: 정답입니다','accepted']
])assert.equal(classifyVerdict(source)?.kind,kind,source);
assert.equal(classifyVerdict('테스트 케이스 2 오답'),null,'Test failures are not submission verdicts');
assert.equal(classifyVerdict('채점 중...'),null,'Pending is not a verdict');
assert.equal(classifyVerdict('오답 / 런타임 오류'),null,'Ambiguous result requires manual selection');

const node=(value,cls='submission-result',blocked=false)=>({
  innerText:value,className:cls,
  getAttribute:()=>null,closest:()=>blocked?{}:null
});
const document={querySelectorAll:()=>[node('제출 결과: 오답')]};
const parsed=extractVerdict(document);
assert.equal(parsed.kind,'wrong');
assert.ok(parsed.signature.includes('오답'));
assert.equal(extractVerdict({querySelectorAll:()=>[node('테스트 케이스 1 오답')]}),null);
assert.equal(extractVerdict({querySelectorAll:()=>[node('오답','ql-editor',true)]}),null);
assert.equal(extractVerdict({querySelectorAll:()=>[node('채점 중...')]}),null);
assert.equal(extractVerdict({querySelectorAll:()=>[
  node('채점 결과: 오답'),node('채점 결과: 런타임 오류')
]}),null,'Conflicting same-score verdicts require human confirmation');
console.log('PASS: v1.3.7 submission verdict parsing, test exclusion, manual fallback safety and MAIN-world capture');
