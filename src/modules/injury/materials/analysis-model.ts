import { RECORD_SPECS, isRecordKind, validatePayload, type CasePayload, type RecordKind, type RecordSpec } from '../domain/records';
import { validDate } from '../domain/dates';
import type { CaseSeed } from '../domain/imports';
import { validateOrganization, type OrganizationProposal } from './organization';

export type LegacyAnalysisSuggestion = {
  type: 'memo' | 'task'; title: string; body: string; sourceIds: string[]; dueDate?: string; ref?: string;
};
export type RecordAnalysisSuggestion = {
  type: 'record'; kind: RecordKind; title: string; body: string; sourceIds: string[];
  data: CasePayload['data']; dueDate?: never; ref?: string;
};
export type AnalysisSuggestion = LegacyAnalysisSuggestion | RecordAnalysisSuggestion;
export type AnalysisResult =
  | { version: 'cbh-analysis/v1'; suggestions: LegacyAnalysisSuggestion[]; documentMoves?: never }
  | { version: 'cbh-analysis/v2'; suggestions: AnalysisSuggestion[]; documentMoves?: OrganizationProposal[] };

const MAX_BYTES = 180000;
const draftStatus: Partial<Record<RecordKind, string>> = {
  intake:'preparing', treatment:'pending', benefit_claim:'estimate', unemployment_activity:'planned',
  expense:'review', disability:'review', additional_claim:'review', task:'todo',
};
// These fields feed official deadlines, decisions or verified counts elsewhere.
// Preserve the proposed value in the reviewable body instead of activating it.
const heldFields: Partial<Record<RecordKind, readonly string[]>> = {
  intake:['diagnosis','from','to','decisionAt','knownAt'],
  treatment:['diagnosis','from','to','medicalCureDate','appointmentAt'],
  employer_opinion:['notifiedAt'],
  agency_request:['dueDate'],
  benefit_claim:['allocatedDays','officialRemainingDays','expiresAt','firstRecognitionAt'],
  unemployment_activity:['recognitionAt','requiredActivities','recognizedDays'],
  disability:['officialGrade','medicalCureDate'],
};
const confirmedFields = new Set(['delegationConfirmed','extensionConfirmed','medicalRestriction','separationFormFiled','statementVerified','weeklyHolidayVerified']);
const replacedValues: Partial<Record<RecordKind, Record<string, readonly [string,string]>>> = {
  paid_day:{ verification:['estimated','estimated'] },
  exposure:{ diagnosisStatus:['confirmed','unknown'], measurement:['measured','estimated'] },
};
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function fieldShape(kind: RecordKind, data: unknown): asserts data is CasePayload['data'] {
  if (!object(data)) throw Error('INVALID_ANALYSIS');
  const spec: RecordSpec = RECORD_SPECS[kind];
  for (const [key,value] of Object.entries(data)) {
    const f = spec.fields.find(field=>field.key===key);
    if (!f || !['string','number','boolean'].includes(typeof value)) throw Error('INVALID_ANALYSIS');
    if (value==='') continue;
    if (f.type==='number') {
      if (typeof value!=='number'||!Number.isFinite(value)||value<(f.min??0)||value>(f.max??100000000000)) throw Error('INVALID_ANALYSIS');
    } else if (f.type==='boolean') {
      if (typeof value!=='boolean') throw Error('INVALID_ANALYSIS');
    } else {
      if (typeof value!=='string'||value.length>(f.type==='long'?20000:2000)) throw Error('INVALID_ANALYSIS');
      if (f.type==='date'&&!validDate(value)) throw Error('INVALID_ANALYSIS');
      if (f.type==='select'&&!f.options?.some(option=>option[0]===value)) throw Error('INVALID_ANALYSIS');
    }
  }
}
function draftRecord(s: RecordAnalysisSuggestion): { kind: RecordKind; payload: CasePayload } {
  if (!isRecordKind(s.kind)) throw Error('INVALID_ANALYSIS');
  fieldShape(s.kind,s.data);
  const spec: RecordSpec = RECORD_SPECS[s.kind];
  const data: CasePayload['data'] = {};
  const held: string[] = [];
  for (const field of spec.fields) {
    const value=s.data[field.key];
    if (value===undefined) continue;
    let replacement: string | boolean | undefined;
    let hold=heldFields[s.kind]?.includes(field.key)===true||field.key==='policyId';
    if(s.kind==='content'&&field.key==='recipient'&&/^(advisor-|planning-|analysis-)/.test(String(value))) hold=true;
    if (field.key==='status' && (spec.officialStates?.includes(String(value)) || (s.kind==='task'&&['done','cancelled'].includes(String(value))) || (s.kind==='disability'&&value==='not_needed'))) {
      hold=true; replacement=draftStatus[s.kind];
    }
    if (s.kind==='task' && field.key==='deadlineKind' && value!=='recommended') {hold=true;replacement='recommended';}
    if (s.kind==='task' && field.key==='doneAt') hold=true;
    if (confirmedFields.has(field.key)&&value===true) {hold=true;replacement=false;}
    const changed=replacedValues[s.kind]?.[field.key];
    if (changed && (s.kind==='paid_day'?value!=='estimated':value===changed[0])) {hold=true;replacement=changed[1];}
    if (hold && value!=='') {
      const text=field.options?.find(option=>option[0]===value)?.[1]??(typeof value==='boolean'?(value?'예':'아니요'):String(value));
      held.push(`${field.label}: ${text}`);
      if (replacement!==undefined) data[field.key]=replacement;
    } else data[field.key]=value;
  }
  const body=typeof s.body==='string'?s.body:'';
  const payload=validatePayload(s.kind,{
    title:s.title,body:held.length?`${body}\n\n[분석 제안에서 보류한 정보 · 원문 확인 필요]\n${held.join('\n')}\n위 정보는 확정 항목이나 공식 기한에 반영하지 않았어요. 원본을 확인한 뒤 해당 기록에서 직접 수정하세요.`:s.body,
    certainty:'reported',sourceIds:s.sourceIds,data,
  });
  if(payload.data.sourceDocument&&!payload.sourceIds.includes(String(payload.data.sourceDocument))) throw Error('INVALID_ANALYSIS');
  payload.sourceIds.sort();
  return {kind:s.kind,payload};
}
export function suggestionRecord(s: AnalysisSuggestion): { kind: RecordKind; payload: CasePayload } {
  if(s.type==='record') return draftRecord(s);
  const kind=s.type==='task'?'task':'content';
  return {kind,payload:validatePayload(kind,{
    title:s.title,body:s.body,certainty:'reported',sourceIds:s.sourceIds,
    data:s.type==='task'?{status:'todo',deadlineKind:'recommended',...(s.dueDate?{dueDate:s.dueDate}:{})}:{category:'reference',medium:'none'},
  })};
}
const linkedFields = ['employmentId','claimId','relatedId','relatedMessage'] as const;
export function suggestionDependencies(s: AnalysisSuggestion): string[] {
  if(s.type!=='record') return [];
  return [...new Set(linkedFields.flatMap(key=>typeof s.data[key]==='string'&&String(s.data[key]).startsWith('@')?[String(s.data[key]).slice(1)]:[]))];
}
export function analysisDependencyOrder(suggestions: AnalysisSuggestion[]): number[] {
  const refs=new Map<string,number>();
  for(const [i,s] of suggestions.entries()) if(s.ref!==undefined) {
    if(!/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(s.ref)||refs.has(s.ref)) throw Error('INVALID_ANALYSIS_REFERENCE');
    refs.set(s.ref,i);
  }
  const complete=new Set<number>(),active=new Set<number>(),ordered:number[]=[];
  const visit=(i:number)=>{
    if(complete.has(i)) return;
    if(active.has(i)) throw Error('CYCLIC_ANALYSIS_REFERENCE');
    active.add(i);
    const s=suggestions[i];
    if(s.type==='record') for(const key of linkedFields) {
      const value=s.data[key];
      if(typeof value!=='string'||!value.startsWith('@')) continue;
      const parent=refs.get(value.slice(1));
      if(parent===undefined) throw Error('MISSING_ANALYSIS_REFERENCE');
      const target=suggestions[parent],kind=target.type==='record'?target.kind:target.type==='memo'?'content':'task';
      if((key==='employmentId'&&kind!=='employment')||(key==='claimId'&&kind!=='benefit_claim')||(key==='relatedMessage'&&kind!=='content')) throw Error('INVALID_ANALYSIS_REFERENCE_KIND');
      visit(parent);
    }
    active.delete(i);complete.add(i);ordered.push(i);
  };
  suggestions.forEach((_,i)=>visit(i));
  return ordered;
}
export async function resolveAnalysisSeed(reviewed:{result:AnalysisResult;seed:CaseSeed},hash:(value:string)=>Promise<string>):Promise<CaseSeed> {
  const ids=new Map<string,string>(),records:CaseSeed['records']=[];
  for(const i of analysisDependencyOrder(reviewed.result.suggestions)) {
    const s=reviewed.result.suggestions[i],record=reviewed.seed.records[i];
    const data={...record.payload.data};
    for(const key of linkedFields) if(typeof data[key]==='string'&&String(data[key]).startsWith('@')) {
      const id=ids.get(String(data[key]).slice(1));
      if(!id) throw Error('MISSING_ANALYSIS_REFERENCE');
      data[key]=id;
    }
    const resolved={kind:record.kind,payload:{...record.payload,data}};
    const id='import-'+(await hash(JSON.stringify(resolved))).slice(0,48);
    if(s.ref)ids.set(s.ref,id);
    records.push(resolved);
  }
  return {version:'cbh-case-seed/v1',records};
}
export function suggestionLabel(s: AnalysisSuggestion): string {
  return s.type==='record'?RECORD_SPECS[s.kind].title:s.type==='task'?'준비할 일':'자료 요약';
}
// AI output never carries approval. Every result is normalized to a reviewable,
// reported draft; financial ledger events and official decisions use their own UI.
export function reviewAnalysis(value: unknown): { result: AnalysisResult; seed: CaseSeed } {
  if(!object(value)||new TextEncoder().encode(JSON.stringify(value)).byteLength>MAX_BYTES) throw Error('INVALID_ANALYSIS');
  if(!['cbh-analysis/v1','cbh-analysis/v2'].includes(String(value.version))||Object.keys(value).some(k=>!['version','suggestions','documentMoves','approved'].includes(k))) throw Error('INVALID_ANALYSIS');
  const v2=value.version==='cbh-analysis/v2';
  if(!Array.isArray(value.suggestions)||value.suggestions.length>40||(!v2&&(!value.suggestions.length||value.documentMoves!==undefined))) throw Error('INVALID_ANALYSIS');
  const moves=value.documentMoves===undefined?undefined:validateOrganization(value.documentMoves);
  if(!value.suggestions.length&&!moves?.length) throw Error('INVALID_ANALYSIS');
  const suggestions: AnalysisSuggestion[]=[];
  const records: CaseSeed['records']=value.suggestions.map(raw=>{
    if(!object(raw)||!Array.isArray(raw.sourceIds)) throw Error('INVALID_ANALYSIS');
    if(raw.ref!==undefined&&(!v2||typeof raw.ref!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(raw.ref))) throw Error('INVALID_ANALYSIS_REFERENCE');
    if(raw.type==='record') {
      if(!v2||Object.keys(raw).some(k=>!['type','kind','title','body','sourceIds','data','ref'].includes(k))||typeof raw.body!=='string') throw Error('INVALID_ANALYSIS');
      const record=draftRecord(raw as RecordAnalysisSuggestion);
      suggestions.push({type:'record',kind:record.kind,title:record.payload.title,body:record.payload.body,sourceIds:record.payload.sourceIds,data:record.payload.data,...(raw.ref?{ref:String(raw.ref)}:{})});
      return record;
    }
    if(!['memo','task'].includes(String(raw.type))||Object.keys(raw).some(k=>!['type','title','body','sourceIds','dueDate','ref'].includes(k))||(raw.dueDate!==undefined&&typeof raw.dueDate!=='string')||(raw.type==='memo'&&raw.dueDate)) throw Error('INVALID_ANALYSIS');
    const record=suggestionRecord(raw as LegacyAnalysisSuggestion);
    suggestions.push({type:raw.type as 'memo'|'task',title:record.payload.title,body:record.payload.body,sourceIds:record.payload.sourceIds,...(raw.dueDate?{dueDate:String(raw.dueDate)}:{}),...(raw.ref?{ref:String(raw.ref)}:{})});
    return record;
  });
  analysisDependencyOrder(suggestions);
  const result: AnalysisResult=v2?{version:'cbh-analysis/v2',suggestions,...(moves?{documentMoves:moves}:{})}:{version:'cbh-analysis/v1',suggestions:suggestions as LegacyAnalysisSuggestion[]};
  if(new TextEncoder().encode(JSON.stringify(result)).byteLength>MAX_BYTES) throw Error('INVALID_ANALYSIS');
  return {result,seed:{version:'cbh-case-seed/v1',records}};
}
