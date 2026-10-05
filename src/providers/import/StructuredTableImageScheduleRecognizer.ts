import type {
  ImageScheduleRecognizer,
  ImageTextExtractor,
  ImageTextLayout,
  ImageTextToken,
  ParsedImport,
  ParsedImportPerson,
  ParsedScheduleCandidate,
} from '../../application/contracts/providers';

interface BoxToken extends ImageTextToken {
  cx: number;
  cy: number;
  right: number;
  bottom: number;
  normalized: string;
}

interface DateHeader {
  date: string;
  token: BoxToken;
  left: number;
  right: number;
}

interface PersonRow {
  sourceName: string;
  cy: number;
  top: number;
  bottom: number;
  confidence: number;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value > 1) return Math.max(0, Math.min(1, value / 100));
  return Math.max(0, Math.min(1, value));
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
    normalized: String(token.text ?? '')
      .normalize('NFKC')
      .trim()
      .replace(/[‐‑‒–—―]/g, '-')
      .replace(/\s+/g, ''),
  };
}

function parseDate(value: string): string | null {
  const match = /^(20\d{2})-(\d{2})-(\d{2})$/.exec(value);
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
  return value;
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
  if (!decimal) return null;

  const hour = Number(decimal[1]);
  if (hour > 23) return null;
  const minutes = decimal[2] === '5' ? '30' : '00';
  return String(hour).padStart(2, '0') + ':' + minutes;
}

function isScheduleLabel(value: string): boolean {
  return value === '출근' || value === '퇴근' || value === '쉬는시간';
}

function isLikelyPersonName(value: string): boolean {
  if (!value || value.length > 24) return false;
  if (parseDate(value) || parseScheduleHour(value) || isScheduleLabel(value)) return false;
  if (/^\d+월$/.test(value)) return false;
  if (/^[A-Za-z]+day$/i.test(value)) return false;
  return /[가-힣A-Za-z]/.test(value);
}

function mergeNameTokens(tokens: BoxToken[], rowTolerance: number): Array<{
  sourceName: string;
  cy: number;
  confidence: number;
}> {
  const sorted = [...tokens].sort((left, right) => left.cy - right.cy || left.x - right.x);
  const rows: BoxToken[][] = [];

  for (const token of sorted) {
    const row = rows.find((candidate) => {
      const average = candidate.reduce((sum, item) => sum + item.cy, 0) / candidate.length;
      return Math.abs(average - token.cy) <= rowTolerance;
    });
    if (row) row.push(token);
    else rows.push([token]);
  }

  return rows.map((row) => {
    const ordered = row.sort((left, right) => left.x - right.x);
    return {
      sourceName: ordered.map((token) => token.normalized).join(''),
      cy: ordered.reduce((sum, token) => sum + token.cy, 0) / ordered.length,
      confidence: ordered.reduce((sum, token) => sum + token.confidence, 0) / ordered.length,
    };
  }).filter((row) => isLikelyPersonName(row.sourceName));
}

function buildPersonRows(
  names: Array<{ sourceName: string; cy: number; confidence: number }>,
  dataTop: number,
  imageHeight: number,
): PersonRow[] {
  const sorted = [...names].sort((left, right) => left.cy - right.cy);
  return sorted.map((row, index) => ({
    ...row,
    top: index === 0 ? dataTop : (sorted[index - 1].cy + row.cy) / 2,
    bottom: index === sorted.length - 1 ? imageHeight : (row.cy + sorted[index + 1].cy) / 2,
  }));
}

function buildDateHeaders(dateTokens: Array<{ date: string; token: BoxToken }>, width: number): DateHeader[] {
  const sorted = [...dateTokens].sort((left, right) => left.token.cx - right.token.cx);
  if (sorted.length < 2) {
    throw new Error('At least two date columns are required for image schedule recognition.');
  }

  return sorted.map((item, index) => {
    const previous = sorted[index - 1];
    const next = sorted[index + 1];
    const left = previous
      ? (previous.token.cx + item.token.cx) / 2
      : Math.max(0, item.token.cx - (next.token.cx - item.token.cx) / 2);
    const right = next
      ? (item.token.cx + next.token.cx) / 2
      : Math.min(width, item.token.cx + (item.token.cx - previous.token.cx) / 2);
    return { ...item, left, right };
  });
}

function columnOf(header: DateHeader, cx: number): 'start' | 'end' | 'rest' | null {
  if (cx < header.left || cx >= header.right) return null;
  const fraction = (cx - header.left) / (header.right - header.left);
  if (fraction < 1 / 3) return 'start';
  if (fraction < 2 / 3) return 'end';
  return 'rest';
}

function confidenceAverage(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function parseScheduleImageLayout(layout: ImageTextLayout): ParsedImport {
  if (!Number.isFinite(layout.width) || !Number.isFinite(layout.height) || layout.width <= 0 || layout.height <= 0) {
    throw new Error('Image dimensions are invalid.');
  }

  const tokens = layout.tokens.map(box).filter((token) => token.normalized.length > 0);
  const dateTokens = tokens
    .map((token) => ({ token, date: parseDate(token.normalized) }))
    .filter((item): item is { token: BoxToken; date: string } => item.date != null);

  const headers = buildDateHeaders(dateTokens, layout.width);
  const firstHeader = headers[0];
  const scheduleLabels = tokens.filter((token) => isScheduleLabel(token.normalized));

  if (scheduleLabels.length < 2) {
    throw new Error('Image schedule headers were not recognized.');
  }

  const headerBottom = Math.max(...scheduleLabels.map((token) => token.bottom));
  const nameBandRight = firstHeader.left;
  const nameTokens = tokens.filter((token) =>
    token.cx < nameBandRight &&
    token.cy > headerBottom &&
    isLikelyPersonName(token.normalized)
  );

  if (!nameTokens.length) {
    throw new Error('Image schedule person rows were not recognized.');
  }

  const medianNameHeight = [...nameTokens]
    .map((token) => token.height)
    .sort((left, right) => left - right)[Math.floor(nameTokens.length / 2)] || 12;
  const mergedNames = mergeNameTokens(nameTokens, Math.max(3, medianNameHeight * 0.55));
  const personRows = buildPersonRows(mergedNames, headerBottom, layout.height);

  if (!personRows.length) {
    throw new Error('Image schedule person rows were not recognized.');
  }

  const detectedPeople: ParsedImportPerson[] = personRows.map((row) => ({
    sourceName: row.sourceName,
    confidence: row.confidence,
  }));

  const scheduleCandidates: ParsedScheduleCandidate[] = [];
  const candidateConfidences: number[] = [];

  for (let rowIndex = 0; rowIndex < personRows.length; rowIndex += 1) {
    const person = personRows[rowIndex];
    const rowTokens = tokens.filter((token) =>
      token.cy >= person.top &&
      token.cy < person.bottom &&
      token.cx >= nameBandRight
    );

    for (const header of headers) {
      let start: { value: string; confidence: number } | null = null;
      let end: { value: string; confidence: number } | null = null;

      for (const token of rowTokens) {
        const column = columnOf(header, token.cx);
        if (column !== 'start' && column !== 'end') continue;
        const time = parseScheduleHour(token.normalized);
        if (!time) continue;
        if (column === 'start' && !start) start = { value: time, confidence: token.confidence };
        if (column === 'end' && !end) end = { value: time, confidence: token.confidence };
      }

      if (!start || !end) continue;

      const confidence = Math.min(
        person.confidence,
        header.token.confidence,
        start.confidence,
        end.confidence,
      );

      scheduleCandidates.push({
        sourcePersonName: person.sourceName,
        date: header.date,
        start: start.value,
        end: end.value,
        sourceRow: rowIndex + 1,
        confidence,
      });
      candidateConfidences.push(confidence);
    }
  }

  if (!scheduleCandidates.length) {
    throw new Error('No complete image schedule rows were recognized.');
  }

  return {
    detectedPeople,
    scheduleCandidates,
    structure: {
      sheet: '이미지 근무표',
      headerRow: 1,
      personColumn: '좌측 이름열',
      dateColumn: '요일별 YYYY-MM-DD',
      shiftColumn: '출근 / 퇴근 / 쉬는시간',
      needsReview: true,
    },
    confidence: confidenceAverage(candidateConfidences),
  };
}

export class StructuredTableImageScheduleRecognizer implements ImageScheduleRecognizer {
  constructor(private readonly extractor: ImageTextExtractor) {}

  async parse(file: File): Promise<ParsedImport> {
    return parseScheduleImageLayout(await this.extractor.extract(file));
  }
}
