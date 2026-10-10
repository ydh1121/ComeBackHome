import type { EntityId } from '../../domain/common';
import type { ImportResolution } from '../../domain/models';
import type { ImportMatchActions, ImportReviewActions } from '../contracts/actions';
import type { ImportRepository, PersonRepository } from '../contracts/repositories';

function normalizeImportedTime(value: string | null): string | null {
  if (value == null || value === '') return null;
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(value);
  if (!match) throw new Error('Imported time is invalid.');
  const hour = Number(match[1]);
  if (hour > 23) throw new Error('Imported time is invalid.');
  return String(hour).padStart(2, '0') + ':' + match[2];
}

export class ImportWorkflowService implements ImportMatchActions, ImportReviewActions {
  constructor(
    private readonly imports: ImportRepository,
    private readonly people: PersonRepository,
  ) {}

  async addManualPerson(batchId:EntityId,personId:EntityId):Promise<void> {
    const person=await this.people.get(personId);
    if(!person)throw new Error('MANUAL_PERSON_NOT_FOUND');
    return this.imports.addManualPerson(batchId,person.id,person.name);
  }

  setWeeklyStartDate(batchId:EntityId,startDate:string):Promise<void> {
    return this.imports.setWeeklyStartDate(batchId,startDate);
  }

  confirmWeeklyDates(batchId:EntityId):Promise<void> {
    return this.imports.confirmWeeklyDates(batchId);
  }

  async cyclePersonMatch(batchId: EntityId, detectedPersonId: EntityId): Promise<void> {
    const batch = await this.imports.getBatch(batchId);
    if (!batch) throw new Error('Import batch was not found.');

    const detected = batch.detectedPeople.find((item) => item.id === detectedPersonId);
    if (!detected) throw new Error('Detected person was not found.');

    const people = await this.people.list();
    const options: Array<EntityId | null> = [null, ...people.map((person) => person.id)];
    const index = options.findIndex((personId) => personId === detected.matchedPersonId);
    const next = options[(index + 1 + options.length) % options.length] ?? null;
    await this.imports.setDetectedPersonIgnored(batchId, detectedPersonId, false);
    await this.imports.setDetectedPersonMatch(batchId, detectedPersonId, next);
  }

  async setPersonMatch(
    batchId: EntityId,
    detectedPersonId: EntityId,
    personId: EntityId | null,
  ): Promise<void> {
    await this.imports.setDetectedPersonIgnored(batchId, detectedPersonId, false);
    await this.imports.setDetectedPersonMatch(batchId, detectedPersonId, personId);
  }

  async setPersonIgnored(
    batchId: EntityId,
    detectedPersonId: EntityId,
    ignored: boolean,
  ): Promise<void> {
    await this.imports.setDetectedPersonIgnored(batchId, detectedPersonId, ignored);
  }

  setResolution(batchId: EntityId, reviewItemId: EntityId, resolution: ImportResolution): Promise<void> {
    return this.imports.setResolution(batchId, reviewItemId, resolution);
  }

  setImportedBreakMinutes(
    batchId: EntityId,
    reviewItemId: EntityId,
    minutes: number | null,
  ): Promise<void> {
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 0 || minutes > 720)) {
      throw new Error('INVALID_BREAK_MINUTES');
    }
    return this.imports.setImportedBreakMinutes(batchId, reviewItemId, minutes);
  }

  setImportedEnabled(
    batchId: EntityId,
    reviewItemId: EntityId,
    enabled: boolean,
  ): Promise<void> {
    return this.imports.setImportedEnabled(batchId, reviewItemId, enabled);
  }

  setImportedTime(
    batchId: EntityId,
    reviewItemId: EntityId,
    field: 'start' | 'end',
    value: string | null,
  ): Promise<void> {
    return this.imports.setImportedTime(
      batchId,
      reviewItemId,
      field,
      normalizeImportedTime(value),
    );
  }
}
