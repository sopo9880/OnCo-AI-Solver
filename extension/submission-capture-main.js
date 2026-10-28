/* v1.3.7: synchronous, read-only Monaco snapshot for a trusted user submit click.
 * Runs in MAIN world. Never clicks Submit or reads credentials.
 */
(() => {
  'use strict';
  const requestEvent = 'onco-solver-read-editor-v1';
  const replyEvent = 'onco-solver-editor-response-v1';
  function editorCode() {
    const api = window.monaco?.editor;
    if (!api?.getEditors) return null;
    for (const editor of api.getEditors()) {
      if (!editor || editor.getOption(api.EditorOption.readOnly)) continue;
      const value = editor.getModel()?.getValue();
      if (typeof value === 'string') return value;
    }
    return null;
  }
  window.addEventListener(requestEvent, event => {
    const nonce = event.detail;
    if (typeof nonce !== 'string' || !/^\d+-\d+$/.test(nonce)) return;
    let code = null;
    try { code = editorCode(); } catch (_) { /* no active editor */ }
    window.dispatchEvent(new CustomEvent(replyEvent, {
      detail: JSON.stringify({ nonce, code: typeof code === 'string' ? code : null })
    }));
  });
})();