/** Pure Engine 3 Markdown adapter. No network, persistence or truth access.
 * Benchmark metadata identifies the input; it is not model-extracted evidence.
 * Provider has no review_required field. Product approval must remain separate.
 */
export interface OcrSpaceCell {
  source_image_id: string;
  employee_row: number;
  column_group: number;
  employee_name: string | null;
  date: string | null;
  weekday: number | null;
  status: 'SHIFT' | 'OFF_CANDIDATE' | 'BLANK' | 'UNREADABLE';
  clock_in: string | null;
  clock_out: string | null;
  break_minutes: number | null;
  review_required: null;
  original_text: { clock_in: string; clock_out: string; break: string };
  evidence_bbox: [number, number, number, number] | null;
}
type Word = { WordText: string; Left: number; Top: number; Width: number; Height: number };
type Bounds = { x: number; y: number; width: number; height: number };
/** Structural subset of the existing WeeklyPhysicalMatrix, never truth data. */
export interface OcrSpacePixelMatrix {
  rows: Array<{ nameBounds: Bounds; cells: Array<{ dayIndex: number; field: 'start' | 'end' | 'break'; bounds: Bounds; visual: { occupancy: 'EMPTY' | 'CONTENT' | 'UNCERTAIN' } }> }>;
}
type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function clean(value: string): string {
  return value.normalize('NFKC').replace(/<br\s*\/?\s*>/gi, ' ').replace(/\*\*/g, '').trim();
}
function tableRows(text: string): string[][] {
  return text.split(/\r?\n/).filter(line => line.trim().startsWith('|') && line.includes('|'))
    .map(line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(clean))
    .filter(row => !row.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s/g, ''))));
}
function field(value: string): number | null {
  const text = value.replace(/\s/g, '');
  if (/(?:출근|시작|start)$/i.test(text)) return 0;
  if (/(?:퇴근|종료|end)$/i.test(text)) return 1;
  if (/(?:쉬는시간|휴게시간|휴게|휴식|break)$/i.test(text)) return 2;
  return null;
}
function headerFields(row: string[]): number[] {
  // Markdown may merge several adjacent header labels into one cell. Consume
  // only labels that are actually present; never synthesize a missing label.
  return row.flatMap(cell => [...cell.matchAll(/쉬는\s*시간|휴게\s*시간|휴게|휴식|출근|시작|퇴근|종료|\bstart\b|\bend\b|\bbreak\b/gi)]
    .map(match => field(match[0])).filter((value): value is number => value != null));
}
function observedDates(text: string): string[] {
  const dates = new Set<string>();
  for (const match of text.matchAll(/\b(20\d{2})[-./](\d{1,2})[-./](\d{1,2})\b/g)) {
    const [, y, m, d] = match;
    const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    if (date.getUTCFullYear() === Number(y) && date.getUTCMonth() + 1 === Number(m) && date.getUTCDate() === Number(d))
      dates.add(date.toISOString().slice(0, 10));
  }
  return [...dates];
}
function minutes(value: string, duration = false): number | null {
  const text = value.replace(/\s/g, '');
  let result: number;
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(text);
  const minute = /^(\d{1,3})분$/.exec(text);
  if (clock) result = Number(clock[1]) * 60 + Number(clock[2]);
  else if (duration && minute) result = Number(minute[1]);
  else if (/^\d{1,2}(?:\.\d{1,2})?$/.test(text)) result = Number(text) * 60;
  else return null;
  if (!Number.isInteger(result) || result < 0 || result > (duration ? 720 : 1439)) return null;
  return result;
}
function clock(value: string): string | null {
  const parsed = minutes(value);
  return parsed == null ? null : String(Math.floor(parsed / 60)).padStart(2, '0') + ':' + String(parsed % 60).padStart(2, '0');
}
function wordsOf(page: RecordValue): Word[] {
  const overlay = page.TextOverlay;
  if (!record(overlay) || !Array.isArray(overlay.Lines)) return [];
  return overlay.Lines.flatMap(line => record(line) && Array.isArray(line.Words) ? line.Words : [])
    .filter((word): word is Word => record(word) && typeof word.WordText === 'string' &&
      ['Left', 'Top', 'Width', 'Height'].every(key => typeof word[key] === 'number' &&
        Number.isFinite(word[key]) && (word[key] as number) >= 0 && (word[key] as number) < 100_000));
}
function overlayHeader(words: Word[]): Word[] | null {
  const labels = words.filter(word => field(clean(word.WordText)) != null && headerFields([word.WordText]).length === 1);
  const groups: Word[][] = [];
  for (const label of labels.sort((a, b) => a.Top - b.Top)) {
    const group = groups.find(items => Math.abs(items[0].Top - label.Top) < Math.max(4, label.Height / 2));
    if (group) group.push(label); else groups.push([label]);
  }
  const complete = groups.map(group => group.sort((a, b) => a.Left - b.Left))
    .filter(group => group.length === 21 && group.every((word, i) => field(clean(word.WordText)) === i % 3));
  return complete.length === 1 ? complete[0] : null;
}
function observedRow(words: Word[], name: string, occurrence: number) {
  const bands = overlayHeader(words);
  if (!bands) return null;
  const names = words.filter(word => clean(word.WordText) === name).sort((a, b) => a.Top - b.Top);
  const anchor = names[occurrence];
  if (!anchor || anchor.Top <= Math.max(...bands.map(word => word.Top + word.Height))) return null;
  // Only a complete, observed 21-label header may establish day ownership.
  const typical = (bands[20].Left - bands[0].Left) / 20;
  if (typical <= 0) return null;
  // Header labels are left-aligned. Boundaries lie in observed whitespace
  // between adjacent label boxes, not halfway between their left edges.
  if (bands.slice(1).some((word, i) => bands[i].Left + bands[i].Width >= word.Left)) return null;
  const firstGap = bands[1].Left - bands[0].Left - bands[0].Width;
  const edges = [Math.max(0, bands[0].Left - firstGap / 2), ...bands.slice(1).map((word, i) => (word.Left + bands[i].Left + bands[i].Width) / 2), bands[20].Left + typical];
  if (anchor.Left + anchor.Width >= edges[0]) return null;
  const rowWords = words.filter(word => Math.abs(word.Top + word.Height / 2 - anchor.Top - anchor.Height / 2) < Math.max(anchor.Height, word.Height) * .6 && word.Left >= edges[0] && word.Left < edges[21]);
  return { anchor, edges, rowWords };
}
function rowBounds(words: Word[], name: string, occurrence: number, day: number): OcrSpaceCell['evidence_bbox'] {
  const row = observedRow(words, name, occurrence);
  if (!row) return null;
  const { anchor, edges, rowWords } = row;
  const left = edges[day * 3], right = edges[day * 3 + 3];
  const tokens = rowWords.filter(word => word.Left >= left && word.Left < right);
  return [Math.max(0, Math.min(left, ...tokens.map(word => word.Left))), Math.min(anchor.Top, ...tokens.map(word => word.Top)),
    Math.max(right, ...tokens.map(word => word.Left + word.Width)), Math.max(anchor.Top + anchor.Height, ...tokens.map(word => word.Top + word.Height))];
}
function overlayTriple(words: Word[], name: string, occurrence: number, day: number): string[] | null {
  const row = observedRow(words, name, occurrence);
  if (!row) return null;
  const triple = [0, 1, 2].map(fieldIndex => {
    const col = day * 3 + fieldIndex;
    const tokens = row.rowWords.filter(word => word.Left >= row.edges[col] && word.Left < row.edges[col + 1]);
    // An overlay box spanning another column cannot establish cell ownership.
    if (tokens.some(word => word.Left + word.Width > row.edges[col + 1])) return '?';
    return tokens.sort((a, b) => a.Left - b.Left).map(word => clean(word.WordText)).join(' ');
  });
  // Missing OCR tokens do not prove a blank source image region.
  return triple.some(Boolean) ? triple : null;
}

function textWithin(words: Word[], bounds: Bounds): string {
  return words.filter(word => word.Left + word.Width / 2 >= bounds.x && word.Left + word.Width / 2 < bounds.x + bounds.width &&
    word.Top + word.Height / 2 >= bounds.y && word.Top + word.Height / 2 < bounds.y + bounds.height)
    .sort((a, b) => a.Left - b.Left).map(word => clean(word.WordText)).join(' ');
}
function pixelEvidence(matrix: OcrSpacePixelMatrix, words: Word[], rowIndex: number, name: string | null, day: number) {
  const row = matrix.rows[rowIndex];
  if (!row || !name || textWithin(words, row.nameBounds).replace(/\s/g, '') !== name.replace(/\s/g, '')) return null;
  const fields = (['start', 'end', 'break'] as const).map(field => row.cells.find(cell => cell.dayIndex === day && cell.field === field));
  if (fields.some(field => !field)) return null;
  const cells = fields.map(field => field!);
  const values = cells.map(cell => textWithin(words, cell.bounds));
  const bounds: OcrSpaceCell['evidence_bbox'] = [Math.min(...cells.map(cell => cell.bounds.x)), Math.min(...cells.map(cell => cell.bounds.y)),
    Math.max(...cells.map(cell => cell.bounds.x + cell.bounds.width)), Math.max(...cells.map(cell => cell.bounds.y + cell.bounds.height))];
  return { values, bounds, blank: values.every(value => !value) && cells.every(cell => cell.visual.occupancy === 'EMPTY') };
}

export function parseOcrSpaceWeeklyTable(value: unknown, sourceImageId: string, pixelMatrix?: OcrSpacePixelMatrix | null): {
  cells: OcrSpaceCell[]; error: string | null; diagnostics: { row_widths: number[]; header_label_counts: number[]; header_candidates: number; data_rows: number; overlay_complete_header: boolean; pixel_matrix: boolean };
} {
  const diagnostics = { row_widths: [] as number[], header_label_counts: [] as number[], header_candidates: 0, data_rows: 0, overlay_complete_header: false, pixel_matrix: pixelMatrix != null };
  const fail = (error: string) => ({ cells: [] as OcrSpaceCell[], error, diagnostics });
  if (!record(value) || value.OCRExitCode !== 1 || value.IsErroredOnProcessing !== false || !Array.isArray(value.ParsedResults) || value.ParsedResults.length !== 1)
    return fail('PROVIDER_NOT_COMPLETE');
  const page = value.ParsedResults[0];
  if (!record(page) || ![1, '1'].includes(page.FileParseExitCode as number) || typeof page.ParsedText !== 'string' || page.ParsedText.length > 1_000_000)
    return fail('INVALID_PAGE');
  const rows = tableRows(page.ParsedText);
  const words = wordsOf(page);
  diagnostics.overlay_complete_header = overlayHeader(words) != null;
  diagnostics.row_widths = rows.map(row => row.length).slice(0, 103);
  const rowFields = rows.map(headerFields);
  diagnostics.header_label_counts = rowFields.map(fields => fields.length);
  let headers = rowFields.map((fields, i) => fields.length === 21 && fields.every((value, j) => value === j % 3) ? i : -1).filter(i => i >= 0);
  if (!headers.length && diagnostics.overlay_complete_header) {
    // A full independent overlay header can establish the physical 21 fields
    // when Markdown drops labels. Still require one identifiable header row.
    headers = rowFields.map((fields, i) => fields.length >= 3 ? i : -1).filter(i => i >= 0);
  }
  if (!headers.length && pixelMatrix) {
    // Actual product pixels establish 21 columns; three observed repeated
    // label triples establish field order without fabricating missing text.
    headers = rowFields.map((fields, i) => fields.length >= 9 && fields.length % 3 === 0 &&
      fields.every((value, j) => value === j % 3) ? i : -1).filter(i => i >= 0);
  }
  diagnostics.header_candidates = headers.length;
  if (headers.length !== 1) return fail('NO_UNIQUE_OBSERVED_7X3_HEADER');
  const index = headers[0];
  const body = rows.slice(index + 1);
  if (!body.length || body.length > 100 || body.some(row => row.length > 22 || row.length < 2 || (row.length !== 22 && !diagnostics.overlay_complete_header && !pixelMatrix))) return fail('AMBIGUOUS_STAFF_ROWS');
  if (pixelMatrix && pixelMatrix.rows.length !== body.length) return fail('PHYSICAL_ROW_COUNT_MISMATCH');
  diagnostics.data_rows = body.length;
  const dates = Array.from({ length: 7 }, (_, day) => {
    const seen = new Set<string>();
    for (const row of rows.slice(0, index + 1)) {
      const group = row.length === 22 ? row.slice(1 + day * 3, 4 + day * 3) : row.length === 8 ? [row[day + 1]] : [];
      group.flatMap(observedDates).forEach(date => seen.add(date));
    }
    return seen.size === 1 ? [...seen][0] : null;
  });
  const occurrences = new Map<string, number>();
  const cells: OcrSpaceCell[] = [];
  for (const [rowIndex, row] of body.entries()) {
    const name = row[0] || null;
    const occurrence = occurrences.get(name ?? '') ?? 0;
    occurrences.set(name ?? '', occurrence + 1);
    for (let day = 0; day < 7; day++) {
      const pixel = pixelMatrix ? pixelEvidence(pixelMatrix, words, rowIndex, name, day) : null;
      const physical = row.length !== 22;
      const observed = physical ? (pixel ? pixel.values : name ? overlayTriple(words, name, occurrence, day) : null) : row.slice(day * 3 + 1, day * 3 + 4);
      const triple = observed ?? ['', '', ''];
      const [start, end, rest] = triple;
      const date = dates[day];
      const off = (text: string) => /^(OFF|휴무|휴가|연차)$/i.test(text);
      const blank = physical ? pixel?.blank === true : triple.every(text => !text);
      const explicitOff = triple.some(off) && triple.every(text => !text || off(text));
      const inClock = clock(start), outClock = clock(end), breakMinutes = minutes(rest, true);
      const status: OcrSpaceCell['status'] = !date || !name || observed == null ? 'UNREADABLE' : blank ? 'BLANK' : explicitOff ? 'OFF_CANDIDATE' :
        inClock != null && outClock != null && breakMinutes != null ? 'SHIFT' : 'UNREADABLE';
      cells.push({ source_image_id: sourceImageId, employee_row: rowIndex, column_group: day, employee_name: name,
        date, weekday: date ? (new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7 : null, status,
        clock_in: status === 'SHIFT' ? inClock : null, clock_out: status === 'SHIFT' ? outClock : null,
        break_minutes: status === 'SHIFT' ? breakMinutes : null, review_required: null,
        original_text: { clock_in: start, clock_out: end, break: rest },
        evidence_bbox: pixel?.bounds ?? (name ? rowBounds(words, name, occurrence, day) : null) });
    }
  }
  return { cells, error: null, diagnostics };
}
