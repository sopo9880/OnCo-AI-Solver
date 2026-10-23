(() => {
  "use strict";

  // =========================================================================
  // [핵심 기능] 문제 스크래핑 로직
  // =========================================================================

  function scrapeProblem() {
    // 문제 제목 추출
    const titleSelectors = [ "h1", "h2", ".problem-title", "[class*='title']", "header h1", "header h2" ];
    let title = "";
    for (const sel of titleSelectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim()) {
        title = el.innerText.trim();
        break;
      }
    }

    // 문제 설명 추출
    const editorEls = document.querySelectorAll(".ql-editor");
    let description = "";
    editorEls.forEach((el) => {
      if (el.getAttribute("contenteditable") === "false") {
        description += el.innerText.trim() + "\n\n";
      }
    });

    if (!description.trim()) {
      editorEls.forEach((el) => { description += el.innerText.trim() + "\n\n"; });
    }

    if (!description.trim()) {
      const fallbackSelectors = [ "[class*='description']", "[class*='problem']", "[class*='content']", "article", "main" ];
      for (const sel of fallbackSelectors) {
        const el = document.querySelector(sel);
        if (el && el.innerText.trim().length > 50) {
          description = el.innerText.trim();
          break;
        }
      }
    }

    const langSelect = document.querySelector("select");
    const language = langSelect ? (langSelect.options[langSelect.selectedIndex]?.text?.trim() || "Python 3") : "Python 3";

    return {
      title: title || document.title || "",
      description: description.trim(),
      language,
      testCases: (function() {
        try {
          let testCasesText = "";
          const testCaseList = document.querySelectorAll('li.mt-1.flex.w-full.flex-col');
          testCaseList.forEach((li, index) => {
            const codeBoxes = li.querySelectorAll('div.bg-gray-700');
            if (codeBoxes.length >= 2) {
              let rawInputHtml = codeBoxes[0].innerHTML || "";
              let rawOutputHtml = codeBoxes[1].innerHTML || "";

              rawInputHtml = rawInputHtml.replace(/<\/span>\s*<(span|svg)/ig, '</span> <$1');
              rawOutputHtml = rawOutputHtml.replace(/<\/span>\s*<(span|svg)/ig, '</span> <$1');
              rawInputHtml = rawInputHtml.replace(/<br\s*\/?>/ig, '\n');
              rawOutputHtml = rawOutputHtml.replace(/<br\s*\/?>/ig, '\n');

              const tempIn = document.createElement('div');
              const tempOut = document.createElement('div');
              tempIn.innerHTML = rawInputHtml;
              tempOut.innerHTML = rawOutputHtml;

              let inputData = tempIn.textContent || tempIn.innerText || "";
              let outputData = tempOut.textContent || tempOut.innerText || "";

              inputData = inputData.replace(/[ \t]+/g, ' ').trim();
              outputData = outputData.replace(/[ \t]+/g, ' ').trim();

              testCasesText += `\n[테스트 케이스 ${index + 1}]\n`;
              testCasesText += `입력:\n${inputData}\n`;
              testCasesText += `출력:\n${outputData}\n`;
            }
          });
          return testCasesText.trim();
        } catch (e) { return ""; }
      })()
    };
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

  function injectCopyButtons() {
    // [문제 복사]
    const titleHeader = document.querySelector('h2.title-2-stronger') || document.querySelector('h1.body-1-stronger');
    if (titleHeader && !titleHeader.querySelector('.onco-qol-copy-btn')) {
      titleHeader.style.display = 'flex'; titleHeader.style.alignItems = 'center'; titleHeader.style.justifyContent = 'space-between';
      titleHeader.appendChild(createCopyButton('문제 복사', () => {
        const desc = document.querySelector('.ql-editor')?.innerText || "";
        return `${titleHeader.innerText.replace('📋 문제 복사', '').trim()}\n\n${desc}`;
      }));
    }

    // [테스트 케이스 복사]
    const testCaseList = document.querySelectorAll('li.mt-1.flex.w-full.flex-col');
    testCaseList.forEach((li) => {
      const labels = li.querySelectorAll('p.text-basic-text-normal');
      const codeBoxes = li.querySelectorAll('div.bg-gray-700');

      if (labels.length >= 2 && codeBoxes.length >= 2) {
        if (!labels[0].querySelector('.onco-qol-copy-btn')) {
          labels[0].style.display = 'flex'; labels[0].style.alignItems = 'center'; labels[0].style.justifyContent = 'space-between';
          labels[0].appendChild(createCopyButton('입력 복사', () => cleanHtmlToText(codeBoxes[0].innerHTML)));
        }
        if (!labels[1].querySelector('.onco-qol-copy-btn')) {
          labels[1].style.display = 'flex'; labels[1].style.alignItems = 'center'; labels[1].style.justifyContent = 'space-between';
          labels[1].appendChild(createCopyButton('출력 복사', () => cleanHtmlToText(codeBoxes[1].innerHTML)));
        }
      }
    });

    // ✨ [Monaco 에디터 툴바] ✨ (풀이/붙여넣기/코드 복사)
    const editorContainer = document.querySelector('.monaco-editor');
    if (editorContainer && !document.getElementById('onco-monaco-toolbar')) {
      const parent = editorContainer.parentElement;
      if (parent) {
        parent.style.position = 'relative';

        const toolbar = document.createElement('div');
        toolbar.id = 'onco-monaco-toolbar';
        Object.assign(toolbar.style, {
          position: 'absolute', top: '12px', right: '25px', zIndex: '99999',
          display: 'flex', alignItems: 'center', gap: '6px'
        });

        const solveBtn = createActionButton('문제 풀이', '⚡', () => {
          return sendRuntimeMessage({ action: "SOLVE_PROBLEM" });
        });

        const pasteBtn = createActionButton('강제 붙여넣기', '📌', async () => {
          let text = "";
          try {
            text = await navigator.clipboard.readText();
          } catch (err) {
            throw new Error("클립보드 텍스트를 읽을 수 없습니다. 브라우저 권한을 확인해주세요.");
          }
          if (!text) throw new Error("클립보드가 비어있습니다.");
          return sendRuntimeMessage({ action: "INJECT_CLIPBOARD_TEXT", text });
        });

        const monacoBtn = createCopyButton('코드 복사', () => {
          return new Promise((resolve, reject) => {
            // background.js에 코드 추출 특별 지시 발송!
            chrome.runtime.sendMessage({ action: "GET_MONACO_CODE" }, (response) => {
              if (chrome.runtime.lastError) {
                return reject(new Error("통신 오류: " + chrome.runtime.lastError.message));
              }
              if (response && response.success && typeof response.code === "string") {
                resolve(response.code);
              } else {
                reject(new Error(response?.error || 'Monaco 에디터 코드를 읽어올 수 없습니다.'));
              }
            });
          });
        });
        
        monacoBtn.id = 'onco-monaco-copy-btn';
        Object.assign(monacoBtn.style, {
          marginLeft: '0', border: '1px solid #4a90d9', whiteSpace: 'nowrap'
        });
        
        toolbar.appendChild(solveBtn);
        toolbar.appendChild(pasteBtn);
        toolbar.appendChild(monacoBtn);
        parent.appendChild(toolbar);
      }
    }

    // [문제 이미지 복사]
    const problemImages = document.querySelectorAll('.ql-editor img, main img, article img');
    problemImages.forEach((img) => {
      if (!img.src || img.dataset.oncoImageCopyReady === "true") return;
      img.dataset.oncoImageCopyReady = "true";

      const btn = createImageCopyButton(img);
      const container = document.createElement('div');
      container.className = 'onco-qol-image-copy-wrap';
      container.style.display = 'block';
      container.appendChild(btn);

      img.insertAdjacentElement('afterend', container);
    });
  }

  const observer = new MutationObserver(() => { injectCopyButtons(); });
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(injectCopyButtons, 1000);

})();