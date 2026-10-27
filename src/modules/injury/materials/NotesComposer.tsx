import { useEffect, useRef, useState } from 'react';
import { privateRequest } from '../../auth/client';
import { CopyButton } from '../ui/RecordEditor';
import { memoPayload, withinRequestLimit, MAX_FILES } from './model';
type Note = {id:string;title:string;body:string};
const blank = ():Note=>({id:crypto.randomUUID(),title:'',body:''});

export function NotesComposer({reload}:{reload:()=>Promise<void>}) {
  const [notes,setNotes]=useState<Note[]>([blank()]),[busy,setBusy]=useState(false),[reading,setReading]=useState(false),[message,setMessage]=useState('');
  const ticket=useRef(0),lock=useRef(false);
  useEffect(()=>()=>{ticket.current++},[]);
  const change=(id:string,key:'title'|'body',value:string)=>setNotes(v=>v.map(n=>n.id===id?{...n,[key]:value}:n));
  const files=async(selected:File[])=>{
    const current=++ticket.current;setReading(true);setMessage('');
    try{
      if(!selected.length)return;
      if(selected.length+notes.filter(n=>n.title||n.body).length>MAX_FILES)throw Error('메모는 한 번에 20개까지 등록할 수 있어요.');
      if(selected.some(f=>! /\.(txt|md)$/i.test(f.name)||f.size>180000||!f.size))throw Error('내용이 있는 TXT·MD 파일을 선택해 주세요. 파일당 최대 180KB예요.');
      const added=await Promise.all(selected.map(async f=>{
        const body=new TextDecoder('utf-8',{fatal:true}).decode(await f.arrayBuffer());
        if(/[\x00-\x08\x0e-\x1f]/.test(body))throw Error('텍스트 파일을 확인해 주세요.');
        const title=f.name.replace(/\.(txt|md)$/i,'');memoPayload(title,body);
        return{id:crypto.randomUUID(),title,body};
      }));
      const next=[...notes.filter(n=>n.title||n.body),...added];
      if(!withinRequestLimit({records:next.map(n=>({kind:'content',payload:memoPayload(n.title,n.body)}))}))throw Error('메모가 너무 길어요. 일부를 나눠 등록해 주세요.');
      if(current===ticket.current)setNotes(next);
    }catch(e){if(current===ticket.current)setMessage(e instanceof TypeError?'UTF-8 형식의 텍스트 파일을 선택해 주세요.':(e as Error).message);}
    finally{if(current===ticket.current)setReading(false);}
  };
  const save=async()=>{
    if(lock.current)return;
    setMessage('');
    try{
      const records=notes.filter(n=>n.title.trim()||n.body.trim()).map(n=>({kind:'content',payload:memoPayload(n.title||n.body.trim().split('\n')[0].slice(0,80),n.body)}));
      if(!records.length)throw Error('메모 내용을 입력해 주세요.');
      const body={version:'cbh-case-seed/v1',records,approved:true};
      if(!withinRequestLimit(body))throw Error('메모가 너무 길어요. 일부를 나눠 저장해 주세요.');
      lock.current=true;setBusy(true);
      const result=await privateRequest<{inserted:number}>('private/case/import','POST',body);
      setNotes([blank()]);setMessage(`메모 ${result.inserted}개를 저장했어요. 같은 내용은 중복으로 추가하지 않았어요.`);
      await reload();
    }catch(e){setMessage((e as Error).message.startsWith('INVALID_')?'제목은 160자, 메모는 60,000자까지 입력할 수 있어요.':(e as Error).message);}
    finally{lock.current=false;setBusy(false);}
  };
  return <details className="private-card notes-composer">
    <summary>메모 한 번에 추가</summary>
    <p className="materials-caption">적어 둔 내용이나 대화를 붙여 넣으세요. 텍스트 파일도 여러 개 가져올 수 있어요.</p>
    <label className="materials-file-label">메모 파일 가져오기<input type="file" multiple accept=".txt,.md,text/plain,text/markdown" disabled={busy||reading} onChange={e=>{void files(Array.from(e.target.files??[]));e.currentTarget.value='';}}/></label>
    {notes.map((n,i)=><div className="note-draft" key={n.id}>
      <div className="copy-toolbar"><CopyButton value={n.body}/>{notes.length>1&&<button className="secondary" disabled={busy||reading} onClick={()=>setNotes(v=>v.filter(x=>x.id!==n.id))} aria-label={`메모 ${i+1} 빼기`}>빼기</button>}</div>
      <label>메모 {i+1} 제목<input value={n.title} disabled={busy||reading} maxLength={160} placeholder="비워 두면 첫 줄을 제목으로 사용해요" onChange={e=>change(n.id,'title',e.target.value)}/></label>
      <label>메모 {i+1} 내용<textarea rows={4} maxLength={60000} disabled={busy||reading} value={n.body} onChange={e=>change(n.id,'body',e.target.value)}/></label>
    </div>)}
    <div className="private-actions"><button className="secondary" disabled={busy||reading||notes.length>=MAX_FILES} onClick={()=>setNotes(v=>[...v,blank()])}>메모 추가</button><button disabled={busy||reading||!notes.some(n=>n.title.trim()||n.body.trim())} onClick={()=>void save()}>{busy?'저장 중…':'메모 한 번에 저장'}</button></div>
    <p role="status">{reading?'메모 파일을 읽는 중…':message}</p>
  </details>;
}
