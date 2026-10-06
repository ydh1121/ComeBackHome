const SERVICE_WORKER_URL = '/sw.js';

async function register(): Promise<void> {
  await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: '/' });
}

export function registerPwaServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  if (document.readyState === 'complete') {
    void register().catch(() => undefined);
    return;
  }

  window.addEventListener('load', () => {
    void register().catch(() => undefined);
  }, { once: true });
}
