import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const src = await readFile(resolve(import.meta.dirname,'../extension/problem-context.js'),'utf8');
const ctx = { globalThis: {} };
vm.runInNewContext(src,ctx);
const {detect} = ctx.globalThis.OnCoProblemContext;
function el(label, rect, category='heading') {
  return {innerText:label, textContent:label, isConnected:true,
    getBoundingClientRect:()=>({ ...rect, width: rect.width ?? 190, height: rect.height ?? 32 }),
    closest:()=>null, category};
}
const title=el('정수 사칙연산 계산기',{top:75,bottom:110,left:175});
const pageTitle=el('과제 연습',{top:5,bottom:30,left:22});
const desc=el('정수 A와 B를 입력받아 사칙연산을 계산하는 문제 내용입니다.',{top:145,bottom:350,left:174},'description');
const monaco=el('',{top:110,bottom:350,left:600},'editor');
function doc(heading=[pageTitle,title],descList=[desc],monacoList=[monaco]) {
  return { querySelectorAll: (sel)=> {
    if(sel==='.monaco-editor') return monacoList;
    if(sel==='.ql-editor') return descList;
    if(sel==='h1, h2, h3, .problem-title') return heading;
    return [];
  }};
}
assert.equal(detect(doc([pageTitle],[],[])),null,'home: no model editor/content');
assert.equal(detect(doc([pageTitle],[],[monaco])),null,'loading: no description');
assert.equal(detect(doc([pageTitle],[desc],[monaco])),null,'chapter header must not count as a problem');
const selected=detect(doc());
assert.ok(selected);
assert.equal(selected.title,title,'problem title, not the header');
assert.equal(selected.description,desc);
assert.equal(detect(doc([pageTitle,title],[el(' . ',{top:145,bottom:300,left:175})],[monaco])),null);
console.log('PASS: OnCo page detection requires visible Monaco, populated description, real problem heading');