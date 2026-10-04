import { useEffect, useState } from 'react';
import { useApplicationServices, useApplicationVersion } from '../../app/ApplicationServicesContext';
import type { ScheduleEntry } from '../../domain/models';
import { sortSchedule } from './date-format';

export type ScheduleLoadState =
  | { status: 'loading' }
  | { status: 'ready'; entries: ScheduleEntry[] }
  | { status: 'error' };

export function useSelectedSchedule(): ScheduleLoadState {
  const services = useApplicationServices();
  const version = useApplicationVersion();
  const [state, setState] = useState<ScheduleLoadState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    const personId = services.actions.personSelection.getSelectedPersonId();
    if (!personId) {
      setState({ status: 'ready', entries: [] });
      return () => { active = false; };
    }

    services.queries.listSchedule(personId)
      .then((entries) => {
        if (active) setState({ status: 'ready', entries: sortSchedule(entries) });
      })
      .catch(() => {
        if (active) setState({ status: 'error' });
      });

    return () => { active = false; };
  }, [services, version]);

  return state;
}
