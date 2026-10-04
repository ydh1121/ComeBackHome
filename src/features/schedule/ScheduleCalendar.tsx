import type { ScheduleEntry } from '../../domain/models';

interface ScheduleCalendarProps {
  entries: ScheduleEntry[];
  monthMode?: boolean;
  onSelect(date: string): void;
}

interface CalendarCell {
  date: string;
  enabled: boolean;
  start: string;
  end: string;
}

function cellsForMonth(entries: ScheduleEntry[]): Array<CalendarCell | null> {
  const firstDate = entries[0]?.date;
  if (!firstDate) return [];
  const first = new Date(firstDate + 'T00:00:00Z');
  const year = first.getUTCFullYear();
  const month = first.getUTCMonth();
  const lead = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const byDate = new Map(entries.map((entry) => [entry.date, entry]));
  const cells: Array<CalendarCell | null> = Array.from({ length: lead }, () => null);

  for (let day = 1; day <= last; day += 1) {
    const monthText = String(month + 1).padStart(2, '0');
    const dayText = String(day).padStart(2, '0');
    const iso = year + '-' + monthText + '-' + dayText;
    const entry = byDate.get(iso);
    cells.push(entry
      ? { date: entry.date, enabled: entry.enabled, start: entry.start, end: entry.end }
      : { date: iso, enabled: false, start: '', end: '' });
  }
  return cells;
}

export function ScheduleCalendar({ entries, monthMode = false, onSelect }: ScheduleCalendarProps) {
  const cells: Array<CalendarCell | null> = monthMode
    ? cellsForMonth(entries)
    : entries.map((entry) => ({ date: entry.date, enabled: entry.enabled, start: entry.start, end: entry.end }));

  return (
    <div className="schedule-calendar">
      <div className="schedule-weekdays">
        {['일', '월', '화', '수', '목', '금', '토'].map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="schedule-grid">
        {cells.map((entry, index) => entry ? (
          <button
            key={entry.date}
            type="button"
            className={'schedule-cell' + (entry.enabled ? '' : ' off')}
            onClick={() => onSelect(entry.date)}
          >
            <span className="dnum">{Number(entry.date.slice(-2))}</span>
            {entry.enabled ? (
              <>
                <span className="work-dot" />
                <span className="mini-time">{entry.start.replace(':', '')}-{entry.end.replace(':', '')}</span>
              </>
            ) : <span className="mini-time">휴무</span>}
          </button>
        ) : <span key={'empty-' + index} />)}
      </div>
    </div>
  );
}
