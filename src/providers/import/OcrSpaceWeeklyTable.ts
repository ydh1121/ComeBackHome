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
function rowBounds(words: Word[], name: string, occurrence: number, day: number): OcrSpaceCell['evidence_bbox'] {
  const names = words.filter(word => clean(word.WordText) === name).sort((a, b) => a.Top - b.Top);
  const anchor = names[occurrence];
  if (!anchor) return null;
  // Only a complete, observed 21-label header may establish day ownership.
  const headers = words.filter(word => field(clean(word.WordText)) != null && word.Top < anchor.Top);
  const bands = headers.filter(word => Math.abs(word.Top - Math.max(...headers.map(h => h.Top))) < Math.max(4, word.Height / 2))
    .sort((a, b) => a.Left - b.Left);
  if (bands.length !== 21 || bands.some((word, i) => field(clean(word.WordText)) !== i % 3)) return null;
  const typical = (bands[20].Left - bands[0].Left) / 20;
  if (typical <= 0) return null;
  const left = day ? (bands[day * 3 - 1].Left + bands[day * 3].Left) / 2 : Math.max(0, bands[0].Left - typical / 2);
  const right = day < 6 ? (bands[day * 3 + 2].Left + bands[day * 3 + 3].Left) / 2 : bands[20].Left + typical;
  const rowWords = words.filter(word => Math.abs(word.Top + word.Height / 2 - anchor.Top - anchor.Height / 2) < Math.max(anchor.Height, word.Height) * .6 && word.Left >= left && word.Left < right);
  if (!rowWords.length) return null;
  return [Math.max(0, Math.min(left, ...rowWords.map(word => word.Left))), Math.min(anchor.Top, ...rowWords.map(word => word.Top)),
    Math.max(right, ...rowWords.map(word => word.Left + word.Width)), Math.max(anchor.Top + anchor.Height, ...rowWords.map(word => word.Top + word.Height))];
}

export function parseOcrSpaceWeeklyTable(value: unknown, sourceImageId: string): {
  cells: OcrSpaceCell[]; error: string | null; diagnostics: { row_widths: number[]; header_candidates: number; data_rows: number };
} {
  const diagnostics = { row_widths: [] as number[], header_candidates: 0, data_rows: 0 };
  const fail = (error: string) => ({ cells: [] as OcrSpaceCell[], error, diagnostics });
  if (!record(value) || value.OCRExitCode !== 1 || value.IsErroredOnProcessing !== false || !Array.isArray(value.ParsedResults) || value.ParsedResults.length !== 1)
    return fail('PROVIDER_NOT_COMPLETE');
  const page = value.ParsedResults[0];
  if (!record(page) || ![1, '1'].includes(page.FileParseExitCode as number) || typeof page.ParsedText !== 'string' || page.ParsedText.length > 1_000_000)
    return fail('INVALID_PAGE');
  const rows = tableRows(page.ParsedText);
  diagnostics.row_widths = rows.map(row => row.length).slice(0, 103);
  const headers = rows.map((row, i) => row.length === 22 && row.slice(1).every((cell, j) => field(cell) === j % 3) ? i : -1).filter(i => i >= 0);
  diagnostics.header_candidates = headers.length;
  if (headers.length !== 1) return fail('NO_UNIQUE_OBSERVED_7X3_HEADER');
  const index = headers[0];
  const body = rows.slice(index + 1);
  if (!body.length || body.length > 100 || body.some(row => row.length !== 22)) return fail('AMBIGUOUS_STAFF_ROWS');
  diagnostics.data_rows = body.length;
  const dates = Array.from({ length: 7 }, (_, day) => {
    const seen = new Set<string>();
    for (const row of rows.slice(0, index + 1)) {
      const group = row.length === 22 ? row.slice(1 + day * 3, 4 + day * 3) : row.length === 8 ? [row[day + 1]] : [];
      group.flatMap(observedDates).forEach(date => seen.add(date));
    }
    return seen.size === 1 ? [...seen][0] : null;
  });
  const words = wordsOf(page);
  const occurrences = new Map<string, number>();
  const cells: OcrSpaceCell[] = [];
  for (const [rowIndex, row] of body.entries()) {
    const name = row[0] || null;
    const occurrence = occurrences.get(name ?? '') ?? 0;
    occurrences.set(name ?? '', occurrence + 1);
    for (let day = 0; day < 7; day++) {
      const triple = row.slice(day * 3 + 1, day * 3 + 4);
      const [start, end, rest] = triple;
      const date = dates[day];
      const off = (text: string) => /^(OFF|휴무|휴가|연차)$/i.test(text);
      const blank = triple.every(text => !text);
      const explicitOff = triple.some(off) && triple.every(text => !text || off(text));
      const inClock = clock(start), outClock = clock(end), breakMinutes = minutes(rest, true);
      const status: OcrSpaceCell['status'] = !date || !name ? 'UNREADABLE' : blank ? 'BLANK' : explicitOff ? 'OFF_CANDIDATE' :
        inClock != null && outClock != null && breakMinutes != null ? 'SHIFT' : 'UNREADABLE';
      cells.push({ source_image_id: sourceImageId, employee_row: rowIndex, column_group: day, employee_name: name,
        date, weekday: date ? (new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7 : null, status,
        clock_in: status === 'SHIFT' ? inClock : null, clock_out: status === 'SHIFT' ? outClock : null,
        break_minutes: status === 'SHIFT' ? breakMinutes : null, review_required: null,
        original_text: { clock_in: start, clock_out: end, break: rest },
        evidence_bbox: name ? rowBounds(words, name, occurrence, day) : null });
    }
  }
  return { cells, error: null, diagnostics };
}
