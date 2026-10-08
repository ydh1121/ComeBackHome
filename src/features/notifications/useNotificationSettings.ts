import { useEffect, useState } from 'react';
import { useApplicationServices, useApplicationVersion } from '../../app/ApplicationServicesContext';
import type { PermissionState } from '../../domain/common';
import type { NotificationSettings } from '../../domain/models';

export type NotificationLoadState =
  | { status: 'loading' }
  | { status: 'ready'; settings: NotificationSettings }
  | { status: 'error' };

export interface NotificationPermissionView {
  title: string;
  subtitle: string;
  enabled: boolean;
  canRequest: boolean;
}

export function notificationPermissionView(permission: PermissionState): NotificationPermissionView {
  if (permission === 'granted') return { title: '알림 연결 필요', subtitle: '알림 권한은 허용되었지만 구독이 없습니다.', enabled: false, canRequest: true };
  if (permission === 'subscribed') return { title: '알림 켜짐', subtitle: '이 기기', enabled: true, canRequest: false };
  if (permission === 'stale') return { title: '알림 다시 연결', subtitle: '이전 구독이 만료되었거나 알림 키가 변경되었습니다.', enabled: false, canRequest: true };
  if (permission === 'denied') return { title: '알림 차단됨', subtitle: '기기 설정에서 허용이 필요합니다', enabled: false, canRequest: false };
  if (permission === 'error') return { title: '알림 상태 확인 실패', subtitle: '다시 시도할 수 있습니다', enabled: false, canRequest: true };
  return { title: '알림 꺼짐', subtitle: '이 기기', enabled: false, canRequest: true };
}

export function useNotificationSettings(): NotificationLoadState {
  const services = useApplicationServices();
  const version = useApplicationVersion();
  const [state, setState] = useState<NotificationLoadState>({ status: 'loading' });

  useEffect(() => {
    void services.actions.notifications.syncCurrentSubscription().catch(() => undefined);
  }, [services]);

  useEffect(() => {
    let active = true;
    services.queries.getNotificationSettings()
      .then((settings) => {
        if (active) setState({ status: 'ready', settings });
      })
      .catch(() => {
        if (active) setState({ status: 'error' });
      });
    return () => { active = false; };
  }, [services, version]);

  return state;
}
