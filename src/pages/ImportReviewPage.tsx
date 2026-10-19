import { PageSkeleton } from '../shared/components/PageSkeleton';
import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useApplicationServices } from '../app/ApplicationServicesContext';
import { useImportWorkflow } from '../features/import/useImportWorkflow';
import { canImportReviewItem, isReviewOff, reviewSelection } from '../features/import/review-selection';
import { formatDateLabel } from '../features/schedule/date-format';
import { BackButton } from '../shared/components/BackButton';
import { TimeRangeWheelPicker } from '../shared/components/TimeRangeWheelPicker';
import { getPrivateImportImageUrl } from '../application/services/WorkbookImportFileSelectionAction';
import './import-page.css';

export function ImportReviewPage() {
  const { batchId = '' } = useParams();
  const navigate = useNavigate();
  const services = useApplicationServices();
  const workflow = useImportWorkflow(batchId);
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const run = async (action: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '변경하지 못했습니다. 다시 시도해 주세요.'); }
    finally { locked.current = false; setBusy(false); setSaving(false); }
  };

  if (workflow.status === 'loading') return <section className="import-page"><PageSkeleton /></section>;
  if (workflow.status === 'error' || !workflow.batch) return <section className="import-page"><div className="import-message">가져오기 정보를 찾지 못했습니다.</div></section>;
  const batch = workflow.batch;
  const weekly = batch.structure.weeklyReview;
  const privateImageUrl = getPrivateImportImageUrl(batch.id);
  const includedPeople = batch.detectedPeople.filter(person => !person.ignored);
  const includedIds = new Set(includedPeople.map(person => person.id));
  const items = batch.reviewItems.filter(item => includedIds.has(item.detectedPersonId))
    .sort((a,b) => includedPeople.findIndex(person => person.id === a.detectedPersonId) - includedPeople.findIndex(person => person.id === b.detectedPersonId) ||
      (a.date ?? String(a.dayIndex)).localeCompare(b.date ?? String(b.dayIndex)));
  const selected = items.filter(item => reviewSelection(item) === 'NEW');
  const unresolved = items.filter(item => !canImportReviewItem(item));
  const blankItems = items.filter(item => item.sourceCellKind === 'BLANK' && !canImportReviewItem(item));
  const allReviewed = selected.length > 0 && (!weekly || weekly.confirmed) &&
    includedPeople.every(person => person.matchedPersonId || person.pendingCreate) &&
    items.every(item => item.date && (reviewSelection(item) !== 'NEW' || canImportReviewItem(item)));
  const weekStart = weekly?.startDate ?? '';
  const endDate = /^\d{4}-\d{2}-\d{2}$/.test(weekStart) && Number.isFinite(Date.parse(weekStart))
    ? new Date(Date.parse(weekStart + 'T00:00:00Z') + 6 * 86400000).toISOString().slice(0,10) : '';
  const save = () => run(async () => {
    if (!allReviewed) return;
    setSaving(true);
    // Only this explicit final gesture converts the visible proposals to approvals.
    for (const item of items) {
      const choice = reviewSelection(item);
      await services.actions.importReview.setResolution(batch.id, item.id, choice);
    }
    await services.actions.commitImportReview.execute(batch.id);
    const next = (await services.queries.getImportQueue()).find(item => !item.committed && item.id !== batch.id && item.files.some(file => file.status === 'READY'));
    navigate(next ? '/import/' + encodeURIComponent(next.id) + '/people' : '/schedule');
  });

  return <section className="import-page compact-review" data-route={'/import/' + batchId + '/review'} data-page="ImportReviewPage" data-state="REVIEW_REQUIRED CONFLICT_RESOLUTION">
    <BackButton fallbackTo={'/import/' + encodeURIComponent(batch.id) + '/people'} />
    <h1 className="page-title">일정 확인</h1>
    {workflow.queue.length > 1 ? <p className="import-queue-progress">근무표 {workflow.queue.findIndex(item => item.id === batch.id) + 1} / {workflow.queue.length} · {batch.files[0]?.name}</p> : null}
    {weekly ? <section className="import-review-dates" data-state={weekly.confirmed ? 'WEEK_DATES_CONFIRMED' : 'WEEK_DATES_REVIEW_REQUIRED'}>
      <div className="review-week-heading"><strong>{weekStart && endDate ? formatDateLabel(weekStart) + ' – ' + formatDateLabel(endDate) : '주간 날짜를 입력해 주세요'}</strong><span>{weekly.confirmed ? '확인 완료' : '날짜 확인'}</span></div>
      <details className="review-date-edit"><summary>시작일 수정</summary><label>월요일 시작일<input type="date" aria-label="주간 시작일" value={weekStart} disabled={busy} onChange={event => void run(() => services.actions.importReview.setWeeklyStartDate(batch.id,event.target.value))} /></label></details>
      {!weekly.confirmed ? <button type="button" className="review-secondary" disabled={busy || !endDate} onClick={() => void run(() => services.actions.importReview.confirmWeeklyDates(batch.id))}>7일 날짜 확인 및 확정</button> : null}
      {weekly.status === 'MANUAL_RECOVERY_REQUIRED' ? <p className="review-warning">표를 읽지 못했습니다. 원본을 보며 날짜와 시간을 입력해 주세요.</p> : null}
    </section> : null}
    {privateImageUrl ? <details className="import-original-preview"><summary>원본 근무표와 대조</summary><img src={privateImageUrl} alt="가져온 근무표 원본" onLoad={event => setImageSize({width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight})} /></details> : null}
    {unresolved.length ? <div className="review-attention" role="status"><p>확인이 필요한 {unresolved.length}일은 제외했습니다. 수정하거나 휴무로 선택할 수 있어요.</p>{blankItems.length ? <button type="button" className="review-secondary" disabled={busy} onClick={() => void run(async () => {
      for (const item of blankItems) {
        await services.actions.importReview.setImportedEnabled(batch.id,item.id,false);
        await services.actions.importReview.setResolution(batch.id,item.id,'NEW');
      }
    })}>빈칸 {blankItems.length}일을 휴무로 가져오기</button> : null}</div> : null}
    <div className="review-selection-count">가져올 일정 <strong>{selected.length}일</strong><span>제외 {items.length - selected.length}일</span></div>
    <div className="import-review-list">
      {items.map(item => {
        const off = isReviewOff(item);
        const complete = canImportReviewItem(item);
        const choice = reviewSelection(item);
        const detected = includedPeople.find(person => person.id === item.detectedPersonId)!;
        const personName = workflow.people.find(person => person.id === item.personId)?.name ?? detected.pendingCreateName ?? detected.sourceName;
        return <article className={'import-review-item' + (!complete ? ' needs-attention' : '')} key={item.id} data-review-id={item.id} data-person-id={item.detectedPersonId} data-work-date={item.date} data-source-kind={item.sourceCellKind}>
          <label className="review-row">
            <input type="checkbox" aria-label={(item.date ?? '날짜 미확정') + ' ' + personName + ' 가져오기'} checked={choice === 'NEW'} disabled={busy || !complete} onChange={event => void run(() => services.actions.importReview.setResolution(batch.id,item.id,event.target.checked ? 'NEW' : 'SKIP'))} />
            <span className="review-date">{item.date ? formatDateLabel(item.date) : ['월','화','수','목','금','토','일'][item.dayIndex ?? 0]}{includedPeople.length > 1 ? <small>{personName}</small> : null}</span>
            <span className="review-hours"><strong>{off ? '휴무' : complete ? item.imported.start + ' – ' + item.imported.end : item.sourceCellKind === 'BLANK' ? '빈칸' : '확인 필요'}</strong><small>{!off && complete ? '휴게 ' + (item.imported.breakMinutes == null ? '미입력' : item.imported.breakMinutes + '분') : choice === 'NEW' ? '가져오기' : '가져오지 않음'}</small></span>
          </label>
          <details className="review-edit"><summary>수정 · 원본 대조</summary>
            {privateImageUrl && item.sourceRegion && imageSize.width > 0 ? <div className="import-cell-preview"><svg viewBox={`${item.sourceRegion.x} ${item.sourceRegion.y} ${item.sourceRegion.width} ${item.sourceRegion.height}`} role="img" aria-label="원본 출근·퇴근·휴게 세 칸"><image href={privateImageUrl} width={imageSize.width} height={imageSize.height} /></svg></div> : null}
            {item.sourceCellKind === 'BLANK' ? <p className="review-warning">원본이 빈칸입니다. 휴무인지 확인해 주세요.</p> : item.recognitionState === 'UNREADABLE' ? <p className="review-warning">판독 불가 — 원본을 보고 시간을 입력하거나 휴무로 변경해 주세요.</p> : null}
            {item.existing ? <p className="review-existing-note">기존 {item.existing.enabled === false ? '휴무' : item.existing.start + '–' + item.existing.end}{choice === 'NEW' ? ' → 위 일정으로 변경' : ' 유지'}</p> : null}
            <fieldset disabled={busy} className="review-edit-fields">
              <label className="review-off-switch"><input type="checkbox" aria-label="휴무로 변경" checked={off} onChange={event => void run(() => services.actions.importReview.setImportedEnabled(batch.id,item.id,!event.target.checked))} />휴무</label>
              {!off ? <><div className="review-time-editor"><TimeRangeWheelPicker start={item.imported.start} end={item.imported.end} onChange={(kind,value) => services.actions.importReview.setImportedTime(batch.id,item.id,kind,value)} /></div><label className="review-break-editor">휴게시간 (분)<input type="number" min={0} max={720} step={1} inputMode="numeric" aria-label="쉬는시간 분 단위 수정" value={item.imported.breakMinutes ?? ''} placeholder="확인 필요" onChange={event => {
                const value = event.currentTarget.value;
                if (value !== '' && (!/^\d+$/.test(value) || Number(value) > 720)) return;
                void run(() => services.actions.importReview.setImportedBreakMinutes(batch.id,item.id,value === '' ? null : Number(value)));
              }} /></label></> : null}
              {!weekly ? <label>근무 날짜<input type="date" aria-label="근무 날짜 수정" value={item.date ?? ''} onChange={event => void run(() => services.actions.importReview.setImportedDate(batch.id,item.id,event.target.value))} /></label> : null}
            </fieldset>
          </details>
        </article>;
      })}
    </div>
    {!items.length ? <div className="empty-product">가져올 일정이 없습니다. 사람 연결을 확인해 주세요.</div> : null}
    {error ? <div className="import-error" role="alert">저장하지 못했습니다. {error}</div> : null}
    <div className="review-save"><button type="button" className="cta" disabled={!allReviewed || busy} onClick={() => void save()}>{saving ? '저장 중' : '저장'}</button><p>{selected.length}일의 일정을 저장합니다.</p></div>
  </section>;
}
