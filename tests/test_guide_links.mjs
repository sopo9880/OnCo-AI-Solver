// The setup page must open the matching browser's extension manager without
// allowing arbitrary external URLs or command-line arguments.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const nativeSource = await readFile(join(root, 'bridge/main.cjs'), 'utf8');
const mainCall = nativeSource.lastIndexOf('\nmain().catch(');
assert.ok(mainCall > 0, 'native helper entrypoint boundary must exist');
const moduleShim = { exports: {} };
vm.runInNewContext(nativeSource.slice(0, mainCall) + '\nmodule.exports = { guideBrowserFromLink, guideUriFromArgs, browserExecutableCandidates, GUIDE_TARGETS };', {
  module: moduleShim, process, require: createRequire(import.meta.url),
  Buffer, URL, URLSearchParams, fetch, AbortSignal, TextDecoder,
  setTimeout, clearTimeout, console
}, { filename: 'bridge/main.cjs', timeout: 3000 });
const { guideBrowserFromLink, guideUriFromArgs, browserExecutableCandidates, GUIDE_TARGETS } = moduleShim.exports;
const chromeLink = 'onco-ai-solver://chrome-extensions/';
const whaleLink = 'onco-ai-solver://whale-extensions/';
assert.equal(guideBrowserFromLink(chromeLink), 'chrome');
assert.equal(guideBrowserFromLink(whaleLink), 'whale');
assert.equal(guideBrowserFromLink(chromeLink.toUpperCase()), 'chrome');
assert.equal(GUIDE_TARGETS.chrome.url, 'chrome://extensions');
assert.equal(GUIDE_TARGETS.whale.url, 'whale://extensions');
assert.equal(GUIDE_TARGETS.chrome.exe, 'chrome.exe');
assert.equal(GUIDE_TARGETS.whale.exe, 'whale.exe');

// Malicious or unsupported deep links must never start an executable.
for (const invalid of [
  '', 'https://example.com', 'chrome://extensions',
  'onco-ai-solver://other-command/', 'onco-ai-solver://chrome-extensions/extra',
  'onco-ai-solver://chrome-extensions/?url=https://example.com',
  'onco-ai-solver://chrome-extensions/#fragment',
  'onco-ai-solver://chrome-extensions/../../cmd',
  'onco-ai-solver://chrome-extensions/" --new-window',
  'onco-ai-solver://chrome-extensions/%0d%0a',
  'onco-ai-solver://whale-extensions/?',
  'onco-ai-solver://chrome-extensions/'.repeat(4)
]) {
  assert.equal(guideBrowserFromLink(invalid), null, invalid);
}
assert.equal(guideUriFromArgs(['C:\\OnCoBridge.exe', chromeLink], 'C:\\OnCoBridge.exe'), chromeLink);
assert.equal(guideUriFromArgs(['C:\\node.exe', 'bridge/main.cjs', whaleLink], 'C:\\node.exe'), whaleLink);
assert.equal(guideUriFromArgs(['C:\\OnCoBridge.exe', chromeLink, '--unsafe'], 'C:\\OnCoBridge.exe'), null);
assert.equal(guideUriFromArgs(['C:\\OnCoBridge.exe'], 'C:\\OnCoBridge.exe'), null);
assert.equal(guideUriFromArgs(['C:\\node.exe', 'bridge/main.cjs'], 'C:\\node.exe'), null);
const mockEnv = {
  LOCALAPPDATA: 'C:\\Users\\Tester\\AppData\\Local',
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)'
};
const chromeCandidates = Array.from(browserExecutableCandidates('chrome', mockEnv));
const whaleCandidates = Array.from(browserExecutableCandidates('whale', mockEnv));
assert.equal(chromeCandidates.length, 3);
assert.equal(whaleCandidates.length, 3);
assert.ok(chromeCandidates.every(path => path.includes('Google') && path.endsWith('chrome.exe')));
assert.ok(whaleCandidates.every(path => path.includes('Naver Whale') && path.endsWith('whale.exe')));
assert.equal(Array.from(browserExecutableCandidates('other', mockEnv)).length, 0);
assert.match(nativeSource, /spawn\(executable, \['--new-tab', target\.url\]/);
assert.match(nativeSource, /shell: false/);
assert.match(nativeSource, /if \(guideUri\) \{\s*await openExtensionManager\(guideUri\)/);

const installer = await readFile(join(root, 'installer/onco.iss'), 'utf8');
assert.match(installer, /#define AppVersion "1\.3\.2"/);
assert.match(installer, /Root: HKCU; Subkey: "Software\\Classes\\onco-ai-solver"; ValueType: string; ValueName: "URL Protocol"/);
assert.match(installer, /Root: HKCU; Subkey: "Software\\Classes\\onco-ai-solver"; ValueType: string; ValueName: "";.*Flags: uninsdeletekey/);
assert.match(installer, /ValueData: """\{app\}\\bridge\\OnCoBridge\.exe"" ""%1"""/);
const installGuide = await readFile(join(root, 'installer/tutorial/index.html'), 'utf8');
const bundledGuide = await readFile(join(root, 'extension/tutorial.html'), 'utf8');
assert.equal(installGuide, bundledGuide, 'Installer and extension must ship the same guide');
assert.match(installGuide, /href="onco-ai-solver:\/\/chrome-extensions\/"/);
assert.match(installGuide, /href="onco-ai-solver:\/\/whale-extensions\/"/);
assert.match(installGuide, /새 탭에서 열기/);
assert.match(installGuide, /주소 복사/);
assert.ok(!installGuide.includes('window.open("chrome://'));
assert.equal(JSON.parse(await readFile(join(root,'extension/manifest.json'),'utf8')).version, '1.3.2');
console.log('PASS: strict setup guide URI allowlist, per-user protocol registration, Chrome/Whale tabs, copy fallback');
