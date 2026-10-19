import { PageSkeleton } from '../shared/components/PageSkeleton';
import { useRef, useState } from 'react';
import { categorizePushError, PUSH_FAILURE_MESSAGES, type PushFailureReason } from '../features/notifications/pushErrors';
import { useApplicationServices } from '../app/ApplicationServicesContext';
import { notificationPermissionView, useNotificationSettings } from '../features/notifications/useNotificationSettings';
import { BackButton } from '../shared/components/BackButton';
import { Icon } from '../shared/components/Icon';
import './notification-page.css';
import type { NotificationRules } from '../domain/models';
import { BIRTHDAY_REMINDER_DAYS } from '../domain/birthday';

type TestStatus = 'idle' | 'sending' | 'sent' | 'error';

export function NotificationPage() {
  const services = useApplicationServices();
  const state = useNotificationSettings();
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testError, setTestError] = useState<PushFailureReason | null>(null);
  const [connectError, setConnectError] = useState<PushFailureReason | null>(null);
  const [ruleError, setRuleError] = useState<string | null>(null);
  const [ruleSaving, setRuleSaving] = useState(false);
  const ruleSaveLock = useRef(false);

  if (state.status === 'loading') {
    return <section className="notification-page" data-page="NotificationSetupPage" data-state="LOADING"><PageSkeleton /></section>;
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
        ? 'PERMISSION_GRANTED_NO_SUBSCRIPTION'
        : settings.permission === 'subscribed'
          ? 'SUBSCRIBED'
          : settings.permission === 'stale'
            ? 'STALE_SUBSCRIPTION'
          : 'PERMISSION_ERROR';

  const requestPermission = async () => {
    if (!permissionView.canRequest) return;
    setConnectError(null);
    setTestError(null);
    try {
      await services.actions.notifications.requestPermissionFromUserGesture();
    } catch (error) {
      setConnectError(categorizePushError(error));
    }
  };

  const saveRules = async (patch: Partial<NotificationRules>) => {
    if (ruleSaveLock.current) return;
    ruleSaveLock.current = true;
    setRuleSaving(true);
    setRuleError(null);
    try {
      await services.actions.notifications.updateRules({
        ...settings.rules,
        etaChange: false, leftWork: false, homeArrival: false,
        ...patch,
      });
    } catch {
      // The server remains authoritative; no optimistic toggle is shown.
      setRuleError('알림 설정을 저장하지 못했습니다. 연결 상태를 확인하고 다시 눌러 주세요.');
    } finally {
      ruleSaveLock.current = false;
      setRuleSaving(false);
    }
  };
  const updateRule = (key:'shiftEnd'|'arrivalAdvance',value:boolean) => saveRules({[key]:value});

  const sendTest = async () => {
    if (!permissionView.enabled || testStatus === 'sending') return;
    setTestStatus('sending');
    setTestError(null);
    try {
      await services.actions.notifications.sendTestNotification();
      setTestStatus('sent');
    } catch (error) {
      setTestError(categorizePushError(error));
      setTestStatus('error');
    }
  };

  const permissionContent = (
    <>
      <div>
        <b>{permissionView.title}</b>
        <div className="row-sub">{permissionView.subtitle}</div>
      </div>
      {permissionView.enabled ? <Icon name="check" /> : permissionView.canRequest
        ? <span className="permission-connect-cta">{settings.permission === 'granted' || settings.permission === 'stale' ? '알림 연결' : '알림 허용'}</span>
        : null}
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

      {connectError ? (
        <div className="notification-test-status error" role="alert" data-reason={connectError}>
          {PUSH_FAILURE_MESSAGES[connectError]}
        </div>
      ) : null}

      {ruleError ? <div className="notification-test-status error" role="alert">{ruleError}</div> : null}
      <div className="settings-list" aria-busy={ruleSaving}>
        <button type="button" className="rule" disabled={ruleSaving}
          aria-pressed={settings.rules.arrivalAdvance ?? false}
          onClick={() => updateRule('arrivalAdvance', !settings.rules.arrivalAdvance)}>
          <b>예상 도착 10분 전에</b><span className={'switch' + (settings.rules.arrivalAdvance ? ' on' : '')} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="rule"
          disabled={ruleSaving}
          aria-pressed={settings.rules.shiftEnd}
          onClick={() => updateRule('shiftEnd', !settings.rules.shiftEnd)}
        >
          <b>예정 퇴근 10분 전에</b>
          <span className={'switch' + (settings.rules.shiftEnd ? ' on' : '')} aria-hidden="true" />
        </button>
      </div>

      <section className="birthday-notifications" aria-label="생일 알림">
        <div className="birthday-notification-heading"><h2>생일 알림</h2><span>오전 9시</span></div>
        <div className="birthday-reminders">{BIRTHDAY_REMINDER_DAYS.map(days => <button type="button" key={days} disabled={ruleSaving}
          aria-pressed={settings.rules.birthdayDays?.includes(days)??false}
          onClick={()=>void saveRules({birthdayDays:settings.rules.birthdayDays?.includes(days)?settings.rules.birthdayDays.filter(day=>day!==days):[...(settings.rules.birthdayDays??[]),days]})}>
          {days===7?'일주일 전':days===0?'당일':days===1?'하루 전':days+'일 전'}<span className={'switch'+(settings.rules.birthdayDays?.includes(days)?' on':'')} aria-hidden="true" />
        </button>)}</div>
      </section>
      <button type="button" className="cta secondary" disabled={!permissionView.enabled || testStatus === 'sending'} onClick={sendTest}>
        {testStatus === 'sending' ? '테스트 알림 보내는 중' : '테스트 알림'}
      </button>
      {testStatus === 'sent' ? <div className="notification-test-status" role="status">서버가 테스트 알림 전송을 수락했습니다. 실제 수신은 기기에서 확인해 주세요.</div> : null}
      {testStatus === 'error' && testError ? <div className="notification-test-status error" role="alert" data-reason={testError}>{PUSH_FAILURE_MESSAGES[testError]}</div> : null}
    </section>
  );
}
