# 로그인 마무리 — Windows PC에서 한 번만

**현재 상태:** 2026-10-25 16:41 KST, 사용자가 실행한 [DB 준비 작업 40173675312](https://github.com/ydh1121/ComeBackHome/actions/runs/40173675312)이 성공했다. `0012` 적용과 기존 일정 테이블 구조 보존을 확인했다. **DB 준비는 끝났으므로 1번을 다시 실행하지 않는다.** 계정 파일과 공동 권한 등록, 실제 로그인 성공 여부는 아직 확인 중이다.

이미 만든 임시 비밀번호와 `bootstrap-hashes.sql`을 그대로 사용한다. Google 설정이나 키 등록을 반복할 필요가 없다. 담당자는 Cloudflare 클라우드 브라우저를 사용하지 않는다.

## `No SQL statements detected.`가 표시됐다면 여기부터

이 오류는 콘솔에 전달된 내용에서 실행 가능한 SQL 문장을 찾지 못했다는 뜻이다. 설명문만 선택되거나 붙여넣기 과정에서 줄바꿈이 달라졌을 가능성이 있지만, 현재 첨부에는 SQL 입력란이 보이지 않아 어느 경우인지는 확인하지 못했다. [공식 오류 설명](https://developers.cloudflare.com/d1/observability/debug-d1/#list-of-d1_errors)

계정 파일을 반복 실행하기 전에 **come-back-home-db → Console**의 기존 입력을 모두 지우고 아래 **한 줄 전체**만 붙여 실행한다. 비밀번호·해시는 출력하지 않고 등록 개수만 읽는다.

```sql
SELECT (SELECT COUNT(*) FROM auth_users WHERE login_id IN ('ydh1121','yvonne') AND disabled=0) AS accounts, (SELECT COUNT(*) FROM auth_credentials c JOIN auth_users u ON u.id=c.user_id WHERE u.login_id IN ('ydh1121','yvonne') AND u.disabled=0) AS passwords, (SELECT COUNT(*) FROM auth_workspace_grants g JOIN auth_users u ON u.id=g.user_id WHERE u.login_id IN ('ydh1121','yvonne') AND u.disabled=0 AND g.workspace='legacy' AND g.permission='write') AS shared_access, (SELECT COUNT(*) FROM case_profiles p JOIN auth_users u ON u.id=p.owner_id JOIN case_consents c ON c.case_id=p.id WHERE u.login_id='yvonne') AS case_ready;
```

| accounts / passwords / shared_access / case_ready | 다음 행동 |
| --- | --- |
| `0 / 0 / 0 / 0` | 두 계정이 아직 없다. 아래 2번에서 **첫 `INSERT INTO auth_users` 줄부터 마지막 `INSERT INTO case_consents` 줄까지** 복사한다. 맨 위 `-- HASHES ONLY…` 설명 줄은 복사하지 않는다. |
| `2 / 2 / 0 또는 1 / 1` | 계정 파일은 다시 실행하지 않는다. 아래 3번의 공동 권한 파일만 적용한다. |
| `2 / 2 / 2 / 1` | 등록 준비 완료. 아래 4번으로 간다. |
| 그 외 값 또는 실행 오류 | 부분 등록 여부를 확인해야 한다. 계정 파일을 다시 실행하지 말고 숫자 네 개나 오류 문구만 전달한다. |

**로그인 아이디는 이메일이 아니다. 관리자 `ydh1121`, 신이본 `yvonne`이다.** 첨부 화면에 들어 있던 이메일은 지우고 해당 아이디만 입력한다. 이 수정만으로 서버 503 오류까지 해결된다고 단정하지 않으며, 등록 준비 후에도 `PRIVATE_SERVICE_UNAVAILABLE`이면 서버 확인이 더 필요하다.

<details>
<summary>1. DB 준비 실행 — 이미 완료됨, 신규 설치 참고용</summary>

## 1. GitHub에서 로그인용 DB 준비 실행

이 단계는 **기존 운영 DB에 로그인·산재용 테이블만 추가**한다. 일정·사람·OCR 데이터는 변경하지 않는다. 계정 비밀번호는 GitHub에 전달하지 않는다.

1. [로그인 DB 준비 실행 화면](https://github.com/ydh1121/ComeBackHome/actions/workflows/apply-comebackhome-d1-migrations.yml)을 연다.
2. 오른쪽 **Run workflow**를 누른다.
3. **Use workflow from / Branch**를 **`feat/private-work-injury`**로 선택한다. 현재 `main`의 이전 실행 절차 대신 이 브랜치의 보완된 절차를 사용한다.
4. **confirmation** 입력란에 아래 한 줄을 넣고 초록색 **Run workflow**를 누른다.

   ```text
   APPLY_REMOTE_COMEBACKHOME_D1
   ```

5. 방금 생긴 실행을 열어 **초록색 체크**와 요약의 **Schema: applied** 또는 **already-applied**를 확인한다. 그다음 2번으로 간다. 실행이 목록에 아직 없으면 페이지를 한 번 새로 고친다.

실행 절차는 기존 연결을 사용해 DB 이름·ID, 이전 적용 이력, 복구 시점을 확인한다. 누락된 것이 `0012` 하나일 때만 적용하며, 일부만 설치됐거나 다른 변경이 필요한 상태면 중단한다. 복구 시점은 실행 요약에 남긴다. 실제 계정·일정 내용이나 비밀번호는 로그에 출력하지 않는다.

**빨간색 실패면 2번을 하지 않는다.** 실패한 실행 주소만 전달하면 된다. 같은 작업을 반복 실행하거나 새 DB를 만들지 않는다.

</details>

## 2. PC에 이미 있는 두 계정 등록

이 단계만 본인 PC에 있는 비공개 파일을 사용한다. 담당자에게 파일이나 내용을 보내지 않는다.

1. 키보드 **Windows 키 + R**을 누르고 아래 주소를 붙인 뒤 Enter를 누른다.

   ```text
   %LOCALAPPDATA%\ComeBackHome
   ```

2. 전에 계정 준비를 할 때 생성된 **`private-setup-…` 폴더**를 연다. 그 안의 **`bootstrap-hashes.sql`**을 마우스 오른쪽 버튼 → **연결 프로그램 → 메모장**으로 연다. 폴더가 여러 개라면 저장해 둔 임시 비밀번호와 함께 생성한 폴더를 사용한다. 어느 파일인지 확실하지 않으면 임의로 고르거나 다시 생성하지 않는다.
3. 맨 위 `-- HASHES ONLY…`는 설명 줄이다. 이 줄은 제외하고 **첫 `INSERT INTO auth_users` 줄의 맨 앞부터 파일 맨 마지막 `INSERT INTO case_consents…;`의 세미콜론까지** 선택해 복사한다. 비밀번호 재설정용 `UPDATE`로 시작하거나 `INSERT` 줄이 없다면 이 파일을 실행하지 않는다. 원본 파일을 수정·저장할 필요는 없다.
4. 본인 PC에서 열어 둔 Cloudflare의 **come-back-home-db → Console**로 돌아간다. 이전 조회문을 지우고 **Ctrl + V**로 붙인 다음 **Execute / 실행**을 **한 번만** 누른다.

성공 후 입력란을 비우고 메모장을 닫는다. 비밀번호 원문은 파일에 없지만 해시도 비공개 자료이므로 이 화면을 캡처하거나 채팅·GitHub·Drive에 복사하지 않는다.

**오류가 나오면 멈춘다.** 특히 `UNIQUE constraint failed`는 이미 일부 또는 전부 등록돼 있을 수 있다는 뜻이다. 계정 파일을 다시 실행하거나 계정을 삭제하지 말고, 해시가 포함되지 않은 오류 문구만 전달한다. 출력이 비어 있는 것만으로 성공을 판정하지 말고 다음 단계의 상태 표까지 확인한다.

## 3. 두 계정에서 기존 일정을 함께 쓰도록 마무리

1. [공동 일정 권한 설정 파일](../../scripts/private-work/complete-login-access.sql)을 연다.
2. 파일 오른쪽 위 **Copy raw file / 복사 아이콘**을 눌러 **파일 전체 내용**을 복사한다. 아이콘이 없으면 **Raw**를 열고 Ctrl + A → Ctrl + C를 누른다. 현재 파일은 설명문 없이 **한 줄에 SQL 문장 하나씩, 총 3줄**이다. `INSERT INTO auth_workspace_grants`로 시작하는지 확인한다.
3. 같은 **come-back-home-db → Console** 입력란을 비우고 붙인 뒤 **Execute / 실행**을 누른다.
4. 마지막 결과 표가 아래처럼 나오는지 확인한다.

| account | password_record | shared_workspace_access | result |
| --- | --- | --- | --- |
| ydh1121 | present | write | READY_FOR_LOGIN |
| yvonne | present | write | READY_FOR_LOGIN |

이 파일은 두 계정·비밀번호 등록·산재 소유자 준비가 확인된 경우에만 기존 일정 공동 사용 권한을 부여한다. 비밀번호와 기존 일정은 변경하지 않는다. 산재의 관리자 열람 동의도 자동으로 켜지지 않는다. **이 공개 파일만 다시 실행하는 것은 안전하다. 2번의 비공개 계정 파일과 혼동하지 않는다.**

`missing` 또는 `LOGIN_SETUP_INCOMPLETE`이면 해당 상태 표만 전달한다. **READY_FOR_LOGIN은 등록 준비 확인이며 실제 로그인 성공 판정은 아니다.**

## 4. 평소 PWA에서 로그인

1. [ComeBackHome](https://come-back-home.pages.dev/)을 새로고침하거나 iPhone PWA를 완전히 닫았다가 다시 연다.
2. 아이디 칸에 자동 입력된 이메일을 지우고 **`ydh1121`**만 입력한다. 전에 보관한 **ydh1121용 임시 비밀번호**로 로그인한다. 신이본은 아이디 **`yvonne`**을 사용한다. Cloudflare·네이버·Google 계정 비밀번호를 사용하는 것이 아니다.
3. 처음 표시되는 비밀번호 변경 화면에서 본인 비밀번호를 **15~128자**로 정한다. 앞으로는 변경한 비밀번호를 사용한다.
4. 오늘·일정 화면에서 기존 일정이 그대로 보이는지 확인한다. `yvonne`은 별도 계정이므로 그 계정에 보관한 임시 비밀번호로 같은 절차를 따른다.

현재 로그인 화면이 이미 표시되므로 `PRIVATE_WORK_ENABLED` 값을 다시 바꾸거나 앱을 재배포하는 작업을 먼저 하지 않는다. DB 등록 뒤에도 오류가 나면 **계정 아이디, 오류 문구, 발생 시각**만 전달한다. 비밀번호는 전달하지 않는다.

## 담당자용 확인

- 승인된 MAIN은 `033708c`, 기존 필수 CI 12/12와 기존 주소 배포는 완료됐다.
- 이번 변경은 수동 DB 준비 도구와 안내다. 앱·기존 스키마·0012 SQL·비밀번호 생성기는 수정하지 않았다.
- 실행 전 D1 Time Travel로 복구 시점을 검증한다. 현재 Free 보관 기간은 7일이고, 복구는 이후 정상 변경도 되돌리므로 자동 실행하지 않는다. 민감한 전체 DB를 공개 CI artifact로 내보내지 않는다.
- 기존 GitHub 연결 도구에는 workflow dispatch 기능이 없어 소유자가 1번 실행 버튼을 누른다. 담당자는 Cloudflare 인증 차단을 다른 로그인 방식으로 우회하지 않는다.
- 운영 DB `0012`는 사용자 실행 로그로 적용 완료를 확인했다. 계정 등록·실제 로그인·Free CPU·iPhone 수락은 여전히 별도다. 이 SQL 오류를 근거로 DB 준비 workflow를 재실행하지 않는다.

[Cloudflare 공식 Time Travel 안내](https://developers.cloudflare.com/d1/reference/time-travel/) · [개발 담당자용 복구 절차](rollout-and-recovery.md)
