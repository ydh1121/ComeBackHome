import type { CSSProperties, ReactNode } from 'react';
import { DismissibleSheet } from '../../../../packages/portable/react/DismissibleSheet';
import { Icon } from '../../../shared/components/Icon';
import type { HouseholdController } from '../client';

export const won = (amount: number) => new Intl.NumberFormat('ko-KR').format(amount) + '원';
export const localDateTime = (iso = new Date().toISOString()) => new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16);
export const fromSeoulInput = (value: string) => new Date(value + ':00+09:00').toISOString();
export const shortWhen = (iso: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
export const monthNow = () => localDateTime().slice(0, 7);
export const monthLabel = (month: string) => `${Number(month.slice(0, 4))}년 ${Number(month.slice(5, 7))}월`;

export function HouseholdIcon({ name }: { name: 'card' | 'ledger' | 'income' | 'notes' | 'bell' | 'refresh' | 'arrow' }) {
  return <svg className="svg" viewBox="0 0 24 24" aria-hidden="true">
    {name === 'card' ? <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M3 10h18M7 15h4" /></> : null}
    {name === 'ledger' ? <><path d="M5 3h14v18l-3-2-4 2-4-2-3 2V3Z" /><path d="M9 8h6M9 12h6" /></> : null}
    {name === 'income' ? <><path d="M4 20h16M6 16v-4M12 16V8M18 16V4" /></> : null}
    {name === 'notes' ? <><rect x="4" y="3" width="16" height="18" rx="3" /><path d="m8 9 2 2 5-5M8 16h8" /></> : null}
    {name === 'bell' ? <><path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5l-2 3ZM10 21h4" /></> : null}
    {name === 'refresh' ? <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2" /></> : null}
    {name === 'arrow' ? <><path d="M5 12h14m-5-5 5 5-5 5" /></> : null}
  </svg>;
}

export function FormSheet({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose(): void; busy?: boolean }) {
  return <DismissibleSheet label={title} closeLabel="닫기" closeIcon={<Icon name="close" />} onClose={() => { if (!busy) onClose(); }} classes={{ portal: 'household-sheet-portal', dialog: 'household-sheet', drag: 'household-sheet__drag', handle: 'household-sheet__handle', head: 'household-sheet__head', close: 'icon-btn' }}>{children}</DismissibleSheet>;
}

export function SaveFeedback({ model }: { model: HouseholdController }) {
  if (!model.error && !model.needsRecovery) return null;
  return <div className="hh-alert" role="alert">{model.error && <p>{model.error}</p>}{model.error.includes('Google Sheets API') && <a className="hh-text" href="/guides/household-drive-setup.html" target="_blank" rel="noreferrer">시트 연결 안내 보기</a>}{model.needsRecovery && <button type="button" className="hh-secondary" disabled={model.busy} onClick={() => void model.recover()}>{model.busy ? '확인 중…' : '저장 결과 확인'}</button>}</div>;
}

export function EmptyState({ icon, title, children, action, onAction }: { icon: 'card' | 'ledger' | 'income' | 'notes'; title: string; children: ReactNode; action?: string; onAction?(): void }) {
  return <div className="hh-empty"><HouseholdIcon name={icon} /><h2>{title}</h2><p>{children}</p>{action && <button type="button" className="hh-primary" onClick={onAction}>{action}</button>}</div>;
}

export function Meter({ value, maximum, label }: { value: number; maximum: number; label: string }) {
  const portion = maximum > 0 ? Math.min(1, Math.max(0, value / maximum)) : 0;
  return <div className="hh-meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={Math.max(1, maximum)} aria-valuenow={Math.min(Math.max(1, maximum), Math.max(0, value))}><span style={{ '--hh-portion': String(portion) } as CSSProperties} /></div>;
}

export function BarChart({ rows, label }: { rows: { label: string; value: number }[]; label: string }) {
  const maximum = Math.max(1, ...rows.map(row => row.value));
  return <figure className="hh-chart" aria-label={label}><figcaption>{label}</figcaption>{rows.length ? rows.map((row, index) => <div className="hh-chart__row" key={row.label}><span>{row.label}</span><b>{won(row.value)}</b><div className="hh-chart__track"><i style={{ width: `${Math.max(0, row.value / maximum * 100)}%`, '--hh-chart-index': index % 4 } as CSSProperties} /></div></div>) : <p className="hh-muted">기록이 쌓이면 여기에 보여요.</p>}</figure>;
}

export function Toggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange(value: boolean): void; label: string; disabled?: boolean }) {
  return <button type="button" className="hh-toggle-row" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}><span>{label}</span><span className="hh-toggle" aria-hidden="true" /></button>;
}

export function AmountField({ label, name = 'amount', value, onChange, initial, allowZero = false }: { label: string; name?: string; value?: string; onChange?(value: string): void; initial?: number; allowZero?: boolean }) {
  return <label className="hh-field">{label}<span className="hh-amount-field"><input name={name} inputMode="numeric" type="number" min={allowZero ? 0 : 1} max={999999999999} step="1" required value={value} onChange={onChange ? event => onChange(event.target.value) : undefined} defaultValue={initial} placeholder="0" /><span>원</span></span></label>;
}
