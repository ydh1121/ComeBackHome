export type AppRuntimeMode = 'mock' | 'api';

export function resolveRuntimeMode(value = import.meta.env.VITE_CBH_RUNTIME): AppRuntimeMode {
  if (value == null || value === '' || value === 'mock') return 'mock';
  if (value === 'api') return 'api';
  throw new Error('Unsupported VITE_CBH_RUNTIME value: ' + value);
}
