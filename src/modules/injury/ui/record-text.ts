import { RECORD_SPECS, type CasePayload, type RecordKind, type Field } from '../domain/records';
import type { CaseData } from './types';

export function fieldText(field: Field, value: string | number | boolean, data?: CaseData): string {
  if(data&&['employmentId','claimId','relatedId','relatedMessage'].includes(field.key))
    return data.records.find(r=>r.id===value)?.payload.title??'연결 기록 확인 필요';
  if(data&&field.key==='sourceDocument')return data.documents.find(d=>d.id===value)?.filename??'원본 확인 필요';
  if(data&&field.key==='policyId')return data.policies.find(p=>p.id===value)?.version??'정책 확인 필요';
  if(field.type==='boolean')return value?'예':'아니요';
  return field.options?.find(option=>option[0]===value)?.[1]??String(value);
}

export function payloadFields(payload: CasePayload, kind: RecordKind, data?: CaseData) {
  return RECORD_SPECS[kind].fields
    .filter(field=>payload.data[field.key]!==undefined&&payload.data[field.key]!=='')
    .map(field=>({key:field.key,label:field.label,text:fieldText(field,payload.data[field.key],data)}));
}

export function payloadText(payload: CasePayload, kind: RecordKind, data?: CaseData): string {
  return [payload.title,payload.body,...payloadFields(payload,kind,data).map(field=>`${field.label}: ${field.text}`)].join('\n');
}
