export interface SchedulePixelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScheduleRasterPlane {
  width: number;
  height: number;
  luminance: Uint8Array;
}

export interface ScheduleStructureBand {
  index: number;
  bounds: SchedulePixelBounds;
  confidence: number;
}

export interface ScheduleTableStructureEvidence {
  horizontalLinePositions: number[];
  verticalLinePositions: number[];
  horizontalContinuity: number;
  verticalContinuity: number;
  repeatedRowSpacing: number;
  repeatedColumnSpacing: number;
  source: 'PIXEL_GRID' | 'PIXEL_PARTIAL' | 'WEAK_PIXEL';
}

export interface ScheduleTableStructure {
  imageWidth: number;
  imageHeight: number;
  tableBounds: SchedulePixelBounds;
  rowBands: ScheduleStructureBand[];
  columnBands: ScheduleStructureBand[];
  confidence: number;
  evidence: ScheduleTableStructureEvidence;
}

export interface ScheduleTableStructureDetection {
  structure: ScheduleTableStructure;
  raster: ScheduleRasterPlane;
  preprocessingMs: number;
  structureDetectionMs: number;
}

export interface ScheduleTableStructureDetector {
  detect(file: File): Promise<ScheduleTableStructureDetection>;
}

export interface ScheduleCellVisualEvidence {
  foregroundDensity: number;
  edgeDensity: number;
  backgroundLuminance: number;
  luminanceSpread: number;
  occupancy: 'EMPTY' | 'CONTENT' | 'UNCERTAIN';
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values: number[], ratio: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * ratio)));
  return sorted[index];
}

function repeatedSpacingScore(positions: number[]): number {
  if (positions.length < 3) return 0;
  const gaps = positions
    .slice(1)
    .map((value, index) => value - positions[index])
    .filter((value) => value > 2);
  if (gaps.length < 2) return 0;
  const typical = median(gaps);
  if (typical <= 0) return 0;
  const deviations = gaps.map((gap) => Math.abs(gap - typical) / typical);
  return clamp(1 - median(deviations) * 2.2);
}

function projectionScores(
  raster: ScheduleRasterPlane,
  direction: 'horizontal' | 'vertical',
): number[] {
  const { width, height, luminance } = raster;
  const length = direction === 'horizontal' ? height : width;
  const cross = direction === 'horizontal' ? width : height;
  const scores = new Array<number>(length).fill(0);

  for (let primary = 0; primary < length; primary += 1) {
    let dark = 0;
    let strongEdge = 0;
    let sampled = 0;

    for (let secondary = 0; secondary < cross; secondary += 1) {
      const x = direction === 'horizontal' ? secondary : primary;
      const y = direction === 'horizontal' ? primary : secondary;
      const index = y * width + x;
      const value = luminance[index];
      if (value < 118) dark += 1;

      if (primary > 0) {
        const previousIndex = direction === 'horizontal'
          ? (y - 1) * width + x
          : y * width + (x - 1);
        if (Math.abs(value - luminance[previousIndex]) >= 36) strongEdge += 1;
      }
      sampled += 1;
    }

    const darkContinuity = sampled ? dark / sampled : 0;
    const edgeContinuity = sampled ? strongEdge / sampled : 0;
    scores[primary] = Math.max(darkContinuity, edgeContinuity * 0.82);
  }

  return scores;
}

function clusterProjectionPeaks(scores: number[]): Array<{ position: number; score: number }> {
  if (!scores.length) return [];
  const q90 = percentile(scores, 0.9);
  const q97 = percentile(scores, 0.97);
  const threshold = Math.max(0.105, q90 * 1.45, q97 * 0.55);
  const groups: number[][] = [];
  let current: number[] = [];

  for (let index = 0; index < scores.length; index += 1) {
    if (scores[index] >= threshold) {
      current.push(index);
    } else if (current.length) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length) groups.push(current);

  return groups
    .map((group) => {
      const weighted = group.reduce((sum, index) => sum + index * scores[index], 0);
      const total = group.reduce((sum, index) => sum + scores[index], 0);
      return {
        position: total > 0 ? weighted / total : median(group),
        score: Math.max(...group.map((index) => scores[index])),
      };
    })
    .filter((item) => item.score >= 0.105)
    .sort((left, right) => left.position - right.position);
}

function bandsFromLines(
  positions: number[],
  maximum: number,
  orthogonalStart: number,
  orthogonalLength: number,
  orientation: 'row' | 'column',
): ScheduleStructureBand[] {
  if (positions.length < 2) return [];
  const bands: ScheduleStructureBand[] = [];

  for (let index = 0; index < positions.length - 1; index += 1) {
    const start = Math.max(0, Math.round(positions[index]));
    const end = Math.min(maximum, Math.round(positions[index + 1]));
    const size = end - start;
    if (size < 7) continue;

    bands.push({
      index: bands.length,
      bounds: orientation === 'row'
        ? { x: orthogonalStart, y: start, width: orthogonalLength, height: size }
        : { x: start, y: orthogonalStart, width: size, height: orthogonalLength },
      confidence: 1,
    });
  }
  return bands;
}

export function detectScheduleTableStructureFromRaster(
  raster: ScheduleRasterPlane,
): ScheduleTableStructure {
  if (
    raster.width <= 0 ||
    raster.height <= 0 ||
    raster.luminance.length !== raster.width * raster.height
  ) {
    throw new Error('Schedule table raster is invalid.');
  }

  const horizontalPeaks = clusterProjectionPeaks(projectionScores(raster, 'horizontal'));
  const verticalPeaks = clusterProjectionPeaks(projectionScores(raster, 'vertical'));
  const horizontalPositions = horizontalPeaks.map((item) => item.position);
  const verticalPositions = verticalPeaks.map((item) => item.position);

  const hasHorizontalGrid = horizontalPositions.length >= 3;
  const hasVerticalGrid = verticalPositions.length >= 3;
  const left = hasVerticalGrid ? Math.max(0, Math.floor(verticalPositions[0])) : 0;
  const right = hasVerticalGrid
    ? Math.min(raster.width, Math.ceil(verticalPositions[verticalPositions.length - 1]))
    : raster.width;
  const top = hasHorizontalGrid ? Math.max(0, Math.floor(horizontalPositions[0])) : 0;
  const bottom = hasHorizontalGrid
    ? Math.min(raster.height, Math.ceil(horizontalPositions[horizontalPositions.length - 1]))
    : raster.height;

  const tableBounds = {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };

  const rowBands = hasHorizontalGrid
    ? bandsFromLines(horizontalPositions, raster.height, left, tableBounds.width, 'row')
    : [];
  const columnBands = hasVerticalGrid
    ? bandsFromLines(verticalPositions, raster.width, top, tableBounds.height, 'column')
    : [];

  const horizontalContinuity = horizontalPeaks.length
    ? median(horizontalPeaks.map((item) => item.score))
    : 0;
  const verticalContinuity = verticalPeaks.length
    ? median(verticalPeaks.map((item) => item.score))
    : 0;
  const repeatedRowSpacing = repeatedSpacingScore(horizontalPositions);
  const repeatedColumnSpacing = repeatedSpacingScore(verticalPositions);

  const source =
    hasHorizontalGrid && hasVerticalGrid
      ? 'PIXEL_GRID'
      : hasHorizontalGrid || hasVerticalGrid
        ? 'PIXEL_PARTIAL'
        : 'WEAK_PIXEL';

  const confidence = clamp(
    (hasHorizontalGrid ? 0.2 : 0) +
    (hasVerticalGrid ? 0.2 : 0) +
    horizontalContinuity * 0.18 +
    verticalContinuity * 0.18 +
    repeatedRowSpacing * 0.12 +
    repeatedColumnSpacing * 0.12,
  );

  return {
    imageWidth: raster.width,
    imageHeight: raster.height,
    tableBounds,
    rowBands,
    columnBands,
    confidence,
    evidence: {
      horizontalLinePositions: horizontalPositions.map((value) => Math.round(value)),
      verticalLinePositions: verticalPositions.map((value) => Math.round(value)),
      horizontalContinuity: Number(horizontalContinuity.toFixed(4)),
      verticalContinuity: Number(verticalContinuity.toFixed(4)),
      repeatedRowSpacing: Number(repeatedRowSpacing.toFixed(4)),
      repeatedColumnSpacing: Number(repeatedColumnSpacing.toFixed(4)),
      source,
    },
  };
}

export function analyzeScheduleCellVisualEvidence(
  raster: ScheduleRasterPlane,
  bounds: SchedulePixelBounds,
): ScheduleCellVisualEvidence {
  const insetX = Math.max(1, Math.floor(bounds.width * 0.06));
  const insetY = Math.max(1, Math.floor(bounds.height * 0.1));
  const x0 = Math.max(0, Math.floor(bounds.x + insetX));
  const y0 = Math.max(0, Math.floor(bounds.y + insetY));
  const x1 = Math.min(raster.width, Math.ceil(bounds.x + bounds.width - insetX));
  const y1 = Math.min(raster.height, Math.ceil(bounds.y + bounds.height - insetY));
  const values: number[] = [];

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      values.push(raster.luminance[y * raster.width + x]);
    }
  }

  if (!values.length) {
    return {
      foregroundDensity: 0,
      edgeDensity: 0,
      backgroundLuminance: 255,
      luminanceSpread: 0,
      occupancy: 'UNCERTAIN',
    };
  }

  const background = median(values);
  const low = percentile(values, 0.1);
  const high = percentile(values, 0.9);
  const spread = high - low;
  let foreground = 0;
  let edges = 0;
  let edgeSamples = 0;

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const value = raster.luminance[y * raster.width + x];
      if (Math.abs(value - background) >= 34) foreground += 1;

      if (x + 1 < x1) {
        edgeSamples += 1;
        if (Math.abs(value - raster.luminance[y * raster.width + x + 1]) >= 30) edges += 1;
      }
      if (y + 1 < y1) {
        edgeSamples += 1;
        if (Math.abs(value - raster.luminance[(y + 1) * raster.width + x]) >= 30) edges += 1;
      }
    }
  }

  const foregroundDensity = foreground / values.length;
  const edgeDensity = edgeSamples ? edges / edgeSamples : 0;
  const occupancy =
    foregroundDensity <= 0.012 && edgeDensity <= 0.018 && spread <= 22
      ? 'EMPTY'
      : foregroundDensity >= 0.028 || edgeDensity >= 0.035 || spread >= 48
        ? 'CONTENT'
        : 'UNCERTAIN';

  return {
    foregroundDensity: Number(foregroundDensity.toFixed(4)),
    edgeDensity: Number(edgeDensity.toFixed(4)),
    backgroundLuminance: Number(background.toFixed(1)),
    luminanceSpread: Number(spread.toFixed(1)),
    occupancy,
  };
}

async function decodeScheduleImage(file: File): Promise<ScheduleRasterPlane> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Schedule image could not be decoded for table structure detection.'));
      element.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!context) throw new Error('2D canvas is unavailable for table structure detection.');
    context.drawImage(image, 0, 0);

    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const luminance = new Uint8Array(canvas.width * canvas.height);
    for (let index = 0; index < luminance.length; index += 1) {
      const offset = index * 4;
      luminance[index] = Math.round(
        rgba[offset] * 0.299 +
        rgba[offset + 1] * 0.587 +
        rgba[offset + 2] * 0.114
      );
    }
    return { width: canvas.width, height: canvas.height, luminance };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export class BrowserScheduleTableStructureDetector implements ScheduleTableStructureDetector {
  async detect(file: File): Promise<ScheduleTableStructureDetection> {
    const started = performance.now();
    const raster = await decodeScheduleImage(file);
    const afterPreprocessing = performance.now();
    const structure = detectScheduleTableStructureFromRaster(raster);
    const completed = performance.now();

    return {
      structure,
      raster,
      preprocessingMs: Math.round(afterPreprocessing - started),
      structureDetectionMs: Math.round(completed - afterPreprocessing),
    };
  }
}
