import { Link, useSearchParams } from 'react-router';
import { Icon, type IconName } from '../../../shared/components/Icon';
import { useNavigationPill } from '../../portal/PortalNavigation';
import { HouseholdPage } from './HouseholdPage';

const sections: Array<{ id: string; label: string; icon: IconName }> = [
  { id: 'cards', label: '카드', icon: 'wallet' },
  { id: 'ledger', label: '가계부', icon: 'edit' },
  { id: 'income', label: '월급', icon: 'chart' },
  { id: 'notes', label: '할 일', icon: 'check' },
];
export function HouseholdApp() {
  const [params] = useSearchParams();
  const selected = params.get('section') ?? 'ledger';
  const { bar, pill } = useNavigationPill(selected);
  return <><main className="household-shell"><HouseholdPage/></main><nav ref={bar} className="portal-nav portal-bottom" aria-label="생활비·할 일 메뉴"><span ref={pill} className="portal-pill" aria-hidden="true"/>{sections.map(item => <Link key={item.id} to={'/household?section='+item.id} aria-current={selected === item.id ? 'page' : undefined}><Icon name={item.icon}/><span>{item.label}</span></Link>)}</nav></>;
}
