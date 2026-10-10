import type {
  ImportFileSelectionAction,
  ImportInputFile,
} from '../contracts/actions';
import type { ImageScheduleRecognizer, WorkbookParser } from '../contracts/providers';
import type {
  ImportRepository,
  PersonRepository,
  ScheduleRepository,
} from '../contracts/repositories';
import type {
  DetectedImportPerson,
  ImportFileRecord,
  ImportReviewItem,
} from '../../domain/models';

// Object URLs stay in browser memory only. Never persist roster images
// to localStorage, send them to backend or include them in CI artifacts.
const privateImageUrls=new Map<string,string>();
export function getPrivateImportImageUrl(batchId:string):string|null {
  return privateImageUrls.get(batchId)??null;
}

function normalizeName(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, '');
}

export class WorkbookImportFileSelectionAction implements ImportFileSelectionAction {
  constructor(
    private readonly imports: ImportRepository,
    private readonly people: PersonRepository,
    private readonly schedules: ScheduleRepository,
    private readonly parser: WorkbookParser,
    private readonly imageRecognizer?: ImageScheduleRecognizer,
  ) {}

  async accept(files: ImportInputFile[]): Promise<string> {
    if (!files.length) throw new Error('No import files were selected.');

    const batch = await this.imports.createBatch();
    for(const url of privateImageUrls.values())URL.revokeObjectURL(url);
    privateImageUrls.clear();
    const firstImage=files.find(item=>item.kind==='IMAGE');
    if(firstImage && firstImage.file instanceof Blob && typeof URL.createObjectURL==='function')
      privateImageUrls.set(batch.id,URL.createObjectURL(firstImage.file));
    const initialRecords: ImportFileRecord[] = files.map(({ kind, file }) => {
      const supported = kind === 'WORKBOOK' || this.imageRecognizer != null;
      return {
        id: crypto.randomUUID(),
        name: file.name,
        kind: kind === 'WORKBOOK' ? 'XLSX' : 'IMAGE',
        progress: supported ? 5 : 100,
        status: supported ? 'PARSING' : 'ERROR',
      };
    });
    await this.imports.replaceFiles(batch.id, initialRecords);

    const parsedResults = [];
    const completedRecords = [...initialRecords];
    const updateProgress = async (index: number, progress: number) => {
      const current = completedRecords[index];
      if (!current || current.status !== 'PARSING') return;
      completedRecords[index] = {
        ...current,
        progress: Math.max(current.progress, Math.min(95, Math.round(progress))),
      };
      await this.imports.replaceFiles(batch.id, completedRecords);
    };

    for (let index = 0; index < files.length; index += 1) {
      const input = files[index];
      const recognizer = input.kind === 'WORKBOOK' ? this.parser : this.imageRecognizer;
      if (!recognizer) continue;

      try {
        await updateProgress(index, 12);
        const parsed = input.kind === 'WORKBOOK'
          ? await (async () => {
              const data = await input.file.arrayBuffer();
              await updateProgress(index, 55);
              return this.parser.parse(data);
            })()
          : await this.imageRecognizer!.parse(
              input.file,
              (progress) => updateProgress(index, progress),
            );
        parsedResults.push(parsed);
        completedRecords[index] = {
          ...completedRecords[index],
          progress: 100,
          status: 'READY',
        };
      } catch (error) {
        completedRecords[index] = {
          ...completedRecords[index],
          progress: 100,
          status: 'ERROR',
          message: error instanceof Error ? error.message : '이미지 인식 중 알 수 없는 오류가 발생했습니다.',
        };
      }
    }

    await this.imports.replaceFiles(batch.id, completedRecords);

    if (!parsedResults.length) {
      const detail = completedRecords.find((record) => record.status === 'ERROR' && record.message)?.message;
      throw new Error(
        detail
          ? '일정을 인식하지 못했습니다. ' + detail
          : '선택한 파일에서 일정을 인식하지 못했습니다. 다른 이미지 또는 1일 일정 추가를 이용해 주세요.'
      );
    }

    const availablePeople = await this.people.list();
    const peopleByName = new Map(
      availablePeople.map((person) => [normalizeName(person.name), person]),
    );

    const weeklyRequiresPerCellApproval = parsedResults.some(
      (parsed) => parsed.structure.sheet === 'weekly 7 day x start/end/break physical matrix',
    );
    const detectedByName = new Map<string, DetectedImportPerson>();
    for (const parsed of parsedResults) {
      for (const person of parsed.detectedPeople) {
        const key = normalizeName(person.sourceName);
        const existing = detectedByName.get(key);
        const matched = peopleByName.get(key);
        if (!existing) {
          detectedByName.set(key, {
            id: crypto.randomUUID(),
            sourceName: person.sourceName,
            matchedPersonId: matched?.id ?? null,
            confidence: person.confidence,
            // Unlike legacy imports, a weekly OCR row with no DB match
            // must stay visible and block continuation until manually mapped.
            ignored: weeklyRequiresPerCellApproval ? false : !matched,
          });
        } else {
          existing.confidence = Math.max(existing.confidence, person.confidence);
          if (!existing.matchedPersonId && matched) {
            existing.matchedPersonId = matched.id;
            existing.ignored = false;
          }
        }
      }
    }

    const candidateByKey = new Map<string, {
      detectedPersonId: string;
      personId: string | null;
      date: string | null;
      dayIndex?: number;
      enabled: boolean;
      start: string | null;
      end: string | null;
      breakMinutes?: number | null;
      confidence: number;
      recognitionState: 'WORK' | 'INCOMPLETE' | 'OFF' | 'OFF_CANDIDATE' | 'UNREADABLE';
      breakReviewRequired?: boolean;
    }>();
    let duplicateCandidate = false;

    const registerCandidate = (candidate: {
      sourcePersonName: string;
      date: string | null;
      dayIndex?: number;
      start: string | null;
      end: string | null;
      breakMinutes?: number | null;
      confidence: number;
      enabled?: boolean;
      recognitionState?: 'WORK' | 'INCOMPLETE' | 'OFF' | 'OFF_CANDIDATE' | 'UNREADABLE';
      breakReviewRequired?: boolean;
    }) => {
      const detected = detectedByName.get(normalizeName(candidate.sourcePersonName));
      if (!detected) return;

      const key = normalizeName(candidate.sourcePersonName) + '|' +
        (weeklyRequiresPerCellApproval && candidate.dayIndex!=null
          ? 'day:'+candidate.dayIndex : candidate.date);
      const next = {
        detectedPersonId: detected.id,
        personId: detected.matchedPersonId,
        date: candidate.date,
        ...(candidate.dayIndex!=null?{dayIndex:candidate.dayIndex}:{}),
        enabled: candidate.enabled ?? true,
        start: candidate.start,
        end: candidate.end,
        ...(candidate.breakMinutes !== undefined ? {breakMinutes:candidate.breakMinutes}:{}),
        confidence: candidate.confidence,
        ...(candidate.breakReviewRequired?{breakReviewRequired:true}:{}),
        recognitionState:
          candidate.recognitionState ??
          (candidate.start && candidate.end ? 'WORK' : 'INCOMPLETE'),
      };
      const existing = candidateByKey.get(key);
      if (!existing) {
        candidateByKey.set(key, next);
        return;
      }

      duplicateCandidate = true;
      const statePriority = {
        WORK: 4,
        INCOMPLETE: 3,
        UNREADABLE: 2,
        OFF_CANDIDATE: 2,
        OFF: 1,
      } as const;
      const existingPriority = statePriority[existing.recognitionState];
      const nextPriority = statePriority[next.recognitionState];
      const existingEvidence = Number(existing.start != null) + Number(existing.end != null);
      const nextEvidence = Number(next.start != null) + Number(next.end != null);

      if (
        nextPriority > existingPriority ||
        (
          nextPriority === existingPriority &&
          (
            nextEvidence > existingEvidence ||
            (nextEvidence === existingEvidence && next.confidence > existing.confidence)
          )
        )
      ) {
        candidateByKey.set(key, next);
      }
    };

    for (const parsed of parsedResults) {
      for (const candidate of parsed.scheduleCandidates) {
        registerCandidate({
          ...candidate,
          enabled: true,
          recognitionState: 'WORK',
        });
      }
      for (const candidate of parsed.reviewCandidates ?? []) {
        registerCandidate({
          ...candidate,
          enabled: candidate.enabled ?? true,
          recognitionState:
            candidate.recognitionState ??
            (candidate.start || candidate.end ? 'INCOMPLETE' : 'UNREADABLE'),
        });
      }
    }

    // The store-specific weekly OCR is review-first. Even a successfully
    // matched DB person does not constitute approval of every WORK/OFF date.
    const reviewItems: ImportReviewItem[] = [];
    for (const candidate of candidateByKey.values()) {
      const existing = candidate.personId && candidate.date
        ? await this.schedules.getByDate(candidate.personId, candidate.date)
        : null;
      const exactDuplicate = Boolean(
        existing &&
        (
          (!candidate.enabled && existing.enabled === false) ||
          (
            candidate.enabled &&
            existing.enabled !== false &&
            candidate.start != null &&
            candidate.end != null &&
            existing.start === candidate.start &&
            existing.end === candidate.end &&
            (!weeklyRequiresPerCellApproval ||
             (existing.breakMinutes ?? null) === (candidate.breakMinutes ?? null))
          )
        )
      );
      reviewItems.push({
        id: crypto.randomUUID(),
        detectedPersonId: candidate.detectedPersonId,
        personId: candidate.personId,
        date: candidate.date,
        ...(candidate.dayIndex!=null?{dayIndex:candidate.dayIndex}:{}),
        ...(existing ? { existing: { enabled: existing.enabled, start: existing.start, end: existing.end,
          breakMinutes: existing.breakMinutes ?? null } } : {}),
        imported: {
          enabled: candidate.enabled,
          start: candidate.start,
          end: candidate.end,
          ...(candidate.breakMinutes !== undefined ? {breakMinutes:candidate.breakMinutes}:{}),
        },
        recognitionState: candidate.recognitionState,
        ...(candidate.breakReviewRequired?{breakReviewRequired:true}:{}),
        // Weekly OCR requires an explicit decision even when a generated
        // OCR candidate happens to equal the already-stored schedule.
        resolution: weeklyRequiresPerCellApproval ? null :
          exactDuplicate ? 'SKIP' : candidate.personId ? 'NEW' : null,
      });
    }

    const first = parsedResults[0];
    const confidence = parsedResults.reduce((sum, parsed) => sum + parsed.confidence, 0) / parsedResults.length;

    await this.imports.replaceParsedResult(batch.id, {
      detectedPeople: [...detectedByName.values()],
      structure: {
        ...first.structure,
        // A weekly image never commits itself, including when every
        // recognized calendar glyph is consistent.
        ...(weeklyRequiresPerCellApproval && first.structure.weeklyReview
          ? {weeklyReview:{...first.structure.weeklyReview,confirmed:false}}
          : {}),
        needsReview:
          first.structure.needsReview ||
          parsedResults.length > 1 ||
          duplicateCandidate ||
          confidence < 0.95,
      },
      reviewItems,
    });

    return batch.id;
  }
}
