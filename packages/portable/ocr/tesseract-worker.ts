import { createWorker } from 'tesseract.js';
import type { ImageRasterPreprocessor, PreparedImageRaster } from './contracts';

export interface OcrBbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrWord {
  text: string;
  confidence: number;
  bbox: OcrBbox;
}

export interface OcrLine {
  words?: OcrWord[];
}

export interface OcrParagraph {
  lines?: OcrLine[];
}

export interface OcrBlock {
  paragraphs?: OcrParagraph[];
}

export interface OcrPage {
  blocks?: OcrBlock[] | null;
  text?: string;
  confidence?: number;
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

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
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

