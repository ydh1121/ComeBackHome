export type PushFailureReason =
  | 'NO_PERMISSION'
  | 'NO_SUBSCRIPTION'
  | 'SUBSCRIPTION_NOT_REGISTERED'
  | 'STALE_SUBSCRIPTION'
  | 'VAPID_CONFIG_MISSING'
  | 'PUSH_RUNTIME_NOT_READY'
  | 'PUSH_PROVIDER_REJECTED'
  | 'NETWORK_ERROR'
  | 'UNSUPPORTED_BROWSER'
  | 'SERVICE_WORKER_NOT_READY'
  | 'APPLICATION_SERVER_KEY_MISSING'
  | 'APPLICATION_SERVER_KEY_INVALID'
  | 'SUBSCRIBE_REJECTED'
  | 'SERVER_REGISTER_FAILED'
  | 'VAPID_KEY_MISMATCH'
  | 'UNKNOWN';

export class PushClientError extends Error {
  constructor(readonly reason: PushFailureReason) {
    super(reason);
    this.name = 'PushClientError';
  }
}

const REASONS = new Set<PushFailureReason>([
  'NO_PERMISSION','NO_SUBSCRIPTION','SUBSCRIPTION_NOT_REGISTERED',
  'STALE_SUBSCRIPTION','VAPID_CONFIG_MISSING','PUSH_RUNTIME_NOT_READY',
  'PUSH_PROVIDER_REJECTED','NETWORK_ERROR','UNSUPPORTED_BROWSER','SERVICE_WORKER_NOT_READY',
  'APPLICATION_SERVER_KEY_MISSING','APPLICATION_SERVER_KEY_INVALID',
  'SUBSCRIBE_REJECTED','SERVER_REGISTER_FAILED','VAPID_KEY_MISMATCH','UNKNOWN',
]);

export function categorizePushError(error: unknown): PushFailureReason {
  if (error instanceof PushClientError) return error.reason;
  if (error instanceof Error) {
    const typed = error as Error & { reason?: unknown; status?: number };
    if (typeof typed.reason === 'string' && REASONS.has(typed.reason as PushFailureReason)) {
      return typed.reason as PushFailureReason;
    }
    if (typed.status === 404) return 'SUBSCRIPTION_NOT_REGISTERED';
    if (typed.status === 410) return 'STALE_SUBSCRIPTION';
    if (typed.status === 503) return 'PUSH_RUNTIME_NOT_READY';
    if (typed.status === 502) return 'PUSH_PROVIDER_REJECTED';
    if (error.name === 'InvalidAccessError' || error.name === 'DataError') return 'APPLICATION_SERVER_KEY_INVALID';
    if (error.name === 'NotAllowedError') return 'NO_PERMISSION';
    if (error.name === 'NotSupportedError' || error.name === 'NotFoundError') return 'UNSUPPORTED_BROWSER';
    if (error.name === 'AbortError' || error.name === 'NetworkError' ||
        error instanceof TypeError) return 'NETWORK_ERROR';
    if (/Web Push client config is not ready/i.test(error.message)) return 'APPLICATION_SERVER_KEY_MISSING';
    if (/Application server key invalid/i.test(error.message)) return 'APPLICATION_SERVER_KEY_INVALID';
    if (/PushManager subscribe failed/i.test(error.message)) return 'SUBSCRIBE_REJECTED';
    if (/VAPID key mismatch/i.test(error.message)) return 'VAPID_KEY_MISMATCH';
    if (/Server push subscription registration failed/i.test(error.message)) return 'SERVER_REGISTER_FAILED';
    if (/Service Worker is not ready/i.test(error.message)) return 'SERVICE_WORKER_NOT_READY';
    if (/No active browser push subscription/i.test(error.message)) return 'NO_SUBSCRIPTION';
    if (/not supported|Secure context/i.test(error.message)) return 'UNSUPPORTED_BROWSER';
    if (/Failed to fetch|Network request failed/i.test(error.message)) return 'NETWORK_ERROR';
  }
  return 'UNKNOWN';
}

export const PUSH_FAILURE_MESSAGES: Record<PushFailureReason, string> = {
  NO_PERMISSION: '알림 권한이 필요합니다. 브라우저나 기기 설정에서 허용해 주세요.',
  NO_SUBSCRIPTION: '이 기기의 알림 연결이 필요합니다.',
  SUBSCRIPTION_NOT_REGISTERED: '서버에 알림 구독이 등록되지 않았습니다. 다시 연결해 주세요.',
  STALE_SUBSCRIPTION: '이 기기의 알림 구독이 만료되었거나 변경되었습니다. 다시 연결해 주세요.',
  VAPID_CONFIG_MISSING: '서버 알림 키 설정이 아직 준비되지 않았습니다.',
  PUSH_RUNTIME_NOT_READY: '서버 알림 전송 설정이 아직 준비되지 않았습니다.',
  PUSH_PROVIDER_REJECTED: '푸시 서비스가 알림 전송을 거부했습니다. 잠시 후 다시 시도해 주세요.',
  NETWORK_ERROR: '네트워크 연결을 확인하고 다시 시도해 주세요.',
  UNSUPPORTED_BROWSER: '이 브라우저에서 푸시 알림을 사용할 수 없습니다. iPhone은 홈 화면에 추가한 앱에서 확인해 주세요.',
  SERVICE_WORKER_NOT_READY: '알림 서비스를 준비하지 못했습니다. 앱을 다시 열고 연결해 주세요.',
  APPLICATION_SERVER_KEY_MISSING: '브라우저에서 알림 공개키를 가져오지 못했습니다.',
  APPLICATION_SERVER_KEY_INVALID: '알림 공개키 형식이 올바르지 않습니다.',
  SUBSCRIBE_REJECTED: '기기가 푸시 구독을 만들지 못했습니다. 앱 및 알림 설정을 확인해 주세요.',
  SERVER_REGISTER_FAILED: '구독 생성 후 서버 등록을 확인하지 못했습니다. 다시 연결해 주세요.',
  VAPID_KEY_MISMATCH: '알림 키가 변경되었습니다. 다시 연결해 주세요.',
  UNKNOWN: '알림 전송에 실패했습니다. 알림 연결 상태를 확인해 주세요.',
};
