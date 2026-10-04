import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useApplicationServices } from '../app/ApplicationServicesContext';
import { BackButton } from '../shared/components/BackButton';
import './people-page.css';

export function PersonCreatePage() {
  const navigate = useNavigate();
  const services = useApplicationServices();
  const [name, setName] = useState('');
  const [relation, setRelation] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const person = await services.actions.people.create({ name, relation });
      navigate('/people/' + encodeURIComponent(person.id), { replace: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="people-page" data-route="/people/new" data-page="PersonFormPage" data-state="CREATE">
      <BackButton fallbackTo="/people" />
      <h1 className="page-title">사람 추가</h1>

      <div className="person-form">
        <label className="form-field">
          <span className="form-label">이름</span>
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="이름 입력" />
        </label>
        <label className="form-field">
          <span className="form-label">관계</span>
          <input className="input" value={relation} onChange={(event) => setRelation(event.target.value)} placeholder="예: 연인, 가족" />
        </label>
      </div>

      <button type="button" className="cta" disabled={!name.trim() || saving} onClick={save}>
        {saving ? '저장 중' : '저장'}
      </button>
    </section>
  );
}
