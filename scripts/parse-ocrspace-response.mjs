// Pipe-only bridge: no raw response or prediction files/logs. Parent captures stdout.
import { parseOcrSpaceWeeklyTable } from '../src/providers/import/OcrSpaceWeeklyTable.ts';
let input = '';
try {
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 3 * 1024 * 1024) throw new Error('SIZE');
  }
  const { response, image_id } = JSON.parse(input);
  process.stdout.write(JSON.stringify(parseOcrSpaceWeeklyTable(response, image_id)));
} catch {
  // Never echo input, parser messages or stack traces containing OCR text.
  process.stdout.write(JSON.stringify({ cells: [], error: 'ADAPTER_INPUT_FAILURE', diagnostics: {} }));
  process.exitCode = 2;
}
