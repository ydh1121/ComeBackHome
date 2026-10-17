import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useApplicationServices } from '../app/ApplicationServicesContext';
import { BackButton } from '../shared/components/BackButton';
import { useFormRuntimeState } from '../shared/runtime/useFormRuntimeState';
import { formErrorMessage } from '../shared/runtime/formErrorMessage';
import './people-page.css';

export function PersonCreatePage() {
  const navigate = useNavigate();
  const services = useApplicationServices();
  const [name, setName] = useState('');
  const [relation, setRelation] = useState('');
  const form = useFormRuntimeState();

  const save = async () => {
    if (!name.trim() || form.state === 'SAVING') return;
    try {
      const person = await form.save(() => services.actions.people.create({ name, relation }));
      navigate('/people/' + encodeURIComponent(person.id), { replace: true });
    } catch {
      // The form owns an actionable error and retains the user's input.
    }
  };

  return (
    <section className="people-page" data-route="/people/new" data-page="PersonFormPage" data-state={"CREATE " + form.state}>
      <BackButton fallbackTo="/people" />
      <h1 className="page-title">사람 추가</h1>

      <div className="person-form">
        <label className="form-field">
          <span className="form-label">이름</span>
          <input className="input" value={name} onChange={(event) => { setName(event.target.value); form.markDirty(); }} placeholder="이름 입력" />
        </label>
        <label className="form-field">
          <span className="form-label">관계</span>
          <input className="input" value={relation} onChange={(event) => { setRelation(event.target.value); form.markDirty(); }} placeholder="예: 연인, 가족" />
        </label>
      </div>

      {form.error ? <p className="form-error" role="alert">{formErrorMessage(form.error)}</p> : null}
      <button type="button" className="cta" disabled={!name.trim() || form.state === 'SAVING'} onClick={save}>
        {form.state === 'SAVING' ? '저장 중' : form.state === 'SAVED' ? '저장됨' : '저장'}
      </button>
    </section>
  );
}
