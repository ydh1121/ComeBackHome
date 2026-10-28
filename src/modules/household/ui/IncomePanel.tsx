import { useRef, useState } from 'react';
import { Icon } from '../../../shared/components/Icon';
import type { HouseholdController } from '../client';
import { getSalaryPlan, type HouseholdState, type SalaryPlan } from '../domain/model';
import { AmountField, BarChart, EmptyState, FormSheet, Meter, monthNow, won, SaveFeedback } from './shared';

export function IncomePanel({ state, model, onIncome }: { state: HouseholdState; model: HouseholdController; onIncome(): void }) {
  const [month, setMonth] = useState(monthNow()), [editing, setEditing] = useState(false), report = getSalaryPlan(state, month);
  return <>
    <div className="hh-title-row"><h1 className="page-title">월급 나누기</h1><label className="hh-month"><span className="sr-only">월 선택</span><input type="month" value={month} onChange={event => { if (event.target.value) setMonth(event.target.value); }} /></label></div>
    <section className="hh-total"><span>이번 달 들어온 돈</span><strong>{won(report.actualIncome)}</strong><button type="button" className="hh-text" onClick={onIncome}><Icon name="plus" /> 들어온 돈 기록</button></section>
    {report.plan ? <><div className="hh-section-title"><h2>이렇게 쓸 거예요</h2><button type="button" className="hh-text" onClick={() => { model.clearError(); setEditing(true); }}>분배 수정</button></div><div className="hh-plan-summary"><div><span>예상 수입</span><b>{won(report.plannedIncome)}</b></div><div><span>{report.overAllocated ? '계획보다 더 나눈 돈' : '아직 나누지 않은 돈'}</span><b>{won(Math.abs(report.unallocatedFromPlan))}</b></div></div><Meter value={report.allocated} maximum={report.plannedIncome} label="월급 분배 비율" />{report.overAllocated && <p className="hh-alert">예상 수입보다 많이 나눴어요. 분배 금액을 확인해 주세요.</p>}<BarChart label="분배 계획" rows={report.plan.allocations.map(row => ({ label: row.label, value: row.amount }))} /><div className="hh-plan-actual"><span>가계부에 기록한 이번 달 지출</span><strong>{won(report.spent)}</strong><small>분배 계획을 세워도 지출로 기록되지는 않아요.</small></div></> : <EmptyState icon="income" title="들어올 돈을 미리 나눠 보세요" action="분배 계획 세우기" onAction={() => setEditing(true)}>생활비, 저축, 상환처럼 쓸 곳을 정해 둘 수 있어요.</EmptyState>}
    {editing && <PlanForm month={month} plan={report.plan ?? undefined} actualIncome={report.actualIncome} model={model} onClose={() => setEditing(false)} />}
  </>;
}
function PlanForm({ month, plan, actualIncome, model, onClose }: { month: string; plan?: SalaryPlan; actualIncome: number; model: HouseholdController; onClose(): void }) {
  const id = useRef(plan?.id ?? crypto.randomUUID()), [income, setIncome] = useState(String((plan?.plannedIncome ?? actualIncome) || ''));
  const [rows, setRows] = useState(plan?.allocations.map(row => ({ ...row, amount: String(row.amount) })) ?? [{ id: crypto.randomUUID(), label: '생활비', amount: '' }, { id: crypto.randomUUID(), label: '저축', amount: '' }]);
  const allocated = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0), remaining = Number(income || 0) - allocated;
  return <FormSheet title={Number(month.slice(5)) + '월 분배 계획'} onClose={onClose} busy={model.busy}><form className="hh-form" onSubmit={async event => { event.preventDefault(); if (await model.mutate({ type: 'plan.save', plan: { id: id.current, month, plannedIncome: Number(income), allocations: rows.map(row => ({ ...row, label: row.label.trim(), amount: Number(row.amount) })) } })) onClose(); }}><fieldset disabled={model.busy || model.stale}>
    <AmountField label="이번 달 예상 수입" value={income} onChange={setIncome} allowZero />
    <div className="hh-allocation-rows">{rows.map((row, index) => <div className="hh-allocation-row" key={row.id}><label><span className="sr-only">{index + 1}번째 쓸 곳</span><input required maxLength={80} placeholder="쓸 곳" value={row.label} onChange={event => setRows(value => value.map(item => item.id === row.id ? { ...item, label: event.target.value } : item))} /></label><label><span className="sr-only">{row.label || index + 1 + '번째'} 금액</span><input required type="number" min="0" max="999999999999" step="1" inputMode="numeric" placeholder="금액" value={row.amount} onChange={event => setRows(value => value.map(item => item.id === row.id ? { ...item, amount: event.target.value } : item))} /></label><button type="button" className="icon-btn" aria-label={(row.label || index + 1 + '번째 항목') + ' 삭제'} onClick={() => setRows(value => value.filter(item => item.id !== row.id))}><Icon name="close" /></button></div>)}</div>
    <button type="button" className="hh-text" disabled={rows.length >= 30} onClick={() => setRows(value => [...value, { id: crypto.randomUUID(), label: '', amount: '' }])}><Icon name="plus" /> 쓸 곳 추가</button>
    <div className="hh-between hh-plan-remainder"><span>{remaining < 0 ? '예상 수입 초과' : '남은 돈'}</span><strong>{won(Math.abs(remaining))}</strong></div>
    <button type="submit" className="hh-primary">{model.busy ? '저장 중…' : '분배 계획 저장'}</button>
  </fieldset><SaveFeedback model={model} /></form></FormSheet>;
}
