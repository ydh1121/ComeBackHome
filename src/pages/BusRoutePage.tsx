import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { useApplicationServices } from '../app/ApplicationServicesContext';
import type { PlaceKind } from '../domain/models';
import { useAccessPoint } from '../features/commute/useCommuteWorkflow';
import { BackButton } from '../shared/components/BackButton';
import { Icon } from '../shared/components/Icon';
import './commute-page.css';

function resolveKind(value?: string): PlaceKind {
  return value === 'destination' ? 'destination' : 'origin';
}

export function BusRoutePage() {
  const { personId = '', placeKind, accessId = '' } = useParams();
  const kind = resolveKind(placeKind);
  const services = useApplicationServices();
  const state = useAccessPoint(personId, kind, accessId);
  const [editing, setEditing] = useState(false);
  const [alias, setAlias] = useState('');

  useEffect(() => {
    if (state.status === 'ready') setAlias(state.point?.userLabel ?? '');
  }, [state.status, state.status === 'ready' ? state.point?.id : null]);

  const back = '/people/' + encodeURIComponent(personId) + '/commute/' + kind + '/access';

  if (state.status === 'loading') return <section className="commute-page"><div className="commute-message">버스 정보를 불러오는 중</div></section>;
  if (state.status === 'error' || !state.point || state.point.mode !== 'BUS') return <section className="commute-page"><div className="commute-message">버스 정보를 찾지 못했습니다.</div></section>;

  const point = state.point;
  const displayName = point.userLabel || point.name;
  const meta = [point.displayCode ? '정류소 ' + point.displayCode : null, point.walkMinutes != null ? '도보 ' + point.walkMinutes + '분' : null].filter(Boolean).join(' · ');

  const saveAlias = async () => {
    await services.actions.busRoutes.setAlias(point.id, alias);
    setEditing(false);
  };

  return (
    <section className="commute-page" data-page="BusRouteSelector" data-state={point.busRoutes?.length ? 'ROUTE_SELECTING' : 'NO_RESULT'}>
      <BackButton fallbackTo={back} />
      <h1 className="page-title">버스 선택</h1>

      <div className="bus-stop-card">
        <div className="bus-stop-card-head">
          <Icon name="bus" />
          <div>
            <div className="bus-stop-name">{displayName}</div>
            {point.userLabel && point.userLabel !== point.name ? <div className="bus-stop-official">공식명 {point.name}</div> : null}
            <div className="bus-stop-meta">{meta}</div>
          </div>
          <button type="button" className="text-btn" onClick={() => setEditing(true)}>이름 수정</button>
        </div>

        {editing ? (
          <div className="bus-stop-alias-edit">
            <input className="input" value={alias} onChange={(event) => setAlias(event.target.value)} placeholder="내가 알아보기 쉬운 이름" />
            <div className="bus-stop-alias-actions">
              <button type="button" onClick={() => { setAlias(point.userLabel ?? ''); setEditing(false); }}>취소</button>
              <button type="button" onClick={saveAlias}>저장</button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="section-title">이 정류장을 지나는 버스</div>
      <div className="bus-route-list">
        {(point.busRoutes ?? []).map((route) => {
          const selected = point.selectedBusRouteId === route.providerRouteId;
          return (
            <button
              type="button"
              className={'bus-route-option' + (selected ? ' selected' : '')}
              key={route.providerRouteId}
              onClick={() => services.actions.busRoutes.selectRoute(point.id, route.providerRouteId)}
            >
              <span className="bus-route-copy">
                <span className="bus-route-no">{route.routeNo || '버스'}</span>
                <span className="bus-route-direction">{route.directionLabel || '방면 정보 없음'}</span>
                {route.terminalName ? <span className="bus-route-terminal">종점 {route.terminalName}</span> : null}
              </span>
              <span className="bus-route-select">{selected ? <Icon name="check" /> : <Icon name="chevron-right" />}</span>
            </button>
          );
        })}
        {!point.busRoutes?.length ? <div className="search-inline-status" data-state="NO_RESULT">버스 데이터 대기 중</div> : null}
      </div>
    </section>
  );
}
