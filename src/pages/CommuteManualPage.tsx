import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useApplicationServices } from '../app/ApplicationServicesContext';
import type { TransitAccessPoint } from '../domain/models';
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

export function CommuteManualPage() {
  const { personId = '' } = useParams();
  const navigate = useNavigate();
  const services = useApplicationServices();
  const state = useCommuteOverview(personId);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  if (state.status === 'loading') return <section className="commute-page"><div className="commute-message">내 경로를 불러오는 중</div></section>;
  if (state.status === 'error' || !state.overview.person) return <section className="commute-page"><div className="commute-message">내 경로를 불러오지 못했습니다.</div></section>;

  const { overview } = state;
  const points = [...overview.originAccessPoints, ...overview.destinationAccessPoints];
  const ids = overview.routePreference?.viaAccessPointIds ?? [];
  const routePoints = ids.map((id) => points.find((point) => point.id === id)).filter((point): point is TransitAccessPoint => Boolean(point));

  const editSearchPath = (point: TransitAccessPoint, index: number) =>
    '/people/' + encodeURIComponent(personId) + '/commute/' + point.placeKind + '/access/search?routeEdit=replace&index=' + index;

  const addKind = routePoints[routePoints.length - 1]?.placeKind ?? 'origin';
  const addPath = '/people/' + encodeURIComponent(personId) + '/commute/' + addKind + '/access/search?routeEdit=insert&index=' + ids.length;

  const move = async (from: number, to: number) => {
    if (to < 0 || to >= ids.length || from === to) return;
    await services.actions.commute.movePreferenceStep(personId, from, to);
  };

  return (
    <section className="commute-page" data-route={'/people/' + personId + '/commute/manual'} data-page="CommuteRouteManualPage" data-state="EDITING">
      <BackButton fallbackTo={'/people/' + encodeURIComponent(personId) + '/commute'} />
      <h1 className="page-title">내 경로 편집</h1>

      <div className="manual-route-list">
        <button type="button" className="manual-route-node" onClick={() => navigate('/people/' + encodeURIComponent(personId) + '/place/origin')}>
          <Icon name="home" />
          <span><b>{overview.origin?.label || '출발지'}</b><span className="manual-route-meta">출발지 수정</span></span>
          <Icon name="chevron-right" />
        </button>

        {routePoints.map((point, index) => (
          <div
            className="manual-route-draggable"
            key={point.id}
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
              aria-label="구간 순서 이동"
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
            <button type="button" className="manual-route-edit" onClick={() => navigate(editSearchPath(point, index))}>
              <span className="manual-route-mode"><Icon name={point.mode === 'BUS' ? 'bus' : 'train'} /></span>
              <span><b>{displayName(point)}</b>{accessMeta(point) ? <span className="manual-route-meta">{accessMeta(point)}</span> : null}</span>
              <span className="node-trailing"><Icon name="chevron-right" /></span>
            </button>
          </div>
        ))}

        <button type="button" className="manual-route-node" onClick={() => navigate('/people/' + encodeURIComponent(personId) + '/place/destination')}>
          <Icon name="home" />
          <span><b>{overview.destination?.label || '도착지'}</b><span className="manual-route-meta">도착지 수정</span></span>
          <Icon name="chevron-right" />
        </button>
      </div>

      <button type="button" className="cta secondary manual-route-add" onClick={() => navigate(addPath)}><Icon name="plus" /> 구간 추가</button>
      <button type="button" className="cta" onClick={() => navigate('/people/' + encodeURIComponent(personId) + '/commute')}>저장</button>
    </section>
  );
}
