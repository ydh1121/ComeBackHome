import { useEffect, useMemo, useRef, useState } from 'react';
import './wheel-time-picker.css';

type TimeKind = 'start' | 'end';

interface Props {
  start: string | null;
  end: string | null;
  onChange(kind: TimeKind, value: string): void | Promise<void>;
  startLabel?: string;
  endLabel?: string;
  minuteStep?: number;
}

function parseTime(value: string | null, fallbackHour: number): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(value ?? '');
  if (!match) return { hour: fallbackHour, minute: 0 };
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return { hour: fallbackHour, minute: 0 };
  }
  return { hour, minute };
}

function formatTime(hour: number, minute: number): string {
  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
}

export function TimeRangeWheelPicker({
  start,
  end,
  onChange,
  startLabel = '출근',
  endLabel = '퇴근',
  minuteStep = 5,
}: Props) {
  const [active, setActive] = useState<TimeKind | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const value = active === 'start' ? start : active === 'end' ? end : null;
  const fallbackHour = active === 'end' ? 18 : 9;
  const parsed = parseTime(value, fallbackHour);

  const minutes = useMemo(() => {
    const step = Math.max(1, Math.min(30, Math.round(minuteStep)));
    const values = new Set<number>();
    for (let minute = 0; minute < 60; minute += step) values.add(minute);
    if (value && parsed.minute >= 0 && parsed.minute <= 59) values.add(parsed.minute);
    return [...values].sort((left, right) => left - right);
  }, [minuteStep, value, parsed.minute]);

  useEffect(() => {
    if (!active || !panelRef.current) return;
    requestAnimationFrame(() => {
      panelRef.current?.querySelectorAll<HTMLElement>('[data-wheel-selected="true"]').forEach((node) => {
        node.scrollIntoView({ block: 'center', inline: 'nearest' });
      });
    });
  }, [active]);

  const setPart = (part: 'hour' | 'minute', next: number) => {
    if (!active) return;
    const nextHour = part === 'hour' ? next : parsed.hour;
    const nextMinute = part === 'minute' ? next : parsed.minute;
    void onChange(active, formatTime(nextHour, nextMinute));
  };

  const trigger = (kind: TimeKind, label: string, current: string | null) => (
    <div className="time-wheel-field">
      <span className="time-wheel-label">{label}</span>
      <button
        type="button"
        className={'time-wheel-trigger' + (active === kind ? ' active' : '')}
        aria-expanded={active === kind}
        onClick={() => setActive((currentKind) => currentKind === kind ? null : kind)}
      >
        {current || '선택'}
      </button>
    </div>
  );

  return (
    <div className="time-range-wheel" data-active={active ?? 'none'}>
      <div className="time-range-wheel-fields">
        {trigger('start', startLabel, start)}
        {trigger('end', endLabel, end)}
      </div>

      {active ? (
        <div className="time-wheel-panel" ref={panelRef}>
          <div className="time-wheel-panel-head">
            <b>{active === 'start' ? startLabel : endLabel} 시간</b>
            <button type="button" onClick={() => setActive(null)}>완료</button>
          </div>
          <div className="time-wheel-columns">
            <div className="time-wheel-column" aria-label="시간 선택">
              <div className="time-wheel-selection" />
              <div className="time-wheel-scroll">
                {Array.from({ length: 24 }, (_, hour) => (
                  <button
                    type="button"
                    key={hour}
                    className={hour === parsed.hour ? 'selected' : ''}
                    data-wheel-selected={hour === parsed.hour ? 'true' : 'false'}
                    onClick={() => setPart('hour', hour)}
                  >
                    {String(hour).padStart(2, '0')}
                  </button>
                ))}
              </div>
              <span className="time-wheel-unit">시</span>
            </div>
            <div className="time-wheel-column" aria-label="분 선택">
              <div className="time-wheel-selection" />
              <div className="time-wheel-scroll">
                {minutes.map((minute) => (
                  <button
                    type="button"
                    key={minute}
                    className={minute === parsed.minute ? 'selected' : ''}
                    data-wheel-selected={minute === parsed.minute ? 'true' : 'false'}
                    onClick={() => setPart('minute', minute)}
                  >
                    {String(minute).padStart(2, '0')}
                  </button>
                ))}
              </div>
              <span className="time-wheel-unit">분</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
