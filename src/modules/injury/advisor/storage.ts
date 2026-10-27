import { privateRequest } from '../../auth/client';
import type { CasePayload, CaseRecord } from '../domain/records';

export const saveAdvisorRecord = async (id: string, revision: number, payload: CasePayload) =>
  (await privateRequest<{ record: CaseRecord }>('private/case/records/' + id, 'PUT', { kind: 'content', revision, payload })).record;

export const latestAdvisorRecord = (id: string) =>
  privateRequest<{ record: CaseRecord }>('private/case/records/' + id).then(r => r.record).catch(() => null);
