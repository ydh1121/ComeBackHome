import type { CommitImportReviewAction } from '../contracts/actions';
import type { ApprovedWorkbookImportGateway, ImportRepository, ScheduleRepository } from '../contracts/repositories';
import type { ImportBatch } from '../../domain/models';

export class CommitImportReview implements CommitImportReviewAction {
  constructor(
    private readonly imports: ImportRepository,
    private readonly schedules: ScheduleRepository,
    private readonly approvedWorkbook?: ApprovedWorkbookImportGateway,
  ) {}

  private async commitWorkbook(batch: ImportBatch): Promise<void> {
    if (!this.approvedWorkbook) throw new Error('ATOMIC_WORKBOOK_IMPORT_GATEWAY_REQUIRED');
    const included = batch.detectedPeople.filter(person => !person.ignored);
    if (!included.length) throw new Error('Import contains no included people.');
    const personByRef = new Map(included.map(person => [person.id, person]));
    const rows = batch.reviewItems.filter(item => personByRef.has(item.detectedPersonId));
    if (!rows.length || rows.some(item => item.resolution == null)) {
      throw new Error('Import contains unreviewed schedules.');
    }
    if (included.some(person => !person.pendingCreate && !person.matchedPersonId)) {
      throw new Error('Import contains unresolved people.');
    }
    const unique = new Set<string>();
    for (const item of rows) {
      const person = personByRef.get(item.detectedPersonId)!;
      const key = (person.pendingCreate ? 'draft:'+person.id : person.matchedPersonId) + '|' + item.date;
      if (unique.has(key)) throw new Error('Import contains duplicate person/date.');
      unique.add(key);
      if (item.resolution === 'NEW' && item.imported.enabled !== false &&
          (!item.imported.start || !item.imported.end ||
           (item.recognitionState === 'INCOMPLETE' && item.imported.breakMinutes == null))) {
        throw new Error('Import contains incomplete schedule times.');
      }
    }

    const payload = {
      requestId: batch.id,
      approved: true,
      people: included.map(person => person.pendingCreate
        ? { ref: person.id, kind: 'PENDING_NEW', name: person.sourceName }
        : { ref: person.id, kind: 'EXISTING', personId: person.matchedPersonId }),
      schedules: rows.map(item => ({
        personRef: item.detectedPersonId,
        date: item.date,
        resolution: item.resolution,
        approved: true,
        enabled: item.imported.enabled !== false,
        explicitOff: item.imported.enabled === false && item.resolution === 'NEW',
        start: item.imported.enabled === false ? null : item.imported.start,
        end: item.imported.enabled === false ? null : item.imported.end,
        breakMinutes: item.imported.enabled === false ? null : item.imported.breakMinutes ?? null,
        existing: item.existing
          ? { enabled: item.existing.enabled, start: item.existing.start, end: item.existing.end,
              breakMinutes: item.existing.breakMinutes ?? null }
          : null,
      })),
    };
    // Single server transaction: no client-side people.create/upsertMany.
    const receipt = await this.approvedWorkbook.commit(payload);
    if (receipt.requestId !== batch.id || !receipt.applied) {
      throw new Error('APPROVED_IMPORT_RECEIPT_MISMATCH');
    }
    const selected = rows.filter(item => item.resolution === 'NEW');
    if (receipt.schedules.length !== selected.length) {
      throw new Error('APPROVED_IMPORT_SCHEDULE_COUNT_MISMATCH');
    }
    const mapping = new Map(receipt.people.map(person => [person.ref, person.personId]));
    for (const item of selected) {
      const personId = mapping.get(item.detectedPersonId);
      if (!personId) throw new Error('APPROVED_IMPORT_PERSON_MISSING');
      const saved = await this.schedules.getByDate(personId, item.date);
      if (!saved || saved.enabled !== (item.imported.enabled !== false) ||
          (saved.enabled && (saved.start !== item.imported.start ||
            saved.end !== item.imported.end ||
            (saved.breakMinutes ?? null) !== (item.imported.breakMinutes ?? null)))) {
        throw new Error('APPROVED_IMPORT_PERSISTENCE_READBACK_MISMATCH');
      }
    }
    await this.imports.markCommitted(batch.id);
  }

  async execute(batchId: string): Promise<void> {
    const batch = await this.imports.getBatch(batchId);
    if (!batch) throw new Error('Import batch was not found.');
    if (batch.files.some(file => file.kind === 'XLSX' && file.status === 'READY') &&
        this.approvedWorkbook) {
      await this.commitWorkbook(batch);
      return;
    }

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

    // A non-empty but unreadable break crop is classified INCOMPLETE, not
    // silently dropped. Editing minutes revokes prior approval in both repos.
    const unresolvedRest = includedItems.some(item =>
      item.resolution === 'NEW' && item.imported.enabled !== false &&
      item.recognitionState === 'INCOMPLETE' &&
      item.imported.breakMinutes == null,
    );
    if (unresolvedRest) throw new Error('Import contains unreviewed break minutes.');

    // A workbook can contain multiple detected names mapped to one employee.
    // Abort before D1 writes if review edits or matching produce duplicate keys.
    const uniqueImportedDays=new Set<string>();
    for(const item of includedItems){
      if(item.resolution==='KEEP'||item.resolution==='SKIP')continue;
      const key=item.personId+'|'+item.date;
      if(uniqueImportedDays.has(key)){
        throw new Error('Import contains duplicate person/date.');
      }
      uniqueImportedDays.add(key);
    }

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
        ...(item.imported.breakMinutes !== undefined
          ? { breakMinutes: enabled ? item.imported.breakMinutes : null }
          : current?.breakMinutes !== undefined
            ? { breakMinutes: enabled ? current.breakMinutes : null }
            : {}),
      });
    }
    if (entries.length) {
      await this.schedules.upsertMany(entries);
    }

    await this.imports.markCommitted(batchId);
  }
}
