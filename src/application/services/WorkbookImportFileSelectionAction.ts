import type {
  ImportFileSelectionAction,
  ImportInputFile,
} from '../contracts/actions';
import type { WorkbookParser } from '../contracts/providers';
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
  ) {}

  async accept(files: ImportInputFile[]): Promise<string> {
    if (!files.length) throw new Error('No import files were selected.');

    const batch = (await this.imports.getCurrentBatch()) ?? await this.imports.createBatch();
    const initialRecords: ImportFileRecord[] = files.map(({ kind, file }) => ({
      id: crypto.randomUUID(),
      name: file.name,
      kind: kind === 'WORKBOOK' ? 'XLSX' : 'IMAGE',
      progress: kind === 'WORKBOOK' ? 10 : 100,
      status: kind === 'WORKBOOK' ? 'PARSING' : 'ERROR',
    }));
    await this.imports.replaceFiles(batch.id, initialRecords);

    const parsedResults = [];
    const completedRecords = [...initialRecords];

    for (let index = 0; index < files.length; index += 1) {
      const input = files[index];
      if (input.kind !== 'WORKBOOK') continue;

      try {
        parsedResults.push(await this.parser.parse(await input.file.arrayBuffer()));
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
      throw new Error('No workbook could be parsed. Image recognition is not available yet.');
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
      start: string;
      end: string;
    }>();
    let duplicateCandidate = false;

    for (const parsed of parsedResults) {
      for (const candidate of parsed.scheduleCandidates) {
        const detected = detectedByName.get(normalizeName(candidate.sourcePersonName));
        if (!detected) continue;
        const key = normalizeName(candidate.sourcePersonName) + '|' + candidate.date;
        if (candidateByKey.has(key)) {
          duplicateCandidate = true;
          continue;
        }
        candidateByKey.set(key, {
          detectedPersonId: detected.id,
          personId: detected.matchedPersonId,
          date: candidate.date,
          start: candidate.start,
          end: candidate.end,
        });
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
