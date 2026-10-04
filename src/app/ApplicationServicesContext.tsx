import { createContext, useContext, useSyncExternalStore, type PropsWithChildren } from 'react';
import type { ApplicationServices } from '../application/contracts/runtime';

const ApplicationServicesContext = createContext<ApplicationServices | null>(null);

type ApplicationServicesProviderProps = PropsWithChildren<{ services: ApplicationServices }>;

export function ApplicationServicesProvider({ services, children }: ApplicationServicesProviderProps) {
  return <ApplicationServicesContext.Provider value={services}>{children}</ApplicationServicesContext.Provider>;
}

export function useApplicationServices(): ApplicationServices {
  const services = useContext(ApplicationServicesContext);
  if (!services) throw new Error('ApplicationServicesProvider is missing.');
  return services;
}

export function useApplicationVersion(): number {
  const services = useApplicationServices();
  return useSyncExternalStore(services.changes.subscribe, services.changes.getVersion, services.changes.getVersion);
}
