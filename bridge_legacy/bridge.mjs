/**
 * OnCo AI Solver - optional local Sign in with ChatGPT bridge (Node.js >= 22).
 * Bind only to 127.0.0.1; OAuth credentials stay in process memory.
 * OpenAI's OSS OAuth uses a loopback HTTP callback and requires store:false/stream:true.
 * Does not access chatgpt.com cookies or private ChatGPT backend endpoints.
 */
import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHash, createPublicKey, createVerify, constants, timingSafeEqual } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';

const HOST = '127.0.0.1';
const PORT = Number(process.env.ONCO_BRIDGE_PORT || 18744);
if (PORT !== 18744) throw new Error('확장 프로그램과 일치하도록 포트는 18744만 지원합니다.');
const CALLBACK = `http://${HOST}:${PORT}/auth/callback`;
const AUTH_BASE = 'https://auth.openai.com';
const API_BASE = 'https://api.openai.com/v1';
const TOKEN_ENDPOINT = `${AUTH_BASE}/api/accounts/oauth/token`;
const APP_NAME = 'OnCo AI Solver';
const STORAGE_DIR = join(homedir(), '.onco-ai-solver');
const STORAGE_PATH = join(STORAGE_DIR, 'chatgpt-registration.json');
const MAX_BODY_BYTES = 350_000;
const CODE_LIFETIME_MS = 10 * 60 * 1000;
const pairingCode = randomBytes(6).toString('hex').toUpperCase();
const bridgeToken = randomBytes(32).toString('base64url');
let pairingTries = 0;
let paired = false;
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
    if (e.code !== 'ENOENT') console.warn('등록 정보 파일을 읽지 못해 새 연결로 시작합니다.');
  }
  await persistRegistration();
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

function cors(req, res) {
  const origin = req.headers.origin || '';
  if (!/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-OnCo-Bridge-Token');
  res.setHeader('Vary', 'Origin');
  return true;
}

function json(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(value));
}

async function bodyJson(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk.toString('utf8');
    if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) throw httpError(413, '입력 크기를 초과했습니다.');
  }
  try { return text ? JSON.parse(text) : {}; }
  catch (_) { throw httpError(400, 'JSON 요청을 읽을 수 없습니다.'); }
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

function beginSignin() {
  const nonce = randomBytes(24).toString('base64url');
  const state = randomBytes(24).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const clientId = registration.clientId || 'dynamic_agent_client';
  pending = { nonce, state, verifier, clientId, startedAt: Date.now() };
  const url = new URL(`${AUTH_BASE}/api/accounts/authorize`);
  for (const [key, val] of Object.entries({
    client_id: clientId, response_type: 'code', redirect_uri: CALLBACK,
    scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
    resource: API_BASE, state, nonce, code_challenge_method: 'S256', code_challenge: challenge,
    ext_agent_host_id: registration.hostId
  })) url.searchParams.set(key, val);
  if (clientId === 'dynamic_agent_client') url.searchParams.set('agent_name_hint', APP_NAME);
  if (session && !session.scopes.includes('chatgpt.tokens.use.direct')) url.searchParams.set('prompt', 'consent');
  return url.toString();
}

async function completeSignin(url) {
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
    code, code_verifier: attempt.verifier, redirect_uri: CALLBACK, resource: API_BASE });
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
    })().finally(() => { refreshPromise = null; });
  }
  try { await refreshPromise; }
  catch (err) { session = null; throw httpError(401, 'ChatGPT 세션 갱신 실패 — 다시 로그인해주세요.'); }
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

async function handle(req, res) {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  try {
    if (url.pathname === '/auth/callback' && req.method === 'GET') {
      try {
        const status = await completeSignin(url);
        renderAuthPage(res, true, status.sharing ? 'ChatGPT 플랜 사용 권한까지 승인되었습니다.' : '계정 로그인은 성공했지만 플랜 사용 권한은 승인되지 않았습니다.');
      } catch (err) { renderAuthPage(res, false, serializeError(err)); }
      return;
    }
    if (!cors(req, res)) return json(res, 403, { error: { message: '브라우저 확장 프로그램만 연결할 수 있습니다.' } });
    if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { success: true, ready: true });
    if (req.method === 'POST' && url.pathname === '/pair') {
      const data = await bodyJson(req);
      if (++pairingTries > 10) throw httpError(429, '연결 코드 입력 한도 초과: 도우미를 재시작해주세요.');
      if (!safeEquals(String(data.code || '').toUpperCase(), pairingCode)) throw httpError(401, '연결 코드가 일치하지 않습니다.');
      paired = true;
      pairingTries = 0;
      return json(res, 200, { token: bridgeToken });
    }
    if (!paired || !safeEquals(req.headers['x-onco-bridge-token'] || '', bridgeToken)) {
      throw httpError(401, '도우미 인증이 필요합니다. 연결 코드를 입력해주세요.');
    }
    if (req.method === 'GET' && url.pathname === '/status') return json(res, 200, {
      connected: Boolean(session), sharing: Boolean(session?.scopes.includes('chatgpt.tokens.use.direct')),
      email: session?.email || ''
    });
    if (req.method === 'POST' && url.pathname === '/signin') return json(res, 200, { url: beginSignin() });
    if (req.method === 'POST' && url.pathname === '/logout') return json(res, 200, await logout());
    if (req.method === 'GET' && url.pathname === '/models') return json(res, 200, { models: await listModels() });
    if (req.method === 'POST' && url.pathname === '/solve') return json(res, 200, { text: await solveWithChatGPT(await bodyJson(req)) });
    throw httpError(404, '이 경로는 제공되지 않습니다.');
  } catch (err) {
    json(res, Number(err.status) || 500, { error: { message: serializeError(err) } });
  }
}

await loadRegistration();
const server = createServer((req, res) => { handle(req, res); });
server.listen(PORT, HOST, () => {
  console.log(`\nOnCo ChatGPT 공식 로그인 도우미 — ${HOST}:${PORT}`);
  console.log('이 창은 ChatGPT 사용 중 계속 열어두세요. (Ctrl+C 종료)');
  console.log('확장 프로그램 연결 코드:', pairingCode);
  console.log('인증 토큰은 메모리에서만 보관되며 종료 시 사라집니다.\n');
});
server.on('error', err => { console.error('도우미 시작 실패:', err.message); process.exitCode = 1; });