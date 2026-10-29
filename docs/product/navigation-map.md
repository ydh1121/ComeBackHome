# ComeBackHome 화면 연결

일정이 기본 진입점이다. 공통 상단바는 일정·생활비·할 일·산재 공간을 전환한다. 기존 북마크와 일정 업무 경로는 유지한다.

| 공간 | 실제 주소 | 주요 진입 경로 |
| --- | --- | --- |
| 오늘 | `/` | 일정 상단 탭·일정 하단 메뉴 |
| 일정표 | `/schedule` | 일정 하단 메뉴 |
| 지난 일정 | `/schedule/history` | 일정표의 월별 이력 |
| 일정 직접 입력 | `/schedule/new`, `/schedule/:date/edit` | 일정표 |
| 근무표 가져오기 | `/import` | 일정 하단 메뉴 |
| 사람 연결·검토 | `/import/:batchId/people`, `/import/:batchId/review` | 가져오기 흐름 |
| 사람 | `/people`, `/people/:personId` | 일정 하단 메뉴 |
| 사람·장소·경로 편집 | `/people/new`, `/people/:personId/edit`, `/people/:personId/place/:kind`, `/people/:personId/commute` 및 하위 경로 | 사람 상세 |
| 설정 | `/settings` | 오늘 화면의 설정 |
| 내 계정 | `/account` | **일정 설정 → 내 계정**; 산재의 계정 아이콘도 유지 |
| 즐겨찾기 버튼 | `/settings/favorites` | **일정 설정 → 즐겨찾기 버튼**; 열린 즐겨찾기의 편집 |
| 알림·로컬 캐시 | `/notifications`, `/settings/cache` | 일정 설정 |
| 생활비·할 일 | `/household?section=cards`, `ledger`, `income`, `notes` | 공통 상단바·생활비 하단 메뉴 |
| 생활비 설정 | 현재 생활비 주소 유지 · 설정 팝업 | 각 생활비 화면 제목 옆 설정 버튼 |
| 산재 | `/injury?section=today`, `progress`, `library`, `manage` | 공통 상단바·산재 하단 메뉴 |
| 산재 세부 관리 | `/injury?section=tasks`, `payments`, `settings` 등 기존 관리 분류 | 내 관리함 |

## 공통 규칙

- 계정·즐겨찾기 편집은 로그인한 사용자만 연다. 이 두 페이지는 일정 데이터 공급자를 시작하지 않는 독립 경로다.
- 계정 페이지는 다른 계정으로 전환될 때 새로 연다. 기기 목록·로컬 편집 상태를 이전 계정에서 이어받지 않는다.
- 즐겨찾기는 현재 기기의 **계정별** 설정이다. 표시 ON/OFF와 18개 바로가기 선택을 즉시 저장한다. 숨겨도 설정에서 다시 켤 수 있다.
- 기존 `cbh.portal.favorites.<accountId>` 배열을 읽고 선택 순서를 보존한다. 수정할 때만 표시 여부를 포함한 새 형식으로 저장한다. 설정에 사용자 문서·메모·비밀번호를 넣지 않는다.
- 계정·즐겨찾기 편집에는 하단 메뉴가 없으므로 버튼을 하단 안전영역에 맞춘다. 나머지 기존 화면에서는 하단 메뉴 위 위치를 유지한다.
- 계정은 상단 일정 탭에 속하지만 전용 화면이므로 iPhone 상태바 덮개 처리를 적용한다. 일정 화면의 타이틀 위치와 상태바 처리는 바꾸지 않는다.
- 과거 주소 `/schedule/edit`, `/import/:batchId/structure`, `/settings/presence`는 기존 연결을 보존한다. 시계 알람 수동 연동은 기존 개발용 정책을 유지한다.
