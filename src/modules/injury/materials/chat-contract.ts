import { reviewAnalysis, type AnalysisResult } from './model';

export const CHAT_RESPONSE_VERSION = 'cbh-chat-response/v1';
export const CHAT_RESPONSE_LIMIT = 200000;
export interface ChatSources {
  documents: Array<{ id: string; sha256: string; bytes: number }>;
  notes: Array<{ id: string; revision: number }>;
}
export interface ChatReply {
  version: typeof CHAT_RESPONSE_VERSION;
  requestId: string;
  sourceFingerprint: string;
  status: 'ready';
  answer: string;
  result: AnalysisResult | null;
}
export interface ChatExchange {
  id: string;
  status: 'preparing' | 'waiting' | 'ready';
  createdAt: string;
  documentCount: number;
  noteCount: number;
  url: string | null;
}
// Manual file import is an explicitly reviewed fallback, not a Drive receipt.
// It never forwards a file-provided receipt ID, approval flag or source stamp.
export function unwrapManualReply(raw: unknown): {answer:string;value:unknown} {
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||!('version' in raw)||raw.version!==CHAT_RESPONSE_VERSION)return {answer:'',value:raw};
  const value=raw as Record<string,unknown>;
  if(value.status!=='ready'||typeof value.answer!=='string'||!value.answer.trim()||value.answer.length>40000||!Object.hasOwn(value,'result'))throw Error('CHAT_REPLY_INVALID');
  return {answer:value.answer,value:value.result};
}
export function sourceStamp(sources: ChatSources): string {
  return JSON.stringify({
    documents: [...sources.documents].sort((a,b)=>a.id.localeCompare(b.id)),
    notes: [...sources.notes].sort((a,b)=>a.id.localeCompare(b.id)),
  });
}
export function readChatReply(text: string, requestId: string, sourceFingerprint: string, sources: ChatSources): ChatReply | null {
  if(new TextEncoder().encode(text).length>CHAT_RESPONSE_LIMIT)throw Error('CHAT_REPLY_TOO_LARGE');
  const raw=JSON.parse(text.trim().replace(/^\uFEFF/,'').replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.version!==CHAT_RESPONSE_VERSION||raw.requestId!==requestId||raw.sourceFingerprint!==sourceFingerprint)throw Error('CHAT_REPLY_MISMATCH');
  if(raw.status==='waiting')return null;
  if(raw.status!=='ready'||typeof raw.answer!=='string'||!raw.answer.trim()||raw.answer.length>40000||Object.keys(raw).some(key=>!['version','requestId','sourceFingerprint','status','answer','result'].includes(key)))throw Error('CHAT_REPLY_INVALID');
  const result=raw.result===null?null:reviewAnalysis(raw.result).result;
  if(result){
    const documentIds=new Set(sources.documents.map(d=>d.id)),noteIds=new Set(sources.notes.map(n=>n.id));
    const normalized=reviewAnalysis(result);
    if(normalized.seed.records.some(r=>r.payload.sourceIds.some(id=>!documentIds.has(id))||r.payload.data.sourceDocument&&!documentIds.has(String(r.payload.data.sourceDocument))||['employmentId','claimId','relatedId','relatedMessage'].some(k=>r.payload.data[k]&&!String(r.payload.data[k]).startsWith('@')&&!noteIds.has(String(r.payload.data[k])))))throw Error('CHAT_REPLY_SOURCE');
    if(result.version==='cbh-analysis/v2'&&result.documentMoves?.some(move=>!documentIds.has(move.documentId)))throw Error('CHAT_REPLY_SOURCE');
  }
  return {...raw,answer:raw.answer.trim(),result};
}
export function chatRequestInstructions(url: string, requestId: string, fingerprint: string, analysis: string): string {
  return [
    '연결된 Google Drive에서 아래 문서를 열고, 문서 안의 자료를 함께 읽어 답변해 주세요.',
    url,
    '이 요청은 현재 ChatGPT 대화와 연결된 Drive만 사용합니다. OpenAI API나 별도 API 키는 사용하지 마세요.',
    '아래 요청을 처리한 뒤 새 파일을 만들지 말고 위 문서의 본문 전체를 아래 응답 형식으로 바꾸세요. 원본 자료, 공유 권한, 다른 문서는 변경하지 마세요.',
    analysis,
    '[위 문서에 저장할 응답 형식]',
    JSON.stringify({version:CHAT_RESPONSE_VERSION,requestId,sourceFingerprint:fingerprint,status:'ready',answer:'사용자가 읽을 쉬운 한국어 답변. 출처와 확인이 필요한 내용을 포함.',result:null},null,2),
    'answer에는 일반 사용자가 읽을 답변을 적으세요. 앱에 추가할 제안이 있으면 result에 앞에서 설명한 cbh-analysis/v2 객체를 넣으세요. 제안이 없으면 null을 쓰세요. 문서 전체에는 이 JSON 하나만 남기고, 코드블록이나 앞뒤 설명은 넣지 마세요.',
    '파일 접근이나 문서 수정이 불가능하면 완료했다고 말하지 마세요. 이 응답 JSON을 대화에 제공하면 사용자가 앱의 직접 가져오기를 이용할 수 있습니다.',
    '문서에 저장했다는 사실은 앱 기록 저장이나 기관 확정을 뜻하지 않습니다. 앱에서는 답변을 읽고 원하는 항목만 따로 확인하여 저장합니다.',
  ].join('\n\n');
}
