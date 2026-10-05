export const START_LABELS = ['\uCD9C\uADFC', '\uCD9C\uADFC\uC2DC\uAC04', '\uC2DC\uC791', '\uC2DC\uC791\uC2DC\uAC04', '\uADFC\uBB34\uC2DC\uC791', 'start', 'starttime'];
export const END_LABELS = ['\uD1F4\uADFC', '\uD1F4\uADFC\uC2DC\uAC04', '\uC885\uB8CC', '\uC885\uB8CC\uC2DC\uAC04', '\uADFC\uBB34\uC885\uB8CC', 'end', 'endtime'];
export const REST_LABELS = ['\uC26C\uB294\uC2DC\uAC04', '\uD734\uAC8C', '\uD734\uAC8C\uC2DC\uAC04', 'break', 'rest'];

export function normalizeScheduleLabel(value: string): string {
  return String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, '');
}

export function classifyScheduleShiftLabel(value: string): 'start' | 'end' | 'rest' | null {
  const normalized = normalizeScheduleLabel(value);
  if (START_LABELS.some((label) => normalizeScheduleLabel(label) === normalized)) return 'start';
  if (END_LABELS.some((label) => normalizeScheduleLabel(label) === normalized)) return 'end';
  if (REST_LABELS.some((label) => normalizeScheduleLabel(label) === normalized)) return 'rest';
  return null;
}
