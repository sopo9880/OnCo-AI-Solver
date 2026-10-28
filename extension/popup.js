(() => {
  "use strict";


  const apiKeyInput = document.getElementById("api-key");
  const btnSave = document.getElementById("btn-save");
  const btnSolve = document.getElementById("btn-solve");
  const btnForcePaste = document.getElementById("btn-force-paste");
  const btnModelRefresh = document.getElementById("btn-model-refresh");
  const statusEl = document.getElementById("status");
  const modelSelect = document.getElementById("model-select");
  const modelInfo = document.getElementById("model-info");
  const modalOverlay = document.getElementById("error-modal-overlay");
  const modalText = document.getElementById("error-modal-text");
  const btnModalCopy = document.getElementById("btn-modal-copy");
  const btnModalClose = document.getElementById("btn-modal-close");
  const logBox = document.getElementById("log-box");
  const logSection = document.getElementById("log-section");
  const btnLogDownload = document.getElementById("btn-log-download");
  const btnLogClear = document.getElementById("btn-log-clear");
  const testModeSelect = document.getElementById("test-feedback-mode");
  const testRetriesSelect = document.getElementById("test-feedback-retries");
  const testFeedbackStatus = document.getElementById("test-feedback-status");
  const submissionModeSelect = document.getElementById("submission-feedback-mode");
  const submissionHistoryToggle = document.getElementById("submission-feedback-history");
  const submissionPrecheckToggle = document.getElementById("submission-feedback-precheck");
  const submissionFeedbackStatus = document.getElementById("submission-feedback-status");


  function renderLogs(logs) {
    logBox.replaceChildren();
    if (!logs || logs.length === 0) {
      const empty = document.createElement("span");
      empty.style.color = "#454d60";
      empty.textContent = "로그가 없습니다.";
      logBox.appendChild(empty);
      return;
    }
    for (const entry of logs) {
      const line = document.createElement("div");
      line.className = `log-entry ${["INFO", "SUCCESS", "ERROR"].includes(entry.level) ? entry.level : "INFO"}`;
      const time = document.createElement("span");
      time.className = "ts";
      time.textContent = `[${String(entry.ts || "").replace("T", " ").slice(0, 19)}] `;
      const level = document.createElement("span");
      level.className = "lv";
      level.textContent = `${entry.level} `;
      const message = document.createElement("span");
      message.textContent = entry.msg;
      line.append(time, level, message);
      logBox.appendChild(line);
    }
    logBox.scrollTop = logBox.scrollHeight;
  }

  function loadLogs() {
    chrome.runtime.sendMessage({ action: "GET_LOGS" }, (res) => {
      renderLogs(res?.logs || []);
    });
  }

  logSection.addEventListener("toggle", () => {
    if (logSection.open) loadLogs();
  });

  btnLogDownload.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "GET_LOGS" }, (res) => {
      const logs = res?.logs || [];
      const text = logs.map(e =>
        `[${e.ts.replace('T',' ').slice(0,19)}] [${e.level}] ${e.msg}`
      ).join("\n");
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `onco-solver-${new Date().toISOString().slice(0,10)}.log`;
      a.click();
      URL.revokeObjectURL(url);
    });
  });

  btnLogClear.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "CLEAR_LOGS" }, () => {
      renderLogs([]);
    });
  });

  function showErrorModal(msg) {
    modalText.textContent = msg;
    modalOverlay.classList.add("show");
    btnModalCopy.textContent = "클립보드 복사";
    btnModalCopy.classList.remove("copied");
  }

  btnModalClose.addEventListener("click", () => {
    modalOverlay.classList.remove("show");
  });

  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) modalOverlay.classList.remove("show");
  });

  btnModalCopy.addEventListener("click", () => {
    navigator.clipboard.writeText(modalText.textContent).then(() => {
      btnModalCopy.textContent = "✅ 복사됨!";
      btnModalCopy.classList.add("copied");
      setTimeout(() => {
        btnModalCopy.textContent = "클립보드 복사";
        btnModalCopy.classList.remove("copied");
      }, 2000);
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") modalOverlay.classList.remove("show");
  });

  function setStatus(msg, type = "") {
    statusEl.textContent = msg;
    statusEl.className = type;
  }

  function setBusy(button, isBusy, busyText, idleText) {
    button.disabled = isBusy;
    button.innerHTML = isBusy ? `<span class="spinner"></span>${busyText}` : idleText;
  }

  function getActiveOncoTab(callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.url || !tab.url.includes("on-co.net")) {
        setStatus("OnCo 문제 페이지에서 실행해주세요.", "error");
        callback(null);
        return;
      }
      callback(tab);
    });
  }

  function createOption(value, label, selected = false) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = selected;
    return option;
  }

  const providerSelect = document.getElementById("provider-select");
  const apiKeySection = document.getElementById("api-key-section");
  const apiKeyLabel = document.getElementById("api-key-label");
  const apiKeyHint = document.getElementById("api-key-hint");
  const btnRemoveKey = document.getElementById("btn-remove-key");
  const chatgptSection = document.getElementById("chatgpt-section");
  const chatgptStatus = document.getElementById("chatgpt-status");
  const btnSignin = document.getElementById("btn-signin");
  const btnBrowserSignin = document.getElementById("btn-browser-signin");
  const btnCancelLogin = document.getElementById("btn-cancel-login");
  const codexLoginCode = document.getElementById("codex-login-code");
  const codexUserCode = document.getElementById("codex-user-code");
  const btnCopyLoginCode = document.getElementById("btn-copy-login-code");
  const btnOpenLoginPage = document.getElementById("btn-open-login-page");
  const identityStatus = document.getElementById("chatgpt-identity-status");
  const planStatus = document.getElementById("chatgpt-plan-status");
  const authError = document.getElementById("chatgpt-auth-error");
  const btnSignout = document.getElementById("btn-signout");
  const btnUsage = document.getElementById("btn-usage");
  const btnOpenHelperGuide = document.getElementById("btn-open-helper-guide");

  const AUTO_VALUES = {
    gemini: "__auto_gemini_flash__",
    openai: "__auto_openai_gpt__",
    chatgpt: "__auto_chatgpt_gpt__"
  };
  const MODEL_KEYS = {
    gemini: "onco_model", openai: "onco_openai_model", chatgpt: "onco_chatgpt_model"
  };
  const API_KEY_NAMES = {
    gemini: "onco_api_key", openai: "onco_openai_api_key"
  };

  const TEST_MODES = ["off", "assist", "replace", "auto"];
  chrome.storage.local.get(["onco_test_mode", "onco_test_max_retries"], (data) => {
    testModeSelect.value = TEST_MODES.includes(data.onco_test_mode) ? data.onco_test_mode : "assist";
    const count = Number.isInteger(data.onco_test_max_retries)
      ? Math.max(1, Math.min(5, data.onco_test_max_retries)) : 3;
    testRetriesSelect.value = String(count);
    testRetriesSelect.disabled = testModeSelect.value !== "auto";
  });
  testModeSelect.addEventListener("change", () => {
    const mode = TEST_MODES.includes(testModeSelect.value) ? testModeSelect.value : "assist";
    testRetriesSelect.disabled = mode !== "auto";
    chrome.storage.local.set({onco_test_mode: mode}, () => {
      testFeedbackStatus.textContent = mode === "auto"
        ? "자동 재테스트가 활성화됐습니다. 테스트 버튼 클릭 후 실패 시 수정합니다."
        : mode === "replace" ? "테스트 실패 시 코드를 교체합니다. 재테스트는 수동입니다."
        : mode === "assist" ? "테스트 실패 시 수정안을 표시하고 사용자 승인을 기다립니다."
        : "테스트 AI 연동을 사용하지 않습니다.";
    });
  });
  testRetriesSelect.addEventListener("change", () => {
    const value = Math.max(1, Math.min(5, Number(testRetriesSelect.value) || 3));
    chrome.storage.local.set({onco_test_max_retries: value}, () => {
      testFeedbackStatus.textContent = "최대 자동 수정 횟수: " + value + "회";
    });
  });

  const SUBMISSION_MODES = ["off","suggest","replace"];
  chrome.storage.local.get(["onco_submit_mode","onco_submit_history","onco_submit_precheck"], data => {
    submissionModeSelect.value = SUBMISSION_MODES.includes(data.onco_submit_mode) ?
      data.onco_submit_mode : "suggest";
    submissionHistoryToggle.checked = data.onco_submit_history !== false;
    submissionPrecheckToggle.checked = data.onco_submit_precheck !== false;
  });
  submissionModeSelect.addEventListener("change", () => {
    const mode = SUBMISSION_MODES.includes(submissionModeSelect.value) ?
      submissionModeSelect.value : "suggest";
    chrome.storage.local.set({onco_submit_mode:mode}, () => {
      submissionFeedbackStatus.textContent = mode==="off" ? "제출 실패 분석을 사용하지 않습니다." :
        mode==="replace" ? "코드 변경이 없고 에디터가 열려 있으면 AI 수정 코드를 적용합니다. 제출은 수동입니다." :
        "제출 실패 시 수정안을 제안하고 기존 코드는 그대로 둡니다.";
    });
  });
  submissionPrecheckToggle.addEventListener("change", () => {
    chrome.storage.local.set({onco_submit_precheck:submissionPrecheckToggle.checked}, () => {
      submissionFeedbackStatus.textContent = submissionPrecheckToggle.checked ?
        "문제 화면에 제출 전 AI 점검 버튼이 표시됩니다. 버튼을 눌러야 점검합니다." :
        "제출 전 AI 점검 버튼을 숨겼습니다.";
    });
  });
  submissionHistoryToggle.addEventListener("change", () => {
    chrome.storage.local.set({onco_submit_history:submissionHistoryToggle.checked}, () => {
      submissionFeedbackStatus.textContent = submissionHistoryToggle.checked ?
        "실패한 제출 이력을 현재 브라우저 세션에서 참고합니다." : "이전 실패 이력 활용을 중지했습니다.";
    });
  });

  let provider = "gemini";
  const modelChoice = { ...AUTO_VALUES };
  const storedKeys = { gemini: false, openai: false };
  let hasSharing = false;
  let hasIdentity = false;
  let pendingCodexLogin = null;
  let loginStatusTimer = null;
  let chatgptCatalogReady = false;
  let modelsRequestId = 0;

  function selectedModelValue() {
    return modelChoice[provider] || AUTO_VALUES[provider];
  }

  function renderModelOptions(models = [], autoModel = "", preferred = selectedModelValue()) {
    modelSelect.replaceChildren();
    const autoGroup = document.createElement("optgroup");
    autoGroup.label = "— 자동 선택 —";
    const autoNames = { gemini: "자동 최신 Flash", openai: "자동 최신 GPT", chatgpt: "ChatGPT 권장 모델" };
    const label = autoNames[provider] + (autoModel ? ` → ${autoModel}` : " (권장)");
    autoGroup.appendChild(createOption(AUTO_VALUES[provider], label, preferred === AUTO_VALUES[provider]));
    modelSelect.appendChild(autoGroup);

    const groups = provider === "gemini" ? [
      { label: "Gemini 일반 모델", filter: m => m.family === "gemini" && !m.specialized },
      { label: "Gemma 모델", filter: m => m.family === "gemma" && !m.specialized },
      { label: "Gemini 특수 모델", filter: m => m.family === "gemini" && m.specialized }
    ] : [
      { label: provider === "openai" ? "OpenAI GPT 텍스트 모델" : "ChatGPT 계정 사용 가능 모델", filter: () => true }
    ];
    for (const group of groups) {
      const matches = models.filter(group.filter);
      if (!matches.length) continue;
      const optgroup = document.createElement("optgroup");
      optgroup.label = group.label;
      for (const model of matches) {
        const tags = [model.preview ? "preview" : "", model.latestAlias ? "latest" : ""].filter(Boolean);
        const name = model.displayName && model.displayName !== model.id
          ? `${model.displayName} — ${model.id}` : model.id;
        optgroup.appendChild(createOption(model.id, name + (tags.length ? ` [${tags.join(", ")}]` : ""), preferred === model.id));
      }
      modelSelect.appendChild(optgroup);
    }
    if (provider !== "chatgpt" && preferred !== AUTO_VALUES[provider] && !models.some(m => m.id === preferred)) {
      const oldGroup = document.createElement("optgroup");
      oldGroup.label = "저장된 이전 모델 (목록에서 확인되지 않음)";
      oldGroup.appendChild(createOption(preferred, `${preferred} ⚠`, true));
      modelSelect.appendChild(oldGroup);
    }
    if (!modelSelect.value) modelSelect.value = AUTO_VALUES[provider];
  }

  function formatSyncTime(ms) {
    if (!ms) return "";
    return new Date(ms).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  function renderProvider() {
    const chatgpt = provider === "chatgpt";
    apiKeySection.hidden = chatgpt;
    chatgptSection.hidden = !chatgpt;
    apiKeyInput.value = "";
    if (!chatgpt) {
      const isOpenAI = provider === "openai";
      apiKeyLabel.textContent = isOpenAI ? "OpenAI API Key" : "Gemini API Key";
      apiKeyInput.placeholder = storedKeys[provider]
        ? "•••••••••••• (저장됨)"
        : isOpenAI ? "OpenAI API 키 (sk-...)" : "Gemini API 키";
      btnRemoveKey.disabled = !storedKeys[provider];
      apiKeyHint.textContent = isOpenAI
        ? "ChatGPT 구독과 API 요금은 별개입니다. API 키는 확장 로컬 저장소에만 보관됩니다."
        : "Gemini API 키는 확장 로컬 저장소에만 보관됩니다.";
      btnSave.disabled = false;
    }
    renderModelOptions();
    btnSolve.disabled = chatgpt && !chatgptCatalogReady;
    modelSelect.disabled = chatgpt && !chatgptCatalogReady;
  }

  function sendAction(action, extras = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action, ...extras }, (response) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!response?.success) reject(new Error(response?.error || "알 수 없는 오류"));
        else resolve(response);
      });
    });
  }

  function loadModels(forceRefresh = false) {
    const requestProvider = provider;
    const requestId = ++modelsRequestId;
    const ready = requestProvider === "chatgpt" ? hasSharing : storedKeys[requestProvider];
    if (!ready) {
      if (requestProvider === "chatgpt") chatgptCatalogReady = false;
      renderModelOptions();
      if (requestProvider === "chatgpt") { btnSolve.disabled = true; modelSelect.disabled = true; }
      btnModelRefresh.disabled = true;
      modelInfo.textContent = requestProvider === "chatgpt"
        ? "ChatGPT 로그인 및 플랜 사용 허용 후 모델을 불러옵니다."
        : "API 키를 저장하면 공식 API에서 모델을 자동 조회합니다.";
      return;
    }
    btnModelRefresh.disabled = true;
    btnModelRefresh.textContent = "동기화 중...";
    modelInfo.textContent = "모델 목록 조회 중...";
    sendAction("GET_MODELS", { provider: requestProvider, forceRefresh })
      .then(response => {
        if (requestId !== modelsRequestId || provider !== requestProvider) return;
        const models = response.models || [];
        if (requestProvider === "chatgpt") chatgptCatalogReady = models.length > 0;
        renderModelOptions(models, response.autoModel || "");
        if (requestProvider === "chatgpt") { btnSolve.disabled = !chatgptCatalogReady; modelSelect.disabled = !chatgptCatalogReady; }
        modelInfo.textContent = `${requestProvider === "gemini" ? "Gemini" : requestProvider === "openai" ? "OpenAI" : "ChatGPT"} 공식 모델 조회` +
          `${response.updatedAt ? " · " + formatSyncTime(response.updatedAt) : ""}` +
          `${response.stale ? " · 이전 캐시" : ""}`;
        modelInfo.title = response.warning || "";
      })
      .catch(err => {
        if (requestId !== modelsRequestId || provider !== requestProvider) return;
        if (requestProvider === "chatgpt") chatgptCatalogReady = false;
        renderModelOptions();
        if (requestProvider === "chatgpt") { btnSolve.disabled = true; modelSelect.disabled = true; }
        modelInfo.textContent = "모델 조회 실패: " + err.message;
      })
      .finally(() => {
        if (requestId !== modelsRequestId || provider !== requestProvider) return;
        btnModelRefresh.disabled = false;
        btnModelRefresh.textContent = "↻ 모델 목록 새로고침";
      });
  }

  function allowedCodexUrl(value) {
    try {
      const u = new URL(value);
      return (u.origin === "https://auth.openai.com" || u.origin === "https://chatgpt.com")
        && !u.username && !u.password ? u.href : null;
    } catch (_) { return null; }
  }

  function renderCodexLogin(login) {
    pendingCodexLogin = login || null;
    const isDevice = login?.mode === "device" && Boolean(login.userCode);
    codexLoginCode.hidden = !isDevice;
    codexUserCode.textContent = isDevice ? login.userCode : "";
    btnOpenLoginPage.disabled = !isDevice || !allowedCodexUrl(login.verificationUrl);
    btnCopyLoginCode.disabled = !isDevice;
    btnCancelLogin.disabled = !login;
    btnSignin.disabled = hasIdentity || Boolean(login);
    btnBrowserSignin.disabled = hasIdentity || Boolean(login);
  }
  function loadChatGPTStatus() {
    if (provider !== "chatgpt") return;
    clearTimeout(loginStatusTimer);
    chatgptStatus.textContent = "Codex 계정 연결 상태 확인 중...";
    sendAction("GET_CHATGPT_STATUS").then(res => {
      if (provider !== "chatgpt") return;
      hasIdentity = Boolean(res.connected);
      hasSharing = Boolean(res.sharing);
      btnSignout.disabled = !hasIdentity;
      identityStatus.textContent = hasIdentity ? "ChatGPT 계정: 로그인됨" : "ChatGPT 계정: 미연결";
      planStatus.textContent = hasIdentity
        ? "Codex 연결됨 · 모델 사용 가능 여부는 목록과 실제 요청으로 확인"
        : "모델 사용 권한: 로그인 필요";
      chatgptStatus.textContent = !res.available
        ? (res.error || "Codex 실행 파일을 찾을 수 없습니다. 최신 Setup을 설치해주세요.")
        : hasIdentity ? "ChatGPT · Codex 연결 완료" : "ChatGPT · Codex 로그인 필요";
      const last = res.lastAuthError;
      authError.hidden = !last?.message;
      authError.textContent = last?.message ? "이전 로그인 실패: " + last.message : "";
      renderCodexLogin(res.login);
      if (!res.available) {
        btnSignin.disabled = true; btnBrowserSignin.disabled = true;
      }
      if (res.login) loginStatusTimer = setTimeout(loadChatGPTStatus, 3500);
      chatgptCatalogReady = false;
      loadModels();
    }).catch(err => {
      if (provider !== "chatgpt") return;
      hasIdentity = false; hasSharing = false; chatgptCatalogReady = false;
      btnCancelLogin.disabled = true; btnSignout.disabled = true;
      identityStatus.textContent = "ChatGPT 계정: 확인 불가";
      planStatus.textContent = "모델 사용 권한: 확인 불가";
      chatgptStatus.textContent = "Codex 연결 실패: " + err.message;
      renderCodexLogin(null);
      btnSignin.disabled = true; btnBrowserSignin.disabled = true;
      loadModels();
    });
  }
  chrome.storage.local.get([
    "onco_provider", "onco_api_key", "onco_openai_api_key", ...Object.values(MODEL_KEYS)
  ], (data) => {
    provider = ["gemini", "openai", "chatgpt"].includes(data.onco_provider) ? data.onco_provider : "gemini";
    providerSelect.value = provider;
    storedKeys.gemini = Boolean(data.onco_api_key);
    storedKeys.openai = Boolean(data.onco_openai_api_key);
    for (const [name, key] of Object.entries(MODEL_KEYS)) {
      modelChoice[name] = data[key] || AUTO_VALUES[name];
    }
    renderProvider();
    if (provider === "chatgpt") loadChatGPTStatus();
    else loadModels();
  });

  providerSelect.addEventListener("change", () => {
    provider = providerSelect.value;
    ++modelsRequestId;
    chrome.storage.local.set({ onco_provider: provider });
    renderProvider();
    setStatus(provider === "chatgpt" ? "도우미 연결 상태를 확인합니다." : "서비스가 변경되었습니다.");
    if (provider === "chatgpt") loadChatGPTStatus();
    else loadModels();
  });

  modelSelect.addEventListener("change", () => {
    modelChoice[provider] = modelSelect.value || AUTO_VALUES[provider];
    chrome.storage.local.set({ [MODEL_KEYS[provider]]: modelChoice[provider] });
  });

  btnModelRefresh.addEventListener("click", () => {
    if (provider === "chatgpt") loadChatGPTStatus();
    else loadModels(true);
  });

  btnSave.addEventListener("click", () => {
    if (provider === "chatgpt") return;
    const chosenProvider = provider;
    const key = apiKeyInput.value.trim();
    if (!key) return setStatus("저장할 API 키를 입력해주세요.", "error");
    chrome.storage.local.set({ [API_KEY_NAMES[chosenProvider]]: key }, () => {
      const cacheKeys = chosenProvider === "gemini"
        ? ["onco_model_catalog", "onco_model_catalog_updated_at"]
        : ["onco_openai_model_catalog", "onco_openai_model_catalog_updated_at"];
      chrome.storage.local.remove(cacheKeys, () => {
        storedKeys[chosenProvider] = true;
        if (provider !== chosenProvider) return;
        renderProvider();
        setStatus("API 키가 저장되었습니다. 모델을 동기화합니다.", "success");
        loadModels(true);
      });
    });
  });

  btnRemoveKey.addEventListener("click", () => {
    if (provider === "chatgpt") return;
    const chosenProvider = provider;
    const keys = chosenProvider === "gemini"
      ? [API_KEY_NAMES.gemini, "onco_model_catalog", "onco_model_catalog_updated_at"]
      : [API_KEY_NAMES.openai, "onco_openai_model_catalog", "onco_openai_model_catalog_updated_at"];
    chrome.storage.local.remove(keys, () => {
      storedKeys[chosenProvider] = false;
      if (provider !== chosenProvider) return;
      renderProvider();
      setStatus("API 키가 삭제되었습니다.", "success");
      loadModels();
    });
  });

  btnOpenHelperGuide.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("tutorial.html") });
  });
  btnUsage.addEventListener("click", () => chrome.tabs.create({ url: "https://chatgpt.com/settings/usage" }));

  btnSignin.addEventListener("click", () => {
    sendAction("START_CHATGPT_SIGNIN").then(res => {
      renderCodexLogin(res.login);
      setStatus("일회용 코드를 복사한 뒤 공식 페이지에서 ChatGPT에 로그인하세요.", "success");
      if (provider === "chatgpt") loginStatusTimer = setTimeout(loadChatGPTStatus, 3500);
    }).catch(err => { setStatus(err.message, "error"); showErrorModal(err.message); });
  });
  btnBrowserSignin.addEventListener("click", () => {
    sendAction("START_CHATGPT_BROWSER_SIGNIN").then(async res => {
      const url = allowedCodexUrl(res.login?.authUrl);
      if (!url) throw Error("Codex가 발급한 브라우저 로그인 주소가 올바르지 않습니다.");
      renderCodexLogin(res.login);
      await chrome.tabs.create({url});
      setStatus("공식 ChatGPT 로그인 페이지를 열었습니다.", "success");
    }).catch(err => { setStatus(err.message, "error"); showErrorModal(err.message); });
  });
  btnCopyLoginCode.addEventListener("click", async () => {
    if (!pendingCodexLogin?.userCode) return;
    try {
      await navigator.clipboard.writeText(pendingCodexLogin.userCode);
      setStatus("기기 로그인 코드를 복사했습니다.", "success");
    } catch (err) { setStatus("코드를 복사하지 못했습니다. 화면에 표시된 코드를 직접 입력해주세요.", "error"); }
  });
  btnOpenLoginPage.addEventListener("click", () => {
    const url = allowedCodexUrl(pendingCodexLogin?.verificationUrl);
    if (!url) return setStatus("공식 인증 주소를 확인하지 못했습니다.", "error");
    chrome.tabs.create({url});
  });
  btnCancelLogin.addEventListener("click", () => {
    sendAction("CANCEL_CHATGPT_SIGNIN").then(() => {
      renderCodexLogin(null);
      setStatus("ChatGPT 로그인 요청을 취소했습니다.");
      loadChatGPTStatus();
    }).catch(err => { setStatus(err.message, "error"); showErrorModal(err.message); });
  });
  btnSignout.addEventListener("click", () => {
    sendAction("LOGOUT_CHATGPT").then(() => {
      setStatus("ChatGPT 로그아웃 완료", "success"); loadChatGPTStatus();
    }).catch(err => { setStatus(err.message, "error"); showErrorModal(err.message); });
  });

  btnSolve.addEventListener("click", () => {
    setBusy(btnSolve, true, "생성 중...", "문제 풀기");
    setStatus("문제를 분석 중입니다...", "loading");

    getActiveOncoTab((tab) => {
      if (!tab) {
        setBusy(btnSolve, false, "", "문제 풀기");
        return;
      }

      chrome.runtime.sendMessage(
        { action: "SOLVE_PROBLEM", tabId: tab.id },
        (response) => {
          setBusy(btnSolve, false, "", "문제 풀기");
          if (chrome.runtime.lastError) {
            const msg = chrome.runtime.lastError.message;
            setStatus("오류: " + msg, "error");
            showErrorModal(msg);
            return;
          }
          if (response && response.success) {
            setStatus("코드가 에디터에 주입되었습니다!", "success");
          } else {
            const msg = response?.error || "알 수 없는 오류";
            setStatus("오류: " + msg, "error");
            showErrorModal(msg);
          }
        }
      );
    });
  });

  btnForcePaste.addEventListener("click", () => {
    setBusy(btnForcePaste, true, "붙여넣는 중...", "강제 붙여넣기");
    setStatus("클립보드 코드를 에디터에 주입 중입니다...", "loading");

    getActiveOncoTab(async (tab) => {
      if (!tab) {
        setBusy(btnForcePaste, false, "", "강제 붙여넣기");
        return;
      }

      let clipText = "";
      try {
        clipText = await navigator.clipboard.readText();
        if (!clipText) throw new Error("클립보드가 비어있습니다.");
      } catch (err) {
        const msg = "[ECLIP] 클립보드 텍스트를 읽을 수 없습니다. " + (err.message || "");
        setBusy(btnForcePaste, false, "", "강제 붙여넣기");
        setStatus("오류: " + msg, "error");
        showErrorModal(msg);
        return;
      }

      chrome.runtime.sendMessage(
        { action: "INJECT_CLIPBOARD_TEXT", tabId: tab.id, text: clipText },
        (response) => {
          setBusy(btnForcePaste, false, "", "강제 붙여넣기");
          if (chrome.runtime.lastError) {
            const msg = chrome.runtime.lastError.message;
            setStatus("오류: " + msg, "error");
            showErrorModal(msg);
            return;
          }
          if (response && response.success) {
            setStatus("클립보드 코드가 주입되었습니다!", "success");
          } else {
            const msg = response?.error || "알 수 없는 오류";
            setStatus("오류: " + msg, "error");
            showErrorModal(msg);
          }
        }
      );
    });
  });
})();
