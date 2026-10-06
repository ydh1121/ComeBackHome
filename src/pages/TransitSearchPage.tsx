import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useApplicationServices } from '../app/ApplicationServicesContext';
import type { PlaceKind, TransitMode } from '../domain/models';
import { BackButton } from '../shared/components/BackButton';
import { Icon } from '../shared/components/Icon';
import { useOnlineStatus } from '../shared/runtime/useOnlineStatus';
import './commute-page.css';

type SearchResult = {
  id: string;
  providerId: string;
  mode: TransitMode;
  name: string;
  displayCode?: string;
  line?: string;
  walkMinutes?: number;
  distanceM?: number;
  routeCount?: number;
};

function resolveKind(value?: string): PlaceKind {
  return value === 'destination' ? 'destination' : 'origin';
}

function resultMeta(result: SearchResult): string {
  if (result.mode === 'BUS') {
    return [
      result.displayCode ? '정류소 ' + result.displayCode : null,
      result.walkMinutes != null ? '도보 ' + result.walkMinutes + '분' : null,
      result.routeCount != null ? '버스 ' + result.routeCount + '개' : null,
    ].filter(Boolean).join(' · ');
  }
  return [result.line, result.walkMinutes != null ? '도보 ' + result.walkMinutes + '분' : null].filter(Boolean).join(' · ');
}

export function TransitSearchPage() {
  const { personId = '', placeKind } = useParams();
  const kind = resolveKind(placeKind);
  const navigate = useNavigate();
  const services = useApplicationServices();
  const [params] = useSearchParams();
  const routeEdit = params.get('routeEdit');
  const routeId = params.get('routeId');
  const routeRole = params.get('routeRole');
  const routeIndex = Number(params.get('index') ?? '-1');
  const composing = useRef(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const online = useOnlineStatus();

  useEffect(() => {
    if (!online || composing.current || !query.trim()) {
      if (!query.trim()) setResults([]);
      return;
    }
    let active = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      services.actions.transitSearch.search(personId, kind, query)
        .then((items) => {
          if (!active) return;
          setResults(items);
          setSearching(false);
        })
        .catch(() => {
          if (!active) return;
          setResults([]);
          setSearching(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [services, personId, kind, query, online]);

  const savedRouteMode = Boolean(routeId && (routeRole === 'origin' || routeRole === 'via'));
  const legacyRouteMode = routeEdit === 'insert' || routeEdit === 'replace';
  const routeMode = savedRouteMode || legacyRouteMode;
  const placeLabel = kind === 'origin' ? '출발지' : '도착지';
  const context = savedRouteMode
    ? routeRole === 'origin'
      ? '출발 교통수단 직접 검색'
      : routeEdit === 'replace'
        ? '선택한 경유 교통수단 교체'
        : '경유 교통수단 직접 검색'
    : routeEdit === 'insert'
      ? '내 경로 ' + (Math.max(0, routeIndex) + 1) + '번째 위치에 추가'
      : routeEdit === 'replace'
        ? '선택한 구간 교체'
        : placeLabel + ' 주변 교통에 추가';

  const commit = async () => {
    if (!selectedId) return;
    const point = await services.actions.transitSearch.addAccessPoint(personId, kind, selectedId);

    if (routeId && routeRole === 'origin') {
      await services.actions.commute.setRouteOriginAccess(personId, routeId, point.id);
    } else if (routeId && routeRole === 'via') {
      if (routeEdit === 'replace') {
        await services.actions.commute.replaceRouteVia(personId, routeId, Math.max(0, routeIndex), point.id);
      } else {
        await services.actions.commute.addRouteVia(personId, routeId, point.id, routeIndex >= 0 ? routeIndex : undefined);
      }
    } else {
      if (routeEdit === 'insert') await services.actions.commute.addPreferenceStep(personId, point.id, Math.max(0, routeIndex));
      if (routeEdit === 'replace') await services.actions.commute.replacePreferenceStep(personId, Math.max(0, routeIndex), point.id);
    }

    if (routeId) {
      navigate('/people/' + encodeURIComponent(personId) + '/commute/routes/' + encodeURIComponent(routeId), { replace: true });
    } else if (routeMode) {
      navigate('/people/' + encodeURIComponent(personId) + '/commute/manual', { replace: true });
    } else {
      navigate('/people/' + encodeURIComponent(personId) + '/commute/' + kind + '/access', { replace: true });
    }
  };

  return (
    <section className="commute-page" data-page="TransitSearchPage" data-state={!online ? 'OFFLINE' : query.trim() ? 'SEARCH_RESULT' : 'SEARCH_IDLE'}>
      <BackButton fallbackTo={routeId ? '/people/' + encodeURIComponent(personId) + '/commute/routes/' + encodeURIComponent(routeId) : routeMode ? '/people/' + encodeURIComponent(personId) + '/commute/manual' : '/people/' + encodeURIComponent(personId) + '/commute/' + kind + '/access'} />
      <h1 className="page-title">{savedRouteMode ? '정류장·역 직접 검색' : '교통 추가'}</h1>
      <div className="transit-context">{context}</div>

      <div className="form-field">
        <div className={'address-search-control' + (query ? ' has-clear' : '')}>
          <Icon name="search" />
          <input
            aria-label="교통 검색"
            value={query}
            placeholder="정류장명·번호 또는 역 이름"
            autoComplete="off"
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={(event) => {
              composing.current = false;
              setQuery(event.currentTarget.value);
              setSelectedId(null);
            }}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedId(null);
            }}
          />
          {query ? <button type="button" className="search-clear" aria-label="검색어 지우기" onClick={() => { setQuery(''); setSelectedId(null); }}>×</button> : null}
        </div>
      </div>

      {!online ? <div className="search-inline-status" data-state="OFFLINE">오프라인에서는 교통 검색을 사용할 수 없습니다.</div> : query.trim() ? (
        <div className="transit-search-results">
          {searching ? <div className="search-inline-status">검색 중</div> : results.length ? results.map((result) => (
            <button
              type="button"
              className={'transit-search-row' + (selectedId === result.id ? ' selected' : '')}
              key={result.id}
              onClick={() => setSelectedId(result.id)}
            >
              <span className="transit-result-icon"><Icon name={result.mode === 'BUS' ? 'bus' : 'train'} /></span>
              <span className="transit-result-copy"><b>{result.name}</b><span>{resultMeta(result)}</span></span>
              <span className="transit-result-trailing">{selectedId === result.id ? <Icon name="check" /> : <Icon name="chevron-right" />}</span>
            </button>
          )) : <div className="search-inline-status">검색 결과가 없습니다.</div>}
        </div>
      ) : <div className="search-inline-status">지도에서 찾기 어려운 경우 정류장명·번호 또는 역 이름을 검색하세요.</div>}

      {online && selectedId ? <div className="transit-search-actions"><button type="button" className="cta" onClick={commit}>{routeMode ? '이 구간 사용' : '교통 추가'}</button></div> : null}
    </section>
  );
}
