import { useEffect, useRef, useState } from 'react';
import { useApplicationServices } from '../../app/ApplicationServicesContext';
import type { ScheduleEntry } from '../../domain/models';

export function ScheduleDeleteDialog({personId, entries, today, onClose}: {
  personId: string; entries: ScheduleEntry[]; today: string; onClose(): void;
}) {
  const services = useApplicationServices();
  const dialog = useRef<HTMLDialogElement>(null);
  const locked = useRef(false);
  const yesterday = new Date(Date.parse(today + 'T00:00:00Z') - 86400000).toISOString().slice(0,10);
  const [mode,setMode] = useState('past');
  const [from,setFrom] = useState(entries[0]?.date ?? today);
  const [to,setTo] = useState(yesterday);
  const [confirmed,setConfirmed] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const end = mode === 'past' ? yesterday : to;
  const start = mode === 'past' ? entries[0]?.date ?? today : from;
  const count = entries.filter(entry => entry.date >= start && entry.date <= end).length;
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); },[]);
  const remove = async () => {
    if (!confirmed || !count || locked.current) return;
    locked.current=true; setBusy(true); setError('');
    try { await services.actions.schedule.removeRange(start,end,count,personId); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '삭제하지 못했습니다.'); setConfirmed(false); }
    finally { locked.current=false; setBusy(false); }
  };
  return <dialog ref={dialog} className="schedule-delete-dialog" aria-labelledby="delete-schedule-title" onCancel={event => {event.preventDefault();if(!busy)onClose();}}>
    <h2 id="delete-schedule-title">일정 삭제</h2>
    {confirmed ? <><p><b>{start} ~ {end}</b></p><p>이 기간의 근무·휴무 <strong>{count}일</strong>을 삭제할까요?</p><p className="delete-help">삭제한 일정은 되돌릴 수 없습니다.</p></> : <>
      <div className="delete-modes"><button type="button" aria-pressed={mode==='past'} onClick={()=>setMode('past')}>지난 일정</button><button type="button" aria-pressed={mode==='range'} onClick={()=>setMode('range')}>기간 선택</button></div>
      {mode==='range' ? <div className="delete-range"><label>시작일<input type="date" value={from} onChange={event=>setFrom(event.target.value)} /></label><label>종료일<input type="date" value={to} onChange={event=>setTo(event.target.value)} /></label></div> : <p>어제까지의 일정만 선택합니다. 오늘과 앞으로의 일정은 남습니다.</p>}
      <p>선택한 일정 <strong>{count}일</strong></p>
    </>}
    {error ? <p role="alert">{error}</p> : null}
    <div className="delete-actions"><button type="button" disabled={busy} onClick={onClose}>취소</button><button type="button" className="danger" disabled={busy||!count||!start||!end||start>end} onClick={()=>confirmed?void remove():setConfirmed(true)}>{busy?'삭제 중':confirmed?'삭제':'삭제할 일정 확인'}</button></div>
  </dialog>;
}
