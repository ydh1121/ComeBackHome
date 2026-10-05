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

    const unresolved = batch.reviewItems.filter((item) => item.personId == null);
    if (unresolved.length) throw new Error('Import contains unresolved people.');

    const entries = [];
    for (const item of batch.reviewItems) {
      if (item.resolution === 'KEEP') continue;
      const personId = item.personId;
      if (!personId) continue;
      const current = await this.schedules.getByDate(personId, item.date);
      entries.push({
        id: current?.id ?? crypto.randomUUID(),
        personId,
        date: item.date,
        enabled: true,
        start: item.imported.start,
        end: item.imported.end,
      });
    }
    await this.schedules.upsertMany(entries);

    await this.imports.markCommitted(batchId);
  }
}
