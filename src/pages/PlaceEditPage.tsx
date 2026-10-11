import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useApplicationServices } from '../app/ApplicationServicesContext';
import type { Coordinate, PlaceKind } from '../domain/models';
import { usePlace } from '../features/commute/useCommuteWorkflow';
import { KakaoPlaceMap, type KakaoPlaceMapPoint } from '../features/commute/KakaoPlaceMap';
import { BackButton } from '../shared/components/BackButton';
import { Icon } from '../shared/components/Icon';
import { useFormRuntimeState } from '../shared/runtime/useFormRuntimeState';
import { formErrorMessage } from '../shared/runtime/formErrorMessage';
import { useOnlineStatus } from '../shared/runtime/useOnlineStatus';
import './commute-page.css';

type SearchResult = {
  providerId: string;
  placeName?: string;
  roadAddress: string;
  lotAddress?: string;
  coordinate: Coordinate;
  category?: string;
};

function PlaceEditContent({ kind }: { kind: PlaceKind }) {
  const { personId = '' } = useParams();
  const navigate = useNavigate();
  const services = useApplicationServices();
  const placeState = usePlace(personId, kind);
  const composing = useRef(false);
  const [label, setLabel] = useState('');
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [searchStatus, setSearchStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [searchNonce, setSearchNonce] = useState(0);
  const form = useFormRuntimeState();
  const online = useOnlineStatus();

  useEffect(() => {
    if (placeState.status !== 'ready') return;
    setLabel(placeState.place?.label ?? '');
    setQuery(placeState.place?.address.road ?? '');
    setDetail(placeState.place?.address.detail ?? '');
    setResults([]);
    setSearchStatus('idle');
    setSelected(null);
    if (placeState.place?.providerPlaceId && placeState.place.coordinate) {
      setSelected({
        providerId: placeState.place.providerPlaceId,
        roadAddress: placeState.place.address.road,
        lotAddress: placeState.place.address.lot,
        coordinate: placeState.place.coordinate,
        placeName: placeState.place.label,
      });
    }
  }, [placeState.status, placeState.status === 'ready' ? placeState.place?.id : null, personId, kind]);

  useEffect(() => {
    if (!online || composing.current || selected || query.trim().length < 2) {
      if (query.trim().length < 2) setSearchStatus('idle');
      return;
    }
    let active = true;
    setSearchStatus('loading');
    const timer = window.setTimeout(() => {
      services.actions.places.search(query)
        .then(items => {
          if (!active) return;
          setResults(items.filter(item =>
            Number.isFinite(item.coordinate?.x) && Number.isFinite(item.coordinate?.y)));
          setSearchStatus('ready');
        })
        .catch(() => {
          if (!active) return;
          setResults([]);
          setSearchStatus('error');
        });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [services, query, selected, online, searchNonce]);

  if (placeState.status === 'loading') return <section className="commute-page"><div className="commute-message">장소 정보를 불러오는 중</div></section>;
  if (placeState.status === 'error') return <section className="commute-page"><div className="commute-message">장소 정보를 불러오지 못했습니다.</div></section>;

  const current = placeState.place;
  const resolvedCurrentLocation =
    current?.coordinate != null && current.address.road === query.trim();
  const hasResolvedLocation = selected != null || resolvedCurrentLocation;
  const mapPoints: KakaoPlaceMapPoint[] = selected
    ? [{ id: selected.providerId, label: selected.placeName || selected.roadAddress, coordinate: selected.coordinate }]
    : results.length
      ? results.map(item => ({
          id: item.providerId, label: item.placeName || item.roadAddress, coordinate: item.coordinate,
        }))
      : resolvedCurrentLocation && current?.coordinate
        ? [{ id: current.providerPlaceId || current.id, label: current.label, coordinate: current.coordinate }]
        : [];
  const mapCenter = selected?.coordinate ?? results[0]?.coordinate ??
    (resolvedCurrentLocation ? current?.coordinate : undefined);
  const isOrigin = kind === 'origin';
  const title = isOrigin ? '출발지 수정' : '도착지 수정';

  const selectResult = (result: SearchResult) => {
    setSelected(result);
    setQuery(result.roadAddress);
    setResults([]);
    setSearchStatus('idle');
  };

  const save = async () => {
    if (form.state === 'SAVING' || !hasResolvedLocation) return;
    try {
      await form.save(() => services.actions.places.save(personId, kind, {
        label,
        address: {
          road: query.trim(),
          lot: selected?.lotAddress ?? current?.address.lot,
          detail: detail.trim(),
        },
        coordinate: selected?.coordinate ?? current?.coordinate,
        providerPlaceId: selected?.providerId ?? current?.providerPlaceId,
      }));
      navigate('/people/' + encodeURIComponent(personId), { replace: true });
    } catch {
      // Keep the exact selected result and address for explicit retry.
    }
  };

  return (
    <section className="commute-page" data-page="PlaceEditPage" data-state={'EDITING_' + kind.toUpperCase() + ' ' + form.state + (online ? '' : ' OFFLINE')}>
      <BackButton fallbackTo={'/people/' + encodeURIComponent(personId)} />
      <h1 className="page-title">{title}</h1>

      <label className="form-field">
        <span className="form-label">장소 이름</span>
        <input className="input" value={label} onChange={(event) => { setLabel(event.target.value); form.markDirty(); }} />
      </label>

      <div className="form-field address-search-field">
        <span className="form-label">주소 또는 장소</span>
        <div className="address-search-control">
          <Icon name="search" />
          <input
            aria-label="주소 또는 장소 검색"
            value={query}
            placeholder="도로명·지번·건물·매장·장소 검색"
            autoComplete="off"
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={(event) => {
              composing.current = false;
              setSelected(null);
              setResults([]);
              setSearchStatus('loading');
              setQuery(event.currentTarget.value);
              setSearchNonce(current => current + 1);
              form.markDirty();
            }}
            onChange={(event) => {
              setSelected(null);
              setResults([]);
              setSearchStatus('loading');
              setQuery(event.target.value);
              form.markDirty();
            }}
          />
        </div>

        {searchStatus === 'loading' && online && !selected && query.trim().length >= 2
          ? <div className="search-inline-status" role="status">장소 검색 중</div> : null}
        {searchStatus === 'error' && online && !selected
          ? <div className="search-inline-status" role="alert">장소 검색에 실패했습니다. 연결 또는 API 설정을 확인하세요.
              <button type="button" className="text-btn" onClick={() => setSearchNonce(value => value + 1)}>검색 다시 시도</button>
            </div> : null}
        {searchStatus === 'ready' && !results.length && !selected
          ? <div className="search-inline-status" role="status">일치하는 주소·장소가 없습니다.</div> : null}
        {mapCenter ? (
          <KakaoPlaceMap
            center={mapCenter}
            points={mapPoints}
            selectedId={selected?.providerId ?? (resolvedCurrentLocation ? current?.providerPlaceId ?? current?.id ?? null : null)}
            onSelect={id => {
              const point = results.find(item => item.providerId === id);
              if (point) { selectResult(point); form.markDirty(); }
            }}
          />
        ) : null}
        {results.length ? (
          <div className="search-results" data-state="PLACE_RESULTS">
            {results.map((result) => (
              <button key={result.providerId} type="button" className="search-result-row" onClick={() => { selectResult(result); form.markDirty(); }}>
                <span className="search-result-main">
                  <b>{result.placeName || result.roadAddress}</b>
                  {result.placeName ? <span className="search-result-sub">{result.roadAddress}</span> : null}
                  {[result.category, result.lotAddress].filter(Boolean).length ? <span className="search-result-meta">{[result.category, result.lotAddress].filter(Boolean).join(' · ')}</span> : null}
                </span>
                <span className="search-result-trailing"><Icon name="chevron-right" /></span>
              </button>
            ))}
          </div>
        ) : null}
        {!online ? <div className="search-inline-status" data-state="OFFLINE">오프라인에서는 주소 검색을 사용할 수 없습니다.</div> : null}

        {(selected || current?.address.road === query) && query ? (
          <div className="address-selected-summary">
            <span><b>{query}</b>{(selected?.lotAddress ?? current?.address.lot) ? <span>{selected?.lotAddress ?? current?.address.lot}</span> : null}</span>
            <Icon name="check" />
          </div>
        ) : null}
      </div>

      <label className="form-field">
        <span className="form-label">상세주소</span>
        <input className="input" value={detail} onChange={(event) => { setDetail(event.target.value); form.markDirty(); }} placeholder="층, 호수 등 (선택)" />
      </label>

      {!hasResolvedLocation && query.trim().length >= 2 ? (
        <div className="search-inline-status" role="status">검색 결과에서 정확한 주소를 선택해야 저장할 수 있습니다.</div>
      ) : null}
      {form.error ? <p className="form-error" role="alert">{formErrorMessage(form.error)}</p> : null}
      <button type="button" className="cta" disabled={form.state === 'SAVING' || !hasResolvedLocation} onClick={save}>{form.state === 'SAVING' ? '저장 중' : form.state === 'SAVED' ? '저장됨' : '저장'}</button>
    </section>
  );
}

export function OriginPlaceEditPage() {
  return <PlaceEditContent kind="origin" />;
}

export function DestinationPlaceEditPage() {
  return <PlaceEditContent kind="destination" />;
}
