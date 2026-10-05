import readExcelFile from 'read-excel-file/universal';
import type {
  ParsedImport,
  ParsedImportPerson,
  ParsedScheduleCandidate,
  WorkbookParser,
} from '../../application/contracts/providers';
import type { ImportStructure } from '../../domain/models';

type Cell = string | number | boolean | Date | null | undefined;
export interface WorkbookSheetData {
  sheet: string;
  data: Cell[][];
}

interface HeaderMatch {
  rowIndex: number;
  person: number;
  date: number;
  start?: number;
  end?: number;
  shift?: number;
  score: number;
}

const aliases = {
  person: ['이름', '성명', '직원', '직원이름', '사람', 'name', 'person', 'employee'],
  date: ['날짜', '일자', '근무일', '근무날짜', 'date', 'workdate'],
  start: ['출근', '출근시간', '시작', '시작시간', '근무시작', 'start', 'starttime'],
  end: ['퇴근', '퇴근시간', '종료', '종료시간', '근무종료', 'end', 'endtime'],
  shift: ['근무시간', '근무', '시간', 'shift', 'worktime', 'workinghours'],
} as const;

function normalizeHeader(value: Cell): string {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-().:[\]{}]/g, '');
}

function normalizeName(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, '');
}

function columnLetter(index: number): string {
  let value = index + 1;
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function findAliasIndex(row: Cell[], group: readonly string[]): number {
  const normalized = row.map(normalizeHeader);
  return normalized.findIndex((value) => group.some((candidate) => normalizeHeader(candidate) === value));
}

function findHeader(rows: Cell[][]): HeaderMatch | null {
  let best: HeaderMatch | null = null;
  const limit = Math.min(rows.length, 10);

  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const person = findAliasIndex(row, aliases.person);
    const date = findAliasIndex(row, aliases.date);
    const start = findAliasIndex(row, aliases.start);
    const end = findAliasIndex(row, aliases.end);
    const shift = findAliasIndex(row, aliases.shift);

    if (person < 0 || date < 0) continue;
    const hasSeparateTimes = start >= 0 && end >= 0;
    const hasCombinedTime = shift >= 0;
    if (!hasSeparateTimes && !hasCombinedTime) continue;

    const score = 2 + (hasSeparateTimes ? 2 : 1);
    const match: HeaderMatch = {
      rowIndex,
      person,
      date,
      ...(start >= 0 ? { start } : {}),
      ...(end >= 0 ? { end } : {}),
      ...(shift >= 0 ? { shift } : {}),
      score,
    };
    if (!best || match.score > best.score) best = match;
  }

  return best;
}

function formatDate(value: Cell): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  const raw = String(value ?? '').normalize('NFKC').trim();
  const match = /^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})$/.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) return null;
  return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

function formatTime(value: Cell): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return String(value.getUTCHours()).padStart(2, '0') + ':' +
      String(value.getUTCMinutes()).padStart(2, '0');
  }

  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1) {
    const minutes = Math.round(value * 24 * 60);
    const hour = Math.floor(minutes / 60) % 24;
    const minute = minutes % 60;
    return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
  }

  const raw = String(value ?? '').normalize('NFKC').trim();
  if (!raw) return null;

  const korean = /^(오전|오후)\s*(\d{1,2})(?::(\d{1,2}))?$/.exec(raw);
  if (korean) {
    let hour = Number(korean[2]);
    const minute = Number(korean[3] ?? '0');
    if (hour < 1 || hour > 12 || minute > 59) return null;
    if (korean[1] === '오후' && hour !== 12) hour += 12;
    if (korean[1] === '오전' && hour === 12) hour = 0;
    return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
  }

  const colon = /^(\d{1,2}):([0-5]\d)$/.exec(raw);
  if (colon) {
    const hour = Number(colon[1]);
    if (hour > 23) return null;
    return String(hour).padStart(2, '0') + ':' + colon[2];
  }

  const compact = /^(\d{1,2})(\d{2})$/.exec(raw);
  if (compact) {
    const hour = Number(compact[1]);
    const minute = Number(compact[2]);
    if (hour > 23 || minute > 59) return null;
    return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
  }

  return null;
}

function splitShift(value: Cell): [string, string] | null {
  const raw = String(value ?? '').normalize('NFKC').trim();
  const parts = raw.split(/\s*(?:~|–|—|－|-)\s*/);
  if (parts.length !== 2) return null;
  const start = formatTime(parts[0]);
  const end = formatTime(parts[1]);
  return start && end ? [start, end] : null;
}

function rowHasContent(row: Cell[]): boolean {
  return row.some((value) => value != null && String(value).trim() !== '');
}

function parseSheet(sheet: WorkbookSheetData): {
  structure: ImportStructure;
  people: ParsedImportPerson[];
  candidates: ParsedScheduleCandidate[];
  confidence: number;
  usableRows: number;
} | null {
  const header = findHeader(sheet.data);
  if (!header) return null;

  const people = new Map<string, ParsedImportPerson>();
  const candidates: ParsedScheduleCandidate[] = [];
  let usableRows = 0;
  let candidateRows = 0;

  for (let rowIndex = header.rowIndex + 1; rowIndex < sheet.data.length; rowIndex += 1) {
    const row = sheet.data[rowIndex] ?? [];
    if (!rowHasContent(row)) continue;
    usableRows += 1;

    const sourceName = String(row[header.person] ?? '').normalize('NFKC').trim();
    const date = formatDate(row[header.date]);
    let start: string | null = null;
    let end: string | null = null;

    if (header.start != null && header.end != null) {
      start = formatTime(row[header.start]);
      end = formatTime(row[header.end]);
    } else if (header.shift != null) {
      const shift = splitShift(row[header.shift]);
      if (shift) [start, end] = shift;
    }

    if (!sourceName || !date || !start || !end) continue;
    candidateRows += 1;

    const key = normalizeName(sourceName);
    if (!people.has(key)) {
      people.set(key, { sourceName, confidence: 1 });
    }
    candidates.push({
      sourcePersonName: sourceName,
      date,
      start,
      end,
      sourceRow: rowIndex + 1,
      confidence: 1,
    });
  }

  if (!candidateRows) return null;

  const headerConfidence = header.start != null && header.end != null ? 1 : 0.95;
  const rowConfidence = usableRows ? candidateRows / usableRows : 0;
  const confidence = Math.max(0, Math.min(1, headerConfidence * rowConfidence));

  return {
    structure: {
      sheet: sheet.sheet,
      headerRow: header.rowIndex + 1,
      personColumn: columnLetter(header.person),
      dateColumn: columnLetter(header.date),
      shiftColumn: header.start != null && header.end != null
        ? columnLetter(header.start) + ':' + columnLetter(header.end)
        : columnLetter(header.shift ?? 0),
      needsReview: confidence < 0.95 || header.rowIndex !== 0,
    },
    people: [...people.values()],
    candidates,
    confidence,
    usableRows,
  };
}

export function parseWorkbookSheets(sheets: WorkbookSheetData[]): ParsedImport {
  const parsed = sheets
    .map(parseSheet)
    .filter((value): value is NonNullable<ReturnType<typeof parseSheet>> => value !== null);

  if (!parsed.length) {
    throw new Error('Workbook structure was not recognized.');
  }

  const people = new Map<string, ParsedImportPerson>();
  const scheduleCandidates: ParsedScheduleCandidate[] = [];
  let weightedConfidence = 0;
  let totalRows = 0;

  for (const sheet of parsed) {
    for (const person of sheet.people) {
      const key = normalizeName(person.sourceName);
      const existing = people.get(key);
      if (!existing || person.confidence > existing.confidence) people.set(key, person);
    }
    scheduleCandidates.push(...sheet.candidates);
    weightedConfidence += sheet.confidence * Math.max(1, sheet.usableRows);
    totalRows += Math.max(1, sheet.usableRows);
  }

  scheduleCandidates.sort((left, right) =>
    left.date.localeCompare(right.date) ||
    normalizeName(left.sourcePersonName).localeCompare(normalizeName(right.sourcePersonName)) ||
    left.sourceRow - right.sourceRow
  );

  const first = parsed[0];
  const confidence = totalRows ? weightedConfidence / totalRows : 0;

  return {
    detectedPeople: [...people.values()],
    scheduleCandidates,
    structure: {
      ...first.structure,
      needsReview: first.structure.needsReview || parsed.length > 1 || confidence < 0.95,
    },
    confidence,
  };
}

export class ReadExcelWorkbookParser implements WorkbookParser {
  async parse(data: ArrayBuffer): Promise<ParsedImport> {
    const sheets = await readExcelFile(data) as WorkbookSheetData[];
    return parseWorkbookSheets(sheets);
  }
}
