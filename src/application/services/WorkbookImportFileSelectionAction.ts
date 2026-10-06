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

    const batch = (await this.imports.getCurrentBatch()) ?? await this.imports.createBatch();
    const initialRecords: ImportFileRecord[] = files.map(({ kind, file }) => {
      const supported = kind === 'WORKBOOK' || this.imageRecognizer != null;
      return {
        id: crypto.randomUUID(),
        name: file.name,
        kind: kind === 'WORKBOOK' ? 'XLSX' : 'IMAGE',
        progress: supported ? 10 : 100,
        status: supported ? 'PARSING' : 'ERROR',
      };
    });
    await this.imports.replaceFiles(batch.id, initialRecords);

    const parsedResults = [];
    const completedRecords = [...initialRecords];

    for (let index = 0; index < files.length; index += 1) {
      const input = files[index];
      const recognizer = input.kind === 'WORKBOOK' ? this.parser : this.imageRecognizer;
      if (!recognizer) continue;

      try {
        const parsed = input.kind === 'WORKBOOK'
          ? await this.parser.parse(await input.file.arrayBuffer())
          : await this.imageRecognizer!.parse(input.file);
        parsedResults.push(parsed);
        completedRecords[index] = {
          ...completedRecords[index],
          progress: 100,
          status: 'READY',
        };
      } catch {
        completedRecords[index] = {
          ...completedRecords[index],
          progress: 100,
          status: 'ERROR',
        };
      }
    }

    await this.imports.replaceFiles(batch.id, completedRecords);

    if (!parsedResults.length) {
      throw new Error('No supported import file could be parsed.');
    }

    const availablePeople = await this.people.list();
    const peopleByName = new Map(
      availablePeople.map((person) => [normalizeName(person.name), person]),
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
          });
        } else {
          existing.confidence = Math.max(existing.confidence, person.confidence);
          if (!existing.matchedPersonId && matched) existing.matchedPersonId = matched.id;
        }
      }
    }

    const candidateByKey = new Map<string, {
      detectedPersonId: string;
      personId: string | null;
      date: string;
      start: string | null;
      end: string | null;
      confidence: number;
    }>();
    let duplicateCandidate = false;

    const registerCandidate = (candidate: {
      sourcePersonName: string;
      date: string;
      start: string | null;
      end: string | null;
      confidence: number;
    }) => {
      if (!candidate.start && !candidate.end) return;
      const detected = detectedByName.get(normalizeName(candidate.sourcePersonName));
      if (!detected) return;

      const key = normalizeName(candidate.sourcePersonName) + '|' + candidate.date;
      const next = {
        detectedPersonId: detected.id,
        personId: detected.matchedPersonId,
        date: candidate.date,
        start: candidate.start,
        end: candidate.end,
        confidence: candidate.confidence,
      };
      const existing = candidateByKey.get(key);
      if (!existing) {
        candidateByKey.set(key, next);
        return;
      }

      duplicateCandidate = true;
      const existingComplete = existing.start != null && existing.end != null;
      const nextComplete = next.start != null && next.end != null;
      const existingEvidence = Number(existing.start != null) + Number(existing.end != null);
      const nextEvidence = Number(next.start != null) + Number(next.end != null);

      if (
        (!existingComplete && nextComplete) ||
        (
          existingComplete === nextComplete &&
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
      for (const candidate of parsed.scheduleCandidates) registerCandidate(candidate);
      for (const candidate of parsed.reviewCandidates ?? []) {
        if ((candidate.start == null) === (candidate.end == null)) continue;
        registerCandidate(candidate);
      }
    }

    const reviewItems: ImportReviewItem[] = [];
    for (const candidate of candidateByKey.values()) {
      const existing = candidate.personId
        ? await this.schedules.getByDate(candidate.personId, candidate.date)
        : null;
      reviewItems.push({
        id: crypto.randomUUID(),
        detectedPersonId: candidate.detectedPersonId,
        personId: candidate.personId,
        date: candidate.date,
        ...(existing ? { existing: { start: existing.start, end: existing.end } } : {}),
        imported: { start: candidate.start, end: candidate.end },
        resolution: null,
      });
    }

    const first = parsedResults[0];
    const confidence = parsedResults.reduce((sum, parsed) => sum + parsed.confidence, 0) / parsedResults.length;

    await this.imports.replaceParsedResult(batch.id, {
      detectedPeople: [...detectedByName.values()],
      structure: {
        ...first.structure,
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
