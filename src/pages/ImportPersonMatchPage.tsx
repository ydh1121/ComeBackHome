import { useState } from 'react';
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
  const [changingDetectedId, setChangingDetectedId] = useState<string | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);

  if (workflow.status === 'loading') {
    return <section className="import-page"><div className="import-message">사람 연결 정보를 불러오는 중</div></section>;
  }
  if (workflow.status === 'error' || !workflow.batch) {
    return <section className="import-page"><div className="import-message">가져오기 정보를 찾지 못했습니다.</div></section>;
  }

  const batch = workflow.batch;
  const allResolved = batch.detectedPeople.length > 0 &&
    batch.detectedPeople.every((detected) => detected.ignored === true || detected.matchedPersonId != null || detected.pendingCreate === true);
  const includedCount = batch.detectedPeople.filter((detected) => detected.ignored !== true && (detected.matchedPersonId != null || detected.pendingCreate === true)).length;

  return (
    <section className="import-page" data-route={'/import/' + batchId + '/people'} data-page="ImportPersonMatchPage" data-state="MATCH_REQUIRED">
      <BackButton fallbackTo="/import" />
      <h1 className="page-title">사람 연결</h1>

      <div className="mapping-list">
        {batch.detectedPeople.map((detected) => {
          const value = detected.ignored === true ? '__ignore__'
            : detected.pendingCreate === true ? '__create__' : detected.matchedPersonId ?? '';
          const duplicateName = workflow.people.some(person =>
            person.name.normalize('NFKC').replace(/\s+/g, '').toLowerCase() ===
            detected.sourceName.normalize('NFKC').replace(/\s+/g, '').toLowerCase());
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
                disabled={changingDetectedId === detected.id}
                onChange={async (event) => {
                  const next = event.target.value;
                  setMatchError(null);
                  setChangingDetectedId(detected.id);
                  try {
                    if (next === '__ignore__') {
                      await services.actions.importMatch.setPersonIgnored(batch.id, detected.id, true);
                    } else if (next === '__create__') {
                      if (duplicateName) {
                        throw new Error('동일한 이름의 직원이 있습니다. 기존 직원 연결을 먼저 확인해 주세요.');
                      }
                      // Never POST /people before final reviewed D1 transaction.
                      await services.actions.importMatch.setPendingPersonCreate(batch.id, detected.id, true);
                    } else {
                      await services.actions.importMatch.setPersonMatch(
                        batch.id, detected.id, next || null,
                      );
                    }
                  } catch (error) {
                    setMatchError(error instanceof Error ? error.message : '직원 연결을 변경하지 못했습니다.');
                  } finally {
                    setChangingDetectedId(null);
                  }
                }}
              >
                <option value="">연결 안 됨</option>
                {workflow.people.map((person) => (
                  <option value={person.id} key={person.id}>{person.name}{person.relation ? ' · ' + person.relation : ''}</option>
                ))}
                {!detected.sourceName.startsWith('인식불가 직원 ') ? (
                  <option value="__create__" disabled={duplicateName}>
                    “{detected.sourceName}” 승인 후 새 사람 등록
                  </option>
                ) : null}
                <option value="__ignore__">가져오지 않음</option>
              </select>
            </div>
          );
        })}
      </div>

      {matchError ? <p className="import-error" role="alert">{matchError}</p> : null}
      <div className="mapping-summary">가져올 사람 {includedCount}명 · 신규 직원은 최종 승인 후 생성</div>
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
