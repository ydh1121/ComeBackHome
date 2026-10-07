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

    const ignoredDetectedIds = new Set(
      batch.detectedPeople.filter((person) => person.ignored === true).map((person) => person.id),
    );
    const includedItems = batch.reviewItems.filter(
      (item) => !ignoredDetectedIds.has(item.detectedPersonId),
    );
    if (!includedItems.length) {
      await this.imports.markCommitted(batchId);
      return;
    }

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

    const entries = [];
    for (const item of includedItems) {
      if (item.resolution === 'KEEP' || item.resolution === 'SKIP') continue;
      const personId = item.personId;
      if (!personId) continue;
      const current = await this.schedules.getByDate(personId, item.date);
      const enabled = item.imported.enabled !== false;
      const start = item.imported.start ?? current?.start ?? '00:00';
      const end = item.imported.end ?? current?.end ?? '00:00';
      if (enabled && (!item.imported.start || !item.imported.end)) {
        throw new Error('Import contains incomplete schedule times.');
      }
      entries.push({
        id: current?.id ?? crypto.randomUUID(),
        personId,
        date: item.date,
        enabled,
        start,
        end,
      });
    }
    if (entries.length) {
      await this.schedules.upsertMany(entries);
    }

    await this.imports.markCommitted(batchId);
  }
}
