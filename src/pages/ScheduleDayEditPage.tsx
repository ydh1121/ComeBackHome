import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useApplicationServices } from '../app/ApplicationServicesContext';
import { formatDateLabel } from '../features/schedule/date-format';
import { useSelectedSchedule } from '../features/schedule/useSelectedSchedule';
import { BackButton } from '../shared/components/BackButton';
import './schedule-page.css';

export function ScheduleDayEditPage() {
  const { date = '' } = useParams();
  const navigate = useNavigate();
  const services = useApplicationServices();
  const schedule = useSelectedSchedule();
  const entry = schedule.status === 'ready' ? schedule.entries.find((item) => item.date === date) : null;
  const [enabled, setEnabled] = useState(true);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  useEffect(() => {
    if (!entry) return;
    setEnabled(entry.enabled);
    setStart(entry.start);
    setEnd(entry.end);
  }, [entry?.id]);

  if (schedule.status === 'loading') return <section className="schedule-page"><div className="schedule-message">일정을 불러오는 중</div></section>;
  if (schedule.status === 'error') return <section className="schedule-page"><div className="schedule-message">일정을 불러오지 못했습니다.</div></section>;

  const save = async () => {
    await services.actions.schedule.saveDay(date, { enabled, start, end });
    navigate('/schedule');
  };

  return (
    <section className="schedule-page" data-route={'/schedule/' + date + '/edit'} data-page="ScheduleDayEditPage" data-state="EDITING_DAY">
      <BackButton fallbackTo="/schedule" />
      <h1 className="page-title">일정 수정</h1>
      <div className="schedule-edit-date">{formatDateLabel(date)}</div>
      <button type="button" className="rule schedule-workday-rule" onClick={() => setEnabled((value) => !value)} aria-pressed={enabled}>
        <b>근무일</b><span className={'switch' + (enabled ? ' on' : '')} />
      </button>
      <div className="form-row-2">
        <label className="form-field"><span className="form-label">출근</span><input className="input" type="time" value={start} onChange={(event) => setStart(event.target.value)} /></label>
        <label className="form-field"><span className="form-label">퇴근</span><input className="input" type="time" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
      </div>
      <button type="button" className="cta" onClick={save}>저장</button>
    </section>
  );
}
