import type { ImageTextLayout, ImageTextToken } from '../../application/contracts/providers';
import {
  analyzeScheduleCellVisualEvidence,
  type ScheduleCellVisualEvidence,
  type SchedulePixelBounds,
  type ScheduleTableStructureDetection,
} from './ScheduleTableStructureDetector';
import { classifyScheduleShiftLabel } from './ScheduleImportSemantics';
import { parseScheduleDate } from './StructuredTableImageScheduleRecognizer';

interface BoxToken extends ImageTextToken {
  cx: number;
  cy: number;
  right: number;
  bottom: number;
  normalized: string;
}

export interface ScheduleMatrixDateColumn {
  index: number;
  date: string;
  bounds: SchedulePixelBounds;
  confidence: number;
  inferred: boolean;
}

export interface ScheduleMatrixPersonRow {
  sourceRow: number;
  bounds: SchedulePixelBounds;
  labelBounds: SchedulePixelBounds;
  preliminaryName: string | null;
  preliminaryConfidence: number;
}

export interface ScheduleMatrixCell {
  id: string;
  sourceRow: number;
  date: string;
  personLabelBounds: SchedulePixelBounds;
  bounds: SchedulePixelBounds;
  visual: ScheduleCellVisualEvidence;
}

export interface ScheduleCellMatrix {
  rows: ScheduleMatrixPersonRow[];
  dates: ScheduleMatrixDateColumn[];
  cells: ScheduleMatrixCell[];
  confidence: number;
  geometrySource: 'PIXEL_GRID' | 'PIXEL_PARTIAL' | 'WEAK_PIXEL';
}

export interface ScheduleMatrixProbeRegion {
  id: string;
  kind: 'person' | 'cell';
  sourceRow: number;
  date: string | null;
  bounds: SchedulePixelBounds;
}

function normalize(value: string): string {
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
  return {
    ...token,
    x,
    y,
    width,
    height,
    confidence: Math.max(0, Math.min(1, Number(token.confidence) || 0)),
    cx: x + width / 2,
    cy: y + height / 2,
    right: x + width,
    bottom: y + height,
    normalized: normalize(token.text),
  };
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function parseCalendarContext(tokens: BoxToken[]): { year: number | null; month: number | null } {
  let year: number | null = null;
  let month: number | null = null;
  for (const token of tokens) {
    const raw = String(token.text ?? '').normalize('NFKC').replace(/\s+/g, '');
    const full = /(20\d{2})년?[-./]?(1[0-2]|0?[1-9])월?/.exec(raw);
    if (full) return { year: Number(full[1]), month: Number(full[2]) };
    const yearOnly = /(20\d{2})년?/.exec(raw);
    if (yearOnly && year == null) year = Number(yearOnly[1]);
    const monthOnly = /^(1[0-2]|0?[1-9])월$/.exec(raw);
    if (monthOnly && month == null) month = Number(monthOnly[1]);
  }
  return { year, month };
}

function parseDateEvidence(
  value: string,
  context: { year: number | null; month: number | null },
  allowBareDay = false,
): string | null {
  const direct = parseScheduleDate(value);
  if (direct) return direct;

  const raw = value.normalize('NFKC').trim().replace(/\s+/g, '');
  const dayOnly = (allowBareDay ? /^(\d{1,2})(?:일)?$/ : /^(\d{1,2})일$/).exec(raw);
  if (dayOnly && context.year != null && context.month != null) {
    return parseScheduleDate(
      String(context.year) + '-' +
      String(context.month).padStart(2, '0') + '-' +
      String(Number(dayOnly[1])).padStart(2, '0')
    );
  }

  const monthDay =
    /^(\d{1,2})[/.](\d{1,2})(?:일)?$/.exec(raw) ??
    /^(\d{1,2})월(\d{1,2})(?:일)?$/.exec(raw);
  if (!monthDay || context.year == null) return null;
  return parseScheduleDate(
    String(context.year) + '-' +
    String(Number(monthDay[1])).padStart(2, '0') + '-' +
    String(Number(monthDay[2])).padStart(2, '0')
  );
}

function nearestVerticalBoundary(
  desired: number,
  candidates: number[],
  maximumDistance: number,
): number {
  const ranked = candidates
    .map((value) => ({ value, distance: Math.abs(value - desired) }))
    .sort((left, right) => left.distance - right.distance);
  const best = ranked[0];
  return best && best.distance <= maximumDistance ? best.value : desired;
}

function buildDateColumns(
  tokens: BoxToken[],
  detection: ScheduleTableStructureDetection,
): ScheduleMatrixDateColumn[] {
  const context = parseCalendarContext(tokens);
  const firstRows = detection.structure.rowBands.slice(0, 2);
  const headerZoneBottom = firstRows.length
    ? Math.max(...firstRows.map((band) => band.bounds.y + band.bounds.height))
    : detection.structure.tableBounds.y + detection.structure.tableBounds.height * 0.25;
  const anchors = tokens
    .map((token) => ({
      token,
      date: parseDateEvidence(token.text, context,
        token.cy >= detection.structure.tableBounds.y && token.cy <= headerZoneBottom),
    }))
    .filter((item): item is { token: BoxToken; date: string } => item.date != null)
    .sort((left, right) => left.token.cx - right.token.cx);

  const deduped = anchors.filter((item, index, all) =>
    all.findIndex((candidate) => candidate.date === item.date) === index
  );
  if (deduped.length < 2) return [];

  const centers = deduped.map((item) => item.token.cx);
  const gaps = centers.slice(1).map((center, index) => center - centers[index]).filter((gap) => gap > 0);
  const typicalGap = median(gaps);
  if (!typicalGap) return [];

  const vertical = detection.structure.evidence.verticalLinePositions;
  return deduped.map((item, index) => {
    const previous = deduped[index - 1];
    const next = deduped[index + 1];
    const rawLeft = previous
      ? (previous.token.cx + item.token.cx) / 2
      : item.token.cx - typicalGap / 2;
    const rawRight = next
      ? (item.token.cx + next.token.cx) / 2
      : item.token.cx + typicalGap / 2;
    const left = nearestVerticalBoundary(
      Math.max(0, rawLeft),
      vertical,
      typicalGap * 0.22,
    );
    const right = nearestVerticalBoundary(
      Math.min(detection.raster.width, rawRight),
      vertical,
      typicalGap * 0.22,
    );
    return {
      index,
      date: item.date,
      bounds: {
        x: Math.max(0, Math.min(left, right - 1)),
        y: 0,
        width: Math.max(1, right - left),
        height: detection.raster.height,
      },
      confidence: item.token.confidence,
      inferred: false,
    };
  });
}

function tokenInside(token: BoxToken, bounds: SchedulePixelBounds): boolean {
  return token.cx >= bounds.x &&
    token.cx < bounds.x + bounds.width &&
    token.cy >= bounds.y &&
    token.cy < bounds.y + bounds.height;
}

function likelyPersonText(token: BoxToken): boolean {
  if (!token.normalized || token.normalized.length > 30) return false;
  if (/\d/.test(token.normalized)) return false;
  if (classifyScheduleShiftLabel(token.text)) return false;
  if (/^(이름|성명|직원|사람|name|person|employee)$/.test(token.normalized)) return false;
  return /[가-힣a-z]/i.test(token.normalized);
}

function expandWeakRowsFromAnchors(
  tokens: BoxToken[],
  headerBottom: number,
  imageWidth: number,
  imageHeight: number,
): SchedulePixelBounds[] {
  const candidates = tokens
    .filter((token) => token.cy > headerBottom && likelyPersonText(token))
    .map((token) => token.cy)
    .sort((a, b) => a - b);

  const centers: number[] = [];
  for (const candidate of candidates) {
    if (!centers.length || Math.abs(candidate - centers[centers.length - 1]) > 8) {
      centers.push(candidate);
    } else {
      centers[centers.length - 1] = (centers[centers.length - 1] + candidate) / 2;
    }
  }
  if (!centers.length) return [];

  const typicalGap = median(
    centers.slice(1).map((value, index) => value - centers[index]).filter((value) => value > 5),
  ) || 36;

  return centers.map((center, index) => {
    const top = index === 0
      ? Math.max(headerBottom, center - typicalGap / 2)
      : (centers[index - 1] + center) / 2;
    const bottom = index === centers.length - 1
      ? Math.min(imageHeight, center + typicalGap / 2)
      : (center + centers[index + 1]) / 2;
    return {
      x: 0,
      y: Math.max(0, top),
      width: imageWidth,
      height: Math.max(1, bottom - top),
    };
  });
}

export interface ScheduleMatrixRecoveryEvidence {
  failureStage: 'DATE_HEADER' | 'PERSON_ROW_OR_OCCUPANCY';
  rasterWidth: number;
  rasterHeight: number;
  layoutWidth: number;
  layoutHeight: number;
  structureSource: string;
  pixelRowBands: number;
  pixelColumnBands: number;
  initialOcrTokens: number;
  calendarYearResolved: boolean;
  calendarMonthResolved: boolean;
  dateAnchorCount: number;
}

// Privacy-safe counts and gate identity; no names, raw OCR text, or images
// are sent anywhere. The private local evaluator may display these counts.
export function inspectScheduleMatrixFailure(
  detection: ScheduleTableStructureDetection,
  layout: ImageTextLayout,
): ScheduleMatrixRecoveryEvidence {
  const tokens = layout.tokens.map(box);
  const context = parseCalendarContext(tokens);
  const dateAnchors = buildDateColumns(tokens, detection);
  return {
    failureStage: dateAnchors.length < 2 ? 'DATE_HEADER' : 'PERSON_ROW_OR_OCCUPANCY',
    rasterWidth: detection.raster.width,
    rasterHeight: detection.raster.height,
    layoutWidth: layout.width,
    layoutHeight: layout.height,
    structureSource: detection.structure.evidence.source,
    pixelRowBands: detection.structure.rowBands.length,
    pixelColumnBands: detection.structure.columnBands.length,
    initialOcrTokens: layout.tokens.length,
    calendarYearResolved: context.year != null,
    calendarMonthResolved: context.month != null,
    dateAnchorCount: dateAnchors.length,
  };
}

export function buildScheduleCellMatrix(
  detection: ScheduleTableStructureDetection,
  layout: ImageTextLayout,
): ScheduleCellMatrix | null {
  const tokens = layout.tokens.map(box);
  const dates = buildDateColumns(tokens, detection);
  if (dates.length < 2) return null;

  const calendarContext = parseCalendarContext(tokens);
  const firstHeaderRows = detection.structure.rowBands.slice(0, 2);
  const headerZoneBottom = firstHeaderRows.length
    ? Math.max(...firstHeaderRows.map((band) => band.bounds.y + band.bounds.height))
    : detection.structure.tableBounds.y + detection.structure.tableBounds.height * 0.25;
  const dateHeaderTokens = tokens.filter(
    (token) =>
      token.cy >= detection.structure.tableBounds.y &&
      token.cy <= headerZoneBottom &&
      parseDateEvidence(token.text, calendarContext, true) != null,
  );
  // A shift label such as "쉬는시간" may occur deep in the body; it must
  // never push the header boundary down and hide actual person rows.
  const headerEvidence = dateHeaderTokens;
  const headerBottom = headerEvidence.length
    ? Math.max(...headerEvidence.map((token) => token.bottom))
    : Math.max(0, detection.structure.tableBounds.y);

  const firstDateLeft = Math.min(...dates.map((date) => date.bounds.x));
  const lastDateRight = Math.max(...dates.map((date) => date.bounds.x + date.bounds.width));
  const gridWidth = Math.max(1, lastDateRight - firstDateLeft);

  let rowBounds = detection.structure.rowBands
    .map((band) => band.bounds)
    .filter((bounds) =>
      bounds.y >= headerBottom - Math.max(2, bounds.height * 0.1)
    )
    .filter((bounds) => bounds.height >= 8);

  if (!rowBounds.length) {
    rowBounds = expandWeakRowsFromAnchors(
      tokens,
      headerBottom,
      detection.raster.width,
      detection.raster.height,
    );
  }

  if (!rowBounds.length) return null;

  const typicalHeight = median(rowBounds.map((bounds) => bounds.height).filter((height) => height > 0));
  if (typicalHeight > 0) {
    rowBounds = rowBounds.filter((bounds) =>
      bounds.height >= typicalHeight * 0.45 &&
      bounds.height <= typicalHeight * 2.4
    );
  }

  const rows: ScheduleMatrixPersonRow[] = [];
  const cells: ScheduleMatrixCell[] = [];

  for (const bounds of rowBounds) {
    const labelBounds: SchedulePixelBounds = {
      x: 0,
      y: bounds.y,
      width: Math.max(1, firstDateLeft),
      height: bounds.height,
    };
    const labelTokens = tokens
      .filter((token) => tokenInside(token, labelBounds) && likelyPersonText(token))
      .sort((left, right) => left.x - right.x);
    const preliminaryName = labelTokens.length
      ? labelTokens.map((token) => token.normalized).join('')
      : null;
    const preliminaryConfidence = labelTokens.length
      ? labelTokens.reduce((sum, token) => sum + token.confidence, 0) / labelTokens.length
      : 0;

    const provisionalCells = dates.map((date) => {
      const cellBounds: SchedulePixelBounds = {
        x: date.bounds.x,
        y: bounds.y,
        width: date.bounds.width,
        height: bounds.height,
      };
      return {
        date,
        bounds: cellBounds,
        visual: analyzeScheduleCellVisualEvidence(detection.raster, cellBounds),
      };
    });
    const labelVisual = analyzeScheduleCellVisualEvidence(detection.raster, labelBounds);
    const hasVisibleRowEvidence =
      labelVisual.occupancy !== 'EMPTY' ||
      provisionalCells.some((cell) => cell.visual.occupancy !== 'EMPTY');
    if (!hasVisibleRowEvidence) continue;

    const sourceRow = rows.length + 1;
    rows.push({
      sourceRow,
      bounds: {
        x: firstDateLeft,
        y: bounds.y,
        width: gridWidth,
        height: bounds.height,
      },
      labelBounds,
      preliminaryName,
      preliminaryConfidence,
    });

    for (const item of provisionalCells) {
      cells.push({
        id: 'cell::' + sourceRow + '::' + item.date.date,
        sourceRow,
        date: item.date.date,
        personLabelBounds: labelBounds,
        bounds: item.bounds,
        visual: item.visual,
      });
    }
  }

  if (!rows.length || !cells.length) return null;

  const dateConfidence = dates.reduce((sum, date) => sum + date.confidence, 0) / dates.length;
  const rowEvidenceRatio = rows.length / Math.max(1, rowBounds.length);
  const confidence = Math.max(
    0,
    Math.min(
      1,
      detection.structure.confidence * 0.45 +
      dateConfidence * 0.35 +
      rowEvidenceRatio * 0.2
    )
  );

  return {
    rows,
    dates,
    cells,
    confidence,
    geometrySource: detection.structure.evidence.source,
  };
}

export function buildScheduleMatrixProbeRegions(
  matrix: ScheduleCellMatrix,
): ScheduleMatrixProbeRegion[] {
  const regions: ScheduleMatrixProbeRegion[] = [];
  for (const row of matrix.rows) {
    regions.push({
      id: 'person::' + row.sourceRow,
      kind: 'person',
      sourceRow: row.sourceRow,
      date: null,
      bounds: row.labelBounds,
    });
  }
  for (const cell of matrix.cells) {
    regions.push({
      id: cell.id,
      kind: 'cell',
      sourceRow: cell.sourceRow,
      date: cell.date,
      bounds: cell.bounds,
    });
  }
  return regions;
}
