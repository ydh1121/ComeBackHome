# OCR.space Engine3 무료 인증 준비

Cloudflare의 실제 전체 평가와 Gemini의 실제 요청 결과는 별도 증거로
보존했다. Gemini는 키 등록 문제가 아니라503/timeout으로 전체 수락을
완료하지 못했다. 다음 후보는 사용자 지정 순서의 OCR.space Engine3다.

2026-10-14 공식 API 문서상 Engine3는 Free 플랜에서 월1,000회이며,
무료 파일 제한은1MB다. 현재 합성12개 원본 PNG는 모두 이 범위다.
실제 계정의 잔여 할당량은 아직 확인하지 않았고,공개 데모 키를 사용하지 않는다.

## 소유자가 필요한 설정

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
증거와 명시적 commit prefix가 모두 필요하다. 현재 Free 확인 gate는 닫혀 있다.

공식 HTTPS Free endpoint에 owner key를 header로 보내며,Engine3/auto/table/
overlay와 기존 A 합성 이미지 한 장만 사용한다. 최대1회,120초,응답2MB,
자동 재시도·redirect·URL 업로드·유료 fallback·검색 가능한 PDF 생성 없음.
키·원문 이미지·OCR 원문·Provider 오류 본문은 로그/파일에 남기지 않는다.
반환하는 것은 상태,해시,시간,텍스트/표/overlay 형태의 숫자 계측뿐이다.

이 단계는 실제 응답 계약 확인이다. OCR.space의 Markdown/overlay를 기존
7×3 검토 계약에 연결하고 원본12이미지/336셀 독립 평가를 수행하는 후속
작업은 아직 실행하지 않았다. API 성공이나 offline guard PASS를 정확도 또는
제품 수락으로 바꾸지 않는다. 실제 직원 원본·D1·운영 환경 변경은0이다.

공식 근거: https://ocr.space/ocrapi / https://ocr.space/ocrapi/freekey

RELEASE_HOLD_UNTIL_OWNER_APPROVAL.
