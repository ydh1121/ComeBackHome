# 산재 모듈 초기 설정

**2026-10-25 갱신:** PR #102 코드가 MAIN `033708c`로 병합·기존 주소 배포됐고, 운영 DB `0012`와 두 계정·공동 권한 등록도 완료됐다(`2 / 2 / 2 / 1` 사용자 확인). 올바른 아이디를 사용해도 서버 오류가 남아 개발 담당자가 실행 환경을 확인 중이다. **사용자가 지금 다시 등록할 항목은 없다.** [현재 로그인 상태](login-help.md)를 따르며 DB 준비, 비밀번호·키 생성과 설정 등록을 반복하지 않는다.

로그인 화면에서 `PRIVATE_SERVICE_UNAVAILABLE`가 나오거나 Cloudflare 로그인 자체가 안 되면 **[Windows PC용 짧은 확인 안내](login-help.md)**부터 읽는다. 사용자 지시로 실행 담당자는 Cloudflare 클라우드 브라우저를 사용하지 않는다. **최초 로그인, iPhone 로그인 유지·로그아웃, 앱에서 Drive 연결은 DB·계정 준비 후 실제 접속할 수 있게 된 다음에 검수한다.**

## 먼저 확인할 순서

1. **지금 준비:** 임시 비밀번호·해시 파일 보관, Google API 설정, 아래 표의 Cloudflare 변수·Secret 준비. 이미 만든 값은 다시 만들지 않는다.
2. **남은 운영 적용 확인:** MAIN 병합·코드 배포는 완료됐다. 남은 DB 적용 대상과 복구 방법을 구체적으로 확인한다. 설정값 등록만으로 DB가 준비되는 것은 아니다.
3. **배포 담당자 작업:** 기존 D1 백업, 0012 추가 테이블, 생성해 둔 계정 해시 및 두 계정의 기존 공동 공간 권한 적용. 준비 여부를 확인하기 전에 로그인 기능을 새로 켜지 않는다. 이미 로그인 화면에서 오류가 나면 먼저 위 읽기 전용 안내로 실제 상태를 확인한다.
4. **새 버전 접속 후 검수:** 기능을 켠 뒤 최초 로그인·비밀번호 변경, 무료 플랜에서의 실제 로그인 처리, Drive 연결, iPhone 유지·로그아웃을 확인한다. 실환경 검수에 실패하면 준비한 중지·복구 절차를 적용하고 정식 수락을 보류한다.
5. **정식 수락:** 위 결과를 기록하고 실제 사용 가능으로 판정한다. 합성 테스트 통과와 배포 후 실제 검수는 따로 기록한다.

"무료 플랜 로그인 처리 확인"은 비밀번호를 안전하게 확인하는 서버 계산이 Cloudflare 무료 실행 한도 안에서 끝나는지 검사한다는 뜻이다. 개발 담당자의 기술 검수이며, 사용자가 암호화 설정을 바꾸거나 유료 플랜으로 전환하라는 뜻이 아니다.

## 1. 계정 준비 (Windows PC)

**이미 1~6을 완료했다면 이 절차를 다시 실행하지 않는다.** 기존 비밀번호·`bootstrap-hashes.sql`·`PRIVATE_DRIVE_TOKEN_KEY`를 그대로 보관한다. 공동 사용 권한은 배포 담당자가 계정 적용 후 별도로 추가할 수 있으므로 비밀번호를 재생성할 이유가 없다.

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
7. **DB·계정 등록 후:** 새 PWA에 처음 로그인할 수 있게 되면 본인 비밀번호를 15~128자로 변경한다. 변경하면 다른 기기의 기존 세션도 종료된다. 로그인 화면 표시는 DB·계정 준비 완료를 뜻하지 않는다.

기존 일정 DB에는 계정 소유자 열이 없다. **2026-10-24 사용자가 `ydh1121`과 `yvonne`의 기존 공간 공동 사용을 승인했다.** 산재 자료는 계속 신이본 UUID에 귀속하고, 기존 자료는 두 계정에 명시적으로 권한을 부여한다. 아직 계정을 생성하지 않은 경우에만 생성기에 `-AllowLegacySharedWorkspace`를 붙일 수 있다. 이미 생성했다면 해시 파일을 보존하고 [운영 전환 안내](rollout-and-recovery.md)의 별도 권한 적용 절차를 사용한다. 기존 데이터를 두 개인용 공간으로 분할하지 않는다.

비밀번호를 잊으면 같은 PC에서 `-ResetLoginId yvonne` 또는 `-ResetLoginId ydh1121`로 **새 해시 파일만** 생성한다. 적용 시 해당 계정의 모든 세션이 폐기되고 첫 로그인 변경이 다시 필요하다. 공개 비밀번호 초기화 API는 제공하지 않는다.

## 2. 비공개 Google Drive 보관 준비

ChatGPT의 Drive 연결과 PWA의 Google 연결은 별개다. **PWA 로그인 아이디(`yvonne`)와 원본을 보관할 Google 계정도 별개다.** 산재 소유자가 승인한 관리자 Google Drive에 보관할 수도 있고, 신이본 본인의 Google Drive에 보관할 수도 있다. 실제 파일 소유자는 선택한 Google 계정이다. 앱의 산재 소유권·관리자 접근 동의는 바뀌지 않는다. 앱에서 연결을 시작하는 권한은 산재 소유자 `yvonne`에게만 있다. 원본은 외부 OCR·AI에 보내지 않는다.

1. [Google Cloud Console](https://console.cloud.google.com/)의 상단 프로젝트 선택기를 연다. **기존 ComeBackHome용 Google 프로젝트**가 있다면 그것을 선택한다. 다른 프로젝트(IndiaDesk·동물관리 등)를 선택하지 않는다. 프로젝트가 없다면 먼저 별도 생성 여부를 결정해야 한다. 이 구현은 프로젝트를 생성하지 않았다.
2. **API 및 서비스 → 라이브러리**에서 **Google Drive API**, **Google Picker API**를 사용 설정한다. 결제 계정 연결이나 유료 API 전환은 필요하지 않으며, 비용 설정을 변경하지 않는다.
3. **Google Auth Platform → 브랜딩·대상(Audience)**에서 앱 이름과 지원 이메일을 설정한다. 개인 Gmail 계정은 외부 유형을 선택한다. **테스트 사용자 → 사용자 추가**에는 Drive 연결 화면에서 실제로 선택할 Google 이메일을 넣고 저장한다. 이미 등록한 관리자 Google 계정의 Drive를 사용한다면 신이본 Google 이메일 추가가 필수는 아니다. 신이본 Google Drive를 사용할 때 그 이메일을 추가하면 된다. 이 테스트 사용자 목록은 PWA 아이디 로그인과 별개다. 테스트 모드에서는 Drive 동의·refresh token이 7일 뒤 만료될 수 있어 재연결이 필요하다. 공개 앱 심사를 통과했다고 간주하지 않는다.
4. **데이터 액세스**에서 `openid`와 `https://www.googleapis.com/auth/drive.file`만 요청한다. 전체 Drive 읽기 권한을 요청하지 않는다.
5. **클라이언트 → 클라이언트 만들기 → 웹 애플리케이션**을 선택한다. 승인된 JavaScript 원본은 `https://come-back-home.pages.dev`, 승인된 리디렉션 URI는 정확히 `https://come-back-home.pages.dev/api/private/case/documents/oauth/callback`이다. 개발용 주소는 별도 개발 클라이언트로 분리한다.
6. OAuth 클라이언트 ID는 Cloudflare의 **Name=`PRIVATE_DRIVE_CLIENT_ID` / Type=Text**, 클라이언트 Secret은 **Name=`PRIVATE_DRIVE_CLIENT_SECRET` / Type=Secret(Encrypt)**으로 넣는다. **Value**에는 각각 Google에서 받은 값을 넣는다. 아래 표에 나머지 Name도 모두 적었다. Secret을 채팅이나 Drive 문서에 붙이지 않는다.
7. **API 및 서비스 → 사용자 인증 정보 → API 키 만들기**에서 Picker용 키를 만든다. 애플리케이션 제한은 웹사이트(HTTP 리퍼러)를 선택하고 **`https://come-back-home.pages.dev/*`와 `https://docs.google.com/*` 두 항목**을 등록한다. Picker가 Google iframe에서 열리므로 두 번째 항목도 필요하다. API 제한은 Google Picker API로 제한한다. 이미 만든 키는 수정하면 되며 재발급하지 않는다. 프로젝트 **번호**도 프로젝트 설정에서 확인한다. `gen-…` 같은 프로젝트 ID 문자열과 숫자 프로젝트 번호는 다르다.
8. **지금 할 일은 Drive 폴더 준비뿐이다.** 원본을 보관할 Google 계정으로 [Google Drive](https://drive.google.com/)를 연다. 기존 산재 폴더를 쓸 수 있고, 필요하면 **새로 만들기 → 새 폴더 → `ComeBackHome 산재 원본`**으로 만든다. 폴더 우클릭 → **공유**에서 일반 액세스는 **제한됨**, 접근 가능한 사람은 해당 Google 계정 본인만인지 확인한다. 기존 폴더가 이 조건이면 다시 만들거나 자료를 옮길 필요가 없다.

   **배포 후:** 산재 소유자 `yvonne`로 PWA 로그인 → 산재 → 문서·메모 → **Google Drive 연결** → 위 폴더를 가진 Google 계정 선택·동의 → **보관 폴더 선택**에서 준비한 폴더를 선택한다. 이때부터 앱에 올리는 사진/PDF가 그 폴더에 저장된다. 연결한 Google 계정과 보관 폴더는 쉽게 교체하지 않도록 보호돼 있으므로 처음 연결할 때 올바른 계정인지 확인한다. 관리자 앱 접근은 신이본의 동의로 허용하고, Drive 폴더를 공개 공유하지 않는다.

## 3. Cloudflare 입력란의 Name / Type / Value

대상은 기존 **Workers & Pages → come-back-home → Settings → Variables and Secrets**의 **Production** 환경이다. **Add**를 누르고 아래 Name을 대소문자까지 그대로 복사한다. Type은 Text 또는 Secret/Encrypt를 선택하고 Value에 해당 값을 붙인 뒤 Save한다. 이 준비값 등록과 `PRIVATE_WORK_ENABLED=1` 활성화는 서로 다른 단계다. D1은 기존 **come-back-home-db**이며 새 Pages/Worker/R2는 필요하지 않다.

| 이름 | 형식 | 값의 출처 |
| --- | --- | --- |
| PRIVATE_DRIVE_CLIENT_ID | Text | Google 웹 애플리케이션 OAuth 클라이언트 ID (`…apps.googleusercontent.com`) |
| PRIVATE_DRIVE_CLIENT_SECRET | Secret / Encrypt | 바로 위와 같은 OAuth 클라이언트의 클라이언트 보안 비밀 |
| PRIVATE_DRIVE_TOKEN_KEY | Secret / Encrypt | 로컬 생성기의 무작위 32바이트 키. 이미 등록했다면 그대로 유지 |
| PRIVATE_DRIVE_PICKER_KEY | Text | 리퍼러·API 제한을 적용한 Picker API 키. Gemini API 키와 혼동하지 않는다 |
| PRIVATE_DRIVE_APP_ID | Text | 같은 Google 프로젝트의 **프로젝트 번호**(숫자만). 프로젝트 ID가 아님 |
| PRIVATE_WORK_ENABLED | Text | 신규 준비 때는 미설정 또는 `0`, 승인된 DB·계정 준비 후 로그인 사용 때 `1`. **현재는 로그인 화면이 이미 보이므로 값을 임의로 다시 변경하지 않는다.** |

세션은 서버에서 검증하는 무작위 쿠키이며 DB에는 토큰 해시만 있다. 별도 JWT 비밀키는 필요 없다. 기존 VAPID·교통 Provider·scheduler Secret은 변경하지 않는다.

운영 승인 뒤 실행 순서: 기존 D1 백업 확인 → additive migration `0012` 적용 → 로컬 생성한 해시 SQL 적용 → 두 계정 및 명시적 기존 자료 접근권한 확인 → 앱과 설정 배포 → 신이본 첫 로그인/비밀번호 변경 → 관리자 열람 목적·보관기간 동의 → Drive 연결/원본 검증. D1 원격 명령은 이 준비 문서만으로 실행 승인된 것이 아니다. 해시 SQL은 Wrangler D1의 트랜잭션 실행에서 적용하고, 실패 시 부분 적용 여부를 확인한다. 재생성한 계정을 중복 삽입하지 않는다.

**개발 담당자의 별도 확인**: 실제 Free 플랜에서 로그인·비밀번호 변경이 완료되고 실행 한도 오류가 없는지 확인한다. 로컬 workerd 호환성 PASS는 실제 Free CPU 수락이 아니다. 검수 가능한 배포가 없는데 사용자에게 이 검수를 먼저 완료하라고 요구하지 않는다. 실패 시 강도를 낮추거나 유료로 자동 전환하지 않는다.

## 4. 사용자 흐름과 보관 원칙

- 앱 우측 하단 `산재` 버튼 → 할 일 / 산재·요양 / 직장 / 지급 / 문서·메모. 내 계정에서 버튼을 숨길 수 있다.
- 기록의 편집 버튼 또는 긴 누름 → 내용 수정 → 저장. 복사 버튼은 본문 스크롤·편집 중에도 영역 안에 유지된다.
- 다른 사람이 먼저 저장한 경우 내 입력은 남고 최신본이 표시된다. 비교 후 직접 합쳐 저장한다.
- 원본은 수정하지 않는다. Drive 전송 뒤 크기·SHA-256·비공개 접근권한을 검증해야 근거 문서로 선택할 수 있다. 실패·취소 시 같은 파일을 다시 선택해 이어 전송한다. 보관함 이동은 목록만 숨기며 Drive 원본을 삭제하지 않는다.
- ChatGPT 분석 요청 준비는 비공개 원본 링크와 요청문을 복사한다. 사용자가 직접 ChatGPT에 전달한다. 앱이 자동 분석하거나 DB를 수정하지 않는다.
- 예상 / 기관 결정 / 실제 입금은 별도 입력이다. 계산 정책이 없거나 기준일에 유효하지 않으면 계산하지 않는다. 기관 확정 기록에는 확인된 원본을 연결해야 한다.
- 공통 로그아웃은 서버의 세션을 취소하고 이 기기의 가져오기 초안·읽기 캐시를 비운다. 민감한 산재 본문은 localStorage·서비스워커 캐시에 넣지 않는다.

## 5. 수락의 구분

합성 브라우저·격리 D1 검증과 실제 iPhone 유지/로그아웃·Google OAuth·원본 보관·운영 CPU 검증은 별도다. 실제 문서 업로드나 운영 변경은 명시적으로 승인된 배포·검수 범위에서 진행한다. 기존 일정·OCR·지도·알림 회귀가 통과하기 전에는 병합하지 않는다.

## 공식 설정 참고 (2026-10-24 확인)

- [Cloudflare Pages 변수·Secret 입력](https://developers.cloudflare.com/pages/functions/bindings/)
- [Google Picker: 프로젝트 번호·API 키 리퍼러](https://developers.google.com/workspace/drive/picker/guides/web-picker)
- [Google OAuth 테스트 사용자·동의 만료](https://support.google.com/cloud/answer/15549945?hl=en)
- [Cloudflare 무료 실행 한도](https://developers.cloudflare.com/workers/platform/limits/)
