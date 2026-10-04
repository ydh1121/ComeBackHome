import { useEffect, useState } from 'react';
import { useApplicationServices, useApplicationVersion } from '../../app/ApplicationServicesContext';
import type { ImportBatch, Person } from '../../domain/models';

export type ImportWorkflowLoadState =
  | { status: 'loading' }
  | { status: 'ready'; batch: ImportBatch | null; people: Person[] }
  | { status: 'error' };

export function useImportWorkflow(batchId?: string): ImportWorkflowLoadState {
  const services = useApplicationServices();
  const version = useApplicationVersion();
  const [state, setState] = useState<ImportWorkflowLoadState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    const batchPromise = batchId
      ? services.queries.getImportReview(batchId)
      : services.queries.getCurrentImportBatch();

    Promise.all([batchPromise, services.queries.listPeople()])
      .then(([batch, people]) => {
        if (active) setState({ status: 'ready', batch, people });
      })
      .catch(() => {
        if (active) setState({ status: 'error' });
      });

    return () => { active = false; };
  }, [services, version, batchId]);

  return state;
}
