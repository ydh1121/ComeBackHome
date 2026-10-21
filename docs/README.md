# 문서 안내

현재 운영 코드와 사용자 수락이 최우선입니다. 과거 단계 문서는 당시 구현·검증 근거이며, 제목에 Phase/READINESS/HOLD가 있어도 현재 상태를 자동으로 뜻하지 않습니다. 과거 FAIL 기록은 삭제하거나 PASS로 바꾸지 않습니다.

| 목적 | 읽을 문서 |
| --- | --- |
| 공통 모듈 복사/확장 | [모듈 사용법](../packages/portable/README.md), [구조와 정책 분리](reusable-modules.md) |
| 운영 구성/환경 | [환경 계약](CLOUDFLARE_ENVIRONMENT_CONTRACT.md), [운영 활성화 이력](PRODUCTION_RUNTIME_ACTIVATION_PHASE1.md), [일상 기능 릴리스](daily-life-release.md) |
| 검증 실행 | [격리 local D1](local-integration.md), [일상 기능 수락](daily-life-acceptance.md), [테마/UI 수락](visual-theme-acceptance.md) |
| iPhone 타이틀/이동 | [상태 영역과 원래 타이틀 위치](ios-pwa-top-clearance.md) — PR #98 사용자 수락 완료 |
| 이미지·XLSX 가져오기 | [복수 파일 검토](import-multi-review.md), [XLSX 승인 원자성](nonimage-approved-xlsx-atomic-import.md), [OCR 승인 원자성](ocr-reviewed-atomic-integration.md) |
| OCR 자산/품질 | [자산](ocr-runtime-assets.md), [비공개 검증](ocr-private-evaluation-harness.md), [당시 종료 기록](closeout-ocr-iphone-20261015.md) |
| 알림·Outbox | [계획 정책](notification-planner-policy.md), [Outbox](notification-outbox-processor.md), [local D1 검증](local-d1-notification-e2e.md) |
| 교통·요청 보호 | [공급자 구성](provider-runtime-composition.md), [보안 전송](provider-secure-transport.md), [지하철 색상](subway-line-colors.md) |
| iPhone 알람 참조 | [데이터/수신기 계약](iphone-clock-contract.md) — 자동 네이티브 알람 기능의 설치/작동 수락을 뜻하지 않음 |

## 정본과 보존 자료

비공개 Drive의 ComeBackHome 폴더에는 CURRENT SNAPSHOT, WORK LEDGER, DECISION LOG, QA & EVIDENCE와 ARTIFACT REGISTRY의 기존 ID를 유지합니다. 현재 운영 요약과 이전 전체 기록의 보관 링크를 분리합니다. `10_Engineering`, `20_QA_Fixtures`, `30_Private_Backups`, `90_Archive`는 각각 개발 자료, 합성 검증 자료, 비공개 백업, 이전 설계/누적 기록입니다. 공개 Git 문서에는 비공개 파일 내용이나 키를 복사하지 않습니다.

Git의 과거 PR·커밋·진단 워크플로는 증거와 재현성을 위해 유지합니다. 이미 병합된 변경을 다시 구현하지 않으며, 아직 별도 Draft로 남은 OCR 작업을 자동 병합하지 않습니다. 운영 배포와 마이그레이션 워크플로의 명시적 실행 경계도 유지합니다.
