import { useEffect, useState } from 'react';
import { useApplicationServices, useApplicationVersion } from '../../app/ApplicationServicesContext';
import type { Person } from '../../domain/models';
import type { PersonDetailQueryResult } from '../../application/queries/ComeBackHomeQueries';

export type PeopleListState =
  | { status: 'loading' }
  | { status: 'ready'; people: Person[] }
  | { status: 'error' };

export type PersonState =
  | { status: 'loading' }
  | { status: 'ready'; person: Person | null }
  | { status: 'error' };

export type PersonDetailState =
  | { status: 'loading' }
  | { status: 'ready'; detail: PersonDetailQueryResult }
  | { status: 'error' };

export function usePeopleList(): PeopleListState {
  const services = useApplicationServices();
  const version = useApplicationVersion();
  const [state, setState] = useState<PeopleListState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    services.queries.listPeople()
      .then((people) => active && setState({ status: 'ready', people }))
      .catch(() => active && setState({ status: 'error' }));
    return () => { active = false; };
  }, [services, version]);

  return state;
}

export function usePerson(personId?: string): PersonState {
  const services = useApplicationServices();
  const version = useApplicationVersion();
  const [state, setState] = useState<PersonState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    if (!personId) {
      setState({ status: 'ready', person: null });
      return () => { active = false; };
    }
    services.queries.getPerson(personId)
      .then((person) => active && setState({ status: 'ready', person }))
      .catch(() => active && setState({ status: 'error' }));
    return () => { active = false; };
  }, [services, version, personId]);

  return state;
}

export function usePersonDetail(personId?: string): PersonDetailState {
  const services = useApplicationServices();
  const version = useApplicationVersion();
  const [state, setState] = useState<PersonDetailState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    if (!personId) {
      setState({ status: 'error' });
      return () => { active = false; };
    }
    services.queries.getPersonDetail(personId)
      .then((detail) => active && setState({ status: 'ready', detail }))
      .catch(() => active && setState({ status: 'error' }));
    return () => { active = false; };
  }, [services, version, personId]);

  return state;
}
