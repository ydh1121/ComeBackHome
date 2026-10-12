/** Seoul Metropolitan Government's published RGB column (not Adobe RGB).
 * https://news.seoul.go.kr/culture/archives/522224
 * Exact source, row mapping and verification date: docs/subway-line-colors.md.
 * Unknown providers/lines intentionally retain a neutral, labelled fallback.
 */
export const SUBWAY_LINE_COLORS: Readonly<Record<string, string>> = {
  '1호선': '#004A85', '2호선': '#00A23F', '3호선': '#ED6C00',
  '4호선': '#009BCE', '5호선': '#794698', '6호선': '#7C4932',
  '7호선': '#6E7E31', '8호선': '#D11D70', '9호선': '#A49D87',
  '공항철도': '#0079AC', '경의중앙선': '#6AC2B3', '경춘선': '#007A62',
  '수인분당선': '#ECA300', '신분당선': '#B81B30', '우이신설선': '#BACC50',
  '신림선': '#5E7DBB', '서해선': '#5EAC41', '경강선': '#0B318F',
  '인천1호선': '#B4C7E7', '인천2호선': '#F0831E',
  '용인경전철': '#44A436', '의정부경전철': '#F4A462', '김포골드라인': '#957326',
};
const ALIASES: Readonly<Record<string, string>> = { '분당선':'수인분당선', '수인선':'수인분당선', '경의선':'경의중앙선', '중앙선':'경의중앙선', '인천공항철도':'공항철도' };
export const UNKNOWN_LINE_COLOR = '#667085';
export function subwayLines(text: string): { label: string; color: string; known: boolean }[] {
  const normalized = text.normalize('NFKC');
  const matches = [...normalized.matchAll(/(?:(?:(?:서울|인천|부산|대구|대전|광주)\s*(?:지하철\s*|도시철도\s*)?)?\d+\s*호선|수인분당선|신분당선|분당선|수인선|경의중앙선|경의선|중앙선|경춘선|인천공항철도|공항철도|우이신설선|신림선|서해선|경강선|용인경전철|의정부경전철|김포골드라인)/g)]
    .map(match => match[0].replace(/\s|지하철|도시철도/g, '').replace(/^서울/, ''));
  const labels = [...new Set(matches.map(line => ALIASES[line] ?? line))];
  if (!labels.length) return [{ label: text.trim() || '노선 미확인', color: UNKNOWN_LINE_COLOR, known: false }];
  return labels.map(label => ({ label, color: SUBWAY_LINE_COLORS[label] ?? UNKNOWN_LINE_COLOR, known: label in SUBWAY_LINE_COLORS }));
}
