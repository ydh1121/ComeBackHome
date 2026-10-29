import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthRoot';
import { Icon } from '../../shared/components/Icon';
import { favoriteActions, favoriteGroups } from './favorites';
import { useFavoritePreferences } from './useFavoritePreferences';
import './portal.css';

export function FavoriteSettingsPage() {
  const { user } = useAuth();
  const { preferences, update } = useFavoritePreferences(user?.id);
  const [storageError, setStorageError] = useState(false);
  const save = (change: Parameters<typeof update>[0]) => setStorageError(!update(change));
  return <main className="private-page portal-settings-page" data-page="FavoriteSettingsPage">
    <header className="portal-settings-heading">
      <Link to="/settings" className="portal-settings-back" aria-label="설정으로 돌아가기"><Icon name="chevron-left" /></Link>
      <h1>즐겨찾기 버튼</h1>
    </header>
    <section className="private-card favorite-visibility">
      <label className="auth-check"><span>즐겨찾기 버튼 표시</span><input type="checkbox" role="switch" checked={preferences.visible} onChange={event => save({ visible: event.target.checked })} /></label>
      <p>이 계정의 현재 기기에 적용됩니다.</p>
    </section>
    <h2 className="favorite-section-title">바로가기 선택</h2>
    {favoriteGroups.map(group => <fieldset className="favorite-options" key={group}>
      <legend>{group}</legend>
      {favoriteActions.filter(action => action.group === group).map(action => <label key={action.id}>
        <Icon name={action.icon} /><span>{action.label}</span><input type="checkbox" checked={preferences.ids.includes(action.id)} onChange={event => save({ ids: event.target.checked ? [...preferences.ids, action.id] : preferences.ids.filter(id => id !== action.id) })} />
      </label>)}
    </fieldset>)}
    {storageError && <p role="alert">기기에 저장하지 못했습니다. 지금 선택은 앱을 닫기 전까지 유지됩니다.</p>}
  </main>;
}
