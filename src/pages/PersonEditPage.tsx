import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useApplicationServices } from '../app/ApplicationServicesContext';
import { usePerson } from '../features/people/usePeople';
import { BackButton } from '../shared/components/BackButton';
import './people-page.css';

export function PersonEditPage() {
  const { personId = '' } = useParams();
  const navigate = useNavigate();
  const services = useApplicationServices();
  const state = usePerson(personId);
  const [name, setName] = useState('');
  const [relation, setRelation] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (state.status !== 'ready' || !state.person) return;
    setName(state.person.name);
    setRelation(state.person.relation);
  }, [state.status, state.status === 'ready' ? state.person?.id : null]);

  if (state.status === 'loading') {
    return <section className="people-page"><div className="people-message">사람 정보를 불러오는 중</div></section>;
  }
  if (state.status === 'error' || !state.person) {
    return <section className="people-page"><div className="people-message">사람 정보를 찾지 못했습니다.</div></section>;
  }

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await services.actions.people.update(personId, { name, relation });
      navigate('/people/' + encodeURIComponent(personId), { replace: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="people-page" data-route={'/people/' + personId + '/edit'} data-page="PersonFormPage" data-state="EDIT">
      <BackButton fallbackTo={'/people/' + encodeURIComponent(personId)} />
      <h1 className="page-title">사람 수정</h1>

      <div className="person-form">
        <label className="form-field">
          <span className="form-label">이름</span>
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="form-field">
          <span className="form-label">관계</span>
          <input className="input" value={relation} onChange={(event) => setRelation(event.target.value)} />
        </label>
      </div>

      <button type="button" className="cta" disabled={saving} onClick={save}>
        {saving ? '저장 중' : '저장'}
      </button>
    </section>
  );
}
