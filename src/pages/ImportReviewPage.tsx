import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useApplicationServices } from '../app/ApplicationServicesContext';
import { useImportWorkflow } from '../features/import/useImportWorkflow';
import { formatDateLabel } from '../features/schedule/date-format';
import { BackButton } from '../shared/components/BackButton';
import { Icon } from '../shared/components/Icon';
import './import-page.css';

export function ImportReviewPage() {
  const { batchId = '' } = useParams();
  const navigate = useNavigate();
  const services = useApplicationServices();
  const workflow = useImportWorkflow(batchId);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error'>('idle');

  if (workflow.status === 'loading') {
    return <section className="import-page"><div className="import-message">일정을 불러오는 중</div></section>;
  }
  if (workflow.status === 'error' || !workflow.batch) {
    return <section className="import-page"><div className="import-message">가져오기 정보를 찾지 못했습니다.</div></section>;
  }

  const batch = workflow.batch;
  const importedTimeComplete = (item: (typeof batch.reviewItems)[number]) =>
    item.imported.start != null && item.imported.end != null;
  const allReviewed = batch.reviewItems.length > 0 &&
    batch.reviewItems.every((item) =>
      item.personId != null &&
      (
        item.resolution === 'KEEP' ||
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

      {batch.reviewItems.length ? (
        <div className="import-review-list">
          {batch.reviewItems.map((item) => {
            const person = workflow.people.find((candidate) => candidate.id === item.personId);
            const importedComplete = importedTimeComplete(item);
            return (
              <div className="import-review-item" key={item.id}>
                <div className="import-review-head">
                  <div className="review-date">{formatDateLabel(item.date)} 일정</div>
                  <div className={'review-person' + (item.personId ? '' : ' unresolved')}>
                    {person?.name ?? '사람 연결 필요'}
                  </div>
                </div>

                {!importedComplete ? (
                  <div className="review-time-editor" data-state="INCOMPLETE_TIME">
                    <label className="review-time-field">
                      <span>출근</span>
                      <input
                        className="review-time-input"
                        type="time"
                        value={item.imported.start ?? ''}
                        onChange={(event) => {
                          void services.actions.importReview.setImportedTime(
                            batch.id,
                            item.id,
                            'start',
                            event.currentTarget.value || null,
                          );
                        }}
                      />
                    </label>
                    <span className="review-time-separator">–</span>
                    <label className="review-time-field">
                      <span>퇴근</span>
                      <input
                        className="review-time-input"
                        type="time"
                        value={item.imported.end ?? ''}
                        onChange={(event) => {
                          void services.actions.importReview.setImportedTime(
                            batch.id,
                            item.id,
                            'end',
                            event.currentTarget.value || null,
                          );
                        }}
                      />
                    </label>
                  </div>
                ) : null}

                <div className="review-choice-list">
                  <button
                    type="button"
                    className={'review-choice' + (item.resolution === 'KEEP' ? ' selected' : '')}
                    aria-pressed={item.resolution === 'KEEP'}
                    disabled={!item.existing || !item.personId}
                    onClick={() => services.actions.importReview.setResolution(batch.id, item.id, 'KEEP')}
                  >
                    <span className="review-choice-label">기존 일정</span>
                    <strong className="review-choice-time">{item.existing?.start ?? '—'}–{item.existing?.end ?? '—'}</strong>
                    <span className="review-choice-check">{item.resolution === 'KEEP' ? <Icon name="check" /> : null}</span>
                  </button>

                  <button
                    type="button"
                    className={'review-choice' + (item.resolution === 'NEW' ? ' selected' : '')}
                    aria-pressed={item.resolution === 'NEW'}
                    disabled={!item.personId || !importedComplete}
                    onClick={() => services.actions.importReview.setResolution(batch.id, item.id, 'NEW')}
                  >
                    <span className="review-choice-label">가져온 일정</span>
                    <strong className="review-choice-time">{item.imported.start ?? '입력 필요'}–{item.imported.end ?? '입력 필요'}</strong>
                    <span className="review-choice-check">{item.resolution === 'NEW' ? <Icon name="check" /> : null}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : <div className="empty-product">확인할 일정이 없습니다.</div>}

      {saveState === 'error' ? <div className="import-error" role="alert">저장하지 못했습니다.</div> : null}

      <button type="button" className="cta" disabled={!allReviewed || saveState === 'saving'} onClick={save}>
        {saveState === 'saving' ? '저장 중' : '저장'}
      </button>
    </section>
  );
}
