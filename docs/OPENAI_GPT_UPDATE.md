# OnCo AI Solver v1.2.0 — Gemini + GPT + ChatGPT 로그인

> **이 문서는 v1.2.0의 이전 인증 구조 기록입니다.** v1.3.4에서는 ChatGPT 계정 경로를 공식 Codex app-server로 교체했습니다. 현재 사용 방법은 [README](../README.md)를 참고하세요. 이전 OAuth/DPAPI 절차를 새 버전에 적용하지 마세요.

## 변경사항

- API 제공자 선택: **Gemini/Gemma API 키**, **OpenAI GPT API 키**, **ChatGPT 계정 로그인(선택적 로컬 도우미)**
- 기존 Gemini/Gemma 자동 모델 목록, 모델 선택, 문제 추출과 Monaco 코드 주입 동작 유지
- OpenAI API `GET /v1/models` 목록 기반 GPT 자동 갱신, 1시간 캐시, 강제 갱신 버튼
- OpenAI `POST /v1/responses`를 이용한 코드 생성 (응답 `output`의 `output_text` 텍스트 병합)
- ChatGPT 로그인은 공식 OAuth/PKCE + HTTP loopback 인증(127.0.0.1)과 필수 사용자 동의 사용
- 로그인된 계정의 공개 `GET /v1/models` 모델 목록에서 `visibility=list` 모델 선택
- ChatGPT 플랜 사용 시 `store:false`, `stream:true`, 배열 `input`, `response.completed` 필수 검증 (미지원 `max_output_tokens` 제외)
- Gemini/OpenAI/ChatGPT별 모델 선택을 분리 저장하며 다른 서비스 키를 자동으로 사용하지 않음
- Chrome storage 접근 수준을 TRUSTED_CONTEXTS로 제한하고 로그 렌더링 시 HTML 주입 위험 제거

## 사용법

1. ZIP을 풀고 Chrome/Whale `chrome://extensions`에서 개발자 모드 → '압축 해제된 확장 프로그램 로드'를 선택합니다. **최상위 폴더**를 선택합니다.
2. 팝업의 **AI 서비스** 드롭다운에서 원하는 서비스를 선택합니다.
3. Gemini: 기존 Gemini API 키가 유지되므로 필요하면 기존대로 사용하면 됩니다.
4. OpenAI API: https://platform.openai.com/api-keys 의 API 키를 저장합니다. ChatGPT 구독과 별도 API 요금이 청구될 수 있습니다.
5. ChatGPT 로그인: `chatgpt_bridge/README_KO.md` 또는 팝업의 '도우미 설정 안내'에 따라 Node.js 도우미를 켠 다음 코드를 연결하고 OpenAI 공식 OAuth 권한을 승인합니다.
6. 모델을 선택하고 OnCo 문제 페이지에서 '문제 풀기'를 실행합니다.

## 주의사항

- 모델 목록 API는 실제 `Responses` 호환성을 완벽히 분류하는 메타데이터를 주지 않습니다. OpenAI API 키 모드는 비텍스트 특수 모델을 이름 기반으로 제외하며, 지원 여부는 실제 요청 시점의 모델 권한/상태에 좌우됩니다.
- API 키는 기존 버전과 마찬가지로 확장 프로그램의 `chrome.storage.local`에 저장되며, 서버 보관이나 암호화된 금고를 의미하지 않습니다. 개인용으로 사용하세요.
- ChatGPT OAuth 토큰은 브라우저 저장소로 보내지지 않으며 로컬 도우미 메모리 안에만 남습니다. 도우미 종료 후 재로그인이 필요합니다.
- 공식 ChatGPT 플랜 사용량 공유는 로그인과 별도의 사용자 동의가 필요합니다. 요금제/계정/워크스페이스별로 제한될 수 있습니다.
- **자동화된 테스트만 수행했으며** 실제 ChatGPT 계정 권한 승인, 유효한 API 키로의 실제 모델 생성은 확인하지 않았습니다.
- 기존 Backup/ 폴더는 원본 보존 목적으로 유지되며 이전 코드입니다. 확장 루트 파일만 동작합니다.

## 공식 문서

- https://platform.openai.com/docs/api-reference/models/list
- https://platform.openai.com/docs/api-reference/responses/create
- https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference