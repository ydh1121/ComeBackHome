import { useState } from 'react';
import type { ScheduleEntry } from '../../domain/models';
import { Icon } from '../../shared/components/Icon';
import { formatDateLabel, isIsoDate, normalizeRange } from './date-format';

type Mode = 'wheel' | 'direct' | 'calendar';

interface Props {
  entries: ScheduleEntry[];
  from: string;
  to: string;
  onChange(from: string, to: string): void;
}

export function ScheduleRangePicker({ entries, from, to, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('wheel');
  const [step, setStep] = useState<'start' | 'end'>('start');
  const [fromText, setFromText] = useState(from);
  const [toText, setToText] = useState(to);
  const dates = entries.map((entry) => entry.date);

  const setDate = (kind: 'from' | 'to', value: string) => {
    const next = normalizeRange(kind === 'from' ? value : from, kind === 'to' ? value : to);
    onChange(next.from, next.to);
  };

  const commitText = () => {
    if (!isIsoDate(fromText) || !isIsoDate(toText)) return;
    const next = normalizeRange(fromText, toText);
    onChange(next.from, next.to);
  };

  const calendarClick = (value: string) => {
    if (step === 'start') {
      onChange(value, value > to ? value : to);
      setStep('end');
    } else {
      const next = normalizeRange(from, value);
      onChange(next.from, next.to);
      setStep('start');
    }
  };

  const ref = new Date((from || dates[0] || '2026-10-01') + 'T00:00:00Z');
  const year = ref.getUTCFullYear();
  const month = ref.getUTCMonth();
  const lead = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const calendarDates: Array<string | null> = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= last; day += 1) {
    calendarDates.push(year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0'));
  }

  return (
    <div className="range-picker-v13">
      <button type="button" className="range-accordion" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="range-date-pair"><b>{formatDateLabel(from)}</b><span>–</span><b>{formatDateLabel(to)}</b></span>
        <span className={'range-accordion-chevron' + (open ? ' open' : '')}><Icon name="chevron-down" /></span>
      </button>

      {open ? <div className="range-accordion-panel">
        <div className="range-mode-tabs">
          {([['wheel', '스크롤로 선택'], ['direct', '직접 입력'], ['calendar', '달력에서 선택']] as const).map(([value, label]) => (
            <button key={value} type="button" className={mode === value ? 'active' : ''} onClick={() => setMode(value)}>{label}</button>
          ))}
        </div>

        {mode === 'wheel' ? <div className="ios-wheel-grid">
          {(['from', 'to'] as const).map((kind) => <div className="ios-wheel-column" key={kind}>
            <div className="ios-wheel-label">{kind === 'from' ? '시작' : '종료'}</div>
            <div className="ios-wheel-frame"><div className="ios-wheel-selection" />
              <div className="ios-wheel">{dates.map((date) => <button key={date} type="button" className={date === (kind === 'from' ? from : to) ? 'selected' : ''} onClick={() => setDate(kind, date)}>{formatDateLabel(date)}</button>)}</div>
            </div>
          </div>)}
        </div> : null}

        {mode === 'direct' ? <div className="range-direct-v13">
          <label><span>시작</span><input className="range-text-date" value={fromText} onChange={(e) => setFromText(e.target.value)} onBlur={commitText} placeholder="YYYY-MM-DD" /></label>
          <label><span>종료</span><input className="range-text-date" value={toText} onChange={(e) => setToText(e.target.value)} onBlur={commitText} placeholder="YYYY-MM-DD" /></label>
        </div> : null}

        {mode === 'calendar' ? <div className="range-calendar-wrap">
          <div className="range-calendar-head"><b>{year}년 {month + 1}월</b><span>{step === 'start' ? '시작일' : '종료일'}</span></div>
          <div className="range-calendar-weekdays">{['일','월','화','수','목','금','토'].map((day) => <span key={day}>{day}</span>)}</div>
          <div className="range-calendar-grid">{calendarDates.map((date, index) => date ? <button key={date} type="button" className={date === from || date === to ? 'edge' : date >= from && date <= to ? 'in-range' : ''} onClick={() => calendarClick(date)}>{Number(date.slice(-2))}</button> : <span key={'empty-' + index} />)}</div>
        </div> : null}
      </div> : null}
    </div>
  );
}
