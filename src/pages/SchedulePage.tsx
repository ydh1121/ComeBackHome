import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ScheduleCalendar } from '../features/schedule/ScheduleCalendar';
import { formatDateLabel, formatMonthLabel } from '../features/schedule/date-format';
import { useSelectedSchedule } from '../features/schedule/useSelectedSchedule';
import { Icon } from '../shared/components/Icon';
import './schedule-page.css';

type ScheduleView = 'day' | 'week' | '2week' | 'month';

export function SchedulePage() {
  const navigate = useNavigate();
  const schedule = useSelectedSchedule();
  const [view, setView] = useState<ScheduleView>('day');

  if (schedule.status === 'loading') {
    return <section className="schedule-page" data-page="SchedulePage" data-state="LOADING"><div className="schedule-message">일정을 불러오는 중</div></section>;
  }
  if (schedule.status === 'error') {
    return <section className="schedule-page" data-page="SchedulePage" data-state="ERROR"><div className="schedule-message">일정을 불러오지 못했습니다.</div></section>;
  }

  const entries = schedule.entries;
  const openDay = (date: string) => navigate('/schedule/' + date + '/edit');
  const rangeLabel = (items: typeof entries) => items.length ? formatDateLabel(items[0].date) + ' - ' + formatDateLabel(items[items.length - 1].date) : '—';

  return (
    <section className="schedule-page" data-route="/schedule" data-page="SchedulePage" data-state={entries.length ? 'VIEW_' + view.toUpperCase() : 'EMPTY'}>
      <div className="page-head-inline">
        <h1 className="page-title">일정</h1>
        <button type="button" className="text-btn schedule-bulk-link" onClick={() => navigate('/schedule/edit')}>일괄 입력</button>
      </div>

      {!entries.length ? <div className="schedule-message" data-state="EMPTY">등록된 일정이 없습니다.</div> : null}

      <div className="segment">
        {([['day','1일'],['week','1주'],['2week','2주'],['month','1개월']] as const).map(([value,label]) => (
          <button key={value} type="button" className={view === value ? 'active' : ''} onClick={() => setView(value)}>{label}</button>
        ))}
      </div>

      {view === 'day' ? <div className="schedule-day-list">
        {entries.slice(0, 3).map((entry) => (
          <button key={entry.date} type="button" className="schedule-day-card" onClick={() => openDay(entry.date)}>
            <div className="day">
              <div className="day-head"><span className="day-date">{formatDateLabel(entry.date)}</span><span className={'switch' + (entry.enabled ? ' on' : '')} aria-hidden="true" /></div>
              <div className="timepair">
                <div className="timeinput"><span>출근</span><b>{entry.start}</b></div>
                <div className="timeinput"><span>퇴근</span><b>{entry.end}</b></div>
              </div>
            </div>
          </button>
        ))}
      </div> : null}

      {view === 'week' ? <>
        <div className="schedule-view-head"><span className="schedule-range-label">{rangeLabel(entries.slice(0,7))}</span></div>
        <div className="schedule-week-list">
          {entries.slice(0,7).map((entry) => (
            <button key={entry.date} type="button" className="schedule-week-row" onClick={() => openDay(entry.date)}>
              <span className="schedule-week-date">{formatDateLabel(entry.date)}</span>
              <span className={'schedule-week-time' + (entry.enabled ? '' : ' off')}>{entry.enabled ? entry.start + ' - ' + entry.end : '휴무'}</span>
              <Icon name="chevron-right" />
            </button>
          ))}
        </div>
      </> : null}

      {view === '2week' ? <>
        <div className="schedule-view-head"><span className="schedule-range-label">{rangeLabel(entries.slice(0,14))}</span></div>
        <div className="schedule-2week-block">
          <ScheduleCalendar entries={entries.slice(0,7)} onSelect={openDay} />
          <ScheduleCalendar entries={entries.slice(7,14)} onSelect={openDay} />
        </div>
      </> : null}

      {view === 'month' ? <>
        <div className="schedule-view-head"><span className="schedule-range-label">{formatMonthLabel(entries[0]?.date ?? '')}</span></div>
        <ScheduleCalendar entries={entries} monthMode onSelect={openDay} />
      </> : null}

      <button type="button" className="cta schedule-edit-cta" onClick={() => navigate('/schedule/edit')}>일정 편집</button>
    </section>
  );
}
