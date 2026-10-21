# ComeBackHome

근무표 이미지·XLSX 가져오기, 사람별 일정과 이동 경로, 도착 예상, PWA 알림을 제공하는 개인 운영 앱입니다.

- 운영: https://come-back-home.pages.dev/
- 현재 운영 기능과 iPhone UI는 사용자가 수락한 상태를 유지합니다.
- 공통 코드: [`packages/portable`](packages/portable/README.md) — 다른 프로젝트에 선택 복사 가능한 8개 모듈
- 개발/운영 문서: [`docs/README.md`](docs/README.md)
- 구조와 변경 원칙: [`docs/reusable-modules.md`](docs/reusable-modules.md)

## 로컬 개발

Node 22 이상과 저장소의 lockfile을 사용합니다. 아래 검증은 운영 데이터를 수정하지 않습니다.

```sh
npm ci
npm run dev
npm run typecheck
npm run typecheck:worker
npm run verify:portable
npm run check
npm run build
```

실제 브라우저·격리 local D1 전체 회귀는 기존 `Phase 5G Local Integration` Actions 12개 필수 작업에서 수행합니다. 단위/계약 검사 통과를 실제 iPhone 또는 외부 공급자 성공으로 합치지 않습니다. 모델 실행 자산은 빌드 시 검증된 로컬/vendor 원본에서 준비합니다. 설치·빌드에 필요한 의존성 취득과 제품의 외부 OCR 추론은 별개입니다.

## 다른 프로젝트에 재사용

```sh
npm run export:portable -- --to ../another-project/portable --modules core,http,browser
```

대상 폴더를 새로 만들며, 기존 폴더가 있으면 중단합니다. 저장소 이름·운영 URL·개인 정보·API 키를 복사하지 않습니다. 필요한 모듈, peer 의존성, 사용 예제와 제한은 [공통 모듈 설명](packages/portable/README.md)을 따릅니다. 공개 npm 배포나 라이선스 변경은 하지 않습니다.

## 운영 변경

일반 변경은 작업 브랜치 → PR → 필수 CI → 승인 범위 확인 → MAIN 병합 → 기존 Pages 배포 → 정확한 커밋의 읽기 전용 확인 순서로 진행합니다. 신규 Worker/Pages, 유료 서비스, 운영 D1 마이그레이션·데이터 변경, 실사용 원본 외부 전송, 실제 알림·알람 실험은 개별 승인 없이 실행하지 않습니다.

실사용 근무표·검증 JSON·DB 백업·키는 공개 저장소/CI에 넣지 않습니다. Git을 비공개로 전환해도 과거 공개 내용이 회수되는 것은 아니므로 개인 자료를 추가하는 허가로 해석하지 않습니다. 저장소 가시성 전환은 소유자가 이번 정리 완료 후 수행할 예정입니다.
