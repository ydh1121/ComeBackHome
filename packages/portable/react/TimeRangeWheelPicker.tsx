import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import './time-wheel.css';

type TimeKind = 'start' | 'end';

export interface TimeRangeWheelPickerProps {
  start: string | null;
  end: string | null;
  onChange(kind: TimeKind, value: string): void | Promise<void>;
  startLabel?: string;
  endLabel?: string;
  minuteStep?: number;
  labels?: { select: string; done: string; time: string; hours: string; minutes: string; hourUnit: string; minuteUnit: string };
  fallbackHours?: { start: number; end: number };
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
  startLabel = 'Start',
  endLabel = 'End',
  minuteStep = 5,
  labels = { select: 'Select', done: 'Done', time: 'time', hours: 'Select hour', minutes: 'Select minute', hourUnit: 'h', minuteUnit: 'm' },
  fallbackHours = { start: 9, end: 18 },
}: TimeRangeWheelPickerProps) {
  const [active, setActive] = useState<TimeKind | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Wheel hour/minute clicks may run before the parent has rendered the first
  // choice, especially when coming back from OFF (empty clock).
  const pendingClock = useRef<{ kind: TimeKind; value: string } | null>(null);
  const value = active === 'start' ? start : active === 'end' ? end : null;
  const fallbackHour = active === 'end' ? fallbackHours.end : fallbackHours.start;
  const parsed = parseTime(value, fallbackHour);
  useEffect(() => {
    if (!active || pendingClock.current?.kind !== active) {
      pendingClock.current = null;
    } else if (pendingClock.current.value === value) {
      pendingClock.current = null;
    }
  }, [active, value]);

  const minutes = useMemo(() => {
    const step = Math.max(1, Math.min(30, Math.round(minuteStep)));
    const values = new Set<number>();
    for (let minute = 0; minute < 60; minute += step) values.add(minute);
    if (value && parsed.minute >= 0 && parsed.minute <= 59) values.add(parsed.minute);
    return [...values].sort((left, right) => left - right);
  }, [minuteStep, value, parsed.minute]);

  useLayoutEffect(() => {
    if (!active || !panelRef.current) return;
    for (const selected of panelRef.current.querySelectorAll<HTMLElement>('[data-wheel-selected="true"]')) {
      const scroller = selected.closest<HTMLElement>('.time-wheel-scroll');
      if (!scroller) continue;
      const itemRect = selected.getBoundingClientRect();
      const scrollRect = scroller.getBoundingClientRect();
      scroller.scrollTop += itemRect.top - scrollRect.top -
        (scroller.clientHeight - itemRect.height) / 2;
    }
  }, [active]);

  const setPart = (part: 'hour' | 'minute', next: number) => {
    if (!active) return;
    const latest = pendingClock.current?.kind === active
      ? parseTime(pendingClock.current.value, fallbackHour)
      : parsed;
    const nextHour = part === 'hour' ? next : latest.hour;
    const nextMinute = part === 'minute' ? next : latest.minute;
    const updated = formatTime(nextHour, nextMinute);
    pendingClock.current = { kind: active, value: updated };
    void onChange(active, updated);
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
        {current || labels.select}
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
            <b>{active === 'start' ? startLabel : endLabel} {labels.time}</b>
            <button type="button" onClick={() => setActive(null)}>{labels.done}</button>
          </div>
          <div className="time-wheel-columns">
            <div className="time-wheel-column" aria-label={labels.hours}>
              <div className="time-wheel-selection" />
              <div className="time-wheel-scroll">
                {Array.from({ length: 24 }, (_, hour) => (
                  <button
                    type="button"
                    key={hour}
                    className={hour === parsed.hour ? 'selected' : ''}
                    data-wheel-selected={hour === parsed.hour ? 'true' : 'false'}
                    onPointerDown={(event) => { if (event.pointerType === 'mouse') setPart('hour', hour); }}
                    onClick={() => setPart('hour', hour)}
                  >
                    {String(hour).padStart(2, '0')}
                  </button>
                ))}
              </div>
              <span className="time-wheel-unit">{labels.hourUnit}</span>
            </div>
            <div className="time-wheel-column" aria-label={labels.minutes}>
              <div className="time-wheel-selection" />
              <div className="time-wheel-scroll">
                {minutes.map((minute) => (
                  <button
                    type="button"
                    key={minute}
                    className={minute === parsed.minute ? 'selected' : ''}
                    data-wheel-selected={minute === parsed.minute ? 'true' : 'false'}
                    onPointerDown={(event) => { if (event.pointerType === 'mouse') setPart('minute', minute); }}
                    onClick={() => setPart('minute', minute)}
                  >
                    {String(minute).padStart(2, '0')}
                  </button>
                ))}
              </div>
              <span className="time-wheel-unit">{labels.minuteUnit}</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
