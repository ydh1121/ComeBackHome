import { useEffect, useState } from 'react';
import { useApplicationServices, useApplicationVersion } from '../../app/ApplicationServicesContext';
import type { Place, PlaceKind, TransitAccessPoint } from '../../domain/models';
import type { CommuteOverviewQueryResult } from '../../application/queries/ComeBackHomeQueries';

export type CommuteOverviewState =
  | { status: 'loading' }
  | { status: 'ready'; overview: CommuteOverviewQueryResult }
  | { status: 'error' };

export type PlaceState =
  | { status: 'loading' }
  | { status: 'ready'; place: Place | null }
  | { status: 'error' };

export type TransitAccessState =
  | { status: 'loading' }
  | { status: 'ready'; points: TransitAccessPoint[] }
  | { status: 'error' };

export type AccessPointState =
  | { status: 'loading' }
  | { status: 'ready'; point: TransitAccessPoint | null }
  | { status: 'error' };

export function useCommuteOverview(personId?: string): CommuteOverviewState {
  const services = useApplicationServices();
  const version = useApplicationVersion();
  const [state, setState] = useState<CommuteOverviewState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    if (!personId) {
      setState({ status: 'error' });
      return () => { active = false; };
    }
    services.queries.getCommuteOverview(personId)
      .then((overview) => active && setState({ status: 'ready', overview }))
      .catch(() => active && setState({ status: 'error' }));
    return () => { active = false; };
  }, [services, version, personId]);

  return state;
}

export function usePlace(personId: string | undefined, kind: PlaceKind): PlaceState {
  const services = useApplicationServices();
  const version = useApplicationVersion();
  const [state, setState] = useState<PlaceState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    if (!personId) {
      setState({ status: 'error' });
      return () => { active = false; };
    }
    services.queries.getPlace(personId, kind)
      .then((place) => active && setState({ status: 'ready', place }))
      .catch(() => active && setState({ status: 'error' }));
    return () => { active = false; };
  }, [services, version, personId, kind]);

  return state;
}

export function useTransitAccess(personId: string | undefined, kind: PlaceKind): TransitAccessState {
  const services = useApplicationServices();
  const version = useApplicationVersion();
  const [state, setState] = useState<TransitAccessState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    if (!personId) {
      setState({ status: 'error' });
      return () => { active = false; };
    }
    services.queries.getTransitAccess(personId, kind, 'all')
      .then((points) => active && setState({ status: 'ready', points }))
      .catch(() => active && setState({ status: 'error' }));
    return () => { active = false; };
  }, [services, version, personId, kind]);

  return state;
}

export function useAccessPoint(personId: string | undefined, kind: PlaceKind, accessPointId?: string): AccessPointState {
  const services = useApplicationServices();
  const version = useApplicationVersion();
  const [state, setState] = useState<AccessPointState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    if (!personId || !accessPointId) {
      setState({ status: 'ready', point: null });
      return () => { active = false; };
    }
    services.queries.getAccessPoint(personId, kind, accessPointId)
      .then((point) => active && setState({ status: 'ready', point }))
      .catch(() => active && setState({ status: 'error' }));
    return () => { active = false; };
  }, [services, version, personId, kind, accessPointId]);

  return state;
}
