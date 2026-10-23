import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(resolve(root, 'extension/manifest.json'), 'utf8'));
const bg = await readFile(resolve(root, 'extension/background.js'), 'utf8');
const popupJS = await readFile(resolve(root, 'extension/popup.js'), 'utf8');
const popupHTML = await readFile(resolve(root, 'extension/popup.html'), 'utf8');
assert.equal(manifest.manifest_version, 3);
assert.ok(manifest.host_permissions.includes('https://api.openai.com/*'));
for (const [, id] of popupJS.matchAll(/document\.getElementById\("([^\"]+)"\)/g)) {
  assert.ok(popupHTML.includes(`id="${id}"`), `Missing popup DOM id ${id}`);
}
let listener;
const storage = {};
const fetchCalls = [];
const injections = [];
const nativeCalls = [];
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
  runtime: { onMessage: { addListener: callback => { listener = callback; } },
    connectNative: host => {
      const port = {
        onMessage: { addListener(fn){ port.onNativeMessage=fn; } },
        onDisconnect: { addListener(fn){ port.onNativeDisconnect=fn; } },
        postMessage: msg => {
          nativeCalls.push({host,msg});
          const replies = {
            status: {available:true,connected:true,sharing:true,identityStatus:'signed_in',
              planStatus:'codex_connected',planType:'team',email:'tester@example.com'},
            signin: {started:true,login:{mode:'device',userCode:'ABCD-1234',verificationUrl:'https://auth.openai.com/codex/device'}},
            'signin-browser': {started:true,login:{mode:'browser',authUrl:'https://chatgpt.com/auth/login'}},
            'cancel-login': {cancelled:true},logout: {connected:false},
            models: {models:[{id:'gpt-6.1-sol',displayName:'GPT 6.1 Sol',isDefault:true},
              {id:'gpt-6-astra',displayName:'GPT 6 Astra'}]},
            solve: {text:'print(3)'}
          };
          queueMicrotask(()=>port.onNativeMessage({
            id:msg.id,success:!!replies[msg.action],...(replies[msg.action]||{error:'unsupported'})
          }));
        }
      };
      return port;
    } },
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
listed = await send({action:'GET_MODELS',provider:'chatgpt'});
assert.equal(listed.success, true, listed.error);
assert.equal(listed.autoModel, 'gpt-6.1-sol');
await send({action:'SOLVE_PROBLEM',tabId:11}).then(res => assert.equal(res.success, true, res.error));
assert.equal(injections.at(-1), 'print(3)');
const bridgeSolve = nativeCalls.find(c => c.msg.action === 'solve');
assert.equal(bridgeSolve.msg.data.model, 'gpt-6.1-sol');
assert.equal(bridgeSolve.host,'org.onco.ai_solver');
const authStatus = await send({action:'GET_CHATGPT_STATUS'});
assert.equal(authStatus.connected,true);
assert.equal(Object.hasOwn(authStatus,'email'),false,'extension must not receive the optional profile email');
const login=await send({action:'START_CHATGPT_SIGNIN'});
assert.equal(login.success,true);
assert.equal(login.login.userCode,'ABCD-1234');
assert.equal(nativeCalls.at(-1).msg.action,'signin');
assert.equal((await send({action:'START_CHATGPT_BROWSER_SIGNIN'})).success,true);
assert.equal(nativeCalls.at(-1).msg.action,'signin-browser');
assert.equal((await send({action:'CANCEL_CHATGPT_SIGNIN'})).success,true);
assert.equal(nativeCalls.at(-1).msg.action,'cancel-login');
assert.ok(!bg.includes('chrome.runtime.sendNativeMessage'));
// Content scripts cannot query credential-related messages.
const rejected = await send({action:'GET_CHATGPT_STATUS'}, {tab:{id:11}});
assert.equal(rejected.success, false);
const deniedBrowser = await send({action:'START_CHATGPT_BROWSER_SIGNIN'},{tab:{id:11}});
assert.equal(deniedBrowser.success,false);
const deniedCancel = await send({action:'CANCEL_CHATGPT_SIGNIN'},{tab:{id:11}});
assert.equal(deniedCancel.success,false);
console.log('PASS: popup DOM, OpenAI/Gemini/ChatGPT routing, dynamic model selection, injection, secret compartmentalization');
