import { useState } from 'react';
import { BackButton } from '../shared/components/BackButton';
import { clearLocalCache, localCacheEnabled, localCacheSize, setLocalCacheEnabled } from '../pwa/localCache';
import './notification-page.css';

export function CacheSettingsPage() {
  const [enabled, setEnabled] = useState(localCacheEnabled);
  const [bytes, setBytes] = useState(localCacheSize);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const apply = async (action: () => Promise<void>, success: string) => {
    if (busy) return;
    setBusy(true); setMessage('');
    try { await action(); setMessage(success); }
    catch (error) { setMessage(error instanceof Error ? error.message : '다시 시도해 주세요.'); }
    finally { setEnabled(localCacheEnabled()); setBytes(localCacheSize()); setBusy(false); }
  };
  return <section className="notification-page cache-page" data-route="/settings/cache" data-page="CacheSettingsPage" data-state="READY">
    <BackButton fallbackTo="/settings" /><h1 className="page-title">로컬 캐시</h1>
    <button type="button" className="rule" aria-pressed={enabled} disabled={busy} onClick={()=>void apply(()=>setLocalCacheEnabled(!enabled), enabled ? '로컬 캐시를 끄고 비웠습니다.' : '로컬 캐시를 켰습니다.')}><span><b>이 기기에 임시 보관</b><small>같은 정보를 다시 불러오는 횟수를 줄입니다.</small></span><span aria-hidden="true" className={'switch'+(enabled?' on':'')} /></button>
    <p className="cache-explanation">사람과 일정은 최대 1분간 보관하며, 수정하면 바로 새로 불러옵니다. 실시간 교통과 알림 설정은 항상 서버에서 확인합니다.</p>
    <div className="cache-summary"><span>사람·일정 캐시</span><b>{Math.ceil(bytes/1024)} KB</b></div>
    <button type="button" className="cta secondary" disabled={busy} onClick={()=>void apply(clearLocalCache, '임시 데이터와 화면 캐시를 비웠습니다.')}>캐시 비우기</button>
    <p className="cache-explanation">화면 파일도 함께 비웁니다. 저장한 일정, 작성 중인 가져오기, 알림 구독은 유지됩니다. 캐시가 켜져 있으면 다음 이용부터 다시 보관합니다.</p>
    {message ? <p role="status" className="cache-feedback">{message}</p> : null}
  </section>;
}
