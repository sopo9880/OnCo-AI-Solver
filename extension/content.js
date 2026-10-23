(() => {
  "use strict";

  // =========================================================================
  // [핵심 기능] 문제 스크래핑 로직
  // =========================================================================

  function scrapeProblem() {
    const context = globalThis.OnCoProblemContext?.detect(document);
    if (!context) throw new Error("실제 문제가 열려 있지 않습니다. 문제 제목·설명이 로딩된 뒤 다시 시도해주세요.");
    const title = globalThis.OnCoProblemContext.text(context.title)
      .replace(/📋\s*문제 복사/g, '').trim();
    const description = globalThis.OnCoProblemContext.text(context.description);
    const langSelect = document.querySelector("select");
    const language = langSelect ? (langSelect.options[langSelect.selectedIndex]?.text?.trim() || "Python 3") : "Python 3";
    let cases = "";
    document.querySelectorAll('li.mt-1.flex.w-full.flex-col').forEach((li, index) => {
      const boxes = li.querySelectorAll('div.bg-gray-700');
      if (boxes.length < 2) return;
      cases += `\n[테스트 케이스 ${index + 1}]\n입력:\n${cleanHtmlToText(boxes[0].innerHTML)}\n출력:\n${cleanHtmlToText(boxes[1].innerHTML)}\n`;
    });
    return { title, description, language, testCases: cases.trim() };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === "SCRAPE_PROBLEM") {
      try {
        const data = scrapeProblem();
        sendResponse({ success: true, data });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return true; 
    }
  });

  // =========================================================================
  // [QoL 기능] 통합 복사 버튼 관리 & Background API 통신 (CSP 회피)
  // =========================================================================

  function cleanHtmlToText(html) {
    if (!html) return "";
    let text = html.replace(/<\/span>\s*<(span|svg)/ig, '</span> <$1');
    text = text.replace(/<br\s*\/?>/ig, '\n');
    const temp = document.createElement('div');
    temp.innerHTML = text;
    let res = temp.textContent || temp.innerText || "";
    return res.replace(/[ \t]+/g, ' ').trim();
  }

  // 비동기 통신 시 브라우저 클립보드 블락을 막기 위한 초강력 복사 함수 (Fallback 포함)
  async function copyToClipboardSafely(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      // 권한 에러 시 구식 textarea 트릭으로 강제 복사 진행
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (!successful) throw new Error("Fallback copy failed");
    }
  }

  async function toPngBlob(src, existingImg) {
    const img = existingImg || new Image();
    if (!existingImg) {
      img.crossOrigin = "anonymous";
      img.src = src;
      await img.decode();
    }

    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("이미지를 PNG로 변환할 수 없습니다."));
      }, "image/png");
    });
  }

  async function copyImageToClipboard(img) {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      throw new Error("이 브라우저는 이미지 클립보드 복사를 지원하지 않습니다.");
    }

    const src = img.currentSrc || img.src;
    if (!src) throw new Error("복사할 이미지 주소를 찾을 수 없습니다.");

    let blob;
    try {
      const res = await fetch(src, { credentials: "include" });
      if (!res.ok) throw new Error("이미지를 가져올 수 없습니다.");
      const fetchedBlob = await res.blob();
      if (fetchedBlob.type === "image/png") {
        blob = fetchedBlob;
      } else {
        const objectUrl = URL.createObjectURL(fetchedBlob);
        try {
          blob = await toPngBlob(objectUrl);
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      }
    } catch (_) {
      blob = await toPngBlob(src, img);
    }

    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": blob })
    ]);
  }

  function createCopyButton(label, getTextFn) {
    const btn = document.createElement('button');
    btn.textContent = `📋 ${label}`;
    btn.className = 'onco-qol-copy-btn'; 
    Object.assign(btn.style, {
      marginLeft: '12px', padding: '4px 10px', fontSize: '12px', fontWeight: 'bold',
      backgroundColor: '#2a3a5a', color: '#7eb8f7', border: 'none', borderRadius: '6px',
      cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,0.2)', transition: 'all 0.2s ease'
    });

    btn.onmouseover = () => btn.style.backgroundColor = '#3a4a6a';
    btn.onmouseout = () => btn.style.backgroundColor = btn.textContent.includes('✅') ? '#1a3a2a' : '#2a3a5a';

    btn.onclick = async (e) => {
      e.preventDefault(); e.stopPropagation();
      try {
        const content = await getTextFn(); 
        await copyToClipboardSafely(content); // 안전한 복사 함수 호출
        
        const originalText = btn.textContent;
        btn.textContent = '✅ 복사 완료!';
        btn.style.backgroundColor = '#1a3a2a'; btn.style.color = '#60c090';
        setTimeout(() => {
          btn.textContent = originalText;
          btn.style.backgroundColor = '#2a3a5a'; btn.style.color = '#7eb8f7';
        }, 1500);
      } catch (err) {
        alert(err.message || "복사 실패! 브라우저 권한을 확인해주세요.");
      }
    };
    return btn;
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error("통신 오류: " + chrome.runtime.lastError.message));
          return;
        }
        if (response && response.success) {
          resolve(response);
        } else {
          reject(new Error(response?.error || "알 수 없는 오류"));
        }
      });
    });
  }

  function createActionButton(label, icon, actionFn) {
    const btn = document.createElement('button');
    btn.textContent = `${icon} ${label}`;
    btn.className = 'onco-qol-copy-btn onco-qol-action-btn';
    Object.assign(btn.style, {
      padding: '4px 10px', fontSize: '12px', fontWeight: 'bold',
      backgroundColor: '#2a3a5a', color: '#7eb8f7', border: '1px solid #4a90d9',
      borderRadius: '6px', cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
      transition: 'all 0.2s ease', whiteSpace: 'nowrap'
    });

    btn.onmouseover = () => {
      if (!btn.disabled) btn.style.backgroundColor = '#3a4a6a';
    };
    btn.onmouseout = () => {
      if (!btn.disabled) btn.style.backgroundColor = btn.textContent.includes('✅') ? '#1a3a2a' : '#2a3a5a';
    };

    btn.onclick = async (e) => {
      e.preventDefault(); e.stopPropagation();
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = '⏳ 처리 중...';
      btn.style.backgroundColor = '#24344d';
      try {
        await actionFn();
        btn.textContent = '✅ 완료!';
        btn.style.backgroundColor = '#1a3a2a'; btn.style.color = '#60c090';
        setTimeout(() => {
          btn.disabled = false;
          btn.textContent = originalText;
          btn.style.backgroundColor = '#2a3a5a'; btn.style.color = '#7eb8f7';
        }, 1500);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = originalText;
        btn.style.backgroundColor = '#2a3a5a'; btn.style.color = '#7eb8f7';
        alert(err.message || "실행 실패");
      }
    };

    return btn;
  }

  function createImageCopyButton(img) {
    const btn = createCopyButton('이미지 복사', () => "");
    btn.classList.add('onco-qol-image-copy-btn');
    btn.onclick = async (e) => {
      e.preventDefault(); e.stopPropagation();
      try {
        await copyImageToClipboard(img);

        const originalText = btn.textContent;
        btn.textContent = '✅ 이미지 복사 완료!';
        btn.style.backgroundColor = '#1a3a2a'; btn.style.color = '#60c090';
        setTimeout(() => {
          btn.textContent = originalText;
          btn.style.backgroundColor = '#2a3a5a'; btn.style.color = '#7eb8f7';
        }, 1500);
      } catch (err) {
        alert(err.message || "이미지 복사 실패! 브라우저 권한을 확인해주세요.");
      }
    };
    Object.assign(btn.style, {
      display: 'inline-block', marginLeft: '0', marginTop: '6px', marginBottom: '8px'
    });
    return btn;
  }

  const originalStyles = new WeakMap();
  let currentTitle = null;
  let currentEditor = null;
  function rememberStyle(el) {
    if (el && !originalStyles.has(el)) originalStyles.set(el, el.getAttribute('style'));
  }
  function resetInjectedUI() {
    document.querySelectorAll('.onco-qol-copy-btn, #onco-monaco-toolbar, .onco-qol-image-copy-wrap').forEach(el => el.remove());
    document.querySelectorAll('[data-onco-image-copy-ready]').forEach(img => delete img.dataset.oncoImageCopyReady);
    for (const el of [currentTitle, currentEditor?.parentElement]) {
      if (!el || !originalStyles.has(el)) continue;
      const previous = originalStyles.get(el);
      if (previous === null) el.removeAttribute('style'); else el.setAttribute('style', previous);
      originalStyles.delete(el);
    }
    currentTitle = null;
    currentEditor = null;
  }

  function injectCopyButtons() {
    const context = globalThis.OnCoProblemContext?.detect(document);
    if (!context) {
      if (document.querySelector('.onco-qol-copy-btn')) resetInjectedUI();
      return;
    }
    if (currentTitle !== context.title || currentEditor !== context.editor) resetInjectedUI();
    currentTitle = context.title;
    currentEditor = context.editor;

    // A problem title is only eligible after both a populated description and Monaco are present.
    const titleHeader = context.title;
    if (!titleHeader.querySelector('.onco-qol-copy-btn')) {
      rememberStyle(titleHeader);
      titleHeader.style.display = 'flex';
      titleHeader.style.alignItems = 'center';
      titleHeader.style.justifyContent = 'space-between';
      titleHeader.appendChild(createCopyButton('문제 복사', () => {
        const fresh = globalThis.OnCoProblemContext.detect(document);
        if (!fresh) throw Error('문제가 닫혔습니다.');
        return `${globalThis.OnCoProblemContext.text(fresh.title).replace(/📋\s*문제 복사/g,'').trim()}\n\n${globalThis.OnCoProblemContext.text(fresh.description)}`;
      }));
    }

    document.querySelectorAll('li.mt-1.flex.w-full.flex-col').forEach(li => {
      const labels = li.querySelectorAll('p.text-basic-text-normal');
      const boxes = li.querySelectorAll('div.bg-gray-700');
      if (labels.length < 2 || boxes.length < 2) return;
      for (const [index, label] of [labels[0], labels[1]].entries()) {
        if (label.querySelector('.onco-qol-copy-btn')) continue;
        rememberStyle(label);
        label.style.display = 'flex';
        label.style.alignItems = 'center';
        label.style.justifyContent = 'space-between';
        label.appendChild(createCopyButton(index === 0 ? '입력 복사' : '출력 복사',
          () => cleanHtmlToText(boxes[index].innerHTML)));
      }
    });

    const editorContainer = context.editor;
    if (!document.getElementById('onco-monaco-toolbar')) {
      const parent = editorContainer.parentElement;
      if (parent) {
        rememberStyle(parent);
        parent.style.position = 'relative';
        const toolbar = document.createElement('div');
        toolbar.id = 'onco-monaco-toolbar';
        Object.assign(toolbar.style, {
          position: 'absolute', top: '12px', right: '25px', zIndex: '99999',
          display: 'flex', alignItems: 'center', gap: '6px'
        });
        toolbar.appendChild(createActionButton('문제 풀이', '⚡', () => sendRuntimeMessage({ action: 'SOLVE_PROBLEM' })));
        toolbar.appendChild(createActionButton('강제 붙여넣기', '📌', async () => {
          const value = await navigator.clipboard.readText();
          if (!value) throw Error('클립보드가 비어있습니다.');
          return sendRuntimeMessage({ action: 'INJECT_CLIPBOARD_TEXT', text: value });
        }));
        const codeButton = createCopyButton('코드 복사', () => new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({ action: 'GET_MONACO_CODE' }, response => {
            if (chrome.runtime.lastError) return reject(Error(chrome.runtime.lastError.message));
            if (response?.success && typeof response.code === 'string') resolve(response.code);
            else reject(Error(response?.error || '코드를 읽을 수 없습니다.'));
          });
        }));
        codeButton.id = 'onco-monaco-copy-btn';
        codeButton.style.marginLeft = '0';
        toolbar.appendChild(codeButton);
        parent.appendChild(toolbar);
      }
    }

    context.description.querySelectorAll('img').forEach(img => {
      if (!(img.currentSrc || img.src) || img.dataset.oncoImageCopyReady === 'true') return;
      img.dataset.oncoImageCopyReady = 'true';
      const wrapper = document.createElement('div');
      wrapper.className = 'onco-qol-image-copy-wrap';
      wrapper.appendChild(createImageCopyButton(img));
      img.insertAdjacentElement('afterend', wrapper);
    });
  }

  // SPA navigation/loading: batch rapid DOM mutations rather than injecting on every mutation.
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; injectCopyButtons(); }, 120);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  injectCopyButtons();
})();