import { useEffect, useRef, useState } from 'react';
import type { Coordinate } from '../../domain/models';
import { loadKakaoClientKey, loadKakaoMapsSdk, resetKakaoMapsClientKeyCache } from './KakaoTransitMap';

export interface KakaoPlaceMapPoint {
  id: string;
  label: string;
  coordinate: Coordinate;
}

interface Props {
  center: Coordinate;
  points: KakaoPlaceMapPoint[];
  selectedId: string | null;
  onSelect(id: string): void;
}

/** An independent place map using the SAME existing Kakao SDK/key as transit. */
export function KakaoPlaceMap({ center, points, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<Map<string, any>>(new Map());
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let active = true;
    setState('loading');
    loadKakaoClientKey()
      .then(key => {
        if (!key) throw new Error('Kakao Maps JavaScript key is unavailable.');
        return loadKakaoMapsSdk(key);
      })
      .then(kakao => {
        if (!active || !containerRef.current) return;
        mapRef.current = new kakao.maps.Map(containerRef.current, {
          center: new kakao.maps.LatLng(center.y, center.x),
          level: 4,
        });
        setState('ready');
      })
      .catch(() => { if (active) setState('error'); });

    return () => {
      active = false;
      for (const marker of overlaysRef.current.values()) marker.setMap(null);
      overlaysRef.current.clear();
      mapRef.current = null;
      containerRef.current?.replaceChildren();
    };
    // SDK map is created only on mount/retry; center and points update below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryNonce]);

  useEffect(() => {
    if (state !== 'ready' || !mapRef.current || !window.kakao?.maps) return;
    mapRef.current.setCenter(new window.kakao.maps.LatLng(center.y, center.x));
  }, [state, center.x, center.y]);

  useEffect(() => {
    if (state !== 'ready' || !mapRef.current || !window.kakao?.maps) return;
    const kakao = window.kakao;
    for (const marker of overlaysRef.current.values()) marker.setMap(null);
    overlaysRef.current.clear();
    for (const point of points) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cbh-place-map-pin';
      button.dataset.placeId = point.id;
      button.title = point.label;
      button.setAttribute('aria-label', '장소 선택: ' + point.label);
      button.setAttribute('aria-pressed', String(point.id === selectedId));
      button.textContent = '위치';
      button.addEventListener('pointerdown', event => event.stopPropagation());
      button.addEventListener('touchstart', event => event.stopPropagation(), { passive: true });
      button.addEventListener('click', event => {
        event.stopPropagation();
        onSelectRef.current(point.id);
      });
      const overlay = new kakao.maps.CustomOverlay({
        map: mapRef.current,
        position: new kakao.maps.LatLng(point.coordinate.y, point.coordinate.x),
        content: button,
        clickable: true,
        xAnchor: 0.5,
        yAnchor: 1,
        zIndex: point.id === selectedId ? 12 : 2,
      });
      overlaysRef.current.set(point.id, overlay);
    }
    return () => {
      for (const overlay of overlaysRef.current.values()) overlay.setMap(null);
      overlaysRef.current.clear();
    };
  }, [points, state]);

  useEffect(() => {
    for (const [id, overlay] of overlaysRef.current) {
      overlay.setZIndex(id === selectedId ? 12 : 2);
      const button = overlay.getContent?.();
      if (button instanceof HTMLElement) {
        button.classList.toggle('is-active', id === selectedId);
        button.setAttribute('aria-pressed', String(id === selectedId));
      }
    }
  }, [selectedId, points, state]);

  return (
    <section className="kakao-place-map-shell" data-map-state={state} aria-label="카카오 지도 장소 위치">
      <div className="kakao-place-map" ref={containerRef} hidden={state === 'error'} />
      {state === 'loading' ? <p className="kakao-map-status">장소 지도를 불러오는 중</p> : null}
      {state === 'error' ? (
        <div className="kakao-map-error" role="status">
          <b>대화형 지도를 불러오지 못했습니다.</b>
          <span>아래 주소·장소 검색 결과에서는 계속 선택할 수 있습니다.</span>
          <button type="button" onClick={() => { resetKakaoMapsClientKeyCache(); setRetryNonce(n => n + 1); }}>다시 시도</button>
        </div>
      ) : null}
    </section>
  );
}
