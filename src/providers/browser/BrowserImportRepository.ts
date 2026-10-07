import type { EntityId } from '../../domain/common';
import type {
  ImportBatch,
  ImportFileRecord,
  ImportResolution,
} from '../../domain/models';
import type { ImportRepository } from '../../application/contracts/repositories';

const STORAGE_KEY = 'cbh:import-batches:v1';

interface BrowserImportState {
  batches: ImportBatch[];
}

function emptyState(): BrowserImportState {
  return { batches: [] };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function readState(): BrowserImportState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<BrowserImportState>;
    return {
      batches: Array.isArray(parsed.batches) ? parsed.batches : [],
    };
  } catch {
    return emptyState();
  }
}

function writeState(state: BrowserImportState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Import review persistence is best-effort; the current in-memory mutation
    // still completes through the same call stack.
  }
}

export class BrowserImportRepository implements ImportRepository {
  private state = readState();

  constructor(private readonly onChange: () => void = () => undefined) {}

  private persist(): void {
    writeState(this.state);
    this.onChange();
  }

  async getCurrentBatch(): Promise<ImportBatch | null> {
    return clone(this.state.batches.find((batch) => !batch.committed) ?? null);
  }

  async getBatch(batchId: EntityId): Promise<ImportBatch | null> {
    return clone(this.state.batches.find((batch) => batch.id === batchId) ?? null);
  }

  async createBatch(): Promise<ImportBatch> {
    const batch: ImportBatch = {
      id: crypto.randomUUID(),
      files: [],
      detectedPeople: [],
      structure: {
        sheet: '',
        headerRow: 0,
        personColumn: '',
        dateColumn: '',
        shiftColumn: '',
        needsReview: true,
      },
      reviewItems: [],
      committed: false,
    };
    this.state.batches.push(batch);
    this.persist();
    return clone(batch);
  }

  async replaceFiles(batchId: EntityId, files: ImportFileRecord[]): Promise<void> {
    const batch = this.requireBatch(batchId);
    batch.files = clone(files);
    this.persist();
  }

  async replaceParsedResult(
    batchId: EntityId,
    result: Pick<ImportBatch, 'detectedPeople' | 'structure' | 'reviewItems'>,
  ): Promise<void> {
    const batch = this.requireBatch(batchId);
    batch.detectedPeople = clone(result.detectedPeople);
    batch.structure = clone(result.structure);
    batch.reviewItems = clone(result.reviewItems);
    batch.committed = false;
    this.persist();
  }

  async setDetectedPersonMatch(
    batchId: EntityId,
    detectedPersonId: EntityId,
    personId: EntityId | null,
  ): Promise<void> {
    const batch = this.requireBatch(batchId);
    const person = batch.detectedPeople.find((candidate) => candidate.id === detectedPersonId);
    if (!person) throw new Error('Detected person was not found.');
    person.matchedPersonId = personId;
    for (const item of batch.reviewItems) {
      if (item.detectedPersonId === detectedPersonId) item.personId = personId;
    }
    this.persist();
  }

  async setDetectedPersonIgnored(
    batchId: EntityId,
    detectedPersonId: EntityId,
    ignored: boolean,
  ): Promise<void> {
    const batch = this.requireBatch(batchId);
    const person = batch.detectedPeople.find((candidate) => candidate.id === detectedPersonId);
    if (!person) throw new Error('Detected person was not found.');
    person.ignored = ignored;
    if (ignored) person.matchedPersonId = null;
    for (const item of batch.reviewItems) {
      if (item.detectedPersonId !== detectedPersonId) continue;
      if (ignored) {
        item.personId = null;
        item.resolution = null;
      }
    }
    this.persist();
  }

  async setResolution(
    batchId: EntityId,
    reviewItemId: EntityId,
    resolution: ImportResolution,
  ): Promise<void> {
    const item = this.requireReviewItem(batchId, reviewItemId);
    item.resolution = resolution;
    this.persist();
  }

  async setImportedTime(
    batchId: EntityId,
    reviewItemId: EntityId,
    field: 'start' | 'end',
    value: string | null,
  ): Promise<void> {
    const item = this.requireReviewItem(batchId, reviewItemId);
    item.imported[field] = value;
    this.persist();
  }

  async markCommitted(batchId: EntityId): Promise<void> {
    const batch = this.requireBatch(batchId);
    batch.committed = true;
    this.state.batches = this.state.batches.slice(-10);
    this.persist();
  }

  private requireBatch(batchId: EntityId): ImportBatch {
    const batch = this.state.batches.find((candidate) => candidate.id === batchId);
    if (!batch) throw new Error('Import batch was not found.');
    return batch;
  }

  private requireReviewItem(batchId: EntityId, reviewItemId: EntityId) {
    const item = this.requireBatch(batchId).reviewItems.find((candidate) => candidate.id === reviewItemId);
    if (!item) throw new Error('Import review item was not found.');
    return item;
  }
}
