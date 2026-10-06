import { useState } from 'react';
import { useApplicationServices } from '../app/ApplicationServicesContext';
import { notificationPermissionView, useNotificationSettings } from '../features/notifications/useNotificationSettings';
import { BackButton } from '../shared/components/BackButton';
import { Icon } from '../shared/components/Icon';
import './notification-page.css';

type TestStatus = 'idle' | 'sending' | 'sent' | 'error';

export function NotificationPage() {
  const services = useApplicationServices();
  const state = useNotificationSettings();
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');

  if (state.status === 'loading') {
    return <section className="notification-page" data-page="NotificationSetupPage" data-state="LOADING"><div className="notification-message">알림 설정을 불러오는 중</div></section>;
  }
  if (state.status === 'error') {
    return <section className="notification-page" data-page="NotificationSetupPage" data-state="ERROR"><div className="notification-message">알림 설정을 불러오지 못했습니다.</div></section>;
  }

  const settings = state.settings;
  const permissionView = notificationPermissionView(settings.permission);
  const runtimeState = settings.permission === 'default'
    ? 'PERMISSION_DEFAULT'
    : settings.permission === 'denied'
      ? 'PERMISSION_DENIED'
      : settings.permission === 'granted'
        ? 'PERMISSION_GRANTED'
        : settings.permission === 'subscribed'
          ? 'SUBSCRIBED'
          : 'PERMISSION_ERROR';

  const requestPermission = async () => {
    if (!permissionView.canRequest) return;
    try {
      await services.actions.notifications.requestPermissionFromUserGesture();
    } catch {
      // Repository state is updated to error by NotificationService.
    }
  };

  const updateRule = async (key: 'shiftEnd' | 'etaChange' | 'leftWork' | 'homeArrival', value: boolean) => {
    await services.actions.notifications.updateRules({
      ...settings.rules,
      [key]: value,
    });
  };

  const sendTest = async () => {
    if (!permissionView.enabled || testStatus === 'sending') return;
    setTestStatus('sending');
    try {
      await services.actions.notifications.sendTestNotification();
      setTestStatus('sent');
    } catch {
      setTestStatus('error');
    }
  };

  const permissionContent = (
    <>
      <div>
        <b>{permissionView.title}</b>
        <div className="row-sub">{permissionView.subtitle}</div>
      </div>
      {permissionView.enabled ? <Icon name="check" /> : permissionView.canRequest ? <Icon name="chevron-right" /> : null}
    </>
  );

  return (
    <section className="notification-page" data-route="/notifications" data-page="NotificationSetupPage" data-state={runtimeState}>
      <BackButton fallbackTo="/settings" />
      <h1 className="page-title">알림</h1>

      {permissionView.canRequest ? (
        <button type="button" className="permission-row permission-action" onClick={requestPermission}>
          {permissionContent}
        </button>
      ) : (
        <div className="permission-row">{permissionContent}</div>
      )}

      <div className="settings-list">
        <button
          type="button"
          className="rule"
          aria-pressed={settings.rules.shiftEnd}
          onClick={() => updateRule('shiftEnd', !settings.rules.shiftEnd)}
        >
          <b>예정 퇴근 시간에</b>
          <span className={'switch' + (settings.rules.shiftEnd ? ' on' : '')} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="rule"
          aria-pressed={settings.rules.etaChange}
          onClick={() => updateRule('etaChange', !settings.rules.etaChange)}
        >
          <b>도착 시간이 크게 바뀔 때</b>
          <span className={'switch' + (settings.rules.etaChange ? ' on' : '')} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="rule"
          aria-pressed={settings.rules.leftWork}
          onClick={() => updateRule('leftWork', !settings.rules.leftWork)}
        >
          <b>실제 퇴근을 감지했을 때</b>
          <span className={'switch' + (settings.rules.leftWork ? ' on' : '')} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="rule"
          aria-pressed={settings.rules.homeArrival}
          onClick={() => updateRule('homeArrival', !settings.rules.homeArrival)}
        >
          <b>집 도착을 감지했을 때</b>
          <span className={'switch' + (settings.rules.homeArrival ? ' on' : '')} aria-hidden="true" />
        </button>
      </div>

      <button type="button" className="cta secondary" disabled={!permissionView.enabled || testStatus === 'sending'} onClick={sendTest}>
        {testStatus === 'sending' ? '테스트 알림 보내는 중' : '테스트 알림'}
      </button>
      {testStatus === 'sent' ? <div className="notification-test-status" role="status">테스트 알림을 보냈습니다.</div> : null}
      {testStatus === 'error' ? <div className="notification-test-status error" role="alert">테스트 알림을 보내지 못했습니다.</div> : null}
    </section>
  );
}
