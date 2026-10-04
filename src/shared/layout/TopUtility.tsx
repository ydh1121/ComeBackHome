import { useNavigate } from 'react-router';
import { Icon } from '../components/Icon';

export function TopUtility() {
  const navigate = useNavigate();
  return <header className="top-utility" data-component="TopUtility"><div className="brand">ComeBackHome</div><button type="button" className="icon-btn" onClick={() => navigate('/settings')} aria-label="설정"><Icon name="settings" /></button></header>;
}
