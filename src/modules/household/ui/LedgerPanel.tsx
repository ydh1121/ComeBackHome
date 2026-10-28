import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../../shared/components/Icon';
import type { HouseholdController } from '../client';
import { cardUsesCredit, householdPeriod, seoulDate, summarizeLedger, type EntryKind, type HouseholdEntry, type HouseholdState, type LedgerPeriod } from '../domain/model';
import { AmountField, BarChart, EmptyState, FormSheet, fromSeoulInput, localDateTime, shortWhen, won, SaveFeedback } from './shared';

export const entryKinds: Record<EntryKind, string> = { expense: '지출', income: '수입', refund: '환불', repayment: '카드 상환', borrowing: '카드대출', transfer: '충전·이체' };
const categories = ['식비', '장보기', '교통', '주거', '생활', '쇼핑', '건강', '여가', '기타'];
const foodDetails = ['한식', '중식', '일식', '양식', '분식', '카페·음료', '간식', '배달'];

export function LedgerPanel({ state, onAdd, model }: { state: HouseholdState; model: HouseholdController; onAdd(): void }) {
  const [date, setDate] = useState(seoulDate(new Date().getTime())), [period, setPeriod] = useState<LedgerPeriod>('month'), [detail, setDetail] = useState(0), [selected, setSelected] = useState<HouseholdEntry | null>(null), [correcting, setCorrecting] = useState<HouseholdEntry | null>(null);
  const range = householdPeriod(date, period), report = summarizeLedger(state, range.from, range.to);
  return <>
    <div className="hh-title-row"><h1 className="page-title">가계부</h1><button className="hh-text" type="button" onClick={onAdd}><Icon name="plus" /> 기록</button></div>
    <div className="hh-period"><div className="hh-segment" aria-label="조회 기간">{(['day', 'week', 'month', 'year'] as const).map((value, index) => <button type="button" key={value} aria-pressed={period === value} onClick={() => setPeriod(value)}>{['일', '주', '월', '년'][index]}</button>)}</div><label><span className="sr-only">조회 날짜</span><input type="date" value={date} onChange={event => { if (event.target.value) setDate(event.target.value); }} /></label></div>
    <section className="hh-total"><span>{period === 'day' ? date.slice(5).replace('-', '월 ') + '일 지출' : period === 'month' ? Number(date.slice(5, 7)) + '월 지출' : period === 'year' ? date.slice(0, 4) + '년 지출' : '이번 주 지출'}</span><strong>{won(report.netExpense)}</strong><div className="hh-total__detail"><span>수입 <b>{won(report.income)}</b></span><span>환불 <b>{won(report.refunded)}</b></span></div></section>
    <label className="hh-detail-range"><span>간략히</span><input type="range" min="0" max="2" step="1" value={detail} onChange={event => setDetail(Number(event.target.value))} aria-label="보기 상세 수준" aria-valuetext={['간략히', '분야별', '세부 내역'][detail]} /><span>자세히</span></label>
    {detail > 0 && <BarChart label={detail === 1 ? '어디에 많이 썼나요?' : '세부 지출'} rows={(detail === 1 ? report.categories : report.subcategories).slice(0, 12).map(row => ({ label: row.label, value: row.amount }))} />}
    {detail === 2 && <dl className="hh-stat-list"><div><dt>카드 상환</dt><dd>{won(report.repayment)}</dd></div><div><dt>카드대출</dt><dd>{won(report.borrowing)}</dd></div><div><dt>충전·이체</dt><dd>{won(report.transfer)}</dd></div></dl>}
    <div className="hh-section-title"><h2>쓴 돈과 들어온 돈</h2><span>{report.entries.length}건</span></div>
    {report.entries.length ? <div className="hh-ledger-list">{report.entries.map(entry => <button type="button" className="hh-ledger-row" key={entry.id} onClick={() => setSelected(entry)}><span className="hh-ledger-row__text"><b>{entry.merchant || entry.category || entryKinds[entry.kind]}</b><small>{shortWhen(entry.occurredAt)} · {entryKinds[entry.kind]}{detail > 0 && entry.subcategory ? ' · ' + entry.subcategory : ''}</small></span><strong className={['income', 'refund'].includes(entry.kind) ? 'is-income' : ''}>{['income', 'refund'].includes(entry.kind) ? '+' : entry.kind === 'expense' ? '−' : ''}{won(entry.amount)}</strong></button>)}</div> : <EmptyState icon="ledger" title="이 기간에는 기록이 없어요" action="쓴 돈 기록하기" onAction={onAdd}>금액만 먼저 적어도 괜찮아요.</EmptyState>}
    {correcting && <EntryForm state={state} model={model} existing={correcting} onClose={() => { setCorrecting(null); setSelected(null); }} />}
    {selected && !correcting && <FormSheet title="기록 확인" onClose={() => setSelected(null)} busy={model.busy}><div className="hh-form"><strong className="hh-record-amount">{won(selected.amount)}</strong><dl className="hh-stat-list"><div><dt>구분</dt><dd>{entryKinds[selected.kind]}</dd></div><div><dt>언제</dt><dd>{shortWhen(selected.occurredAt)}</dd></div>{selected.merchant && <div><dt>어디서</dt><dd>{selected.merchant}</dd></div>}{selected.category && <div><dt>분류</dt><dd>{selected.category}{selected.subcategory ? ' · ' + selected.subcategory : ''}</dd></div>}{selected.cardId && <div><dt>카드</dt><dd>{state.cards.find(card => card.id === selected.cardId)?.name ?? '보관한 카드'}</dd></div>}</dl>{selected.note && <p className="hh-record-note">{selected.note}</p>}<button type="button" className="hh-primary" onClick={() => { model.clearError(); setCorrecting(selected); }}>내용 수정</button><details><summary>잘못 적은 기록인가요?</summary><p className="hh-caption">취소하면 합계에서 빠져요. 원래 기록은 시트에 남아 있어요.</p><button type="button" className="hh-secondary" disabled={model.busy || model.stale} onClick={async () => { if (await model.mutate({ type: 'entry.void', id: selected.id })) setSelected(null); }}>이 기록 취소</button></details><SaveFeedback model={model} /></div></FormSheet>}
  </>;
}

export function EntryForm({ state, model, initialCardId = '', initialKind = 'expense', existing, onClose }: { state: HouseholdState; model: HouseholdController; initialCardId?: string; initialKind?: EntryKind; existing?: HouseholdEntry; onClose(): void }) {
  const id = useRef(crypto.randomUUID()), [kind, setKind] = useState<EntryKind>(existing?.kind ?? initialKind), [category, setCategory] = useState(existing?.category ?? ''), [cardId, setCardId] = useState(existing?.cardId ?? (initialKind === 'transfer' ? '' : initialCardId)), [source, setSource] = useState(existing?.repaymentSourceCardId ?? 'cash');
  useEffect(() => { if (state.entries.some(item => item.id === id.current)) onClose(); }, [state.entries, onClose]);
  const cards = state.cards.filter(card => !card.archived), creditCards = cards.filter(cardUsesCredit), balanceCards = cards.filter(card => !cardUsesCredit(card));
  const availableCards = ['repayment', 'borrowing'].includes(kind) ? creditCards : ['income', 'transfer'].includes(kind) ? balanceCards : cards;
  const needsCard = ['repayment', 'borrowing'].includes(kind);
  const resetKind = (value: EntryKind) => { setKind(value); setCardId(''); setSource('cash'); };
  return <FormSheet title={entryKinds[kind] + (existing ? ' 수정' : ' 기록')} onClose={onClose} busy={model.busy}>
    <form className="hh-form" onSubmit={async event => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      const replacement = { id: id.current, kind, amount: Number(data.get('amount')), occurredAt: fromSeoulInput(String(data.get('when'))), merchant: String(data.get('merchant') ?? ''), category, subcategory: String(data.get('subcategory') ?? ''), note: String(data.get('note') ?? ''), cardId: cardId || null, ...(kind === 'transfer' ? { toCardId: String(data.get('toCard') ?? '') || null } : {}), ...(kind === 'repayment' && source !== 'cash' ? { repaymentSourceCardId: source } : {}), ...(kind === 'income' ? { incomeType: String(data.get('incomeType')) as 'salary'|'other' } : {}) };
      const saved = await model.mutate(existing ? { type: 'entry.correct', id: existing.id, replacement } : { type: 'entry.add', entry: replacement });
      if (saved) onClose();
    }}><fieldset disabled={model.busy || model.stale}>
      <div className="hh-entry-kind"><label>구분<select value={kind} onChange={event => resetKind(event.target.value as EntryKind)}>{Object.entries(entryKinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      <AmountField label={kind === 'repayment' ? '상환한 금액' : kind === 'income' ? '들어온 금액' : '금액'} initial={existing?.amount} />
      <label className="hh-field">{kind === 'transfer' ? '어디에서 보냈나요?' : kind === 'repayment' ? '상환한 카드' : kind === 'borrowing' ? '빌린 카드' : kind === 'income' ? '어디로 받았나요?' : '결제 수단'}<select value={cardId} required={needsCard} onChange={event => { setCardId(event.target.value); if (kind === 'repayment') setSource('cash'); }}><option value="">{needsCard ? '카드 선택' : '현금·통장'}</option>{availableCards.map(card => <option key={card.id} value={card.id}>{card.name}</option>)}</select></label>
      {needsCard && !creditCards.length && <p className="hh-alert">먼저 한도를 사용하는 카드를 추가해 주세요.</p>}
      {kind === 'transfer' && <label className="hh-field">어디로 보냈나요?<select name="toCard" defaultValue={existing?.toCardId ?? (initialKind === 'transfer' ? initialCardId : '')}><option value="">현금·통장</option>{balanceCards.filter(card => card.id !== cardId).map(card => <option key={card.id} value={card.id}>{card.name}</option>)}</select></label>}
      {kind === 'repayment' && <><label className="hh-field">무슨 돈으로 상환했나요?<select value={source} onChange={event => setSource(event.target.value)}><option value="cash">현금·통장</option>{creditCards.filter(card => card.id !== cardId).map(card => <option key={card.id} value={card.id}>{card.name}에서 빌린 돈</option>)}</select></label><p className="hh-caption">상환은 지출에 다시 더하지 않아요.{source !== 'cash' ? ' 빌린 카드의 한도도 함께 줄어들어요.' : ''}</p></>}
      {kind === 'borrowing' && <p className="hh-caption">카드 한도에서 빌린 돈으로 기록해요. 월급이나 수입에 더하지 않아요.</p>}
      {kind === 'income' && <label className="hh-field">어떤 수입인가요?<select name="incomeType" defaultValue={existing?.incomeType ?? "salary"}><option value="salary">월급</option><option value="other">그 외 수입</option></select></label>}
      {['expense', 'refund'].includes(kind) && <label className="hh-field">분류 <span className="hh-optional">선택</span><select value={category} onChange={event => setCategory(event.target.value)}><option value="">나중에 정하기</option>{categories.map(value => <option value={value} key={value}>{value}</option>)}</select></label>}
      <details className="hh-more" open={Boolean(existing?.merchant || existing?.subcategory || existing?.note)}><summary>어디서 썼는지 자세히 적기</summary><label className="hh-field">가게·상대방<input name="merchant" defaultValue={existing?.merchant} maxLength={120} placeholder="선택" /></label><label className="hh-field">세부 분류<input name="subcategory" defaultValue={existing?.subcategory} list={category === '식비' ? 'hh-food-details' : undefined} maxLength={100} placeholder={category === '식비' ? '한식, 카페·음료…' : '필요할 때 적어 주세요'} /></label><datalist id="hh-food-details">{foodDetails.map(value => <option value={value} key={value} />)}</datalist><label className="hh-field">메모<textarea name="note" defaultValue={existing?.note} maxLength={2000} rows={3} /></label></details>
      <label className="hh-field">언제<input name="when" type="datetime-local" defaultValue={localDateTime(existing?.occurredAt)} required /></label>
      <button type="submit" className="hh-primary" disabled={needsCard && !creditCards.length}>{model.busy ? '저장 중…' : existing ? '수정 내용 저장' : '기록 저장'}</button>
    </fieldset><SaveFeedback model={model} /></form>
  </FormSheet>;
}
