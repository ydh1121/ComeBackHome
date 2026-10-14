// Pipe-only bridge: no raw response or prediction files/logs. Parent captures stdout.
import { parseOcrSpaceWeeklyTable } from '../src/providers/import/OcrSpaceWeeklyTable.ts';
import { createServer } from 'vite';
let input = '';
let vite;
try {
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 8 * 1024 * 1024) throw new Error('SIZE');
  }
  const { response, image_id, raster } = JSON.parse(input);
  let matrix = null;
  if (raster) {
    const luminance = new Uint8Array(Buffer.from(raster.luminance, 'base64'));
    if (!Number.isInteger(raster.width) || !Number.isInteger(raster.height) || raster.width <= 0 || raster.height <= 0 ||
        raster.width * raster.height > 4_000_000 || luminance.length !== raster.width * raster.height) throw new Error('RASTER');
    // Reuse actual product geometry and occupancy; no parallel grid detector.
    vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
    const detector = await vite.ssrLoadModule('/src/providers/import/ScheduleTableStructureDetector.ts');
    const weekly = await vite.ssrLoadModule('/src/providers/import/Weekly3ColumnScheduleMatrix.ts');
    const plane = { width: raster.width, height: raster.height, luminance };
    const lines = response?.ParsedResults?.[0]?.TextOverlay?.Lines ?? [];
    const tokens = lines.flatMap(line => line.Words ?? []).filter(word => typeof word.WordText === 'string' &&
      ['Left', 'Top', 'Width', 'Height'].every(key => Number.isFinite(word[key]) && word[key] >= 0))
      .map(word => ({ text: word.WordText, x: word.Left, y: word.Top, width: word.Width, height: word.Height, confidence: 0 }));
    const detection = { raster: plane, structure: detector.detectScheduleTableStructureFromRaster(plane), preprocessingMs: 0, structureDetectionMs: 0 };
    matrix = weekly.buildWeekly3ColumnPhysicalMatrix(detection, { width: raster.width, height: raster.height, tokens });
  }
  const parsed = parseOcrSpaceWeeklyTable(response, image_id, matrix);
  process.stdout.write(JSON.stringify({ ...parsed, pixel_shape: matrix ? {
    rows: matrix.rows.length, cells: matrix.physicalCellCount,
    geometry_source: matrix.geometrySource, header_source: matrix.headerSource,
  } : null }));
} catch {
  // Never echo input, parser messages or stack traces containing OCR text.
  process.stdout.write(JSON.stringify({ cells: [], error: 'ADAPTER_INPUT_FAILURE', diagnostics: {} }));
  process.exitCode = 2;
} finally {
  await vite?.close();
}
