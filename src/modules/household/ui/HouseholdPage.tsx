import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAuth } from '../../auth/AuthRoot';
import { Icon } from '../../../shared/components/Icon';
import { clearHouseholdCache, householdCacheEnabled, setHouseholdCacheEnabled } from '../cache';
import { useHousehold } from '../client';
import type { EntryKind } from '../domain/model';
import { useHouseholdPush } from '../notifications';
import { CardsPanel } from './CardsPanel';
import { EntryForm, LedgerPanel } from './LedgerPanel';
import { IncomePanel } from './IncomePanel';
import { NotesPanel } from './NotesPanel';
import { EmptyState, FormSheet, HouseholdIcon, Toggle, SaveFeedback } from './shared';
import './household.css';

export function HouseholdPage() {
  const [params, setParams] = useSearchParams(), { user } = useAuth(), model = useHousehold(), push = useHouseholdPush(user?.id);
  const section = ['cards', 'ledger', 'income', 'notes'].includes(params.get('section') ?? '') ? params.get('section')! : 'ledger';
  const [entry, setEntry] = useState<{ cardId?: string; kind?: EntryKind } | null>(null), [settings, setSettings] = useState(false), [cached, setCached] = useState(householdCacheEnabled), [cacheNotice, setCacheNotice] = useState('');
  const state = model.data?.snapshot;
  useEffect(() => {
    if (params.get('action') === 'add' && state) {
      if (section !== 'notes') setEntry({ kind: section === 'income' ? 'income' : 'expense' });
      else requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.hh-note-compose textarea')?.focus());
      const next = new URLSearchParams(params); next.delete('action'); setParams(next, { replace: true });
    }
  }, [params, section, state, setParams]);
  if (!user) return <section className="household-page"><h1 className="page-title">생활비·할 일</h1><p>로그인이 필요합니다.</p></section>;
  if (model.loading && !state) return <section className="household-page" aria-label="가계부 불러오는 중" role="status"><div className="hh-skeleton hh-skeleton--title" /><div className="hh-skeleton hh-skeleton--amount" /><div className="hh-skeleton hh-skeleton--row" /><div className="hh-skeleton hh-skeleton--row" /><span className="sr-only">불러오는 중…</span></section>;
  if (!state) return <section className="household-page"><h1 className="page-title">생활비·할 일</h1>{model.data ? <EmptyState icon="ledger" title="가계부 연결" action={model.data.connected ? model.busy ? '만드는 중…' : '가계부 시작하기' : undefined} onAction={() => void model.initialize()}>{model.data.connected ? ' 연결한 비공개 Drive에 시트로 보관해요.' : ' 먼저 자료를 보관할 Google Drive를 연결해 주세요.'}</EmptyState> : null}{model.data && !model.data.connected && <a className="hh-primary hh-link" href="/injury?section=library">Drive 연결하기</a>}<SaveFeedback model={model} />{!model.needsRecovery && model.error && <button type="button" className="hh-text" onClick={() => void model.reload()}>다시 확인</button>}</section>;
  return <section className="household-page" data-page="HouseholdPage" data-section={section}>
    <div className="hh-utility"><span>{model.stale ? '최근 저장한 내용' : ''}</span><button className="icon-btn" type="button" aria-label="가계부 설정" onClick={() => setSettings(true)}><Icon name="settings" /></button></div>
    {model.stale && <div className="hh-cache-banner" role="status"><span>최신 내용을 확인해야 저장할 수 있어요.</span><button className="hh-text" type="button" onClick={() => void model.reload()}>새로고침</button></div>}
    {!entry && !settings && <SaveFeedback model={model} />}
    {section === 'cards' && <CardsPanel state={state} model={model} onEntry={(cardId, kind) => { model.clearError(); setEntry({ cardId, kind }); }} />}
    {section === 'ledger' && <LedgerPanel state={state} model={model} onAdd={() => { model.clearError(); setEntry({ kind: 'expense' }); }} />}
    {section === 'income' && <IncomePanel state={state} model={model} onIncome={() => { model.clearError(); setEntry({ kind: 'income' }); }} />}
    {section === 'notes' && <NotesPanel state={state} model={model} />}
    {entry && <EntryForm state={state} model={model} initialCardId={entry.cardId} initialKind={entry.kind} onClose={() => setEntry(null)} />}
    {settings && <FormSheet title="가계부 설정" onClose={() => setSettings(false)} busy={model.busy || push.busy}><div className="hh-form">
      <h3>알림</h3>
      <Toggle label="매일 밤 12시에 가계부 기록 알림" checked={state.preferences.dailyLedgerReminder} disabled={model.busy || model.stale} onChange={value => void model.mutate({ type: 'preferences.save', preferences: { ...state.preferences, dailyLedgerReminder: value } })} />
      <Toggle label="할 일에 정한 시간 알림" checked={state.preferences.todoReminders} disabled={model.busy || model.stale} onChange={value => void model.mutate({ type: 'preferences.save', preferences: { ...state.preferences, todoReminders: value } })} />
      <div className="hh-device-push"><div><HouseholdIcon name="bell" /><span>이 기기 {push.registered ? '알림 켜짐' : '알림 연결 필요'}</span></div><button type="button" className="hh-secondary" disabled={push.busy} onClick={() => void (push.registered ? push.disconnect() : push.connect())}>{push.busy ? '연결 중…' : push.registered ? '이 기기에서 끄기' : '이 기기에서 받기'}</button></div>
      <p className="hh-caption">각자 사용하는 기기에서 한 번씩 연결해 주세요. iPhone은 홈 화면에 추가한 앱에서 받을 수 있어요.</p>
      {push.error && <p role="alert" className="hh-alert">{push.error}</p>}
      <h3>빠르게 불러오기</h3><Toggle label="이 기기에 최근 내용 보관" checked={cached} onChange={value => { setHouseholdCacheEnabled(value); setCached(value); setCacheNotice(value ? '다음 조회부터 최근 내용을 보관해요.' : '이 기기에 보관한 내용을 지웠어요.'); }} /><button type="button" className="hh-text" onClick={() => { clearHouseholdCache('user'); setCacheNotice('이 기기에 보관한 내용만 지웠어요. Drive 원본은 그대로예요.'); }}>보관한 내용 비우기</button><p role="status" className="hh-caption">{cacheNotice}</p>
      {model.data?.spreadsheetUrl && <a className="hh-secondary hh-link" href={model.data.spreadsheetUrl} target="_blank" rel="noreferrer">Drive에서 장부 보기 <HouseholdIcon name="arrow" /></a>}
      <button type="button" className="hh-text" onClick={() => void model.reload()}><HouseholdIcon name="refresh" /> 최신 내용 불러오기</button><SaveFeedback model={model} />
    </div></FormSheet>}
  </section>;
}
