import { reviewCaseSeed, type CaseSeed } from '../domain/imports';
import { validatePayload, type CasePayload, type CaseRecord } from '../domain/records';
import { withinRequestLimit } from '../materials/model';

export type PlanningGroup = 'guide' | 'personal' | 'hold';
export interface PlanningEntry { key: string; kind: CaseSeed['records'][number]['kind']; payload: CasePayload; group: PlanningGroup }
export interface PlanningReview { version: 1; origin: string; original: { kind: string; payload: CasePayload }; answer: 'pending' | 'same' | 'different' | 'unknown'; note: string }
const personalPrefix = 'planning-personal/v1:';
const guidePrefix = 'planning-guide/v1:';
export const guidanceId = (caseId: string, key: string) => 'guide-v1-' + key + '-' + caseId;
export const guidanceText = (records: CaseRecord[], caseId: string, key: string, fallback: string) => records.find(r=>r.id===guidanceId(caseId,key)&&!r.archivedAt)?.payload.body ?? fallback;
export const guidancePayload = (title: string, body: string): CasePayload => validatePayload('content', { title, body, certainty: 'reported', sourceIds: [], data: { category: 'guide', medium: 'none' } });
export function isPersonalReview(record: CaseRecord): boolean { return record.kind === 'content' && String(record.payload.data.recipient).startsWith(personalPrefix); }
export function readPersonalReview(record: CaseRecord): PlanningReview | null {
  if (!isPersonalReview(record) || record.archivedAt) return null;
  try {
    const p = JSON.parse(record.payload.body);
    if (p.version !== 1 || typeof p.origin !== 'string' || !['pending','same','different','unknown'].includes(p.answer) || typeof p.note !== 'string' || p.note.length > 20000) return null;
    const seed = reviewCaseSeed({ version:'cbh-case-seed/v1', records:[p.original] });
    return { version:1,origin:p.origin,original:seed.records[0],answer:p.answer,note:p.note };
  } catch { return null; }
}
export async function preparePlanning(value: unknown): Promise<PlanningEntry[]> {
  if (!withinRequestLimit(value)) throw Error('자료가 너무 커요. 관리자가 나누어 준비해 주세요.');
  const candidate = value as {version?: unknown;sourceSha256?: unknown;records?: Array<{group?:unknown}>};
  const prepared = candidate?.version === 'cbh-planning-preparation/v1';
  if (prepared && (typeof candidate.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(candidate.sourceSha256))) throw Error('원본 파일의 확인값을 확인해 주세요.');
  const seed = reviewCaseSeed(prepared ? {...candidate,version:'cbh-case-seed/v1'} : value);
  return Promise.all(seed.records.map(async(r,i)=>{
    const group = prepared ? candidate.records?.[i]?.group : r.payload.certainty === 'official' ? 'hold' : 'personal';
    if (!['guide','personal','hold'].includes(String(group)) || (group==='guide' && (r.kind!=='content'||r.payload.certainty==='official'))) throw Error('초안 분류를 확인해 주세요.');
    // Identity follows the normalized original, independent of file order,
    // surrounding entries, classification, or later edits to the saved copy.
    const original={kind:r.kind,payload:{...r.payload,sourceIds:[...r.payload.sourceIds].sort(),data:Object.fromEntries(Object.entries(r.payload.data).sort(([a],[b])=>a.localeCompare(b)))}};
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(original)))),b=>b.toString(16).padStart(2,'0')).join('').slice(0,32);
    return {key:digest,...r,group:group as PlanningGroup};
  }));
}
const entryKey = (record: CaseRecord) => String(record.payload.data.recipient ?? '').replace(/^(planning-personal|planning-guide)\/v1:/,'');
export function planningSeed(entries: PlanningEntry[], records: CaseRecord[]): CaseSeed {
  const existing = new Set(records.map(entryKey));
  const result: CaseSeed['records'] = [];
  for (const entry of entries) {
    if (entry.group === 'hold' || existing.has(entry.key)) continue;
    if (entry.group === 'guide') {
      // A person must classify the text as general guidance. Official source
      // records and specialist facts are never converted into reusable advice.
      if (entry.kind !== 'content' || entry.payload.certainty === 'official') throw Error('기관 자료와 개인 기록은 기본 안내로 적용할 수 없어요.');
      if (records.some(r=>r.kind==='content' && r.payload.title===entry.payload.title && r.payload.body===entry.payload.body)) continue;
      result.push({kind:'content',payload:validatePayload('content',{
        ...guidancePayload(entry.payload.title,entry.payload.body),
        data:{category:'guide',medium:'none',recipient:guidePrefix+entry.key},
      })});
    } else if (entry.group === 'personal') {
      const review: PlanningReview = {version:1,origin:entry.key,original:{kind:entry.kind,payload:entry.payload},answer:'pending',note:''};
      result.push({kind:'content',payload:validatePayload('content',{
        title:entry.payload.title,body:JSON.stringify(review),certainty:'reported',sourceIds:[],
        data:{category:'reference',medium:'none',recipient:personalPrefix+entry.key},
      })});
    } else throw Error('분류를 확인해 주세요.');
    existing.add(entry.key);
  }
  const seed: CaseSeed = {version:'cbh-case-seed/v1',records:result};
  if (!withinRequestLimit({...seed,approved:true})) throw Error('자료가 너무 커요. 일부 항목을 보류하고 나누어 적용해 주세요.');
  return seed;
}
export function personalAnswer(record: CaseRecord, answer: PlanningReview['answer'], note: string): CasePayload {
  const current = readPersonalReview(record);
  if (!current || !['same','different','unknown'].includes(answer) || note.length>20000) throw Error('확인할 내용을 다시 열어 주세요.');
  if (answer==='different' && !note.trim()) throw Error('지금과 다른 내용을 짧게 적어 주세요.');
  return validatePayload('content', {...record.payload,certainty:'reported',sourceIds:[],body:JSON.stringify({...current,answer,note:note.trim()})});
}
