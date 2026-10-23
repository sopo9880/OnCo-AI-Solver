/** OnCo Native Messaging host; no server on a permanent port and no API token in the extension. */
const { createServer } = require('node:http');
const { randomBytes, randomUUID, createHash, createPublicKey, createVerify, constants, timingSafeEqual } = require('node:crypto');
const { homedir } = require('node:os');
const { join } = require('node:path');
const { mkdir, readFile, rename, writeFile, rm, open } = require('node:fs/promises');
const { spawn } = require('node:child_process');


const HOST = '127.0.0.1';
const AUTH_BASE = 'https://auth.openai.com';
const API_BASE = 'https://api.openai.com/v1';
const TOKEN_ENDPOINT = `${AUTH_BASE}/api/accounts/oauth/token`;
const APP_NAME = 'OnCo AI Solver';
const STORAGE_DIR = process.env.ONCO_BRIDGE_DATA_DIR || join(process.env.LOCALAPPDATA || homedir(), 'OnCo AI Solver');
const STORAGE_PATH = join(STORAGE_DIR, 'chatgpt-registration.json');
const SESSION_PATH = join(STORAGE_DIR, 'chatgpt-session.dpapi');
const LOGIN_LOCK = join(STORAGE_DIR, 'signin.lock');
const CODE_LIFETIME_MS = 10 * 60 * 1000;
let pending = null;
let session = null;
let busy = false;
let refreshPromise = null;
let discovery = null;
let discoveryTime = 0;
let registration = { hostId: `urn:uuid:${randomUUID()}`, clientId: '', subject: '' };
async function persistRegistration() {
  await mkdir(STORAGE_DIR, { recursive: true, mode: 0o700 });
  const temp = STORAGE_PATH + '.' + randomBytes(5).toString('hex');
  await writeFile(temp, JSON.stringify(registration, null, 2), { mode: 0o600 });
  await rename(temp, STORAGE_PATH);
}

async function loadRegistration() {
  try {
    const saved = JSON.parse(await readFile(STORAGE_PATH, 'utf8'));
    if (/^urn:uuid:[0-9a-f-]{36}$/i.test(saved.hostId)) registration.hostId = saved.hostId;
    if (/^[a-zA-Z0-9._-]{5,200}$/.test(saved.clientId || '')) registration.clientId = saved.clientId;
    if (typeof saved.subject === 'string' && saved.subject.length < 500) registration.subject = saved.subject;
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('등록 정보 파일을 읽지 못해 새 연결로 시작합니다.');
    if (e.code === 'ENOENT') {
      // A create-exclusive write avoids resetting an identity another process just created.
      try { await mkdir(STORAGE_DIR, { recursive: true }); await writeFile(STORAGE_PATH, JSON.stringify(registration), { flag: 'wx', mode: 0o600 }); }
      catch (writeErr) { if (writeErr.code !== 'EEXIST') throw writeErr; const saved = JSON.parse(await readFile(STORAGE_PATH, 'utf8')); registration = saved; }
    }
  }
}

function serializeError(err) {
  const clean = String(err?.message || err || '작업을 완료하지 못했습니다.');
  return clean.slice(0, 500);
}

function httpError(code, msg) {
  const err = new Error(msg);
  err.status = code;
  return err;
}

function safeEquals(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

async function fetchJson(url, opts = {}) {
  const response = await fetch(url, { ...opts, redirect: 'error', signal: AbortSignal.timeout(30000) });
  let value = null;
  try { value = await response.json(); } catch (_) {}
  if (!response.ok) {
    const description = value?.error?.message || value?.detail || value?.message || response.statusText;
    throw httpError(response.status, `OpenAI 요청 실패 (${response.status}): ${String(description).slice(0, 220)}`);
  }
  return value;
}

async function oauthMetadata() {
  if (discovery && Date.now() - discoveryTime < 15 * 60 * 1000) return discovery;
  const value = await fetchJson(`${AUTH_BASE}/.well-known/openid-configuration`);
  if (!value?.jwks_uri?.startsWith(`${AUTH_BASE}/`)) throw Error('검증되지 않은 OpenAI JWKS 주소입니다.');
  discovery = value;
  discoveryTime = Date.now();
  return value;
}

function decodeBase64Url(s) {
  return Buffer.from(String(s), 'base64url');
}

async function verifyIdToken(raw, clientId, nonce) {
  if (typeof raw !== 'string' || raw.split('.').length !== 3) throw Error('올바른 ID 토큰을 받지 못했습니다.');
  const [encodedHeader, encodedPayload, encodedSig] = raw.split('.');
  const header = JSON.parse(decodeBase64Url(encodedHeader).toString('utf8'));
  const payload = JSON.parse(decodeBase64Url(encodedPayload).toString('utf8'));
  if (!['RS256', 'PS256', 'ES256'].includes(header.alg) || !header.kid) throw Error('ID 토큰의 서명 알고리즘이 허용되지 않습니다.');
  const metadata = await oauthMetadata();
  const jwks = await fetchJson(metadata.jwks_uri);
  const jwk = (jwks?.keys || []).find(k => k.kid === header.kid && (!k.alg || k.alg === header.alg));
  if (!jwk) throw Error('ID 토큰 서명 검증용 키를 찾지 못했습니다.');
  const verifier = createVerify('SHA256');
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  verifier.end();
  const options = { key: createPublicKey({ key: jwk, format: 'jwk' }) };
  if (header.alg === 'PS256') {
    options.padding = constants.RSA_PKCS1_PSS_PADDING;
    options.saltLength = 32;
  }
  if (header.alg === 'ES256') options.dsaEncoding = 'ieee-p1363';
  if (!verifier.verify(options, decodeBase64Url(encodedSig))) throw Error('ID 토큰 서명 검증 실패');
  if (payload.iss !== AUTH_BASE || !(payload.aud === clientId || (Array.isArray(payload.aud) && payload.aud.includes(clientId)))) {
    throw Error('ID 토큰 발급처/앱 정보가 일치하지 않습니다.');
  }
  if (!payload.sub || payload.nonce !== nonce || !Number.isFinite(payload.exp) || payload.exp <= Date.now() / 1000) {
    throw Error('ID 토큰 만료 또는 nonce 검증 실패');
  }
  if (typeof payload.iat === 'number' && payload.iat > Date.now() / 1000 + 120) {
    throw Error('ID 토큰 발급 시각 검증 실패');
  }
  return { subject: payload.sub, email: typeof payload.email === 'string' ? payload.email : '' };
}

async function exchangeToken(fields) {
  return fetchJson(TOKEN_ENDPOINT, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString()
  });
}


// Windows DPAPI: secrets are passed via stdin (never process arguments or stdout logs).
async function dpapi(value, operation) {
  if (process.platform !== 'win32') throw Error('Windows DPAPI가 필요한 기능입니다.');
  const action = operation === 'protect' ? 'Protect' : 'Unprotect';
  const script = `[Console]::InputEncoding=[Text.Encoding]::UTF8; [Console]::OutputEncoding=[Text.Encoding]::UTF8; ` +
    `$raw=[Console]::In.ReadToEnd().Trim(); $bytes=[Convert]::FromBase64String($raw); ` +
    `$res=[Security.Cryptography.ProtectedData]::${action}($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); ` +
    `[Console]::Out.Write([Convert]::ToBase64String($res));`;
  const command = Buffer.from(script, 'utf16le').toString('base64');
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', command], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', err = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { if (output.length < 400000) output += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { if (err.length < 4000) err += chunk; });
  child.stdin.end(operation === 'protect' ? Buffer.from(value, 'utf8').toString('base64') : value);
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  if (code !== 0 || !output.trim()) throw Error(`DPAPI credential operation failed (${code}). ${err.slice(0, 100)}`);
  return operation === 'protect' ? output.trim() : Buffer.from(output.trim(), 'base64').toString('utf8');
}
async function persistSession() {
  if (!session) return;
  await mkdir(STORAGE_DIR, { recursive: true, mode: 0o700 });
  const protectedValue = await dpapi(JSON.stringify(session), 'protect');
  const temp = SESSION_PATH + '.' + randomBytes(6).toString('hex');
  await writeFile(temp, protectedValue, { mode: 0o600 });
  await rename(temp, SESSION_PATH);
}
async function loadSession() {
  try {
    const bytes = await readFile(SESSION_PATH, 'utf8');
    const data = JSON.parse(await dpapi(bytes, 'unprotect'));
    if (data && data.clientId === registration.clientId && data.subject === registration.subject &&
        typeof data.accessToken === 'string' && Array.isArray(data.scopes)) session = data;
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('저장된 ChatGPT 세션을 열지 못했습니다. 재로그인이 필요합니다.');
  }
}
function beginSignin(callback) {
  const nonce = randomBytes(24).toString('base64url');
  const state = randomBytes(24).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const clientId = registration.clientId || 'dynamic_agent_client';
  pending = { nonce, state, verifier, clientId, startedAt: Date.now() };
  const url = new URL(`${AUTH_BASE}/api/accounts/authorize`);
  for (const [key, val] of Object.entries({
    client_id: clientId, response_type: 'code', redirect_uri: callback,
    scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
    resource: API_BASE, state, nonce, code_challenge_method: 'S256', code_challenge: challenge,
    ext_agent_host_id: registration.hostId
  })) url.searchParams.set(key, val);
  if (clientId === 'dynamic_agent_client') url.searchParams.set('agent_name_hint', APP_NAME);
  if (session && !session.scopes.includes('chatgpt.tokens.use.direct')) url.searchParams.set('prompt', 'consent');
  return url.toString();
}

async function completeSignin(url, callback) {
  if (!pending || Date.now() - pending.startedAt > CODE_LIFETIME_MS) throw Error('로그인 세션이 만료되었습니다. 다시 시도해주세요.');
  const attempt = pending;
  pending = null; // 1회 사용
  if (!safeEquals(url.searchParams.get('state') || '', attempt.state)) throw Error('OAuth state 값이 일치하지 않습니다.');
  if (url.searchParams.has('error')) throw Error('ChatGPT 로그인 또는 권한 제공이 취소되었습니다.');
  const code = url.searchParams.get('code');
  if (!code || code.length > 2048) throw Error('인증 코드가 없습니다.');
  const returnedClientId = url.searchParams.get('client_id');
  let issuedClientId = attempt.clientId;
  if (issuedClientId === 'dynamic_agent_client') {
    if (!returnedClientId || !/^[a-zA-Z0-9._-]{5,200}$/.test(returnedClientId) || returnedClientId === 'dynamic_agent_client') {
      throw Error('OpenAI가 발급한 앱 등록 ID가 없습니다.');
    }
    issuedClientId = returnedClientId;
    registration.clientId = issuedClientId;
    await persistRegistration(); // 코드 만료 시에도 등록 ID 재사용
  } else if (returnedClientId && returnedClientId !== issuedClientId) {
    throw Error('연결된 ChatGPT 앱 등록 정보가 변경되었습니다.');
  }
  const tokens = await exchangeToken({ grant_type: 'authorization_code', client_id: issuedClientId,
    code, code_verifier: attempt.verifier, redirect_uri: callback, resource: API_BASE });
  const identity = await verifyIdToken(tokens.id_token, issuedClientId, attempt.nonce);
  if (registration.subject && identity.subject !== registration.subject) {
    throw Error('기존 연결과 다른 ChatGPT 계정입니다. 다른 계정을 연결하려면 등록 정보를 초기화해야 합니다.');
  }
  const scopes = String(tokens.scope || '').split(/\s+/).filter(Boolean);
  if (!tokens.access_token) throw Error('액세스 토큰을 받지 못했습니다.');
  registration.subject = identity.subject;
  await persistRegistration();
  session = { ...identity, clientId: issuedClientId, accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || '', idToken: tokens.id_token, scopes,
    expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000 };
  await persistSession();
  return { connected: true, sharing: scopes.includes('chatgpt.tokens.use.direct') };
}

async function activeSession() {
  if (!session) throw httpError(401, '먼저 Continue with ChatGPT로 로그인해주세요.');
  if (!session.scopes.includes('chatgpt.tokens.use.direct')) {
    throw httpError(403, 'ChatGPT 플랜 사용 권한을 허용하지 않았습니다. 다시 로그인해 권한을 허용해주세요.');
  }
  if (session.expiresAt - Date.now() > 90_000) return session;
  if (!session.refreshToken) throw httpError(401, '세션이 만료됐습니다. 다시 로그인해주세요.');
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const tokens = await exchangeToken({ grant_type: 'refresh_token', client_id: session.clientId,
        refresh_token: session.refreshToken, resource: API_BASE });
      if (!tokens.access_token) throw Error('토큰 갱신 결과가 올바르지 않습니다.');
      session.accessToken = tokens.access_token;
      session.refreshToken = tokens.refresh_token || session.refreshToken;
      session.expiresAt = Date.now() + Number(tokens.expires_in || 3600) * 1000;
      if (tokens.scope) session.scopes = String(tokens.scope).split(/\s+/).filter(Boolean);
      await persistSession();
    })().finally(() => { refreshPromise = null; });
  }
  try { await refreshPromise; }
  catch (err) {
    if (['invalid_grant', 'invalid_refresh_token', 'refresh_token_invalidated'].some(code => String(err.message).includes(code))) {
      session = null; await rm(SESSION_PATH, { force: true });
    }
    throw httpError(401, 'ChatGPT 세션 갱신 실패 — 다시 로그인해주세요.');
  }
  return session;
}

async function listModels() {
  const s = await activeSession();
  const payload = await fetchJson(`${API_BASE}/models`, { headers: { Authorization: `Bearer ${s.accessToken}` } });
  return (Array.isArray(payload?.models) ? payload.models : [])
    .filter(m => m.visibility === 'list' && typeof m.slug === 'string')
    .map(m => ({ id: m.slug, displayName: m.display_name || m.slug }));
}

async function solveWithChatGPT(data) {
  const s = await activeSession();
  const model = String(data.model || '');
  const input = String(data.input || '');
  const instructions = String(data.instructions || '');
  if (!model || model.length > 150 || !input.trim() || input.length > 210_000 || instructions.length > 20_000) {
    throw httpError(400, '문제 또는 모델 선택 값이 올바르지 않습니다.');
  }
  if (busy) throw httpError(429, '이미 문제 풀이 요청을 진행하고 있습니다.');
  busy = true;
  try {
    const response = await fetch(`${API_BASE}/responses`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(220_000),
      headers: { Authorization: `Bearer ${s.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, instructions, input: [{ role: "user", content: input }], store: false, stream: true })
    });
    if (!response.ok) {
      let detail = '';
      try {
        const payload = await response.json();
        detail = payload.error?.message || payload.detail || payload.message || '';
      } catch (_) {}
      throw httpError(response.status, `ChatGPT 요청 실패 (${response.status}) ${String(detail).slice(0, 200)}`);
    }
    if (!response.body) throw Error('스트리밍 응답이 없습니다.');
    let buffer = '';
    let output = '';
    let completed = false;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        if (buffer.length > 2_000_000) throw Error('응답 이벤트 크기 제한 초과');
        let separator;
        while ((separator = buffer.indexOf('\n\n')) >= 0) {
          const eventText = buffer.slice(0, separator);
          buffer = buffer.slice(separator + 2);
          const lines = eventText.split('\n').filter(line => line.startsWith('data:'));
          if (!lines.length) continue;
          const payload = lines.map(line => line.slice(5).trimStart()).join('\n');
          if (payload === '[DONE]') continue;
          let item;
          try { item = JSON.parse(payload); } catch (_) { continue; }
          if (item.type === 'response.output_text.delta') output += item.delta || '';
          if (item.type === 'response.failed' || item.type === 'response.incomplete' || item.type === 'error') {
            throw Error(item.response?.error?.message || item.error?.message || item.message || `응답 ${item.type}`);
          }
          if (item.type === 'response.completed') completed = true;
          if (output.length > 450_000) throw Error('응답 코드 길이 제한 초과');
        }
      }
    } finally { reader.releaseLock(); }
    if (!completed) throw Error('응답 스트림이 완료 이벤트 없이 종료되었습니다.');
    if (!output.trim()) throw Error('ChatGPT가 빈 코드 응답을 보냈습니다.');
    return output;
  } finally { busy = false; }
}

async function logout() {
  let revoked = false;
  const s = session;
  session = null;
  pending = null;
  await rm(SESSION_PATH, { force: true });
  if (s?.refreshToken) {
    try {
      const metadata = await oauthMetadata();
      const uri = metadata?.revocation_endpoint;
      if (uri?.startsWith(`${AUTH_BASE}/`)) {
        const res = await fetch(uri, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: s.refreshToken, token_type_hint: 'refresh_token', client_id: s.clientId }).toString() });
        revoked = res.ok;
      }
    } catch (_) {}
  }
  return { warning: s?.refreshToken && !revoked ? '원격 연결 해제를 확인하지 못했습니다. ChatGPT 설정에서 앱 연결을 해제할 수 있습니다.' : '' };
}

function renderAuthPage(res, ok, msg) {
  const safe = String(msg).replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(`<!doctype html><html lang="ko"><meta charset="UTF-8"><title>OnCo ChatGPT 로그인</title><body style="background:#0f1117;color:#dde5ef;font:16px system-ui;padding:44px;max-width:650px;margin:auto"><h1>${ok ? 'ChatGPT 로그인 완료' : 'ChatGPT 로그인 실패'}</h1><p>${safe}</p><p>확장 프로그램 팝업으로 돌아가 상태를 확인해주세요.</p></body></html>`);
}


function status() {
  return { connected: Boolean(session), sharing: Boolean(session?.scopes?.includes('chatgpt.tokens.use.direct')),
    email: session?.email || '' };
}
function selfArgs(mode) {
  const isPackaged = process.execPath.toLowerCase().endsWith('oncobridge.exe');
  return isPackaged ? [mode] : [process.argv[1], mode];
}
async function startLoginWorker() {
  const child = spawn(process.execPath, selfArgs('--login-worker'), { detached: true, windowsHide: true, stdio: 'ignore' });
  child.unref();
  return { started: true };
}
async function loginWorker() {
  await mkdir(STORAGE_DIR, { recursive: true, mode: 0o700 });
  let file;
  try { file = await open(LOGIN_LOCK, 'wx', 0o600); }
  catch (err) {
    if (err.code !== 'EEXIST') throw err;
    // An abandoned lock from a crashed login is released after the timeout.
    const info = JSON.parse(await readFile(LOGIN_LOCK, 'utf8').catch(() => '{}'));
    if (Date.now() - Number(info.startedAt || 0) < CODE_LIFETIME_MS + 30_000) return;
    await rm(LOGIN_LOCK, { force: true });
    file = await open(LOGIN_LOCK, 'wx', 0o600);
  }
  try {
    await file.writeFile(JSON.stringify({ startedAt: Date.now(), pid: process.pid }));
    await file.close();
    let callback;
    const server = createServer(async (req, res) => {
      const url = new URL(req.url || '/', callback);
      if (req.method !== 'GET' || url.pathname !== '/auth/callback') {
        res.writeHead(404).end(); return;
      }
      try {
        const result = await completeSignin(url, callback);
        renderAuthPage(res, true, result.sharing ? 'ChatGPT 플랜 사용이 승인되었습니다.' : '로그인은 성공했지만 플랜 사용 권한은 승인되지 않았습니다.');
      } catch (err) {
        renderAuthPage(res, false, serializeError(err));
      } finally {
        server.close();
      }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject); server.listen(0, HOST, resolve);
    });
    callback = `http://${HOST}:${server.address().port}/auth/callback`;
    const authorizeUrl = beginSignin(callback);
    // Use the Windows default browser, no shell interpolation of user-provided input.
    const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', authorizeUrl], { windowsHide: true, stdio: 'ignore' });
    browser.on('error', err => console.error('브라우저 열기 실패:', err.message));
    await new Promise(resolve => {
      const timeout = setTimeout(() => server.close(), CODE_LIFETIME_MS);
      server.once('close', () => { clearTimeout(timeout); resolve(); });
    });
  } finally {
    await rm(LOGIN_LOCK, { force: true });
  }
}
const MAX_NATIVE_INPUT = 400_000;
async function readNativeMessage() {
  let buffer = Buffer.alloc(0), total = 0;
  for await (const part of process.stdin) {
    total += part.length;
    if (total > MAX_NATIVE_INPUT + 4) throw Error('Native Messaging 요청이 너무 큽니다.');
    buffer = Buffer.concat([buffer, part]);
    if (buffer.length >= 4) {
      const size = buffer.readUInt32LE(0);
      if (size > MAX_NATIVE_INPUT) throw Error('Native Messaging 길이 제한 초과');
      if (buffer.length >= size + 4) return JSON.parse(buffer.subarray(4, size + 4).toString('utf8'));
    }
  }
  throw Error('Native Messaging 입력이 없습니다.');
}
function writeNativeMessage(value) {
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  if (payload.length > 1_000_000) throw Error('Native Messaging 응답 크기 제한 초과');
  const header = Buffer.alloc(4); header.writeUInt32LE(payload.length, 0);
  process.stdout.write(Buffer.concat([header, payload]));
}
async function dispatch(msg) {
  const action = msg?.action;
  switch (action) {
    case 'ping': return { ready: true, version: '1.3.0' };
    case 'status': return status();
    case 'signin': return startLoginWorker();
    case 'logout': return logout();
    case 'models': return { models: await listModels() };
    case 'solve': return { text: await solveWithChatGPT(msg.data || {}) };
    default: throw Error('허용되지 않은 인증 도우미 명령입니다.');
  }
}
async function main() {
  try {
    await loadRegistration();
    await loadSession();
    if (process.argv.includes('--login-worker')) {
      await loginWorker();
      return;
    }
    const incoming = await readNativeMessage();
    const result = await dispatch(incoming);
    writeNativeMessage({ success: true, ...result });
  } catch (err) {
    // stdout stays clean so Chrome can decode the native frame.
    if (!process.argv.includes('--login-worker')) writeNativeMessage({ success: false, error: serializeError(err) });
    else console.error('ChatGPT 로그인:', serializeError(err));
    process.exitCode = 1;
  }
}
main().catch(err => { console.error(String(err.message || err)); process.exitCode = 1; });