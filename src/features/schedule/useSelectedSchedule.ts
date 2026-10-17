import { useEffect, useState } from 'react';
import { useApplicationServices, useApplicationVersion } from '../../app/ApplicationServicesContext';
import type { ScheduleEntry } from '../../domain/models';
import { sortSchedule } from './date-format';

export type ScheduleLoadState =
  | { status: 'loading' }
  | { status: 'ready'; personId: string | null; entries: ScheduleEntry[] }
  | { status: 'error' };

export function useSelectedSchedule(): ScheduleLoadState {
  const services = useApplicationServices();
  const version = useApplicationVersion();
  const [state, setState] = useState<ScheduleLoadState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    const personId = services.actions.personSelection.getSelectedPersonId();
    if (!personId) {
      setState({ status: 'ready', personId: null, entries: [] });
      return () => { active = false; };
    }

    services.queries.listSchedule(personId)
      .then((entries) => {
        if (active) setState({ status: 'ready', personId, entries: sortSchedule(entries) });
      })
      .catch(() => {
        if (active) setState({ status: 'error' });
      });

    return () => { active = false; };
  }, [services, version]);

  // A selection change must not expose the previous employee's ready data
  // while its asynchronous list request is being replaced.
  if (state.status === 'ready' &&
      state.personId !== services.actions.personSelection.getSelectedPersonId()) {
    return { status: 'loading' };
  }
  return state;
}
