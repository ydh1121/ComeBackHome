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
}: KakaoTransitMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retryNonce, setRetryNonce] = useState(0);
  const selectedKey = [...selectedIds].sort().join('|');

  useEffect(() => {
    let active = true;
    if (!containerRef.current) return () => { active = false; };

    setState('loading');
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

        new kakao.maps.Marker({
          map,
          position: centerPosition,
          title: centerLabel,
          zIndex: 5,
        });

        const bounds = new kakao.maps.LatLngBounds();
        bounds.extend(centerPosition);

        const selectedSet = new Set(selectedKey ? selectedKey.split('|') : []);
        if (selectedId) selectedSet.add(selectedId);

        for (const point of points) {
          const position = new kakao.maps.LatLng(point.coordinate.y, point.coordinate.x);
          bounds.extend(position);
          const marker = new kakao.maps.Marker({
            map,
            position,
            title: (point.mode === 'BUS' ? '버스 · ' : '지하철 · ') + point.name,
            zIndex: selectedSet.has(point.id) ? 10 : 2,
          });
          kakao.maps.event.addListener(marker, 'click', () => onSelect(point.id));
        }

        if (points.length) map.setBounds(bounds, 38, 38, 38, 38);
        else map.setCenter(centerPosition);

        setState('ready');
      })
      .catch(() => {
        if (active) setState('error');
      });

    return () => {
      active = false;
      if (containerRef.current) containerRef.current.replaceChildren();
    };
  }, [center.x, center.y, centerLabel, points, selectedId, selectedKey, onSelect, retryNonce]);

  return (
    <div className="kakao-transit-map-shell" data-map-state={state}>
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
