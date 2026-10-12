/** Shared Seoul metropolitan line identity palette. Operator/map reference:
 * https://smss.seoulmetro.co.kr/traininfo/traininfoUserView.do
 * Unknown providers/lines intentionally retain a neutral, labelled fallback.
 */
export const SUBWAY_LINE_COLORS: Readonly<Record<string, string>> = {
  '1호선': '#0052A4', '2호선': '#00A84D', '3호선': '#EF7C1C',
  '4호선': '#00A5DE', '5호선': '#996CAC', '6호선': '#CD7C2F',
  '7호선': '#747F00', '8호선': '#E6186C', '9호선': '#BDB092',
  '공항철도': '#0090D2', '경의중앙선': '#77C4A3', '경춘선': '#0C8E72',
  '수인분당선': '#F5A200', '신분당선': '#D4003B', '우이신설선': '#B7C452',
  '신림선': '#6789CA', '서해선': '#8FC31F', '경강선': '#003DA5',
};
const ALIASES: Readonly<Record<string, string>> = { '분당선':'수인분당선', '수인선':'수인분당선', '경의선':'경의중앙선', '중앙선':'경의중앙선', '인천공항철도':'공항철도' };
export const UNKNOWN_LINE_COLOR = '#667085';
export function subwayLines(text: string): { label: string; color: string; known: boolean }[] {
  const normalized = text.normalize('NFKC');
  const matches = [...normalized.matchAll(/(?:(?<!\d)[1-9]\s*호선|수인분당선|신분당선|분당선|수인선|경의중앙선|경의선|중앙선|경춘선|인천공항철도|공항철도|우이신설선|신림선|서해선|경강선)/g)]
    .map(match => match[0].replace(/\s/g, ''));
  const labels = [...new Set(matches.map(line => ALIASES[line] ?? line))];
  if (!labels.length) return [{ label: text.trim() || '노선 미확인', color: UNKNOWN_LINE_COLOR, known: false }];
  return labels.map(label => ({ label, color: SUBWAY_LINE_COLORS[label] ?? UNKNOWN_LINE_COLOR, known: label in SUBWAY_LINE_COLORS }));
}
