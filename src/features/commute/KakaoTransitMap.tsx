import { useEffect, useRef, useState } from 'react';
import type { Coordinate, TransitMode } from '../../domain/models';

export interface KakaoTransitMapPoint {
  id: string;
  name: string;
  mode: TransitMode;
  coordinate: Coordinate;
}

interface KakaoTransitMapProps {
  center: Coordinate;
  centerLabel: string;
  points: KakaoTransitMapPoint[];
  selectedId?: string | null;
  selectedIds?: string[];
  onSelect(id: string): void;
  onCenterChange?(coordinate: Coordinate): void;
}

declare global {
  interface Window {
    kakao?: any;
  }
}

let sdkPromise: Promise<any> | null = null;
let sdkPromiseKey = '';
let clientConfigPromise: Promise<string | null> | null = null;

async function loadKakaoClientKey(): Promise<string | null> {
  if (!clientConfigPromise) {
    clientConfigPromise = (async () => {
      const buildKey = String(import.meta.env.VITE_CBH_KAKAO_JAVASCRIPT_KEY ?? '').trim();
      try {
        const response = await fetch('/api/client-config', {
          method: 'GET',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        if (response.ok) {
          const payload = await response.json() as {
            kakaoMaps?: { configured?: boolean; javaScriptKey?: string };
          };
          const runtimeKey = String(payload.kakaoMaps?.javaScriptKey ?? '').trim();
          if (payload.kakaoMaps?.configured && runtimeKey) return runtimeKey;
        }
      } catch {
        // The build-time value remains a compatibility fallback only.
      }
      return buildKey || null;
    })();
  }
  return clientConfigPromise;
}

function loadKakaoMapsSdk(appKey: string): Promise<any> {
  if (window.kakao?.maps) {
    return new Promise((resolve) => window.kakao.maps.load(() => resolve(window.kakao)));
  }
  if (sdkPromise && sdkPromiseKey === appKey) return sdkPromise;

  sdkPromiseKey = appKey;
  sdkPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-cbh-kakao-map="1"]');
    const complete = () => {
      if (!window.kakao?.maps) {
        reject(new Error('Kakao Maps SDK did not initialize.'));
        return;
      }
      window.kakao.maps.load(() => resolve(window.kakao));
    };

    if (existing) {
      if (window.kakao?.maps) complete();
      else {
        existing.addEventListener('load', complete, { once: true });
        existing.addEventListener('error', () => reject(new Error('Kakao Maps SDK failed to load.')), { once: true });
      }
      return;
    }

    const script = document.createElement('script');
    script.dataset.cbhKakaoMap = '1';
    script.async = true;
    script.src =
      'https://dapi.kakao.com/v2/maps/sdk.js?autoload=false&appkey=' +
      encodeURIComponent(appKey);
    script.addEventListener('load', complete, { once: true });
    script.addEventListener('error', () => reject(new Error('Kakao Maps SDK failed to load.')), { once: true });
    document.head.appendChild(script);
  }).catch((error) => {
    sdkPromise = null;
    sdkPromiseKey = '';
    document.querySelector('script[data-cbh-kakao-map="1"]')?.remove();
    throw error;
  });

  return sdkPromise;
}

export function KakaoTransitMap({
  center,
  centerLabel,
  points,
  selectedId,
  selectedIds = [],
  onSelect,
  onCenterChange,
}: KakaoTransitMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onCenterChangeRef = useRef(onCenterChange);
  onCenterChangeRef.current = onCenterChange;
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retryNonce, setRetryNonce] = useState(0);
  const selectedKey = [...selectedIds].sort().join('|');

  useEffect(() => {
    let active = true;
    if (!containerRef.current) return () => { active = false; };

    setState('loading');
    let gestureTimer: number | undefined;
    let mapInitialized = false;
    let lastCenter: Coordinate = center;
    const publishCenter = () => {
      if (!mapRef.current || !onCenterChangeRef.current || !mapInitialized) return;
      const point = mapRef.current.getCenter();
      const next = { x: point.getLng(), y: point.getLat() };
      // ~10m threshold: avoid duplicate network calls for a marker pan.
      if (Math.abs(next.x - lastCenter.x) < 0.00011 &&
          Math.abs(next.y - lastCenter.y) < 0.00009) return;
      lastCenter = next;
      if (gestureTimer != null) window.clearTimeout(gestureTimer);
      gestureTimer = window.setTimeout(() => {
        if (active) onCenterChangeRef.current?.(next);
      }, 350);
    };
    loadKakaoClientKey()
      .then((appKey) => {
        if (!appKey) throw new Error('Kakao Maps JavaScript key is unavailable.');
        return loadKakaoMapsSdk(appKey);
      })
      .then((kakao) => {
        if (!active || !containerRef.current) return;

        const centerPosition = new kakao.maps.LatLng(center.y, center.x);
        const map = new kakao.maps.Map(containerRef.current, {
          center: centerPosition,
          level: 4,
        });
        mapRef.current = map;
        markersRef.current.clear();

        new kakao.maps.Marker({
          map,
          position: centerPosition,
          title: centerLabel,
          zIndex: 5,
        });

        // Never fitBounds on result refresh: it would reset the user's pan.
        // The saved address marker stays fixed while the search center moves.
        mapInitialized = true;
        kakao.maps.event.addListener(map, 'dragend', publishCenter);
        kakao.maps.event.addListener(map, 'zoom_changed', publishCenter);

        setState('ready');
      })
      .catch(() => {
        if (active) setState('error');
      });

    return () => {
      active = false;
      if (gestureTimer != null) window.clearTimeout(gestureTimer);
      for (const marker of markersRef.current.values()) marker.setMap(null);
      mapRef.current = null;
      markersRef.current.clear();
      if (containerRef.current) containerRef.current.replaceChildren();
    };
  }, [center.x, center.y, centerLabel, retryNonce]);

  useEffect(() => {
    if (state !== 'ready' || !mapRef.current || !window.kakao?.maps) return;
    for (const marker of markersRef.current.values()) marker.setMap(null);
    markersRef.current.clear();
    const kakao = window.kakao;
    const map = mapRef.current;
    for (const point of points) {
      const position = new kakao.maps.LatLng(point.coordinate.y, point.coordinate.x);
      // Kakao SDK Marker exposes an image-map <area> that is not reliably
      // clickable in the canonical PWA (Chromium + WebKit user-flow QA).
      // A CustomOverlay with a REAL native button offers pointer, touch
      // and keyboard interaction while preserving map coordinates/identity.
      const content = document.createElement('button');
      content.type = 'button';
      content.className = 'cbh-transit-map-marker';
      content.dataset.transitId = point.id;
      content.dataset.mode = point.mode;
      content.title = (point.mode === 'BUS' ? '버스 · ' : '지하철 · ') + point.name;
      content.setAttribute('aria-label', content.title);
      content.setAttribute('aria-pressed', 'false');
      const glyph = document.createElement('span');
      glyph.textContent = point.mode === 'BUS' ? '버스' : '역';
      glyph.setAttribute('aria-hidden', 'true');
      content.append(glyph);
      content.addEventListener('pointerdown', (event) => event.stopPropagation());
      content.addEventListener('touchstart', (event) => event.stopPropagation(), { passive: true });
      content.addEventListener('click', (event) => {
        event.stopPropagation();
        onSelectRef.current(point.id);
      });
      const marker = new kakao.maps.CustomOverlay({
        map,
        position,
        content,
        clickable: true,
        xAnchor: 0.5,
        yAnchor: 1,
        zIndex: 2,
      });
      markersRef.current.set(point.id, marker);
    }
    return () => {
      for (const marker of markersRef.current.values()) marker.setMap(null);
      markersRef.current.clear();
    };
  }, [points, state]);

  useEffect(() => {
    const selectedSet = new Set(selectedKey ? selectedKey.split('|') : []);
    for (const [id, marker] of markersRef.current) {
      const focused = id === selectedId;
      const selected = selectedSet.has(id);
      marker.setZIndex(focused ? 20 : selected ? 10 : 2);
      const content = marker.getContent?.();
      if (content instanceof HTMLElement) {
        content.classList.toggle('is-active', focused);
        content.classList.toggle('is-selected', selected);
        content.setAttribute('aria-pressed', String(selected));
      }
    }
    const active = selectedId ? markersRef.current.get(selectedId) : null;
    // List focus should not move the search center when the marker is already
    // visible. Offscreen focused markers can still be brought into view.
    if (active && mapRef.current &&
        !mapRef.current.getBounds().contain(active.getPosition())) {
      mapRef.current.panTo(active.getPosition());
    }
  }, [selectedId, selectedKey, state]);

  return (
    <div className="kakao-transit-map-shell" data-map-state={state}>
      <span className="kakao-map-center-crosshair" aria-hidden="true">+</span>
      <div
        ref={containerRef}
        className="kakao-transit-map"
        aria-label="카카오 지도 주변 교통 선택"
        hidden={state === 'error'}
      />
      {state === 'loading' ? (
        <div className="kakao-map-status">카카오 지도를 불러오는 중</div>
      ) : null}
      {state === 'error' ? (
        <div className="kakao-map-error" role="status">
          <b>대화형 지도를 불러오지 못했습니다.</b>
          <span>아래 정류장·역 목록에서는 계속 선택할 수 있습니다.</span>
          <button
            type="button"
            onClick={() => {
              clientConfigPromise = null;
              setRetryNonce((value) => value + 1);
            }}
          >
            다시 시도
          </button>
        </div>
      ) : null}
    </div>
  );
}
