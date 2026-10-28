// MV3 extension CSP regression: tutorial has no inline JS/event handlers.
// The same external tutorial.js must also function when installer opens file://.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const [extensionHtml, installerHtml, extensionJs, installerJs] = await Promise.all([
  readFile(join(root, 'extension/tutorial.html'), 'utf8'),
  readFile(join(root, 'installer/tutorial/index.html'), 'utf8'),
  readFile(join(root, 'extension/tutorial.js'), 'utf8'),
  readFile(join(root, 'installer/tutorial/tutorial.js'), 'utf8')
]);

assert.equal(extensionHtml, installerHtml, 'Installer and MV3 extension tutorial must match');
assert.equal(extensionJs, installerJs, 'Both contexts must ship identical external tutorial JS');
assert.match(extensionHtml, /<small>v1\.3\.6<\/small>/);
assert.doesNotMatch(extensionHtml, /\son[a-z]+\s*=/i,
  'inline event handlers violate script-src self');
assert.doesNotMatch(extensionHtml, /\bhref\s*=\s*["']\s*javascript:/i);
const scripts = [...extensionHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
assert.equal(scripts.length, 1, 'Tutorial must load exactly one external script');
assert.match(scripts[0][1], /\bsrc=["']tutorial\.js["']/);
assert.equal(scripts[0][2].trim(), '', 'Inline script content is disallowed');
assert.match(extensionHtml, /data-copy="chrome:\/\/extensions"/);
assert.match(extensionHtml, /data-copy="whale:\/\/extensions"/);
assert.match(extensionHtml, /href="onco-ai-solver:\/\/chrome-extensions\/"/);
assert.match(extensionHtml, /href="onco-ai-solver:\/\/whale-extensions\/"/);
assert.match(extensionHtml, /id="copy-folder"/);
assert.doesNotMatch(extensionJs, /\b(?:eval|Function)\s*\(/,
  'Do not bypass MV3 CSP with runtime code evaluation');

function element(dataset = {}) {
  const events = new Map();
  return {
    dataset, textContent: '', value: '', disabled: false,
    addEventListener(name, fn) { events.set(name, fn); },
    click() {
      const handler = events.get('click');
      assert.equal(typeof handler, 'function', 'Missing click listener');
      return handler({ type: 'click' });
    }
  };
}

function renderGuide({ search = '', clipboardFails = false, fallbackSuccess = true } = {}) {
  const folder = element(), message = element(), folderCopy = element();
  const chromeCopy = element({ copy: 'chrome://extensions' });
  const whaleCopy = element({ copy: 'whale://extensions' });
  const chromeLink = element({ browser: 'Chrome' });
  const whaleLink = element({ browser: 'Whale' });
  const copies = [];
  const fallback = [];
  const doc = {
    getElementById(id) {
      return ({folder, msg:message, 'copy-folder':folderCopy})[id] || null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-copy]') return [chromeCopy, whaleCopy];
      if (selector === '[data-browser]') return [chromeLink, whaleLink];
      throw Error('Unexpected selector: ' + selector);
    },
    createElement(type) {
      assert.equal(type, 'textarea');
      const box = {
        value: '', removed: false, selected: false,
        setAttribute() {},
        select() { this.selected = true; },
        remove() { this.removed = true; }
      };
      fallback.push(box);
      return box;
    },
    body: {
      appendChild() {}
    },
    execCommand(command) {
      assert.equal(command, 'copy');
      return fallbackSuccess;
    }
  };
  const navigator = {
    clipboard: { writeText: async text => {
      if (clipboardFails) throw Error('Clipboard access denied');
      copies.push(text);
    } }
  };
  vm.runInNewContext(extensionJs, {
    document: doc, window: {location: {search}}, navigator, URLSearchParams
  }, {filename: 'tutorial.js', timeout: 3000});
  return {folder, message, folderCopy, chromeCopy, whaleCopy, chromeLink, whaleLink, copies, fallback};
}

const guide = renderGuide();
assert.equal(guide.folder.value, '%LOCALAPPDATA%\\Programs\\OnCo AI Solver\\extension');
assert.equal(await guide.chromeCopy.click(), true);
assert.equal(await guide.whaleCopy.click(), true);
assert.equal(await guide.folderCopy.click(), true);
assert.deepEqual(guide.copies, [
  'chrome://extensions', 'whale://extensions',
  '%LOCALAPPDATA%\\Programs\\OnCo AI Solver\\extension'
]);
guide.chromeLink.click();
assert.match(guide.message.textContent, /Chrome에서 확장 관리 화면/);
guide.whaleLink.click();
assert.match(guide.message.textContent, /Whale에서 확장 관리 화면/);

const customPath = 'D:\\Installed Apps\\OnCo AI Solver\\extension';
const custom = renderGuide({search:'?dir='+encodeURIComponent(customPath)});
assert.equal(custom.folder.value, customPath);
assert.equal(await custom.folderCopy.click(), true);
assert.equal(custom.copies.at(-1), customPath);

const fallback = renderGuide({clipboardFails:true});
assert.equal(await fallback.chromeCopy.click(), true);
assert.equal(fallback.fallback.length, 1);
assert.equal(fallback.fallback[0].value, 'chrome://extensions');
assert.equal(fallback.fallback[0].selected, true);
assert.equal(fallback.fallback[0].removed, true);

const blocked = renderGuide({clipboardFails:true, fallbackSuccess:false});
assert.equal(await blocked.whaleCopy.click(), false);
assert.equal(blocked.fallback[0].removed, true);
assert.match(blocked.message.textContent, /복사하지 못했습니다/);

console.log('PASS: MV3 tutorial CSP, no inline JS, installation/extension parity, copied addresses and custom folders, file clipboard fallback');
