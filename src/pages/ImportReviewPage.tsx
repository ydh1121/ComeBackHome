import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useApplicationServices } from '../app/ApplicationServicesContext';
import { useImportWorkflow } from '../features/import/useImportWorkflow';
import { formatDateLabel } from '../features/schedule/date-format';
import { BackButton } from '../shared/components/BackButton';
import { Icon } from '../shared/components/Icon';
import { TimeRangeWheelPicker } from '../shared/components/TimeRangeWheelPicker';
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
  const ignoredDetectedIds = new Set(
    batch.detectedPeople.filter((person) => person.ignored === true).map((person) => person.id),
  );
  const importedTimeComplete = (item: (typeof batch.reviewItems)[number]) =>
    item.imported.enabled === false ||
    (item.imported.start != null && item.imported.end != null);
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
        item.existing.end === item.imported.end
      )
    );
  const visibleReviewItems = batch.reviewItems.filter(
    (item) =>
      !ignoredDetectedIds.has(item.detectedPersonId) &&
      !exactDuplicate(item),
  );
  const allReviewed = visibleReviewItems.every((item) =>
    item.personId != null &&
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

      {visibleReviewItems.length ? (
        <div className="import-review-list">
          {visibleReviewItems.map((item) => {
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

                {item.recognitionState ? (
                  <div className={'review-recognition-state ' + item.recognitionState.toLowerCase()}>
                    {item.recognitionState === 'OFF'
                      ? '휴무로 인식'
                      : item.recognitionState === 'UNREADABLE'
                        ? '인식 불확실 — 이미지에 내용은 있으나 시간을 읽지 못함'
                        : item.recognitionState === 'INCOMPLETE'
                          ? '근무시간 일부만 인식'
                          : '근무로 인식'}
                  </div>
                ) : null}

                {item.imported.enabled !== false && !importedComplete ? (
                  <div className="review-time-editor" data-state={item.recognitionState === 'UNREADABLE' ? 'UNREADABLE_TIME' : 'INCOMPLETE_TIME'}>
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
                    disabled={!item.personId || !importedComplete}
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
