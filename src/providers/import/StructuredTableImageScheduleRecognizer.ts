import type {
  ImageScheduleRecognizer,
  ImageTextExtractor,
  ImageTextLayout,
  ImageTextToken,
  ParsedImport,
  ParsedImportPerson,
  ParsedScheduleCandidate,
} from '../../application/contracts/providers';
import {
  END_LABELS as END_ALIASES,
  REST_LABELS as REST_ALIASES,
  START_LABELS as START_ALIASES,
} from './ScheduleImportSemantics';

interface BoxToken extends ImageTextToken {
  cx: number;
  cy: number;
  right: number;
  bottom: number;
  normalized: string;
}

interface LayoutCandidate {
  strategy: string;
  score: number;
  parsed: ParsedImport;
}

interface DateBlock {
  date: string;
  center: number;
  left: number;
  right: number;
  confidence: number;
  inferred: boolean;
}

interface WeekdayAnchor {
  index: number;
  family: 'english' | 'korean';
  token: BoxToken;
}

interface RowBand {
  cy: number;
  top: number;
  bottom: number;
  tokens: BoxToken[];
}

const PERSON_ALIASES = ['이름', '성명', '직원', '직원이름', '사람', 'name', 'person', 'employee'];
const DATE_ALIASES = ['날짜', '일자', '근무일', '근무날짜', 'date', 'workdate'];

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value > 1) return Math.max(0, Math.min(1, value / 100));
  return Math.max(0, Math.min(1, value));
}

function normalizeText(value: string): string {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/[\s_()[\]{}]/g, '');
}

function box(token: ImageTextToken): BoxToken {
  const x = Number(token.x);
  const y = Number(token.y);
  const width = Number(token.width);
  const height = Number(token.height);
  if (![x, y, width, height].every(Number.isFinite) || width < 0 || height < 0) {
    throw new Error('Image OCR token geometry is invalid.');
  }
  return {
    ...token,
    x,
    y,
    width,
    height,
    confidence: clampConfidence(token.confidence),
    cx: x + width / 2,
    cy: y + height / 2,
    right: x + width,
    bottom: y + height,
    normalized: normalizeText(token.text),
  };
}

export function parseScheduleDate(value: string): string | null {
  const normalized = value
    .normalize('NFKC')
    .trim()
    .replace(/[./]/g, '-')
    .replace(/\s+/g, '');

  const dashed = /^(20\d{2})-(\d{1,2})-(\d{1,2})$/.exec(normalized);
  const compact = /^(20\d{2})(\d{2})(\d{2})$/.exec(normalized);
  const match = dashed ?? compact;
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) return null;

  return [
    String(year).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(day).padStart(2, '0'),
  ].join('-');
}

export function parseScheduleHour(value: string): string | null {
  const normalized = value
    .normalize('NFKC')
    .trim()
    .replace(/,/g, '.')
    .replace(/\s+/g, '');

  const colon = /^(\d{1,2}):([0-5]\d)$/.exec(normalized);
  if (colon) {
    const hour = Number(colon[1]);
    if (hour > 23) return null;
    return String(hour).padStart(2, '0') + ':' + colon[2];
  }

  const decimal = /^(\d{1,2})(?:\.(0|5))?$/.exec(normalized);
  if (decimal) {
    const hour = Number(decimal[1]);
    if (hour <= 23) {
      return String(hour).padStart(2, '0') + ':' + (decimal[2] === '5' ? '30' : '00');
    }
  }

  // Numeric OCR can lose the decimal point from half-hour notation.
  // Recover only when the raw integer is impossible as a 24-hour value and
  // removing the final 5 produces an otherwise valid hour.
  const compactHalfHour = /^(\d{1,2})5$/.exec(normalized);
  if (compactHalfHour && Number(normalized) > 23) {
    const hour = Number(compactHalfHour[1]);
    if (hour <= 23) {
      return String(hour).padStart(2, '0') + ':30';
    }
  }

  return null;
}

function matchesAlias(value: string, aliases: string[]): boolean {
  return aliases.some((alias) => normalizeText(alias) === value);
}

function isScheduleHeader(value: string): boolean {
  return matchesAlias(value, START_ALIASES) ||
    matchesAlias(value, END_ALIASES) ||
    matchesAlias(value, REST_ALIASES);
}

function isLikelyPersonName(value: string): boolean {
  if (!value || value.length > 30) return false;
  if (parseScheduleDate(value) || parseScheduleHour(value) || isScheduleHeader(value)) return false;
  if (
    matchesAlias(value, PERSON_ALIASES) ||
    matchesAlias(value, DATE_ALIASES)
  ) return false;
  if (/^\d+월$/.test(value)) return false;
  if (/^[a-z]+day$/i.test(value)) return false;
  return /[가-힣a-z]/i.test(value);
}

function isUsablePersonRowLabel(value: string, confidence: number): boolean {
  // This filters OCR row-label quality only. It never establishes a real
  // person identity. Identity resolution belongs to the import matching step.
  if (/[가-힣]/.test(value)) return value.length >= 2 && confidence >= 0.68;
  return /^[a-z][a-z.'-]*$/i.test(value) && value.length >= 2 && confidence >= 0.9;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

const ENGLISH_WEEKDAY_PREFIXES: Array<{ prefix: string; index: number }> = [
  { prefix: 'monda', index: 0 },
  { prefix: 'tuesda', index: 1 },
  { prefix: 'wednesda', index: 2 },
  { prefix: 'thursda', index: 3 },
  { prefix: 'frida', index: 4 },
  { prefix: 'saturda', index: 5 },
  { prefix: 'sunda', index: 6 },
];

const KOREAN_WEEKDAY_INDEX = new Map<string, number>([
  ['월', 0],
  ['화', 1],
  ['수', 2],
  ['목', 3],
  ['금', 4],
  ['토', 5],
  ['일', 6],
]);

function parseWeekdayAnchor(token: BoxToken): WeekdayAnchor | null {
  const korean = KOREAN_WEEKDAY_INDEX.get(token.normalized);
  if (korean != null) return { index: korean, family: 'korean', token };

  const english = ENGLISH_WEEKDAY_PREFIXES.find(({ prefix }) =>
    token.normalized.startsWith(prefix)
  );
  return english
    ? { index: english.index, family: 'english', token }
    : null;
}

function isoDateAddDays(value: string, days: number): string {
  const parsed = parseScheduleDate(value);
  if (!parsed) throw new Error('Internal calendar anchor date is invalid.');
  const [year, month, day] = parsed.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return [
    String(date.getUTCFullYear()).padStart(4, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function groupRows(tokens: BoxToken[], tolerance?: number): RowBand[] {
  if (!tokens.length) return [];

  const typicalHeight = median(tokens.map((token) => token.height).filter((value) => value > 0)) || 12;
  const rowTolerance = tolerance ?? Math.max(3, typicalHeight * 0.65);
  const rows: BoxToken[][] = [];

  for (const token of [...tokens].sort((a, b) => a.cy - b.cy || a.x - b.x)) {
    let bestRow: BoxToken[] | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const row of rows) {
      const cy = average(row.map((item) => item.cy));
      const distance = Math.abs(cy - token.cy);
      if (distance <= rowTolerance && distance < bestDistance) {
        bestRow = row;
        bestDistance = distance;
      }
    }

    if (bestRow) bestRow.push(token);
    else rows.push([token]);
  }

  const centers = rows
    .map((row) => ({
      cy: average(row.map((token) => token.cy)),
      tokens: row.sort((a, b) => a.x - b.x),
    }))
    .sort((a, b) => a.cy - b.cy);

  return centers.map((row, index) => ({
    ...row,
    top: index === 0 ? 0 : (centers[index - 1].cy + row.cy) / 2,
    bottom: index === centers.length - 1
      ? Number.POSITIVE_INFINITY
      : (row.cy + centers[index + 1].cy) / 2,
  }));
}

function buildDateBlocks(dateTokens: Array<{ date: string; token: BoxToken }>, width: number): DateBlock[] {
  const sorted = [...dateTokens].sort((a, b) => a.token.cx - b.token.cx);
  if (sorted.length < 2) return [];

  return sorted.map((item, index) => {
    const previous = sorted[index - 1];
    const next = sorted[index + 1];
    const left = previous
      ? (previous.token.cx + item.token.cx) / 2
      : Math.max(0, item.token.cx - (next.token.cx - item.token.cx) / 2);
    const right = next
      ? (item.token.cx + next.token.cx) / 2
      : Math.min(width, item.token.cx + (item.token.cx - previous.token.cx) / 2);
    return {
      date: item.date,
      center: item.token.cx,
      left,
      right,
      confidence: item.token.confidence,
      inferred: false,
    };
  });
}

function buildCalendarStripDateBlocks(
  tokens: BoxToken[],
  width: number,
): DateBlock[] {
  const rawWeekdays = tokens
    .map((token) => parseWeekdayAnchor(token))
    .filter((item): item is WeekdayAnchor => item != null);

  if (rawWeekdays.length < 3) return [];

  const minimumCy = Math.min(...rawWeekdays.map((item) => item.token.cy));
  const typicalHeight = median(
    rawWeekdays.map((item) => item.token.height).filter((height) => height > 0),
  ) || 12;
  const topBandLimit = minimumCy + Math.max(18, typicalHeight * 1.6);
  const topBand = rawWeekdays.filter((item) => item.token.cy <= topBandLimit);

  const english = topBand.filter((item) => item.family === 'english');
  const korean = topBand.filter((item) => item.family === 'korean');
  const uniqueCount = (items: WeekdayAnchor[]): number =>
    new Set(items.map((item) => item.index)).size;

  const selected = uniqueCount(english) >= 3
    ? english
    : uniqueCount(korean) >= 3
      ? korean
      : [];

  if (!selected.length) return [];

  const strongestByIndex = new Map<number, WeekdayAnchor>();
  for (const item of selected) {
    const existing = strongestByIndex.get(item.index);
    if (!existing || item.token.confidence > existing.token.confidence) {
      strongestByIndex.set(item.index, item);
    }
  }

  const ordered = [...strongestByIndex.values()]
    .sort((a, b) => a.token.cx - b.token.cx);
  if (ordered.length < 3) return [];

  const unwrapped: Array<{ ordinal: number; anchor: WeekdayAnchor }> = [];
  let ordinal = 0;
  unwrapped.push({ ordinal, anchor: ordered[0] });
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1].index;
    const current = ordered[index].index;
    const delta = (current - previous + 7) % 7;
    if (delta === 0) continue;
    ordinal += delta;
    if (ordinal > 6) return [];
    unwrapped.push({ ordinal, anchor: ordered[index] });
  }

  if (unwrapped.length < 3) return [];

  const stepCandidates: number[] = [];
  for (let index = 1; index < unwrapped.length; index += 1) {
    const previous = unwrapped[index - 1];
    const current = unwrapped[index];
    const deltaOrdinal = current.ordinal - previous.ordinal;
    if (deltaOrdinal <= 0) continue;
    stepCandidates.push(
      (current.anchor.token.cx - previous.anchor.token.cx) / deltaOrdinal,
    );
  }

  const step = median(stepCandidates.filter((value) => value > 0));
  if (!Number.isFinite(step) || step <= 0) return [];

  const origins = unwrapped.map(({ ordinal: itemOrdinal, anchor: item }) =>
    item.token.cx - itemOrdinal * step
  );
  const origin = median(origins);

  const residuals = unwrapped.map(({ ordinal: itemOrdinal, anchor: item }) =>
    Math.abs(item.token.cx - (origin + itemOrdinal * step))
  );
  if (Math.max(...residuals) > step * 0.18) return [];

  const minimumOrdinal = Math.min(...unwrapped.map((item) => item.ordinal));
  const maximumOrdinal = Math.max(...unwrapped.map((item) => item.ordinal));
  if (maximumOrdinal - minimumOrdinal < 2) return [];

  const dateTokens = tokens
    .map((token) => ({ token, date: parseScheduleDate(token.normalized) }))
    .filter((item): item is { token: BoxToken; date: string } => item.date != null);

  const mappedDates: Array<{
    ordinal: number;
    date: string;
    token: BoxToken;
  }> = [];

  for (const item of dateTokens) {
    const estimatedOrdinal = Math.round((item.token.cx - origin) / step);
    if (
      estimatedOrdinal < minimumOrdinal ||
      estimatedOrdinal > maximumOrdinal
    ) continue;

    const expectedCenter = origin + estimatedOrdinal * step;
    if (Math.abs(item.token.cx - expectedCenter) > step * 0.42) continue;

    mappedDates.push({
      ordinal: estimatedOrdinal,
      date: item.date,
      token: item.token,
    });
  }

  if (!mappedDates.length) return [];

  const baseWeights = new Map<string, number>();
  for (const item of mappedDates) {
    const base = isoDateAddDays(item.date, -item.ordinal);
    baseWeights.set(
      base,
      (baseWeights.get(base) ?? 0) + Math.max(0.05, item.token.confidence),
    );
  }

  const rankedBases = [...baseWeights.entries()]
    .sort((a, b) => b[1] - a[1]);
  const [baseDate, baseWeight] = rankedBases[0] ?? [];
  if (!baseDate || baseWeight == null) return [];

  const totalWeight = rankedBases.reduce((sum, [, weight]) => sum + weight, 0);
  if (rankedBases.length > 1 && baseWeight < totalWeight * 0.6) return [];

  const directByOrdinal = new Map<number, {
    date: string;
    token: BoxToken;
  }>();
  for (const item of mappedDates) {
    if (isoDateAddDays(baseDate, item.ordinal) !== item.date) continue;
    const existing = directByOrdinal.get(item.ordinal);
    if (!existing || item.token.confidence > existing.token.confidence) {
      directByOrdinal.set(item.ordinal, {
        date: item.date,
        token: item.token,
      });
    }
  }

  const weekdayConfidence = average(
    unwrapped.map((item) => item.anchor.token.confidence),
  );
  const dateConfidence = average(
    mappedDates
      .filter((item) => isoDateAddDays(baseDate, item.ordinal) === item.date)
      .map((item) => item.token.confidence),
  );
  const inferredConfidence = Math.min(
    0.84,
    weekdayConfidence || 0.84,
    dateConfidence || 0.84,
  );

  const blocks: DateBlock[] = [];
  for (
    let itemOrdinal = minimumOrdinal;
    itemOrdinal <= maximumOrdinal;
    itemOrdinal += 1
  ) {
    const center = origin + itemOrdinal * step;
    const direct = directByOrdinal.get(itemOrdinal);
    blocks.push({
      date: isoDateAddDays(baseDate, itemOrdinal),
      center,
      left: Math.max(0, center - step / 2),
      right: Math.min(width, center + step / 2),
      confidence: direct?.token.confidence ?? inferredConfidence,
      inferred: !direct,
    });
  }

  return blocks;
}

function blockForX(blocks: DateBlock[], cx: number): DateBlock | null {
  return blocks.find((block) => cx >= block.left && cx < block.right) ?? null;
}

function relativeX(block: DateBlock, cx: number): number {
  return (cx - block.left) / Math.max(1, block.right - block.left);
}

function nearestField(
  fraction: number,
  startFraction: number,
  endFraction: number,
  restFraction: number | null,
): 'start' | 'end' | 'rest' | null {
  const choices: Array<{ field: 'start' | 'end' | 'rest'; distance: number }> = [
    { field: 'start', distance: Math.abs(fraction - startFraction) },
    { field: 'end', distance: Math.abs(fraction - endFraction) },
  ];
  if (restFraction != null) {
    choices.push({ field: 'rest', distance: Math.abs(fraction - restFraction) });
  }
  choices.sort((a, b) => a.distance - b.distance);
  return choices[0]?.distance <= 0.22 ? choices[0].field : null;
}

function signature(parsed: ParsedImport): string {
  return parsed.scheduleCandidates
    .map((item) => [item.sourcePersonName, item.date, item.start, item.end].join('|'))
    .sort()
    .join('\n');
}

function dateBlockMatrixStrategy(
  layout: ImageTextLayout,
  tokens: BoxToken[],
): LayoutCandidate | null {
  const dateTokens = tokens
    .map((token) => ({ token, date: parseScheduleDate(token.normalized) }))
    .filter((item): item is { token: BoxToken; date: string } => item.date != null);

  const calendarBlocks = buildCalendarStripDateBlocks(tokens, layout.width);
  const blocks = calendarBlocks.length >= 2
    ? calendarBlocks
    : buildDateBlocks(dateTokens, layout.width);
  if (blocks.length < 2) return null;

  const usedCalendarStrip = calendarBlocks.length >= 2;

  const labelTokens = tokens.filter((token) => isScheduleHeader(token.normalized));
  const startFractions: number[] = [];
  const endFractions: number[] = [];
  const restFractions: number[] = [];

  for (const token of labelTokens) {
    const block = blockForX(blocks, token.cx);
    if (!block) continue;
    const fraction = relativeX(block, token.cx);
    if (matchesAlias(token.normalized, START_ALIASES)) startFractions.push(fraction);
    else if (matchesAlias(token.normalized, END_ALIASES)) endFractions.push(fraction);
    else if (matchesAlias(token.normalized, REST_ALIASES)) restFractions.push(fraction);
  }

  if (!startFractions.length || !endFractions.length) return null;

  const startFraction = median(startFractions);
  const endFraction = median(endFractions);
  const restFraction = restFractions.length ? median(restFractions) : null;
  if (Math.abs(startFraction - endFraction) < 0.08) return null;

  const headerBottom = Math.max(...labelTokens.map((token) => token.bottom));
  const gridLeft = Math.min(...blocks.map((block) => block.left));
  const gridRight = Math.max(...blocks.map((block) => block.right));

  const outsideGridTokens = tokens.filter((token) =>
    token.cy > headerBottom &&
    (token.cx < gridLeft || token.cx >= gridRight) &&
    isLikelyPersonName(token.normalized)
  );

  if (!outsideGridTokens.length) return null;

  const nameRows = groupRows(outsideGridTokens)
    .map((row) => {
      const names = row.tokens.filter((token) => isLikelyPersonName(token.normalized));
      if (!names.length) return null;
      const sourceName = names.map((token) => token.normalized).join('');
      const confidence = average(names.map((token) => token.confidence));
      if (!isUsablePersonRowLabel(sourceName, confidence)) return null;
      return { sourceName, cy: row.cy, confidence };
    })
    .filter((row): row is {
      sourceName: string;
      cy: number;
      confidence: number;
    } => row != null);

  if (!nameRows.length) return null;

  const personRows = nameRows.map((row, index) => ({
    ...row,
    top: index === 0 ? headerBottom : (nameRows[index - 1].cy + row.cy) / 2,
    bottom: index === nameRows.length - 1 ? layout.height : (row.cy + nameRows[index + 1].cy) / 2,
  }));

  const detectedPeople: ParsedImportPerson[] = personRows.map((row) => ({
    sourceName: row.sourceName,
    confidence: row.confidence,
  }));

  const scheduleCandidates: ParsedScheduleCandidate[] = [];

  for (let rowIndex = 0; rowIndex < personRows.length; rowIndex += 1) {
    const person = personRows[rowIndex];
    const rowTokens = tokens.filter((token) =>
      token.cy >= person.top &&
      token.cy < person.bottom &&
      token.cx >= gridLeft &&
      token.cx < gridRight
    );

    for (const block of blocks) {
      let start: { value: string; confidence: number } | null = null;
      let end: { value: string; confidence: number } | null = null;

      for (const token of rowTokens) {
        if (token.cx < block.left || token.cx >= block.right) continue;
        const time = parseScheduleHour(token.normalized);
        if (!time) continue;

        const field = nearestField(
          relativeX(block, token.cx),
          startFraction,
          endFraction,
          restFraction,
        );

        if (field === 'start' && (!start || token.confidence > start.confidence)) {
          start = { value: time, confidence: token.confidence };
        }
        if (field === 'end' && (!end || token.confidence > end.confidence)) {
          end = { value: time, confidence: token.confidence };
        }
      }

      if (!start || !end) continue;

      scheduleCandidates.push({
        sourcePersonName: person.sourceName,
        date: block.date,
        start: start.value,
        end: end.value,
        sourceRow: rowIndex + 1,
        confidence: Math.min(
          person.confidence,
          block.confidence,
          start.confidence,
          end.confidence,
        ),
      });
    }
  }

  if (!scheduleCandidates.length) return null;

  const candidateConfidence = average(scheduleCandidates.map((item) => item.confidence));
  const semanticAnchorScore = Math.min(
    1,
    0.55 +
      Math.min(blocks.length, 7) * 0.035 +
      Math.min(labelTokens.length, blocks.length * 3) * 0.01,
  );
  const score = Math.min(1, candidateConfidence * 0.75 + semanticAnchorScore * 0.25);

  return {
    strategy: 'date-block-matrix',
    score,
    parsed: {
      detectedPeople,
      scheduleCandidates,
      structure: {
        sheet: usedCalendarStrip
          ? '이미지 근무표 / date-block-matrix + calendar-strip'
          : '이미지 근무표 / date-block-matrix',
        headerRow: 1,
        personColumn: '표 외곽 이름 영역(자동 추론)',
        dateColumn: '날짜 블록(자동 추론)',
        shiftColumn: '출근/퇴근 라벨 상대 위치(자동 추론)',
        needsReview: true,
      },
      confidence: candidateConfidence,
    },
  };
}

interface ColumnAnchor {
  kind: 'person' | 'date' | 'start' | 'end';
  token: BoxToken;
}

function classifyHeader(token: BoxToken): ColumnAnchor['kind'] | null {
  if (matchesAlias(token.normalized, PERSON_ALIASES)) return 'person';
  if (matchesAlias(token.normalized, DATE_ALIASES)) return 'date';
  if (matchesAlias(token.normalized, START_ALIASES)) return 'start';
  if (matchesAlias(token.normalized, END_ALIASES)) return 'end';
  return null;
}

function rowTableStrategy(
  _layout: ImageTextLayout,
  tokens: BoxToken[],
): LayoutCandidate | null {
  const rows = groupRows(tokens);
  let header: { row: RowBand; anchors: ColumnAnchor[] } | null = null;

  for (const row of rows) {
    const anchors = row.tokens
      .map((token) => ({ token, kind: classifyHeader(token) }))
      .filter((item): item is ColumnAnchor => item.kind != null);

    const kinds = new Set(anchors.map((item) => item.kind));
    if (
      kinds.has('person') &&
      kinds.has('date') &&
      kinds.has('start') &&
      kinds.has('end')
    ) {
      header = { row, anchors };
      break;
    }
  }

  if (!header) return null;

  const centers = new Map<ColumnAnchor['kind'], number>();
  for (const kind of ['person', 'date', 'start', 'end'] as const) {
    const matches = header.anchors.filter((anchor) => anchor.kind === kind);
    if (!matches.length) return null;
    centers.set(kind, average(matches.map((anchor) => anchor.token.cx)));
  }

  const orderedCenters = [...centers.entries()]
    .map(([kind, cx]) => ({ kind, cx }))
    .sort((a, b) => a.cx - b.cx);

  const bounds = orderedCenters.map((column, index) => ({
    ...column,
    left: index === 0 ? Number.NEGATIVE_INFINITY : (orderedCenters[index - 1].cx + column.cx) / 2,
    right: index === orderedCenters.length - 1
      ? Number.POSITIVE_INFINITY
      : (column.cx + orderedCenters[index + 1].cx) / 2,
  }));

  const getCell = (row: RowBand, kind: ColumnAnchor['kind']): BoxToken[] => {
    const bound = bounds.find((item) => item.kind === kind);
    if (!bound) return [];
    return row.tokens.filter((token) => token.cx >= bound.left && token.cx < bound.right);
  };

  const detected = new Map<string, ParsedImportPerson>();
  const scheduleCandidates: ParsedScheduleCandidate[] = [];
  const dataRows = rows.filter((row) => row.cy > header!.row.cy + 1);

  for (let index = 0; index < dataRows.length; index += 1) {
    const row = dataRows[index];
    const personTokens = getCell(row, 'person').filter((token) => isLikelyPersonName(token.normalized));
    const dateTokens = getCell(row, 'date');
    const startTokens = getCell(row, 'start');
    const endTokens = getCell(row, 'end');

    const sourceName = personTokens.map((token) => token.normalized).join('');
    if (!sourceName || !isLikelyPersonName(sourceName)) continue;

    const date = dateTokens.map((token) => parseScheduleDate(token.normalized)).find((value) => value != null) ?? null;
    const startToken = startTokens.find((token) => parseScheduleHour(token.normalized) != null);
    const endToken = endTokens.find((token) => parseScheduleHour(token.normalized) != null);
    const start = startToken ? parseScheduleHour(startToken.normalized) : null;
    const end = endToken ? parseScheduleHour(endToken.normalized) : null;

    if (!date || !start || !end || !startToken || !endToken) continue;

    const personConfidence = average(personTokens.map((token) => token.confidence));
    const confidence = Math.min(
      personConfidence,
      ...dateTokens.map((token) => token.confidence),
      startToken.confidence,
      endToken.confidence,
    );

    const existing = detected.get(sourceName);
    if (!existing || confidence > existing.confidence) {
      detected.set(sourceName, { sourceName, confidence: personConfidence });
    }

    scheduleCandidates.push({
      sourcePersonName: sourceName,
      date,
      start,
      end,
      sourceRow: index + 1,
      confidence,
    });
  }

  if (!scheduleCandidates.length) return null;

  const candidateConfidence = average(scheduleCandidates.map((item) => item.confidence));
  const headerConfidence = average(header.anchors.map((anchor) => anchor.token.confidence));
  const score = Math.min(1, candidateConfidence * 0.75 + headerConfidence * 0.25);

  return {
    strategy: 'row-table',
    score,
    parsed: {
      detectedPeople: [...detected.values()],
      scheduleCandidates,
      structure: {
        sheet: '이미지 근무표 / row-table',
        headerRow: rows.indexOf(header.row) + 1,
        personColumn: '사람 열(헤더 라벨 자동 추론)',
        dateColumn: '날짜 열(헤더 라벨 자동 추론)',
        shiftColumn: '출근/퇴근 열(헤더 라벨 자동 추론)',
        needsReview: true,
      },
      confidence: candidateConfidence,
    },
  };
}

function assertLayout(layout: ImageTextLayout): BoxToken[] {
  if (
    !Number.isFinite(layout.width) ||
    !Number.isFinite(layout.height) ||
    layout.width <= 0 ||
    layout.height <= 0
  ) {
    throw new Error('Image dimensions are invalid.');
  }
  return layout.tokens.map(box).filter((token) => token.normalized.length > 0);
}

export function parseScheduleImageLayout(layout: ImageTextLayout): ParsedImport {
  const tokens = assertLayout(layout);
  const candidates = [
    dateBlockMatrixStrategy(layout, tokens),
    rowTableStrategy(layout, tokens),
  ].filter((candidate): candidate is LayoutCandidate => candidate != null)
    .sort((a, b) => b.score - a.score);

  if (!candidates.length || candidates[0].score < 0.65) {
    throw new Error('Image schedule layout was not recognized confidently.');
  }

  if (
    candidates.length > 1 &&
    candidates[1].score >= candidates[0].score - 0.06 &&
    signature(candidates[0].parsed) !== signature(candidates[1].parsed)
  ) {
    throw new Error('Image schedule layout is ambiguous and requires manual review.');
  }

  return {
    ...candidates[0].parsed,
    structure: {
      ...candidates[0].parsed.structure,
      needsReview: true,
    },
  };
}

export class AdaptiveScheduleImageRecognizer implements ImageScheduleRecognizer {
  constructor(private readonly extractor: ImageTextExtractor) {}

  async parse(file: File): Promise<ParsedImport> {
    return parseScheduleImageLayout(await this.extractor.extract(file));
  }
}

/**
 * Compatibility alias for the first Phase 5V name.
 * The implementation is adaptive and does not assume a single fixed table layout.
 */
export class StructuredTableImageScheduleRecognizer extends AdaptiveScheduleImageRecognizer {}
