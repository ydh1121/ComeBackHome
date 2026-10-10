import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useApplicationServices } from '../app/ApplicationServicesContext';
import { useImportWorkflow } from '../features/import/useImportWorkflow';
import { formatDateLabel } from '../features/schedule/date-format';
import { BackButton } from '../shared/components/BackButton';
import { Icon } from '../shared/components/Icon';
import { TimeRangeWheelPicker } from '../shared/components/TimeRangeWheelPicker';
import { getPrivateImportImageUrl } from '../application/services/WorkbookImportFileSelectionAction';
import './import-page.css';

export function ImportReviewPage() {
  const { batchId = '' } = useParams();
  const navigate = useNavigate();
  const services = useApplicationServices();
  const workflow = useImportWorkflow(batchId);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error'>('idle');
  const [dateError, setDateError] = useState<string | null>(null);

  if (workflow.status === 'loading') {
    return <section className="import-page"><div className="import-message">일정을 불러오는 중</div></section>;
  }
  if (workflow.status === 'error' || !workflow.batch) {
    return <section className="import-page"><div className="import-message">가져오기 정보를 찾지 못했습니다.</div></section>;
  }

  const batch = workflow.batch;
  const weekly3ColumnReview = batch.structure.sheet ===
    'weekly 7 day x start/end/break physical matrix';
  const weeklyReview = batch.structure.weeklyReview;
  const privateImageUrl = getPrivateImportImageUrl(batch.id);
  const weekStart = weeklyReview?.startDate??'';
  const validatedWeekStart = /^\d{4}-\d{2}-\d{2}$/.test(weekStart)
    ? Date.parse(weekStart+'T00:00:00Z') : NaN;
  const weekPreview = Number.isFinite(validatedWeekStart)
    ? Array.from({length:7},(_,i)=>
        new Date(validatedWeekStart+i*86400000).toISOString().slice(0,10))
    : [];
  const pendingPersons=new Map(batch.detectedPeople
    .filter(person=>person.pendingCreateName)
    .map(person=>[person.id,person.pendingCreateName!] as const));
  const ignoredDetectedIds = new Set(
    batch.detectedPeople.filter((person) => person.ignored === true).map((person) => person.id),
  );
  const importedTimeComplete = (item: (typeof batch.reviewItems)[number]) =>
    item.imported.enabled === false ||
    (item.imported.start != null && item.imported.end != null &&
     (!weekly3ColumnReview || !item.breakReviewRequired ||
      item.imported.breakMinutes != null));
  const exactDuplicate = (item: (typeof batch.reviewItems)[number]) =>
    item.existing != null &&
    (
      (item.imported.enabled === false && item.existing.enabled === false) ||
      (
        item.imported.enabled !== false &&
        item.existing.enabled !== false &&
        item.imported.start != null &&
        item.imported.end != null &&
        item.existing.start === item.imported.start &&
        item.existing.end === item.imported.end &&
        (!weekly3ColumnReview || (item.existing.breakMinutes ?? null) === (item.imported.breakMinutes ?? null))
      )
    );
  const visibleReviewItems = batch.reviewItems.filter(
    (item) =>
      !ignoredDetectedIds.has(item.detectedPersonId) &&
      (weekly3ColumnReview || !exactDuplicate(item)),
  );
  const allReviewed = visibleReviewItems.length>0 &&
    (!weeklyReview || weeklyReview.confirmed===true) &&
    visibleReviewItems.every((item) =>
    item.date != null && (item.personId != null ||
      pendingPersons.has(item.detectedPersonId)) &&
    (
      item.resolution === 'SKIP' ||
      (item.resolution === 'NEW' && importedTimeComplete(item))
    )
  );

  const save = async () => {
    if (!allReviewed) return;
    setSaveState('saving');
    try {
      await services.actions.commitImportReview.execute(batch.id);
      navigate('/schedule');
    } catch {
      setSaveState('error');
    }
  };

  return (
    <section className="import-page" data-route={'/import/' + batchId + '/review'} data-page="ImportReviewPage" data-state="REVIEW_REQUIRED CONFLICT_RESOLUTION">
      <BackButton fallbackTo={'/import/' + encodeURIComponent(batch.id) + '/structure'} />
      <h1 className="page-title">일정 확인</h1>
      {weeklyReview ? (
        <section className="import-review-dates" data-state={weeklyReview.confirmed
          ? 'WEEK_DATES_CONFIRMED':'WEEK_DATES_REVIEW_REQUIRED'}>
          <h2>주간 날짜 확인</h2>
          <p>{weeklyReview.status==='MANUAL_RECOVERY_REQUIRED'
            ? '표 구조를 자동 인식하지 못했습니다. 이미지와 비교하여 직접 입력해 주세요.'
            : weeklyReview.status==='PARTIAL_REVIEW_REQUIRED'
              ? '일부 날짜를 읽지 못했습니다. 시작일을 확인해 주세요.'
              : '날짜를 인식했습니다. 원본과 일치하는지 확인해 주세요.'}</p>
          <label>월요일 시작일
            <input type="date" aria-label="주간 시작일" value={weekStart}
              onChange={async event=>{
                try{
                  setDateError(null);
                  await services.actions.importReview.setWeeklyStartDate(batch.id,event.target.value);
                }catch(error){
                  setDateError(error instanceof Error?error.message:'주간 시작일을 확인해 주세요.');
                }
              }} />
          </label>
          {weekPreview.length ? (
            <ol className="import-week-preview">
              {weekPreview.map((date,i)=><li key={date}>{['월','화','수','목','금','토','일'][i]} {date}</li>)}
            </ol>
          ) : <p>날짜 미확정 — 저장할 수 없습니다.</p>}
          {dateError ? <p role="alert">{dateError}</p> : null}
          <button type="button" className="review-choice import-toggle"
            disabled={!weekPreview.length||weeklyReview.confirmed}
            onClick={async()=>{
              try{
                setDateError(null);
                await services.actions.importReview.confirmWeeklyDates(batch.id);
              }catch(error){
                setDateError(error instanceof Error?error.message:'날짜 확정에 실패했습니다.');
              }
            }}>
            {weeklyReview.confirmed?'주간 날짜 확인 완료':'7일 날짜 확인 및 확정'}
          </button>
          {!weeklyReview.confirmed ? <p role="status">날짜 승인 전에는 DB에 저장되지 않습니다.</p> : null}
        </section>
      ) : null}
      {privateImageUrl ? (
        <details className="import-original-preview">
          <summary>원본 근무표와 대조</summary>
          <img src={privateImageUrl} alt="가져온 근무표 원본" style={{maxWidth:'100%',height:'auto'}} />
          <p>이 사진은 브라우저 메모리에서만 표시됩니다. 새로고침 후에는 다시 표시되지 않을 수 있습니다.</p>
        </details>
      ) : null}

      {visibleReviewItems.length ? (
        <div className="import-review-list">
          {visibleReviewItems.map((item) => {
            const person = workflow.people.find((candidate) => candidate.id === item.personId);
            const importedComplete = importedTimeComplete(item);
            return (
              <div className="import-review-item" key={item.id}>
                <div className="import-review-head">
                  <div className="review-date">{item.date ? formatDateLabel(item.date) : '날짜 확인 필요'} 일정</div>
                  <div className={'review-person' + (item.personId ? '' : ' unresolved')}>
                    {person?.name ?? (pendingPersons.get(item.detectedPersonId)
                      ? pendingPersons.get(item.detectedPersonId)+' (신규 등록 예정)'
                      : '사람 연결 필요')}
                  </div>
                </div>

                {item.recognitionState ? (
                  <div className={'review-recognition-state ' + item.recognitionState.toLowerCase()}>
                    {item.recognitionState === 'OFF'
                      ? '휴무로 인식'
                      : item.recognitionState === 'OFF_CANDIDATE'
                        ? '휴무 후보 — 세 칸 모두 비어 있지만 직접 확인 전까지 확정되지 않음'
                      : item.recognitionState === 'UNREADABLE'
                        ? weekly3ColumnReview && item.imported.start == null && item.imported.end == null
                          ? '빈칸·휴무 후보 — 근무인지 휴무인지 직접 확인 필요'
                          : '인식 불확실 — 이미지에 내용은 있으나 시간을 읽지 못함'
                        : item.recognitionState === 'INCOMPLETE'
                          ? '근무시간 일부만 인식'
                          : '근무로 인식'}
                  </div>
                ) : null}

                {weekly3ColumnReview && (item.recognitionState === 'UNREADABLE' ||
                  item.recognitionState === 'OFF_CANDIDATE') ? (
                  <button
                    type="button"
                    className="review-choice import-toggle"
                    aria-pressed={item.imported.enabled === false}
                    onClick={() => services.actions.importReview.setImportedEnabled(
                      batch.id,
                      item.id,
                      item.imported.enabled !== false ? false : true,
                    )}
                  >
                    {item.imported.enabled === false
                      ? '근무시간 입력으로 변경'
                      : '휴무로 변경 (본인이 확인 후 선택)'}
                  </button>
                ) : null}

                {item.imported.enabled !== false && (weekly3ColumnReview || !importedComplete) ? (
                  <div className="review-time-editor" data-state={item.recognitionState === 'UNREADABLE' || item.recognitionState === 'OFF_CANDIDATE' ? 'UNREADABLE_TIME' : 'INCOMPLETE_TIME'}>
                    <TimeRangeWheelPicker
                      start={item.imported.start}
                      end={item.imported.end}
                      onChange={(kind, value) =>
                        services.actions.importReview.setImportedTime(
                          batch.id,
                          item.id,
                          kind,
                          value,
                        )
                      }
                    />
                  </div>
                ) : null}

                {weekly3ColumnReview && item.imported.enabled !== false ? (
                  <label className="review-break-editor" data-field="breakMinutes">
                    쉬는시간 (분)
                    <input
                      type="number"
                      min={0}
                      max={720}
                      step={1}
                      inputMode="numeric"
                      aria-label="쉬는시간 분 단위 수정"
                      value={item.imported.breakMinutes ?? ''}
                      placeholder="확인 필요"
                      onChange={(event) => {
                        const raw = event.currentTarget.value;
                        if (raw !== '' && (!/^\\d+$/.test(raw) || Number(raw) > 720)) return;
                        void services.actions.importReview.setImportedBreakMinutes(
                          batch.id, item.id, raw === '' ? null : Number(raw),
                        );
                      }}
                    />
                  </label>
                ) : null}

                <div className="review-choice-list">
                  {item.existing && !exactDuplicate(item) ? (
                    <div className="review-existing-note">
                      {item.existing.enabled === false
                        ? '기존 휴무'
                        : '기존 ' + item.existing.start + '–' + item.existing.end}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className={'review-choice import-toggle' + (item.resolution === 'NEW' ? ' selected' : '')}
                    aria-pressed={item.resolution === 'NEW'}
                    disabled={(!item.personId&&!pendingPersons.has(item.detectedPersonId)) || !importedComplete}
                    onClick={() => services.actions.importReview.setResolution(
                      batch.id,
                      item.id,
                      item.resolution === 'NEW' ? 'SKIP' : 'NEW',
                    )}
                  >
                    <span className="review-choice-check">{item.resolution === 'NEW' ? <Icon name="check" /> : null}</span>
                    <span className="review-choice-label">가져오기</span>
                    <strong className="review-choice-time">
                      {item.imported.enabled === false
                        ? '휴무'
                        : (item.imported.start ?? '입력 필요') + '–' + (item.imported.end ?? '입력 필요')}
                    </strong>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : <div className="empty-product">새로 가져올 일정이 없습니다.</div>}

      {saveState === 'error' ? <div className="import-error" role="alert">저장하지 못했습니다.</div> : null}

      <button type="button" className="cta" disabled={!allReviewed || saveState === 'saving'} onClick={save}>
        {saveState === 'saving' ? '저장 중' : '저장'}
      </button>
    </section>
  );
}
