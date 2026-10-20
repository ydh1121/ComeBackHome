import { Icon } from './Icon';
import { subwayLines } from '../../features/transit/subway-lines';
import './transit-icon.css';
export function TransitIcon({ mode, line = '' }: { mode: string; line?: string }) {
  const subway = mode === 'SUBWAY' || mode === 'TRANSFER';
  const lines = subway ? subwayLines(line) : [];
  return <span className="transit-icon" data-transit-mode={mode}>
    <span style={{ color: lines[0]?.color ?? 'var(--cbh-text)' }}><Icon name={subway ? 'train' : mode === 'BUS' ? 'bus' : 'walk'} /></span>
    {lines.length > 1 ? <span className="transit-line-dots" aria-label={lines.map(item => item.label).join(' 환승 ')}>{lines.map(item => <i key={item.label} style={{ backgroundColor: item.color }} title={item.label} />)}</span> : null}
  </span>;
}
