import type { ScheduleEntry } from '../../domain/models';
import { formatDateLabel } from './date-format';
import { calendarDayClass, holidayName } from '../../domain/korean-holidays';

export function ScheduleCalendar({ entries, month, today, onSelect }: {
  entries: ScheduleEntry[]; month: string; today: string; onSelect(date: string): void;
}) {
  const [year, index] = month.split('-').map(Number);
  const lead = new Date(Date.UTC(year, index - 1, 1)).getUTCDay();
  const last = new Date(Date.UTC(year, index, 0)).getUTCDate();
  const byDate = new Map(entries.map(entry => [entry.date, entry]));
  return <div className="schedule-calendar">
    <div className="schedule-weekdays" aria-hidden="true">{['일','월','화','수','목','금','토'].map(day => <span key={day}>{day}</span>)}</div>
    <div className="schedule-grid">
      {Array.from({length:lead}, (_,i) => <span key={'lead'+i} />)}
      {Array.from({length:last}, (_,i) => {
        const date = month + '-' + String(i+1).padStart(2,'0');
        const entry = byDate.get(date);
        const state = !entry ? 'UNREGISTERED' : entry.enabled ? 'WORK' : 'OFF';
        return <button key={date} type="button" disabled={!entry} data-date={date} data-schedule-state={state}
          className={'schedule-cell ' + state.toLowerCase() + (date === today ? ' today' : '')}
          aria-label={formatDateLabel(date) + ' ' + (!entry ? '미등록' : entry.enabled ? entry.start + ' 출근 ' + entry.end + ' 퇴근' : '휴무')}
          onClick={() => onSelect(date)}>
          <span className={'dnum '+calendarDayClass(date)} title={holidayName(date)??undefined}>{i+1}</span>
          {entry?.enabled ? <span className="calendar-times"><b>{entry.start}</b><span>{entry.end}</span></span> : <span className="calendar-status">{entry ? '휴무' : '—'}</span>}
        </button>;
      })}
    </div>
  </div>;
}
