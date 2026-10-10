import type {
  ImageScheduleRecognizer,
  ImageTextExtractor,
  ImportProgressReporter,
  ParsedImport,
  RegionalImageTextExtractor,
} from '../../application/contracts/providers';
import type { ScheduleTableStructureDetector } from './ScheduleTableStructureDetector';
import {
  buildWeekly3ColumnPhysicalMatrix,
  reconcileWeekly3ColumnObservedHeader,
  interpretWeekly3Column,
  resolveWeekly3ColumnDates,
  weekly3ColumnProbeRegions,
  type Weekly3ColumnInterpretation,
  type WeeklyPhysicalMatrix,
} from './Weekly3ColumnScheduleMatrix';

/**
 * Store-specific Monday-Sunday, start/end/break OCR.
 * The injected region recognizer is evaluated independently in CI.
 *
 * Selected by the actual image-upload composition only for the current
 * workplace 7x3 format. Unsupported images are rejected, not interpreted by
 * a generic fallback. OCR image bytes never leave the user's browser; the
 * only fetches are same-origin model/dictionary/WASM static assets.
 * Live release remains blocked pending private-original acceptance.
 */
export class Weekly3ColumnScheduleImageRecognizer implements ImageScheduleRecognizer {
  constructor(
    private readonly detector: ScheduleTableStructureDetector,
    private readonly headerExtractor: ImageTextExtractor,
    private readonly regionExtractor: RegionalImageTextExtractor,
    private readonly knownPersonNames: string[] | (() => Promise<string[]>) = [],
  ) {}

  async evaluate(
    file: File,
    onProgress?: ImportProgressReporter,
  ): Promise<{
    parsed: ParsedImport;
    matrix: WeeklyPhysicalMatrix;
    interpretation: Weekly3ColumnInterpretation;
    totalMs: number;
    regionCount: number;
  }> {
    const start = performance.now();
    await onProgress?.(5);
    const detected = await this.detector.detect(file);
    await onProgress?.(16);
    const title = await this.headerExtractor.extract(file, async (percent) => {
      await onProgress?.(Math.min(45, 16 + Math.round(percent * 0.29)));
    });
    const initialMatrix = buildWeekly3ColumnPhysicalMatrix(detected, title);
    // Unsupported structure cannot be guessed into seven days.
    if (!initialMatrix || initialMatrix.days.length !== 7 ||
      initialMatrix.rows.some(row => row.cells.length !== 21)) {
      throw new Error('WEEKLY_3COL_UNSUPPORTED_LAYOUT_REVIEW_REQUIRED');
    }
    await onProgress?.(49);
    const regions = weekly3ColumnProbeRegions(initialMatrix);
    // Only CV-visible content gets time OCR; date and person ROIs always
    // get a recognition attempt. Initial cell OCR can reveal a label header
    // that broad Tesseract dropped. Those observed labels are never shifts.
    const initialRecognized = await this.regionExtractor.extractRegions(file, regions, async (percent) => {
      await onProgress?.(Math.min(86, 49 + Math.round(percent * 0.37)));
    });
    const aligned = reconcileWeekly3ColumnObservedHeader(initialMatrix, initialRecognized);
    const matrix = aligned.matrix;
    let recognized = aligned.regional;
    if (aligned.shiftedRows > 0) {
      // Only newly exposed physical date bands need extra OCR: all retained
      // employee cells already have real Paddle observations and remapped IDs.
      const observedIds = new Set(recognized.map(item => item.id));
      const extraDateRegions = weekly3ColumnProbeRegions(matrix).filter(
        region => region.purpose === 'date' && !observedIds.has(region.id),
      );
      if (extraDateRegions.length) {
        const extra = await this.regionExtractor.extractRegions(file, extraDateRegions);
        recognized = [...recognized, ...extra];
      }
    }
    const dates = resolveWeekly3ColumnDates(matrix, title,
      recognized.filter(x => x.purpose === 'date' || x.purpose === 'context'));
    const names = typeof this.knownPersonNames === 'function'
      ? await this.knownPersonNames()
      : this.knownPersonNames;
    const interpretation = interpretWeekly3Column(matrix, dates, recognized, names);
    if (!interpretation.parsed) {
      throw new Error((interpretation.blockedReason ?? 'WEEKLY_REVIEW_REQUIRED') +
        ' dates=' + dates.observedDayAnchors +
        ' physicalRows=' + matrix.rows.length);
    }
    await onProgress?.(100);
    return {
      parsed: interpretation.parsed,
      matrix,
      interpretation,
      regionCount: recognized.length,
      totalMs: Math.round(performance.now() - start),
    };
  }

  async parse(file: File, onProgress?: ImportProgressReporter): Promise<ParsedImport> {
    return (await this.evaluate(file, onProgress)).parsed;
  }
}
