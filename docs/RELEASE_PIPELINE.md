# CI / 릴리스 정책

PR: Ubuntu Node 22 경량 검사 (`pr-check.yml`). 병합은 성공 후 별도 `확인해` 지시로만 진행.
main: Windows runner에서 Node SEA로 `OnCoBridge.exe` 생성, Native Messaging 핑 검증, Inno Setup `OnCo_Setup_v1.3.0.exe`, 순수 `OnCo_Extension_v1.3.0.zip` 생성. 동일 커밋의 체크섬과 SOURCE_COMMIT 작성 후 Artifact 업로드.
Release: 성공한 main push CI의 해당 `run-id`와 `head_sha`로 Artifact 다운로드. 체크섬 재검사, 같은 바이너리를 게시. 재빌드·재서명 금지. 이미 존재하는 릴리스 파일은 덮어쓰지 않음.

개인 실기기 검증은 릴리스 게시 이후 별도. 보안/인증 정보 비노출. 운영 목표 버전 v1.3.0.