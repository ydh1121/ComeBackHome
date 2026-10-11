import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useApplicationServices } from '../app/ApplicationServicesContext';
import { formatDateLabel, isIsoDate } from '../features/schedule/date-format';
import { useSelectedSchedule } from '../features/schedule/useSelectedSchedule';
import { BackButton } from '../shared/components/BackButton';
import { TimeRangeWheelPicker } from '../shared/components/TimeRangeWheelPicker';
import { useFormRuntimeState } from '../shared/runtime/useFormRuntimeState';
import { formErrorMessage } from '../shared/runtime/formErrorMessage';
import './schedule-page.css';

function currentLocalIsoDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return now.getFullYear() + '-' + month + '-' + day;
}

export function ScheduleDayEditPage() {
  const { date: routeDate = '' } = useParams();
  const navigate = useNavigate();
  const services = useApplicationServices();
  const schedule = useSelectedSchedule();
  const creating = !routeDate;
  const [selectedDate, setSelectedDate] = useState(routeDate || currentLocalIsoDate());
  const entry = schedule.status === 'ready'
    ? schedule.entries.find((item) => item.date === selectedDate)
    : null;
  const [enabled, setEnabled] = useState(true);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [breakDraft, setBreakDraft] = useState('');
  const [breakEdited, setBreakEdited] = useState(false);
  const form = useFormRuntimeState();

  useEffect(() => {
    if (!entry) {
      if (creating) {
        setEnabled(true);
        setStart('');
        setEnd('');
        setBreakDraft('');
        setBreakEdited(false);
      }
      return;
    }
    setEnabled(entry.enabled);
    setStart(entry.start);
    setEnd(entry.end);
    setBreakDraft(entry.breakMinutes == null ? '' : String(entry.breakMinutes));
    setBreakEdited(false);
  }, [entry?.id, selectedDate, schedule.status === 'ready' ? schedule.personId : null, creating]);

  if (schedule.status === 'loading') return <section className="schedule-page"><div className="schedule-message">일정을 불러오는 중</div></section>;
  if (schedule.status === 'error') return <section className="schedule-page"><div className="schedule-message">일정을 불러오지 못했습니다.</div></section>;

  const validClock = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  const validBreak = breakDraft === '' || (/^\d{1,3}$/.test(breakDraft) && Number(breakDraft) <= 720);
  const canSave = isIsoDate(selectedDate) && (!enabled || (validClock(start) && validClock(end))) &&
    validBreak && schedule.status === 'ready' && Boolean(schedule.personId);
  const save = async () => {
    if (!canSave || form.state === 'SAVING') return;
    try {
      const expectedPersonId = schedule.status === 'ready' ? schedule.personId ?? undefined : undefined;
      await form.save(() => services.actions.schedule.saveDay(selectedDate, {
        enabled, start: enabled ? start : '', end: enabled ? end : '',
        breakMinutes: enabled ? (breakEdited ? (breakDraft === '' ? null : Number(breakDraft)) : undefined) : null,
        expectedPersonId,
      }));
      navigate('/schedule');
    } catch {
      // Keep the entered schedule for a subsequent explicit retry.
    }
  };

  return (
    <section
      className="schedule-page"
      data-route={creating ? '/schedule/new' : '/schedule/' + routeDate + '/edit'}
      data-page="ScheduleDayEditPage"
      data-state={(creating ? 'CREATING_DAY ' : 'EDITING_DAY ') + form.state}
    >
      <BackButton fallbackTo="/schedule" />
      <h1 className="page-title">{creating ? '1일 일정 추가' : '일정 수정'}</h1>

      {creating ? (
        <label className="form-field schedule-day-date-field">
          <span className="form-label">날짜</span>
          <input
            className="input schedule-native-date"
            type="date"
            value={selectedDate}
            onChange={(event) => {
              setSelectedDate(event.currentTarget.value);
              form.markDirty();
            }}
          />
        </label>
      ) : (
        <div className="schedule-edit-date">{formatDateLabel(selectedDate)}</div>
      )}

      <button type="button" className="rule schedule-workday-rule" onClick={() => { setEnabled((value) => !value); form.markDirty(); }} aria-pressed={enabled}>
        <b>근무일</b><span className={'switch' + (enabled ? ' on' : '')} />
      </button>
      {enabled ? <TimeRangeWheelPicker
        startLabel="출근"
        endLabel="퇴근"
        start={start || null}
        end={end || null}
        onChange={(kind, value) => {
          if (kind === 'start') setStart(value);
          else setEnd(value);
          form.markDirty();
        }}
      /> : <p className="schedule-message" data-state="OFF">휴무일 · 출퇴근시간을 입력하지 않습니다.</p>}
      {enabled ? (
        <label className="form-field">
          <span className="form-label">쉬는시간 (분)</span>
          <input className="input" type="number" inputMode="numeric" min="0" max="720"
            aria-label="쉬는시간 분 단위 수정" placeholder="미설정"
            value={breakDraft} onChange={event => {
              setBreakDraft(event.currentTarget.value);
              setBreakEdited(true);
              form.markDirty();
            }} />
          <span className="form-hint">변경하지 않으면 기존 시간이 유지됩니다. 값을 비우면 삭제됩니다.</span>
        </label>
      ) : null}
      {form.error ? <p className="form-error" role="alert">{formErrorMessage(form.error)}</p> : null}
      <button type="button" className="cta" disabled={form.state === 'SAVING' || !canSave} onClick={save}>{form.state === 'SAVING' ? '저장 중' : form.state === 'SAVED' ? '저장됨' : '저장'}</button>
    </section>
  );
}
