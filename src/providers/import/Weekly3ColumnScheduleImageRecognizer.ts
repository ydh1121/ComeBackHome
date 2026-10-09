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
 * This class is deliberately NOT selected in composition.ts until the
 * objective clean/degraded/browser and user-private holdout gates pass.
 * No source image is sent over the network by this adapter.
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
    const matrix = buildWeekly3ColumnPhysicalMatrix(detected, title);
    // Unsupported structure cannot be guessed into seven days.
    if (!matrix || matrix.days.length !== 7 ||
      matrix.rows.some(row => row.cells.length !== 21)) {
      throw new Error('WEEKLY_3COL_UNSUPPORTED_LAYOUT_REVIEW_REQUIRED');
    }
    await onProgress?.(49);
    const regions = weekly3ColumnProbeRegions(matrix);
    // Only CV-visible content gets time OCR; date and person ROIs always
    // get a recognition attempt. One shared matrix defines all crop coords.
    const recognized = await this.regionExtractor.extractRegions(file, regions, async (percent) => {
      await onProgress?.(Math.min(92, 49 + Math.round(percent * 0.43)));
    });
    const dates = resolveWeekly3ColumnDates(matrix, title, recognized.filter(x => x.purpose === 'date'));
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
      regionCount: regions.length,
      totalMs: Math.round(performance.now() - start),
    };
  }

  async parse(file: File, onProgress?: ImportProgressReporter): Promise<ParsedImport> {
    return (await this.evaluate(file, onProgress)).parsed;
  }
}
