import { useState } from 'react';
import type { ScheduleEntry } from '../domain/models';
import { useNavigate } from 'react-router';
import { useApplicationServices } from '../app/ApplicationServicesContext';
import { ScheduleRangePicker } from '../features/schedule/ScheduleRangePicker';
import { useSelectedSchedule } from '../features/schedule/useSelectedSchedule';
import { BackButton } from '../shared/components/BackButton';
import './schedule-page.css';

const weekdayLabels = ['일', '월', '화', '수', '목', '금', '토'];

export function ScheduleBulkEditPage() {
  const navigate = useNavigate();
  const services = useApplicationServices();
  const schedule = useSelectedSchedule();

  if (schedule.status === 'loading') return <section className="schedule-page"><div className="schedule-message">일정을 불러오는 중</div></section>;
  if (schedule.status === 'error') return <section className="schedule-page"><div className="schedule-message">일정을 불러오지 못했습니다.</div></section>;

  return <BulkForm entries={schedule.entries} onApply={async (rule) => {
    await services.actions.schedule.applyBulk(rule);
    navigate('/schedule');
  }} />;
}

interface BulkFormProps {
  entries: ScheduleEntry[];
  onApply(rule: { from: string; to: string; weekdays: number[]; start: string; end: string }): Promise<void>;
}

function BulkForm({ entries, onApply }: BulkFormProps) {
  const first = entries[0];
  const [from, setFrom] = useState(first?.date ?? '');
  const [to, setTo] = useState(entries[entries.length - 1]?.date ?? first?.date ?? '');
  const [weekdays, setWeekdays] = useState<number[]>([0,1,2,3,4,5,6]);
  const [start, setStart] = useState(first?.start ?? '');
  const [end, setEnd] = useState(first?.end ?? '');

  const toggleWeekday = (day: number) => {
    setWeekdays((current) => current.includes(day)
      ? current.length > 1 ? current.filter((value) => value !== day) : current
      : [...current, day].sort((a, b) => a - b));
  };

  return (
    <section className="schedule-page" data-route="/schedule/edit" data-page="ScheduleBulkEditPage" data-state="EDITING_BULK">
      <BackButton fallbackTo="/schedule" />
      <h1 className="page-title">일정 일괄 입력</h1>
      <div className="form-stack">
        <div className="form-field">
          <div className="form-label">기간</div>
          <ScheduleRangePicker entries={entries} from={from} to={to} onChange={(nextFrom, nextTo) => { setFrom(nextFrom); setTo(nextTo); }} />
        </div>
        <div className="form-field">
          <div className="form-label">기간 내 적용 요일</div>
          <div className="weekday-grid">
            {weekdayLabels.map((label, day) => (
              <button key={label} type="button" className={'weekday-btn' + (weekdays.includes(day) ? ' active' : '')} aria-pressed={weekdays.includes(day)} onClick={() => toggleWeekday(day)}>{label}</button>
            ))}
          </div>
        </div>
        <div className="form-row-2">
          <label className="form-field"><span className="form-label">출근</span><input className="input" type="time" value={start} onChange={(event) => setStart(event.target.value)} /></label>
          <label className="form-field"><span className="form-label">퇴근</span><input className="input" type="time" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
        </div>
      </div>
      <button type="button" className="cta" onClick={() => onApply({ from, to, weekdays, start, end })}>적용</button>
    </section>
  );
}
