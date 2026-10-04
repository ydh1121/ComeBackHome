import { useNavigate, useParams } from 'react-router';
import { useImportWorkflow } from '../features/import/useImportWorkflow';
import { BackButton } from '../shared/components/BackButton';
import './import-page.css';

export function ImportStructurePage() {
  const { batchId = '' } = useParams();
  const navigate = useNavigate();
  const workflow = useImportWorkflow(batchId);

  if (workflow.status === 'loading') {
    return <section className="import-page"><div className="import-message">표 구조를 불러오는 중</div></section>;
  }
  if (workflow.status === 'error' || !workflow.batch) {
    return <section className="import-page"><div className="import-message">가져오기 정보를 찾지 못했습니다.</div></section>;
  }

  const { batch } = workflow;
  const structure = batch.structure;

  return (
    <section className="import-page" data-route={'/import/' + batchId + '/structure'} data-page="ImportStructurePage" data-state="STRUCTURE_REVIEW">
      <BackButton fallbackTo={'/import/' + encodeURIComponent(batch.id) + '/people'} />
      <h1 className="page-title">표 구조 확인</h1>

      <div className="structure-grid">
        <div className="structure-row"><span>시트</span><div className="structure-value">{structure.sheet}</div></div>
        <div className="structure-row"><span>머리글 행</span><div className="structure-value">{structure.headerRow}</div></div>
        <div className="structure-row"><span>사람 열</span><div className="structure-value">{structure.personColumn}</div></div>
        <div className="structure-row"><span>날짜 열</span><div className="structure-value">{structure.dateColumn}</div></div>
        <div className="structure-row"><span>근무시간 열</span><div className="structure-value">{structure.shiftColumn}</div></div>
      </div>

      <p className="research-note">자동 인식이 확실하지 않을 때만 이 단계가 나타납니다.</p>

      <button
        type="button"
        className="cta"
        onClick={() => navigate('/import/' + encodeURIComponent(batch.id) + '/review')}
      >
        계속
      </button>
    </section>
  );
}
