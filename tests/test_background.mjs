import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
const bg = await readFile(resolve(root, 'background.js'), 'utf8');
const popupJS = await readFile(resolve(root, 'popup.js'), 'utf8');
const popupHTML = await readFile(resolve(root, 'popup.html'), 'utf8');
assert.equal(manifest.manifest_version, 3);
assert.ok(manifest.host_permissions.includes('https://api.openai.com/*'));
for (const [, id] of popupJS.matchAll(/document\.getElementById\("([^\"]+)"\)/g)) {
  assert.ok(popupHTML.includes(`id="${id}"`), `Missing popup DOM id ${id}`);
}
let listener;
const storage = {};
const fetchCalls = [];
const injections = [];
const chrome = {
  commands: { onCommand: { addListener: () => {} } },
  storage: { local: {
    get: async (keys, cb) => {
      const o = {};
      for (const key of typeof keys === 'string' ? [keys] : keys) if (Object.hasOwn(storage, key)) o[key] = storage[key];
      if (cb) cb(o);
      return o;
    },
    set: async values => { Object.assign(storage, values); },
    remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key]; },
    setAccessLevel: async () => {}
  } },
  runtime: { onMessage: { addListener: callback => { listener = callback; } } },
  tabs: { sendMessage: async () => ({ success: true, data: { title: 'Test', description: 'input int', language: 'Python 3', testCases: '1=>1' } }),
    create: async () => ({}) },
  scripting: { executeScript: async args => { injections.push(args.args?.[0]); return [{result:{success:true}}]; } }
};
const makeResponse = (value, status = 200) => ({ ok: status >= 200 && status < 300, status,
  json: async () => value, text: async () => JSON.stringify(value) });
const fetchMock = async (url, init = {}) => {
  fetchCalls.push({ url: String(url), init });
  if (url.includes('generativelanguage.googleapis.com') && url.includes('/models?')) {
    return makeResponse({ models: [ {name: 'models/gemini-4.3-flash', supportedGenerationMethods:['generateContent']},
      {name:'models/gemini-4.2-flash', supportedGenerationMethods:['generateContent']},
      {name:'models/gemini-embedding-2', supportedGenerationMethods:['embedContent']} ] });
  }
  if (url.includes('generativelanguage.googleapis.com') && url.includes(':generateContent')) {
    return makeResponse({ candidates: [{content: {parts: [{text:'print(1)'}]}}] });
  }
  if (url === 'https://api.openai.com/v1/models') {
    return makeResponse({ data: [ {id:'gpt-6-mini'}, {id:'gpt-image-1'}, {id:'gpt-6'}, {id:'gpt-5.2'}, {id:'gpt-6-nano'}, {id:'text-embedding-3-small'}, {id:'gpt-6-realtime'} ] });
  }
  if (url === 'https://api.openai.com/v1/responses') {
    return makeResponse({ status:'completed', output:[{type:'message',content:[{type:'output_text',text:'```python\nprint(2)\n```'}]}] });
  }
  if (url.includes('127.0.0.1:18744')) {
    const path = new URL(url).pathname;
    if (path === '/health') return makeResponse({ready:true});
    if (path === '/status') return makeResponse({connected:true,sharing:true,email:'test@example.com'});
    if (path === '/models') return makeResponse({models:[{id:'gpt-6.1-sol',displayName:'GPT 6.1 Sol'}, {id:'gpt-6-astra',displayName:'GPT 6 Astra'}]});
    if (path === '/solve') return makeResponse({text:'print(3)'});
    if (path === '/pair') return makeResponse({token:'test-token'});
    if (path === '/logout') return makeResponse({});
    throw new Error('unexpected bridge path ' + path);
  }
  throw new Error('Unexpected fetch: ' + url);
};
vm.runInNewContext(bg, { chrome, fetch: fetchMock, URL, AbortSignal, console, Date,
  setTimeout, clearTimeout, Promise }, { filename:'background.js' });
assert.equal(typeof listener, 'function');
function send(message, sender = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('message timeout: ' + message.action)), 10000);
    listener(message, sender, response => { clearTimeout(timer); resolve(response); });
  });
}
// OpenAI latest dynamically discovered, and no hardcoded model IDs.
storage.onco_openai_api_key = 'TEST-OPENAI-KEY';
storage.onco_provider = 'openai';
let listed = await send({action:'GET_MODELS',provider:'openai'});
assert.equal(listed.success, true, listed.error);
assert.equal(listed.autoModel, 'gpt-6');
assert.equal(listed.models.some(m => m.id === 'gpt-image-1'), false);
await send({action:'SOLVE_PROBLEM',tabId:11}).then(res => assert.equal(res.success, true, res.error));
assert.equal(injections.at(-1), 'print(2)');
const request = fetchCalls.find(call => call.url.endsWith('/responses'));
assert.equal(JSON.parse(request.init.body).model, 'gpt-6');
assert.equal(JSON.parse(request.init.body).store, false);
assert.ok(request.init.headers.Authorization.includes('TEST-OPENAI-KEY'));
assert.ok(!request.url.includes('TEST-OPENAI-KEY'));
// Existing Gemini path remains usable with legacy onco_api_key storage.
storage.onco_provider = 'gemini';
storage.onco_api_key = 'TEST-GEMINI-KEY';
listed = await send({action:'GET_MODELS',provider:'gemini'});
assert.equal(listed.success, true, listed.error);
assert.equal(listed.autoModel, 'gemini-4.3-flash');
await send({action:'SOLVE_PROBLEM',tabId:11}).then(res => assert.equal(res.success, true, res.error));
assert.equal(injections.at(-1), 'print(1)');
// ChatGPT plan bridge uses distinct token, no API-key leakage.
storage.onco_provider = 'chatgpt';
storage.onco_bridge_token = 'test-token';
listed = await send({action:'GET_MODELS',provider:'chatgpt'});
assert.equal(listed.success, true, listed.error);
assert.equal(listed.autoModel, 'gpt-6.1-sol');
await send({action:'SOLVE_PROBLEM',tabId:11}).then(res => assert.equal(res.success, true, res.error));
assert.equal(injections.at(-1), 'print(3)');
const bridgeSolve = fetchCalls.find(c => c.url.endsWith('/solve'));
assert.equal(JSON.parse(bridgeSolve.init.body).model, 'gpt-6.1-sol');
assert.equal(bridgeSolve.init.headers['X-OnCo-Bridge-Token'], 'test-token');
// Content scripts cannot query credential-related messages.
const rejected = await send({action:'GET_CHATGPT_STATUS'}, {tab:{id:11}});
assert.equal(rejected.success, false);
console.log('PASS: popup DOM, OpenAI/Gemini/ChatGPT routing, dynamic model selection, injection, secret compartmentalization');