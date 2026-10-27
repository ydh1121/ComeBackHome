import { useEffect, useRef, useState } from 'react';
import { ApiError, errorText, privateRequest } from '../../auth/client';
import type { CaseData } from '../ui/types';
import { ORGANIZATION_CATEGORIES, type OrganizationCategory, type OrganizationProposal } from './organization';

interface Result { documentId: string; status: 'organized' | 'failed'; error?: string }
export function OrganizationReview({ data, proposals, reload, receiptId }: { data: CaseData; proposals: OrganizationProposal[]; reload: () => Promise<void>; receiptId?: string }) {
  const signature = JSON.stringify(proposals);
  const [items,setItems] = useState(proposals), [selected,setSelected] = useState(proposals.map(p=>p.documentId));
  const [results,setResults] = useState<Result[]>([]), [busy,setBusy] = useState(false), [message,setMessage] = useState('');
  const [pendingCategories,setPendingCategories]=useState<Record<string,OrganizationCategory>>({});
  const locked = useRef(false), mounted=useRef(true), operation=useRef<AbortController|null>(null);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;operation.current?.abort();};},[]);
  useEffect(()=>{ if(!locked.current){setItems(JSON.parse(signature));setSelected(JSON.parse(signature).map((p:OrganizationProposal)=>p.documentId));setResults([]);setMessage('');} },[signature]);
  useEffect(()=>{
    const abort=new AbortController();
    void Promise.all((JSON.parse(signature) as OrganizationProposal[]).map(async item=>{
      try {
        const state=await privateRequest<{pending:boolean;category?:OrganizationCategory}>('private/case/documents/'+item.documentId+'/organization','GET',undefined,abort.signal);
        return state.pending&&state.category?{id:item.documentId,category:state.category}:null;
      }catch{return null;}
    })).then(values=>{
      if(abort.signal.aborted||!mounted.current)return;
      const pending=Object.fromEntries(values.filter(v=>v!==null).map(v=>[v.id,v.category]));
      setPendingCategories(pending);
      if(!receiptId)setItems(items=>items.map(item=>pending[item.documentId]?{...item,category:pending[item.documentId]}:item));
      if(Object.keys(pending).length)setMessage('중단된 정리가 있어요. 이전에 선택한 분야로 완료 여부부터 확인해요.');
    });
    return()=>abort.abort();
  },[signature,receiptId]);
  const save = async () => {
    if(locked.current)return;
    const pending = items.filter(p=>selected.includes(p.documentId)&&!results.some(r=>r.documentId===p.documentId&&r.status==='organized'));
    if(!pending.length)return;
    locked.current=true;setBusy(true);setMessage('');
    const abort=new AbortController();operation.current=abort;
    try {
      const completed: Result[]=[];
      // One user approval, bounded sequential requests. Each request stays
      // below Workers Free's external-subrequest budget, even on recovery.
      for (const proposal of pending) {
        if(abort.signal.aborted)break;
        let result: Result;
        try {
          const response=await privateRequest<{results:Result[]}>('private/case/documents/organize','POST',{approved:true,proposals:[proposal],...(receiptId?{receiptId}:{})},abort.signal);
          result=response.results[0]??{documentId:proposal.documentId,status:'failed',error:'DRIVE_ORGANIZATION_RETRY'};
        } catch (error) { result={documentId:proposal.documentId,status:'failed',error:error instanceof ApiError?error.code:'DRIVE_ORGANIZATION_RETRY'}; }
        completed.push(result);
        if(mounted.current){
          setResults(old=>[...old.filter(r=>r.documentId!==result.documentId),result]);
          if(result.status==='failed')setPendingCategories(old=>({...old,[proposal.documentId]:proposal.category}));
          setMessage(`${completed.length} / ${pending.length}개 확인했어요.`);
        }
      }
      const failed=completed.filter(r=>r.status==='failed').length;
      if(mounted.current){
        setMessage(abort.signal.aborted?'정리를 중지했어요. 이미 이동한 원본은 되돌리거나 삭제하지 않아요. 다시 시도하면 완료 여부부터 확인해요.':failed?`${failed}개는 정리하지 못했어요. 원본은 보존했으며 같은 요청으로 이어서 확인할 수 있어요.`:'선택한 원본을 비공개 보관 폴더 안에서 정리했어요.');
        await reload();
      }
    } catch(e){if(mounted.current)setMessage((e as Error).message || '정리 결과를 확인하지 못했어요. 다시 시도하면 완료 여부부터 확인해요.');}
    finally{locked.current=false;operation.current=null;if(mounted.current)setBusy(false);}
  };
  const pending=items.filter(p=>selected.includes(p.documentId)&&!results.some(r=>r.documentId===p.documentId&&r.status==='organized'));
  return <article className="private-card organization-review" aria-label="원본 폴더 정리">
    <h3>원본을 분야별로 정리</h3>
    <p className="materials-caption">기존 비공개 보관 폴더 안에 아래 분야별 폴더를 만들고 원본을 옮겨요. 파일 내용과 링크, 공유 설정은 유지해요.</p>
    {items.map(item=>{
      const document=data.documents.find(d=>d.id===item.documentId), result=results.find(r=>r.documentId===item.documentId), complete=result?.status==='organized';
      return <div className="analysis-proposal" key={item.documentId}>
        <label className="auth-check"><input type="checkbox" disabled={busy||complete||document?.status!=='ready'} checked={selected.includes(item.documentId)} onChange={e=>setSelected(v=>e.target.checked?[...v,item.documentId]:v.filter(id=>id!==item.documentId))}/><strong>{document?.filename??'확인할 수 없는 원본'}</strong></label>
        <label>보관할 분야<select value={item.category} disabled={busy||complete||!!receiptId||!!pendingCategories[item.documentId]} onChange={e=>setItems(v=>v.map(p=>p.documentId===item.documentId?{...p,category:e.target.value as OrganizationCategory}:p))}>{Object.entries(ORGANIZATION_CATEGORIES).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
        {result&&<p role="status">{complete?'정리 완료':errorText(result.error??'DRIVE_REQUEST_FAILED')}</p>}
      </div>;
    })}
    <button disabled={busy||!pending.length} onClick={()=>void save()}>{busy?'원본 확인·정리 중…':results.some(r=>r.status==='failed')?`미완료 ${pending.length}개 다시 확인`:`선택한 파일 ${pending.length}개 정리`}</button>
    {busy&&<button className="secondary" onClick={()=>operation.current?.abort()}>정리 중지</button>}
    <p role="status">{message}</p>
  </article>;
}
