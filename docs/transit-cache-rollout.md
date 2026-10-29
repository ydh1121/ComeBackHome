# 알림용 경로 캐시 적용

알림 확인은 기존처럼 매분 실행한다. 외부 경로 조회 결과는 별도 캐시 테이블에서 재사용한다. 기존 일정·출퇴근 기록·알림·계정·산재·생활비 테이블은 바꾸지 않는다.

## 적용 순서

1. 변경 커밋의 필수 회귀와 산재·생활비 CI 통과를 확인한다.
2. GitHub Actions의 **Apply ComeBackHome D1 Migrations**에서 검수한 커밋이 있는 브랜치를 선택한다.
3. `batch`는 `transit-cache-0016`, `confirmation`은 `APPLY_REMOTE_COMEBACKHOME_TRANSIT_CACHE_0016`, `expected_sha`는 검수한 40자리 커밋 SHA를 입력한다.
4. 결과에서 `schema: applied` 또는 `already-applied`, `preservedExistingSchema: true`를 확인한다.
5. 검수한 변경을 main에 반영하고 기존 canonical Pages 배포의 정확한 커밋·상태를 확인한다. 별도 Scheduler Worker는 기존 매분 전달 역할을 유지하므로 재배포하지 않는다.

이 작업은 기존 `come-back-home-db`에 `0016_notification_route_cache.sql` 하나만 적용한다. 적용 전에 기존 15개 migration 이력과 전체 테이블·인덱스·트리거 정의, SQL 파일의 고정 해시를 확인한다. Time Travel 복구 가능 여부와 기준 시각을 먼저 기록하며, 다른 변경이나 부분 적용이 발견되면 쓰기 전에 중단한다. 새 테이블은 빈 상태로 만들고 외부 교통 조회나 실제 알림 시험을 실행하지 않는다.

## 실패·복구

- `REVIEWED_COMMIT_REQUIRED`: 선택한 브랜치의 HEAD와 입력 SHA가 다르다. 검수한 커밋을 다시 확인한다.
- `BASELINE_OR_PARTIAL_SCHEMA_MISMATCH` 또는 `UNEXPECTED_REMOTE_MIGRATIONS`: 자동 재시도하지 않는다. 실행 기록에 남은 오류와 읽기 전용 schema/ledger 확인을 통해 차이를 먼저 검토한다.
- `RECOVERY_POINT_UNAVAILABLE`: 복구 지점 확인에 실패했다. DB 쓰기는 실행되지 않는다.
- 적용 중 오류: 성공으로 간주하지 않는다. 다음 실행도 완전한 이력·schema를 검증하므로 부분 적용은 차단된다.

코드를 이전 버전으로 되돌릴 때 새 캐시 테이블을 삭제할 필요는 없다. 자동 DB 복원이나 기존 데이터 삭제는 하지 않는다. 실제 복원이 필요하면 기록한 기준 시각과 영향 범위를 검토해 별도 승인 후 진행한다.

캐시 테이블이 준비되지 않은 상태에서는 알림용 외부 경로 조회가 차단된다. 일반 퇴근 알림과 기존 데이터는 유지되지만, 도착 예상 알림이 정상 준비되었다고 판정해서는 안 된다. 따라서 DB 준비와 canonical Pages 배포를 모두 확인해야 이 변경을 운영 완료로 볼 수 있다.
