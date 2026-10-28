# CI / 릴리스 정책 (v1.3.7)

- PR: Ubuntu Node.js 22 경량 검사(`.github/workflows/pr-check.yml`). 최신 PR SHA의 필수 검증이 성공하면 다음 `확인해` 지시에 따라 병합합니다.
- main: Windows runner에서 Node SEA `OnCoBridge.exe` 1회 빌드; 공식 Codex **0.163.0-win32-x64** npm 배포본 다운로드·버전 확인 후 `bin/codex.exe` 배치; **패키징된 EXE + Codex app-server** 초기화·계정 상태를 Windows 실환경 테스트로 검증합니다.
- Inno Setup: `OnCo_Setup_v1.3.7.exe` 안에 `OnCoBridge.exe`와 Codex 실행 파일을 함께 포함합니다. `OnCo_Extension_v1.3.7.zip` 및 수동 설치용 `OnCo_Runtime_v1.3.7.zip`도 CI에서 생성합니다.
- CI 한 번의 실행에서 Windows 설치 EXE, 확장 ZIP, 수동용 Runtime ZIP, Bridge EXE, `SHA256SUMS.txt`, `SOURCE_COMMIT.txt`를 동일 커밋 기반 Artifact로 저장합니다.
- Release: 성공한 main push CI의 run ID·head SHA와 Artifact 이름이 일치할 때만 다운로드. 버전 및 각 파일 SHA-256 검증 후 **원본 산출물 그대로 게시**. 재컴파일·재서명하지 않으며, 동일 태그가 이미 있다면 기존 바이너리를 교체하지 않습니다.
- Windows x64 Codex 바이너리 패키지가 npm에 없거나 부팅 스모크 테스트가 실패하면 **릴리스 중단**. 이전 버전 Artifact를 버전만 바꿔 재사용하지 않습니다.
- 출시 이후 실기기 ChatGPT 기기 코드/브라우저 인증·Team 접근·모델 풀이 성공은 사용자 검증으로 별도 판단합니다. 이전 암호화 인증 파일과 Gemini/OpenAI API 키 설정은 수정·삭제하지 않습니다.
