import { useEffect, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import type { CaseData } from '../ui/types';
import { CopyButton, RecordEditor } from '../ui/RecordEditor';
import { guidanceId, guidancePayload } from './model';
import './content.css';
export function EditableGuidance({data,reload,contentKey,title,fallback,children,recordId}:{data:CaseData;reload:()=>Promise<void>;contentKey:string;recordId?:string;title:string;fallback:string;children?:(text:string)=>ReactNode}) {
  const id=recordId??guidanceId(data.caseId,contentKey), stored=data.records.find(r=>r.id===id), archived=!!stored?.archivedAt, existing=archived?undefined:stored, text=existing?.payload.body??fallback;
  const [editing,setEditing]=useState(false);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null),point=useRef({x:0,y:0});
  const cancel=()=>{if(timer.current)clearTimeout(timer.current);timer.current=null;};
  useEffect(()=>cancel,[]);
  useEffect(()=>{if(archived){cancel();setEditing(false);}},[archived]);
  const down=(e:PointerEvent)=>{if(archived||(e.target as HTMLElement).closest('button,a,input,textarea,summary'))return;point.current={x:e.clientX,y:e.clientY};cancel();timer.current=setTimeout(()=>setEditing(true),550);};
  return <section className="editable-guidance" data-guidance-key={contentKey} aria-label={title} onPointerDown={down} onPointerMove={e=>{if(Math.hypot(e.clientX-point.current.x,e.clientY-point.current.y)>8)cancel();}} onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel}>
    <div className="guidance-toolbar"><CopyButton value={text}/><button className="secondary" disabled={archived} onClick={()=>setEditing(true)} aria-label={title+' 편집'}>편집</button></div>
    {children?children(text):<p className="record-body">{text}</p>}
    {archived&&<p className="guidance-provenance">저장한 안내를 숨겨 기본 안내를 보여드려요. <a href="/injury?section=library">자료함의 ‘숨긴 자료’에서 복원</a>하면 다시 편집할 수 있어요.</p>}
    {existing&&<small className="guidance-provenance">수정 {new Date(existing.updatedAt).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'})} · {data.actors.find(a=>a.id===existing.updatedBy)?.name??'계정'} · 버전 {existing.revision}{existing.payload.sourceIds.length?' · 연결 자료 있음':' · 직접 편집한 안내'}</small>}
    {editing&&!archived&&<RecordEditor kind="content" record={existing} draft={{id,payload:guidancePayload(title,fallback)}} data={data} close={()=>setEditing(false)} saved={reload}/>}
  </section>;
}
