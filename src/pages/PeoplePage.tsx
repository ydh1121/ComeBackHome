import { useNavigate } from 'react-router';
import { usePeopleList } from '../features/people/usePeople';
import { Icon } from '../shared/components/Icon';
import './people-page.css';

export function PeoplePage() {
  const navigate = useNavigate();
  const state = usePeopleList();

  if (state.status === 'loading') {
    return <section className="people-page" data-page="PeoplePage" data-state="LOADING"><div className="people-message">사람 정보를 불러오는 중</div></section>;
  }
  if (state.status === 'error') {
    return <section className="people-page" data-page="PeoplePage" data-state="ERROR"><div className="people-message">사람 정보를 불러오지 못했습니다.</div></section>;
  }

  return (
    <section className="people-page" data-route="/people" data-page="PeoplePage" data-state={state.people.length ? 'LIST' : 'EMPTY'}>
      <h1 className="page-title">사람</h1>

      {state.people.length ? (
        <div className="people-list">
          {state.people.map((person) => (
            <button
              key={person.id}
              type="button"
              className="person-row"
              onClick={() => navigate('/people/' + encodeURIComponent(person.id))}
            >
              <span className="person-chip">
                <span className="avatar avatar-icon"><Icon name="people" /></span>
                <span>
                  <span className="row-title">{person.name}</span>
                  <span className="row-sub">{person.relation}</span>
                </span>
              </span>
              <Icon name="chevron-right" />
            </button>
          ))}
        </div>
      ) : <div className="people-empty">등록된 사람이 없습니다.</div>}

      <button type="button" className="cta secondary people-add" onClick={() => navigate('/people/new')}>
        사람 추가
      </button>
    </section>
  );
}
