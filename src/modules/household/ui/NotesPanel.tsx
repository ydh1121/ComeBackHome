import { useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthRoot';
import { Icon } from '../../../shared/components/Icon';
import type { HouseholdController } from '../client';
import type { HouseholdState, HouseholdTodo } from '../domain/model';
import { EmptyState, FormSheet, fromSeoulInput, localDateTime, shortWhen, Toggle, SaveFeedback } from './shared';

export function NotesPanel({ state, model }: { state: HouseholdState; model: HouseholdController }) {
  const { user } = useAuth(), [text, setText] = useState(''), [editing, setEditing] = useState<HouseholdTodo | null>(null);
  const id = useRef(crypto.randomUUID()), pending = state.todos.filter(todo => !todo.completedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), done = state.todos.filter(todo => todo.completedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return <>
    <div className="hh-title-row"><h1 className="page-title">할 일·메모</h1><span className="hh-muted">함께 보는 공간</span></div>
    <form className="hh-note-compose" onSubmit={async event => { event.preventDefault(); if (!text.trim()) return; if (await model.mutate({ type: 'todo.save', todo: { id: id.current, text: text.trim(), dueAt: null, remind: false } })) { setText(''); id.current = crypto.randomUUID(); } }}>
      <label><span className="sr-only">새 할 일이나 메모</span><textarea value={text} onChange={event => setText(event.target.value)} maxLength={4000} rows={2} placeholder="생각났을 때 짧게 적어 두세요" required disabled={model.busy || model.stale} /></label><button type="submit" aria-label="메모 남기기" disabled={model.busy || model.stale || !text.trim()}><Icon name="plus" /></button>
    </form>
    {pending.length ? <div className="hh-notes-list">{pending.map(todo => <article className={'hh-note' + (todo.createdBy === user?.id ? ' is-mine' : '')} key={todo.id}><button type="button" className="hh-note__check" aria-label={todo.text.slice(0, 40) + ' 완료'} disabled={model.busy || model.stale} onClick={() => void model.mutate({ type: 'todo.complete', id: todo.id, done: true })}><span /></button><button type="button" className="hh-note__body" onClick={() => { model.clearError(); setEditing(todo); }}><p>{todo.text}</p><small>{todo.dueAt ? shortWhen(todo.dueAt) + (todo.remind ? ' · 알림' : '') : shortWhen(todo.createdAt)}</small></button></article>)}</div> : <EmptyState icon="notes" title="지금 할 일이 없어요">살 물건이나 잊지 말아야 할 일을 편하게 남겨 보세요.</EmptyState>}
    {done.length > 0 && <details className="hh-completed"><summary>완료한 일 {done.length}개</summary>{done.map(todo => <article className="hh-note is-done" key={todo.id}><button type="button" className="hh-note__check" aria-label={todo.text.slice(0, 40) + ' 다시 할 일로 옮기기'} disabled={model.busy || model.stale} onClick={() => void model.mutate({ type: 'todo.complete', id: todo.id, done: false })}><Icon name="check" /></button><button type="button" className="hh-note__body" onClick={() => setEditing(todo)}><p>{todo.text}</p><small>{shortWhen(todo.completedAt!)}</small></button></article>)}</details>}
    {editing && <TodoForm todo={editing} model={model} onClose={() => setEditing(null)} />}
  </>;
}
function TodoForm({ todo, model, onClose }: { todo: HouseholdTodo; model: HouseholdController; onClose(): void }) {
  const [remind, setRemind] = useState(todo.remind), [when, setWhen] = useState(todo.dueAt ? localDateTime(todo.dueAt) : '');
  return <FormSheet title="메모와 알림" onClose={onClose} busy={model.busy}><form className="hh-form" onSubmit={async event => { event.preventDefault(); const data = new FormData(event.currentTarget); if (await model.mutate({ type: 'todo.save', todo: { id: todo.id, text: String(data.get('text')).trim(), dueAt: when ? fromSeoulInput(when) : null, remind } })) onClose(); }}><fieldset disabled={model.busy || model.stale}>
    <label className="hh-field">내용<textarea name="text" required maxLength={4000} rows={5} defaultValue={todo.text} /></label>
    <label className="hh-field">언제까지 <span className="hh-optional">선택</span><input type="datetime-local" value={when} onChange={event => { setWhen(event.target.value); if (!event.target.value) setRemind(false); }} required={remind} /></label>
    <Toggle label="이 시간에 둘에게 알리기" checked={remind} onChange={value => { setRemind(value); if (value && !when) setWhen(localDateTime(new Date(new Date().getTime() + 60 * 60 * 1000).toISOString())); }} />
    <button type="submit" className="hh-primary">{model.busy ? '저장 중…' : '메모 저장'}</button>
  </fieldset><SaveFeedback model={model} /></form></FormSheet>;
}
