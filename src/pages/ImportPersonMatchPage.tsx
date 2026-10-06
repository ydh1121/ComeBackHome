import { useNavigate, useParams } from 'react-router';
import { useApplicationServices } from '../app/ApplicationServicesContext';
import { useImportWorkflow } from '../features/import/useImportWorkflow';
import { BackButton } from '../shared/components/BackButton';
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
  const allResolved = batch.detectedPeople.length > 0 &&
    batch.detectedPeople.every((detected) => detected.ignored === true || detected.matchedPersonId != null);
  const includedCount = batch.detectedPeople.filter((detected) => detected.ignored !== true && detected.matchedPersonId != null).length;

  return (
    <section className="import-page" data-route={'/import/' + batchId + '/people'} data-page="ImportPersonMatchPage" data-state="MATCH_REQUIRED">
      <BackButton fallbackTo="/import" />
      <h1 className="page-title">사람 연결</h1>

      <div className="mapping-list">
        {batch.detectedPeople.map((detected) => {
          const value = detected.ignored === true ? '__ignore__' : detected.matchedPersonId ?? '';
          return (
            <div className="mapping-row" key={detected.id}>
              <div>
                <b>{detected.sourceName}</b>
                <div className="row-sub">인식 신뢰도 {Math.round(detected.confidence * 100)}%</div>
              </div>
              <select
                className="mapping-native-select"
                aria-label={detected.sourceName + ' 일정 대상 연결'}
                value={value}
                onChange={(event) => {
                  const next = event.target.value;
                  if (next === '__ignore__') {
                    void services.actions.importMatch.setPersonIgnored(batch.id, detected.id, true);
                    return;
                  }
                  void services.actions.importMatch.setPersonMatch(
                    batch.id,
                    detected.id,
                    next || null,
                  );
                }}
              >
                <option value="">연결 안 됨</option>
                {workflow.people.map((person) => (
                  <option value={person.id} key={person.id}>{person.name}{person.relation ? ' · ' + person.relation : ''}</option>
                ))}
                <option value="__ignore__">가져오지 않음</option>
              </select>
            </div>
          );
        })}
      </div>

      <div className="mapping-summary">가져올 사람 {includedCount}명</div>
      <button
        type="button"
        className="cta"
        disabled={!allResolved || includedCount === 0}
        onClick={() => navigate('/import/' + encodeURIComponent(batch.id) + '/structure')}
      >
        다음
      </button>
    </section>
  );
}
