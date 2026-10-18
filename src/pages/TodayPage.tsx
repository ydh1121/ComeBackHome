import { TransitIcon } from '../shared/components/TransitIcon';
import { useSeoulDate } from '../shared/runtime/useSeoulDate';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useApplicationServices, useApplicationVersion } from '../app/ApplicationServicesContext';
import type { TodayOverviewQueryResult } from '../application/queries/ComeBackHomeQueries';
import { Icon } from '../shared/components/Icon';
import { useOnlineStatus } from '../shared/runtime/useOnlineStatus';
import './today-page.css';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: TodayOverviewQueryResult }
  | { status: 'error' };


function kstTimeFromIso(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function freshnessLabel(data: TodayOverviewQueryResult): string {
  const eta = data.eta;
  if (!eta) return '정보 확인 중';
  if (eta.status === 'ACTUAL') return '집 도착 확인';
  if (eta.status === 'LIVE') return `실시간 · ${eta.freshnessMinutes ?? 0}분 전`;
  if (eta.status === 'STALE') return `최근 정보 · ${eta.freshnessMinutes ?? 0}분 전`;
  if (eta.status === 'FALLBACK') return '예상 경로 기준';
  if (eta.status === 'UNKNOWN') return '정보 확인 중';
  return '정보 확인 중';
}

export function TodayPage() {
  const services = useApplicationServices();
  const version = useApplicationVersion();
  const navigate = useNavigate();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const online = useOnlineStatus();
  const currentDate = useSeoulDate();

  useEffect(() => {
    let active = true;
    services.queries.getTodayOverview(currentDate).then((data) => {
      if (active) setLoadState({ status: 'ready', data });
    }).catch(() => {
      if (active) setLoadState({ status: 'error' });
    });
    return () => { active = false; };
  }, [services, version, currentDate]);

  if (loadState.status === 'loading') {
    return <section className="today-page" data-route="/" data-page="TodayPage" data-state="LOADING"><div className="today-loading" aria-live="polite">오늘 정보를 불러오는 중</div></section>;
  }

  if (loadState.status === 'error') {
    return <section className="today-page" data-route="/" data-page="TodayPage" data-state="ERROR"><div className="today-error" role="alert">오늘 정보를 불러오지 못했습니다.</div></section>;
  }

  const data = loadState.data;
  const nonWalkingSteps = data.route?.steps?.filter((step) => step.type !== 'WALKING') ?? [];
  const actualLeftWork = kstTimeFromIso(data.leftWorkAt);
  const actualHomeArrival = kstTimeFromIso(data.arrivedHomeAt);
  const statusState = actualHomeArrival
    ? 'ARRIVED_HOME'
    : actualLeftWork
      ? 'LEFT_WORK'
      : data.shiftEnd
        ? 'WORKING'
        : 'NO_SCHEDULE_TODAY';

  return (
    <section className="today-page" data-route="/" data-page="TodayPage" data-state={(online ? statusState : 'OFFLINE ' + statusState)} data-selected-route-id={data.route?.id ?? ''} data-eta-status={data.eta?.status ?? 'UNKNOWN'}>
      <div className="person-switch">
        <button type="button" className="person-select" onClick={() => setPickerOpen((open) => !open)} aria-expanded={pickerOpen}>
          {data.person?.name ?? '사람 선택'}
          <span className={`person-select-chevron${pickerOpen ? ' open' : ''}`}><Icon name="chevron-down" /></span>
        </button>
      </div>

      <div className="person-picker-layer" hidden={!pickerOpen}>
        <button type="button" className="person-picker-backdrop" onClick={() => setPickerOpen(false)} aria-label="사람 선택 닫기" />
        <div className="person-picker-sheet" role="dialog" aria-modal="true" aria-label="사람 선택">
          <div className="person-picker-handle" />
          <div className="person-picker-head"><h2>사람 선택</h2></div>
          <div className="person-picker-list">
            {data.people.map((person) => {
              const selected = person.id === data.person?.id;
              return (
                <button
                  key={person.id}
                  type="button"
                  className={`person-picker-row${selected ? ' selected' : ''}`}
                  onClick={() => {
                    services.actions.personSelection.select(person.id);
                    setPickerOpen(false);
                  }}
                >
                  <span><b>{person.name}</b><small>{person.relation}</small></span>
                  {selected ? <Icon name="check" /> : null}
                </button>
              );
            })}
          </div>
          <button type="button" className="person-picker-manage" onClick={() => navigate('/people')}><span>사람 관리</span><Icon name="chevron-right" /></button>
        </div>
      </div>

      <div className="hero anti-ai-hero" data-component="TodayStatus">
        <div className="today-statusline">{online ? freshnessLabel(data) : '오프라인 · 마지막 정보'}</div>
        <div className="time-label">{actualHomeArrival ? '집 도착' : '집 도착 예상 범위'}</div>
        <div className="big-time">{actualHomeArrival ?? (data.eta?.earliestArrivalAt && data.eta?.latestArrivalAt ? kstTimeFromIso(data.eta.earliestArrivalAt) + '–' + kstTimeFromIso(data.eta.latestArrivalAt) : data.eta?.arrivalTime ?? '—')}</div>
        {!actualHomeArrival && data.shiftEnd && !actualLeftWork ? <p className="departure-estimate">{data.eta?.departureUnconfirmed ? '예정 퇴근 시간이 지났습니다. 실제 출발은 확인되지 않았습니다.' : '예정 퇴근 ±10분 기준 · 실제 출발 미확인'}</p> : null}
        <div className="commute-simple">
          {nonWalkingSteps.map((step, index) => (
            <div className="commute-simple-row" key={`${step.type}-${index}`}>
              <span className="commute-simple-icon"><TransitIcon mode={step.type} line={step.label} /></span>
              <span>{step.label}</span>
            </div>
          ))}
        </div>
        <div className="today-meta-row">
          <div className="today-meta"><span>오늘 출근</span><b>{data.shiftStart ?? '—'}</b></div>
          <div className="today-meta">
            <span>{actualLeftWork ? '실제 퇴근' : '예정 퇴근'}</span>
            <b>{actualLeftWork ?? data.shiftEnd ?? '—'}</b>
          </div>
          <div className="today-meta today-next-shift"><span>다음 출근</span><b>{data.nextShiftLabel ?? '—'}</b></div>
        </div>
        {actualLeftWork || actualHomeArrival ? (
          <div className="presence-status-row" aria-label="오늘 이동 상태">
            {actualLeftWork ? <span>퇴근 {actualLeftWork}</span> : null}
            {actualHomeArrival ? <span>집 도착 {actualHomeArrival}</span> : null}
          </div>
        ) : null}
      </div>

      <div className="action-row anti-ai-actions">
        <button type="button" className="action-card" onClick={() => navigate('/schedule')}><Icon name="calendar" /><span>일정</span></button>
        <button type="button" className="action-card" disabled={!data.person} onClick={() => data.person && navigate(`/people/${encodeURIComponent(data.person.id)}`)}><Icon name="map" /><span>이동 경로</span></button>
      </div>
    </section>
  );
}
