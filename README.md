# OnCo AI Solver

OnCo 코딩 문제 화면에서 문제 추출, Gemini/OpenAI API 키 기반 AI 풀이, **ChatGPT 계정의 Codex app-server 모델 사용**, 코드 에디터 삽입을 지원하는 비공식 Chrome / Naver Whale 확장입니다.

## Windows 설치 및 업데이트 (v1.3.7)

1. [GitHub Releases](https://github.com/sopo9880/OnCo-AI-Solver/releases)에서 `OnCo_Setup_v1.3.7.exe`를 설치합니다. 이전 버전은 제거하지 않고 **같은 설치 폴더**에 덮어 설치하세요.
2. 설치 안내의 **Chrome / Whale → 새 탭에서 열기**로 `chrome://extensions` 또는 `whale://extensions`를 엽니다. 외부 앱 확인창을 허용해야 할 수 있습니다. 열리지 않으면 **주소 복사**를 사용하세요.
3. 처음 설치하는 경우 개발자 모드를 켜고 **압축 해제된 확장 프로그램 로드**에서 설치 폴더의 `extension`을 선택합니다. 기존 설치라면 기존 확장의 **새로고침(↻)**만 누릅니다. 확장 ID는 바뀌지 않습니다.
4. 확장 팝업의 **AI 서비스 → ChatGPT · Codex 로그인** 또는 기존 **Gemini / OpenAI API 키** 중 하나를 선택합니다.

## v1.3.7 제출 실패 AI 원인 분석

- 문제 화면의 **제출 전 AI 점검** 버튼을 사용하면 제출하지 않고 경계값·성능 취약점을 검토할 수 있습니다. 기본값은 버튼 표시이며 실제 AI 호출은 버튼을 클릭해야 시작됩니다. 팝업에서 표시 여부를 변경할 수 있습니다.
- **직접 제출 클릭** 시 문제 제목·설명·언어·제출 당시 Monaco 코드를 읽어 브라우저 임시 session storage에 보관합니다. 동일 탭 화면 이동 중에도 제출 당시 코드와 현재 코드가 섞이지 않으며 30분 후 만료됩니다. 로그인 토큰이나 비공개 채점 API는 읽지 않습니다.
- 공개된 **제출/채점 결과 화면**에서 오답, 시간/메모리 초과, 런타임/컴파일 오류, 부분 점수 및 정답을 감지합니다. 기존 공개 테스트 결과는 제출 결과로 간주하지 않습니다. 결과 UI는 기기별로 달라질 수 있어 자동 판독 실패 시 **수동 실패 유형 선택**도 지원합니다.
- 기본은 **AI 제안만 표시**입니다. 팝업에서 **제출 실패 시 AI → 자동 코드 적용**을 직접 선택한 경우에도 같은 문제·동일 코드의 편집기가 열린 상태여야 적용합니다. 결과 화면으로 이동해 편집기를 찾지 못하거나 사람이 코드를 바꿨다면 제안만 표시합니다.
- AI는 비공개 채점 입력/정답을 알고 있는 척하지 않고, 문제 조건과 제출 당시 코드로 경계값·시간 및 메모리 복잡도·출력 형식 등 가능한 원인을 분석해 수정 코드 후보를 만듭니다. **재테스트는 기존 v1.3.6 기능으로 진행하고, 재제출은 항상 사용자가 진행합니다.**
- 같은 문제의 과거 실패 종류와 코드 후보는 **현재 브라우저 세션** 내 최근 최대 4건만 보관해 반복 오류 분석에 활용하며 팝업에서 끌 수 있습니다. 영구 업로드·자격증명 수집·자동 제출은 없습니다.
- 제출 결과 화면의 실제 HTML 구조를 확보하지 못했으므로 자동 판독 범위는 시뮬레이션 검증을 통과하더라도 **릴리스 후 Windows Chrome/Whale 실기기에서 확인**해야 합니다.

## v1.3.6 테스트 실패 AI 자동 수정

OnCo에서 **사용자가 직접 테스트 버튼을 누르면** 테스트 결과를 관찰합니다. React 테스트 결과 패널의 공개 결과만 수집하며 **제출 버튼은 자동 클릭하지 않습니다.**

- 기본 설정: **수정 코드 제안만 표시**. 기존 코드를 유지하며, 사용자가 제안 코드를 검토하고 **수정 코드 적용**을 눌러야 바뀝니다.
- 선택 설정: **AI 자동 코드 삽입**(재테스트는 수동) 또는 **자동 수정 및 재테스트**(기본 최대 3회, 1~5회 설정 가능).
- 확장 팝업의 **테스트 실패 시 AI**에서 설정합니다. 저장 키는 `onco_test_mode`와 `onco_test_max_retries`이며, 이전 버전의 사용자 저장 설정과 API 키는 유지합니다.
- OnCo의 **테스트 결과** 영역에서 실패 케이스의 입력값·예상 출력값·실제 출력값을 추출합니다. 접힌 Radix Accordion은 필요 시 펼친 후 원래 상태로 복원합니다.
- 오류가 감지되면 기존 AI 공급자(Gemini / OpenAI API / ChatGPT Codex)와 선택 모델을 그대로 사용해 현재 코드의 수정안을 만듭니다. 기존 모델의 설정·키를 변경하거나 다른 공급자로 자동 과금 전환하지 않습니다.
- 코드 교체 전에 **현재 문제·현재 코드의 일치 여부**를 재검증하고, 사용자가 코드를 바꿨거나 문제를 전환한 경우 덮어쓰지 않습니다. 중지 버튼·최대 횟수·실패 내역·이전 코드 복원 UI가 제공됩니다.
- 결과 화면이 아직 갱신되지 않았거나 실행 완료를 판단할 근거가 없으면 **AI를 자동 호출하지 않습니다.** 테스트 성공은 최종 채점 성공을 보장하지 않습니다. 자동 재테스트와 계정별 동작은 릴리스 후 Windows·Chrome·Whale 실기기 검증이 필요합니다.

## v1.3.5 설치 안내 CSP 수정

- 설치 후 열리는 로컬 `index.html`과 Chrome/Whale 확장 내 `tutorial.html`은 인라인 `<script>` 및 `onclick`을 사용하지 않습니다. 동일한 외부 `tutorial.js`를 로드해 MV3 확장의 `script-src 'self'` 정책을 준수합니다.
- **확장 관리 화면 열기**(Windows `onco-ai-solver://` 딥링크), **Chrome/Whale 주소 복사**, **설치 폴더 경로 복사** 기능은 그대로 유지합니다. `file://` 안내 페이지에서 Clipboard API가 차단되면 대체 복사를 시도하고, 그것도 실패하면 수동 복사를 안내합니다.
- 기존 Setup에 덮어 설치한 뒤 확장 관리 화면에서 기존 OnCo 확장을 **새로고침**하면 됩니다. 확장 ID·설정·Codex 인증 데이터·Gemini/OpenAI 키는 변경하지 않습니다.

## ChatGPT 로그인 — World Studio 방식

v1.3.4부터 OnCo가 직접 `dynamic_agent_client` OAuth URL을 만들거나 OpenAI 토큰을 수집·교환하지 않습니다. 별도로 번들한 **공식 Codex app-server**가 로그인, 토큰 갱신, 인증 상태와 모델 호출을 관리합니다.

- **기기 코드 로그인(기본):** 팝업에서 누르고 일회용 코드를 복사합니다. **공식 로그인 페이지 열기**를 누르고 ChatGPT에서 로그인 후 코드를 입력합니다. 계정 또는 Team/Business 작업공간에서 기기 코드 로그인이 허용되어야 합니다.
- **브라우저 로그인(대안):** 기기 코드 사용이 제한된 경우 클릭하면 Codex가 제공하는 공식 로그인 URL을 Chrome/Whale 새 탭에서 엽니다. Codex에서 로컬 콜백을 수신합니다.
- 로그인 후 확장 팝업으로 돌아와 **모델 목록 새로고침**을 선택합니다. 실제 사용 가능한 모델과 요청 성공 여부는 Codex 계정·작업공간 권한, 사용량에 따라 달라집니다.
- 두 방법 모두 Codex의 `account/login/start`, `account/read`, `model/list`, `thread/start`, `turn/start` 기능을 사용합니다. 단순 로그인 성공을 모델 호출 성공으로 간주하지 않습니다.
- **ChatGPT 계정 구독은 OpenAI API 키 과금과 별개**입니다. 유료 API로 자동 전환하지 않습니다. 기기 코드가 조직 정책상 비활성화돼 있으면 브라우저 로그인을 선택하거나 조직 관리자에게 문의해야 합니다.

## 보안·호환성

- 로그인 도우미는 Chrome / Whale Native Messaging의 지속 연결(`connectNative`)을 통해 Windows에서만 실행됩니다. 항상 실행하는 외부 서버나 영구 개방 TCP 포트는 없습니다.
- Codex 0.163.0 Windows x64 바이너리를 공식 npm 아티팩트에서 CI에 고정 다운로드하고 **Windows 설치 파일에 포함**합니다. 사용자가 별도로 Codex나 Node.js를 설치할 필요가 없습니다.
- Codex는 전용 `%LOCALAPPDATA%\OnCo AI Solver\codex` 홈 디렉터리를 사용하고 Windows 키링으로 인증 정보를 관리합니다. **World Studio의 로그인 파일과 토큰을 읽거나 공유하지 않습니다.**
- 이전 v1.3.0~v1.3.3의 `chatgpt-registration.json`, `chatgpt-session.dpapi`는 **자동 삭제·복호화·수정되지 않습니다.** 새 Codex 인증 방식은 별도의 로그인 동의가 필요합니다. 기존 Gemini/OpenAI API 키 및 브라우저 확장 설정도 그대로 유지합니다.
- 확장에는 로그인 상태, 필요할 때 일회용 로그인 코드, 모델 목록·생성 답변만 전달합니다. Codex 토큰·비밀번호·프로필 이메일은 전달하지 않습니다.
- Codex AI 생성은 `approvalPolicy: never`, `sandbox: read-only`, 도구·셸·웹 검색 비활성화로 제한합니다. Codex가 보내는 명령 실행 요청은 거부합니다. 실제 Windows 로그인과 모델 호출 성공은 **릴리스 후 실기기에서 확인**해야 합니다.
- **수동 구성용:** `OnCo_Runtime_v1.3.7.zip`에는 `OnCoBridge.exe` 및 `bin/codex.exe`가 포함됩니다. 별도 다운로드한 `OnCoBridge.exe`만으로는 Codex가 작동하지 않으니 일반 사용자는 **Setup**을 설치하세요.

## 구성

- `extension`: MV3 확장, 문제 인식/코드 삽입, Gemini / OpenAI API 키, ChatGPT 계정 UI
- `bridge/main.cjs`: Codex app-server stdio JSON-RPC, Chrome/Whale Native Messaging 프레이밍, 로그인·모델·생성 흐름
- `installer`: 사용자별 Windows 설치 및 네이티브 메시징 등록, 안내 페이지
- `tests`: Native Messaging, 인증 상태, 개인정보 필드 차단, 읽기 전용 생성, 기존 데이터 보존, 패키징된 Windows Codex app-server 연결 검증
- `.github/workflows`: PR 경량 검증 → main의 Windows **1회 빌드** → 동일 Artifact 버전·커밋·SHA-256 검증 후 자동 릴리스(재빌드 없음)

## 개발

```sh
node --test tests/*.mjs
node --check bridge/main.cjs
node --check extension/background.js
node --check extension/popup.js
```

Windows CI는 설치용 EXE와 공식 Codex 바이너리를 패키징한 후, **실제 EXE에서 app-server 초기화 및 인증 상태 조회**가 동작하는지 검사합니다. 사용자의 실제 ChatGPT 로그인은 CI에서 시도하지 않습니다. 릴리스 설치 프로그램은 코드 서명 인증서가 없어 SmartScreen 확인이 필요할 수 있습니다.

Codex 오픈소스 원본과 라이선스: [openai/codex](https://github.com/openai/codex) · Apache-2.0. Codex app-server 인증은 개인용 로컬 클라이언트에서 이용 가능하지만, 상용·호스팅 서비스의 사용 조건은 별도로 확인해야 합니다.

별도 포함된 오픈소스 라이선스와 고지: [THIRD_PARTY.md](THIRD_PARTY.md) · [Codex Apache-2.0](licenses/CODEX_APACHE_2.0.txt).
