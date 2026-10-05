import type { TesseractAssetPaths } from './TesseractScheduleImageTextExtractor';

export const OCR_RUNTIME_ID = 'tesseract-7.0.0-data-1.0.0';

export const SAME_ORIGIN_TESSERACT_ASSETS: TesseractAssetPaths = {
  workerPath: '/ocr/tesseract-7.0.0-data-1.0.0/worker/worker.min.js',
  corePath: '/ocr/tesseract-7.0.0-data-1.0.0/core/',
  langPath: '/ocr/tesseract-7.0.0-data-1.0.0/lang/',
};
