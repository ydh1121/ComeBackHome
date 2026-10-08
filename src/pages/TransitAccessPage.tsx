import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useApplicationServices } from '../app/ApplicationServicesContext';
import type { Coordinate, PlaceKind, SavedCommuteRoute, TransitAccessPoint, TransitMode } from '../domain/models';
import { useCommuteOverview, usePlace } from '../features/commute/useCommuteWorkflow';
import { BackButton } from '../shared/components/BackButton';
import { Icon } from '../shared/components/Icon';
import { KakaoTransitMap } from '../features/commute/KakaoTransitMap';
import './commute-page.css';

type Filter = 'all' | 'subway' | 'bus';

type TransitResult = {
  id: string;
  providerId: string;
  mode: TransitMode;
  name: string;
  displayCode?: string;
  line?: string;
  walkMinutes?: number;
  distanceM?: number;
  coordinate?: Coordinate;
  routeCount?: number;
};

function resolveKind(value?: string): PlaceKind {
  return value === 'destination' ? 'destination' : 'origin';
}

function routeAccessIds(
  route: SavedCommuteRoute | undefined,
  role: string | null,
): string[] {
  if (!route) return [];
  if (role === 'origin') {
    return route.originAccessPointIds ??
      (route.originAccessPointId ? [route.originAccessPointId] : []);
  }
  if (role === 'destination') {
    return route.destinationAccessPointIds ??
      (route.destinationAccessPointId ? [route.destinationAccessPointId] : []);
  }
  return [];
}

function sameProvider(point: TransitAccessPoint, result: TransitResult): boolean {
  return point.providerId === result.providerId && point.mode === result.mode;
}

export function TransitAccessPage() {
  const { personId = '', placeKind } = useParams();
  const kind = resolveKind(placeKind);
  const navigate = useNavigate();
  const services = useApplicationServices();
  const [params] = useSearchParams();
  const routeId = params.get('routeId');
  const routeRole = params.get('routeRole');
  const routeEdit = params.get('routeEdit');
  const routeIndex = Number(params.get('index') ?? '-1');
  const placeState = usePlace(personId, kind);
  const commuteState = useCommuteOverview(personId);
  const [filter, setFilter] = useState<Filter>('all');
  const [nearby, setNearby] = useState<TransitResult[]>([]);
  const [searchResults, setSearchResults] = useState<TransitResult[]>([]);
  const [query, setQuery] = useState('');
  const [nearbyLoading, setNearbyLoading] = useState(true);
  const [searchLoading, setSearchLoading] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [nearbyError, setNearbyError] = useState<string | null>(null);
  // Search center is an ephemeral browsing coordinate, never a saved address.
  const [mapCenter, setMapCenter] = useState<Coordinate | null>(null);
  const discoveryCenter = mapCenter ??
    (placeState.status === 'ready' ? placeState.place?.coordinate ?? null : null);
  const [activeMarkerId, setActiveMarkerId] = useState<string | null>(null);

  useEffect(() => {
    setMapCenter(null);
    setActiveMarkerId(null);
  }, [
    personId, kind,
    placeState.status === 'ready' ? placeState.place?.id : null,
    placeState.status === 'ready' ? placeState.place?.coordinate?.x : null,
    placeState.status === 'ready' ? placeState.place?.coordinate?.y : null,
  ]);

  useEffect(() => {
    let active = true;
    if (placeState.status !== 'ready' || !placeState.place?.coordinate || !discoveryCenter) {
      if (placeState.status !== 'loading') setNearbyLoading(false);
      return () => { active = false; };
    }

    setNearbyLoading(true);
    setNearbyError(null);
    services.actions.transitSearch.nearby(personId, kind, discoveryCenter)
      .then((items) => {
        if (!active) return;
        setNearby(items);
        setNearbyLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setNearby([]);
        setNearbyError('주변 교통 조회에 실패했습니다. 지도를 움직이거나 다시 시도해 주세요.');
        setNearbyLoading(false);
      });

    return () => { active = false; };
  }, [
    services,
    personId,
    kind,
    placeState.status,
    placeState.status === 'ready' ? placeState.place?.id : null,
    discoveryCenter?.x,
    discoveryCenter?.y,
  ]);

  useEffect(() => {
    let active = true;
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearchLoading(false);
      return () => { active = false; };
    }

    setSearchLoading(true);
    const timer = window.setTimeout(() => {
      services.actions.transitSearch.search(personId, kind, trimmed, discoveryCenter ?? undefined)
        .then((items) => {
          if (!active) return;
          setSearchResults(items);
          setSearchLoading(false);
        })
        .catch(() => {
          if (!active) return;
          setSearchResults([]);
          setSearchLoading(false);
        });
    }, 220);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [services, personId, kind, query, discoveryCenter?.x, discoveryCenter?.y]);

  const searching = query.trim().length > 0;
  const source = searching ? searchResults : nearby;
  const visible = useMemo(
    () => source
      // Second-layer local guard: stale cached API responses must never turn a
      // distant stop into a nearby candidate or zoom the map out by kilometers.
      .filter((point) => searching || (
        point.distanceM != null && Number.isFinite(point.distanceM) &&
        point.distanceM >= 0 &&
        point.distanceM <= (point.mode === 'BUS' ? 800 : 900)
      ))
      .filter((point) => filter === 'all' || point.mode.toLocaleLowerCase() === filter)
      .sort((left, right) =>
        (left.distanceM ?? Number.MAX_SAFE_INTEGER) -
        (right.distanceM ?? Number.MAX_SAFE_INTEGER)
      ),
    [source, filter, searching],
  );

  const mapPoints = useMemo(
    () => visible.flatMap((point) => point.coordinate ? [{
      id: point.id,
      name: point.name,
      mode: point.mode,
      coordinate: point.coordinate,
    }] : []),
    [visible],
  );

  const activePoint = visible.find((point) => point.id === activeMarkerId) ?? null;
  const activateMarker = (id: string) => {
    setActiveMarkerId(id);
    // Marker previews must never initiate D1 mutation; use the existing
    // list/add action explicitly after the marker and row are linked.
    const row = document.getElementById('transit-result-' + id);
    row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  const place = placeState.status === 'ready' ? placeState.place : null;
  const kindLabel = kind === 'origin' ? '출발지' : '도착지';
  const base = '/people/' + encodeURIComponent(personId) + '/commute/' + kind + '/access';
  const routeReturn = routeId
    ? '/people/' + encodeURIComponent(personId) + '/commute/routes/' + encodeURIComponent(routeId)
    : '/people/' + encodeURIComponent(personId) + '/commute';

  const overview = commuteState.status === 'ready' ? commuteState.overview : null;
  const route = routeId
    ? overview?.savedRoutes.find((candidate) => candidate.id === routeId)
    : undefined;
  const persistedPoints = kind === 'origin'
    ? overview?.originAccessPoints ?? []
    : overview?.destinationAccessPoints ?? [];
  const selectedRouteIds = new Set(routeAccessIds(route, routeRole));
  // The standalone picker tracks D1 access-point.selected. Route-edit pickers
  // instead track membership of the current saved-route access set.
  const selectedPoints = persistedPoints.filter((point) =>
    routeId && (routeRole === 'origin' || routeRole === 'destination')
      ? selectedRouteIds.has(point.id)
      : point.selected
  );

  const selectedResultIds = new Set(
    visible
      .filter((result) => selectedPoints.some((point) => sameProvider(point, result)))
      .map((result) => result.id),
  );

  const removeSelectedPoint = async (point: TransitAccessPoint) => {
    if (workingId) return;
    setWorkingId(point.id);
    setActionError(null);
    try {
      if (routeId && routeRole === 'origin') {
        await services.actions.commute.removeRouteOriginAccess(personId, routeId, point.id);
      } else if (routeId && routeRole === 'destination') {
        await services.actions.commute.removeRouteDestinationAccess(personId, routeId, point.id);
      } else {
        await services.actions.transitAccess.toggleAccess(point.id, false);
      }
      const readback = routeId && (routeRole === 'origin' || routeRole === 'destination')
        ? await services.queries.getCommuteOverview(personId)
        : null;
      if (readback) {
        const updated = readback.savedRoutes.find((item) => item.id === routeId);
        const ids = routeAccessIds(updated, routeRole);
        if (!updated || ids.includes(point.id)) throw new Error('교통편 해제를 저장하지 못했습니다.');
      } else {
        const saved = await services.queries.getTransitAccess(personId, kind, 'all');
        if (saved.find((item) => item.id === point.id)?.selected !== false) {
          throw new Error('교통편 해제를 저장하지 못했습니다.');
        }
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '교통편 해제에 실패했습니다.');
    } finally {
      setWorkingId(null);
    }
  };

  const attachSingleVia = async (accessPointId: string) => {
    if (!routeId || routeRole !== 'via') return;
    if (routeEdit === 'replace') {
      await services.actions.commute.replaceRouteVia(
        personId,
        routeId,
        Math.max(0, routeIndex),
        accessPointId,
      );
    } else {
      await services.actions.commute.addRouteVia(
        personId,
        routeId,
        accessPointId,
        routeIndex >= 0 ? routeIndex : undefined,
      );
    }
  };

  const toggleResult = async (result: TransitResult) => {
    if (workingId) return;
    setWorkingId(result.id);
    setActionError(null);
    try {
      const existing = persistedPoints.find((point) => sameProvider(point, result));

      if (routeId && routeRole === 'origin') {
        if (existing && selectedRouteIds.has(existing.id)) {
          await services.actions.commute.removeRouteOriginAccess(personId, routeId, existing.id);
        } else {
          const point = existing ??
            await services.actions.transitSearch.addAccessPoint(personId, kind, result.id);
          await services.actions.commute.addRouteOriginAccess(personId, routeId, point.id);
        }
        const confirmed = await services.queries.getCommuteOverview(personId);
        const updated = confirmed.savedRoutes.find((item) => item.id === routeId);
        const resultPoint = confirmed.originAccessPoints.find((item) => sameProvider(item, result));
        const wasSelected = Boolean(existing && selectedRouteIds.has(existing.id));
        const isSelected = Boolean(resultPoint && (
          updated?.originAccessPointIds ?? (updated?.originAccessPointId ? [updated.originAccessPointId] : [])
        ).includes(resultPoint.id));
        if (!updated || isSelected === wasSelected) {
          throw new Error('출발 교통편 저장을 다시 확인하지 못했습니다.');
        }
        return;
      }

      if (routeId && routeRole === 'destination') {
        if (existing && selectedRouteIds.has(existing.id)) {
          await services.actions.commute.removeRouteDestinationAccess(personId, routeId, existing.id);
        } else {
          const point = existing ??
            await services.actions.transitSearch.addAccessPoint(personId, kind, result.id);
          await services.actions.commute.addRouteDestinationAccess(personId, routeId, point.id);
        }
        const confirmed = await services.queries.getCommuteOverview(personId);
        const updated = confirmed.savedRoutes.find((item) => item.id === routeId);
        const resultPoint = confirmed.destinationAccessPoints.find((item) => sameProvider(item, result));
        const wasSelected = Boolean(existing && selectedRouteIds.has(existing.id));
        const isSelected = Boolean(resultPoint && (
          updated?.destinationAccessPointIds ?? (updated?.destinationAccessPointId ? [updated.destinationAccessPointId] : [])
        ).includes(resultPoint.id));
        if (!updated || isSelected === wasSelected) {
          throw new Error('도착 교통편 저장을 다시 확인하지 못했습니다.');
        }
        return;
      }

      const point = existing ??
        await services.actions.transitSearch.addAccessPoint(personId, kind, result.id);

      if (routeId && routeRole === 'via') {
        await attachSingleVia(point.id);
        if (point.mode === 'BUS') {
          const busParams = new URLSearchParams();
          busParams.set('routeId', routeId);
          busParams.set('routeRole', routeRole);
          if (routeEdit) busParams.set('routeEdit', routeEdit);
          if (routeIndex >= 0) busParams.set('index', String(routeIndex));
          navigate(
            base + '/' + encodeURIComponent(point.id) + '/bus-routes?' + busParams.toString(),
          );
          return;
        }
        navigate(routeReturn, { replace: true });
        return;
      }

      const expectedSelected = existing ? !point.selected : true;
      if (existing) {
        await services.actions.transitAccess.toggleAccess(point.id, expectedSelected);
      }
      // Accept only the exact D1-backed selected flag; a row's existence
      // alone does not prove that + / deselect actually took effect.
      const persisted = await services.queries.getTransitAccess(personId, kind, 'all');
      if (!persisted.some((candidate) =>
        candidate.id === point.id && candidate.selected === expectedSelected
      )) {
        throw new Error('교통편 선택 상태가 저장 후 일치하지 않습니다.');
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '교통편 저장에 실패했습니다.');
    } finally {
      setWorkingId(null);
    }
  };

  if (placeState.status === 'loading') {
    return <section className="commute-page"><div className="commute-message">{kindLabel} 정보를 불러오는 중</div></section>;
  }
  if (placeState.status === 'error') {
    return <section className="commute-page"><div className="commute-message">{kindLabel} 정보를 불러오지 못했습니다.</div></section>;
  }
  if (!place?.coordinate) {
    return (
      <section className="commute-page" data-page="TransitAccessPicker" data-state="PLACE_REQUIRED">
        <BackButton fallbackTo={routeReturn} />
        <h1 className="page-title">{kindLabel} 교통수단</h1>
        <div className="commute-message">{kindLabel} 주소와 위치를 먼저 저장해야 주변 정류장을 찾을 수 있습니다.</div>
        <button type="button" className="cta" onClick={() => navigate('/people/' + encodeURIComponent(personId) + '/place/' + kind)}>
          {kindLabel} 설정
        </button>
      </section>
    );
  }

  const loading = searching ? searchLoading : nearbyLoading;
  const selectedCount = selectedPoints.length;

  return (
    <section className="commute-page" data-route={base} data-page="TransitAccessPicker" data-state={loading ? 'LOADING' : visible.length ? 'CANDIDATE_SELECTING' : 'NO_RESULT'}>
      <BackButton fallbackTo={routeReturn} />
      <h1 className="page-title">{kindLabel} 근처 교통</h1>
      <div className="transit-context">
        처음에는 {place.label || kindLabel} 주변을 보여줍니다. 지도를 움직이면 지도 중심 주변 교통편을 다시 찾습니다.
      </div>

      <KakaoTransitMap
        center={place.coordinate}
        centerLabel={place.label || kindLabel}
        points={mapPoints}
        selectedIds={[...selectedResultIds]}
        selectedId={activePoint?.id}
        onCenterChange={(center) => {
          setMapCenter(center);
          setActiveMarkerId(null);
        }}
        // A marker focuses the active preview. D1 selection is a separate
        // explicit action, shared with the list, not an accidental map tap.
        onSelect={activateMarker}
      />
      <div className="transit-search-center" role="status">
        {nearbyLoading ? '지도 중심 주변 교통을 검색 중' :
          mapCenter ? '이동한 지도 중심 기준 · 가까운 교통편' : '저장된 위치 기준 · 가까운 교통편'}
      </div>
      {activePoint ? (
        <div className="transit-map-active" role="region" aria-label="지도에서 선택한 교통편" data-active-id={activePoint.id}>
          <div className="transit-map-active-details">
            <span className="transit-active-type">{activePoint.mode === 'BUS' ? '버스 정류장' : '지하철역'}</span>
            <strong className="transit-active-name">{activePoint.name}</strong>
            <small className="transit-active-meta">
              {[
                activePoint.displayCode ? '정류소 ' + activePoint.displayCode : null,
                activePoint.distanceM != null ? activePoint.distanceM.toLocaleString() + 'm' : null,
                activePoint.walkMinutes != null ? '도보 약 ' + activePoint.walkMinutes + '분' : null,
              ].filter(Boolean).join(' · ')}
            </small>
          </div>
          <button
            type="button"
            className="transit-active-action"
            aria-pressed={selectedResultIds.has(activePoint.id)}
            disabled={workingId != null}
            onClick={() => void toggleResult(activePoint)}
          >
            {workingId === activePoint.id ? '처리 중' :
              selectedResultIds.has(activePoint.id) ? '선택 해제' : '선택'}
          </button>
        </div>
      ) : null}

      <div className="candidate-filter">
        {([['all','전체'],['bus','버스'],['subway','지하철']] as const).map(([value,label]) => (
          <button key={value} type="button" className={'filter-btn' + (filter === value ? ' active' : '')} onClick={() => setFilter(value)}>{label}</button>
        ))}
      </div>

      <label className="transit-inline-search">
        <Icon name="search" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="정류장명·번호 또는 역 이름 검색"
          autoComplete="off"
          enterKeyHint="search"
        />
        {query ? (
          <button type="button" aria-label="검색어 지우기" onClick={() => setQuery('')}>×</button>
        ) : null}
      </label>

      {routeId && (routeRole === 'origin' || routeRole === 'destination') ? (
        <div className="transit-multi-hint">
          여러 곳을 선택할 수 있습니다. 현재 {selectedCount}개 선택됨
        </div>
      ) : null}

      {selectedPoints.length > 0 ? (
        <div className="transit-selected-summary" aria-label="저장된 교통편 목록">
          <strong>선택한 교통편 {selectedPoints.length}개</strong>
          {selectedPoints.map((point) => (
            <button
              key={point.id}
              type="button"
              className="transit-selected-chip"
              disabled={workingId != null}
              onClick={() => void removeSelectedPoint(point)}
              aria-label={point.name + ' 선택 해제'}
            ><span>{point.name}{point.displayCode ? ' · ' + point.displayCode : point.line ? ' · ' + point.line : ''}</span> ×</button>
          ))}
        </div>
      ) : null}
      {actionError ? <div className="search-inline-status" role="alert">{actionError}</div> : null}
      {!searching && nearbyError ? <div className="search-inline-status" role="alert">{nearbyError}</div> : null}
      <div className="transit-list">
        {loading ? (
          <div className="transit-empty">
            {searching ? '검색 중' : '주변 정류장과 역을 찾는 중'}
          </div>
        ) : visible.map((point) => {
          const selected = selectedResultIds.has(point.id);
          return (
            <button
              type="button"
              id={'transit-result-' + point.id}
              className={'transit-row transit-row-action' + (selected ? ' selected' : '') + (activeMarkerId === point.id ? ' map-active' : '')}
              key={point.id}
              aria-current={activeMarkerId === point.id ? 'true' : undefined}
              disabled={workingId === point.id}
              onClick={() => {
                activateMarker(point.id);
              }}
            >
              <Icon name={point.mode === 'BUS' ? 'bus' : 'train'} />
              <span className="transit-copy">
                <b>{point.name}{point.line ? ' · ' + point.line : ''}</b>
                <span className="row-sub">
                  {[
                    point.displayCode ? '정류소 ' + point.displayCode : null,
                    point.distanceM != null ? point.distanceM.toLocaleString() + 'm' : null,
                    point.walkMinutes != null ? '도보 약 ' + point.walkMinutes + '분' : null,
                  ].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="transit-trailing">
                {selected ? <Icon name="check" /> : <Icon name="chevron-right" />}
              </span>
            </button>
          );
        })}
        {!loading && !visible.length ? (
          <div className="transit-empty">
            {searching ? '검색 결과가 없습니다.' : '이 위치에서 가까운 교통을 찾지 못했습니다.'}
          </div>
        ) : null}
      </div>
    </section>
  );
}
