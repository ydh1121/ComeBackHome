# 로그인 준비와 운영 전환

**일반 사용자는 [로그인이 안 될 때 — Windows PC에서 확인하기](login-help.md)를 먼저 읽는다.** 아래 긴 명령은 개발 담당자용이며, 현재 오류 화면을 확인하려고 실행할 필요가 없다.

2026-10-25: PR #102는 MAIN `033708c48dfd4853372ccad1744887943a0918e2`로 병합·기존 주소 배포 완료. MAIN 필수 CI 12/12와 배포 확인이 통과했다. 운영 DB·계정 적용은 아직 확인되지 않았고, 이후 사용자 화면에서 로그인 서버 오류가 보고됐다. 코드 배포 성공과 실제 로그인 성공은 별도다.

사용자 지시로 **Cloudflare 클라우드 브라우저 접속 금지**. 이 문서만으로 운영 DB 변경이나 인증 경계를 우회할 수 없다. 일반 사용자는 먼저 자신의 PC에서 Cloudflare 로그인 가능 여부와 위 안내의 읽기 전용 결과만 확인한다.

<details>
<summary>개발 담당자용: DB 적용·배포·복구 절차 펼치기</summary>

## 먼저 결정할 내용

1. 기존 일정·사람·경로·푸시 설정은 하나의 공동 공간이다. **2026-10-24 사용자가 두 계정의 공동 사용을 승인했다.** 산재 자료는 별도로 신이본 계정에 귀속된다. 이미 생성된 비밀번호·해시·Drive 키를 다시 만들지 않고, 운영 적용 승인 후 기존 두 계정에 공동 공간 권한만 별도로 부여한다. 기존 자료를 개인별로 분할하지 않는다.
2. 기존 Cloudflare `come-back-home`의 실제 Free 플랜·DB 바인딩·변수·배포 경로를 확인한다. 새 프로젝트는 필요하지 않다.
3. 비밀번호와 Drive 암호화 키는 [Windows 준비 절차](owner-setup.md)대로 사용자 PC에서만 만든다. 기존 VAPID·교통 API 키를 교체하지 않는다.
4. 실제 Free CPU 예산에서 로그인·비밀번호 변경을 검증할 승인된 경로를 정한다. 로컬 workerd 성공이나 wall time은 운영 CPU 수락이 아니다. 강도 하향·유료 전환은 자동으로 하지 않는다.
5. 실제 Google OAuth/Picker, 비공개 보관 폴더, 실제 iPhone 로그인 유지·로그아웃은 **검수할 새 버전이 배포된 뒤** 별도로 확인한다. 이들을 전부 완료해야 첫 배포 승인을 요청할 수 있다는 순환 조건을 만들지 않는다. 운영 알림 발송·실사용 원본 업로드는 개발 CI에 포함되지 않는다.

## 승인 후 적용 순서

아래는 **검수한 PR 코드가 있는 폴더**의 PowerShell 명령 형식이다. `npm ci`를 마친 작업 폴더가 필요하다. 로컬 Wrangler 4.146.0의 help와 대조했다. 실행 전 실제 Cloudflare 계정과 `wrangler.jsonc`의 `come-back-home-db` ID를 다시 확인한다.

1. 적용 직전 배포 ID와 D1 복구 시점을 비공개 작업 기록에 남긴다. SQL 백업에는 민감한 자료가 있으므로 본인 PC의 보호된 폴더에만 보관한다. 공개 Git·CI·일반 Drive 문서에 넣지 않는다.

   ```powershell
   # 생성기가 만든 실제 private-setup 폴더로 바꾼다.
   $cbhPrivateSetup = Join-Path $env:LOCALAPPDATA 'ComeBackHome\private-setup-실제폴더명'
   & .\node_modules\.bin\wrangler.cmd d1 time-travel info come-back-home-db --config .\wrangler.jsonc --json
   & .\node_modules\.bin\wrangler.cmd d1 export come-back-home-db --remote --config .\wrangler.jsonc --output (Join-Path $cbhPrivateSetup 'before-private-work.sql')
   ```

2. 백업이 비어 있지 않고 복구 시점이 적용 직전인지 확인한다. **백업 확인 실패 시 중단한다.** 필수 기존 CI 12개와 산재 전용 CI가 승인된 동일 HEAD에서 통과해야 한다.
3. pending migration을 조회한다. 예상은 `0012_private_work_modules.sql` 하나다. 다르면 실제 적용 이력을 확인하고 진행을 멈춘다.

   ```powershell
   & .\node_modules\.bin\wrangler.cmd d1 migrations list come-back-home-db --remote --config .\wrangler.jsonc
   ```

4. 별도 승인된 작업 시간에 migration과 생성한 해시 SQL을 적용한다. 0012는 `auth_*`, `case_*` 추가만 수행한다. 이 문서의 명령을 복사했다는 이유로 운영 적용이 승인되는 것은 아니다.

   ```powershell
   & .\node_modules\.bin\wrangler.cmd d1 migrations apply come-back-home-db --remote --config .\wrangler.jsonc
   & .\node_modules\.bin\wrangler.cmd d1 execute come-back-home-db --remote --config .\wrangler.jsonc --file (Join-Path $cbhPrivateSetup 'bootstrap-hashes.sql')
   ```

5. 결과와 두 계정·산재 소유자·명시적 기존 공간 권한을 확인한다. 기존 해시 파일에 공동 공간 grant가 없다면, 운영 적용 승인 범위에서 배포 담당자가 아래 SQL을 적용한다. 먼저 두 계정이 각각 한 개 존재하는지 확인하고, 없으면 중단한다. 이 SQL은 계정 UUID·비밀번호·산재 소유권을 변경하지 않는다.

   ```sql
   SELECT login_id FROM auth_users WHERE login_id IN ('ydh1121','yvonne');
   INSERT INTO auth_workspace_grants(user_id,workspace,permission,approved_at)
   SELECT id,'legacy','write',strftime('%Y-%m-%dT%H:%M:%fZ','now')
   FROM auth_users WHERE login_id IN ('ydh1121','yvonne')
   ON CONFLICT(user_id) DO UPDATE SET permission='write',approved_at=excluded.approved_at;
   INSERT INTO auth_audit(id,actor_id,action,outcome,target_id,created_at)
   SELECT lower(hex(randomblob(16))),NULL,'owner-approved-legacy-shared-access','applied',id,
     strftime('%Y-%m-%dT%H:%M:%fZ','now')
   FROM auth_users WHERE login_id IN ('ydh1121','yvonne');
   ```

   적용 후 두 grant 모두 `legacy/write`인지 조회해 확인한다. 실패한 계정 생성 파일을 반복 적용하지 않는다. 해시 SQL도 비공개로 취급한다.
6. 기존 배포 절차를 사용하며 `PRIVATE_WORK_ENABLED`는 코드·계정 준비가 끝나고 실환경 검수를 시작할 때 활성화한다. 첫 로그인/강제 변경과 Free 실행 한도 → 계정 권한 → 신이본의 관리자 동의 → 기존 일정/OCR → 실제 Drive 연결·원본 검증 → iPhone 세션을 확인한다. **MAIN 병합·검수용 운영 배포 승인과 배포 후 정식 수락은 별도다.** 실제 배포 ID와 검수 결과를 기록한다.

## 실패 시 복구

- **개발·검수 실패:** 운영에 반영하지 않고 PR에서 수정한다.
- **산재만 중지:** 승인된 담당자가 `PRIVATE_WORK_ENABLED=0`으로 되돌리고 기존 배포 절차로 적용한다. 산재 API는 닫히고 DB·Drive 원본은 보존된다. 기존 서비스는 원래 main의 접근 방식으로 돌아가므로 이 접근 정책도 사용자 승인 대상이다.
- **코드 롤백:** 확인한 이전 배포로 되돌린다. 추가 테이블을 DROP하거나 원본을 삭제하지 않는다.
- **DB 복구:** D1 전체 복구는 이후의 정상 일정 변경까지 되돌릴 수 있다. 적용 전후를 비교하고 별도 복구 승인을 받아 실제 복구 시점을 선택한다. 자동 DB 복구 명령은 제공·실행하지 않는다.
- **Drive 실패:** 같은 원본으로 재시도한다. 만료 세션은 예약 파일을 먼저 확인하고, 완료된 원본이 있으면 무결성·권한을 재검증한다. 검증 전에는 보관 완료로 표시하지 않는다. 보관함 이동은 목록만 숨기며 Drive 원본을 삭제하지 않는다.

## 준비된 자료 가져오기

비공개 산재 폴더의 `ComeBackHome-private-planning-2026-10-24.json`에는 기획 정본의 63개 초안과 출처가 있다. 원본 증빙이나 기관 확정 기록을 만들어낸 파일이 아니다. 운영 수락 뒤 신이본 계정의 **산재 → 접근·이력 → 내 자료 내보내기·기획 자료 가져오기**에서 선택 → 내용 확인 → **검토 완료 · 새 기록으로 저장** 순서로 사용한다. 같은 파일 재시도는 중복 생성하지 않는다.

공식 계산 정책은 `policies/2026-confirmed.json`을 관리자 **접근·이력 → 계산 정책과 공식 근거**에서 별도로 검토·저장한다. 개인 초안과 법정 정책은 섞지 않는다. 적용 기간 밖의 계산에는 새 공식 근거 확인이 필요하다.

</details>
