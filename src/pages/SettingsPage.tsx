import { useNavigate } from 'react-router';
import { BackButton } from '../shared/components/BackButton';
import { Icon } from '../shared/components/Icon';
import './notification-page.css';

export function SettingsPage() {
  const navigate = useNavigate();

  return (
    <section className="notification-page" data-route="/settings" data-page="SettingsPage" data-state="READY">
      <BackButton fallbackTo="/" />
      <h1 className="page-title">설정</h1>
      <div className="settings-list">
        <button type="button" className="settings-row-button" onClick={() => navigate('/notifications')}>
          <b>알림</b>
          <Icon name="chevron-right" />
        </button>
        <button type="button" className="settings-row-button" onClick={() => navigate('/settings/presence')}>
          <b>퇴근 · 귀가 자동화</b>
          <Icon name="chevron-right" />
        </button>
      </div>
    </section>
  );
}
