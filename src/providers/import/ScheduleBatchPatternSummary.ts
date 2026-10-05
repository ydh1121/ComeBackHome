import type {
  ScheduleCellPattern,
  ScheduleImagePatternAnalysis,
} from './StructuredTableImageScheduleRecognizer';

export interface ScheduleBatchPatternInput {
  sourceName: string;
  pattern: ScheduleImagePatternAnalysis | null;
}

export interface ScheduleLabelVariantSuggestion {
  sourceName: string;
  suggestedCanonical: string;
  reason: 'ONE_EDIT_FROM_REPEATED_LABEL' | 'ONE_CHARACTER_EDGE_OMISSION';
  reviewOnly: true;
}

export interface SchedulePersonPatternSummary {
  sourceName: string;
  fileOccurrences: number;
  sourceFiles: string[];
  classification: 'REPEATED_LABEL' | 'SINGLE_OR_UNSEEN_LABEL';
  workCount: number;
  incompleteCount: number;
  offOrBlankCount: number;
  startTimes: Array<{ time: string; count: number }>;
  endTimes: Array<{ time: string; count: number }>;
}

export interface ScheduleIncompleteTimeSuggestion {
  sourceFile: string;
  sourcePersonName: string;
  date: string;
  knownField: 'start' | 'end';
  knownTime: string;
  suggestedField: 'start' | 'end';
  suggestedTime: string;
  supportCount: number;
  supportFileCount: number;
  supportRatio: number;
  reviewOnly: true;
}

export interface ScheduleBatchPatternSummary {
  schema: 'comebackhome-schedule-batch-pattern/v1';
  sourceCount: number;
  people: SchedulePersonPatternSummary[];
  labelVariantSuggestions: ScheduleLabelVariantSuggestion[];
  incompleteTimeSuggestions: ScheduleIncompleteTimeSuggestion[];
}

function editDistance(left: string, right: string): number {
  const a = [...left];
  const b = [...right];
  const rows = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  );

  for (let i = 0; i <= a.length; i += 1) rows[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) rows[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }

  return rows[a.length][b.length];
}

function rankedTimes(
  cells: ScheduleCellPattern[],
  key: 'start' | 'end',
): Array<{ time: string; count: number }> {
  const counts = new Map<string, number>();
  for (const cell of cells) {
    const value = cell[key];
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([time, count]) => ({ time, count }))
    .sort((a, b) => b.count - a.count || a.time.localeCompare(b.time));
}

interface SourcedScheduleCell {
  sourceFile: string;
  cell: ScheduleCellPattern;
}

function buildIncompleteTimeSuggestions(
  sourcedCells: SourcedScheduleCell[],
): ScheduleIncompleteTimeSuggestion[] {
  const completeByPerson = new Map<string, SourcedScheduleCell[]>();

  for (const item of sourcedCells) {
    if (
      item.cell.state !== 'WORK' ||
      !item.cell.start ||
      !item.cell.end
    ) continue;
    const list = completeByPerson.get(item.cell.sourcePersonName) ?? [];
    list.push(item);
    completeByPerson.set(item.cell.sourcePersonName, list);
  }

  const suggestions: ScheduleIncompleteTimeSuggestion[] = [];

  for (const item of sourcedCells) {
    const cell = item.cell;
    if (cell.state !== 'INCOMPLETE') continue;

    const knownField =
      cell.start && !cell.end
        ? 'start' as const
        : cell.end && !cell.start
          ? 'end' as const
          : null;
    if (!knownField) continue;

    const knownTime = knownField === 'start' ? cell.start! : cell.end!;
    const counterpartField = knownField === 'start' ? 'end' as const : 'start' as const;

    const candidates = (completeByPerson.get(cell.sourcePersonName) ?? [])
      .filter((candidate) => candidate.cell[knownField] === knownTime);

    if (!candidates.length) continue;

    const counts = new Map<string, {
      count: number;
      files: Set<string>;
    }>();

    for (const candidate of candidates) {
      const counterpart = candidate.cell[counterpartField];
      if (!counterpart) continue;
      const current = counts.get(counterpart) ?? {
        count: 0,
        files: new Set<string>(),
      };
      current.count += 1;
      current.files.add(candidate.sourceFile);
      counts.set(counterpart, current);
    }

    const ranked = [...counts.entries()]
      .sort((left, right) => right[1].count - left[1].count);
    const [suggestedTime, support] = ranked[0] ?? [];
    if (!suggestedTime || !support) continue;

    const total = ranked.reduce((sum, [, value]) => sum + value.count, 0);
    const supportRatio = total ? support.count / total : 0;

    if (
      support.count < 2 ||
      support.files.size < 2 ||
      supportRatio < 0.75
    ) continue;

    suggestions.push({
      sourceFile: item.sourceFile,
      sourcePersonName: cell.sourcePersonName,
      date: cell.date,
      knownField,
      knownTime,
      suggestedField: counterpartField,
      suggestedTime,
      supportCount: support.count,
      supportFileCount: support.files.size,
      supportRatio: Number(supportRatio.toFixed(4)),
      reviewOnly: true,
    });
  }

  return suggestions;
}

export function buildScheduleBatchPatternSummary(
  inputs: ScheduleBatchPatternInput[],
): ScheduleBatchPatternSummary {
  const filesByLabel = new Map<string, Set<string>>();
  const cellsByLabel = new Map<string, ScheduleCellPattern[]>();
  const sourcedCells: SourcedScheduleCell[] = [];

  for (const input of inputs) {
    if (!input.pattern) continue;

    for (const person of input.pattern.people) {
      const files = filesByLabel.get(person.sourceName) ?? new Set<string>();
      files.add(input.sourceName);
      filesByLabel.set(person.sourceName, files);
    }

    for (const cell of input.pattern.cells) {
      const cells = cellsByLabel.get(cell.sourcePersonName) ?? [];
      cells.push(cell);
      cellsByLabel.set(cell.sourcePersonName, cells);
      sourcedCells.push({
        sourceFile: input.sourceName,
        cell,
      });
    }
  }

  const people: SchedulePersonPatternSummary[] = [...filesByLabel.entries()]
    .map(([sourceName, files]) => {
      const cells = cellsByLabel.get(sourceName) ?? [];
      return {
        sourceName,
        fileOccurrences: files.size,
        sourceFiles: [...files].sort(),
        classification:
          files.size >= 2
            ? 'REPEATED_LABEL' as const
            : 'SINGLE_OR_UNSEEN_LABEL' as const,
        workCount: cells.filter((cell) => cell.state === 'WORK').length,
        incompleteCount: cells.filter((cell) => cell.state === 'INCOMPLETE').length,
        offOrBlankCount: cells.filter((cell) => cell.state === 'OFF_OR_BLANK').length,
        startTimes: rankedTimes(cells, 'start'),
        endTimes: rankedTimes(cells, 'end'),
      };
    })
    .sort((a, b) =>
      b.fileOccurrences - a.fileOccurrences ||
      a.sourceName.localeCompare(b.sourceName)
    );

  const repeated = people.filter((person) => person.fileOccurrences >= 2);
  const labelVariantSuggestions: ScheduleLabelVariantSuggestion[] = [];

  for (const person of people) {
    if (person.fileOccurrences >= 2) continue;

    const candidates = repeated
      .map((target) => {
        const distance = editDistance(person.sourceName, target.sourceName);
        const edgeOmission =
          Math.abs(person.sourceName.length - target.sourceName.length) === 1 &&
          (
            target.sourceName.endsWith(person.sourceName) ||
            target.sourceName.startsWith(person.sourceName) ||
            person.sourceName.endsWith(target.sourceName) ||
            person.sourceName.startsWith(target.sourceName)
          );
        return { target, distance, edgeOmission };
      })
      .filter((item) => item.distance <= 1 || item.edgeOmission)
      .sort((a, b) =>
        a.distance - b.distance ||
        b.target.fileOccurrences - a.target.fileOccurrences
      );

    const best = candidates[0];
    if (!best) continue;

    labelVariantSuggestions.push({
      sourceName: person.sourceName,
      suggestedCanonical: best.target.sourceName,
      reason: best.edgeOmission
        ? 'ONE_CHARACTER_EDGE_OMISSION'
        : 'ONE_EDIT_FROM_REPEATED_LABEL',
      reviewOnly: true,
    });
  }

  return {
    schema: 'comebackhome-schedule-batch-pattern/v1',
    sourceCount: inputs.length,
    people,
    labelVariantSuggestions,
    incompleteTimeSuggestions: buildIncompleteTimeSuggestions(sourcedCells),
  };
}
