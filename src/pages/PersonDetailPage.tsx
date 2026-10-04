import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useApplicationServices } from '../app/ApplicationServicesContext';
import type { Place, TransitAccessPoint } from '../domain/models';
import { usePersonDetail } from '../features/people/usePeople';
import { BackButton } from '../shared/components/BackButton';
import { Icon, type IconName } from '../shared/components/Icon';
import './people-page.css';

function modeIcon(mode: string): IconName {
  if (mode === 'BUS') return 'bus';
  if (mode === 'SUBWAY') return 'train';
  return 'walk';
}

function placeAddress(place: Place | null): string {
  return [place?.address.road, place?.address.detail].filter(Boolean).join(' ');
}

interface LocationGroupProps {
  personId: string;
  kind: 'origin' | 'destination';
  place: Place | null;
  accessPoints: TransitAccessPoint[];
  onNavigate(path: string): void;
}

function LocationGroup({ personId, kind, place, accessPoints, onNavigate }: LocationGroupProps) {
  const selected = accessPoints.filter((point) => point.selected);
  const label = kind === 'origin' ? '출발' : '도착';
  const editLabel = kind === 'origin' ? '출발지' : '도착지';

  return (
    <div className="location-group">
      <div className="location-head">
        <div>
          <span className="location-label">{label}</span>
          <b>{place?.label || '장소 미등록'}</b>
          <div className="row-sub">{placeAddress(place)}</div>
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label={editLabel + ' 수정'}
          onClick={() => onNavigate('/people/' + encodeURIComponent(personId) + '/place/' + kind)}
        >
          <Icon name="edit" />
        </button>
      </div>

      <div className="transport-list">
        {selected.map((point) => (
          <div className="transport-row" key={point.id}>
            <Icon name={modeIcon(point.mode)} />
            <span>{point.userLabel || point.name}{point.line ? ' · ' + point.line : ''}</span>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="location-transport-action"
        onClick={() => onNavigate('/people/' + encodeURIComponent(personId) + '/commute/' + kind + '/access')}
      >
        <span>{editLabel} 교통 수정</span>
        <Icon name="chevron-right" />
      </button>
    </div>
  );
}

export function PersonDetailPage() {
  const { personId = '' } = useParams();
  const navigate = useNavigate();
  const services = useApplicationServices();
  const state = usePersonDetail(personId);

  useEffect(() => {
    if (personId) services.actions.personSelection.select(personId);
  }, [services, personId]);

  if (state.status === 'loading') {
    return <section className="people-page"><div className="people-message">사람 상세를 불러오는 중</div></section>;
  }
  if (state.status === 'error' || !state.detail.person) {
    return <section className="people-page"><div className="people-message">사람 정보를 찾지 못했습니다.</div></section>;
  }

  const { person, origin, destination, originAccessPoints, destinationAccessPoints, routeCandidates } = state.detail;
  const route = routeCandidates[0] ?? null;

  return (
    <section className="people-page" data-route={'/people/' + personId} data-page="PersonDetailPage" data-state="DETAIL">
      <BackButton fallbackTo="/people" />

      <div className="person-header">
        <div className="person-identity-line">
          <h1 className="page-title person-title">{person.name}</h1>
          {person.relation ? <span className="person-relation-inline">· {person.relation}</span> : null}
          <button
            type="button"
            className="person-inline-edit"
            aria-label="사람 정보 수정"
            onClick={() => navigate('/people/' + encodeURIComponent(person.id) + '/edit')}
          >
            <Icon name="edit" />
          </button>
        </div>
      </div>

      <div className="section-title">이동 경로</div>
      <div className="location-stack">
        <LocationGroup personId={person.id} kind="origin" place={origin} accessPoints={originAccessPoints} onNavigate={(path) => navigate(path)} />
        <LocationGroup personId={person.id} kind="destination" place={destination} accessPoints={destinationAccessPoints} onNavigate={navigate} />
      </div>

      <div className="section-title route-plan-title">주로 오는 길</div>
      <div className="route-line">
        {route?.steps?.length ? route.steps.map((step, index) => (
          <div className="route-line-row" key={index}>
            <Icon name={modeIcon(step.type === 'WALKING' ? 'WALK' : step.type)} />
            <span>{step.label}</span>
          </div>
        )) : <div className="route-empty">저장한 경로가 없습니다.</div>}
      </div>

      <button
        type="button"
        className="cta secondary"
        onClick={() => navigate('/people/' + encodeURIComponent(person.id) + '/commute')}
      >
        경로 설정
      </button>
    </section>
  );
}
