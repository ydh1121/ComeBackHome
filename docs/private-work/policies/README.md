# 계산 정책 초기 자료

`2026-confirmed.json`은 공개 공식 자료만으로 만든 **검토 후 가져오기용 데이터**다. 앱에 자동 적용하거나 소스의 기본 계산값으로 사용하지 않는다. 개인의 임금·진단·이직사유·수급자격은 포함하지 않는다.

운영 승인 및 초기 설정 이후 관리자 로그인 → 산재 → 접근·이력 → 계산 정책과 공식 근거 → 정책 파일 불러오기에서 이 파일을 선택한다. 종류·출처·기간·값을 검토한 뒤 저장한다. 각 정책은 D1에 새 버전으로 저장되고, 이후 화면에서 한국어 항목별로 수정해 새 버전을 만들 수 있다. 기존 버전과 작성 이력은 보존한다. 같은 파일 재입력은 중복 생성하지 않으며 같은 버전명으로 값이 다르면 저장을 거절한다.

검증일은 **2026-10-24 KST**다. 이번 자료의 적용 범위를 2026-10-08~2026-11-26으로 제한했다. 종료일은 모든 법령의 법정 만료일이라는 뜻이 아니라, 다음 고용보험법 시행 변경 전에 다시 검토하도록 정한 앱의 보수적인 적용 범위다. 이 범위를 벗어난 계산에는 새 정책 버전이 필요하다.

| 정책 | 공식 근거와 적용 범위 |
| --- | --- |
| 휴업급여 | [산재보험법 제54조](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?lsJoLnkSeq=1032080823), [제52조](https://law.go.kr/LSW/lsLinkCommonInfo.do?lsJoLnkSeq=1017431347), [2026 최고·최저 보상기준](https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=2100000271500&chrClsCd=010201). 요양 승인기간과 실제 취업불능 일수를 분리하며 부분근로·고령 등 특례는 자동 산출하지 않는다. |
| 구직급여 | [공식 수급액 설명](https://easylaw.go.kr/CSP/CnpClsMain.laf?ccfNo=2&cciNo=3&cnpClsNo=2&csmSeq=722&popMenu=ov), [2026 고용노동부 안내](https://1350.moel.go.kr/rtmview.do?id=1000324861). 일반 8시간 산식이며 단시간 산식은 별도 확인한다. |
| 고용보험 기간 | [고용보험법 제40·41·50조 설명](https://www.easylaw.go.kr/CSP/CnpClsMainBtr.laf?ccfNo=2&cciNo=1&cnpClsNo=1&csmSeq=722&popMenu=ov). 유급일 180일과 피보험기간의 달력일을 따로 계산한다. 과거 수급에 사용한 기간, 중복 직장 및 증빙 없는 일수를 확정일로 합산하지 않는다. |
| 임금·퇴직금·연차 | [고용노동부 퇴직금 산식](https://www.moel.go.kr/retirementpayCal.do), [근로기준법 제56조](https://law.go.kr/LSW/lsInfoP.do?lsiSeq=285279), [제60조](https://law.go.kr/LSW/lsLinkCommonInfo.do?lsJoLnkSeq=1012792285). 소정시간·상시근로자 수·지급명세 확인이 필요하며 연차 소멸과 사용촉진은 별도 확인한다. |
| 기한 | [시행령 제40조](https://www.law.go.kr/LSW/lsSideInfoP.do?docCls=jo&joBrNo=00&joNo=0040&lsiSeq=287491&urlMode=lsScJoRltInfoR), [제103조](https://law.go.kr/LSW/lsLinkCommonInfo.do?lsJoLnkSeq=1026601771), [공단 요양업무처리규정](https://www.law.go.kr/LSW/schlPubRulInfoP.do?schlPubRulSeq=2200000158587). T-14·T-10 및 접수 후 진행 문의는 앱의 권장일이다. T-7 진료계획은 의료기관의 제출 확인이며 자동 연장·승인 판단이 아니다. |

기한은 앱 안의 ‘확인할 기한’에서 표시한다. v0.7 원장 `55_v07_기한알림`의 UI 알림 계약에 맞춘 것이다. 이 모듈은 기존 출퇴근 Push/Outbox를 사용하거나 변경하지 않으며, 별도 산재 Push 전송을 구현·활성화한 것으로 표시하지 않는다.
