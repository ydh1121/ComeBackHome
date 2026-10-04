import type { ChangeSignal } from '../application/contracts/runtime';

export interface ChangeSignalController extends ChangeSignal {
  emit(): void;
}

export function createChangeSignalController(): ChangeSignalController {
  let version = 0;
  const listeners = new Set<() => void>();

  return {
    emit() {
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
