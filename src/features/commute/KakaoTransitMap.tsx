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
  onSelect(id: string): void;
}

declare global {
  interface Window {
    kakao?: any;
  }
}

let sdkPromise: Promise<any> | null = null;

function loadKakaoMapsSdk(appKey: string): Promise<any> {
  if (window.kakao?.maps) {
    return new Promise((resolve) => window.kakao.maps.load(() => resolve(window.kakao)));
  }
  if (sdkPromise) return sdkPromise;

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
  });

  return sdkPromise;
}

export function KakaoTransitMap({
  center,
  centerLabel,
  points,
  selectedId,
  onSelect,
}: KakaoTransitMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'static'>('loading');
  const appKey = String(import.meta.env.VITE_CBH_KAKAO_JAVASCRIPT_KEY ?? '').trim();

  useEffect(() => {
    let active = true;
    if (!containerRef.current) return () => { active = false; };
    if (!appKey) {
      setState('static');
      return () => { active = false; };
    }

    setState('loading');
    loadKakaoMapsSdk(appKey)
      .then((kakao) => {
        if (!active || !containerRef.current) return;

        const centerPosition = new kakao.maps.LatLng(center.y, center.x);
        const map = new kakao.maps.Map(containerRef.current, {
          center: centerPosition,
          level: 4,
        });

        const centerMarker = new kakao.maps.Marker({
          map,
          position: centerPosition,
          title: centerLabel,
          zIndex: 5,
        });

        const bounds = new kakao.maps.LatLngBounds();
        bounds.extend(centerPosition);

        for (const point of points) {
          const position = new kakao.maps.LatLng(point.coordinate.y, point.coordinate.x);
          bounds.extend(position);
          const marker = new kakao.maps.Marker({
            map,
            position,
            title: (point.mode === 'BUS' ? '버스 · ' : '지하철 · ') + point.name,
            zIndex: point.id === selectedId ? 10 : 2,
          });
          kakao.maps.event.addListener(marker, 'click', () => onSelect(point.id));
        }

        if (points.length) {
          map.setBounds(bounds, 38, 38, 38, 38);
        } else {
          map.setCenter(centerPosition);
        }

        void centerMarker;
        setState('ready');
      })
      .catch(() => {
        if (active) setState('static');
      });

    return () => {
      active = false;
      if (containerRef.current) containerRef.current.replaceChildren();
    };
  }, [appKey, center.x, center.y, centerLabel, points, selectedId, onSelect]);

  const markerPoints = [
    ...points.filter((point) => point.id === selectedId),
    ...points.filter((point) => point.id !== selectedId),
  ].slice(0, 4);
  const staticParams = new URLSearchParams({
    centerX: String(center.x),
    centerY: String(center.y),
  });
  for (const point of markerPoints) {
    staticParams.append('marker', point.coordinate.x + ',' + point.coordinate.y);
  }
  const staticMapUrl = '/api/providers/static-map?' + staticParams.toString();

  return (
    <div className="kakao-transit-map-shell" data-map-state={state}>
      {state === 'static' ? (
        <>
          <img className="kakao-transit-static-map" src={staticMapUrl} alt={centerLabel + ' 주변 카카오 지도'} />
          <div className="kakao-static-map-note">카카오 지도 · 가까운 후보는 아래 목록에서 선택</div>
        </>
      ) : (
        <div ref={containerRef} className="kakao-transit-map" aria-label="카카오 지도 주변 교통 선택" />
      )}
      {state === 'loading' ? <div className="kakao-map-status">카카오 지도를 불러오는 중</div> : null}
    </div>
  );
}
