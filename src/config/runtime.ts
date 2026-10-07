export type AppRuntimeMode = 'mock' | 'api';
export type ProviderRuntimeMode = 'mock' | 'api';

export function resolveRuntimeMode(value = import.meta.env.VITE_CBH_RUNTIME): AppRuntimeMode {
  if (value == null || value === '') return import.meta.env.DEV ? 'mock' : 'api';
  if (value === 'mock') return 'mock';
  if (value === 'api') return 'api';
  throw new Error('Unsupported VITE_CBH_RUNTIME value: ' + value);
}

export function resolveProviderRuntimeMode(
  value = import.meta.env.VITE_CBH_PROVIDER_RUNTIME,
): ProviderRuntimeMode {
  if (value == null || value === '') return import.meta.env.DEV ? 'mock' : 'api';
  if (value === 'mock') return 'mock';
  if (value === 'api') return 'api';
  throw new Error('Unsupported VITE_CBH_PROVIDER_RUNTIME value: ' + value);
}
