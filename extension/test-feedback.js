/* OnCo Test Feedback 1.3.6: DOM-only, opt-in repair; never submits answers.
 * This is an isolated-world MV3 content script. No inline scripts are used.
 */
((scope) => {
  'use strict';
  const MODES=['off','assist','replace','auto'];
  const CASE_LIMIT=12, FIELD_LIMIT=3500, WAIT_MS=80000, QUIET_MS=1000;
  const text=(el,max=FIELD_LIMIT)=>String(el?.textContent||'').replace(/\r\n?/g,'\n').trim().slice(0,max);
  function fingerprint(data){
    const title=String(data?.title||'').replace(/📋\s*문제 복사/g,'').trim();
    const desc=String(data?.description||'').trim();
    const raw=title+'\n'+desc;
    let n=2166136261;
    for(let i=0;i<raw.length;i++){n^=raw.charCodeAt(i);n=Math.imul(n,16777619);}
    return title.slice(0,120)+'|'+desc.length+'|'+(n>>>0).toString(16);
  }
  function currentProblem(doc=scope.document){
    const context=scope.OnCoProblemContext?.detect(doc);
    if(!context)return null;
    const title=scope.OnCoProblemContext.text(context.title).replace(/📋\s*문제 복사/g,'').trim();
    const description=scope.OnCoProblemContext.text(context.description);
    return {title,description,identity:fingerprint({title,description})};
  }
  function collectCases(doc=scope.document){
    const items=[...doc.querySelectorAll('[data-slot="accordion-item"]')].slice(0,CASE_LIMIT);
    const cases=[];
    for(const node of items){
      const trigger=node.querySelector('[data-slot="accordion-trigger"]');
      if(!trigger)continue;
      const label=text(trigger,230);
      const name=label.match(/테스트\s*케이스\s*\d+/)?.[0]||'';
      if(!name)continue;
      const stateText=label.slice(label.indexOf(name)+name.length);
      const status=/실패|오류|시간\s*초과|메모리\s*초과|런타임|컴파일/i.test(stateText)?'fail':
        /성공|통과|정답/i.test(stateText)?'pass':'unknown';
      const c={name,status,input:'',expected:'',actual:'',detail:'',
        expanded:node.getAttribute('data-state')==='open'};
      for(const dt of node.querySelectorAll('dt')){
        const title=text(dt,70).replace(/\s/g,'');
        const dd=dt.nextElementSibling;
        if(dd?.tagName?.toLowerCase()!=='dd')continue;
        if(title.startsWith('입력값'))c.input=text(dd);
        else if(title.startsWith('예상출력'))c.expected=text(dd);
        else if(title.startsWith('실제출력'))c.actual=text(dd);
        else if(/오류|에러|컴파일|런타임|시간초과/.test(title))
          c.detail=(c.detail+'\n'+text(dd,650)).trim().slice(0,650);
      }
      if(c.expanded){
        const content=node.querySelector('[data-slot="accordion-content"]');
        const note=content?[...content.querySelectorAll('p,pre,[role="alert"]')].map(x=>text(x,300))
          .filter(x=>/실패|오류|에러|컴파일|런타임|초과|error|exception/i.test(x)).join('\n'):'';
        c.detail=(c.detail+'\n'+note).trim().slice(0,650);
      }
      cases.push(c);
    }
    return cases;
  }
  function summarize(doc=scope.document){
    const cases=collectCases(doc);
    return {cases,failed:cases.filter(c=>c.status==='fail'),
      complete:cases.length>0 && cases.every(c=>c.status!=='unknown'),
      signature:JSON.stringify(cases.map(c=>[c.name,c.status,c.input,c.expected,c.actual,c.detail]))};
  }
  const normalizeMode=value=>MODES.includes(value)?value:'assist';
  const normalizeRetries=value=>Number.isInteger(value)?Math.max(1,Math.min(5,value)):3;
  const api={fingerprint,currentProblem,collectCases,summarize,normalizeMode,normalizeRetries};
  scope.OnCoTestFeedback=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(!scope.document||!scope.chrome?.runtime?.sendMessage||!scope.MutationObserver)return;

  const doc=scope.document;
  let settings={mode:'assist',maxRetries:3};
  let active=null,sequence=0,quietTimer=null,watchdog=null,armedRetry=false;

  function request(action,extra={}){
    return new Promise((resolve,reject)=>{
      scope.chrome.runtime.sendMessage({action,...extra},answer=>{
        const error=scope.chrome.runtime.lastError;
        if(error)return reject(Error(error.message||'확장 연결이 끊어졌습니다.'));
        if(!answer?.success)return reject(Error(answer?.error||'요청을 처리하지 못했습니다.'));
        resolve(answer);
      });
    });
  }
  function readSettings(){
    scope.chrome.storage.local.get(['onco_test_mode','onco_test_max_retries'],data=>{
      settings={mode:normalizeMode(data?.onco_test_mode),
        maxRetries:normalizeRetries(data?.onco_test_max_retries)};
      if(settings.mode==='off')stop('',true);
    });
  }
  readSettings();
  scope.chrome.storage.onChanged?.addListener((changes,area)=>{
    if(area==='local'&&(changes.onco_test_mode||changes.onco_test_max_retries))readSettings();
  });
  function clearTimers(){
    if(quietTimer){clearTimeout(quietTimer);quietTimer=null;}
    if(watchdog){clearTimeout(watchdog);watchdog=null;}
  }
  function stop(message='',silent=false){
    clearTimers();
    const prior=active;active=null;
    if(prior?.working)request('CANCEL_TEST_REVISION',{requestId:prior.requestId}).catch(()=>{});
    if(!silent&&message)render('중지',message);
  }
  function addButton(root,label,callback){
    const b=doc.createElement('button');b.type='button';b.textContent=label;
    Object.assign(b.style,{background:'#29517e',color:'white',border:'none',borderRadius:'5px',
      margin:'3px 5px 0 0',padding:'7px 10px',cursor:'pointer'});
    b.addEventListener('click',()=>Promise.resolve().then(callback).catch(e=>render('오류',e.message)));
    root.appendChild(b);return b;
  }
  function render(heading,info,candidate=null,allowStop=false){
    let box=doc.getElementById('onco-test-feedback-panel');
    if(!box){
      box=doc.createElement('section');box.id='onco-test-feedback-panel';
      box.setAttribute('role','status');box.setAttribute('aria-live','polite');
      Object.assign(box.style,{position:'fixed',bottom:'16px',right:'16px',zIndex:'2147483646',
        width:'min(460px,calc(100vw - 32px))',maxHeight:'65vh',overflow:'auto',
        border:'1px solid #58769d',borderRadius:'11px',padding:'14px',
        background:'#111b2d',color:'#edf3ff',boxShadow:'0 6px 30px #0009',
        fontFamily:'system-ui,sans-serif',fontSize:'13px'});
      doc.body.appendChild(box);
    }
    box.replaceChildren();
    const strong=doc.createElement('strong');strong.textContent='OnCo AI · '+heading;
    const p=doc.createElement('p');p.textContent=String(info||'').slice(0,600);
    Object.assign(p.style,{whiteSpace:'pre-wrap',margin:'8px 0',lineHeight:'1.45'});
    box.append(strong,p);
    if(candidate){
      const pre=doc.createElement('pre');pre.textContent=candidate.code;
      Object.assign(pre.style,{maxHeight:'210px',overflow:'auto',whiteSpace:'pre',
        background:'#0a1222',borderRadius:'5px',padding:'10px',fontSize:'11px'});
      box.appendChild(pre);
      addButton(box,'수정 코드 적용',async()=>{
        if(active?.requestId!==candidate.requestId)throw Error('다른 테스트가 시작되어 적용을 중단했습니다.');
        const res=await request('APPLY_TEST_REVISION',{requestId:candidate.requestId,
          identity:active.identity,expectedCode:candidate.original,code:candidate.code});
        if(!res.applied)throw Error('코드 적용이 확인되지 않았습니다.');
        active.history.push(candidate.original);
        active.history=active.history.slice(-6);
        active.currentCode=candidate.code;
        render('코드 적용 완료','테스트는 직접 실행해주세요. 이전 코드는 복원할 수 있습니다.');
      });
      addButton(box,'코드 복사',async()=>{
        try{await scope.navigator.clipboard.writeText(candidate.code);
          render('복사 완료','수정 코드를 클립보드에 복사했습니다.');}
        catch(_){render('복사 실패','클립보드 접근이 제한됐습니다. 아래 코드에서 직접 복사해주세요.',candidate);}
      });
    }else if(active?.history.length&&!allowStop){
      addButton(box,'이전 코드 복원',async()=>{
        const previous=active.history.at(-1);
        const res=await request('APPLY_TEST_REVISION',{requestId:active.requestId,
          identity:active.identity,expectedCode:active.currentCode,code:previous});
        if(!res.applied)throw Error('이전 코드 복원 실패');
        active.history.pop();active.currentCode=previous;
        render('이전 코드 복원','이전 코드가 복원됐습니다.');
      });
    }
    if(allowStop)addButton(box,'자동 수정 중지',()=>stop('추가 자동 수정을 중지했습니다.'));
    addButton(box,'닫기',()=>box.remove());
  }
  function changed(session){
    const now=currentProblem();
    return !now||now.identity!==session.identity||scope.location.pathname!==session.pathname;
  }
  async function captureCode(session){
    try{
      const result=await request('GET_MONACO_CODE');
      if(active===session)session.currentCode=result.code;
    }catch(e){
      if(active===session){stop('',true);render('코드 확인 실패',e.message);}
    }
  }
  function testClicked(retry=false){
    const p=currentProblem();
    if(!p||settings.mode==='off')return;
    if(active?.working&&!retry)stop('',true);
    const last=active;
    const sameProblem=Boolean(last?.identity===p.identity);
    const reuse=retry&&sameProblem;
    clearTimers();
    const s={requestId:String(Date.now())+'-'+(++sequence),identity:p.identity,
      pathname:scope.location.pathname,baseline:summarize(),sawTransition:false,sawReset:false,
      currentCode:reuse?last.currentCode:null,attempt:reuse?last.attempt:0,
      history:sameProblem?last.history:[],working:false,ready:null};
    active=s;
    s.ready=reuse?Promise.resolve():captureCode(s);
    if(retry)render('자동 재테스트','수정 '+s.attempt+'/'+settings.maxRetries+'회 · 새 테스트 결과 확인 중',null,true);
    watchdog=setTimeout(()=>{if(active===s&&!s.working){stop('',true);
      render('테스트 결과 시간 초과','새로운 테스트 완료 결과를 확인하지 못했습니다. 직접 다시 테스트해주세요.');}},80000);
  }
  doc.addEventListener('click',event=>{
    const target=event.target?.closest?.('button[aria-label="테스트"]');
    if(!target||target.disabled)return;
    if(!event.isTrusted&&!armedRetry)return;
    const retry=armedRetry;armedRetry=false;
    testClicked(retry);
  },true);

  async function expandFailures(s){
    const initial=summarize();
    const opened=[];
    for(const c of initial.failed){
      if(c.expanded)continue;
      const node=[...doc.querySelectorAll('[data-slot="accordion-item"]')]
        .find(x=>text(x.querySelector('[data-slot="accordion-trigger"]'),190).match(/테스트\s*케이스\s*\d+/)?.[0]===c.name);
      if(node?.getAttribute('data-state')==='closed'){
        node.querySelector('[data-slot="accordion-trigger"]')?.click();opened.push(c.name);
      }
    }
    if(opened.length)await new Promise(ok=>setTimeout(ok,260));
    const detailed=summarize().failed;
    for(const name of opened){
      const node=[...doc.querySelectorAll('[data-slot="accordion-item"]')]
        .find(x=>text(x.querySelector('[data-slot="accordion-trigger"]'),190).match(/테스트\s*케이스\s*\d+/)?.[0]===name);
      if(node?.getAttribute('data-state')==='open')node.querySelector('[data-slot="accordion-trigger"]')?.click();
    }
    if(active!==s)throw Error('테스트가 전환돼 결과 수집을 중단했습니다.');
    return detailed;
  }
  function mismatchSummary(failures){
    const lines=[];
    for(const result of failures.slice(0,3)){
      const expected=String(result.expected||'').replace(/\r\n?/g,'\n').split('\n');
      const actual=String(result.actual||'').replace(/\r\n?/g,'\n').split('\n');
      const count=Math.max(expected.length,actual.length);
      let difference=-1;
      for(let i=0;i<count;i++)if(expected[i]!==actual[i]){difference=i;break;}
      if(difference>=0){
        lines.push(result.name+' · '+(difference+1)+'행 불일치: 예상 '+
          String(expected[difference]??'(없음)').slice(0,70)+', 실제 '+
          String(actual[difference]??'(없음)').slice(0,70));
      }else lines.push(result.name+' · '+String(result.detail||'테스트 실패').slice(0,100));
    }
    return lines.join('\n');
  }
  async function completed(s){
    if(active!==s||s.working||changed(s))return;
    const state=summarize();
    if(!state.complete||!s.sawTransition||(state.signature===s.baseline.signature&&!s.sawReset))return;
    clearTimers();s.working=true;
    await s.ready;
    if(active!==s)return;
    if(typeof s.currentCode!=='string'){stop('',true);
      render('코드 확인 실패','테스트 실행 당시 코드를 확보하지 못했습니다.');return;}
    if(!state.failed.length){s.working=false;
      render('테스트 통과',state.cases.length+'개 테스트가 모두 통과했습니다. 자동 수정을 종료합니다.');return;}
    if(settings.mode==='auto'&&s.attempt>=settings.maxRetries){s.working=false;
      render('자동 수정 종료','최대 '+settings.maxRetries+'회까지 수정했지만 실패했습니다.');return;}
    let failures;
    try{failures=await expandFailures(s);}
    catch(e){if(active===s){s.working=false;render('결과 수집 실패',e.message);}return;}
    if(active!==s||changed(s))return;
    render('실패 분석 중',failures.length+'개 실패 케이스를 AI에 전달 중입니다.',null,true);
    try{
      const answer=await request('REVISE_TEST_FAILURE',{requestId:s.requestId,
        identity:s.identity,expectedCode:s.currentCode,attempt:s.attempt,feedback:failures});
      if(active!==s||changed(s))return;
      if(typeof answer.code!=='string'||!answer.code.trim())throw Error('AI가 수정 코드를 생성하지 못했습니다.');
      if(answer.mode==='assist'){
        s.working=false;
        render('수정 코드 제안','기존 코드를 유지했습니다. 수정 코드를 검토한 뒤 적용하세요.\n'+mismatchSummary(failures),
          {code:answer.code,original:s.currentCode,requestId:s.requestId});
        return;
      }
      if(!answer.applied)throw Error('수정 코드를 삽입하지 못했습니다.');
      s.history.push(s.currentCode);s.history=s.history.slice(-6);
      s.currentCode=answer.code;s.attempt++;s.working=false;
      if(answer.mode==='replace'){
        render('코드 자동 수정 완료','수정 '+s.attempt+'회 완료 · 재테스트는 직접 실행해주세요.');
        return;
      }
      if(answer.mode!=='auto')throw Error('지원하지 않는 자동 수정 설정입니다.');
      if(changed(s))return stop('문제가 변경되어 재테스트를 중지했습니다.');
      const button=doc.querySelector('button[aria-label="테스트"]');
      if(!button||button.disabled)return render('재테스트 중단','테스트 버튼이 비활성화됐습니다.');
      armedRetry=true;
      try{button.click();}finally{armedRetry=false;}
    }catch(e){if(active===s){s.working=false;render('AI 수정 실패',e.message);}}
  }
  function inspect(){
    const s=active;
    if(!s||s.working||changed(s))return;
    const now=summarize();
    if(s.baseline.cases.length&&!now.cases.length)s.sawReset=true;
    if(now.signature!==s.baseline.signature||s.sawReset)s.sawTransition=true;
    if(!now.complete||!s.sawTransition||(now.signature===s.baseline.signature&&!s.sawReset))return;
    if(quietTimer)clearTimeout(quietTimer);
    quietTimer=setTimeout(()=>{if(active===s&&!s.working)
      completed(s).catch(e=>{if(active===s){s.working=false;render('오류',e.message);}});},QUIET_MS);
  }
  const observer=new scope.MutationObserver(records=>{
    if(!active)return;
    if(records.length&&records.every(x=>x.target?.closest?.('#onco-test-feedback-panel')))return;
    // React may remove and remount the same results in one render, leaving an
    // identical final text. Treat observed result removal as an actual rerun.
    const removed=records.some(record=>[...(record.removedNodes||[])].some(node=>
      node.matches?.('[data-slot="accordion-item"]')||
      node.querySelector?.('[data-slot="accordion-item"]')));
    if(removed)active.sawReset=true;
    inspect();
  });
  observer.observe(doc.documentElement,{subtree:true,childList:true,characterData:true,
    attributes:true,attributeFilter:['data-state','disabled','aria-busy']});
  scope.addEventListener?.('pagehide',()=>stop('',true));
})(globalThis);
