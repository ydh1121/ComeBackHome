import {useAuth} from '../modules/auth/AuthRoot';
import { useThemePreference, setThemePreference, type ThemePreference } from '../shared/runtime/theme';
import { useNavigate } from 'react-router';
import { BackButton } from '../shared/components/BackButton';
import { Icon } from '../shared/components/Icon';
import './notification-page.css';

export function SettingsPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const theme = useThemePreference();

  return (
    <section className="notification-page" data-route="/settings" data-page="SettingsPage" data-state="READY">
      <BackButton fallbackTo="/" />
      <h1 className="page-title">설정</h1>
      <div className="settings-list">
        {auth.enabled && auth.user && <>
          <button type="button" className="settings-row-button" onClick={() => navigate('/account')}><b>내 계정</b><Icon name="chevron-right" /></button>
          <button type="button" className="settings-row-button" onClick={() => navigate('/settings/favorites')}><b>즐겨찾기 버튼</b><Icon name="chevron-right" /></button>
        </>}
        <button type="button" className="settings-row-button" onClick={() => navigate('/notifications')}>
          <b>알림</b>
          <Icon name="chevron-right" />
        </button>

        <button type="button" className="settings-row-button" onClick={() => navigate('/settings/cache')}><b>로컬 캐시</b><Icon name="chevron-right" /></button>
      </div>
      <fieldset className="theme-settings">
        <legend>화면 모드</legend>
        <div className="theme-options">
          {([['system', '시스템', 'monitor'], ['light', '화이트', 'sun'], ['dark', '다크', 'moon']] as const).map(([value, label, icon]) => (
            <label key={value} className={theme === value ? 'selected' : ''}>
              <input type="radio" name="theme" value={value} checked={theme === value} onChange={() => setThemePreference(value as ThemePreference)} />
              <Icon name={icon} /><span>{label}</span>
            </label>
          ))}
        </div>
        <p>시스템은 기기의 화면 설정을 따릅니다.</p>
      </fieldset>
    </section>
  );
}
