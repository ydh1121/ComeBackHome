import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useApplicationServices } from '../app/ApplicationServicesContext';
import type { PlaceKind } from '../domain/models';
import { useTransitAccess } from '../features/commute/useCommuteWorkflow';
import { BackButton } from '../shared/components/BackButton';
import { Icon } from '../shared/components/Icon';
import './commute-page.css';

type Filter = 'all' | 'subway' | 'bus';

function resolveKind(value?: string): PlaceKind {
  return value === 'destination' ? 'destination' : 'origin';
}

export function TransitAccessPage() {
  const { personId = '', placeKind } = useParams();
  const kind = resolveKind(placeKind);
  const navigate = useNavigate();
  const services = useApplicationServices();
  const state = useTransitAccess(personId, kind);
  const [filter, setFilter] = useState<Filter>('all');

  if (state.status === 'loading') return <section className="commute-page"><div className="commute-message">근처 교통을 불러오는 중</div></section>;
  if (state.status === 'error') return <section className="commute-page"><div className="commute-message">근처 교통을 불러오지 못했습니다.</div></section>;

  const kindLabel = kind === 'origin' ? '출발지' : '도착지';
  const visible = state.points.filter((point) => filter === 'all' || point.mode.toLocaleLowerCase() === filter);
  const base = '/people/' + encodeURIComponent(personId) + '/commute/' + kind + '/access';

  return (
    <section className="commute-page" data-route={base} data-page="TransitAccessPicker" data-state={visible.length ? 'CANDIDATE_SELECTING' : 'NO_RESULT'}>
      <BackButton fallbackTo={'/people/' + encodeURIComponent(personId)} />
      <h1 className="page-title">{kindLabel} 근처 교통</h1>
      <div className="transit-context">{kindLabel}에 연결할 역·정류장</div>

      <div className="candidate-filter">
        {([['all','전체'],['subway','지하철'],['bus','버스']] as const).map(([value,label]) => (
          <button key={value} type="button" className={'filter-btn' + (filter === value ? ' active' : '')} onClick={() => setFilter(value)}>{label}</button>
        ))}
      </div>

      <div className="transit-list">
        {visible.map((point) => point.mode === 'BUS' ? (
          <button
            type="button"
            className="transit-row transit-row-action"
            key={point.id}
            onClick={() => navigate(base + '/' + encodeURIComponent(point.id) + '/bus-routes')}
          >
            <Icon name="bus" />
            <span className="transit-copy">
              <b>{point.userLabel || point.name}</b>
              <span className="row-sub">{[point.displayCode ? '정류소 ' + point.displayCode : null, point.walkMinutes != null ? '도보 ' + point.walkMinutes + '분' : null].filter(Boolean).join(' · ')}</span>
            </span>
            <span className="transit-trailing"><Icon name="chevron-right" /></span>
          </button>
        ) : (
          <div className="transit-row" key={point.id}>
            <Icon name="train" />
            <span className="transit-copy"><b>{point.userLabel || point.name}{point.line ? ' · ' + point.line : ''}</b></span>
            <button
              type="button"
              className={'checkbox' + (point.selected ? ' checked' : '')}
              aria-label={(point.selected ? '선택 해제: ' : '선택: ') + point.name}
              onClick={() => services.actions.transitAccess.toggleAccess(point.id, !point.selected)}
            >
              {point.selected ? <Icon name="check" /> : <Icon name="plus" />}
            </button>
          </div>
        ))}
        {!visible.length ? <div className="transit-empty">조건에 맞는 교통이 없습니다.</div> : null}
      </div>

      <button type="button" className="cta secondary add-action" onClick={() => navigate(base + '/search')}><Icon name="plus" /> 다른 교통 추가</button>
      <button type="button" className="cta" onClick={() => navigate('/people/' + encodeURIComponent(personId))}>저장</button>
    </section>
  );
}
