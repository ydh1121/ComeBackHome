import { useNavigate, useParams } from 'react-router';
import { useApplicationServices } from '../app/ApplicationServicesContext';
import { useImportWorkflow } from '../features/import/useImportWorkflow';
import { BackButton } from '../shared/components/BackButton';
import { Icon } from '../shared/components/Icon';
import './import-page.css';

export function ImportPersonMatchPage() {
  const { batchId = '' } = useParams();
  const navigate = useNavigate();
  const services = useApplicationServices();
  const workflow = useImportWorkflow(batchId);

  if (workflow.status === 'loading') {
    return <section className="import-page"><div className="import-message">사람 연결 정보를 불러오는 중</div></section>;
  }
  if (workflow.status === 'error' || !workflow.batch) {
    return <section className="import-page"><div className="import-message">가져오기 정보를 찾지 못했습니다.</div></section>;
  }

  const batch = workflow.batch;
  const allMatched = batch.detectedPeople.length > 0 &&
    batch.detectedPeople.every((detected) => detected.matchedPersonId != null);

  return (
    <section className="import-page" data-route={'/import/' + batchId + '/people'} data-page="ImportPersonMatchPage" data-state="MATCH_REQUIRED">
      <BackButton fallbackTo="/import" />
      <h1 className="page-title">사람 연결</h1>

      <div className="mapping-list">
        {batch.detectedPeople.map((detected) => {
          const matched = workflow.people.find((person) => person.id === detected.matchedPersonId);
          return (
            <div className="mapping-row" key={detected.id}>
              <div>
                <b>{detected.sourceName}</b>
                <div className="row-sub">인식 신뢰도 {Math.round(detected.confidence * 100)}%</div>
              </div>
              <button
                type="button"
                className="mapping-select"
                onClick={() => services.actions.importMatch.cyclePersonMatch(batch.id, detected.id)}
              >
                <span>{matched?.name ?? '연결 안 됨'}</span>
                <Icon name="chevron-down" />
              </button>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className="cta"
        disabled={!allMatched}
        onClick={() => navigate('/import/' + encodeURIComponent(batch.id) + '/structure')}
      >
        다음
      </button>
    </section>
  );
}
