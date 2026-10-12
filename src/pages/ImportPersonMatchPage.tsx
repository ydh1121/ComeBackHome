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
  const [manualPersonId, setManualPersonId] = useState('');
  const [proposedNames,setProposedNames]=useState<Record<string,string>>({});

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
      {batch.structure.weeklyReview?.status==='MANUAL_RECOVERY_REQUIRED' ? (
        <div className="mapping-row" data-state="MANUAL_RECOVERY_REQUIRED">
          <p>표를 자동으로 읽지 못했습니다. 기존 등록 직원 중 근무표에 있는 사람을 선택해 주간 일정 7칸을 만드세요.</p>
          <select className="mapping-native-select"
            aria-label="수동 등록할 직원" value={manualPersonId}
            onChange={event=>setManualPersonId(event.target.value)}>
            <option value="">직원 선택</option>
            {workflow.people.filter(person=>!batch.detectedPeople.some(
              item=>item.matchedPersonId===person.id)).map(person=>
              <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
          <button className="review-choice import-toggle" type="button"
            disabled={!manualPersonId || changingDetectedId != null}
            onClick={async()=>{
              setChangingDetectedId('manual');
              try {
                await services.actions.importMatch.addManualPerson(batch.id,manualPersonId);
                setManualPersonId('');
                setMatchError(null);
              } catch (error) {
                setMatchError(error instanceof Error ? error.message : '직원을 추가하지 못했습니다.');
              } finally { setChangingDetectedId(null); }
            }}>직원 주간 일정 추가</button>
        </div>
      ) : null}

      <div className="mapping-list">
        {batch.detectedPeople.map((detected) => {
          const proposal = proposedNames[detected.id] ?? detected.pendingCreateName ??
            (detected.sourceName.startsWith('인식불가 직원 ') ? '' : detected.sourceName);
          const value = detected.ignored === true ? '__ignore__'
            : detected.pendingCreate === true ? '__create__' : detected.matchedPersonId ?? '';
          const duplicateName = workflow.people.some(person =>
            person.name.normalize('NFKC').replace(/\s+/g, '').toLowerCase() ===
            proposal.normalize('NFKC').replace(/\s+/g, '').toLowerCase());
          return (
            <div className="mapping-row" key={detected.id}>
              <div>
                <b>{detected.sourceName}</b>
                <div className="row-sub">인식 신뢰도 {Math.round(detected.confidence * 100)}%</div>
                {batch.structure.weeklyReview && !detected.matchedPersonId ? (
                  <label className="row-sub">신규 직원 이름 확인
                    <input type="text" maxLength={50}
                      aria-label={detected.sourceName+' 신규 직원 이름'}
                      value={proposal}
                      onChange={event=>{
                        setProposedNames(prev=>({...prev,[detected.id]:event.target.value}));
                        if (detected.pendingCreate) void services.actions.importMatch.setPendingPersonCreate(batch.id,detected.id,false);
                      }}/>
                  </label>
                ):null}
                {detected.pendingCreateName ? <div className="row-sub">
                  신규 직원 “{detected.pendingCreateName}” — 최종 저장 시 생성 예정
                </div> : null}
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
                      if (batch.structure.weeklyReview) {
                        await services.actions.importMatch.setPendingNewPerson(batch.id, detected.id, proposal);
                      } else {
                        await services.actions.importMatch.setPendingPersonCreate(batch.id, detected.id, true);
                      }
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
                {!detected.sourceName.startsWith('인식불가 직원 ') || batch.structure.weeklyReview ? (
                  <option value="__create__" disabled={duplicateName || !proposal.trim()}>
                    “{proposal}” 승인 후 새 사람 등록
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
