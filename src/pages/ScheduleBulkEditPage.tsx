import { useState } from 'react';
import type { ScheduleEntry } from '../domain/models';
import { useNavigate } from 'react-router';
import { useApplicationServices } from '../app/ApplicationServicesContext';
import { ScheduleRangePicker } from '../features/schedule/ScheduleRangePicker';
import { isIsoDate } from '../features/schedule/date-format';
import { useSelectedSchedule } from '../features/schedule/useSelectedSchedule';
import { BackButton } from '../shared/components/BackButton';
import { useFormRuntimeState } from '../shared/runtime/useFormRuntimeState';
import './schedule-page.css';

const weekdayLabels = ['일', '월', '화', '수', '목', '금', '토'];

function currentLocalIsoDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return now.getFullYear() + '-' + month + '-' + day;
}

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
  const fallbackDate = first?.date ?? currentLocalIsoDate();
  const [from, setFrom] = useState(fallbackDate);
  const [to, setTo] = useState(entries[entries.length - 1]?.date ?? fallbackDate);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [start, setStart] = useState(first?.start ?? '');
  const [end, setEnd] = useState(first?.end ?? '');
  const form = useFormRuntimeState();
  const canApply = isIsoDate(from) && isIsoDate(to) && from <= to && Boolean(start) && Boolean(end);

  const toggleWeekday = (day: number) => {
    setWeekdays((current) => current.includes(day)
      ? current.filter((value) => value !== day)
      : [...current, day].sort((a, b) => a - b));
    form.markDirty();
  };

  return (
    <section className="schedule-page" data-route="/schedule/edit" data-page="ScheduleBulkEditPage" data-state={"EDITING_BULK " + form.state}>
      <BackButton fallbackTo="/schedule" />
      <h1 className="page-title">일정 일괄 입력</h1>
      <div className="form-stack">
        <div className="form-field">
          <div className="form-label">기간</div>
          <ScheduleRangePicker entries={entries} from={from} to={to} onChange={(nextFrom, nextTo) => { setFrom(nextFrom); setTo(nextTo); form.markDirty(); }} />
        </div>
        <div className="form-field">
          <div className="form-label">기간 내 적용 요일 <span className="optional-label">선택</span></div>
          <div className="form-hint">선택하지 않으면 기간의 모든 날짜에 적용합니다.</div>
          <div className="weekday-grid">
            {weekdayLabels.map((label, day) => (
              <button key={label} type="button" className={'weekday-btn' + (weekdays.includes(day) ? ' active' : '')} aria-pressed={weekdays.includes(day)} onClick={() => toggleWeekday(day)}>{label}</button>
            ))}
          </div>
        </div>
        <div className="form-row-2">
          <label className="form-field"><span className="form-label">출근</span><input className="input" type="time" value={start} onChange={(event) => { setStart(event.target.value); form.markDirty(); }} /></label>
          <label className="form-field"><span className="form-label">퇴근</span><input className="input" type="time" value={end} onChange={(event) => { setEnd(event.target.value); form.markDirty(); }} /></label>
        </div>
      </div>
      <button type="button" className="cta" disabled={form.state === 'SAVING' || !canApply} onClick={() => form.save(() => onApply({ from, to, weekdays, start, end }))}>{form.state === 'SAVING' ? '적용 중' : form.state === 'SAVED' ? '적용됨' : '적용'}</button>
    </section>
  );
}
