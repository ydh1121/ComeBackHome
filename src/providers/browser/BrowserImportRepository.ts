import type { EntityId } from '../../domain/common';
import type {
  ImportBatch,
  ImportFileRecord,
  ImportResolution,
} from '../../domain/models';
import type { ImportRepository } from '../../application/contracts/repositories';

const STORAGE_KEY = 'cbh:import-batches:v2';
const LEGACY_STORAGE_KEYS = ['cbh:import-batches:v1'];

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
    for (const legacyKey of LEGACY_STORAGE_KEYS) localStorage.removeItem(legacyKey);
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
    const current = [...this.state.batches].reverse().find((batch) => !batch.committed) ?? null;
    return clone(current);
  }

  async getBatch(batchId: EntityId): Promise<ImportBatch | null> {
    return clone(this.state.batches.find((batch) => batch.id === batchId) ?? null);
  }

  async createBatch(): Promise<ImportBatch> {
    // A new file selection starts a new draft. Keeping an older unfinished
    // draft as "current" caused subsequent uploads to surface stale OCR data
    // until localStorage was manually cleared.
    this.state.batches = [];
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

  async addManualPerson(batchId:EntityId,personId:EntityId,name:string):Promise<void> {
    const batch=this.requireBatch(batchId);
    if(batch.structure.weeklyReview?.status!=='MANUAL_RECOVERY_REQUIRED')
      throw new Error('MANUAL_RECOVERY_NOT_ACTIVE');
    if(batch.detectedPeople.some(person=>person.matchedPersonId===personId))
      throw new Error('MANUAL_PERSON_ALREADY_INCLUDED');
    const id=crypto.randomUUID();
    batch.detectedPeople.push({
      id,sourceName:name,matchedPersonId:personId,confidence:0,ignored:false,
    });
    for(let dayIndex=0;dayIndex<7;dayIndex++){
      batch.reviewItems.push({
        id:crypto.randomUUID(),detectedPersonId:id,personId,
        date:null,dayIndex,imported:{enabled:true,start:null,end:null,breakMinutes:null},
        recognitionState:'UNREADABLE',resolution:null,
      });
    }
    this.persist();
  }

  async setWeeklyStartDate(batchId:EntityId,startDate:string):Promise<void> {
    const batch=this.requireBatch(batchId);
    const weekly=batch.structure.weeklyReview;
    if(!weekly)throw new Error('WEEKLY_DATE_REVIEW_NOT_ACTIVE');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate))
      throw new Error('INVALID_WEEK_START_DATE');
    const date=new Date(startDate+'T00:00:00Z');
    if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==startDate||
       date.getUTCDay()!==1)throw new Error('WEEK_START_MUST_BE_MONDAY');
    const monday=date.getTime();
    for(const item of batch.reviewItems){
      if(item.dayIndex==null||item.dayIndex<0||item.dayIndex>6)
        throw new Error('MISSING_WEEKDAY_OWNERSHIP');
      item.date=new Date(monday+item.dayIndex*86400000).toISOString().slice(0,10);
      // Previously loaded schedule and previous approval never survive
      // changing the calendar origin.
      item.existing=undefined;
      item.resolution=null;
    }
    weekly.startDate=startDate;
    weekly.confirmed=false;
    this.persist();
  }

  async confirmWeeklyDates(batchId:EntityId):Promise<void> {
    const batch=this.requireBatch(batchId);
    const weekly=batch.structure.weeklyReview;
    if(!weekly?.startDate)throw new Error('WEEKLY_START_DATE_REQUIRED');
    const monday=new Date(weekly.startDate+'T00:00:00Z');
    if(!Number.isFinite(monday.getTime())||monday.toISOString().slice(0,10)!==
        weekly.startDate||monday.getUTCDay()!==1)
      throw new Error('WEEKLY_START_DATE_INVALID');
    for(const item of batch.reviewItems){
      if(item.dayIndex==null||item.dayIndex<0||item.dayIndex>6)
        throw new Error('MISSING_WEEKDAY_OWNERSHIP');
      const expected=new Date(monday.getTime()+item.dayIndex*86400000)
        .toISOString().slice(0,10);
      if(item.date!==expected)throw new Error('WEEKLY_DATE_CONFLICT');
      item.resolution=null;
    }
    weekly.confirmed=true;
    this.persist();
  }

  async setPendingNewPerson(batchId:EntityId,detectedPersonId:EntityId,proposedName:string):Promise<void> {
    const batch=this.requireBatch(batchId);
    if(!batch.structure.weeklyReview)throw new Error('NEW_PERSON_REVIEW_NOT_ACTIVE');
    const name=proposedName.normalize('NFKC').trim();
    if(!/^[가-힣]{2,5}$/.test(name))throw new Error('INVALID_NEW_PERSON_NAME');
    const detected=batch.detectedPeople.find(p=>p.id===detectedPersonId);
    if(!detected)throw new Error('Detected person was not found.');
    detected.pendingCreateName=name;
    detected.matchedPersonId=null;
    detected.ignored=false;
    for(const item of batch.reviewItems){
      if(item.detectedPersonId!==detectedPersonId)continue;
      item.personId=null;
      item.resolution=null;
    }
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
    person.pendingCreateName = undefined;
    for (const item of batch.reviewItems) {
      if (item.detectedPersonId !== detectedPersonId) continue;
      item.personId = personId;
      if (personId && item.resolution == null &&
          batch.structure.sheet !== 'weekly 7 day x start/end/break physical matrix') {
        item.resolution = 'NEW';
      }
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
    if (ignored) { person.matchedPersonId = null; person.pendingCreateName=undefined; }
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

  async setImportedEnabled(
    batchId: EntityId,
    reviewItemId: EntityId,
    enabled: boolean,
  ): Promise<void> {
    const item = this.requireReviewItem(batchId, reviewItemId);
    item.imported.enabled = enabled;
    if (!enabled) {
      item.imported.start = null;
      item.imported.end = null;
      item.imported.breakMinutes = null;
    }
    // Switching work/off reopens explicit approval, never silently persists.
    item.resolution = null;
    this.persist();
  }

  async setImportedBreakMinutes(batchId: EntityId, reviewItemId: EntityId, minutes: number | null): Promise<void> {
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 0 || minutes > 720)) {
      throw new Error('INVALID_BREAK_MINUTES');
    }
    const item = this.requireReviewItem(batchId, reviewItemId);
    if (item.imported.breakMinutes === minutes) return;
    item.imported.breakMinutes = minutes;
    item.resolution = null;
    this.persist();
  }

  async setImportedTime(
    batchId: EntityId,
    reviewItemId: EntityId,
    field: 'start' | 'end',
    value: string | null,
  ): Promise<void> {
    const batch = this.requireBatch(batchId);
    const item = this.requireReviewItem(batchId, reviewItemId);
    if (item.imported[field] !== value) {
      item.imported[field] = value;
      // Weekly image OCR requires fresh approval after *any* time edit.
      // Existing workbook review semantics are left unchanged.
      if (batch.structure.sheet === 'weekly 7 day x start/end/break physical matrix') {
        item.resolution = null;
      }
      this.persist();
    }
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
