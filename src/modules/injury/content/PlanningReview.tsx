import { useEffect, useRef, useState } from 'react';
import { ApiError, privateRequest } from '../../auth/client';
import type { CaseData } from '../ui/types';
import type { CaseRecord } from '../domain/records';
import { RECORD_SPECS } from '../domain/records';
import { CopyButton } from '../ui/RecordEditor';
import { EditableGuidance } from './EditableGuidance';
import { isPersonalReview, personalAnswer, planningSeed, preparePlanning, readPersonalReview, type PlanningEntry, type PlanningReview } from './model';
import './content.css';

export function PlanningPreparation({data,reload,isAdmin}:{data:CaseData;reload:()=>Promise<void>;isAdmin:boolean}) {
  const [entries,setEntries]=useState<PlanningEntry[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[reading,setReading]=useState(false);
  const generation=useRef(0),lock=useRef(false);
  useEffect(()=>()=>{generation.current++},[]);
  if(!isAdmin)return null;
  const load=async(file?:File)=>{
    const ticket=++generation.current;setEntries([]);setMessage('');setReading(false);if(!file)return;
    setReading(true);
    try{if(file.size>180000)throw Error('180KB 이내의 분류 자료를 사용해 주세요.');const rows=await preparePlanning(JSON.parse(await file.text()));if(ticket===generation.current){setEntries(rows);setMessage('아직 적용하지 않았어요. 기본 안내에 개인 정보가 섞이지 않았는지 확인하세요.');}}
    catch(e){if(ticket===generation.current)setMessage(e instanceof SyntaxError||(e as Error).message.startsWith('INVALID_')?'준비된 분류 자료의 형식을 확인해 주세요.':(e as Error).message);}
    finally{if(ticket===generation.current)setReading(false);}
  };
  const seed=(()=>{try{return planningSeed(entries,data.records)}catch{return null}})();
  const save=async()=>{
    if(lock.current||!seed?.records.length)return;
    lock.current=true;setBusy(true);setMessage('');
    try{const result=await privateRequest<{inserted:number}>('private/case/import','POST',{...seed,approved:true});await reload();setMessage(`새 내용 ${result.inserted}개를 적용했어요. 기존 내용과 수정본은 그대로예요.`);}
    catch(e){setMessage((e as Error).message);}
    finally{lock.current=false;setBusy(false);}
  };
  return <details className="private-card planning-preparation"><summary>관리자 · 준비된 안내와 예전 이야기 적용</summary>
    <p>비공개로 분류한 자료를 한 번만 확인해요. 개인 이야기는 본인 확인 전까지 별도로 표시하고, 기관 결정문과 정책은 여기에서 적용하지 않아요.</p>
    <label>관리자 분류 자료<input type="file" accept=".json,application/json" disabled={busy||reading} onChange={e=>{void load(e.target.files?.[0]);e.currentTarget.value='';}}/></label>
    {!!entries.length&&<><p>기본 안내 {entries.filter(e=>e.group==='guide').length}개 · 개인사 확인 {entries.filter(e=>e.group==='personal').length}개 · 보류 {entries.filter(e=>e.group==='hold').length}개</p>
      <details><summary>분류 내용 확인</summary><div className="planning-review-list">{entries.map((entry,i)=><article key={entry.key}><h3>{entry.payload.title}</h3><p className="record-body">{entry.payload.body}</p><label>초안 {i+1} 분류<select disabled={busy} value={entry.group} onChange={e=>setEntries(rows=>rows.map((row,n)=>n===i?{...row,group:e.target.value as PlanningEntry['group']}:row))}><option value="personal">예전 이야기 · 본인 확인 필요</option>{entry.kind==='content'&&entry.payload.certainty!=='official'&&<option value="guide">개인 정보 없는 기본 안내</option>}<option value="hold">지금 적용하지 않음</option></select></label></article>)}</div></details>
      {!seed&&<p role="alert">분류 또는 전체 분량을 확인해 주세요. 저장하지 않았어요.</p>}
      <div className="private-actions"><button disabled={busy||!seed?.records.length} onClick={()=>void save()}>미등록 내용 {seed?.records.length??0}개 적용</button><button className="secondary" disabled={busy} onClick={()=>{setEntries([]);setMessage('적용하지 않았어요.');}}>취소</button></div></>}
    <p role="status">{reading?'분류 자료를 확인하는 중…':message}</p>
  </details>;
}
function PersonalReviewCard({record,data,reload}:{record:CaseRecord;data:CaseData;reload:()=>Promise<void>}) {
  const initial=readPersonalReview(record)!;
  const [base,setBase]=useState(record),[answer,setAnswer]=useState<PlanningReview['answer']>(initial.answer),[note,setNote]=useState(initial.note),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[conflict,setConflict]=useState<CaseRecord|null>(null),[history,setHistory]=useState<Array<{revision:number;payload:CaseRecord['payload'];authorId:string;createdAt:string}>>([]);
  const lock=useRef(false);
  const save=async()=>{
    if(lock.current)return;setMessage('');
    try{const payload=personalAnswer(base,answer,note);lock.current=true;setBusy(true);const result=await privateRequest<{record:CaseRecord}>('private/case/records/'+record.id,'PUT',{kind:'content',revision:base.revision,payload});setBase(result.record);await reload();setMessage('확인한 내용을 저장했어요. 예전 이야기와 원본은 그대로 보관해요.');}
    catch(e){if(e instanceof ApiError&&e.code==='REVISION_CONFLICT'){const latest=await privateRequest<{record:CaseRecord}>('private/case/records/'+record.id).catch(()=>null);setConflict(latest?.record??null);}setMessage((e as Error).message);}
    finally{lock.current=false;setBusy(false);}
  };
  return <details className="personal-review-card" data-personal-review={record.id}><summary>{record.payload.title}</summary>
    <div className="personal-review-status">예전 대화 기준 · {initial.answer==='pending'?'현재 상황 확인 전':'내가 확인한 참고 기록 · 기관 확인 전'}</div><h3>{record.payload.title}</h3>
    <div className="guidance-toolbar"><CopyButton value={[initial.original.payload.body,note].filter(Boolean).join("\n\n")}/></div>
    <p className="record-body">{initial.original.payload.body}</p>
    <small>{RECORD_SPECS[initial.original.kind as keyof typeof RECORD_SPECS].title} · 원래 기록과 공식 문서는 변경하지 않아요.</small>
    <label>지금도 맞는 내용인가요?<select disabled={busy} value={answer} onChange={e=>setAnswer(e.target.value as PlanningReview['answer'])}><option value="pending">선택해 주세요</option><option value="same">지금도 맞아요</option><option value="different">지금은 달라요</option><option value="unknown">잘 모르겠어요</option></select></label>
    <label htmlFor={"personal-note-"+record.id}>지금 알고 있는 내용</label><textarea id={"personal-note-"+record.id} disabled={busy} rows={3} maxLength={20000} value={note} onChange={e=>setNote(e.target.value)} placeholder={answer==='different'?'달라진 내용만 적어 주세요':'모르면 비워 두어도 괜찮아요'}/>
    {conflict&&<div className="conflict-panel"><h4>다른 기기에서 확인한 내용이 있어요</h4><p className="record-body">{readPersonalReview(conflict)?.note||'추가 메모 없음'}</p><button className="secondary" onClick={()=>{setBase(conflict);setConflict(null);setMessage('최신 확인 내용을 읽었어요. 내 답변을 다시 검토한 뒤 저장하세요.');}}>최신 내용 확인 · 내 입력 유지</button></div>}
    <div className="private-actions"><button disabled={busy||!!conflict||answer==='pending'} onClick={()=>void save()}>확인한 내용 저장</button><button className="secondary" disabled={busy} onClick={()=>{setAnswer(initial.answer);setNote(initial.note);setBase(record);setConflict(null);setMessage('수정하지 않았어요.');}}>다시 입력</button></div>
    <p role="status">{message}</p><small>버전 {record.revision} · {data.actors.find(a=>a.id===record.updatedBy)?.name??'계정'}</small>
    <details><summary onClick={()=>{void privateRequest<{history:typeof history}>('private/case/records/'+record.id+'/history').then(r=>setHistory(r.history)).catch(e=>setMessage(e.message));}}>이전 확인 내용</summary>{history.map(h=>{const old=readPersonalReview({...record,payload:h.payload});return <p key={h.revision}>버전 {h.revision} · {data.actors.find(a=>a.id===h.authorId)?.name??'계정'} · {new Date(h.createdAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}<br/>{old?.note||'추가 메모 없음'}</p>;})}</details>
  </details>;
}
export function PersonalHistoryReview({data,reload}:{data:CaseData;reload:()=>Promise<void>}) {
  const [limit,setLimit]=useState(5);
  const rows=data.records.filter(r=>isPersonalReview(r)&&readPersonalReview(r)),pending=rows.filter(r=>readPersonalReview(r)?.answer==='pending'),reviewed=rows.filter(r=>readPersonalReview(r)?.answer!=='pending');
  if(!rows.length)return null;
  return <details className="private-card personal-history-review"><summary>예전 이야기 확인{pending.length?' · '+pending.length+'개':''}</summary><p>예전에 이야기한 내용이 지금도 맞는지 확인해 주세요. 진단·승인·지급액이 자동으로 확정되지는 않아요.</p><div className="planning-review-list">{pending.slice(0,limit).map(r=><PersonalReviewCard key={r.id} record={r} data={data} reload={reload}/>)}</div>{pending.length>limit&&<button className="secondary" onClick={()=>setLimit(n=>n+5)}>다른 이야기 5개 더 보기</button>}{!!reviewed.length&&<details><summary>확인한 이야기 {reviewed.length}개</summary><div className="planning-review-list">{reviewed.map(r=><PersonalReviewCard key={r.id} record={r} data={data} reload={reload}/>)}</div></details>}</details>;
}
export function PlanningGuides({data,reload}:{data:CaseData;reload:()=>Promise<void>}) {
  const rows=data.records.filter(r=>r.kind==='content'&&!r.archivedAt&&String(r.payload.data.recipient).startsWith('planning-guide/v1:'));
  if(!rows.length)return null;
  return <details className="private-card planning-guides"><summary>함께 읽을 안내 {rows.length}개</summary><div className="planning-review-list">{rows.map(r=><article key={r.id}><h3>{r.payload.title}</h3><EditableGuidance data={data} reload={reload} recordId={r.id} contentKey="prepared-guide" title={r.payload.title} fallback={r.payload.body}/></article>)}</div></details>;
}
