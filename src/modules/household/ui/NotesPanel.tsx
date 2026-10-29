import { useId, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthRoot';
import { Icon } from '../../../shared/components/Icon';
import type { HouseholdController } from '../client';
import type { HouseholdState, HouseholdTodo, ReminderRecipient } from '../domain/model';
import { HouseholdPageHeader, FormSheet, fromSeoulInput, HouseholdIcon, localDateTime, shortWhen, Toggle, SaveFeedback } from './shared';

const nextHour = () => localDateTime(new Date(new Date().getTime() + 60 * 60 * 1000).toISOString());
function recipientLabel(recipient: ReminderRecipient, role: 'admin' | 'member' | undefined) {
  return recipient === 'both' ? '둘 다' : recipient === role ? '나에게' : '상대방에게';
}
function ReminderFields({ when, setWhen, recipient, setRecipient, required = true }: {
  when: string; setWhen(value: string): void; recipient: ReminderRecipient;
  setRecipient(value: ReminderRecipient): void; required?: boolean;
}) {
  const { user } = useAuth(), group = useId();
  const own = user?.role ?? 'member', other = own === 'admin' ? 'member' : 'admin';
  return <div className="hh-reminder-fields">
    <label className="hh-field">알림 시간<input type="datetime-local" value={when} onChange={event => setWhen(event.target.value)} required={required} /></label>
    <fieldset className="hh-recipient-options"><legend>알림 받을 사람</legend>{([own, other, 'both'] as ReminderRecipient[]).map(value => <label key={value}>
      <input type="radio" name={group} value={value} checked={recipient === value} onChange={() => setRecipient(value)} />
      <span>{recipientLabel(value, user?.role)}</span>
    </label>)}</fieldset>
  </div>;
}

export function NotesPanel({ state, model, onSettings }: { state: HouseholdState; model: HouseholdController; onSettings(): void }) {
  const { user } = useAuth();
  const [text, setText] = useState(''), [remind, setRemind] = useState(false), [when, setWhen] = useState('');
  const [recipient, setRecipient] = useState<ReminderRecipient>('both');
  const [editing, setEditing] = useState<HouseholdTodo | null>(null), [removing, setRemoving] = useState<HouseholdTodo | null>(null);
  const id = useRef(crypto.randomUUID()), locked = model.busy || model.stale;
  const pending = state.todos.filter(todo => !todo.archivedAt && !todo.completedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const done = state.todos.filter(todo => !todo.archivedAt && todo.completedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return <>
    <HouseholdPageHeader title="할 일·메모" onSettings={onSettings} />
    <form className="hh-note-compose hh-note-compose--stacked" onSubmit={async event => {
      event.preventDefault(); if (!text.trim()) return;
      if (await model.mutate({ type: 'todo.save', todo: { id: id.current, text: text.trim(), dueAt: remind && when ? fromSeoulInput(when) : null, remind, reminderRecipient: recipient } })) {
        setText(''); setRemind(false); setWhen(''); setRecipient('both'); id.current = crypto.randomUUID();
      }
    }}>
      <fieldset disabled={locked}>
        <label className="hh-note-compose__input"><span className="sr-only">새 할 일이나 메모</span><textarea aria-label="새 할 일이나 메모" value={text} onChange={event => setText(event.target.value)} maxLength={4000} rows={2} placeholder="할 일이나 메모 입력" required /></label>
        {remind && <ReminderFields when={when} setWhen={setWhen} recipient={recipient} setRecipient={setRecipient} />}
        <div className="hh-note-compose__actions">
          <button type="button" className="hh-note-compose__reminder" aria-expanded={remind} onClick={() => { setRemind(!remind); if (!remind && !when) setWhen(nextHour()); }}><HouseholdIcon name="bell" /><span>{remind ? '알림 취소' : '알림 설정'}</span></button>
          <button type="submit" className="hh-note-compose__submit hh-primary" aria-label="메모 남기기" disabled={!text.trim()}><Icon name="plus" /><span>추가</span></button>
        </div>
      </fieldset>
    </form>
    {pending.length ? <div className="hh-notes-list">{pending.map(todo => <article className={'hh-note' + (todo.createdBy === user?.id ? ' is-mine' : '')} key={todo.id}>
      <button type="button" className="hh-note__check" aria-label={todo.text.slice(0, 40) + ' 완료'} disabled={locked} onClick={() => void model.mutate({ type: 'todo.complete', id: todo.id, done: true })}><span /></button>
      <button type="button" className="hh-note__body" onClick={() => { model.clearError(); setEditing(todo); }}><p>{todo.text}</p><small>{todo.dueAt ? shortWhen(todo.dueAt) + (todo.remind ? ' · ' + recipientLabel(todo.reminderRecipient ?? 'both', user?.role) + ' 알림' : '') : shortWhen(todo.createdAt)}</small></button>
    </article>)}</div> : <div className="hh-notes-empty"><HouseholdIcon name="notes" /><p>할 일이 없습니다.</p></div>}
    {done.length > 0 && <details className="hh-completed"><summary>완료한 일 {done.length}개</summary><div className="hh-notes-list">{done.map(todo => <article className="hh-note is-done" key={todo.id}>
      <button type="button" className="hh-note__check" aria-label={todo.text.slice(0, 40) + ' 다시 할 일로 옮기기'} disabled={locked} onClick={() => void model.mutate({ type: 'todo.complete', id: todo.id, done: false })}><Icon name="check" /></button>
      <button type="button" className="hh-note__body" onClick={() => { model.clearError(); setEditing(todo); }}><p>{todo.text}</p><small>{shortWhen(todo.completedAt!)}</small></button>
      <button type="button" className="hh-note__delete" aria-label={todo.text.slice(0, 40) + ' 삭제'} disabled={locked} onClick={() => { model.clearError(); setRemoving(todo); }}>삭제</button>
    </article>)}</div></details>}
    {editing && <TodoForm todo={editing} model={model} onClose={() => setEditing(null)} />}
    {removing && <FormSheet title="완료한 항목 삭제" onClose={() => setRemoving(null)} busy={model.busy}><div className="hh-form">
      <p className="hh-note-confirm__text">{removing.text}</p><p className="hh-muted">두 사람의 목록에서 삭제합니다.</p>
      <div className="hh-note-confirm__actions"><button type="button" className="hh-secondary" disabled={model.busy} onClick={() => setRemoving(null)}>취소</button><button type="button" className="hh-primary" disabled={locked} onClick={async () => { if (await model.mutate({ type: 'todo.archive', id: removing.id })) setRemoving(null); }}>{model.busy ? '삭제 중…' : '삭제'}</button></div>
      <SaveFeedback model={model} />
    </div></FormSheet>}
  </>;
}
function TodoForm({ todo, model, onClose }: { todo: HouseholdTodo; model: HouseholdController; onClose(): void }) {
  const [remind, setRemind] = useState(todo.remind), [when, setWhen] = useState(todo.dueAt ? localDateTime(todo.dueAt) : '');
  const [recipient, setRecipient] = useState<ReminderRecipient>(todo.reminderRecipient ?? 'both');
  return <FormSheet title="메모와 알림" onClose={onClose} busy={model.busy}><form className="hh-form" onSubmit={async event => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    if (await model.mutate({ type: 'todo.save', todo: { id: todo.id, text: String(data.get('text')).trim(), dueAt: when ? fromSeoulInput(when) : null, remind, reminderRecipient: recipient } })) onClose();
  }}><fieldset disabled={model.busy || model.stale}>
    <label className="hh-field">내용<textarea name="text" aria-label="내용" required maxLength={4000} rows={4} defaultValue={todo.text} /></label>
    <Toggle label="알림" checked={remind} onChange={value => { setRemind(value); if (value && !when) setWhen(nextHour()); }} />
    {remind ? <ReminderFields when={when} setWhen={setWhen} recipient={recipient} setRecipient={setRecipient} /> : <label className="hh-field">기한 <span className="hh-optional">선택</span><input type="datetime-local" value={when} onChange={event => setWhen(event.target.value)} /></label>}
    <button type="submit" className="hh-primary">{model.busy ? '저장 중…' : '메모 저장'}</button>
  </fieldset><SaveFeedback model={model} /></form></FormSheet>;
}
