// Shared by the installed file:// guide and the Chrome/Whale MV3 extension page.
// All interactions use externally loaded, same-origin JS. No inline handlers or eval.
(() => {
  'use strict';

  const folder = document.getElementById('folder');
  const notice = document.getElementById('msg');
  const folderCopy = document.getElementById('copy-folder');
  if (!folder || !notice || !folderCopy) return;

  const customDir = new URLSearchParams(window.location.search).get('dir');
  folder.value = customDir || '%LOCALAPPDATA%\\Programs\\OnCo AI Solver\\extension';

  const showMessage = value => { notice.textContent = value; };

  async function copyText(value) {
    const text = String(value || '');
    if (!text) {
      showMessage('복사할 주소 또는 경로가 없습니다.');
      return false;
    }
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(text);
    } catch (_) {
      // file:// guide pages can lack the async Clipboard API.
      let textarea;
      try {
        textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        document.body.appendChild(textarea);
        textarea.select();
        if (!document.execCommand('copy')) throw new Error('Fallback copy failed');
      } catch (_) {
        showMessage('복사하지 못했습니다. 위 주소나 경로를 직접 선택해 복사해주세요.');
        return false;
      } finally {
        textarea?.remove();
      }
    }
    showMessage('복사했습니다. 브라우저 주소창이나 폴더 선택 창에 붙여넣으세요.');
    return true;
  }

  document.querySelectorAll('[data-copy]').forEach(element => {
    element.addEventListener('click', () => copyText(element.dataset.copy));
  });
  folderCopy.addEventListener('click', () => copyText(folder.value));
  document.querySelectorAll('[data-browser]').forEach(element => {
    element.addEventListener('click', () => {
      const browser = element.dataset.browser;
      showMessage(browser + '에서 확장 관리 화면을 여는 중입니다. 외부 앱 확인창이 나오면 허용하세요. 열리지 않으면 주소 복사를 이용해주세요.');
    });
  });
})();
