"use strict";

// ──────────────────────────────────────────────
// 로거
// ──────────────────────────────────────────────
const MAX_LOG_ENTRIES = 200;

async function writeLog(level, message) {
  const entry = {
    ts: new Date().toISOString(),
    level, // "INFO" | "SUCCESS" | "ERROR"
    msg: message
  };
  const { onco_logs = [] } = await chrome.storage.local.get("onco_logs");
  onco_logs.push(entry);
  // 최대 200개 유지
  if (onco_logs.length > MAX_LOG_ENTRIES) onco_logs.splice(0, onco_logs.length - MAX_LOG_ENTRIES);
  await chrome.storage.local.set({ onco_logs });
}

// ──────────────────────────────────────────────
// Gemini API / 모델 카탈로그
// ──────────────────────────────────────────────
const GEMINI_API_ROOT = "https://generativelanguage.googleapis.com/v1beta";
const AUTO_MODEL = "__auto_gemini_flash__";
const DEFAULT_MODEL = AUTO_MODEL;
const MODEL_CACHE_TTL_MS = 60 * 60 * 1000; // 1시간마다 자동 재동기화
const MODEL_CACHE_KEY = "onco_model_catalog";
const MODEL_CACHE_TIME_KEY = "onco_model_catalog_updated_at";

function normalizeModelId(value) {
  return String(value || "").trim().replace(/^models\//, "");
}

function supportsGenerateContent(model) {
  return Array.isArray(model?.supportedGenerationMethods) &&
    model.supportedGenerationMethods.includes("generateContent");
}

function isSpecializedModel(modelId) {
  return /(embedding|image|tts|live|robotics|computer-use|audio|veo|lyria)/i.test(modelId);
}

function isPreviewOrExperimental(modelId) {
  return /(preview|experimental|exp(?:-|$))/i.test(modelId);
}

function numericVersionParts(modelId) {
  const m = modelId.match(/^gemini-(\d+)(?:\.(\d+))?/i);
  if (!m) return [0, 0];
  return [Number(m[1] || 0), Number(m[2] || 0)];
}

function compareModels(a, b) {
  const aId = normalizeModelId(a.id || a.name);
  const bId = normalizeModelId(b.id || b.name);

  const aLatest = /-latest$/i.test(aId) ? 1 : 0;
  const bLatest = /-latest$/i.test(bId) ? 1 : 0;
  if (aLatest !== bLatest) return bLatest - aLatest;

  const [aMajor, aMinor] = numericVersionParts(aId);
  const [bMajor, bMinor] = numericVersionParts(bId);
  if (aMajor !== bMajor) return bMajor - aMajor;
  if (aMinor !== bMinor) return bMinor - aMinor;

  const aStable = isPreviewOrExperimental(aId) ? 0 : 1;
  const bStable = isPreviewOrExperimental(bId) ? 0 : 1;
  if (aStable !== bStable) return bStable - aStable;

  const familyRank = (id) => {
    if (/\bpro\b/i.test(id)) return 3;
    if (/flash(?!-lite)/i.test(id)) return 2;
    if (/flash-lite/i.test(id)) return 1;
    return 0;
  };
  const familyDiff = familyRank(bId) - familyRank(aId);
  if (familyDiff) return familyDiff;

  return aId.localeCompare(bId);
}

function normalizeModelRecord(model) {
  const id = normalizeModelId(model?.name || model?.baseModelId);
  return {
    id,
    name: model?.name || (id ? `models/${id}` : ""),
    baseModelId: model?.baseModelId || id,
    displayName: model?.displayName || id,
    description: model?.description || "",
    inputTokenLimit: Number(model?.inputTokenLimit || 0),
    outputTokenLimit: Number(model?.outputTokenLimit || 0),
    thinking: Boolean(model?.thinking),
    supportedGenerationMethods: Array.isArray(model?.supportedGenerationMethods)
      ? model.supportedGenerationMethods
      : [],
    family: id.startsWith("gemma-") ? "gemma" : "gemini",
    specialized: isSpecializedModel(id),
    preview: isPreviewOrExperimental(id),
    latestAlias: /-latest$/i.test(id)
  };
}

async function parseGeminiError(response, context = {}) {
  let errBody = "";
  try { errBody = await response.text(); } catch (_) {}

  let apiMessage = "";
  try {
    const errJson = JSON.parse(errBody);
    apiMessage = errJson?.error?.message || "";
  } catch (_) {}

  const detail = apiMessage || errBody.slice(0, 300);
  const modelSuffix = context.model ? ` (${context.model})` : "";
  const codeMap = {
    400: `[E400] 잘못된 Gemini API 요청 — ${detail || "요청 형식을 확인해주세요."}`,
    401: `[E401] Gemini API 인증 실패 — API 키를 확인해주세요.${detail ? " (" + detail + ")" : ""}`,
    403: `[E403] Gemini API 권한 없음 — API 키/프로젝트 권한을 확인해주세요.${detail ? " (" + detail + ")" : ""}`,
    404: `[E404] Gemini 모델을 찾을 수 없습니다${modelSuffix}.${detail ? " (" + detail + ")" : ""}`,
    429: `[E429] Gemini API 요청 한도 초과 — 잠시 후 다시 시도해주세요.${detail ? " (" + detail + ")" : ""}`,
    500: `[E500] Gemini 서버 내부 오류 — 잠시 후 다시 시도해주세요.`,
    503: `[E503] Gemini 서비스 일시 불가 — 잠시 후 다시 시도해주세요.`
  };
  const err = new Error(codeMap[response.status] || `[E${response.status}] Gemini API 오류 — ${detail}`);
  err.status = response.status;
  err.apiDetail = detail;
  return err;
}

async function fetchModelCatalogFromApi(apiKey) {
  const allModels = [];
  let pageToken = "";
  let pageCount = 0;

  do {
    const url = new URL(`${GEMINI_API_ROOT}/models`);
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { "x-goog-api-key": apiKey }
    });

    if (!response.ok) throw await parseGeminiError(response);

    const data = await response.json();
    if (Array.isArray(data?.models)) allModels.push(...data.models);
    pageToken = data?.nextPageToken || "";
    pageCount += 1;
  } while (pageToken && pageCount < 10);

  const catalog = allModels
    .filter((model) => supportsGenerateContent(model))
    .map(normalizeModelRecord)
    .filter((model) => model.id && (model.id.startsWith("gemini-") || model.id.startsWith("gemma-")))
    .sort(compareModels);

  if (!catalog.length) {
    throw new Error("[EMODELS] generateContent를 지원하는 Gemini/Gemma 모델을 찾지 못했습니다.");
  }

  return catalog;
}

async function getModelCatalog(apiKey, { forceRefresh = false } = {}) {
  const cached = await chrome.storage.local.get([MODEL_CACHE_KEY, MODEL_CACHE_TIME_KEY]);
  const cachedModels = Array.isArray(cached[MODEL_CACHE_KEY]) ? cached[MODEL_CACHE_KEY] : [];
  const updatedAt = Number(cached[MODEL_CACHE_TIME_KEY] || 0);
  const cacheFresh = cachedModels.length > 0 && (Date.now() - updatedAt) < MODEL_CACHE_TTL_MS;

  if (!forceRefresh && cacheFresh) {
    return { models: cachedModels, updatedAt, source: "cache", stale: false };
  }

  try {
    const models = await fetchModelCatalogFromApi(apiKey);
    const now = Date.now();
    await chrome.storage.local.set({
      [MODEL_CACHE_KEY]: models,
      [MODEL_CACHE_TIME_KEY]: now
    });
    return { models, updatedAt: now, source: "api", stale: false };
  } catch (err) {
    // 인증/권한 오류에서는 이전 키의 캐시를 보여주지 않음.
    if (cachedModels.length && ![401, 403].includes(err.status)) {
      return { models: cachedModels, updatedAt, source: "cache", stale: true, warning: err.message };
    }
    throw err;
  }
}

function pickAutoModel(models) {
  const generalGemini = (models || []).filter((m) => m.family === "gemini" && !m.specialized);
  if (!generalGemini.length) return "gemini-flash-latest";

  // Google이 공식적으로 hot-swap하는 latest 별칭을 최우선 사용.
  const latestFlash = generalGemini.find((m) => m.id === "gemini-flash-latest");
  if (latestFlash) return latestFlash.id;

  const regularFlash = generalGemini
    .filter((m) => /flash/i.test(m.id) && !/flash-lite/i.test(m.id))
    .sort(compareModels);
  const stableFlash = regularFlash.find((m) => !m.preview);
  if (stableFlash) return stableFlash.id;
  if (regularFlash[0]) return regularFlash[0].id;

  const stableGeneral = [...generalGemini].sort(compareModels).find((m) => !m.preview);
  return (stableGeneral || [...generalGemini].sort(compareModels)[0])?.id || "gemini-flash-latest";
}

async function resolveRequestedModel(apiKey, requestedModel, { forceRefresh = false } = {}) {
  const requested = normalizeModelId(requestedModel);

  try {
    let catalogResult = await getModelCatalog(apiKey, { forceRefresh });
    let models = catalogResult.models;

    if (requested && requested !== AUTO_MODEL) {
      let exact = models.find((m) => m.id === requested);
      if (!exact && !forceRefresh) {
        catalogResult = await getModelCatalog(apiKey, { forceRefresh: true });
        models = catalogResult.models;
        exact = models.find((m) => m.id === requested);
      }
      if (exact) return { model: exact.id, catalogResult };

      await writeLog("INFO", `저장된 모델 '${requested}'가 현재 목록에 없어 자동 최신 Flash로 전환합니다.`);
      await chrome.storage.local.set({ onco_model: AUTO_MODEL });
    }

    return { model: pickAutoModel(models), catalogResult };
  } catch (err) {
    // 모델 목록 조회가 일시 실패해도 기존 선택 모델 또는 latest 별칭으로 생성 요청은 계속 시도.
    if (requested && requested !== AUTO_MODEL) {
      return { model: requested, catalogResult: null, warning: err.message };
    }
    return { model: "gemini-flash-latest", catalogResult: null, warning: err.message };
  }
}

// ──────────────────────────────────────────────
// OpenAI API / ChatGPT 공식 로그인 연결
// ──────────────────────────────────────────────
const OPENAI_API_ROOT = "https://api.openai.com/v1";
const CHATGPT_NATIVE_HOST = "org.onco.ai_solver";
const AUTO_OPENAI_MODEL = "__auto_openai_gpt__";
const AUTO_CHATGPT_MODEL = "__auto_chatgpt_gpt__";
const OPENAI_MODEL_CACHE = "onco_openai_model_catalog";
const OPENAI_MODEL_CACHE_TIME = "onco_openai_model_catalog_updated_at";

// 확장의 콘텐츠 스크립트(사이트 컨텍스트)에서는 API 키/연결 토큰 저장소 접근을 차단.
try {
  chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});
} catch (_) {}

function supportsOpenAIText(id) {
  if (!/^(?:gpt-\d|o[1-9](?:\d|[-.]|$))/i.test(id)) return false;
  // /models에는 Responses 텍스트 생성을 지원하지 않는 전용 제품도 섞여 있음.
  return !/(audio|realtime|tts|transcrib|image|embedding|moderation|search|deep-research|computer-use|codex|video|vision-preview)/i.test(id)
    && !/-pro(?:-|$)/i.test(id);
}

function compareOpenAIModels(a, b) {
  const idA = String(a.id || "");
  const idB = String(b.id || "");
  function ver(id) {
    const match = id.match(/^gpt-(\d+)(?:\.(\d+))?/i);
    return match ? [Number(match[1]), Number(match[2] || 0)] : [0, 0];
  }
  const va = ver(idA), vb = ver(idB);
  if (va[0] !== vb[0]) return vb[0] - va[0];
  if (va[1] !== vb[1]) return vb[1] - va[1];
  const rank = (id) => {
    if (/-\d{4}-\d{2}-\d{2}$/.test(id)) return -5;
    if (/preview|experimental|exp/i.test(id)) return -4;
    if (/nano/i.test(id)) return -3;
    if (/mini/i.test(id)) return -2;
    if (/astra|pro/i.test(id)) return -1;
    if (/^gpt-\d+(?:\.\d+)?$/i.test(id)) return 5;
    return 0;
  };
  return rank(idB) - rank(idA) || idB.localeCompare(idA);
}

function pickAutoOpenAIModel(models) {
  if (!models.length) return "";
  return [...models].sort(compareOpenAIModels)[0].id;
}

async function parseOpenAIError(response, provider = "OpenAI") {
  let json = null;
  try { json = await response.json(); } catch (_) {}
  const detail = String(json?.error?.message || json?.detail || json?.message || "").slice(0, 260);
  const reasons = {
    400: "요청 또는 모델 설정이 올바르지 않습니다.",
    401: "인증이 만료되었거나 API 키가 유효하지 않습니다.",
    403: "이 계정에 요청 권한이 없습니다.",
    404: "선택한 모델을 사용할 수 없습니다.",
    429: "요청/구독 한도에 도달했습니다.",
    500: "서버 내부 오류입니다.",
    503: "서버가 일시적으로 사용할 수 없습니다."
  };
  const err = new Error(`[E${response.status}] ${provider}: ${reasons[response.status] || "요청 실패"}${detail ? " — " + detail : ""}`);
  err.status = response.status;
  return err;
}

async function fetchOpenAIModels(apiKey) {
  const response = await fetch(`${OPENAI_API_ROOT}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    redirect: "error"
  });
  if (!response.ok) throw await parseOpenAIError(response);
  const json = await response.json();
  const models = (Array.isArray(json?.data) ? json.data : [])
    .filter(m => typeof m?.id === "string" && supportsOpenAIText(m.id))
    .map(m => ({ id: m.id, displayName: m.id, family: "openai", specialized: false,
      preview: /preview|exp/i.test(m.id), latestAlias: /latest$/i.test(m.id) }))
    .sort(compareOpenAIModels);
  if (!models.length) throw new Error("[EMODELS] 이 API 키에서 GPT 텍스트 모델을 찾지 못했습니다.");
  return models;
}

async function getOpenAIModels(apiKey, { forceRefresh = false } = {}) {
  const cached = await chrome.storage.local.get([OPENAI_MODEL_CACHE, OPENAI_MODEL_CACHE_TIME]);
  const old = Array.isArray(cached[OPENAI_MODEL_CACHE]) ? cached[OPENAI_MODEL_CACHE] : [];
  const stamp = Number(cached[OPENAI_MODEL_CACHE_TIME] || 0);
  if (!forceRefresh && old.length && Date.now() - stamp < MODEL_CACHE_TTL_MS) {
    return { models: old, updatedAt: stamp, stale: false };
  }
  try {
    const models = await fetchOpenAIModels(apiKey);
    const updatedAt = Date.now();
    await chrome.storage.local.set({ [OPENAI_MODEL_CACHE]: models, [OPENAI_MODEL_CACHE_TIME]: updatedAt });
    return { models, updatedAt, stale: false };
  } catch (err) {
    if (old.length && ![401, 403].includes(err?.status)) {
      return { models: old, updatedAt: stamp, stale: true, warning: err.message };
    }
    throw err;
  }
}

async function resolveOpenAIModel(apiKey, requested, { forceRefresh = false } = {}) {
  const result = await getOpenAIModels(apiKey, { forceRefresh });
  const models = result.models;
  const chosen = requested && requested !== AUTO_OPENAI_MODEL
    ? models.find(m => m.id === requested)?.id
    : "";
  return { model: chosen || pickAutoOpenAIModel(models), result };
}

function responseOutputText(json) {
  const outputs = Array.isArray(json?.output) ? json.output : [];
  return outputs.flatMap(item => Array.isArray(item?.content) ? item.content : [])
    .filter(part => part?.type === "output_text" && typeof part?.text === "string")
    .map(part => part.text).join("");
}

async function callOpenAI(apiKey, problemText, model, language) {
  const response = await fetch(`${OPENAI_API_ROOT}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    redirect: "error",
    body: JSON.stringify({ model, instructions: SYSTEM_PROMPT(language),
      input: `문제:\n${problemText}`, store: false, max_output_tokens: 8192 })
  });
  if (!response.ok) throw await parseOpenAIError(response);
  const json = await response.json();
  if (json?.status === "failed") throw new Error(`[EAPI] GPT 응답 실패 — ${json.error?.message || "원인 불명"}`);
  if (json?.status === "incomplete") throw new Error(`[EINCOMPLETE] GPT 응답이 완료되지 않았습니다. (${json.incomplete_details?.reason || "unknown"})`);
  const raw = responseOutputText(json);
  if (!raw.trim()) throw new Error("[EEMPTY] GPT가 빈 응답을 반환했습니다.");
  return extractCode(raw);
}

// Chrome's connectNative keeps the MV3 service worker and one Codex app-server
// process alive through an asynchronous device-code login or model generation.
let codexPort = null;
let codexRequestSequence = 0;
const codexRequests = new Map();
function codexNativePort() {
  if (codexPort) return codexPort;
  const port = chrome.runtime.connectNative(CHATGPT_NATIVE_HOST);
  codexPort = port;
  port.onMessage.addListener(message => {
    if (!message || message.kind === 'event') return;
    const waiter = codexRequests.get(message.id);
    if (!waiter) return;
    codexRequests.delete(message.id);
    clearTimeout(waiter.timer);
    if (message.success) waiter.resolve(message);
    else waiter.reject(new Error(message.error || '[EBRIDGE] Codex 작업이 실패했습니다.'));
  });
  port.onDisconnect.addListener(() => {
    const details = chrome.runtime.lastError?.message || '인증 도우미 프로세스가 종료되었습니다.';
    if (codexPort === port) codexPort = null;
    for (const waiter of codexRequests.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('[EBRIDGE] OnCo Codex 연결 종료: ' + details));
    }
    codexRequests.clear();
  });
  return port;
}
async function callChatGPTNative(action, data = null) {
  const port = codexNativePort();
  const id = ++codexRequestSequence;
  return new Promise((resolve, reject) => {
    const timeout = action === 'solve' ? 310000 : 75000;
    const timer = setTimeout(() => {
      codexRequests.delete(id);
      reject(new Error('[EBRIDGE] Codex ' + action + ' 요청 시간이 초과됐습니다.'));
    }, timeout);
    codexRequests.set(id, {resolve, reject, timer});
    try { port.postMessage({id,action,data}); }
    catch (e) {
      codexRequests.delete(id);
      clearTimeout(timer);
      reject(new Error('[EBRIDGE] 인증 도우미 전송 실패: ' + e.message));
    }
  });
}
async function getChatGPTStatus() {
  const result = await callChatGPTNative('status');
  return { available: Boolean(result.available), connected: Boolean(result.connected), sharing: Boolean(result.sharing),
    identityStatus: result.identityStatus || (result.connected ? 'signed_in' : 'signed_out'),
    planStatus: result.planStatus || (result.sharing ? 'scope_granted' : 'not_authorized'),
    lastAuthError: result.lastAuthError || null, login: result.login || null, planType: result.planType || '', error: result.error || '' };
}

async function getChatGPTModels() {
  const status = await getChatGPTStatus();
  if (!status.connected) throw new Error('[ENOLOGIN] Sign in with ChatGPT first.');
  if (!status.sharing) throw new Error('[EPLAN] Codex 모델 사용 권한이 없습니다. 작업공간 정책을 확인하거나 API 키 공급자를 선택해주세요.');
  const result = await callChatGPTNative('models');
  return { models: (result.models || []).map(m => ({ ...m, family: 'chatgpt', specialized: false })),
    updatedAt: Date.now(), stale: false };
}

async function callChatGPTModel(problemText, model, language) {
  const result = await callChatGPTNative('solve',
    { model, instructions: SYSTEM_PROMPT(language), input: `문제:\n${problemText}` });
  const code = extractCode(result?.text || '');
  if (!code) throw new Error('[EEMPTY] ChatGPT 계정 응답이 비어 있습니다.');
  return code;
}

const SYSTEM_PROMPT = (lang) => `
당신은 온라인 코딩 테스트 문제를 해결하는 알고리즘 전문가입니다.
아래 문제를 정확히 분석하여 ${lang} 정답 코드만 작성하세요.

[목표]
- 모든 공개/숨은 테스트 케이스를 통과하는 완전한 프로그램을 작성합니다.
- 문제 설명, 입력 형식, 출력 형식, 제한 조건, 예제를 종합해 알고리즘을 선택합니다.
- 시간 제한과 메모리 제한을 고려해 가능한 한 효율적인 풀이를 구현합니다.

[풀이 원칙]
- 먼저 핵심 조건과 경계값을 내부적으로 검토한 뒤 코드를 작성합니다.
- 예제가 있으면 입출력 동작을 반드시 만족하도록 구현합니다.
- 입력 크기가 클 수 있으므로 불필요한 완전탐색을 피하고, 적절한 자료구조/DP/그래프/정렬/그리디/이분탐색 등을 선택합니다.
- 0/1 인덱스, 중복 값, 빈 입력, 최소/최대 크기, 음수, 큰 정수, 오버플로 가능성을 주의합니다.
- 문제에서 요구하지 않은 프롬프트 출력, 디버그 출력, 임의 안내 문구를 절대 넣지 않습니다.

[코드 작성 규칙]
- 출력은 오직 ${lang} 소스 코드만 포함합니다.
- 마크다운 코드블록, 설명, 주석형 풀이 해설, 사과문, 추가 문장을 절대 포함하지 않습니다.
- 표준 입력(stdin)에서 읽고 표준 출력(stdout)으로 출력하는 단일 실행 프로그램으로 작성합니다.
- 외부 라이브러리, 파일 입출력, 네트워크, 비표준 패키지는 사용하지 않습니다.
- 코드에는 미완성 TODO, placeholder, 의사코드가 없어야 합니다.
- 필요한 경우 함수로 구조화하되, 제출 즉시 실행 가능한 형태여야 합니다.

이제 문제를 풀고, 최종 제출 코드만 반환하세요.
`.trim();

// ──────────────────────────────────────────────
// Gemini API 호출
// ──────────────────────────────────────────────
async function callGemini(apiKey, problemText, model, lang = "Python 3") {
  const modelId = normalizeModelId(model);
  const url = `${GEMINI_API_ROOT}/models/${encodeURIComponent(modelId)}:generateContent`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: SYSTEM_PROMPT(lang) + "\n\n문제:\n" + problemText
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8192
    }
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) throw await parseGeminiError(response, { model: modelId });

  const json = await response.json();

  if (json?.error) {
    const msg = json.error.message || JSON.stringify(json.error);
    throw new Error(`[EAPI] Gemini 응답 오류 — ${msg}`);
  }

  const finishReason = json?.candidates?.[0]?.finishReason;
  if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
    throw new Error(`[EBLOCK] 응답이 차단되었습니다 (reason: ${finishReason})`);
  }

  const parts = json?.candidates?.[0]?.content?.parts || [];
  const raw = parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("");

  if (!raw.trim()) {
    const blockReason = json?.promptFeedback?.blockReason;
    if (blockReason) throw new Error(`[EBLOCK] Gemini가 요청을 차단했습니다 (reason: ${blockReason})`);
    throw new Error("[EEMPTY] Gemini가 빈 응답을 반환했습니다.");
  }

  return extractCode(raw);
}

// 마크다운 코드블록에서 코드 추출
function extractCode(raw) {
  const matches = [...raw.matchAll(/```(?:\w+)?\n([\s\S]*?)\n```/g)];
  if (matches.length === 0) {
    return raw.trim();
  }
  const longest = matches.reduce((best, m) =>
    m[1].length > best[1].length ? m : best
  );
  return longest[1].trim();
}


// ──────────────────────────────────────────────
// 공통 풀이 실행 함수
// ──────────────────────────────────────────────
async function solveProblem(tabId) {
  await writeLog("INFO", "=== 풀이 시작 ===");
  const settings = await chrome.storage.local.get([
    "onco_provider", "onco_api_key", "onco_model", "onco_openai_api_key",
    "onco_openai_model", "onco_chatgpt_model"
  ]);
  const provider = ["gemini", "openai", "chatgpt"].includes(settings.onco_provider)
    ? settings.onco_provider : "gemini";
  const apiKey = provider === "gemini" ? settings.onco_api_key
    : provider === "openai" ? settings.onco_openai_api_key : "";
  if (provider !== "chatgpt" && !apiKey) {
    throw new Error("[ENOKEY] 선택한 서비스의 API 키가 없습니다. 팝업에서 저장해주세요.");
  }

  const requested = provider === "gemini" ? (settings.onco_model || AUTO_MODEL)
    : provider === "openai" ? (settings.onco_openai_model || AUTO_OPENAI_MODEL)
    : (settings.onco_chatgpt_model || AUTO_CHATGPT_MODEL);
  let model = "";
  let warning = "";
  if (provider === "gemini") {
    const resolved = await resolveRequestedModel(apiKey, requested);
    model = resolved.model;
    warning = resolved.warning || "";
  } else if (provider === "openai") {
    const resolved = await resolveOpenAIModel(apiKey, requested);
    model = resolved.model;
    warning = resolved.result.warning || "";
  } else {
    const status = await getChatGPTStatus();
    if (!status.connected || !status.sharing) {
      throw new Error("[ENOLOGIN] ChatGPT 로그인과 플랜 사용 권한 동의가 필요합니다.");
    }
    const result = await getChatGPTModels();
    model = result.models.find(m => m.id === requested)?.id
      || result.models[0]?.id;
  }
  if (!model) throw new Error("[EMODELS] 선택한 서비스에서 사용할 수 있는 GPT/Gemini 모델이 없습니다.");
  await writeLog("INFO", `서비스: ${provider}, 모델: ${model}${requested.startsWith("__auto") ? " (자동)" : ""}`);
  if (warning) await writeLog("INFO", `모델 목록 조회 경고: ${warning}`);

  const scrapeResult = await chrome.tabs.sendMessage(tabId, { action: "SCRAPE_PROBLEM" });
  if (!scrapeResult?.success) throw new Error("[ESCRAPE] " + (scrapeResult?.error || "문제 스크래핑 실패"));
  const { title, description, language = "Python 3", testCases = "" } = scrapeResult.data;
  if (!description) throw new Error("[ENODATA] 문제 설명을 찾을 수 없습니다.");
  await writeLog("INFO", `스크래핑 성공: "${title || '(제목 없음)'}" / 설명 ${description.length}자`);

  let problemText = title ? `제목: ${title}\n\n설명:\n${description}` : description;
  if (testCases && testCases.trim()) problemText += `\n\n--- 참조용 입출력 예제 ---\n${testCases}`;

  async function generate(selected) {
    if (provider === "gemini") return callGemini(apiKey, problemText, selected, language);
    if (provider === "openai") return callOpenAI(apiKey, problemText, selected, language);
    return callChatGPTModel(problemText, selected, language);
  }

  let code;
  try {
    code = await generate(model);
  } catch (err) {
    if (err?.status !== 404) {
      if (!err.message?.startsWith("[")) throw new Error("[ENET] 요청 실패 — " + err.message);
      throw err;
    }

    // 모델 지원 종료: 같은 서비스의 목록만 강제 재조회, 자동 선택으로 1회 재시도.
    let alternative = "";
    if (provider === "gemini") {
      alternative = (await resolveRequestedModel(apiKey, AUTO_MODEL, { forceRefresh: true })).model;
      if (alternative !== model) await chrome.storage.local.set({ onco_model: AUTO_MODEL });
    } else if (provider === "openai") {
      alternative = (await resolveOpenAIModel(apiKey, AUTO_OPENAI_MODEL, { forceRefresh: true })).model;
      if (alternative !== model) await chrome.storage.local.set({ onco_openai_model: AUTO_OPENAI_MODEL });
    } else {
      alternative = (await getChatGPTModels()).models[0]?.id || "";
      if (alternative !== model) await chrome.storage.local.set({ onco_chatgpt_model: AUTO_CHATGPT_MODEL });
    }
    if (!alternative || alternative === model) throw err;
    await writeLog("INFO", `지원 종료 모델 '${model}' → '${alternative}' 1회 재시도`);
    model = alternative;
    code = await generate(model);
  }
  await writeLog("SUCCESS", `${provider} 응답 수신 (${code.split("\n").length}줄)`);

  const results = await chrome.scripting.executeScript({
    target: { tabId }, world: "MAIN", func: injectIntoMonaco, args: [code]
  });
  if (!results?.[0]?.result?.success) {
    throw new Error(results?.[0]?.result?.error || "[EINJECT] 코드 주입에 실패했습니다.");
  }
  await writeLog("SUCCESS", "코드 주입 완료");
}

async function forcePaste(tabId) {
  await writeLog("INFO", `강제 붙여넣기 실행 (tabId: ${tabId})`);

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (!text) return { success: false, error: "[ECLIP] 클립보드가 비어있습니다." };
        return { success: true, text };
      } catch (err) {
        return {
          success: false,
          error: "[ECLIP] 클립보드 권한이 필요합니다. 화면을 한 번 클릭한 뒤 다시 시도해주세요."
        };
      }
    }
  });

  const clipResult = results?.[0]?.result;
  if (!clipResult?.success) {
    throw new Error(clipResult?.error || "[ECLIP] 클립보드 텍스트를 읽을 수 없습니다.");
  }

  const injectResults = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: injectIntoMonaco,
    args: [clipResult.text]
  });
  const injectResult = injectResults?.[0]?.result;
  if (!injectResult?.success) {
    throw new Error(injectResult?.error || "[EINJECT] 클립보드 코드 주입에 실패했습니다.");
  }

  await writeLog("SUCCESS", `강제 붙여넣기 완료 (${clipResult.text.split("\n").length}줄)`);
}

async function injectClipboardText(tabId, text) {
  if (typeof text !== "string" || !text) {
    throw new Error("[ECLIP] 클립보드가 비어있습니다.");
  }

  await writeLog("INFO", `버튼 강제 붙여넣기 실행 (tabId: ${tabId})`);
  const injectResults = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: injectIntoMonaco,
    args: [text]
  });
  const injectResult = injectResults?.[0]?.result;
  if (!injectResult?.success) {
    throw new Error(injectResult?.error || "[EINJECT] 클립보드 코드 주입에 실패했습니다.");
  }
  await writeLog("SUCCESS", `버튼 강제 붙여넣기 완료 (${text.split("\n").length}줄)`);
}

// ──────────────────────────────────────────────
// 단축키 핸들러
// ──────────────────────────────────────────────
chrome.commands.onCommand.addListener((command) => {
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tab = tabs[0];
    if (!tab?.id) return;

    if (command === "solve-problem") {
      await writeLog("INFO", `단축키 실행 (tabId: ${tab.id})`);

      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: showToast,
        args: ["⚡ AI 풀이 중...", "info"]
      });

      try {
        await solveProblem(tab.id);
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: showToast,
          args: ["✅ 코드 주입 완료!", "success"]
        });
      } catch (err) {
        await writeLog("ERROR", err.message);
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: showToast,
          args: ["❌ 풀이 실패", "error"]
        });
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: showErrorModal,
          args: [err.message]
        });
      }

    } else if (command === "force-paste") {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: showToast,
        args: ["📋 클립보드 주입 중...", "info"]
      });
      try {
        await forcePaste(tab.id);
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: showToast,
          args: ["📋 클립보드 강제 붙여넣기 완료!", "success"]
        });
      } catch (err) {
        await writeLog("ERROR", `강제 붙여넣기 실패: ${err.message}`);
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: showToast,
          args: ["❌ 붙여넣기 실패", "error"]
        });
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: showErrorModal,
          args: [`[EPASTE] 강제 붙여넣기 실패 — ${err.message}`]
        });
      }
    }
  });
});

// ──────────────────────────────────────────────
// 메시지 핸들러 (팝업 버튼 & Content Script 통신)
// ──────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 외부 페이지 콘텐츠 스크립트가 API 키나 로그인 도우미 제어 메시지를 보내지 못하게 방지.
  const privilegedActions = new Set(["GET_MODELS", "GET_CHATGPT_STATUS", "START_CHATGPT_SIGNIN", "START_CHATGPT_BROWSER_SIGNIN", "CANCEL_CHATGPT_SIGNIN", "LOGOUT_CHATGPT"]);
  if (sender.tab && privilegedActions.has(message?.action)) {
    sendResponse({ success: false, error: "팝업에서만 실행 가능한 작업입니다." });
    return false;
  }

  if (message.action === "GET_MODELS") {
    (async () => {
      const provider = ["gemini", "openai", "chatgpt"].includes(message.provider)
        ? message.provider : "gemini";
      let result, autoModel;
      if (provider === "gemini") {
        const { onco_api_key: key } = await chrome.storage.local.get("onco_api_key");
        if (!key) throw new Error("[ENOKEY] Gemini API 키를 먼저 저장해주세요.");
        result = await getModelCatalog(key, { forceRefresh: Boolean(message.forceRefresh) });
        autoModel = pickAutoModel(result.models);
      } else if (provider === "openai") {
        const { onco_openai_api_key: key } = await chrome.storage.local.get("onco_openai_api_key");
        if (!key) throw new Error("[ENOKEY] OpenAI API 키를 먼저 저장해주세요.");
        result = await getOpenAIModels(key, { forceRefresh: Boolean(message.forceRefresh) });
        autoModel = pickAutoOpenAIModel(result.models);
      } else {
        result = await getChatGPTModels();
        autoModel = result.models.find(m=>m.isDefault)?.id || result.models[0]?.id || ""; // Codex 계정에서 제공한 모델 목록
      }
      sendResponse({ success: true, provider, models: result.models,
        updatedAt: result.updatedAt, stale: result.stale,
        warning: result.warning || "", autoModel });
    })().catch(err => sendResponse({ success: false, error: err.message || String(err) }));
    return true;
  }

  if (message.action === "GET_CHATGPT_STATUS") {
    getChatGPTStatus().then(status => sendResponse({ success: true, ...status }))
      .catch(err => sendResponse({ success: false, available: false, error: err.message }));
    return true;
  }

  if (message.action === "START_CHATGPT_SIGNIN") {
    callChatGPTNative('signin').then(result => sendResponse({ success: true, ...result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (message.action === "START_CHATGPT_BROWSER_SIGNIN") {
    callChatGPTNative('signin-browser').then(result => sendResponse({ success: true, ...result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (message.action === "CANCEL_CHATGPT_SIGNIN") {
    callChatGPTNative('cancel-login').then(result => sendResponse({ success: true, ...result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (message.action === "LOGOUT_CHATGPT") {
    callChatGPTNative('logout').then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "GET_LOGS") {
    chrome.storage.local.get("onco_logs", ({ onco_logs = [] }) => {
      sendResponse({ logs: onco_logs });
    });
    return true;
  }
  if (message.action === "CLEAR_LOGS") {
    chrome.storage.local.set({ onco_logs: [] }, () => sendResponse({ ok: true }));
    return true;
  }
  
  // ✨ [수정된 로직] Content Script의 CSP 우회를 위한 에디터 코드 추출 API ✨
  // - 에디터가 비어있어도(빈 문자열) 정상적으로 복사되도록 수정
  // - 실제 입력 가능한(readOnly가 아닌) 에디터를 정확히 타겟팅하도록 수정
  if (message.action === "GET_MONACO_CODE") {
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: "MAIN",
      func: () => {
        if (typeof window.monaco === "undefined") return null;

        // 1. 주입 로직과 동일하게 읽기 전용(readOnly)이 아닌 실제 코드 에디터를 찾음
        var editors = window.monaco.editor.getEditors();
        for (var i = 0; i < editors.length; i++) {
          var e = editors[i];
          if (e && !e.getOption(window.monaco.editor.EditorOption.readOnly)) {
            var model = e.getModel();
            if (model) return model.getValue();
          }
        }
        
        // 2. 만약 못 찾았다면 폴백으로 첫 번째 모델 반환
        if (window.monaco.editor.getModels().length > 0) {
          return window.monaco.editor.getModels()[0].getValue();
        }
        return null;
      }
    }).then((results) => {
      // 3. 결과값이 빈 문자열("")일 수도 있으므로 typeof string 확인으로 조건문 변경
      if (results && results[0] && typeof results[0].result === "string") {
        sendResponse({ success: true, code: results[0].result });
      } else {
        sendResponse({ success: false, error: "에디터가 비어있거나 초기화되지 않았습니다." });
      }
    }).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    return true; // 비동기 응답 처리 허용
  }

  if (message.action === "SOLVE_PROBLEM") {
    const tabId = message.tabId || sender.tab?.id;
    solveProblem(tabId)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "FORCE_PASTE") {
    const tabId = message.tabId || sender.tab?.id;
    forcePaste(tabId)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "INJECT_CLIPBOARD_TEXT") {
    const tabId = message.tabId || sender.tab?.id;
    injectClipboardText(tabId, message.text)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  return false;
});

// ──────────────────────────────────────────────
// MAIN world 주입용 함수 모음
// ──────────────────────────────────────────────
function injectIntoMonaco(code) {
  var MAX_TRIES = 30;
  var INTERVAL = 500;
  var tries = 0;

  function normalizeCode(raw) {
    return raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }

  return new Promise(function (resolve) {
    function fail(message) {
      console.error("[OnCo Solver] " + message);
      resolve({ success: false, error: message });
    }

    function attempt() {
      tries++;

      if (typeof window.monaco === "undefined") {
        if (tries < MAX_TRIES) {
          setTimeout(attempt, INTERVAL);
        } else {
          fail("[EMONACO] Monaco 에디터를 찾을 수 없습니다. (타임아웃)");
        }
        return;
      }

      var editors = window.monaco.editor.getEditors();
      var editor = null;
      for (var i = 0; i < editors.length; i++) {
        var e = editors[i];
        if (e && !e.getOption(window.monaco.editor.EditorOption.readOnly)) {
          editor = e;
          break;
        }
      }

      if (!editor) {
        fail("[EEDITOR] 사용 가능한 Monaco 에디터를 찾을 수 없습니다.");
        return;
      }

      var model = editor.getModel();
      if (!model) {
        if (tries < MAX_TRIES) {
          setTimeout(attempt, INTERVAL);
        } else {
          fail("[EMODEL] Monaco 모델이 초기화되지 않았습니다.");
        }
        return;
      }

      try {
        var normalized = normalizeCode(code);
        var eol = model.getEOL();
        if (eol === "\r\n") {
          normalized = normalized.replace(/\n/g, "\r\n");
        }

        var fullRange = model.getFullModelRange();

        editor.pushUndoStop();

        editor.executeEdits("onco-solver", [{
          range: fullRange,
          text: normalized,
          forceMoveMarkers: true
        }]);

        editor.pushUndoStop();

        editor.focus();
        editor.setPosition({ lineNumber: 1, column: 1 });

        console.log("[OnCo Solver] 코드 주입 완료! (" + normalized.split("\n").length + "줄)");
        resolve({ success: true });
      } catch (err) {
        fail("[EINJECT] 코드 주입 중 오류가 발생했습니다. " + err.message);
      }
    }

    attempt();
  });
}

function showErrorModal(message) {
  var MODAL_ID = "onco-solver-error-modal";
  var existing = document.getElementById(MODAL_ID);
  if (existing) existing.remove();

  var overlay = document.createElement("div");
  overlay.id = MODAL_ID;
  Object.assign(overlay.style, {
    position: "fixed", inset: "0", background: "rgba(0,0,0,0.75)", zIndex: "2147483647",
    display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI', sans-serif"
  });

  var modal = document.createElement("div");
  Object.assign(modal.style, {
    background: "#1a1d27", border: "1px solid #f07080", borderRadius: "10px", padding: "20px",
    width: "360px", maxWidth: "90vw", display: "flex", flexDirection: "column", gap: "12px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.6)"
  });

  var title = document.createElement("div");
  title.textContent = "⚠️ OnCo AI Solver 오류";
  Object.assign(title.style, { fontSize: "14px", fontWeight: "700", color: "#f07080" });

  var pre = document.createElement("pre");
  pre.textContent = message;
  Object.assign(pre.style, {
    margin: "0", fontSize: "12px", color: "#e0e0e0", background: "#0f1117", border: "1px solid #2a2d3a",
    borderRadius: "6px", padding: "10px", whiteSpace: "pre-wrap", wordBreak: "break-all",
    userSelect: "text", webkitUserSelect: "text", maxHeight: "160px", overflowY: "auto", cursor: "text"
  });

  var row = document.createElement("div");
  Object.assign(row.style, { display: "flex", gap: "8px" });

  var btnCopy = document.createElement("button");
  btnCopy.textContent = "📋 복사";
  Object.assign(btnCopy.style, {
    flex: "1", padding: "8px 0", border: "none", borderRadius: "6px", background: "#2a3a5a",
    color: "#7eb8f7", fontSize: "13px", fontWeight: "600", cursor: "pointer"
  });
  btnCopy.addEventListener("click", function () {
    navigator.clipboard.writeText(message).then(function () {
      btnCopy.textContent = "✅ 복사됨!";
      btnCopy.style.background = "#1a3a2a"; btnCopy.style.color = "#60c090";
      setTimeout(function () {
        btnCopy.textContent = "📋 복사";
        btnCopy.style.background = "#2a3a5a"; btnCopy.style.color = "#7eb8f7";
      }, 2000);
    });
  });

  var btnClose = document.createElement("button");
  btnClose.textContent = "닫기";
  Object.assign(btnClose.style, {
    flex: "1", padding: "8px 0", border: "none", borderRadius: "6px", background: "#3a1a1a",
    color: "#f07080", fontSize: "13px", fontWeight: "600", cursor: "pointer"
  });
  btnClose.addEventListener("click", function () { overlay.remove(); });
  overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.remove(); });
  document.addEventListener("keydown", function onKey(e) {
    if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", onKey); }
  });

  row.appendChild(btnCopy);
  row.appendChild(btnClose);
  modal.appendChild(title);
  modal.appendChild(pre);
  modal.appendChild(row);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

// 페이지에 토스트 알림 표시 (MAIN world에서 실행됨)
function showToast(message, type) {
  var existing = document.getElementById("onco-solver-toast");
  if (existing) existing.remove();

  var colors = {
    info:    { bg: "#1a3a5c", border: "#4a90d9", text: "#7eb8f7" },
    success: { bg: "#1a3a2a", border: "#40a060", text: "#60c090" },
    error:   { bg: "#3a1a1a", border: "#c04040", text: "#f07080" }
  };
  var c = colors[type] || colors.info;

  var toast = document.createElement("div");
  toast.id = "onco-solver-toast";
  Object.assign(toast.style, {
    position: "fixed",
    top: "20px",
    right: "20px",
    zIndex: "2147483647",
    padding: "12px 18px",
    borderRadius: "8px",
    border: "1px solid " + c.border,
    background: c.bg,
    color: c.text,
    fontSize: "14px",
    fontWeight: "600",
    fontFamily: "'Segoe UI', sans-serif",
    boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
    transition: "opacity 0.4s",
    opacity: "1",
    pointerEvents: "none",
    display: "flex",
    alignItems: "center",
    gap: "10px"
  });

  // info(로딩) 타입일 때만 스피너 추가
  if (type === "info") {
    var styleId = "onco-solver-spin-style";
    if (!document.getElementById(styleId)) {
      var style = document.createElement("style");
      style.id = styleId;
      style.textContent =
        "@keyframes onco-spin{to{transform:rotate(360deg)}}" +
        ".onco-spinner{display:inline-block;width:14px;height:14px;" +
        "border:2px solid rgba(126,184,247,0.3);border-top-color:#7eb8f7;" +
        "border-radius:50%;animation:onco-spin 0.7s linear infinite;flex-shrink:0}";
      document.head.appendChild(style);
    }
    var spinner = document.createElement("span");
    spinner.className = "onco-spinner";
    toast.appendChild(spinner);
  }

  var text = document.createElement("span");
  text.textContent = message;
  toast.appendChild(text);

  document.body.appendChild(toast);

  // info 타입(로딩)은 자동으로 닫히지 않음 — 완료/오류 토스트가 대체
  if (type !== "info") {
    setTimeout(function () {
      toast.style.opacity = "0";
      setTimeout(function () { toast.remove(); }, 400);
    }, 3000);
  }
}

