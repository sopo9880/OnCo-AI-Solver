# OnCo AI Solver — ChatGPT 로그인 도우미

Chrome 확장 프로그램만으로는 공식 Sign in with ChatGPT의 필수 HTTP loopback 콜백(127.0.0.1)을 수신할 수 없어, 작은 Node.js 로컬 도우미가 필요합니다.

1. Windows: https://nodejs.org 에서 Node.js 22 이상 설치
2. 이 폴더의 `start_windows.cmd` 실행 (다른 OS에서는 `node bridge.mjs`)
3. 표시된 12자리 코드를 확장 팝업의 AI 서비스 → `ChatGPT 계정 로그인`에 입력, `도우미 연결` 클릭
4. `Continue with ChatGPT` 클릭 → 공식 OpenAI 인증/동의 진행
5. 팝업을 재열어 GPT 모델 선택/문제 풀기

도우미는 loopback `127.0.0.1:18744`에서만 접속을 허용하고, Chrome/Whale 확장 오리진+12자리 연결 코드를 확인합니다. OpenAI의 OAuth refresh/access/ID token은 **서버 프로세스 메모리**에서만 유지합니다. 도우미를 종료하면 로그인 토큰은 파기되고 재로그인이 필요하며, 계정 등록을 재사용하기 위한 opaque 호스트 ID/발급 클라이언트 ID/검증된 계정 subject만 사용자 홈 `.onco-ai-solver/chatgpt-registration.json`에 저장합니다. 파일은 공개 저장소에 넣지 마세요.

- 플랜 사용 권한을 허용하지 않으면 GPT 호출은 할 수 없습니다. 일반 로그인 완료와 플랜 사용 허용은 구분됩니다.
- 로그아웃은 원격 refresh token 취소를 시도한 뒤 메모리 인증 정보를 파기합니다. 원격 취소가 확인되지 않으면 ChatGPT 설정에서 연결을 해제하세요.
- 유효한 요금제/작업 정책/모델 권한은 OpenAI 서비스에서 결정합니다. 모든 GPT 모델을 사용할 수 있다는 뜻은 아닙니다.
- 모델 목록은 로그인한 사용자에게 공식 OpenAI API가 반환하는 항목만 표시합니다.
- API 키 모드와 OAuth 로그인 모드는 별도 인증/과금 방식입니다.

공식 문서: https://developers.openai.com/siwc/token-sharing-open-source