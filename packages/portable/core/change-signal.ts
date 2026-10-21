export interface ChangeSignal { subscribe(listener: () => void): () => void; getVersion(): number; }

export interface ChangeSignalController extends ChangeSignal {
  emit(): void;
}

export function createChangeSignalController(
  page: EventTarget | undefined = typeof window === 'undefined' ? undefined : window,
): ChangeSignalController {
  let version = 0;
  let suspended = false;
  let pending = false;
  const listeners = new Set<() => void>();

  // Page-exit cleanup still persists its mutations, but must not start fresh
  // React queries in a document that WebKit is already unloading. Freeze the
  // snapshot as well as notifications; pageshow refreshes a restored bfcache.
  page?.addEventListener('pagehide', () => { suspended = true; });
  page?.addEventListener('pageshow', () => {
    suspended = false;
    if (!pending) return;
    pending = false;
    version += 1;
    listeners.forEach(listener => listener());
  });

  return {
    emit() {
      if (suspended) { pending = true; return; }
      version += 1;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getVersion() {
      return version;
    },
  };
}
