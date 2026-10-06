import './qa-page.css';

export function QaFlowMapPage() {
  return (
    <section className="qa-page" data-route="/__qa/flow" data-page="FlowMap" data-state="READY">
      <h1 className="page-title">화면 흐름</h1>
      <div className="flow">
        <div className="flow-node">오늘</div>
        <div className="flow-arrow">↓</div>
        <div className="flow-split">
          <div className="flow-node">일정 → 일괄 입력</div>
          <div className="flow-node">가져오기 → 사람 연결 → 구조 확인 → 검토</div>
        </div>
        <div className="flow-arrow">↓</div>
        <div className="flow-node">사람 → 추가/수정/상세 → 경로 설정 → 내 경로 편집</div>
        <div className="flow-arrow">↓</div>
        <div className="flow-node">출발·도착 수정 → 근처 교통 → 검색/버스</div>
        <div className="flow-arrow">↓</div>
        <div className="flow-node">설정 → 알림 권한/규칙/테스트</div>
        <div className="flow-arrow">↓</div>
        <div className="flow-node">설정 → 퇴근·귀가 단축어 자동화</div>
      </div>
    </section>
  );
}
