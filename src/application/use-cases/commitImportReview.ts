import type { CommitImportReviewAction } from '../contracts/actions';
import type { ImportRepository, ScheduleRepository } from '../contracts/repositories';

export class CommitImportReview implements CommitImportReviewAction {
  constructor(
    private readonly imports: ImportRepository,
    private readonly schedules: ScheduleRepository,
  ) {}

  async execute(batchId: string): Promise<void> {
    const batch = await this.imports.getBatch(batchId);
    if (!batch) throw new Error('Import batch was not found.');

    const weekly=batch.structure.weeklyReview;
    if(weekly){
      if(!weekly.confirmed||!weekly.startDate)
        throw new Error('WEEKLY_DATES_NOT_CONFIRMED');
      const start=new Date(weekly.startDate+'T00:00:00Z');
      if(!Number.isFinite(start.getTime())||start.getUTCDay()!==1||
         start.toISOString().slice(0,10)!==weekly.startDate)
        throw new Error('INVALID_WEEKLY_START_DATE');
      for(const item of batch.reviewItems){
        if(item.dayIndex==null||item.dayIndex<0||item.dayIndex>6||
           item.date!==new Date(start.getTime()+item.dayIndex*86400000)
             .toISOString().slice(0,10))
          throw new Error('UNCONFIRMED_WEEKLY_DAY');
      }
    }
    const ignoredDetectedIds = new Set(
      batch.detectedPeople.filter((person) => person.ignored === true).map((person) => person.id),
    );
    const includedItems = batch.reviewItems.filter(
      (item) => !ignoredDetectedIds.has(item.detectedPersonId),
    );
    if (!includedItems.length) {
      throw new Error('IMPORT_HAS_NO_APPROVED_ITEMS');
    }

    if(includedItems.some(item=>item.date==null))
      throw new Error('IMPORT_HAS_UNRESOLVED_DATES');
    const unresolved = includedItems.filter((item) => item.personId == null);
    if (unresolved.length) throw new Error('Import contains unresolved people.');

    const unreviewed = includedItems.filter((item) => item.resolution == null);
    if (unreviewed.length) throw new Error('Import contains unreviewed schedules.');

    const incomplete = includedItems.filter(
      (item) =>
        item.resolution === 'NEW' &&
        item.imported.enabled !== false &&
        (item.imported.start == null || item.imported.end == null),
    );
    if (incomplete.length) throw new Error('Import contains incomplete schedule times.');

    // A non-empty but unreadable break crop is classified INCOMPLETE, not
    // silently dropped. Editing minutes revokes prior approval in both repos.
    const unresolvedRest = includedItems.some(item =>
      item.resolution === 'NEW' && item.imported.enabled !== false &&
      item.breakReviewRequired === true &&
      item.imported.breakMinutes == null,
    );
    if (unresolvedRest) throw new Error('Import contains unreviewed break minutes.');

    const entries = [];
    for (const item of includedItems) {
      if (item.resolution === 'KEEP' || item.resolution === 'SKIP') continue;
      const personId = item.personId;
      if (!personId) continue;
      const date=item.date;
      if(!date)throw new Error('IMPORT_HAS_UNRESOLVED_DATES');
      const current = await this.schedules.getByDate(personId, date);
      const enabled = item.imported.enabled !== false;
      const start = item.imported.start ?? current?.start ?? '00:00';
      const end = item.imported.end ?? current?.end ?? '00:00';
      if (enabled && (!item.imported.start || !item.imported.end)) {
        throw new Error('Import contains incomplete schedule times.');
      }
      entries.push({
        id: current?.id ?? crypto.randomUUID(),
        personId,
        date,
        enabled,
        start,
        end,
        ...(item.imported.breakMinutes !== undefined
          ? { breakMinutes: enabled ? item.imported.breakMinutes : null }
          : current?.breakMinutes !== undefined
            ? { breakMinutes: enabled ? current.breakMinutes : null }
            : {}),
      });
    }
    const uniqueness=new Set<string>();
    for(const entry of entries){
      const key=entry.personId+'|'+entry.date;
      if(uniqueness.has(key))throw new Error('DUPLICATE_IMPORT_PERSON_DATE');
      uniqueness.add(key);
    }
    if (entries.length) {
      await this.schedules.upsertMany(entries);
    }

    await this.imports.markCommitted(batchId);
  }
}
