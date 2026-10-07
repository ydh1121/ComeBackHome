import type {
  ImageScheduleRecognizer,
  ImageTextProbeRegion,
  ImageTextProbeResult,
  ImportProgressReporter,
  ParsedImport,
  ParsedImportPerson,
  ParsedScheduleCandidate,
  ParsedScheduleReviewCandidate,
  RegionalImageTextExtractor,
} from '../../application/contracts/providers';
import type { ScheduleTableStructureDetector } from './ScheduleTableStructureDetector';
import {
  buildScheduleCellMatrix,
  buildScheduleMatrixProbeRegions,
  type ScheduleCellMatrix,
  type ScheduleMatrixPersonRow,
} from './ScheduleCellMatrix';
import { parseScheduleImageClock } from './StructuredTableImageScheduleRecognizer';

function normalizePersonCandidate(value: string): string | null {
  const normalized = String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, '');
  if (normalized.length < 2 || normalized.length > 30) return null;
  if (/\d/.test(normalized)) return null;
  if (!/[가-힣a-z]/i.test(normalized)) return null;
  return normalized.toLowerCase();
}

function parseTimeEvidence(value: string): string[] {
  const normalized = String(value ?? '').normalize('NFKC').trim();
  const direct = parseScheduleImageClock(normalized);
  if (direct) return [direct];

  const parts = normalized
    .replace(/[~〜～–—]/g, '-')
    .split('-')
    .map((part) => part.trim())
    .filter(Boolean);
  const parsed = parts
    .map((part) => parseScheduleImageClock(part))
    .filter((item): item is string => item != null);
  return parsed.length >= 2 ? parsed.slice(0, 2) : parsed;
}

function rowName(
  row: ScheduleMatrixPersonRow,
  regional: Map<string, ImageTextProbeResult>,
): { sourceName: string; confidence: number; unreadable: boolean } {
  const focused = regional.get('person::' + row.sourceRow);
  const focusedName = normalizePersonCandidate(focused?.text ?? '');
  if (focusedName) {
    return {
      sourceName: focusedName,
      confidence: Math.max(0.2, focused?.confidence ?? 0),
      unreadable: false,
    };
  }

  const preliminary = normalizePersonCandidate(row.preliminaryName ?? '');
  if (preliminary) {
    return {
      sourceName: preliminary,
      confidence: Math.max(0.15, row.preliminaryConfidence),
      unreadable: false,
    };
  }

  return {
    sourceName: '인식불확실행' + row.sourceRow,
    confidence: 0.12,
    unreadable: true,
  };
}

function cellTimes(result: ImageTextProbeResult | undefined): {
  start: string | null;
  end: string | null;
  confidence: number;
} {
  if (!result) return { start: null, end: null, confidence: 0 };

  const orderedTokens = [...result.tokens].sort((left, right) => left.x - right.x);
  const evidence: Array<{ value: string; confidence: number }> = [];

  for (const token of orderedTokens) {
    for (const value of parseTimeEvidence(token.text)) {
      evidence.push({ value, confidence: token.confidence });
    }
  }
  if (!evidence.length) {
    for (const value of parseTimeEvidence(result.text)) {
      evidence.push({ value, confidence: result.confidence });
    }
  }

  const unique = evidence.filter((item, index, all) =>
    all.findIndex((candidate) => candidate.value === item.value) === index
  );
  const start = unique[0] ?? null;
  const end = unique[1] ?? null;

  return {
    start: start?.value ?? null,
    end: end?.value ?? null,
    confidence: start && end
      ? Math.min(start.confidence, end.confidence)
      : start?.confidence ?? end?.confidence ?? result.confidence,
  };
}

function probeRegions(matrix: ScheduleCellMatrix): ImageTextProbeRegion[] {
  return buildScheduleMatrixProbeRegions(matrix).map((region) => ({
    id: region.id,
    purpose: region.kind,
    x: region.bounds.x,
    y: region.bounds.y,
    width: region.bounds.width,
    height: region.bounds.height,
  }));
}

export class StructureFirstScheduleImageRecognizer implements ImageScheduleRecognizer {
  constructor(
    private readonly detector: ScheduleTableStructureDetector,
    private readonly extractor: RegionalImageTextExtractor,
  ) {}

  async parse(
    file: File,
    onProgress?: ImportProgressReporter,
  ): Promise<ParsedImport> {
    await onProgress?.(8);
    const detection = await this.detector.detect(file);
    await onProgress?.(18);

    const layout = await this.extractor.extract(file, async (progress) => {
      await onProgress?.(Math.min(58, 18 + Math.round(progress * 0.43)));
    });
    await onProgress?.(60);

    const matrix = buildScheduleCellMatrix(detection, layout);
    if (!matrix || matrix.rows.length === 0 || matrix.dates.length < 2) {
      throw new Error(
        '표 구조를 안정적으로 복원하지 못했습니다. ' +
        'pixelSource=' + detection.structure.evidence.source +
        ' rows=' + detection.structure.rowBands.length +
        ' columns=' + detection.structure.columnBands.length
      );
    }

    const regions = probeRegions(matrix);
    const regionResults = await this.extractor.extractRegions(
      file,
      regions,
      async (progress) => {
        await onProgress?.(60 + Math.round(progress * 0.32));
      },
    );
    const byRegion = new Map(regionResults.map((result) => [result.id, result]));
    await onProgress?.(94);

    const peopleByRow = new Map(
      matrix.rows.map((row) => [row.sourceRow, rowName(row, byRegion)])
    );
    const detectedPeople: ParsedImportPerson[] = matrix.rows.map((row) => {
      const person = peopleByRow.get(row.sourceRow)!;
      return {
        sourceName: person.sourceName,
        confidence: person.confidence,
      };
    });

    const scheduleCandidates: ParsedScheduleCandidate[] = [];
    const reviewCandidates: ParsedScheduleReviewCandidate[] = [];
    let workCount = 0;
    let offCount = 0;
    let incompleteCount = 0;
    let unreadableCount = 0;

    for (const cell of matrix.cells) {
      const person = peopleByRow.get(cell.sourceRow);
      if (!person) continue;
      const time = cellTimes(byRegion.get(cell.id));
      const dateConfidence =
        matrix.dates.find((date) => date.date === cell.date)?.confidence ?? 0.5;
      const confidence = Math.max(
        0.05,
        Math.min(
          person.confidence || 0.12,
          dateConfidence,
          time.confidence || matrix.confidence,
        )
      );

      if (time.start && time.end) {
        workCount += 1;
        scheduleCandidates.push({
          sourcePersonName: person.sourceName,
          date: cell.date,
          start: time.start,
          end: time.end,
          sourceRow: cell.sourceRow,
          confidence,
        });
        continue;
      }

      if (time.start || time.end) {
        incompleteCount += 1;
        reviewCandidates.push({
          sourcePersonName: person.sourceName,
          date: cell.date,
          start: time.start,
          end: time.end,
          sourceRow: cell.sourceRow,
          confidence,
          recognitionState: 'INCOMPLETE',
          enabled: true,
        });
        continue;
      }

      if (cell.visual.occupancy === 'EMPTY') {
        offCount += 1;
        reviewCandidates.push({
          sourcePersonName: person.sourceName,
          date: cell.date,
          start: null,
          end: null,
          sourceRow: cell.sourceRow,
          confidence: Math.min(confidence, 0.88),
          recognitionState: 'OFF',
          enabled: false,
        });
      } else {
        unreadableCount += 1;
        reviewCandidates.push({
          sourcePersonName: person.sourceName,
          date: cell.date,
          start: null,
          end: null,
          sourceRow: cell.sourceRow,
          confidence: Math.min(confidence, 0.45),
          recognitionState: 'UNREADABLE',
          enabled: true,
        });
      }
    }

    if (!scheduleCandidates.length && !reviewCandidates.length) {
      throw new Error('표 구조는 찾았지만 사람×날짜 셀에서 일정 증거를 생성하지 못했습니다.');
    }

    const finalConfidence = Math.max(
      0.05,
      Math.min(
        1,
        matrix.confidence * 0.72 +
        (detectedPeople.filter((person) => person.confidence >= 0.5).length /
          Math.max(1, detectedPeople.length)) * 0.28
      )
    );

    await onProgress?.(98);
    return {
      detectedPeople,
      scheduleCandidates,
      reviewCandidates,
      structure: {
        sheet: '이미지 근무표 / structure-first pixel-cell-matrix',
        headerRow: 0,
        personColumn: 'pixel row geometry + focused person-label ROI',
        dateColumn: 'date anchors snapped to pixel table geometry',
        shiftColumn:
          'cell-scoped OCR / WORK=' + workCount +
          ' OFF=' + offCount +
          ' INCOMPLETE=' + incompleteCount +
          ' UNREADABLE=' + unreadableCount,
        needsReview: true,
      },
      confidence: finalConfidence,
    };
  }
}
