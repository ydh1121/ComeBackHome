import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useApplicationServices } from '../app/ApplicationServicesContext';
import { formatDateLabel, isIsoDate } from '../features/schedule/date-format';
import { useSelectedSchedule } from '../features/schedule/useSelectedSchedule';
import { BackButton } from '../shared/components/BackButton';
import { useFormRuntimeState } from '../shared/runtime/useFormRuntimeState';
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
  const form = useFormRuntimeState();

  useEffect(() => {
    if (!entry) {
      if (creating) {
        setEnabled(true);
        setStart('');
        setEnd('');
      }
      return;
    }
    setEnabled(entry.enabled);
    setStart(entry.start);
    setEnd(entry.end);
  }, [entry?.id, creating]);

  if (schedule.status === 'loading') return <section className="schedule-page"><div className="schedule-message">일정을 불러오는 중</div></section>;
  if (schedule.status === 'error') return <section className="schedule-page"><div className="schedule-message">일정을 불러오지 못했습니다.</div></section>;

  const canSave = isIsoDate(selectedDate) && Boolean(start) && Boolean(end);
  const save = async () => {
    if (!canSave) return;
    await form.save(() => services.actions.schedule.saveDay(selectedDate, { enabled, start, end }));
    navigate('/schedule');
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
      <div className="form-row-2">
        <label className="form-field"><span className="form-label">출근</span><input className="input schedule-native-time" type="time" value={start} onChange={(event) => { setStart(event.target.value); form.markDirty(); }} /></label>
        <label className="form-field"><span className="form-label">퇴근</span><input className="input schedule-native-time" type="time" value={end} onChange={(event) => { setEnd(event.target.value); form.markDirty(); }} /></label>
      </div>
      <button type="button" className="cta" disabled={form.state === 'SAVING' || !canSave} onClick={save}>{form.state === 'SAVING' ? '저장 중' : form.state === 'SAVED' ? '저장됨' : '저장'}</button>
    </section>
  );
}
