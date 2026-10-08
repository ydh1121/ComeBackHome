/**
 * Read-only, on-device Web Push diagnosis. No subscription endpoint or VAPID
 * values are returned, logged or copied. No external push is sent, no D1 writes.
 */
export type PushCheckState = 'OK' | 'FAIL' | 'UNKNOWN';
export interface PushDiagnosticCheck {
  id: string;
  label: string;
  status: PushCheckState;
  detail: string;
}
export interface PushDiagnosticReport {
  checkedAt: string;
  checks: PushDiagnosticCheck[];
}

async function localApi(path: string, body?: unknown): Promise<{
  status: number;
  data: Record<string, unknown> | null;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch('/api' + path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
      headers: body === undefined
        ? { Accept: 'application/json' }
        : { Accept: 'application/json', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const parsed: unknown = await response.json().catch(() => null);
    const data = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
    return { status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
}

export async function collectPushDiagnostics(): Promise<PushDiagnosticReport> {
  const checks: PushDiagnosticCheck[] = [];
  const add = (id: string, label: string, status: PushCheckState, detail: string) =>
    checks.push({ id, label, status, detail });
  const standalone = window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const isIOS = /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  add('context', '보안 연결', window.isSecureContext ? 'OK' : 'FAIL',
    window.isSecureContext ? 'HTTPS 연결 확인' : 'HTTPS 연결이 필요합니다.');
  add('standalone', '앱 실행 방식', !isIOS || standalone ? 'OK' : 'FAIL',
    isIOS ? (standalone ? 'iPhone 홈 화면 앱에서 실행 중' :
      'iPhone에서는 홈 화면에 추가한 앱을 실행해야 합니다.') :
      (standalone ? '설치형 앱' : '일반 브라우저'));
  const supported = typeof Notification !== 'undefined';
  const permission = supported ? Notification.permission : 'unsupported';
  add('permission', '기기 알림 권한', permission === 'granted' ? 'OK' : 'FAIL',
    permission === 'granted' ? '허용됨' :
      permission === 'denied' ? '기기 설정에서 차단됨' :
      permission === 'default' ? '아직 알림 권한을 허용하지 않음' :
      '브라우저가 알림 API를 지원하지 않음');

  let subscription: PushSubscription | null = null;
  if (!('serviceWorker' in navigator)) {
    add('serviceWorker', '백그라운드 알림 서비스', 'FAIL', '서비스 워커를 지원하지 않음');
    add('subscription', '이 기기의 푸시 구독', 'FAIL', '알림 서비스가 없어 구독을 조회하지 못함');
  } else {
    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const ready = !!registration?.active && !!registration.pushManager;
      add('serviceWorker', '백그라운드 알림 서비스', ready ? 'OK' : 'FAIL',
        ready ? '활성 서비스 워커와 PushManager 확인' :
          '서비스 워커가 활성화되지 않았거나 PushManager가 없음');
      if (ready && registration) {
        subscription = await registration.pushManager.getSubscription();
        add('subscription', '이 기기의 푸시 구독', subscription ? 'OK' : 'FAIL',
          subscription ? '브라우저에 구독 존재' : '이 기기에 등록된 푸시 구독이 없음');
      } else {
        add('subscription', '이 기기의 푸시 구독', 'FAIL', '브라우저 구독을 조회할 수 없음');
      }
    } catch {
      add('serviceWorker', '백그라운드 알림 서비스', 'UNKNOWN', '서비스 워커 조회 실패');
      add('subscription', '이 기기의 푸시 구독', 'UNKNOWN', '브라우저 구독 조회 실패');
    }
  }

  try {
    const key = await localApi('/notifications/client-key');
    const configured = key.status === 200 && key.data?.configured === true;
    add('publicKey', '운영 서버 공개키', configured ? 'OK' : 'FAIL',
      configured ? '공개키 설정 확인' : '운영 서버 공개키 조회 또는 설정 실패');
  } catch {
    add('publicKey', '운영 서버 공개키', 'UNKNOWN', '운영 공개키 API 연결 실패');
  }

  try {
    const readiness = await localApi('/notifications/readiness');
    if (readiness.status !== 200 || !readiness.data) {
      add('transport', '서버 푸시 전송 준비', 'FAIL',
        '서버 준비 상태 API가 정상 응답하지 않음');
      add('scheduler', '예약 알림 실행 준비', 'UNKNOWN',
        '예약 알림 준비 상태를 확인할 수 없음');
    } else {
      const ready = readiness.data.pushTransportConfigured === true &&
        readiness.data.vapidKeyPairValid === true;
      add('transport', '서버 푸시 전송 준비', ready ? 'OK' : 'FAIL',
        ready ? 'VAPID 키 쌍과 전송 설정 확인' :
          'VAPID 키 쌍 또는 푸시 전송 설정 확인 필요');
      const scheduled = readiness.data.scheduledNotificationReady === true;
      add('scheduler', '예약 알림 실행 준비', scheduled ? 'OK' : 'FAIL',
        scheduled ? '서버 예약 알림 의존성 준비됨' :
          '예약 알림 서버 설정이 준비되지 않음');
    }
  } catch {
    add('transport', '서버 푸시 전송 준비', 'UNKNOWN', '운영 readiness API 연결 실패');
    add('scheduler', '예약 알림 실행 준비', 'UNKNOWN', '운영 readiness API 연결 실패');
  }

  if (subscription) {
    try {
      // This is a read-only identity check despite its POST transport method.
      // The private endpoint is sent only to the same-origin API and is NEVER
      // included in this report.
      const result = await localApi('/push/subscription/status',
        { endpoint: subscription.endpoint });
      const registered = result.status === 200 && result.data?.registered === true;
      add('serverSubscription', '서버의 이 기기 구독', registered ? 'OK' : 'FAIL',
        registered ? '브라우저 구독과 서버 저장 기록 일치' :
          '서버에 이 기기의 구독이 없거나 조회 실패');
    } catch {
      add('serverSubscription', '서버의 이 기기 구독', 'UNKNOWN', '서버 구독 조회 실패');
    }
  } else {
    add('serverSubscription', '서버의 이 기기 구독', 'UNKNOWN',
      '브라우저 구독이 없어 서버와 비교하지 않음');
  }

  add('delivery', '실제 기기 알림 수신', 'UNKNOWN',
    '읽기 전용 진단으로는 확인 불가 — 테스트 알림 실제 수신 확인 필요');
  return { checkedAt: new Date().toISOString(), checks };
}
