# OnCo AI Solver

OnCo 사이트의 **실제 코딩 문제** 페이지에서만 문제·이미지·테스트 예제 복사 및 AI 모델 선택을 지원하는 비공식 Chrome / Whale 확장 프로그램입니다.

## Windows 설치 (v1.3.1 목표)

1. GitHub Releases에서 `OnCo_Setup_v1.3.1.exe`를 받아 설치합니다. v1.3.1 릴리스 전에는 해당 설치 파일이 아직 제공되지 않습니다.
2. 설치 끝에 열리는 **확장 연결 튜토리얼**에 따라 `chrome://extensions` 또는 `whale://extensions`에서 개발자 모드를 켜고 `압축해제된 확장 프로그램 로드`로 **설치 폴더의 `extension` 하위 폴더**를 선택합니다. 웹스토어 등록은 필요하지 않습니다.
3. 확장 프로그램의 `AI 서비스`에서 **ChatGPT 계정** 또는 **Gemini/OpenAI API 키**를 선택합니다.
4. ChatGPT 사용 시 먼저 `Continue with ChatGPT`로 **기본 신원 로그인**을 합니다. 필요한 경우 별도 `GPT 플랜 사용 권한 요청` 버튼으로 구독 사용에 동의합니다. v1.3.0에서 이미 승인받은 세션은 유지되며, 사용 가능 여부는 실제 토큰에 부여된 scope와 모델 호출 결과로 판단합니다. Team/Business 사용 가능 여부는 조직 정책과 계정 자격에 따라 달라집니다. Gemini 및 OpenAI API 키 연결을 유지하고 유료 API로 자동 전환하지 않습니다.
5. 사용자는 이후 브라우저에서 OnCo 문제 페이지를 열면 됩니다. 설치 프로그램이나 CMD를 매번 실행할 필요가 없습니다.

## Login privacy (v1.3.1)

- The authorization request asks for **`openid` only** during basic identity sign-in, and adds **`offline_access resource.invoke chatgpt.tokens.use.direct`** only after explicit plan consent. No `profile` or `email` scopes are requested.
- The app keeps the verified opaque OIDC `sub` and the issued client/host registration identifiers to distinguish connected accounts. It does **not** need your name, email address or profile photo for solving problems.
- On successful upgrade, old v1.3.0 encrypted session records are minimized automatically: personal profile fields and raw ID tokens are discarded, while legitimate existing plan tokens and account binding are retained.
- This update does **not** revoke profile permissions previously granted at OpenAI. To remove old server-side grants, review and revoke the app under official ChatGPT connected-app settings before authorizing again. Real Team/workspace acceptance of reduced scopes must be confirmed after release; no automatic fallback silently asks for more profile data.

## 구성

- `extension`: MV3 브라우저 확장; Gemini API와 OpenAI API 키 모드 유지, 문제 화면 오탐 방지
- `bridge`: Native Messaging 호스트 (`OnCoBridge.exe` 단일 실행 파일); OpenAI OSS OAuth PKCE/loopback, Windows DPAPI 저장
- `installer`: Inno Setup 스크립트, 설치·브라우저 연결 튜토리얼
- `.github/workflows`: PR 경량 검증 → main에서 Windows 한 번 빌드 → 성공 Artifact 재사용 릴리스
- `tests`: Gemini/GPT 메시지 처리와 문제 화면 감지, Native Messaging 프로토콜 테스트

## 사용상의 제한

- **Chrome/Whale은 미게시 확장 프로그램을 자동 등록해 주지 않습니다.** 최초 1회 직접 로드/승인이 필요합니다.
- 일반 홈·공지사항·학습 챕터·문제 로딩 중에는 복사 버튼이 나타나지 않으며, **문제 제목/설명/코드 에디터가 모두 감지될 때만** 버튼이 표시됩니다.
- ChatGPT 실제 OAuth와 Windows 설치 동작은 사용자의 Windows 실기기에서 검증해야 합니다. 정식 릴리스 게시가 실기기 검증을 의미하지 않습니다.
- Windows 코드 서명 인증서가 설정되지 않은 설치 파일은 SmartScreen 경고가 발생할 수 있습니다. 인증 정보, API 키, 개인 계정 토큰은 절대 저장소에 커밋하지 않습니다.
- 교육 플랫폼의 사용 규정과 평가·제출 정책을 반드시 준수하세요.

## 개발

```sh
node --test tests/*.mjs
node --check extension/content.js
node --check bridge/main.cjs
```

PR 단계에서는 단위 테스트와 문법 검사를 수행하며 Windows 전체 빌드는 병합 뒤 main에서 한 번만 수행합니다. 릴리스 Actions는 CI Artifact를 받아 커밋/버전/SHA-256을 확인한 뒤 게시하며 재빌드하지 않습니다.

[공식 Chrome Native Messaging 문서](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging) · [Sign in with ChatGPT OSS](https://developers.openai.com/siwc/token-sharing-open-source)
