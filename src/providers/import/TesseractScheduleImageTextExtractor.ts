import { createWorker, PSM } from 'tesseract.js';
import type {
  ImageRasterPreprocessor,
  ImageTextExtractor,
  ImageTextLayout,
  ImageTextToken,
  PreparedImageRaster,
} from '../../application/contracts/providers';

interface OcrBbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface OcrWord {
  text: string;
  confidence: number;
  bbox: OcrBbox;
}

interface OcrLine {
  words?: OcrWord[];
}

interface OcrParagraph {
  lines?: OcrLine[];
}

interface OcrBlock {
  paragraphs?: OcrParagraph[];
}

interface OcrPage {
  blocks?: OcrBlock[] | null;
}

export interface ScheduleOcrWorker {
  setParameters(params: Record<string, string>): Promise<unknown>;
  recognize(
    image: File | Blob,
    options?: Record<string, unknown>,
    output?: Record<string, boolean>,
  ): Promise<{ data: OcrPage }>;
  terminate(): Promise<unknown>;
}

export interface ScheduleOcrWorkerFactory {
  create(languages: string[]): Promise<ScheduleOcrWorker>;
}

export interface TesseractAssetPaths {
  workerPath: string;
  corePath: string;
  langPath: string;
}

export interface ScheduleOcrExtractorOptions {
  languages?: string[];
  minimumConfidence?: number;
}

function assertRootRelative(path: string, label: string): void {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error(label + ' must be a same-origin root-relative path.');
  }
  if (/^[a-z]+:\/\//i.test(path)) {
    throw new Error(label + ' must not reference an external origin.');
  }
}

export class TesseractJsWorkerFactory implements ScheduleOcrWorkerFactory {
  constructor(private readonly assets: TesseractAssetPaths) {
    assertRootRelative(assets.workerPath, 'workerPath');
    assertRootRelative(assets.corePath, 'corePath');
    assertRootRelative(assets.langPath, 'langPath');
  }

  async create(languages: string[]): Promise<ScheduleOcrWorker> {
    const worker = await createWorker(languages, 1, {
      workerPath: this.assets.workerPath,
      corePath: this.assets.corePath,
      langPath: this.assets.langPath,
    });
    return worker as unknown as ScheduleOcrWorker;
  }
}

function decodeWithImageElement(file: File): Promise<{ width: number; height: number; image: HTMLImageElement }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
        image,
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image could not be decoded for local OCR.'));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Image preprocessing could not create a raster blob.'));
    }, 'image/png');
  });
}

export class BrowserScheduleOcrPreprocessor implements ImageRasterPreprocessor {
  constructor(
    private readonly minRasterWidth = 3200,
    private readonly maxRasterWidth = 4096,
  ) {}

  async prepare(file: File): Promise<PreparedImageRaster> {
    const decoded = await decodeWithImageElement(file);
    const desiredScale = Math.max(1, this.minRasterWidth / decoded.width);
    const cappedScale = Math.min(desiredScale, this.maxRasterWidth / decoded.width);
    const scale = Math.max(1, cappedScale);

    if (scale === 1) {
      return {
        image: file,
        sourceWidth: decoded.width,
        sourceHeight: decoded.height,
        rasterWidth: decoded.width,
        rasterHeight: decoded.height,
      };
    }

    const rasterWidth = Math.max(1, Math.round(decoded.width * scale));
    const rasterHeight = Math.max(1, Math.round(decoded.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = rasterWidth;
    canvas.height = rasterHeight;

    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('2D canvas is unavailable for local OCR preprocessing.');

    context.imageSmoothingEnabled = true;
    context.drawImage(decoded.image, 0, 0, rasterWidth, rasterHeight);

    return {
      image: await canvasToBlob(canvas),
      sourceWidth: decoded.width,
      sourceHeight: decoded.height,
      rasterWidth,
      rasterHeight,
    };
  }
}

function flattenWords(page: OcrPage): OcrWord[] {
  const words: OcrWord[] = [];
  for (const block of page.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const word of line.words ?? []) {
          if (word?.text && word?.bbox) words.push(word);
        }
      }
    }
  }
  return words;
}

function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value > 1 ? value / 100 : value));
}

function toToken(word: OcrWord, raster: PreparedImageRaster): ImageTextToken | null {
  const text = String(word.text ?? '').normalize('NFKC').trim();
  if (!text) return null;

  const scaleX = raster.sourceWidth / raster.rasterWidth;
  const scaleY = raster.sourceHeight / raster.rasterHeight;
  const x0 = Math.min(word.bbox.x0, word.bbox.x1);
  const x1 = Math.max(word.bbox.x0, word.bbox.x1);
  const y0 = Math.min(word.bbox.y0, word.bbox.y1);
  const y1 = Math.max(word.bbox.y0, word.bbox.y1);

  if (![x0, x1, y0, y1].every(Number.isFinite)) return null;

  return {
    text,
    x: x0 * scaleX,
    y: y0 * scaleY,
    width: Math.max(0, x1 - x0) * scaleX,
    height: Math.max(0, y1 - y0) * scaleY,
    confidence: normalizeConfidence(word.confidence),
  };
}

function intersectionOverUnion(left: ImageTextToken, right: ImageTextToken): number {
  const leftRight = left.x + left.width;
  const leftBottom = left.y + left.height;
  const rightRight = right.x + right.width;
  const rightBottom = right.y + right.height;

  const x0 = Math.max(left.x, right.x);
  const y0 = Math.max(left.y, right.y);
  const x1 = Math.min(leftRight, rightRight);
  const y1 = Math.min(leftBottom, rightBottom);

  const intersection = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  if (!intersection) return 0;

  const union =
    left.width * left.height +
    right.width * right.height -
    intersection;
  return union > 0 ? intersection / union : 0;
}

function numericShape(value: string): boolean {
  return /^\d{1,4}(?:[.,:]\d{1,2})?(?:[-/.]\d{1,4})*$/.test(
    value.normalize('NFKC').replace(/\s+/g, ''),
  );
}

function explicitSchedulePunctuation(value: string): boolean {
  return /[.,:]/.test(value) && numericShape(value);
}

function mergeTokens(
  general: ImageTextToken[],
  numeric: ImageTextToken[],
): ImageTextToken[] {
  const merged = [...general];

  for (const candidate of numeric) {
    const overlaps = merged
      .map((token, index) => ({ token, index, overlap: intersectionOverUnion(token, candidate) }))
      .filter((item) => item.overlap >= 0.42)
      .sort((a, b) => b.overlap - a.overlap);

    const best = overlaps[0];
    if (!best) {
      merged.push(candidate);
      continue;
    }

    const existing = best.token;

    // Never let a numeric-only pass erase semantic text such as a person name,
    // schedule label, or special-note string that happens to contain numbers.
    if (!numericShape(existing.text)) {
      continue;
    }

    const preferNumeric =
      candidate.confidence > existing.confidence + 0.08 ||
      (
        explicitSchedulePunctuation(candidate.text) &&
        !explicitSchedulePunctuation(existing.text) &&
        candidate.confidence >= existing.confidence - 0.12
      );

    if (preferNumeric) merged[best.index] = candidate;
  }

  return merged
    .filter((token) => token.text.trim().length > 0)
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

export class TesseractScheduleImageTextExtractor implements ImageTextExtractor {
  private readonly languages: string[];
  private readonly minimumConfidence: number;

  constructor(
    private readonly workers: ScheduleOcrWorkerFactory,
    private readonly preprocessor: ImageRasterPreprocessor,
    options: ScheduleOcrExtractorOptions = {},
  ) {
    this.languages = options.languages ?? ['kor', 'eng'];
    this.minimumConfidence = options.minimumConfidence ?? 0.18;
  }

  async extract(file: File): Promise<ImageTextLayout> {
    const raster = await this.preprocessor.prepare(file);
    const worker = await this.workers.create(this.languages);

    try {
      await worker.setParameters({
        tessedit_pageseg_mode: String(PSM.SPARSE_TEXT),
        preserve_interword_spaces: '1',
      });
      const generalResult = await worker.recognize(
        raster.image,
        { rotateAuto: true },
        { text: true, blocks: true },
      );

      await worker.setParameters({
        tessedit_pageseg_mode: String(PSM.SPARSE_TEXT),
        tessedit_char_whitelist: '0123456789.,:/-',
        preserve_interword_spaces: '1',
      });
      const numericResult = await worker.recognize(
        raster.image,
        { rotateAuto: false },
        { text: true, blocks: true },
      );

      const general = flattenWords(generalResult.data)
        .map((word) => toToken(word, raster))
        .filter((token): token is ImageTextToken => token != null)
        .filter((token) => token.confidence >= this.minimumConfidence);

      const numeric = flattenWords(numericResult.data)
        .map((word) => toToken(word, raster))
        .filter((token): token is ImageTextToken => token != null)
        .filter((token) => token.confidence >= this.minimumConfidence)
        .filter((token) => numericShape(token.text));

      return {
        width: raster.sourceWidth,
        height: raster.sourceHeight,
        tokens: mergeTokens(general, numeric),
      };
    } finally {
      await worker.terminate();
    }
  }
}
