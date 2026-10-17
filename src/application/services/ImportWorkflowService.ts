import type { EntityId } from '../../domain/common';
import type { ImportResolution } from '../../domain/models';
import type { ImportMatchActions, ImportReviewActions } from '../contracts/actions';
import type { ImportRepository, PersonRepository, ScheduleRepository } from '../contracts/repositories';

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
    private readonly schedules?: ScheduleRepository,
  ) {}

  private async refreshWeeklySnapshots(batchId: EntityId): Promise<void> {
    const batch = await this.imports.getBatch(batchId);
    if (!batch?.structure.weeklyReview || !this.schedules) return;
    const before = JSON.stringify(batch);
    const reviewItems = await Promise.all(batch.reviewItems.map(async item => {
      const existing = item.personId && item.date
        ? await this.schedules!.getByDate(item.personId, item.date) : null;
      return { ...item, resolution: null, existing: existing ? {
        enabled: existing.enabled, start: existing.start, end: existing.end,
        breakMinutes: existing.breakMinutes ?? null,
      } : undefined };
    }));
    // Never replace a newer user edit with an earlier asynchronous read.
    if (JSON.stringify(await this.imports.getBatch(batchId)) !== before) {
      throw new Error('검토 내용이 바뀌었습니다. 날짜를 다시 확인해 주세요.');
    }
    await this.imports.replaceParsedResult(batchId, { ...batch, reviewItems });
  }

  async setPendingPersonCreate(batchId: EntityId, detectedPersonId: EntityId, pending: boolean): Promise<void> {
    return this.imports.setPendingPersonCreate(batchId, detectedPersonId, pending);
  }

  async addManualPerson(batchId:EntityId,personId:EntityId):Promise<void> {
    const person=await this.people.get(personId);
    if(!person)throw new Error('MANUAL_PERSON_NOT_FOUND');
    await this.imports.addManualPerson(batchId,person.id,person.name);
    const start = (await this.imports.getBatch(batchId))?.structure.weeklyReview?.startDate;
    if (start) await this.imports.setWeeklyStartDate(batchId, start);
  }

  setWeeklyStartDate(batchId:EntityId,startDate:string):Promise<void> {
    return this.imports.setWeeklyStartDate(batchId,startDate);
  }

  async confirmWeeklyDates(batchId:EntityId):Promise<void> {
    await this.refreshWeeklySnapshots(batchId);
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
    await this.refreshWeeklySnapshots(batchId);
  }

  setPendingNewPerson(batchId:EntityId,detectedPersonId:EntityId,name:string):Promise<void> {
    return this.imports.setPendingNewPerson(batchId,detectedPersonId,name);
  }

  async setPersonMatch(
    batchId: EntityId,
    detectedPersonId: EntityId,
    personId: EntityId | null,
  ): Promise<void> {
    await this.imports.setDetectedPersonIgnored(batchId, detectedPersonId, false);
    await this.imports.setDetectedPersonMatch(batchId, detectedPersonId, personId);
    await this.refreshWeeklySnapshots(batchId);
  }

  async setPersonIgnored(
    batchId: EntityId,
    detectedPersonId: EntityId,
    ignored: boolean,
  ): Promise<void> {
    await this.imports.setDetectedPersonIgnored(batchId, detectedPersonId, ignored);
  }

  setImportedDate(batchId: EntityId, reviewItemId: EntityId, date: string): Promise<void> {
    return this.imports.setImportedDate(batchId, reviewItemId, date);
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
