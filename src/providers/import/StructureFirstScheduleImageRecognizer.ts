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
import type {
  ScheduleTableStructureDetection,
  ScheduleTableStructureDetector,
} from './ScheduleTableStructureDetector';
import { pixelSupportedColumnBounds } from './ScheduleTableStructureDetector';
import {
  buildScheduleCellMatrix,
  buildScheduleMatrixProbeRegions,
  inspectScheduleMatrixInput,
  type ScheduleCellMatrix,
  type ScheduleMatrixPersonRow,
} from './ScheduleCellMatrix';
import { parseScheduleImageClock } from './StructuredTableImageScheduleRecognizer';

const NON_PERSON_LABELS = new Set([
  '쉬는시간', '휴게시간', '쉬는날', '휴무', '휴일', '연차', '반차', '공휴일',
  '출근', '퇴근', '근무', '근무시간', '출근시간', '퇴근시간',
  '이름', '성명', '직원', '직원명', '성함', '담당자', '사람', '비고',
  '날짜', '요일', '합계', '총합', '시간', '시작', '종료', '오전', '오후',
]);

function normalizePersonCandidate(value: string): string | null {
  const normalized = String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, '');
  // Never promote headings, Latin OCR fragments, dates or shift labels to people.
  if (!/^[가-힣]{2,5}$/.test(normalized)) return null;
  if (NON_PERSON_LABELS.has(normalized)) return null;
  if (/^(?:오전|오후|평일|주말|휴무|근무|출근|퇴근|시작|종료)/.test(normalized)) return null;
  return normalized;
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
  knownNames: Set<string>,
): { sourceName: string; confidence: number; unreadable: boolean } {
  const focused = regional.get('person::' + row.sourceRow);
  const candidates = [
    { name: normalizePersonCandidate(focused?.text ?? ''), confidence: focused?.confidence ?? 0 },
    { name: normalizePersonCandidate(row.preliminaryName ?? ''), confidence: row.preliminaryConfidence },
  ];
  // Registered people are authoritative priors, even with weak OCR confidence.
  const registered = candidates.find((candidate) => candidate.name && knownNames.has(candidate.name));
  if (registered?.name) {
    return { sourceName: registered.name, confidence: Math.max(0.8, registered.confidence), unreadable: false };
  }
  // A novel name may enter explicit human import review only with strong
  // evidence. Weak/new labels never create a detected person.
  const credible = candidates.find((candidate) => candidate.name && candidate.confidence >= 0.85);
  if (credible?.name) {
    return { sourceName: credible.name, confidence: credible.confidence, unreadable: false };
  }
  return { sourceName: '', confidence: 0, unreadable: true };
}

function explicitOffLabel(result: ImageTextProbeResult | undefined): boolean {
  if (!result) return false;
  const normalized = [result.text, ...result.tokens.map((item) => item.text)]
    .join(' ').normalize('NFKC').trim().replace(/\s+/g, '').toLowerCase();
  // Empty visual cells are handled by pixel occupancy; OCR absence alone
  // never authorizes OFF. Only an explicit unambiguous rest label does.
  return /^(휴무|휴일|쉬는날|연차|반차|휴가|off|x|-)$/.test(normalized);
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

export function scheduleMatrixProbeRegions(
  matrix: ScheduleCellMatrix,
): ImageTextProbeRegion[] {
  return buildScheduleMatrixProbeRegions(matrix).map((region) => ({
    id: region.id,
    purpose: region.kind,
    x: region.bounds.x,
    y: region.bounds.y,
    width: region.bounds.width,
    height: region.bounds.height,
  }));
}

export interface StructureFirstRecognitionDiagnostics {
  parsed: ParsedImport;
  detection: ScheduleTableStructureDetection;
  matrix: ScheduleCellMatrix;
  layoutTokenCount: number;
  regionResults: ImageTextProbeResult[];
  timingMs: {
    preprocessing: number;
    structureDetection: number;
    initialOcr: number;
    regionalOcr: number;
    total: number;
  };
  roiCount: number;
  matrixInput: ReturnType<typeof inspectScheduleMatrixInput>;
  registeredPriorCount: number;
  matchedRegisteredPeopleCount: number;
  unresolvedPersonRowCount: number;
  rejectedNonPersonLabelCount: number;
}

export function interpretStructureFirstSchedule(
  matrix: ScheduleCellMatrix,
  regionResults: ImageTextProbeResult[],
  knownPersonNames: string[] = [],
): ParsedImport {
  const byRegion = new Map(regionResults.map((result) => [result.id, result]));
  const knownNames = new Set(knownPersonNames.map(normalizePersonCandidate).filter((name): name is string => !!name));
  const peopleByRow = new Map(
    matrix.rows.map((row) => [row.sourceRow, rowName(row, byRegion, knownNames)])
  );
  const detectedPeople: ParsedImportPerson[] = [...peopleByRow.values()]
    .filter((person) => !person.unreadable && person.sourceName)
    .map((person) => ({ sourceName: person.sourceName, confidence: person.confidence }));

  const scheduleCandidates: ParsedScheduleCandidate[] = [];
  const reviewCandidates: ParsedScheduleReviewCandidate[] = [];
  let workCount = 0;
  let offCount = 0;
  let incompleteCount = 0;
  let unreadableCount = 0;

  for (const cell of matrix.cells) {
    const person = peopleByRow.get(cell.sourceRow);
    if (!person || person.unreadable || !person.sourceName) continue;
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

    if (explicitOffLabel(byRegion.get(cell.id)) ||
        (cell.visual.occupancy === 'EMPTY' && !cell.initialTextEvidence)) {
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

  // A valid pixel row is not discarded solely because Korean OCR missed
  // its name. Create a review-only placeholder; the import repository
  // defaults unknown names to IGNORED and requires a deliberate DB match.
  // Header/shift/footer labels and unoccupied ghost rows are never promoted.
  for (const row of matrix.rows) {
    const resolved = peopleByRow.get(row.sourceRow);
    if (resolved && !resolved.unreadable) continue;
    const focused = byRegion.get('person::' + row.sourceRow);
    const raw = String(focused?.text ?? row.preliminaryName ?? '')
      .normalize('NFKC').trim().replace(/\s+/g, '').toLowerCase();
    if (NON_PERSON_LABELS.has(raw) ||
        /^(?:name|person|employee|sole|store|za|shift|break)$/i.test(raw)) continue;
    if (row.labelVisual?.occupancy === 'EMPTY') continue;
    const cellsForRow = matrix.cells.filter((cell) => cell.sourceRow === row.sourceRow);
    if (!cellsForRow.length) continue;
    const placeholder = '이름 확인 필요 (' + row.sourceRow + '행)';
    detectedPeople.push({ sourceName: placeholder, confidence: 0.01 });
    for (const cell of cellsForRow) {
      const times = cellTimes(byRegion.get(cell.id));
      const empty = cell.visual.occupancy === 'EMPTY' &&
        !cell.initialTextEvidence && !times.start && !times.end;
      reviewCandidates.push({
        sourcePersonName: placeholder,
        date: cell.date,
        start: times.start,
        end: times.end,
        sourceRow: cell.sourceRow,
        confidence: 0.01,
        recognitionState: empty ? 'OFF' : 'UNREADABLE',
        enabled: !empty,
      });
    }
  }
  if (!detectedPeople.length) {
    throw new Error('사람 이름과 검토 가능한 행을 모두 인식하지 못했습니다. 사용자 원본 이미지는 개발에 필요하지 않습니다.');
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

// Grid-based fallback is conservative: every date must be OCR-observed
// inside a real pixel-supported column. Never infer a date from its index.
export function pixelDateHeaderRegions(
  detection: ScheduleTableStructureDetection,
): ImageTextProbeRegion[] {
  const header = detection.structure.rowBands[0]?.bounds;
  if (!header) return [];
  return pixelSupportedColumnBounds(detection).map((band, i) => {
    const pad = Math.max(2, Math.floor(band.width * 0.04));
    return {
      id: 'date::grid-cell::' + (i + 1),
      purpose: 'date' as const,
      x: band.x + pad,
      y: header.y + Math.max(2, Math.floor(header.height * 0.08)),
      width: band.width - pad * 2,
      height: header.height * 0.84,
    };
  });
}

export class StructureFirstScheduleImageRecognizer implements ImageScheduleRecognizer {
  constructor(
    private readonly detector: ScheduleTableStructureDetector,
    private readonly extractor: RegionalImageTextExtractor,
    private readonly knownPersonNames: string[] | (() => Promise<string[]>) = [],
  ) {}

  async evaluate(
    file: File,
    onProgress?: ImportProgressReporter,
  ): Promise<StructureFirstRecognitionDiagnostics> {
    const started = performance.now();
    await onProgress?.(8);
    const detection = await this.detector.detect(file);
    await onProgress?.(18);

    const initialOcrStarted = performance.now();
    let layout = await this.extractor.extract(file, async (progress) => {
      await onProgress?.(Math.min(58, 18 + Math.round(progress * 0.43)));
    });
    const initialOcrMs = performance.now() - initialOcrStarted;
    await onProgress?.(60);

    let matrix = buildScheduleCellMatrix(detection, layout);
    if ((!matrix || matrix.dates.length < 2) &&
        detection.structure.rowBands.length >= 2) {
      const header = detection.structure.rowBands[0].bounds;
      // The header position is derived from pixel-detected table rows,
      // not fixed schedule image coordinates or one user's sample.
      const dateProbe: ImageTextProbeRegion = {
        id: 'date::first-pixel-row', purpose: 'date',
        x: 0, y: header.y,
        width: detection.raster.width,
        height: Math.min(header.height, detection.raster.height - header.y),
      };
      const focused = await this.extractor.extractRegions(file, [dateProbe]);
      const tokens = focused[0]?.tokens ?? [];
      if (new Set(tokens.map((token) => token.text)).size >= 2) {
        layout = { ...layout, tokens: [...layout.tokens, ...tokens] };
        matrix = buildScheduleCellMatrix(detection, layout);
      }
    }
    if (!matrix || matrix.dates.length < 2) {
      const pixelCells = pixelDateHeaderRegions(detection);
      if (pixelCells.length) {
        const results = await this.extractor.extractRegions(file, pixelCells);
        const tokens = results.flatMap((result) => result.tokens);
        if (new Set(tokens.map((token) => token.text)).size >= 2) {
          layout = { ...layout, tokens: [...layout.tokens, ...tokens] };
          matrix = buildScheduleCellMatrix(detection, layout);
        }
      }
    }
    const inputDiagnostics = inspectScheduleMatrixInput(detection, layout);
    if (!matrix || matrix.rows.length === 0 || matrix.dates.length < 2) {
      throw new Error(
        '표 구조를 안정적으로 복원하지 못했습니다. ' +
        'pixelSource=' + detection.structure.evidence.source +
        ' rows=' + detection.structure.rowBands.length +
        ' columns=' + detection.structure.columnBands.length +
        ' stage=' + inputDiagnostics.failureStage +
        ' ocrTokens=' + inputDiagnostics.ocrTokenCount +
        ' dateAnchors=' + inputDiagnostics.dateAnchorCount +
        ' resolvedDates=' + inputDiagnostics.resolvedDateCount +
        ' yearKnown=' + (inputDiagnostics.recognizedYear != null) +
        ' monthKnown=' + (inputDiagnostics.recognizedMonth != null)
      );
    }

    const regions = scheduleMatrixProbeRegions(matrix);
    const regionalOcrStarted = performance.now();
    const regionResults = await this.extractor.extractRegions(
      file,
      regions,
      async (progress) => {
        await onProgress?.(60 + Math.round(progress * 0.32));
      },
    );
    const regionalOcrMs = performance.now() - regionalOcrStarted;
    await onProgress?.(94);

    // The personal roster can change after application bootstrap. Read the
    // current registered-name prior at recognition time, never a stale snapshot.
    const currentPersonNames = typeof this.knownPersonNames === 'function'
      ? await this.knownPersonNames()
      : this.knownPersonNames;
    const parsed = interpretStructureFirstSchedule(matrix, regionResults, currentPersonNames);
    const normalizedPrior = new Set(
      currentPersonNames.map(normalizePersonCandidate)
        .filter((name): name is string => !!name),
    );
    const matchedRegisteredPeopleCount = parsed.detectedPeople
      .filter((person) => normalizedPrior.has(person.sourceName)).length;
    await onProgress?.(98);

    return {
      parsed,
      detection,
      matrix,
      layoutTokenCount: layout.tokens.length,
      regionResults,
      timingMs: {
        preprocessing: detection.preprocessingMs,
        structureDetection: detection.structureDetectionMs,
        initialOcr: Math.round(initialOcrMs),
        regionalOcr: Math.round(regionalOcrMs),
        total: Math.round(performance.now() - started),
      },
      roiCount: regions.length,
      matrixInput: inputDiagnostics,
      registeredPriorCount: normalizedPrior.size,
      matchedRegisteredPeopleCount,
      unresolvedPersonRowCount: Math.max(0, matrix.rows.length - parsed.detectedPeople.length),
      rejectedNonPersonLabelCount: regionResults.filter((result) =>
        result.id.startsWith('person::') && !!result.text.trim() &&
        normalizePersonCandidate(result.text) == null,
      ).length,
    };
  }

  async parse(
    file: File,
    onProgress?: ImportProgressReporter,
  ): Promise<ParsedImport> {
    return (await this.evaluate(file, onProgress)).parsed;
  }
}
