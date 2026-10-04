import { NavLink } from 'react-router';
import { Icon, type IconName } from '../components/Icon';

const items: Array<{ to: string; label: string; icon: IconName }> = [
  { to: '/', label: '오늘', icon: 'home' },
  { to: '/schedule', label: '일정', icon: 'calendar' },
  { to: '/import', label: '가져오기', icon: 'upload' },
  { to: '/people', label: '사람', icon: 'people' },
];

export function BottomNavigation() {
  return <nav className="bottomnav" data-component="BottomNavigation" aria-label="주요 탐색">{items.map((item) => <NavLink key={item.to} to={item.to} end className={({ isActive }: { isActive: boolean }) => `nav-btn${isActive ? ' active' : ''}`}><Icon name={item.icon} /><span>{item.label}</span></NavLink>)}</nav>;
}
