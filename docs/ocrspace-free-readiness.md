# OCR.space Engine3 무료 인증 준비

소유자 Free 키 등록과 실제 API 인증은 완료되었다. 추가 키 등록이나
Cloudflare/Gemini 재설정은 필요 없다. 아래 설정 절차는 완료 기록이다.
실제 API 성공, 원본336셀 정확도, 제품 연결 및 운영 수락은 분리한다.

## 최종 결과 — 인증 완료, 외부 모델 채택 보류

2026-10-15 KST(UTC2026-10-14), HEAD `2b522a416384a511c22c1a88d4e1288fe89d1aae`,
Actions `38598844034` / job `115972492757`: 원본12/12 HTTP200,
원본 독립평가기336셀 전체 배치, 누락0·중복0. 최종 증거는
`runtime-evidence/ocrspace-final-v2-20261014.json`이다.

| 평가 필드 | 독립 결과 |
| --- | --- |
| 직원 행·일자 그룹·날짜·요일 | 각각336/336 (100%) |
| 이름 |329/336 (97.9167%) |
| 상태 |277/336 (82.4405%) |
| SHIFT 출근/퇴근 |각각273/319 (85.5799%) |
| SHIFT 휴게 |272/319 (85.2665%) |
| 판독 불가 |63셀 (실제SHIFT46·OFF4·BLANK9·UNREADABLE4) |
| 원본 위치 좌표 |308/336;저해상도28셀은 좌표 미확정 |

OFF4/4와 BLANK9/9가 UNREADABLE로 남아 상태 식별 수락은 실패했다.
빈칸을 근무나 OFF로 잘못 확정한 수는0이다. `review_required`는 API
미지원이므로 원본 scorer 결과0/336 및 `dangerous_auto_confirmations=336`
을 그대로 보존했다. 이는 Provider 검토 필드의 미충족이며 실제 자동승인,
일정 저장 또는 운영 데이터 변경이 발생했다는 의미가 아니다(실제0).

API 요청 지연은9,267–14,743ms,총143,004ms,평균11,917ms다.
이 시간은 API 왕복이며 브라우저 최종 저장까지의 시간은 아니다.
이번 세션 probe1+전체평가4×12=총49요청 모두 HTTP200. 실제 차감 및
계정 잔여 conversions는 응답에 없어 NOT_MEASURED이며0으로 표기하지 않는다.
Free endpoint/Engine3/소유자 Free 키만 사용했고 유료 전환·fallback은0이다.

판정: API 인증/전체 평가 완료, 외부 OCR 품질 수락 FAIL/PARTIAL.
Cloudflare/Gemini의 이전 결과와 함께 비교 증거를 보존하고 외부 모델은
선택하거나 제품에 활성화하지 않는다. 기존 로컬 Paddle의 검토·승인·원자적
D1 저장 경로를 유지한다. 새 표 변환기는 검증 가능한 소프트웨어 구성요소지만
그 자체를 실제 제품 UI에 연결된 Provider 수락으로 주장하지 않는다.
추가 평가 gate는 닫았고 등록된 키와 당일 Free 확인 이력은 보존했다.
전체 제품 최종 수락은 PARTIAL; 운영 RELEASE HOLD는 계속 유지한다.

Cloudflare의 실제 전체 평가와 Gemini의 실제 요청 결과는 별도 증거로
보존했다. Gemini는 키 등록 문제가 아니라503/timeout으로 전체 수락을
완료하지 못했다. 다음 후보는 사용자 지정 순서의 OCR.space Engine3다.

2026-10-14 공식 API 문서상 Engine3는 Free 플랜에서 월1,000회이며,
무료 파일 제한은1MB다. 현재 합성12개 원본 PNG는 모두 이 범위다.
실제 계정의 잔여 할당량은 아직 확인하지 않았고,공개 데모 키를 사용하지 않는다.

## 완료된 소유자 설정 기록

1. 본인 이메일로 https://ocr.space/ocrapi/freekey 에 접속한다. OCR.space는
   Google Cloud/AI Studio 프로젝트를 고르는 서비스가 아니다. 기존 본인
   Free 키가 있으면 재사용하고,새 Google 프로젝트를 만들지 않는다.
2. `EMAIL`에 본인 이메일을 넣고 `SUBSCRIBE`를 선택한다. 이름과 사용 목적은
   선택 항목이다. 목적을 적는다면 `ComeBackHome schedule OCR evaluation
   using Free Engine 3`로 적을 수 있다. 이메일로 안내되는 확인/키 발급 절차를
   완료한다. 키는 채팅·스크린샷·소스에 넣지 않는다.
3. https://github.com/ydh1121/ComeBackHome/settings/secrets/actions →
   `Secrets` → `New repository secret` → Name을 정확히 `OCRSPACE_API_KEY`,
   Secret에 발급 키 전체 입력 → `Add secret`. 같은 이름이 있으면 Edit/Update.
4. 목록의 `OCRSPACE_API_KEY`와 Free 키 발급 완료를 확인한다. 사용자에게
   필요한 회신은 "OCR.space 무료 키 등록 완료"다. 발급 화면 확인이 필요하면
   키·이메일을 가리고 Free 표시만 공유한다. 카드·PRO·PRO PDF·유료 결제를
   요구하는 화면이면 진행하지 말고 화면 상태를 알려준다.

Gemini 키·Cloudflare 권한·Meta 라이선스 재등록은 필요 없다. 이후 실행자가
날짜가 있는 Free 키 확인을 기록하고 준비된 probe를 실행한다. 사용자가
워크플로를 편집하거나 평가 명령을 실행할 필요는 없다.

## 준비한 검증 범위

`scripts/probe-ocrspace-free.py`와 전용 Actions는 기본적으로 네트워크0
preflight만 수행한다. 실제 키 유무는 불리언으로 확인하며,키 원문을 읽어
로그로 옮기지 않는다. 실제 probe는 지정 repo/기존 PR92/최초 실행/당일 Free
증거와 명시적 commit prefix가 모두 필요하다. 2026-10-14 사용자가
"OCR.space 무료 키 등록 완료"라고 확인했으므로 당일 Free 확인 gate를 연다.
이는 키 존재·인증·잔여량·OCR 정확도 확인과 구분하며 실제 응답으로 검증한다.

공식 HTTPS Free endpoint에 owner key를 header로 보내며,Engine3/auto/table/
overlay와 기존 A 합성 이미지 한 장만 사용한다. 최대1회,120초,응답2MB,
자동 재시도·redirect·URL 업로드·유료 fallback·검색 가능한 PDF 생성 없음.
키·원문 이미지·OCR 원문·Provider 오류 본문은 로그/파일에 남기지 않는다.
반환하는 것은 상태,해시,시간,텍스트/표/overlay 형태의 숫자 계측뿐이다.

2026-10-14 실제 probe: HEAD7432817c, Actions38557218384/job115829227180.
소유자 키 존재와 당일 Free 확인 모두 true, HTTP200/OCRExitCode1,
11,180ms(Provider 처리10,350ms), 원본 A 합성 이미지1회 성공.
Markdown 표6줄 및 유효 좌표94개를 반환했다. 차감/잔여 conversions는
API에 없어 미측정이다. 상태·해시 증거는 `runtime-evidence/ocrspace-probe-20261014.json`.

후속 평가에는 순수 TypeScript `OcrSpaceWeeklyTable` 변환기를 사용한다.
실제 7×3 헤더와 직원 행, 명시적 전체 날짜, 원문 숫자와 OFF만 해석하며
날짜/이름/누락 셀을 정답·파일명·현재 날짜로 복구하지 않는다. 휴무·빈칸·
읽을 수 없는 값을 구별하고 좌표는 완전한 관측 헤더와 원문 행이 있을 때만
반환한다. Provider가 제공하지 않는 `review_required`는 null 그대로 평가하며
제품 수동 승인 정책과 혼동하지 않는다. 재사용한 원본 독립 평가기로
12이미지/336셀을 평가하고 원문 응답/예측은 메모리와 pipe에만 둔다.
첫 전체 평가 Actions38558041803/job115831962993(HEAD32b5b251)는 실제
12/12 HTTP200을 완료했다. 첫 변환기는 22열의 분리된 헤더만 허용하여
63/336셀만 배치하고273셀을 누락했다. 이름56/336, SHIFT 출근61/319,
퇴근61/319, 휴게60/319이며 이는 Provider+변환기 결과다. 이 실패를
`runtime-evidence/ocrspace-original-v2-20261014.json`에 그대로 보존한다.

응답의 Markdown은 일부 헤더를 한 칸에 묶거나 빈 열을 생략한다. 수정한
변환기는 실제 존재하는 21개 순서 있는 헤더 라벨을 펼치고, Markdown
라벨이 빠졌다면 별도로 관측된 완전한 overlay 헤더만 사용한다. 축약된
직원 행은 이름 행과 21개 좌표에 귀속시켜 뒤 날짜로 밀리지 않게 한다.
좌표도 없거나 여러 열에 걸친 값은 복구하지 않는다. OCR 토큰 부재만으로
이미지 빈칸을 확정하지 않으며 UNREADABLE로 남긴다. 새 독립 canary는
병합 헤더·축약 빈칸·열 이동·불완전 헤더 거부를 검증한다.

이 실질적 응답 계약 수정 후 동일 원본12장/독립평가기를 한 번 더 측정한다.
재평가 최대12회, 이번 실행 전체 probe1+첫 평가12+수정 평가12=최대25회.
동일 요청 자동 재시도는 없으며 API 오류면 즉시 중단한다. Free 월1,000회
내의 제한된 합성 시험이고 실제 계정 차감·잔여량은 여전히 미측정이다.

API 성공이나 offline guard PASS를 정확도 또는 제품 수락으로 바꾸지 않는다.
실제 직원 원본·D1·운영 환경 변경은0이다.

2026-10-15 KST 재개(UTC2026-10-14): 두 번째 전체 평가
Actions38559006944/job115835137913, HEAD2131f2ca도12/12 HTTP200.
154/336셀 배치,182누락, 이름147/336, SHIFT 출퇴근 각각143/319,
휴게142/319. 일부 Markdown은 헤더18개만 반환했고 overlay도 완전한
21열이 아니었다. 이 결과는 `runtime-evidence/ocrspace-overlay-v2-20261014.json`
에 그대로 보존한다. 자동 승인이 실제로 실행된 것은0이며, scorer의
review_required 미충족은 Provider 미제공 필드를 null로 남긴 결과다.

남은 변환 문제에는 기존 제품 `ScheduleTableStructureDetector`와
`Weekly3ColumnScheduleMatrix`를 그대로 재사용한다. 원본 이미지 크기의
명암 픽셀에서 실제 표 경계/행/21물리셀/빈칸 근거를 얻고, 독립적으로 읽힌
반복 라벨로 필드 순서를 확인한다. 원본 API 이미지는 변경하지 않는다.
날짜·이름·시간을 정답으로 보정하지 않으며 저해상도에서 물리 경계가
없으면 null 그대로 유지하고 별도 완전한 Markdown 근거만 허용한다.
등록된 원본12개 중11개에서 물리 경계를 검출하고1개는 검출 불가였다.
이 수치는 구조 검출 범위이며 OCR 정확도가 아니다. 새 표 검출기나 정답
평가기, 이미지를 새로 만드는 작업은 하지 않았다.

이 소프트웨어 연결 변경을 검증하는 세 번째 전체 원본 평가를 최대12회만
실행한다. 현재 세션 누적 상한은 probe1+전체평가3×12=37회이며 Free
소유자 확인/당일 gate/기존 PR/첫 실행 조건은 유지한다. 설치·오프라인
검증 단계에는 Provider 키가 없고, 이미지는 메모리/pipe만 사용한다.

세 번째 결과 Actions38597826083/job115969007387(HEADe4026707):12/12
HTTP200,168/336셀 배치,168누락. 이름161/336, SHIFT 출퇴근126/319,
휴게125/319. Engine3 overlay를 제품의 헤더 행 결정에 넣으면7장에서
물리 직원 행 수가 한 행 늘어나는 계약 불일치를 확인했다. 이 실패도
`runtime-evidence/ocrspace-pixel-v2-20261014.json`에 보존한다.

마지막 수정은 overlay 좌표로 물리 헤더를 결정하는 결합을 제거한다.
기존 제품 픽셀 검출이 제공한 행 수와 실제 Markdown 직원 행 수가 정확히
일치해야만 행 순서를 대응시킨다. 축약된 빈 열은 실제21셀의 EMPTY/CONTENT
판정과 모든 비어 있지 않은 OCR 원문의 수·순서가 일치할 때만 복원한다.
불확실한 픽셀·토큰 누락·과잉·행 수 모순은 UNREADABLE/오류로 남긴다.
시간/이름을 추정하는 단계는 없다. 오프라인 canary에 픽셀/텍스트 불일치와
누락 토큰이 뒤 칸으로 밀리지 않는 검사를 추가했다. 동일 원본의 이 변경
검증은 최대12회이며 세션 상한은49회(probe1+전체4×12),동일 요청 자동
재시도·요금제 변경·모델 변경·평가기/정답 수정은0이다.

공식 근거: https://ocr.space/ocrapi / https://ocr.space/ocrapi/freekey

RELEASE_HOLD_UNTIL_OWNER_APPROVAL.
