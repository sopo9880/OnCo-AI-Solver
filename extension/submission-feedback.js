/* OnCo submission-feedback v1.3.7.
 * Observe USER submissions and publicly displayed verdicts only.
 * No private OnCo endpoints, no automatic Submit clicks and no persistent code storage.
 */
((scope) => {
  'use strict';
  const MODES = ['off', 'suggest', 'replace'];
  const VERDICTS = [
    ['time', /시간\s*(?:제한\s*)?초과|실행\s*시간\s*초과|time\s*limit\s*exceeded|\bTLE\b/i, '시간 초과'],
    ['memory', /메모리\s*(?:제한\s*)?초과|memory\s*limit\s*exceeded|\bMLE\b/i, '메모리 초과'],
    ['runtime', /런타임\s*(?:에러|오류)|실행\s*오류|runtime\s*error|\bRTE\b/i, '런타임 오류'],
    ['compile', /컴파일\s*(?:에러|오류|실패)|compile\s*(?:error|failed)|compilation\s*error/i, '컴파일 오류'],
    ['wrong', /오답|틀렸습니다|정답이\s*아닙니다|wrong\s*answer/i, '오답'],
    ['partial', /부분\s*(?:정답|점수|통과)|partial(?:ly)?\s*(?:accepted|correct|score)/i, '부분 점수'],
    ['accepted', /정답입니다|맞았습니다|채점\s*성공|제출\s*성공|accepted|all\s*tests?\s*passed/i, '정답']
  ];
  const SELECTORS = [
    '[data-testid*="submission"]', '[data-testid*="judge"]',
    '[data-testid*="verdict"]', '[data-testid*="result"]',
    '[data-slot*="submission"]', '[data-slot*="judge"]',
    '[class*="submission-result"]', '[class*="submission-status"]',
    '[class*="judge-result"]', '[class*="judge-status"]',
    '[class*="verdict"]', '[class*="result-status"]',
    '[role="alert"]', '[role="status"]', '[role="dialog"]',
    'table tbody tr', 'dialog'
  ].join(',');
  const KINDS = VERDICTS.filter(x => x[0] !== 'accepted');
  const LIMIT = 180000;
  const normalizeMode = raw => MODES.includes(raw) ? raw : 'suggest';
  const normalizeVerdict = raw => KINDS.find(x => x[0] === raw)?.[0] || null;
  const plain = (value, max=1200) => String(value || '').replace(/\r\n?/g, '\n').trim().slice(0, max);

  function classifyVerdict(value) {
    const source = plain(value, 1600);
    if (!source || /테스트\s*케이스\s*\d+|테스트\s*결과/i.test(source)) return null;
    const found = VERDICTS.filter(x => x[1].test(source));
    if (found.length !== 1) return null;
    return { kind: found[0][0], label: found[0][2] };
  }
  function extractVerdict(doc=scope.document) {
    if (!doc?.querySelectorAll) return null;
    const options = [];
    for (const node of [...doc.querySelectorAll(SELECTORS)].slice(0, 180)) {
      if (node.closest?.('#onco-test-feedback-panel, #onco-submission-feedback-panel, .ql-editor, .monaco-editor, nav, header, [contenteditable="true"]')) continue;
      if (node.closest?.('[hidden], [aria-hidden="true"]')) continue;
      const raw = plain(node.innerText || node.textContent);
      if (!raw || raw.length > 1050) continue;
      const verdict = classifyVerdict(raw);
      if (!verdict) continue;
      const semantic = String(node.className?.baseVal || node.className || '') + ' ' +
        String(node.getAttribute?.('data-testid') || '') + ' ' +
        String(node.getAttribute?.('data-slot') || '');
      const context = /제출|채점|점수|submission|judg|verdict|result/i.test(semantic + ' ' + raw);
      const uniqueFailure = /오답|틀렸습니다|wrong\s*answer|time\s*limit|memory\s*limit|runtime\s*error|컴파일|런타임|초과/i.test(raw);
      if (!context && !uniqueFailure) continue;
      if (verdict.kind === 'accepted' && !context) continue;
      const score = (context ? 3 : 0) +
        (/제출\s*결과|채점\s*결과|verdict|submission/i.test(semantic + ' ' + raw) ? 3 : 0) -
        Math.floor(raw.length / 360);
      options.push({ ...verdict, detail: raw.slice(0, 800),
        signature: verdict.kind + ':' + raw.slice(0, 300), score });
    }
    if (!options.length) return null;
    options.sort((a,b) => b.score - a.score);
    if (options.length > 1 && options[0].score === options[1].score &&
        options[0].kind !== options[1].kind) return null;
    const { kind, label, detail, signature } = options[0];
    return { kind, label, detail, signature };
  }
  function problem(doc=scope.document) {
    const context = scope.OnCoProblemContext?.detect(doc);
    if (!context) return null;
    const title = plain(scope.OnCoProblemContext.text(context.title).replace(/📋\s*문제 복사/g,''),200);
    const description = plain(scope.OnCoProblemContext.text(context.description),30000);
    let language = 'Python 3';
    const sel = doc.querySelector('select');
    if (sel) language = plain(sel.selectedOptions?.[0]?.textContent || 'Python 3',100);
    const identity = scope.OnCoTestFeedback?.fingerprint({ title, description });
    return identity ? { title, description, language, identity } : null;
  }
  const api = { classifyVerdict, extractVerdict, normalizeMode, normalizeVerdict };
  scope.OnCoSubmissionFeedback = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!scope.document || !scope.chrome?.runtime?.sendMessage || !scope.MutationObserver) return;

  const doc = scope.document;
  let mode = 'suggest', historyEnabled = true, precheckEnabled = true;
  let active = null, nextId = 0, settling = null, fallback = null;
  const freshId = () => 'submit-' + Date.now() + '-' + (++nextId);
  function request(action, args={}) {
    return new Promise((resolve,reject) => {
      scope.chrome.runtime.sendMessage({ action, ...args }, answer => {
        const error = scope.chrome.runtime.lastError;
        if (error) return reject(Error(error.message || '확장 연결 오류'));
        if (!answer?.success) return reject(Error(answer?.error || '요청에 실패했습니다.'));
        resolve(answer);
      });
    });
  }
  function readMainWorldCode() {
    const nonce = Date.now() + '-' + (++nextId);
    let captured = null;
    const listener = event => {
      try {
        const answer = JSON.parse(event.detail);
        if (answer.nonce === nonce && typeof answer.code === 'string') captured = answer.code;
      } catch (_) { /* untrusted page event */ }
    };
    scope.addEventListener('onco-solver-editor-response-v1', listener);
    try { scope.dispatchEvent(new CustomEvent('onco-solver-read-editor-v1',{detail:nonce})); }
    finally { scope.removeEventListener('onco-solver-editor-response-v1',listener); }
    return captured && captured.length <= LIMIT ? captured : null;
  }
  function stopTimers() {
    if (settling) clearTimeout(settling);
    if (fallback) clearTimeout(fallback);
    settling = fallback = null;
  }
  function addButton(target,label,fn) {
    const b=doc.createElement('button'); b.type='button'; b.textContent=label;
    Object.assign(b.style,{padding:'7px 9px',margin:'3px',color:'#f5f8ff',background:'#315980',
      border:'1px solid #6685aa',borderRadius:'6px',cursor:'pointer'});
    b.addEventListener('click',()=>Promise.resolve().then(fn).catch(e=>panel('오류',e.message)));
    target.appendChild(b);
  }
  function panel(title,description,answer=null,manual=false) {
    let root=doc.getElementById('onco-submission-feedback-panel');
    if(!root) {
      root=doc.createElement('section');root.id='onco-submission-feedback-panel';
      root.setAttribute('role','region');root.setAttribute('aria-label','OnCo 제출 결과 분석');
      Object.assign(root.style,{position:'fixed',right:'16px',bottom:'16px',zIndex:'2147483646',
        background:'#111b2d',color:'#eff5ff',width:'min(470px,calc(100vw - 32px))',
        maxHeight:'68vh',overflow:'auto',border:'1px solid #6685aa',
        borderRadius:'10px',padding:'14px',boxShadow:'0 6px 30px #0009',
        fontFamily:'system-ui,sans-serif',fontSize:'13px'});
      doc.body.appendChild(root);
    }
    root.replaceChildren();
    const heading=doc.createElement('strong');heading.textContent='OnCo AI · '+title;
    const p=doc.createElement('p');p.textContent=plain(description,1000);
    Object.assign(p.style,{whiteSpace:'pre-wrap',lineHeight:'1.5'});
    root.append(heading,p);
    if (answer?.code) {
      const pre=doc.createElement('pre');pre.textContent=answer.code;
      Object.assign(pre.style,{maxHeight:'220px',overflow:'auto',padding:'8px',
        background:'#081321',whiteSpace:'pre',fontSize:'11px'});
      root.appendChild(pre);
      if (!answer.applied) addButton(root,'수정 코드 적용',async()=>{
        let r;
        if(answer.precheck){
          r=await request('APPLY_TEST_REVISION',{identity:answer.precheck.identity,
            expectedCode:answer.precheck.original,code:answer.code});
        }else{
          if(!active || active.id!==answer.id) throw Error('이전 제출 기록이 만료됐습니다.');
          r=await request('APPLY_SUBMISSION_REVISION',{id:answer.id,code:answer.code});
        }
        if(!r.applied)throw Error('수정 코드 적용이 확인되지 않았습니다.');
        panel('코드 적용 완료','공개 테스트를 다시 실행한 후 직접 제출해주세요.');
      });
      addButton(root,'코드 복사',async()=>{
        await scope.navigator.clipboard.writeText(answer.code);
        panel('복사 완료','수정 코드를 클립보드에 복사했습니다.');
      });
      if(answer.notice) {
        const notice=doc.createElement('p');notice.textContent=answer.notice;
        root.appendChild(notice);
      }
    }
    if(manual && active && !active.working) {
      const wrap=doc.createElement('div');root.appendChild(wrap);
      for(const [kind,,label] of KINDS) addButton(wrap,label,()=>analyze({kind,label,detail:'사용자가 채점 결과에서 '+label+'을 확인했습니다.'},true));
    }
    if (active?.working) addButton(root,'분석 중지',()=>{
      const id=active.id;active.working=false;
      request('CANCEL_TEST_REVISION',{requestId:id}).catch(()=>{});
      panel('분석 중지','AI 분석을 중단했습니다. 제출은 다시 실행되지 않습니다.',null,true);
    });
    addButton(root,'닫기',()=>root.remove());
  }
  function scheduleManual(s) {
    if(fallback)clearTimeout(fallback);
    fallback=setTimeout(()=>{
      if(active===s&&!s.working&&!s.finished)panel('채점 결과 확인','채점 결과를 자동으로 판독하지 못했습니다. 아래에서 화면에 표시된 실패 유형을 선택하세요.',null,true);
    },12000);
  }
  async function captureSubmission(p,code) {
    const id=freshId();
    const baseline=extractVerdict(doc)?.signature || '';
    const originPath=scope.location?.pathname || '';
    const snap={id,...p,code,baseline,originPath};
    const stored=await request('CAPTURE_SUBMISSION',{snapshot:snap,historyEnabled});
    active={id,baseline,originPath,identity:p.identity,working:false,finished:false,
      processed:'',seenReset:false};
    scheduleManual(active);
    inspect();
    return stored;
  }
  async function onSubmitClick() {
    const p=problem();
    if(!p || mode==='off') return;
    const code=readMainWorldCode();
    if(code) return captureSubmission(p,code);
    // Fallback for older Chrome/Whale versions without a MAIN-world content script.
    const result=await request('GET_MONACO_CODE');
    if(typeof result.code!=='string'||!result.code.trim())throw Error('제출 당시 코드를 확보하지 못했습니다.');
    return captureSubmission(p,result.code);
  }
  async function runPrecheck() {
    const p=problem();
    if(!p)throw Error('실제 문제 화면에서만 제출 전 점검을 할 수 있습니다.');
    let code=readMainWorldCode();
    if(!code) code=(await request('GET_MONACO_CODE')).code;
    if(typeof code!=='string'||!code.trim())throw Error('편집기의 코드를 확인하지 못했습니다.');
    panel('제출 전 경계 조건 점검','사용자가 요청한 AI 점검입니다. 실제 채점이나 제출은 실행하지 않습니다.');
    const result=await request('REVIEW_BEFORE_SUBMIT',{
      requestId:'precheck-'+Date.now()+'-'+(++nextId),problem:p,code
    });
    if(result.unchanged){
      panel('점검 결과','AI가 코드 변경을 제안하지 않았습니다. 실제 비공개 채점 통과를 보장하지는 않습니다.');
    }else{
      panel('제출 전 수정안','경계값 또는 성능에 관한 코드 수정 후보입니다. 확인 후 적용할 수 있습니다.',
        {code:result.code,precheck:{identity:p.identity,original:code},applied:false});
    }
  }
  function refreshPrecheckButton(){
    const old=doc.getElementById('onco-pre-submit-review');
    if(!precheckEnabled){old?.remove();return;}
    const target=[...doc.querySelectorAll('button')].find(btn=>
      plain(btn.getAttribute('aria-label'),60)==='제출'||
      plain(btn.innerText || btn.textContent,70)==='제출');
    if(!target || !problem()){old?.remove();return;}
    if(old?.nextElementSibling===target)return;
    old?.remove();
    const btn=doc.createElement('button');
    btn.type='button';btn.id='onco-pre-submit-review';btn.textContent='제출 전 AI 점검';
    Object.assign(btn.style,{background:'#315980',color:'#f7faff',
      border:'1px solid #6685aa',borderRadius:'6px',
      padding:'6px 10px',cursor:'pointer',marginRight:'7px'});
    btn.addEventListener('click',event=>{
      if(!event.isTrusted)return;
      runPrecheck().catch(e=>panel('제출 전 점검 오류',e.message));
    });
    target.before(btn);
  }
  let precheckScheduled=false;
  function schedulePrecheck(){
    if(precheckScheduled)return;
    precheckScheduled=true;
    setTimeout(()=>{precheckScheduled=false;refreshPrecheckButton();},250);
  }

  function isSubmitButton(event) {
    const btn=event.target?.closest?.('button,[role="button"]');
    if(!btn || btn.disabled || btn.getAttribute?.('aria-disabled')==='true')return false;
    const aria=plain(btn.getAttribute?.('aria-label'),60);
    const label=plain(btn.innerText || btn.textContent,70);
    return aria==='제출' || label==='제출';
  }
  doc.addEventListener('click',event=>{
    if(!event.isTrusted || !isSubmitButton(event))return;
    // Do not cancel/prevent/replay the site's genuine user click.
    onSubmitClick().catch(e=>panel('제출 기록 오류',e.message));
  },true);

  async function analyze(verdict,manual=false) {
    const s=active;
    if(!s||s.working||s.finished||mode==='off')return;
    const kind=normalizeVerdict(verdict.kind);
    if(!kind)return;
    stopTimers();s.working=true;
    panel('제출 실패 분석 중',verdict.label+' · 제출 당시 코드와 문제 조건을 분석하고 있습니다.');
    try {
      const result=await request('REVISE_SUBMISSION_FAILURE',{
        id:s.id,requestId:s.id,verdict:kind,
        detail:plain(verdict.detail,900),manual,historyEnabled
      });
      if(active!==s || !s.working)return;
      s.working=false;s.finished=true;
      const status=result.applied?'코드 수정 완료':'수정 코드 제안';
      panel(status,result.applied?
        '코드를 교체했습니다. 공개 테스트를 확인한 뒤 직접 다시 제출해주세요.':
        '제출 당시 코드를 보존했습니다. 수정안을 검토하고 공개 테스트를 다시 실행해주세요.',
        {code:result.code,applied:result.applied,id:s.id,notice:result.notice});
    }catch(e){
      if(active===s){s.working=false;panel('제출 분석 오류',e.message,null,true);}
    }
  }
  function accept(s) {
    if(active!==s)return;
    s.finished=true;stopTimers();
    request('CLEAR_SUBMISSION_SNAPSHOT',{id:s.id}).catch(()=>{});
    panel('채점 통과','제출 결과에서 정답이 확인됐습니다. 추가 수정은 하지 않습니다.');
  }
  function inspect() {
    const s=active;
    if(!s || s.working || s.finished || mode==='off')return;
    const verdict=extractVerdict(doc);
    if(!verdict)return;
    if(verdict.signature===s.baseline && !s.seenReset &&
       scope.location?.pathname===s.originPath)return;
    if(s.processed===verdict.signature)return;
    if(settling)clearTimeout(settling);
    settling=setTimeout(()=>{
      if(active!==s||s.working||s.finished)return;
      const latest=extractVerdict(doc);
      if(!latest||latest.signature!==verdict.signature)return;
      s.processed=verdict.signature;
      if(latest.kind==='accepted')accept(s);
      else analyze(latest).catch(e=>panel('분석 오류',e.message));
    },650);
  }
  async function resume() {
    try {
      const answer=await request('GET_PENDING_SUBMISSION');
      if(!answer.pending || active)return;
      const p=answer.pending;
      active={id:p.id,baseline:p.baseline||'',originPath:p.originPath||'',
        identity:p.identity,working:false,finished:Boolean(p.candidate),processed:'',seenReset:false};
      if(typeof p.candidate==='string'&&p.candidate){
        panel('이전 제출 수정안','이전 제출 실패 분석에서 생성한 코드입니다. 현재 문제를 확인하고 적용하거나 복사하세요.',
          {code:p.candidate,applied:false,id:p.id});
      }else{
        scheduleManual(active);
        inspect();
      }
    }catch(_){ /* no submission in this tab */ }
  }
  const observer=new scope.MutationObserver(records=>{
    // The pre-submit button must also follow SPA problem loading without any pending submission.
    schedulePrecheck();
    if(!active)return;
    if(records.length && records.every(x=>x.target?.closest?.('#onco-submission-feedback-panel')))return;
    if(records.some(r=>[...(r.removedNodes||[])].some(node=>
      node.matches?.(SELECTORS)||node.querySelector?.(SELECTORS))))active.seenReset=true;
    inspect();
  });
  observer.observe(doc.documentElement,{childList:true,subtree:true,characterData:true,
    attributes:true,attributeFilter:['aria-busy','data-state']});
  scope.chrome.storage.local.get(['onco_submit_mode','onco_submit_history','onco_submit_precheck'],state=>{
    mode=normalizeMode(state.onco_submit_mode);
    historyEnabled=state.onco_submit_history!==false;
    precheckEnabled=state.onco_submit_precheck!==false;
    schedulePrecheck();
    if(mode!=='off')resume();
  });
  scope.chrome.storage.onChanged?.addListener((changes,area)=>{
    if(area!=='local')return;
    if(changes.onco_submit_mode){
      mode=normalizeMode(changes.onco_submit_mode.newValue);
      if(mode==='off'){
        const prior=active;stopTimers();active=null;
        if(prior?.working)request('CANCEL_TEST_REVISION',{requestId:prior.id}).catch(()=>{});
        if(prior?.id)request('CLEAR_SUBMISSION_SNAPSHOT',{id:prior.id}).catch(()=>{});
      }
      else if(!active)resume();
    }
    if(changes.onco_submit_history)historyEnabled=changes.onco_submit_history.newValue!==false;
    if(changes.onco_submit_precheck){
      precheckEnabled=changes.onco_submit_precheck.newValue!==false;
      schedulePrecheck();
    }
  });
  scope.addEventListener?.('pagehide',stopTimers);
})(globalThis);
