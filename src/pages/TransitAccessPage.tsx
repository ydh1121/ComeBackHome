import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useApplicationServices } from '../app/ApplicationServicesContext';
import type { Coordinate, PlaceKind, TransitMode } from '../domain/models';
import { usePlace } from '../features/commute/useCommuteWorkflow';
import { BackButton } from '../shared/components/BackButton';
import { Icon } from '../shared/components/Icon';
import { KakaoTransitMap } from '../features/commute/KakaoTransitMap';
import './commute-page.css';

type Filter = 'all' | 'subway' | 'bus';

type NearbyTransit = {
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

function querySuffix(params: URLSearchParams): string {
  const next = new URLSearchParams();
  for (const name of ['routeId', 'routeRole', 'routeEdit', 'index']) {
    const value = params.get(name);
    if (value) next.set(name, value);
  }
  const encoded = next.toString();
  return encoded ? '?' + encoded : '';
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
  const [filter, setFilter] = useState<Filter>('all');
  const [nearby, setNearby] = useState<NearbyTransit[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);

  useEffect(() => {
    let active = true;
    if (placeState.status !== 'ready' || !placeState.place?.coordinate) {
      if (placeState.status !== 'loading') setLoading(false);
      return () => { active = false; };
    }

    setLoading(true);
    services.actions.transitSearch.nearby(personId, kind)
      .then((items) => {
        if (!active) return;
        setNearby(items);
        setSelectedId((current) => current && items.some((item) => item.id === current) ? current : null);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setNearby([]);
        setLoading(false);
      });

    return () => { active = false; };
  }, [
    services,
    personId,
    kind,
    placeState.status,
    placeState.status === 'ready' ? placeState.place?.id : null,
  ]);

  const visible = useMemo(
    () => nearby.filter((point) => filter === 'all' || point.mode.toLocaleLowerCase() === filter),
    [nearby, filter],
  );
  const selected = nearby.find((point) => point.id === selectedId) ?? null;
  const place = placeState.status === 'ready' ? placeState.place : null;
  const kindLabel = kind === 'origin' ? '출발지' : '도착지';
  const base = '/people/' + encodeURIComponent(personId) + '/commute/' + kind + '/access';
  const suffix = querySuffix(params);
  const routeReturn = routeId
    ? '/people/' + encodeURIComponent(personId) + '/commute/routes/' + encodeURIComponent(routeId)
    : '/people/' + encodeURIComponent(personId) + '/commute';

  const attachToRoute = async (accessPointId: string) => {
    if (!routeId) return;
    if (routeRole === 'origin') {
      await services.actions.commute.setRouteOriginAccess(personId, routeId, accessPointId);
      return;
    }
    if (routeRole === 'destination') {
      await services.actions.commute.setRouteDestinationAccess(personId, routeId, accessPointId);
      return;
    }
    if (routeRole === 'via') {
      if (routeEdit === 'replace') {
        await services.actions.commute.replaceRouteVia(personId, routeId, Math.max(0, routeIndex), accessPointId);
      } else {
        await services.actions.commute.addRouteVia(
          personId,
          routeId,
          accessPointId,
          routeIndex >= 0 ? routeIndex : undefined,
        );
      }
    }
  };

  const commitSelected = async () => {
    if (!selected || committing) return;
    setCommitting(true);
    try {
      const point = await services.actions.transitSearch.addAccessPoint(personId, kind, selected.id);
      await attachToRoute(point.id);

      if (point.mode === 'BUS') {
        const busParams = new URLSearchParams();
        if (routeId) busParams.set('routeId', routeId);
        if (routeRole) busParams.set('routeRole', routeRole);
        if (routeEdit) busParams.set('routeEdit', routeEdit);
        if (routeIndex >= 0) busParams.set('index', String(routeIndex));
        const tail = busParams.toString() ? '?' + busParams.toString() : '';
        navigate(base + '/' + encodeURIComponent(point.id) + '/bus-routes' + tail);
        return;
      }

      navigate(routeId ? routeReturn : base, { replace: true });
    } finally {
      setCommitting(false);
    }
  };

  if (placeState.status === 'loading') {
    return <section className="commute-page"><div className="commute-message">출발지 정보를 불러오는 중</div></section>;
  }

  if (placeState.status === 'error') {
    return <section className="commute-page"><div className="commute-message">출발지 정보를 불러오지 못했습니다.</div></section>;
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

  return (
    <section className="commute-page" data-route={base} data-page="TransitAccessPicker" data-state={loading ? 'LOADING' : visible.length ? 'CANDIDATE_SELECTING' : 'NO_RESULT'}>
      <BackButton fallbackTo={routeReturn} />
      <h1 className="page-title">{kindLabel} 근처 교통</h1>
      <div className="transit-context">
        {place.label || kindLabel} 위치를 중심으로 가까운 정류장과 역을 표시합니다.
      </div>

      <KakaoTransitMap
        center={place.coordinate}
        centerLabel={place.label || kindLabel}
        points={visible.flatMap((point) => point.coordinate ? [{
          id: point.id,
          name: point.name,
          mode: point.mode,
          coordinate: point.coordinate,
        }] : [])}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />

      <div className="candidate-filter">
        {([['all','전체'],['bus','버스'],['subway','지하철']] as const).map(([value,label]) => (
          <button key={value} type="button" className={'filter-btn' + (filter === value ? ' active' : '')} onClick={() => setFilter(value)}>{label}</button>
        ))}
      </div>

      <div className="transit-list">
        {loading ? <div className="transit-empty">주변 정류장과 역을 찾는 중</div> : visible.map((point) => (
          <button
            type="button"
            className={'transit-row transit-row-action' + (point.id === selectedId ? ' selected' : '')}
            key={point.id}
            onClick={() => setSelectedId(point.id)}
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
            <span className="transit-trailing">{point.id === selectedId ? <Icon name="check" /> : <Icon name="chevron-right" />}</span>
          </button>
        ))}
        {!loading && !visible.length ? <div className="transit-empty">주변 교통을 찾지 못했습니다.</div> : null}
      </div>

      {selected ? (
        <button type="button" className="cta" disabled={committing} onClick={commitSelected}>
          {selected.mode === 'BUS' ? '이 정류장 선택 후 버스 보기' : '이 역 선택'}
        </button>
      ) : null}

      <button type="button" className="cta secondary add-action" onClick={() => navigate(base + '/search' + suffix)}>
        <Icon name="search" /> 정류장명·번호 직접 검색
      </button>
    </section>
  );
}
