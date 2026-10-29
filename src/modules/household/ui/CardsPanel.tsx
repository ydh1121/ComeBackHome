import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Icon } from '../../../shared/components/Icon';
import type { HouseholdController } from '../client';
import { useCardArt } from '../use-card-art';
import { getCardSummary, getCardsSummary, cardUsesCredit, type CardKind, type HouseholdCard, type HouseholdState } from '../domain/model';
import { HouseholdPageHeader, AmountField, EmptyState, FormSheet, HouseholdIcon, Meter, won, SaveFeedback } from './shared';

export const cardKinds: Record<CardKind, string> = { credit: '신용카드', debit: '체크카드', mobile: '모빌카드' };
function CardArt({ card, selected, onSelect }: { card: HouseholdCard; selected: boolean; onSelect(): void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const { url } = useCardArt(card);
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    if (!matchMedia('(hover: hover) and (pointer: fine)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width - .5, y = (event.clientY - box.top) / box.height - .5;
    ref.current?.style.setProperty('--hh-rotate-x', `${-y * 12}deg`); ref.current?.style.setProperty('--hh-rotate-y', `${x * 16}deg`);
  };
  const reset = () => { ref.current?.style.setProperty('--hh-rotate-x', '0deg'); ref.current?.style.setProperty('--hh-rotate-y', '0deg'); };
  return <button type="button" className="hh-card-choice" aria-label={card.name} aria-pressed={selected} onClick={onSelect} onPointerMove={move} onPointerLeave={reset} onBlur={reset}>
    <span className={'hh-card-art is-' + card.orientation} ref={ref}>{url ? <img src={url} alt="" draggable="false" /> : <span className="hh-card-placeholder"><HouseholdIcon name="card" /><span>{card.name}</span></span>}</span>
  </button>;
}

export function CardsPanel({ state, model, onEntry, onSettings }: { state: HouseholdState; model: HouseholdController; onSettings(): void; onEntry(cardId: string, kind: 'expense' | 'repayment' | 'transfer'): void }) {
  const [selectedId, setSelectedId] = useState(''), [editing, setEditing] = useState<HouseholdCard | 'new' | null>(null);
  const cards = state.cards.filter(card => !card.archived), selected = cards.find(card => card.id === selectedId) ?? cards[0], totals = getCardsSummary(state);
  const summary = selected ? getCardSummary(state, selected.id) : null;
  return <>
    <HouseholdPageHeader title="카드" onSettings={onSettings} actions={<button type="button" className="hh-text" onClick={() => { model.clearError(); setEditing('new'); }}><Icon name="plus" /> 카드 추가</button>} />
    {cards.length ? <>
      <section className="hh-total" aria-label="전체 사용 가능 금액"><span>지금 쓸 수 있는 금액</span><strong>{won(totals.available)}</strong><div className="hh-total__detail hh-card-totals"><span>전체 카드 한도 <b>{won(totals.creditLimit)}</b></span><span>사용한 한도 <b>{won(totals.creditUsed)}</b></span><span>카드 잔여 한도 <b>{won(totals.creditRemaining)}</b></span><span>체크카드 잔액 <b>{won(totals.debitBalance)}</b></span></div></section>
      <div className="hh-card-rail" aria-label="카드 선택">{cards.map(card => <CardArt key={card.id} card={card} selected={card.id === selected?.id} onSelect={() => setSelectedId(card.id)} />)}</div>
      {selected && summary && <section className="hh-card-detail">
        <div className="hh-section-title"><div><h2>{selected.name}</h2><span>{cardKinds[selected.kind]}</span></div><button type="button" className="hh-text" onClick={() => { model.clearError(); setEditing(selected); }}>수정</button></div>
        <div className="hh-balance"><span>{!cardUsesCredit(selected) ? '남은 잔액' : '남은 한도'}</span><strong>{won(summary.remaining)}</strong></div>
        {cardUsesCredit(selected) && <><Meter value={summary.used} maximum={summary.limit} label="카드 한도 사용량" /><div className="hh-between hh-small"><span>사용 {won(summary.used)}</span><span>한도 {won(summary.limit)}</span></div></>}
        {summary.overLimit && <p className="hh-alert">기록한 사용액이 남은 금액을 넘었어요. 누락한 상환이나 충전 내역을 확인해 주세요.</p>}
        <div className="hh-actions"><button type="button" className="hh-primary" disabled={model.busy || model.stale} onClick={() => onEntry(selected.id, 'expense')}>사용 기록</button><button type="button" className="hh-secondary" disabled={model.busy || model.stale} onClick={() => onEntry(selected.id, !cardUsesCredit(selected) ? 'transfer' : 'repayment')}>{!cardUsesCredit(selected) ? '잔액 채우기' : '상환 기록'}</button></div>

      </section>}
    </> : <EmptyState icon="card" title="등록된 카드가 없습니다" action="첫 카드 추가" onAction={() => setEditing('new')}>카드 한도와 현재 잔액을 입력하세요.</EmptyState>}
    {editing && <CardForm card={editing === 'new' ? undefined : state.cards.find(item => item.id === editing.id) ?? editing} state={state} model={model} onClose={() => setEditing(null)} onSaved={id => { setSelectedId(id); setEditing(null); }} />}
  </>;
}

function CardForm({ card, state, model, onClose, onSaved }: { card?: HouseholdCard; state: HouseholdState; model: HouseholdController; onClose(): void; onSaved(id: string): void }) {
  const id = useRef(card?.id ?? crypto.randomUUID()), [kind, setKind] = useState<CardKind>(card?.kind ?? 'credit'), [orientation, setOrientation] = useState<'landscape' | 'portrait'>(card?.orientation ?? 'landscape'), [mode, setMode] = useState<'credit'|'balance'>(card?.balanceMode ?? (card?.kind === 'mobile' || card?.kind === 'debit' ? 'balance' : 'credit'));
  const [artError, setArtError] = useState(''), [artSaved, setArtSaved] = useState(false);
  const isCredit = kind === 'credit' || kind === 'mobile' && mode === 'credit';
  useEffect(() => { if (!card && state.cards.some(item => item.id === id.current)) onSaved(id.current); }, [card, state.cards, onSaved]);
  const used = Boolean(card && state.entries.some(entry => entry.cardId === card.id || entry.toCardId === card.id || entry.repaymentSourceCardId === card.id));
  return <FormSheet title={card ? '카드 수정' : '카드 추가'} onClose={onClose} busy={model.busy}>
    <form className="hh-form" onSubmit={async event => { event.preventDefault(); const data = new FormData(event.currentTarget); const saved = await model.mutate({ type: 'card.save', card: { id: id.current, name: String(data.get('name')).trim(), kind, balanceMode: isCredit ? 'credit' : 'balance', limit: used && !isCredit ? card!.limit : Number(data.get('limit')), openingRemaining: used ? card!.openingRemaining : Number(data.get('remaining')), orientation, imageFileId: card?.imageFileId ?? null, archived: false } }); if (saved) onSaved(id.current); }}>
      <fieldset disabled={model.busy || model.stale}>
        <label className="hh-field">카드 이름<input name="name" maxLength={80} required defaultValue={card?.name} placeholder="알아보기 쉬운 이름" /></label>
        <label className="hh-field">카드 종류<select value={kind} disabled={used} onChange={event => { setKind(event.target.value as CardKind); setMode(event.target.value === 'credit' ? 'credit' : 'balance'); }}>{Object.entries(cardKinds).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        {kind === 'mobile' && <label className="hh-field">이 카드는 어떻게 쓰나요?<select value={mode} disabled={used} onChange={event => setMode(event.target.value as 'credit'|'balance')}><option value="balance">미리 충전한 잔액으로 사용</option><option value="credit">한도 안에서 쓰고 나중에 결제</option></select></label>}
        <fieldset disabled={used && !isCredit}><AmountField label={!isCredit ? '처음 넣어 둔 금액' : '전체 한도'} name="limit" initial={card?.limit} allowZero /></fieldset>
        {!used && <AmountField label={!isCredit ? '현재 잔액' : '현재 남은 한도'} name="remaining" initial={card?.openingRemaining} allowZero />}
        {used && <p className="hh-caption">사용 기록이 있어 시작 금액은 유지해요. 현재 잔액은 상환·충전 내역으로 바꿀 수 있어요.</p>}
        <div className="hh-field"><span>카드 사진 모양</span><div className="hh-segment">{(['landscape', 'portrait'] as const).map(value => <button key={value} type="button" aria-pressed={orientation === value} onClick={() => setOrientation(value)}>{value === 'landscape' ? '가로형' : '세로형'}</button>)}</div></div>
        <button className="hh-primary" type="submit">{model.busy ? '저장 중…' : '카드 저장'}</button>
      </fieldset>
      <SaveFeedback model={model} />
    </form>
    {card && <section className="hh-card-photo-settings" aria-label="카드 사진">
      <h3>카드 사진</h3>
      <label className="hh-upload-label"><Icon name="image" />{card.imageFileId ? '사진 변경' : '사진 추가'}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={model.busy || model.stale} onChange={async event => {
        const input = event.currentTarget, file = input.files?.[0]; input.value = ''; if (!file) return;
        setArtError(''); setArtSaved(false);
        if (file.size > 5 * 1024 * 1024) setArtError('5MB 이하의 사진을 선택해 주세요.');
        else setArtSaved(Boolean(await model.uploadArt(card.id, file)));
      }} /></label>
      <p className="hh-caption">카드번호와 보안코드는 가린 뒤 올려 주세요.</p>
      {artError && <p role="alert" className="hh-alert">{artError}</p>}
      {artSaved && <p role="status" className="hh-caption">사진을 변경했습니다.</p>}
    </section>}
  </FormSheet>;
}
