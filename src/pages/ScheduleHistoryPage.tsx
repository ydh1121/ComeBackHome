import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ScheduleCalendar } from '../features/schedule/ScheduleCalendar';
import { useSelectedSchedule } from '../features/schedule/useSelectedSchedule';
import { useSeoulDate } from '../shared/runtime/useSeoulDate';
import { BackButton } from '../shared/components/BackButton';
import { Icon } from '../shared/components/Icon';
import './schedule-page.css';

export function ScheduleHistoryPage() {
  const navigate = useNavigate();
  const today = useSeoulDate();
  const [params] = useSearchParams();
  const initialMonth = params.get('month') ?? '';
  const [month,setMonth] = useState(/^\d{4}-(0[1-9]|1[0-2])$/.test(initialMonth) ? initialMonth : today.slice(0,7));
  const schedule = useSelectedSchedule();
  const move = (delta: number) => {
    const [year,index] = month.split('-').map(Number);
    setMonth(new Date(Date.UTC(year,index-1+delta,1)).toISOString().slice(0,7));
  };
  const entries = schedule.status === 'ready' ? schedule.entries.filter(item => item.date.startsWith(month)) : [];
  return <section className="schedule-page schedule-history-page" data-route="/schedule/history" data-page="ScheduleHistoryPage" data-state={schedule.status.toUpperCase()}>
    <BackButton fallbackTo="/schedule" /><h1 className="page-title">월별 이력</h1>
    <div className="history-month-picker"><button type="button" className="icon-btn" aria-label="이전 달" onClick={() => move(-1)}><Icon name="chevron-left" /></button><label><input aria-label="조회 월" type="month" value={month} onChange={event => {if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) setMonth(event.target.value);}} /></label><button type="button" className="icon-btn" aria-label="다음 달" onClick={() => move(1)}><Icon name="chevron-right" /></button></div>
    {schedule.status === 'ready' ? <><div className="history-summary">근무 {entries.filter(item => item.enabled).length}일 <span>·</span> 휴무 {entries.filter(item => !item.enabled).length}일 <small>— 미등록</small></div><ScheduleCalendar entries={entries} month={month} today={today} onSelect={date => navigate('/schedule/' + date + '/edit?from=history&month=' + month)} /></> : <div className="schedule-message">{schedule.status === 'loading' ? '일정을 불러오는 중' : '일정을 불러오지 못했습니다.'}</div>}
  </section>;
}
