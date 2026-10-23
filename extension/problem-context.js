/* Shared, conservative problem-page recognition. Never infer a problem from URL/title alone. */
((scope) => {
  'use strict';
  const NOT_A_PROBLEM = /^(?:과제\s*연습|공지\s*사항|홈|학습\s*챕터|문제\s*내용|코드\s*작성|테스트\s*케이스|안내\s*사항|나의\s*성적|QnA|로그아웃)$/i;
  const headingSelectors = 'h1, h2, h3, .problem-title';
  function text(el) { return String(el?.innerText || el?.textContent || '').trim(); }
  function visible(el) {
    if (!el || !el.isConnected) return false;
    if (el.closest('[hidden], [aria-hidden="true"]')) return false;
    const rect = el.getBoundingClientRect?.();
    return !rect || (rect.width > 0 && rect.height > 0);
  }
  function detect(doc = document) {
    // Monaco + a populated description: a problem must be loaded, not merely a chapter card.
    const codeEditor = [...doc.querySelectorAll('.monaco-editor')].find(visible);
    if (!codeEditor) return null;
    const descriptions = [...doc.querySelectorAll('.ql-editor')]
      .filter(el => visible(el) && !el.closest('[contenteditable="true"]') && text(el).length >= 25);
    if (!descriptions.length) return null;
    const description = descriptions[0];
    const dr = description.getBoundingClientRect();
    const candidates = [...doc.querySelectorAll(headingSelectors)]
      .filter(el => visible(el) && !el.closest('nav, header, aside, [role="navigation"]'))
      .filter(el => {
        const value = text(el).replace(/📋\s*문제 복사/g, '').trim();
        return value.length >= 2 && value.length <= 150 && !NOT_A_PROBLEM.test(value);
      })
      .map(el => {
        const r = el.getBoundingClientRect();
        const distance = dr.top - r.bottom;
        const horizontal = Math.abs(dr.left - r.left);
        return { el, distance, horizontal };
      })
      .filter(item => item.distance >= -24 && item.distance <= 450 && item.horizontal <= 240)
      .sort((a, b) => (a.distance + a.horizontal * .3) - (b.distance + b.horizontal * .3));
    if (!candidates.length) return null;
    return { title: candidates[0].el, description, editor: codeEditor };
  }
  const api = { detect, text };
  scope.OnCoProblemContext = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);