export interface WebPushClientConfig {
  applicationServerKey: string | null;
}

export const UNCONFIGURED_WEB_PUSH_CLIENT_CONFIG: WebPushClientConfig = Object.freeze({
  applicationServerKey: null,
});

export function createWebPushClientConfig(applicationServerKey: string | null | undefined): WebPushClientConfig {
  const normalized = applicationServerKey?.trim() ?? '';
  return { applicationServerKey: normalized || null };
}
