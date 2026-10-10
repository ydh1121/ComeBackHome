import readExcelFile from 'read-excel-file/universal';
import type {
  ParsedImport,
  ParsedImportPerson,
  ParsedScheduleCandidate,
  ParsedScheduleReviewCandidate,
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


// Native-cell weekly workbook support. Decorative rows are not employee data;
// no raster/OCR or style-dependent OFF inference is involved.
const WEEKLY_REVIEW_STRUCTURE = 'weekly 7 day x start/end/break physical matrix';
const WEEKLY_FIELDS = [
  ['출근', '출근시간', '시작', '시작시간'],
  ['퇴근', '퇴근시간', '종료', '종료시간'],
  ['쉬는시간', '휴게시간', '휴식시간', '휴게', '쉬는 시간'],
] as const;

function parseWeeklyClock(value: Cell): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 1 && value < 24) {
    const minutes = Math.round(value * 60);
    if (Math.abs(minutes / 60 - value) > 0.0001) return null;
    return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' +
      String(minutes % 60).padStart(2, '0');
  }
  const raw = String(value ?? '').normalize('NFKC').trim();
  const decimal = /^(\d{1,2})(?:\.(0|5))?$/.exec(raw);
  if (decimal && Number(decimal[1]) < 24) {
    return String(Number(decimal[1])).padStart(2, '0') + ':' +
      (decimal[2] === '5' ? '30' : '00');
  }
  return formatTime(value);
}

function parseBreakMinutes(value: Cell): number | null {
  if (value == null || String(value).trim() === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const minutes = Math.round(value * 60);
    return value >= 0 && minutes <= 720 && Math.abs(value * 60 - minutes) < 0.001
      ? minutes : null;
  }
  const raw = String(value).normalize('NFKC').trim();
  const hours = /^(\d{1,2})(?:\.(0|5))?$/.exec(raw);
  if (hours) {
    const minutes = Number(hours[1]) * 60 + (hours[2] === '5' ? 30 : 0);
    return minutes <= 720 ? minutes : null;
  }
  const asMinutes = /^(\d{1,3})\s*분$/.exec(raw);
  if (asMinutes) return Number(asMinutes[1]) <= 720 ? Number(asMinutes[1]) : null;
  const asClock = /^(\d{1,2}):([0-5]\d)$/.exec(raw);
  if (asClock) {
    const minutes = Number(asClock[1]) * 60 + Number(asClock[2]);
    return minutes <= 720 ? minutes : null;
  }
  return null;
}

function parseWeeklySheet(sheet: WorkbookSheetData): {
  structure: ImportStructure;
  people: ParsedImportPerson[];
  candidates: ParsedScheduleCandidate[];
  reviewCandidates: ParsedScheduleReviewCandidate[];
  confidence: number;
  usableRows: number;
} | null {
  const rows = sheet.data;
  let headerRow = -1;
  let firstStart = -1;
  // Identify seven repeated, adjacent START/END/BREAK triplets, not a fixed row.
  for (let r = 0; r < Math.min(rows.length, 16) && headerRow === -1; r += 1) {
    for (let c = 1; c + 20 < (rows[r]?.length ?? 0); c += 1) {
      if ([0, 1, 2, 3, 4, 5, 6].every(day =>
        WEEKLY_FIELDS.every((aliases, field) => {
          const normalized = normalizeHeader(rows[r]?.[c + day * 3 + field]);
          return aliases.some(alias => normalized === normalizeHeader(alias));
        })
      )) {
        headerRow = r;
        firstStart = c;
        break;
      }
    }
  }
  if (headerRow < 0) return null;

  const dates: string[] = [];
  for (let day = 0; day < 7; day += 1) {
    const startColumn = firstStart + day * 3;
    const found = new Set<string>();
    for (let r = 0; r < headerRow; r += 1) {
      const date = formatDate(rows[r]?.[startColumn]);
      if (date) found.add(date);
    }
    if (found.size !== 1) {
      throw new Error('주간 엑셀 날짜가 누락되었거나 충돌합니다. 날짜 머리글을 확인해 주세요.');
    }
    dates.push([...found][0]);
  }
  // Repeated or nonconsecutive dates must never be silently associated with people.
  for (let day = 1; day < 7; day += 1) {
    const preceding = Date.parse(dates[day - 1] + 'T00:00:00Z');
    if (new Date(preceding + 86400000).toISOString().slice(0, 10) !== dates[day]) {
      throw new Error('주간 엑셀 날짜가 연속된 7일이 아닙니다. 날짜 머리글을 확인해 주세요.');
    }
  }

  const personColumn = firstStart - 1;
  const people = new Map<string, ParsedImportPerson>();
  const reviewCandidates: ParsedScheduleReviewCandidate[] = [];
  let uncertain = 0;
  let populated = 0;
  for (let r = headerRow + 1; r < rows.length; r += 1) {
    const row = rows[r] ?? [];
    const nameValue = row[personColumn];
    if (typeof nameValue !== 'string') continue;
    const name = nameValue.normalize('NFKC').trim();
    // Do not import summary, holiday, or notes rows as employees.
    if (!name || name.length > 25 ||
        /^(?:특이사항|비고|공지|합계|총계|소계|메모|휴무자|실습|공휴일)/.test(name) ||
        !/^[\p{L}][\p{L}\p{M}\s·-]*$/u.test(name)) continue;
    const key = normalizeName(name);
    if (people.has(key)) {
      throw new Error('주간 엑셀에 직원명이 중복되어 있습니다. 직원 행을 확인해 주세요.');
    }
    people.set(key, { sourceName: name, confidence: 1 });
    for (let day = 0; day < 7; day += 1) {
      const col = firstStart + day * 3;
      const rawStart = row[col];
      const rawEnd = row[col + 1];
      const rawBreak = row[col + 2];
      const hasValue = (cell: Cell) => cell != null && String(cell).trim() !== '';
      const anyValue = [rawStart, rawEnd, rawBreak].some(hasValue);
      const start = parseWeeklyClock(rawStart);
      const end = parseWeeklyClock(rawEnd);
      const breakMinutes = parseBreakMinutes(rawBreak);
      const badBreak = hasValue(rawBreak) && breakMinutes === null;
      const recognitionState =
        !anyValue ? 'OFF_CANDIDATE' :
        start && end && !badBreak ? 'WORK' :
        start || end ? 'INCOMPLETE' : 'UNREADABLE';
      if (recognitionState !== 'WORK') uncertain += 1;
      else populated += 1;
      reviewCandidates.push({
        sourcePersonName: name,
        date: dates[day],
        start,
        end,
        breakMinutes: badBreak ? null : breakMinutes,
        sourceRow: r + 1,
        confidence: recognitionState === 'WORK' ? 1 : 0.4,
        recognitionState,
        enabled: true,
      });
    }
  }
  if (!people.size) {
    throw new Error('주간 엑셀의 직원 행을 확인할 수 없습니다.');
  }
  return {
    structure: {
      sheet: WEEKLY_REVIEW_STRUCTURE,
      headerRow: headerRow + 1,
      personColumn: columnLetter(personColumn),
      dateColumn: columnLetter(firstStart),
      shiftColumn: columnLetter(firstStart) + ':' + columnLetter(firstStart + 20),
      needsReview: true,
    },
    people: [...people.values()],
    candidates: [],
    reviewCandidates,
    confidence: populated / Math.max(1, populated + uncertain),
    usableRows: people.size,
  };
}

function parseSheet(sheet: WorkbookSheetData): {
  structure: ImportStructure;
  people: ParsedImportPerson[];
  candidates: ParsedScheduleCandidate[];
  reviewCandidates?: ParsedScheduleReviewCandidate[];
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
    .map(sheet => parseWeeklySheet(sheet) ?? parseSheet(sheet))
    .filter((value): value is NonNullable<ReturnType<typeof parseSheet>> => value !== null);

  if (!parsed.length) {
    throw new Error('Workbook structure was not recognized.');
  }

  const people = new Map<string, ParsedImportPerson>();
  const scheduleCandidates: ParsedScheduleCandidate[] = [];
  const reviewCandidates: ParsedScheduleReviewCandidate[] = [];
  const weeklyKeys = new Set<string>();
  let weightedConfidence = 0;
  let totalRows = 0;

  for (const sheet of parsed) {
    for (const person of sheet.people) {
      const key = normalizeName(person.sourceName);
      const existing = people.get(key);
      if (!existing || person.confidence > existing.confidence) people.set(key, person);
    }
    scheduleCandidates.push(...sheet.candidates);
    for (const candidate of sheet.reviewCandidates ?? []) {
      const key = normalizeName(candidate.sourcePersonName) + '|' + candidate.date;
      if (weeklyKeys.has(key)) {
        throw new Error('주간 엑셀에 동일 직원·날짜 일정이 중복되어 있습니다.');
      }
      weeklyKeys.add(key);
      reviewCandidates.push(candidate);
    }
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
    ...(reviewCandidates.length ? { reviewCandidates } : {}),
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
