# Gemini API 업데이트 (v1.1.0)

- Gemini REST API 인증을 `x-goog-api-key` 헤더 방식으로 정리했습니다.
- 모델 목록은 더 이상 하드코딩하지 않습니다. 팝업을 열면 `models.list`에서 자동 동기화합니다.
- `generateContent`를 지원하는 Gemini/Gemma 모델만 표시합니다.
- 기본 선택은 `자동 최신 Flash`이며 `gemini-flash-latest`를 우선 사용합니다.
- 목록은 1시간 캐시하며, 팝업의 `모델 목록 새로고침` 버튼으로 즉시 갱신할 수 있습니다.
- 저장된 모델이 지원 종료되면 목록을 강제 갱신하고 최신 Flash로 1회 자동 폴백합니다.
- API 키의 `AIza...` 고정 형식 검증을 제거해 Google auth key 형식 변화에 대응합니다.
- 실제 API 키는 포함하지 않았습니다.