# Portable source modules

ComeBackHome에서 분리한 독립 소스 모듈입니다. 앱의 `src/`, `worker/`, 데이터베이스 스키마, 계정, API 키가 없어도 복사하여 사용하고 타입 검사할 수 있습니다. npm 공개 배포용 패키지가 아닙니다. 각 모듈은 아래 범위만 담당합니다.

| 모듈 | 제공 기능 | 필요한 실행 환경 / peer |
| --- | --- | --- |
| `core` | 변경 구독 신호, 페이지 복귀 처리, 고정 간격 재시도 | ES2022, 페이지 이벤트는 선택 |
| `http` | JSON 요청·오류·성공 후 캐시 무효화, 서버 JSON 응답·입력 검사 | Fetch API |
| `browser` | 인스턴스별 TTL 캐시·중복 요청 공유, Worker 응답 확인, 테마 초기화 | DOM; 저장소·캐시 대상·키·색상은 주입 |
| `react` | 아이콘, 드래그/배경 닫기 시트, 시간 휠, 로딩 경계, 온라인·폼·테마 훅 | React/React DOM 19.3.0 |
| `calendar` | IANA 시간대의 날짜/시간, 양력·한국 음력 생일 계산 | `korean-lunar-calendar` 0.4.0 (생일만) |
| `d1` | 구조적 D1 타입, batch 실패 처리, SQLite bool 변환 | D1 호환 객체; DB·스키마를 생성하지 않음 |
| `ocr` | 픽셀 기반 표선/셀 검출, 이미지 정규화, Tesseract worker, ONNX 전처리·CTC | 브라우저 Canvas; Tesseract 7.0.0 / ONNX 1.23.2 (해당 파일만) |
| `web-push` | 브라우저 구독/권한, VAPID 암호화 전송, 오류 분류 | Push API / Web Crypto; 서버는 `@block65/webcrypto-web-push` 2.0.0 |

## 복사

원본 저장소에서 전체 또는 필요한 모듈만 내보냅니다. 대상 폴더의 부모는 먼저 만들고, 대상 폴더 자체는 없어야 합니다. 기존 파일을 덮어쓰지 않습니다.

```sh
npm run export:portable -- --to ../my-other-app/portable --modules core,http,browser
# 전체: --modules 옵션 생략
```

대상 프로젝트에 사용한 모듈의 peer만 설치하고 TypeScript/ES2022 및 JSX 번들러(Vite 등)로 소스를 빌드합니다. `package.json`의 exports는 소스 파일을 가리킵니다. Node에서 변환 없이 배포 JS 패키지처럼 require하는 형식은 아닙니다. TypeScript, React 타입 선언은 소비 프로젝트의 개발 의존성입니다. `react`를 선택하지 않으면 내보내기 도구가 React 타입 의존성도 제거합니다.

```ts
import { createReadCache } from './portable/browser';
import { JsonHttpClient } from './portable/http';

const cache = createReadCache({
  dataKey: 'inventory:reads:v1', settingKey: 'inventory:cache:v1',
  storage: () => localStorage, events: window,
  defaultEnabled: () => true, ttlMs: 30_000,
  isCacheableRead: path => path === '/products',
});
const api = new JsonHttpClient('/api', () => {}, cache);
const products = await api.get('/products');
// 성공한 변경 요청은 같은 캐시를 무효화합니다.
await api.post('/products', { name: 'Example' });
// 인증 계정/권한 변경 때도 cache.invalidate()를 호출하세요.
// 호스트가 종료될 때 cache.dispose()로 이벤트 구독을 정리합니다.
```

캐시는 명시적으로 허용한 읽기만 저장합니다. 만료된 데이터로 오프라인 대체 응답을 하지 않습니다. 이미지·비밀키·구독 정보·실시간 위치·권한별 응답은 캐시 대상으로 넣지 마세요. 앱별 저장 키와 계정 전환 시 무효화는 소비 프로젝트 책임입니다. 복사한 캐시에 ComeBackHome 저장 키나 URL 정책은 포함되지 않습니다.

## UI와 테마

- 시간 휠은 자체 CSS와 접근성 키보드 동작을 포함합니다. `labels`, 시작/종료 라벨, `--portable-*` CSS 변수로 번역/테마를 지정합니다.
- `Icon`은 `react/icons.css`를 함께 가져오세요. 텍스트가 없는 버튼에는 소비자가 접근성 이름을 지정해야 합니다.
- `DismissibleSheet`는 네이티브 dialog와 포인터 제스처를 담당하며 `classes`, `closeIcon`, 라벨을 받습니다. 레이아웃은 소비자 CSS로 정의합니다. 모달 포털은 body에 생성됩니다.
- `LoadingBoundary`/`useLoadingPlaceholder`는 지연 표시·inert·aria-busy를 담당합니다. 스켈레톤 모양과 전환 효과는 소비자 UI가 그립니다. 클래스는 `page-reveal`, `t-skel-content`, `sr-only`입니다.
- `installTheme({storageKey, changeEvent, preferenceEvent, colors})`는 CSS 로드 전에 실행하세요. `system/light/dark` 선택과 탭 간 동기화를 제공합니다. 반환 함수는 이벤트를 해제합니다. React에는 같은 이벤트 설정으로 `createThemePreferenceBinding`을 사용합니다.
- ComeBackHome의 `public/theme.js`는 이 엔진과 앱 설정을 조합한 동기 부트스트랩입니다. 소비 프로젝트는 자기 설정으로 별도 생성하며, ComeBackHome 부트스트랩을 복사하지 않습니다.

## OCR / Push / D1의 경계

OCR은 저수준 실행 도구입니다. `Schedule*` 타입/클래스 이름은 기존 호출 호환성을 위해 유지하지만 직원·근무·7×3 배치·휴무 판정·승인·저장은 들어 있지 않습니다. 모델과 사전도 포함하지 않습니다. `pixel-table`은 단색 표선이 있는 이미지용 휴리스틱이며 범용 문서 정확도를 보장하지 않습니다. Tesseract의 worker/core/lang 경로는 동일 출처의 명시적 자산이어야 합니다. 자체 모델/정답으로 별도 정확도 평가가 필요합니다.

Push 브라우저와 서버 진입점을 구분하세요. `web-push/server`를 브라우저 번들에 넣지 않습니다. 서버 키·수신자·메시지·발송 승인·재시도 정책은 소비자 소유입니다. 이 패키지는 스케줄러나 자동 발송을 시작하지 않습니다.

D1의 `batchOrThrow`는 D1 batch 계약을 사용합니다. 임의의 DB 어댑터가 트랜잭션을 제공하지 않으면 원자성을 만들어 주지 않습니다. 스키마/마이그레이션/승인 정책은 소비자 책임입니다.

## 검증과 변경

원본 저장소의 `npm run verify:portable`은 임시 폴더로 실제 내보낸 뒤 원본 `src`/`worker` 없이 타입 검사하고 캐시 경합·오류·테마·달력·D1·CTC 계약을 실행합니다. 기존 제품 어댑터 및 제품 회귀는 별도 검증합니다. 소스 복사 후 개선 사항은 자동 동기화되지 않으므로 적용 commit과 로컬 수정 사항을 기록하세요. API 변경 시 이 문서와 계약 테스트를 함께 갱신합니다.
