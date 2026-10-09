import type {
  ImageTextLayout, ImageTextProbeRegion, ImageTextProbeResult,
  ImportProgressReporter, RegionalImageTextExtractor,
} from '../../application/contracts/providers';
import {
  createPaddleDetectedRegionRecognizer, type PaddleRegionResult,
} from './PaddleOnnxRegionalExtractor.js';

/**
 * Actual app adapter, not a fixture recognizer. Source images stay inside
 * browser memory. All assets are same-origin and the ONNX SHA256 is pinned.
 * One inference session per adapter; failed init is evicted for safe retries.
 * Concurrent imports are serialized to protect WASM session lifecycle.
 */
export class PaddleWeeklyRegionalTextExtractor implements RegionalImageTextExtractor {
  private session: Promise<PaddleRegionResult> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => { void this.dispose(); }, {once:true});
    }
  }

  // Weekly3ColumnScheduleImageRecognizer owns full-image/header OCR via its
  // separate headerExtractor. Paddle is authorized ONLY for physical regions.
  async extract(_file: File): Promise<ImageTextLayout> {
    throw new Error('WEEKLY_PADDLE_REGION_ONLY');
  }

  async extractRegions(
    file: File,
    regions: ImageTextProbeRegion[],
    onProgress?: ImportProgressReporter,
  ): Promise<ImageTextProbeResult[]> {
    if (this.disposed) throw new Error('WEEKLY_PADDLE_SESSION_DISPOSED');
    if (!file.type.startsWith('image/') || file.size > 20 * 1024 * 1024) {
      throw new Error('WEEKLY_PADDLE_INVALID_IMAGE_OR_TOO_LARGE');
    }
    const task = this.queue.catch(() => undefined).then(async () => {
      if (this.disposed) throw new Error('WEEKLY_PADDLE_SESSION_DISPOSED');
      await onProgress?.(5);
      const running = this.session ??= createPaddleDetectedRegionRecognizer({
        modelUrl:'/ocr/weekly/inference.onnx',
        dictionaryUrl:'/ocr/weekly/dict.json',
        wasmBase:'/ort/',
      });
      let recognizer: PaddleRegionResult;
      try {
        recognizer = await running;
        await onProgress?.(35);
        const result = await recognizer.recognizeRegions(file,regions);
        await onProgress?.(100);
        return result.results;
      } catch (error) {
        // A partial or aborted model state must never silently fall back to
        // Tesseract, fabricate OCR data, or continue with stale approval.
        this.session = null;
        try { await running.then(x => x.release()); } catch { /* init failed */ }
        throw error;
      }
    });
    this.queue = task;
    return task;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    try { await this.queue; } catch { /* drain failed import */ }
    const current = this.session;
    this.session = null;
    if (current) await current.then(x => x.release()).catch(() => undefined);
  }
}
