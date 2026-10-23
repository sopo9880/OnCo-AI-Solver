# 🚀 OnCo AI Solver 아키텍처 설계서

## 1. 프로젝트 개요
* **목적:** 웹 기반 코딩 테스트 플랫폼(OnCo)의 문제를 LLM(Gemini)을 활용해 자동으로 분석하고, Monaco 에디터에 정답 코드를 직접 주입하는 브라우저 확장 프로그램.
* **핵심 기술:** Chrome Extension (Manifest V3), DOM Scraping, Gemini API (REST), Monaco Editor API 연동 및 컨텍스트 주입.
* **보안 목표:** 사용자의 API Key를 하드코딩하지 않고 Chrome 확장 전용 로컬 스토리지에 저장하여 관리.

## 2. 시스템 아키텍처 (System Flow)

1. **Popup UI:** 사용자로부터 Gemini API 키를 입력받아 `chrome.storage.local`에 저장.
2. **Content Script (`content.js`):** OnCo 웹 페이지의 DOM에 접근하여 문제 제목과 설명 텍스트를 스크래핑.
3. **Background Worker (`background.js`):** * `chrome.storage`에서 API 키 로드.
    * Content Script로부터 받은 문제 데이터를 조합해 프롬프트 생성.
    * Gemini API로 네트워크 요청(`fetch`) 및 응답 파싱.
4. **Context Injector:** API로부터 반환받은 코드를 브라우저의 `MAIN` 환경으로 주입하여, `window.monaco` 객체를 통해 에디터에 직접 코드 삽입 (복사/붙여넣기 방지 우회).

## 3. 핵심 모듈 상세 명세

### A. Manifest 설정 (`manifest.json`)
* **Version:** 3
* **Permissions:** * `activeTab`: 현재 실행 중인 탭 접근
  * `scripting`: 메인 컨텍스트에 스크립트 주입 (`world: "MAIN"`)
  * `storage`: API 키 로컬 저장
* **Host Permissions:** `*://*.on-co.net/*`, `https://generativelanguage.googleapis.com/*`

### B. 사용자 인터페이스 (`popup.html` & `popup.js`)
* **역할:** API 키 입력 및 저장, Gemini API 모델 목록 자동 동기화, '문제 풀기' 트리거 버튼 제공.
* **동작:**
  * 로드 시 기존에 저장된 API 키가 있으면 Input 필드에 마스킹 처리하여 표시.
  * 저장 버튼 클릭 시 `chrome.storage.local.set` 호출. 키 문자열 형식은 하드코딩 검증하지 않음.
  * 팝업 로드 시 `models.list`를 통해 `generateContent` 지원 모델을 동적으로 조회하며, 1시간 캐시와 수동 새로고침을 지원.
  * `자동 최신 Flash` 선택 시 `gemini-flash-latest` 별칭을 우선 사용하고, 별칭이 없으면 최신 일반 Flash 모델을 자동 선택.
  * 실행 버튼 클릭 시 Background Worker로 Action 메시지 전송.

### C. 데이터 추출기 (`content.js`)
* **역할:** 웹 페이지의 HTML 구조를 분석해 필요한 텍스트만 정제.
* **동작:** * `document.querySelector`를 이용해 문제 렌더링 영역(`.ql-editor` 등) 특정.
  * 불필요한 HTML 태그를 제거하고 순수 텍스트(문제 설명, 제약 조건 등) 추출 후 Background로 반환.

### D. 오케스트레이터 및 API 통신 (`background.js`)
* **역할:** 확장 프로그램의 두뇌 역할, 각 모듈 간의 메시징 중계 및 외부 API 통신.
* **동작:**
  * 프롬프트 엔지니어링: *"다음 알고리즘 문제를 분석하고 Python 3 기준의 최적화된 정답 코드만 마크다운 없이 반환해."* + [스크래핑 데이터]
  * Gemini REST API `v1beta/models` / `models.generateContent` 연동. 인증은 `x-goog-api-key` 헤더 사용.
  * 종료된 모델이 선택된 경우 모델 목록을 강제 갱신하고 최신 Flash로 1회 자동 폴백.
  * Gemini API 에러(Rate Limit, Invalid Key, Model Not Found 등) 핸들링.
  * `chrome.scripting.executeScript`를 호출하여 최종 코드를 DOM에 주입.

## 4. 보안 및 예외 처리 (Exception Handling)
* **API Key 보안:** 소스코드 내 하드코딩 엄격히 금지. 확장이 삭제되거나 캐시가 초기화될 때 키 데이터가 안전하게 파기되도록 `chrome.storage.local` 활용.
* **에디터 로드 지연:** 네트워크 상태에 따라 Monaco 에디터가 늦게 렌더링될 수 있으므로, 인젝션 스크립트 실행 전 `window.monaco` 객체의 존재 여부를 폴링(Polling) 방식으로 확인.
* **API 응답 검증:** Gemini가 코드 외의 설명(예: "네, 작성해 드릴게요.")을 덧붙이지 않도록 시스템 프롬프트를 강하게 통제하고, 정규식을 통해 응답값에서 코드 블록만 한 번 더 필터링.

## 5. Gemini API 호환성 전략 (v1.1.0)
* 모델 이름을 HTML/JavaScript에 고정하지 않고 Gemini API `models.list` 응답을 소스로 사용.
* `supportedGenerationMethods`에 `generateContent`가 포함된 Gemini/Gemma 모델만 목록에 표시.
* API 키 접두사/길이 정규식을 제거해 향후 auth key 포맷 변경에 대응.
* 생성 요청 URL에는 모델 ID만 정규화해 사용하고, 인증 키는 URL query가 아닌 `x-goog-api-key` 헤더로 전달.
* 모델 삭제/지원 종료로 404가 발생하면 최신 모델 목록을 다시 받고 `자동 최신 Flash`로 한 번 재시도.


## 6. Gemini + OpenAI + ChatGPT 계정 로그인 (v1.2.0)

* **AI 서비스 선택:** 기존 Gemini/Gemma API 키 + OpenAI GPT API 키 + ChatGPT OAuth 계정 로그인.
* **모델 목록:** Gemini `models.list` 지원 메서드 필터 / OpenAI API `GET /v1/models` 텍스트 GPT 필터 / ChatGPT OAuth 계정별 `GET /v1/models`의 `visibility=list` 모델.
* **요청:** Gemini `generateContent`, OpenAI API `POST /v1/responses`, ChatGPT 플랜 인증은 별도 로컬 도우미에서 OAuth Bearer를 이용한 `POST /v1/responses` 호출.
* **정식 로그인:** `chatgpt_bridge/bridge.mjs` (Node 22 이상), 공식 OpenAI 인증 페이지, PKCE S256, nonce/state/ID token 서명 검증, 127.0.0.1 콜백, 사용자 플랜 사용량 동의.
* **ChatGPT 플랜 미리보기 호환:** `input` 배열, `store:false`, `stream:true`, 승인된 사용자 모델만, `response.completed`까지 수신. 제한된 `max_output_tokens` 파라미터는 보내지 않음.
* **보안:** OpenAI OAuth 토큰은 도우미 메모리에서만 보관. 브라우저 확장은 임의의 도우미 토큰이 아닌 12자리 연결 코드를 통해 보호된 로컬 브리지에 연결. `chrome.storage.local`은 `TRUSTED_CONTEXTS`로 제한, 화면 로그는 `textContent` 사용.
* **정책:** ChatGPT와 OpenAI API 키는 독립 과금/접근 제어 체계. 계정 로그인 후 플랜 사용 허용이 없으면 ChatGPT 플랜을 이용한 생성은 불가능.
* **검증:** 정적 검사/모의 통합 테스트 완료, 개인 계정 로그인 및 실제 API 응답은 미검증.