import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useApplicationServices } from '../app/ApplicationServicesContext';
import type { SavedCommuteRoute, TransitAccessPoint } from '../domain/models';
import { useCommuteOverview } from '../features/commute/useCommuteWorkflow';
import { BackButton } from '../shared/components/BackButton';
import { Icon } from '../shared/components/Icon';
import './commute-page.css';

function displayName(point: TransitAccessPoint): string {
  return point.userLabel || point.name;
}

function accessMeta(point: TransitAccessPoint): string {
  const parts = [];
  if (point.line) parts.push(point.line);
  if (point.displayCode) parts.push('정류소 ' + point.displayCode);
  if (point.walkMinutes != null) parts.push('도보 ' + point.walkMinutes + '분');
  return parts.join(' · ');
}

function selectedRoute(routes: SavedCommuteRoute[], routeId?: string): SavedCommuteRoute | null {
  return routes.find((route) => route.id === routeId) ?? routes.find((route) => route.active) ?? routes[0] ?? null;
}

function routeAccessIds(route: SavedCommuteRoute, role: 'origin' | 'destination'): string[] {
  if (role === 'origin') {
    return route.originAccessPointIds ??
      (route.originAccessPointId ? [route.originAccessPointId] : []);
  }
  return route.destinationAccessPointIds ??
    (route.destinationAccessPointId ? [route.destinationAccessPointId] : []);
}

export function CommuteManualPage() {
  const { personId = '', routeId } = useParams();
  const navigate = useNavigate();
  const services = useApplicationServices();
  const state = useCommuteOverview(personId);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  if (state.status === 'loading') return <section className="commute-page"><div className="commute-message">경로를 불러오는 중</div></section>;
  if (state.status === 'error' || !state.overview.person) return <section className="commute-page"><div className="commute-message">경로를 불러오지 못했습니다.</div></section>;

  const { overview } = state;
  const route = selectedRoute(overview.savedRoutes, routeId);
  const points = [...overview.originAccessPoints, ...overview.destinationAccessPoints];

  if (!route) {
    return (
      <section className="commute-page" data-page="CommuteRouteManualPage" data-state="EMPTY">
        <BackButton fallbackTo={'/people/' + encodeURIComponent(personId) + '/commute'} />
        <h1 className="page-title">경로 설정</h1>
        <div className="empty-inline">저장된 경로가 없습니다.</div>
        <button
          type="button"
          className="cta"
          onClick={async () => {
            const created = await services.actions.commute.createSavedRoute(personId);
            navigate('/people/' + encodeURIComponent(personId) + '/commute/routes/' + encodeURIComponent(created.id), { replace: true });
          }}
        >
          <Icon name="plus" /> 경로 1 만들기
        </button>
      </section>
    );
  }

  const originIds = routeAccessIds(route, 'origin');
  const destinationIds = routeAccessIds(route, 'destination');
  const originPoints = originIds
    .map((id) => points.find((point) => point.id === id))
    .filter((point): point is TransitAccessPoint => Boolean(point));
  const destinationPoints = destinationIds
    .map((id) => points.find((point) => point.id === id))
    .filter((point): point is TransitAccessPoint => Boolean(point));
  const viaPoints = route.viaAccessPointIds
    .map((id) => points.find((point) => point.id === id))
    .filter((point): point is TransitAccessPoint => Boolean(point));

  const routeBase =
    '/people/' + encodeURIComponent(personId) + '/commute/routes/' + encodeURIComponent(route.id);
  const originAccessPath =
    '/people/' + encodeURIComponent(personId) + '/commute/origin/access?routeId=' +
    encodeURIComponent(route.id) + '&routeRole=origin';
  const viaAccessPath =
    '/people/' + encodeURIComponent(personId) + '/commute/origin/access?routeId=' +
    encodeURIComponent(route.id) + '&routeRole=via&index=' + route.viaAccessPointIds.length;
  const destinationAccessPath =
    '/people/' + encodeURIComponent(personId) + '/commute/destination/access?routeId=' +
    encodeURIComponent(route.id) + '&routeRole=destination';

  const replaceViaPath = (index: number) =>
    '/people/' + encodeURIComponent(personId) + '/commute/origin/access?routeId=' +
    encodeURIComponent(route.id) + '&routeRole=via&routeEdit=replace&index=' + index;

  const move = async (from: number, to: number) => {
    if (to < 0 || to >= route.viaAccessPointIds.length || from === to) return;
    await services.actions.commute.moveRouteVia(personId, route.id, from, to);
  };

  return (
    <section className="commute-page" data-route={routeBase} data-page="CommuteRouteManualPage" data-state="EDITING">
      <BackButton fallbackTo={'/people/' + encodeURIComponent(personId) + '/commute'} />
      <h1 className="page-title">{route.label} 설정</h1>

      <div className="manual-route-list">
        <button type="button" className="manual-route-node" onClick={() => navigate('/people/' + encodeURIComponent(personId) + '/place/origin')}>
          <Icon name="home" />
          <span><b>{overview.origin?.label || '출발지'}</b><span className="manual-route-meta">출발지 수정</span></span>
          <Icon name="chevron-right" />
        </button>

        {originPoints.length ? (
          <div className="manual-route-transport">
            <div className="manual-route-transport-label">출발 교통수단 · 복수 선택</div>
            {originPoints.map((point) => (
              <div className="manual-route-selected-access" key={point.id}>
                <button type="button" className="manual-route-edit" onClick={() => navigate(originAccessPath)}>
                  <span className="manual-route-mode"><Icon name={point.mode === 'BUS' ? 'bus' : 'train'} /></span>
                  <span><b>{displayName(point)}</b>{accessMeta(point) ? <span className="manual-route-meta">{accessMeta(point)}</span> : null}</span>
                  <span className="node-trailing"><Icon name="chevron-right" /></span>
                </button>
                <button
                  type="button"
                  className="route-via-remove"
                  aria-label={displayName(point) + ' 출발 교통 삭제'}
                  onClick={() => services.actions.commute.removeRouteOriginAccess(personId, route.id, point.id)}
                >×</button>
              </div>
            ))}
          </div>
        ) : null}

        <button type="button" className="cta secondary route-leg-add" onClick={() => navigate(originAccessPath)}>
          <Icon name="plus" /> 출발 교통수단 추가
        </button>

        <div className="manual-route-section-title">경유 교통수단</div>

        {viaPoints.map((point, index) => (
          <div
            className="manual-route-draggable"
            key={route.viaAccessPointIds[index] ?? point.id}
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={async () => {
              if (dragIndex != null) await move(dragIndex, index);
              setDragIndex(null);
            }}
          >
            <button
              type="button"
              className="route-drag-handle"
              aria-label="경유 교통수단 순서 이동"
              onKeyDown={async (event) => {
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  await move(index, index - 1);
                }
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  await move(index, index + 1);
                }
              }}
            >
              <Icon name="grip" />
            </button>
            <button type="button" className="manual-route-edit" onClick={() => navigate(replaceViaPath(index))}>
              <span className="manual-route-mode"><Icon name={point.mode === 'BUS' ? 'bus' : 'train'} /></span>
              <span><b>{displayName(point)}</b>{accessMeta(point) ? <span className="manual-route-meta">{accessMeta(point)}</span> : null}</span>
              <span className="node-trailing"><Icon name="chevron-right" /></span>
            </button>
            <button
              type="button"
              className="route-via-remove"
              aria-label={displayName(point) + ' 경유 삭제'}
              onClick={() => services.actions.commute.removeRouteVia(personId, route.id, index)}
            >
              ×
            </button>
          </div>
        ))}

        <button type="button" className="cta secondary route-leg-add" onClick={() => navigate(viaAccessPath)}>
          <Icon name="plus" /> 경유 교통수단 추가
        </button>

        {destinationPoints.length ? (
          <div className="manual-route-transport">
            <div className="manual-route-transport-label">도착 교통수단 · 복수 선택</div>
            {destinationPoints.map((point) => (
              <div className="manual-route-selected-access" key={point.id}>
                <button type="button" className="manual-route-edit" onClick={() => navigate(destinationAccessPath)}>
                  <span className="manual-route-mode"><Icon name={point.mode === 'BUS' ? 'bus' : 'train'} /></span>
                  <span><b>{displayName(point)}</b>{accessMeta(point) ? <span className="manual-route-meta">{accessMeta(point)}</span> : null}</span>
                  <span className="node-trailing"><Icon name="chevron-right" /></span>
                </button>
                <button
                  type="button"
                  className="route-via-remove"
                  aria-label={displayName(point) + ' 도착 교통 삭제'}
                  onClick={() => services.actions.commute.removeRouteDestinationAccess(personId, route.id, point.id)}
                >×</button>
              </div>
            ))}
          </div>
        ) : null}

        <button type="button" className="cta secondary route-leg-add" onClick={() => navigate(destinationAccessPath)}>
          <Icon name="plus" /> 도착 교통수단 추가
        </button>

                <button type="button" className="manual-route-node" onClick={() => navigate('/people/' + encodeURIComponent(personId) + '/place/destination')}>
          <Icon name="home" />
          <span><b>{overview.destination?.label || '도착지'}</b><span className="manual-route-meta">도착지 수정</span></span>
          <Icon name="chevron-right" />
        </button>
      </div>

      {!route.active ? (
        <button type="button" className="cta secondary" onClick={() => services.actions.commute.selectSavedRoute(personId, route.id)}>
          이 경로 사용
        </button>
      ) : null}
      <button type="button" className="cta" onClick={() => navigate('/people/' + encodeURIComponent(personId) + '/commute')}>저장</button>
    </section>
  );
}
