import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useApplicationServices } from '../app/ApplicationServicesContext';
import type { RouteCandidate, TransitAccessPoint } from '../domain/models';
import { useCommuteOverview } from '../features/commute/useCommuteWorkflow';
import { BackButton } from '../shared/components/BackButton';
import { Icon, type IconName } from '../shared/components/Icon';
import './commute-page.css';

function stepIcon(type: string): IconName {
  if (type === 'BUS') return 'bus';
  if (type === 'SUBWAY') return 'train';
  return 'walk';
}

function accessLabel(point: TransitAccessPoint | undefined): string {
  if (!point) return '교통 정보 없음';
  return point.userLabel || point.name;
}

function RouteSteps({ route }: { route: RouteCandidate }) {
  return <div className="route-steps">{(route.steps ?? []).map((step, index) => (
    <div className="route-step" key={index}>
      <Icon name={stepIcon(step.type)} />
      <span>{step.label}</span>
    </div>
  ))}</div>;
}

export function CommuteRoutePage() {
  const { personId = '' } = useParams();
  const navigate = useNavigate();
  const services = useApplicationServices();
  const state = useCommuteOverview(personId);
  const [expanded, setExpanded] = useState(false);

  if (state.status === 'loading') return <section className="commute-page"><div className="commute-message">경로를 불러오는 중</div></section>;
  if (state.status === 'error' || !state.overview.person) return <section className="commute-page"><div className="commute-message">경로를 불러오지 못했습니다.</div></section>;

  const { overview } = state;
  const points = [...overview.originAccessPoints, ...overview.destinationAccessPoints];
  const preference = overview.routePreference;
  const candidates = overview.routeCandidates;
  const visible = expanded ? candidates : candidates.slice(0, 3);
  const remain = Math.max(0, candidates.length - visible.length);

  return (
    <section className="commute-page" data-route={'/people/' + personId + '/commute'} data-page="CommuteRouteEditPage" data-state="ROUTE_SELECTING">
      <BackButton fallbackTo={'/people/' + encodeURIComponent(personId)} />
      <h1 className="page-title">경로 설정</h1>

      <div className="route-section-head">
        <h2>내 경로</h2>
        <button type="button" className="text-btn" onClick={() => navigate('/people/' + encodeURIComponent(personId) + '/commute/manual')}>수정</button>
      </div>

      <div className="saved-route">
        <div className="saved-route-title">내 경로</div>
        <div className="saved-route-steps">
          {preference?.viaAccessPointIds.length ? preference.viaAccessPointIds.map((id) => {
            const point = points.find((candidate) => candidate.id === id);
            return (
              <div className="saved-route-step" key={id}>
                <Icon name={point?.mode === 'BUS' ? 'bus' : 'train'} />
                <span>{accessLabel(point)}</span>
              </div>
            );
          }) : <div className="empty-inline">저장한 경로가 없습니다.</div>}
        </div>
      </div>

      <div className="route-section-head"><h2>자동 경로</h2></div>
      <div className="route-policy-list">
        {visible.map((route) => {
          const selected = route.id === overview.preferredRouteCandidateId;
          return (
            <button
              type="button"
              className={'route-candidate' + (selected ? ' selected' : '')}
              key={route.id}
              onClick={() => services.actions.commute.selectRouteCandidate(personId, route.id)}
            >
              <div className="route-candidate-head">
                <div>
                  <div className="route-badges">
                    {(route.policyLabels ?? []).map((label) => <span className="route-badge" key={label}>{label}</span>)}
                    {route.matchesPreference ? <span className="route-badge">내 경로 일치</span> : null}
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

      <button type="button" className="cta" onClick={() => navigate('/people/' + encodeURIComponent(personId))}>저장</button>
    </section>
  );
}
