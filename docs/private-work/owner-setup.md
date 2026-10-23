# 산재 모듈 초기 설정 — 운영 적용 전 준비

이 브랜치는 운영에 병합·배포하지 않았다. 아래 절차에서 **운영 적용**으로 표시한 단계는 검수와 별도 배포 승인 뒤에만 진행한다. 지금 운영 중인 일정·OCR·푸시는 기존 main을 사용한다.

## 1. 계정 준비 (Windows PC)

1. GitHub 변경 목록에서 `scripts/private-work/New-PrivateWorkBootstrap.ps1`을 연다. 파일 우측의 **Download raw file**로 다운로드한다.
2. 시작 메뉴에서 **Windows PowerShell**을 연다. 화면 녹화·명령 기록 기능(Start-Transcript)을 사용하지 않는다. 임시 비밀번호는 이 PC 화면에만 표시된다.
3. 다음을 실행한다. 실행 정책을 영구 변경하지 않으며, 다운로드한 내용을 먼저 확인한다.

   ```powershell
   cd "$env:USERPROFILE\Downloads"
   Unblock-File .\New-PrivateWorkBootstrap.ps1
   powershell -NoProfile -ExecutionPolicy Bypass -File .\New-PrivateWorkBootstrap.ps1
   ```

4. `ydh1121`, `yvonne`의 임시 비밀번호를 본인의 비밀번호 관리자에 보관한다. 채팅·Drive·Git·스크린샷으로 전달하지 않는다. 코드에는 비밀번호가 들어 있지 않다.
5. `%LOCALAPPDATA%\ComeBackHome\private-setup-…\bootstrap-hashes.sql`에는 무작위 salt와 단방향 해시만 기록된다. 폴더는 현재 Windows 사용자에게만 권한이 있다. 이 파일도 업로드하지 않는다.
6. 같은 화면에 나온 `PRIVATE_DRIVE_TOKEN_KEY`는 Cloudflare의 **암호화된 Secret**에만 입력할 키다. 앱 비밀번호 원문을 Cloudflare Secret에 저장하는 방식이 아니다.
7. 최초 로그인 후 본인 비밀번호를 15~128자로 변경한다. 변경하면 다른 기기의 기존 세션도 종료된다.

기존 일정 DB는 두 사용자가 공동으로 사용하던 자료이며 계정 소유자 열이 없다. 이 구현은 산재 자료를 신이본 UUID에 귀속하고, 기존 자료는 별도 명시적 접근권한으로 보호한다. 기존 일정을 두 계정이 공동 관리하는 정책을 승인한 경우에만 생성기에 `-AllowLegacySharedWorkspace`를 붙인다. 승인 전에는 기존 일정 접근권한을 자동 부여하지 않는다. 기존 데이터를 두 개인용 공간으로 분할하는 작업은 이 migration에 포함되지 않는다.

비밀번호를 잊으면 같은 PC에서 `-ResetLoginId yvonne` 또는 `-ResetLoginId ydh1121`로 **새 해시 파일만** 생성한다. 적용 시 해당 계정의 모든 세션이 폐기되고 첫 로그인 변경이 다시 필요하다. 공개 비밀번호 초기화 API는 제공하지 않는다.

## 2. 비공개 Google Drive 보관 준비

ChatGPT의 Drive 연결과 PWA의 Google 연결은 별개다. 현재 로그인한 PWA 사용자의 서버 세션을 확인한 뒤 Google OAuth를 연결한다. 원본은 외부 OCR·AI에 보내지 않는다.

1. [Google Cloud Console](https://console.cloud.google.com/)의 상단 프로젝트 선택기를 연다. **기존 ComeBackHome용 Google 프로젝트**가 있다면 그것을 선택한다. 다른 프로젝트(IndiaDesk·동물관리 등)를 선택하지 않는다. 프로젝트가 없다면 먼저 별도 생성 여부를 결정해야 한다. 이 구현은 프로젝트를 생성하지 않았다.
2. **API 및 서비스 → 라이브러리**에서 **Google Drive API**, **Google Picker API**를 사용 설정한다. 결제 계정 연결이나 유료 API 전환은 필요하지 않으며, 비용 설정을 변경하지 않는다.
3. **Google Auth Platform → 브랜딩·대상**에서 앱 이름과 지원 이메일을 설정한다. 개인 Gmail 계정은 외부 유형을 선택하고 테스트 사용자로 **신이본이 원본을 소유할 실제 Google 계정**을 추가한다. 테스트 모드의 OAuth refresh token은 만료될 수 있으므로 재연결 안내를 확인한다. 공개 앱 심사를 자동으로 통과했다고 간주하지 않는다.
4. **데이터 액세스**에서 `openid`와 `https://www.googleapis.com/auth/drive.file`만 요청한다. 전체 Drive 읽기 권한을 요청하지 않는다.
5. **클라이언트 → 클라이언트 만들기 → 웹 애플리케이션**을 선택한다. 승인된 JavaScript 원본은 `https://come-back-home.pages.dev`, 승인된 리디렉션 URI는 정확히 `https://come-back-home.pages.dev/api/private/case/documents/oauth/callback`이다. 개발용 주소는 별도 개발 클라이언트로 분리한다.
6. OAuth 클라이언트 ID와 Secret을 아래 Cloudflare 설정에 입력한다. Secret을 채팅이나 Drive 문서에 붙이지 않는다.
7. **API 및 서비스 → 사용자 인증 정보 → API 키 만들기**에서 Picker용 키를 만든다. 애플리케이션 제한은 HTTP 리퍼러 `https://come-back-home.pages.dev/*`, API 제한은 Google Picker API로 제한한다. 프로젝트 **번호**도 프로젝트 설정에서 확인한다. 프로젝트 ID 문자열과 번호는 다르다.
8. 신이본 Google Drive에 원본 보관용 **공유하지 않은 폴더**를 준비한다. 앱에서 신이본 계정 로그인 → 산재 → 문서·메모 → Google Drive 연결 → 보관 폴더 선택 순서로 연결한다. 폴더는 한 명의 소유자만 허용된다. 관리자는 신이본의 동의 후 앱의 문서 API로 접근하며 Drive 폴더를 공개 공유하지 않는다.

## 3. 기존 Cloudflare 프로젝트 설정 — 운영 승인 후에만

대상은 기존 **Workers & Pages → come-back-home → Settings → Variables and Secrets**, D1은 기존 **come-back-home-db**다. 새 Pages/Worker/R2는 필요하지 않다.

| 이름 | 형식 | 값의 출처 |
| --- | --- | --- |
| PRIVATE_WORK_ENABLED | 변수 | 검수·초기 계정 적용 후 마지막에 `1`; 준비 중에는 미설정 또는 `0` |
| PRIVATE_DRIVE_CLIENT_ID | 변수 | 해당 Google OAuth 웹 클라이언트의 ID |
| PRIVATE_DRIVE_CLIENT_SECRET | 암호화된 Secret | 동일 클라이언트의 Secret |
| PRIVATE_DRIVE_TOKEN_KEY | 암호화된 Secret | 로컬 생성기의 무작위 32바이트 키 |
| PRIVATE_DRIVE_PICKER_KEY | 변수 | 리퍼러·API 제한을 적용한 Picker API 키 |
| PRIVATE_DRIVE_APP_ID | 변수 | 같은 Google 프로젝트의 숫자 프로젝트 번호 |

세션은 서버에서 검증하는 무작위 쿠키이며 DB에는 토큰 해시만 있다. 별도 JWT 비밀키는 필요 없다. 기존 VAPID·교통 Provider·scheduler Secret은 변경하지 않는다.

운영 승인 뒤 실행 순서: 기존 D1 백업 확인 → additive migration `0012` 적용 → 로컬 생성한 해시 SQL 적용 → 두 계정 및 명시적 기존 자료 접근권한 확인 → 앱과 설정 배포 → 신이본 첫 로그인/비밀번호 변경 → 관리자 열람 목적·보관기간 동의 → Drive 연결/원본 검증. D1 원격 명령은 이 준비 문서만으로 실행 승인된 것이 아니다. 해시 SQL은 Wrangler D1의 트랜잭션 실행에서 적용하고, 실패 시 부분 적용 여부를 확인한다. 재생성한 계정을 중복 삽입하지 않는다.

**운영 전 별도 확인**: Free 플랜의 로그인 CPU 예산에서 PBKDF2 600,000회가 처리되는지 확인해야 한다. 로컬 workerd 호환성 PASS는 실제 Free CPU 수락이 아니다. 실패 시 강도를 낮추거나 유료로 자동 전환하지 않는다.

## 4. 사용자 흐름과 보관 원칙

- 앱 우측 하단 `산재` 버튼 → 할 일 / 산재·요양 / 직장 / 지급 / 문서·메모. 내 계정에서 버튼을 숨길 수 있다.
- 기록의 편집 버튼 또는 긴 누름 → 내용 수정 → 저장. 복사 버튼은 본문 스크롤·편집 중에도 영역 안에 유지된다.
- 다른 사람이 먼저 저장한 경우 내 입력은 남고 최신본이 표시된다. 비교 후 직접 합쳐 저장한다.
- 원본은 수정하지 않는다. Drive 전송 뒤 크기·SHA-256·비공개 접근권한을 검증해야 근거 문서로 선택할 수 있다. 실패·취소 시 같은 파일을 다시 선택해 이어 전송한다. 보관함 이동은 목록만 숨기며 Drive 원본을 삭제하지 않는다.
- ChatGPT 분석 요청 준비는 비공개 원본 링크와 요청문을 복사한다. 사용자가 직접 ChatGPT에 전달한다. 앱이 자동 분석하거나 DB를 수정하지 않는다.
- 예상 / 기관 결정 / 실제 입금은 별도 입력이다. 계산 정책이 없거나 기준일에 유효하지 않으면 계산하지 않는다. 기관 확정 기록에는 확인된 원본을 연결해야 한다.
- 공통 로그아웃은 서버의 세션을 취소하고 이 기기의 가져오기 초안·읽기 캐시를 비운다. 민감한 산재 본문은 localStorage·서비스워커 캐시에 넣지 않는다.

## 5. 수락의 구분

합성 브라우저·격리 D1 검증과 실제 iPhone 유지/로그아웃·Google OAuth·원본 보관·운영 CPU 검증은 별도다. 실제 문서 업로드나 운영 변경은 사용자 수락 후 진행한다. 기존 일정·OCR·지도·알림 회귀가 통과하기 전에는 병합하지 않는다.
