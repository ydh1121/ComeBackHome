import type { CommitImportReviewAction } from '../contracts/actions';
import type { ImportRepository, ScheduleRepository } from '../contracts/repositories';
export class CommitImportReview implements CommitImportReviewAction {
  constructor(private readonly imports: ImportRepository, private readonly schedules: ScheduleRepository) {}
  async execute(batchId: string): Promise<void> {
    const batch = await this.imports.getBatch(batchId);
    if (!batch) throw new Error('Import batch was not found.');
    for (const item of batch.reviewItems) {
      if (item.resolution === 'KEEP') continue;
      const current = await this.schedules.getByDate(item.personId, item.date);
      await this.schedules.upsert({ id: current?.id ?? crypto.randomUUID(), personId: item.personId, date: item.date, enabled: true, start: item.imported.start, end: item.imported.end });
    }
    await this.imports.markCommitted(batchId);
  }
}
