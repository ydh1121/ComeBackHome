const SERVICE_WORKER_URL = '/sw.js';

async function register(): Promise<void> {
  const previouslyControlled = Boolean(navigator.serviceWorker.controller);
  let refreshed = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // First install must not interrupt onboarding; a replaced active controller
    // must refresh the client to avoid stale OCR/runtime/config after deployment.
    if (!previouslyControlled || refreshed) return;
    refreshed = true;
    window.location.reload();
  });
  const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, {
    scope: '/',
    updateViaCache: 'none',
  });
  await registration.update();
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
