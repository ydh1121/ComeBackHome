const SERVICE_WORKER_URL = '/sw.js';

export function registerPwaServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: '/' })
      .catch(() => undefined);
  }, { once: true });
}
