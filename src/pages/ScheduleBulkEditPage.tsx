import { useState } from 'react';
import type { ScheduleEntry } from '../domain/models';
import { useNavigate } from 'react-router';
import { useApplicationServices } from '../app/ApplicationServicesContext';
import { ScheduleRangePicker } from '../features/schedule/ScheduleRangePicker';
import { isIsoDate } from '../features/schedule/date-format';
import { useSelectedSchedule } from '../features/schedule/useSelectedSchedule';
import { BackButton } from '../shared/components/BackButton';
import { TimeRangeWheelPicker } from '../shared/components/TimeRangeWheelPicker';
import { useFormRuntimeState } from '../shared/runtime/useFormRuntimeState';
import { formErrorMessage } from '../shared/runtime/formErrorMessage';
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

  return <BulkForm key={schedule.personId ?? 'none'} personId={schedule.personId} entries={schedule.entries} onApply={async (rule) => {
    await services.actions.schedule.applyBulk(rule);
    navigate('/schedule');
  }} />;
}

interface BulkFormProps {
  entries: ScheduleEntry[];
  personId: string | null;
  onApply(rule: { from: string; to: string; weekdays: number[]; start: string; end: string; expectedPersonId?: string }): Promise<void>;
}

function BulkForm({ entries, personId, onApply }: BulkFormProps) {
  const first = entries[0];
  const fallbackDate = first?.date ?? currentLocalIsoDate();
  const [from, setFrom] = useState(fallbackDate);
  const [to, setTo] = useState(entries[entries.length - 1]?.date ?? fallbackDate);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [start, setStart] = useState(first?.start ?? '');
  const [end, setEnd] = useState(first?.end ?? '');
  const form = useFormRuntimeState();
  const days = isIsoDate(from) && isIsoDate(to)
    ? Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000) + 1 : 0;
  const validClock = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  const canApply = Boolean(personId) && days >= 1 && days <= 366 &&
    validClock(start) && validClock(end);

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
        <TimeRangeWheelPicker
          startLabel="출근"
          endLabel="퇴근"
          start={start || null}
          end={end || null}
          onChange={(kind, value) => {
            if (kind === 'start') setStart(value);
            else setEnd(value);
            form.markDirty();
          }}
        />
      </div>
      {form.error ? <p className="form-error" role="alert">{formErrorMessage(form.error)}</p> : null}
      <button type="button" className="cta" disabled={form.state === 'SAVING' || !canApply} onClick={async () => {
        try {
          await form.save(() => onApply({ from, to, weekdays, start, end,
            expectedPersonId: personId ?? undefined }));
        } catch {
          // Retain the range, selected weekdays, and times for explicit retry.
        }
      }}>{form.state === 'SAVING' ? '적용 중' : form.state === 'SAVED' ? '적용됨' : '적용'}</button>
    </section>
  );
}
