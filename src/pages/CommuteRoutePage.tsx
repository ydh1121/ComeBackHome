import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useApplicationServices } from '../app/ApplicationServicesContext';
import type { RouteCandidate, SavedCommuteRoute, TransitAccessPoint } from '../domain/models';
import { useCommuteOverview } from '../features/commute/useCommuteWorkflow';
import { BackButton } from '../shared/components/BackButton';
import { Icon, type IconName } from '../shared/components/Icon';
import './commute-page.css';

function stepIcon(type: string): IconName {
  if (type === 'BUS') return 'bus';
  if (type === 'SUBWAY') return 'train';
  return 'walk';
}

function displayName(point: TransitAccessPoint | undefined): string {
  return point?.userLabel || point?.name || '미설정';
}

function routeAccessIds(route: SavedCommuteRoute, role: 'origin' | 'destination'): string[] {
  if (role === 'origin') {
    return route.originAccessPointIds ??
      (route.originAccessPointId ? [route.originAccessPointId] : []);
  }
  return route.destinationAccessPointIds ??
    (route.destinationAccessPointId ? [route.destinationAccessPointId] : []);
}

function RouteSteps({ route }: { route: RouteCandidate }) {
  return <div className="route-steps">{(route.steps ?? []).map((step, index) => (
    <div className="route-step" key={index}>
      <Icon name={stepIcon(step.type)} />
      <span>{step.label}</span>
    </div>
  ))}</div>;
}

function SavedRouteSummary({
  route,
  points,
  onEdit,
  onSelect,
}: {
  route: SavedCommuteRoute;
  points: TransitAccessPoint[];
  onEdit: () => void;
  onSelect: () => void;
}) {
  const originPoints = routeAccessIds(route, 'origin')
    .map((id) => points.find((point) => point.id === id))
    .filter((point): point is TransitAccessPoint => Boolean(point));
  const destinationPoints = routeAccessIds(route, 'destination')
    .map((id) => points.find((point) => point.id === id))
    .filter((point): point is TransitAccessPoint => Boolean(point));
  const viaPoints = route.viaAccessPointIds
    .map((id) => points.find((point) => point.id === id))
    .filter((point): point is TransitAccessPoint => Boolean(point));

  return (
    <div className={'saved-route-setting' + (route.active ? ' active' : '')}>
      <div className="saved-route-setting-head">
        <button type="button" className="saved-route-setting-title" onClick={onEdit}>
          <span>{route.label} 설정</span>
          <Icon name="chevron-right" />
        </button>
        <button
          type="button"
          className={'saved-route-active' + (route.active ? ' selected' : '')}
          onClick={onSelect}
          aria-label={route.active ? route.label + ' 사용 중' : route.label + ' 사용'}
        >
          {route.active ? <Icon name="check" /> : '사용'}
        </button>
      </div>
      <button type="button" className="saved-route-setting-body" onClick={onEdit}>
        <span className="saved-route-line"><b>출발</b><span>{originPoints.length ? originPoints.map(displayName).join(' · ') : '미설정'}</span></span>
        <span className="saved-route-line"><b>경유</b><span>{viaPoints.length ? viaPoints.map(displayName).join(' · ') : '없음'}</span></span>
        <span className="saved-route-line"><b>도착</b><span>{destinationPoints.length ? destinationPoints.map(displayName).join(' · ') : '미설정'}</span></span>
      </button>
    </div>
  );
}

export function CommuteRoutePage() {
  const { personId = '' } = useParams();
  const navigate = useNavigate();
  const services = useApplicationServices();
  const state = useCommuteOverview(personId);
  const [expanded, setExpanded] = useState(false);
  const [draftRouteId, setDraftRouteId] = useState<string | null>(null);
  const [savingRoute, setSavingRoute] = useState(false);
  const [routeMessage, setRouteMessage] = useState<string | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);

  if (state.status === 'loading') return <section className="commute-page"><div className="commute-message">경로를 불러오는 중</div></section>;
  if (state.status === 'error' || !state.overview.person) return <section className="commute-page"><div className="commute-message">경로를 불러오지 못했습니다.</div></section>;

  const { overview } = state;
  const points = [...overview.originAccessPoints, ...overview.destinationAccessPoints];
  const candidates = overview.routeCandidates;
  const activeSavedRoute = overview.savedRoutes.find((route) => route.active) ?? overview.savedRoutes[0];
  const activeOriginIds = activeSavedRoute
    ? activeSavedRoute.originAccessPointIds ??
      (activeSavedRoute.originAccessPointId ? [activeSavedRoute.originAccessPointId] : [])
    : [];
  const activeDestinationIds = activeSavedRoute
    ? activeSavedRoute.destinationAccessPointIds ??
      (activeSavedRoute.destinationAccessPointId ? [activeSavedRoute.destinationAccessPointId] : [])
    : [];
  const hasTransitPreference =
    activeOriginIds.length > 0 ||
    activeDestinationIds.length > 0 ||
    (activeSavedRoute?.viaAccessPointIds.length ?? 0) > 0;
  const visible = expanded ? candidates : candidates.slice(0, 3);
  const remain = Math.max(0, candidates.length - visible.length);

  const routePath = (routeId: string) =>
    '/people/' + encodeURIComponent(personId) + '/commute/routes/' + encodeURIComponent(routeId);

  const addRoute = async () => {
    const route = await services.actions.commute.createSavedRoute(personId);
    navigate(routePath(route.id));
  };

  const savePreferredRoute = async () => {
    if (!draftRouteId || savingRoute) return;
    setSavingRoute(true);
    setRouteError(null);
    setRouteMessage(null);
    try {
      await services.actions.commute.selectRouteCandidate(personId, draftRouteId);
      const readback = await services.queries.getCommuteOverview(personId);
      if (readback.preferredRouteCandidateId !== draftRouteId) {
        throw new Error('선택한 추천 경로가 저장 후 조회되지 않았습니다.');
      }
      setDraftRouteId(null);
      setRouteMessage('선택한 추천 경로를 저장했습니다.');
    } catch (error) {
      setRouteError(error instanceof Error ? error.message : '추천 경로 저장에 실패했습니다.');
    } finally {
      setSavingRoute(false);
    }
  };

  return (
    <section className="commute-page" data-route={'/people/' + personId + '/commute'} data-page="CommuteRouteEditPage" data-state={overview.savedRoutes.length ? 'ROUTE_CONFIGURED' : 'EMPTY'}>
      <BackButton fallbackTo={'/people/' + encodeURIComponent(personId)} />
      <h1 className="page-title">경로 설정</h1>

      <div className="saved-route-settings">
        {overview.savedRoutes.map((route) => (
          <SavedRouteSummary
            key={route.id}
            route={route}
            points={points}
            onEdit={() => navigate(routePath(route.id))}
            onSelect={() => services.actions.commute.selectSavedRoute(personId, route.id)}
          />
        ))}
        {!overview.savedRoutes.length ? <div className="empty-inline">저장된 경로가 없습니다.</div> : null}
      </div>

      <button type="button" className="cta secondary" onClick={addRoute}><Icon name="plus" /> 경로 추가</button>

      <div className="route-section-head"><h2>추천 경로</h2></div>
      <div className="route-recommendation-context">
        {hasTransitPreference
          ? '선택한 출발지·도착지 교통의 위치 조합을 실제 출발·도착 기준으로 사용해 카카오 대중교통 경로를 추천합니다.'
          : '선택한 교통이 없어 저장된 출발지·도착지 위치를 기준으로 카카오 대중교통 경로를 추천합니다.'}
      </div>
      {!candidates.length ? <div className="search-inline-status" data-state="NO_RESULT">사용 가능한 추천 경로가 없습니다.</div> : null}
      <div className="route-policy-list">
        {visible.map((route) => {
          const selected = route.id === (draftRouteId ?? overview.preferredRouteCandidateId);
          return (
            <button
              type="button"
              className={'route-candidate' + (selected ? ' selected' : '')}
              data-route-candidate-id={route.id}
              key={route.id}
              aria-pressed={selected}
              onClick={() => {
                setDraftRouteId(route.id);
                setRouteMessage(null);
                setRouteError(null);
              }}
            >
              <div className="route-candidate-head">
                <div>
                  <div className="route-badges">
                    {(route.policyLabels ?? []).map((label) => <span className="route-badge" key={label}>{label}</span>)}
                  </div>
                  <div className="route-candidate-meta">
                    {route.totalMinutes}분 · 환승 {route.transferCount}회 · 도보 {route.walkMinutes}분{route.fare != null ? ' · ' + route.fare.toLocaleString() + '원' : ''}
                  </div>
                </div>
                {selected ? <Icon name="check" /> : null}
              </div>
              <RouteSteps route={route} />
            </button>
          );
        })}
      </div>

      {remain ? <div className="route-more"><button type="button" className="cta secondary" onClick={() => setExpanded(true)}>다른 경로 {remain}개 보기</button></div> : null}
      {draftRouteId ? (
        <button type="button" className="cta" disabled={savingRoute} onClick={() => void savePreferredRoute()}>
          {savingRoute ? '추천 경로 저장 중' : '선택한 추천 경로 저장'}
        </button>
      ) : null}
      {routeMessage ? <div className="search-inline-status" role="status">{routeMessage}</div> : null}
      {routeError ? <div className="search-inline-status" role="alert">{routeError}</div> : null}
    </section>
  );
}
