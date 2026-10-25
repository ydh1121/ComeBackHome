# 로그인이 안 될 때 — Windows PC에서 확인하기

2026-10-25 기준: 새 버전은 MAIN에 병합되어 기존 PWA 주소에 배포됐다. 아래는 **설정 확인 안내**이며, DB를 변경하는 명령은 없다.

## 지금 화면이 뜻하는 것

| 화면 | 확인된 의미 |
| --- | --- |
| PWA의 `PRIVATE_SERVICE_UNAVAILABLE` | 로그인 처리 중 서버 내부 오류가 났다. 비밀번호 불일치라는 판정은 아니다. |
| Cloudflare의 `/api/v4/login (403)` | Cloudflare 관리 화면의 로그인 요청이 거절됐다. 이 화면만으로 계정 정지나 원인을 확정할 수 없다. |

PWA 로그인 화면은 로그인용 DB가 없어도 나타날 수 있다. 지금까지 작업 기록에는 DB와 두 계정의 운영 적용 완료 증거가 없으므로 그 상태부터 확인해야 한다. 화면만 보고 DB 누락을 확정하거나 비밀번호를 새로 만들지 않는다.

`PRIVATE_DRIVE_…` 다섯 항목은 문서 보관 연결 설정이다. Windows에서 계정 파일을 만든 것과 그 파일을 서버 DB에 등록하는 것은 별도 단계다. `PRIVATE_WORK_ENABLED=1`은 로그인 화면을 켜지만 DB와 계정을 자동으로 만들지는 않는다.

## 1. 먼저 본인 PC에서 Cloudflare 로그인을 확인

실행 담당자는 Cloudflare에 클라우드 브라우저로 접속하지 않는다.

1. 기존 Chrome 창과 저장된 비밀번호는 그대로 둔다. **Ctrl + Shift + N**으로 시크릿 창을 하나 연다.
2. 주소창에 **https://dash.cloudflare.com/login**을 입력한다.
3. 평소 사용하던 동일한 이메일·비밀번호로 **한 번만** 로그인한다. 시크릿 창은 기존 쿠키·확장 프로그램 영향과 구분하기 위한 확인이며 해결을 보장하지 않는다.
4. 같은 403이면 여기서 멈춘다. 재시도 반복이나 새 API 키 발급은 이 오류의 해결 여부를 확인해 주지 않는다. Cloudflare 공식 지원에 문의할 경우 발생 시각과 오류 문구만 전달하고 비밀번호·쿠키·인증 코드는 전달하지 않는다.

Cloudflare 로그인에 실패하면 아래 2번은 아직 하지 않는다. 먼저 **시크릿 창에서도 403인지**만 확인하면 된다.

## 2. Cloudflare에 로그인됐을 때만 DB 확인

1. 왼쪽 메뉴에서 **Storage & databases → D1 SQL Database**를 연다. 메뉴 이름이 다르면 대시보드 검색에서 `D1`을 찾는다.
2. **come-back-home-db**를 선택한다. 새 DB를 만들지 않는다.
3. 위쪽 **Console / 콘솔**을 연다.
4. 아래 상자 전체를 복사해 입력란에 붙이고 **Execute / 실행**을 한 번 누른다. 이 명령은 테이블 이름만 읽는다. 저장된 일정이나 비밀번호를 변경하지 않는다.

```sql
SELECT name AS table_name
FROM sqlite_master
WHERE type = 'table'
  AND name IN (
    'auth_users', 'auth_credentials', 'auth_policy', 'auth_sessions',
    'auth_rate_limits', 'auth_preferences', 'auth_workspace_grants',
    'auth_audit', 'case_profiles', 'case_consents'
  )
ORDER BY name;
```

| 결과 | 다음 행동 |
| --- | --- |
| 결과가 0개 | 로그인용 테이블이 없다. 결과만 전달하고 멈춘다. |
| 결과가 1~9개 | 일부만 있다. 다시 설치하거나 삭제하지 말고 결과만 전달한다. |
| 결과가 10개 | 아래 계정 등록 확인으로 진행한다. 전체 산재 DB 검증이 완료됐다는 뜻은 아니다. |
| 실행 오류 | 오류 문구만 전달한다. 비밀번호 파일을 붙이지 않는다. |

<details>
<summary>테이블이 10개 나왔을 때: 계정 등록 확인</summary>

같은 콘솔의 입력란을 비우고 아래 명령을 붙여 **Execute / 실행**을 누른다. 비밀번호·해시 값은 출력하지 않는다.

```sql
SELECT u.login_id AS account,
       CASE WHEN c.user_id IS NULL THEN 'missing' ELSE 'present' END AS password_record,
       COALESCE(g.permission, 'missing') AS shared_workspace_access
FROM auth_users AS u
LEFT JOIN auth_credentials AS c ON c.user_id = u.id
LEFT JOIN auth_workspace_grants AS g ON g.user_id = u.id AND g.workspace = 'legacy'
WHERE u.login_id IN ('ydh1121', 'yvonne')
ORDER BY u.login_id;
```

두 계정이 각각 `present / write`로 나오면 등록 여부를 확인할 수 있다. 실제 비밀번호 일치나 서버의 암호화 실행 성공까지 검증한 것은 아니다. 결과가 비어 있거나 `missing`이 있으면 등록이 덜 된 상태다. 결과 표만 전달하면 담당자가 다음 조치를 정할 수 있다.

</details>

## 3. 계정 등록이 필요하다고 확인된 다음

적용 순서는 **기존 DB 백업 → 로그인·산재용 테이블 추가 → 이미 만든 두 계정 등록 → 기존 일정 공동 사용 권한 확인 → 로그인 시험**이다. 이 단계는 운영 DB를 변경하므로 담당자가 실제 확인 결과에 맞춰 준비한다.

`bootstrap-hashes.sql`은 본인 Windows PC에 그대로 둔다. 새로 만들거나 채팅·GitHub·Drive에 올리지 않는다. 지금은 개발자용 문서의 긴 PowerShell 명령을 실행할 필요가 없다.

## 참고

- [Cloudflare 공식 로그인 안내](https://developers.cloudflare.com/fundamentals/user-profiles/login/)
- [Cloudflare 브라우저 확인 오류 안내](https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/) — 현재 403을 Turnstile 문제로 확정한 것은 아니다.
- [개발 담당자용 운영 전환·복구 절차](rollout-and-recovery.md)
