import type { CSSProperties } from 'react';
import { PageSkeleton } from '../shared/components/PageSkeleton';
import { useNavigate } from 'react-router';
import { formatDateLabel } from '../features/schedule/date-format';
import { useSelectedSchedule } from '../features/schedule/useSelectedSchedule';
import { Icon } from '../shared/components/Icon';
import { useSeoulDate } from '../shared/runtime/useSeoulDate';
import './schedule-page.css';
import { calendarDayClass, holidayName } from '../domain/korean-holidays';

export function SchedulePage() {
  const navigate = useNavigate();
  const schedule = useSelectedSchedule();
  const today = useSeoulDate();
  if (schedule.status !== 'ready') return <section className="schedule-page" data-page="SchedulePage" data-state={schedule.status === 'loading' ? 'LOADING' : 'ERROR'}>{schedule.status === 'loading' ? <PageSkeleton /> : <div className="schedule-message">일정을 불러오지 못했습니다.</div>}</section>;
  const latestDates = schedule.latestImport ? new Set(schedule.latestImport.dates) : null;
  const entries = schedule.entries.filter(entry => entry.date >= today && (!latestDates || latestDates.has(entry.date)));
  const allRosterDates = schedule.latestImport?.dates ?? entries.map(entry => entry.date);
  const range = allRosterDates.length ? formatDateLabel(allRosterDates[0]) + ' ~ ' + formatDateLabel(allRosterDates.at(-1)!) : null;
  return (
    <section className="schedule-page roster-page" data-route="/schedule" data-page="SchedulePage" data-state={entries.length ? 'VIEW_DAY' : 'EMPTY'} data-import-id={schedule.latestImport?.id ?? ''}>
      <div className="page-head-inline"><h1 className="page-title">일정</h1><button className="text-btn" type="button" onClick={() => navigate('/schedule/history')}>월별 이력 <Icon name="chevron-right" /></button></div>
      <div className="roster-heading">{range ? <h2>{range}</h2> : null}</div>
      {entries.length ? <div className="roster-list" style={{'--roster-rows': Math.min(7, entries.length)} as CSSProperties}>
        {entries.map(entry => <button type="button" className={'roster-row schedule-day-card' + (entry.date === today ? ' is-today' : '')} key={entry.date} data-date={entry.date} onClick={() => navigate('/schedule/' + entry.date + '/edit')}>
          <span className="roster-date"><b className={calendarDayClass(entry.date)} title={holidayName(entry.date)??undefined}>{formatDateLabel(entry.date)}</b>{entry.date === today ? <small>오늘</small> : null}</span>
          <span className={'roster-hours' + (entry.enabled ? '' : ' is-off')}><b>{entry.enabled ? entry.start + ' ~ ' + entry.end : '휴무'}</b>{entry.enabled && entry.breakMinutes != null ? <small>휴게 {entry.breakMinutes}분</small> : null}</span>
          <Icon name="chevron-right" />
        </button>)}
      </div> : <div className="roster-empty"><Icon name="calendar" /><h2>{schedule.latestImport ? '이 근무표의 일정이 모두 지났어요' : '아직 등록된 일정이 없어요'}</h2><p>{schedule.latestImport ? '지난 일정은 월별 이력에서 볼 수 있습니다.' : '근무표를 가져오면 이곳에서 한눈에 볼 수 있습니다.'}</p><button type="button" className="cta" onClick={() => navigate('/import')}>근무표 이미지 가져오기</button></div>}
      <div className="roster-footer"><button type="button" className="text-btn" onClick={() => navigate('/schedule/new')}><Icon name="plus" /> 일정 직접 추가</button></div>
    </section>
  );
}
