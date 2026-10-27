import { useEffect, useRef, useState } from 'react';
import { privateRequest } from '../../auth/client';
import type { CaseData } from '../ui/types';
import { CopyButton } from '../ui/RecordEditor';
import { payloadFields } from '../ui/record-text';
import { reviewAnalysis, suggestionLabel, suggestionRecord, suggestionDependencies, type AnalysisResult } from './model';
import { OrganizationReview } from './OrganizationReview';
import type { OrganizationProposal } from './organization';

export interface IncomingAnalysis { id: string; result: unknown }
export function AnalysisReview({ data, reload, incoming }: { data: CaseData; reload: () => Promise<void>; incoming?: IncomingAnalysis | null }) {
  const [text,setText]=useState(''),[candidate,setCandidate]=useState<AnalysisResult|null>(null),[selected,setSelected]=useState<number[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const [moves,setMoves]=useState<OrganizationProposal[]>([]),[receiptId,setReceiptId]=useState<string|undefined>();
  const lock=useRef(false),panel=useRef<HTMLDetailsElement>(null);
  const reset=(value:string)=>{setText(value);setCandidate(null);setSelected([]);setMoves([]);setReceiptId(undefined);setMessage('');};
  const reviewValue=(value:string)=>{
    setCandidate(null);setSelected([]);setMoves([]);
    try {
      const raw=value.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');
      const result=reviewAnalysis(JSON.parse(raw)).result;
      const ids=new Set(data.documents.filter(d=>d.status==='ready').map(d=>d.id));
      const proposedMoves=result.version==='cbh-analysis/v2'?result.documentMoves??[]:[];
      if(result.suggestions.some(s=>s.sourceIds.some(id=>!ids.has(id)))||proposedMoves.some(p=>!ids.has(p.documentId))) throw Error('source');
      setCandidate(result);setSelected(result.suggestions.map((_,i)=>i));setMoves(proposedMoves);setMessage('아직 저장하지 않았어요. 내용을 확인해 주세요.');
    } catch {setMessage('분석 결과의 형식이나 연결 원본을 확인해 주세요. 저장하지 않았어요.');}
  };
  useEffect(()=>{
    if(!incoming)return;
    const value=JSON.stringify(incoming.result,null,2);
    setText(value);setReceiptId(incoming.id);reviewValue(value);
    if(panel.current)panel.current.open=true;
  },[incoming]);
  const loadFile=async(file?:File)=>{
    if(!file||lock.current)return;
    reset('');lock.current=true;setBusy(true);
    try{
      if(!/\.json$/i.test(file.name)||!file.size||file.size>180000)throw Error('file');
      const value=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());
      setText(value);reviewValue(value);
    }catch{setMessage('180KB 이하의 UTF-8 JSON 파일을 선택해 주세요. 이전 검토 내용은 지웠고, 저장하지 않았어요.');}
    finally{lock.current=false;setBusy(false);}
  };
  const choose=(index:number,checked:boolean)=>{
    if(!candidate)return;
    const next=new Set(selected);
    const byRef=new Map(candidate.suggestions.map((s,i)=>[s.ref,i]));
    if(checked){
      const add=(i:number)=>{if(next.has(i))return;next.add(i);for(const ref of suggestionDependencies(candidate.suggestions[i])){const parent=byRef.get(ref);if(parent!==undefined)add(parent);}};
      add(index);
      if(next.size>selected.length+1)setMessage('함께 연결할 기록도 선택했어요. 아래 내용을 같이 확인해 주세요.');
    }else{
      next.delete(index);
      let changed=true;
      while(changed){changed=false;for(const i of [...next])if(suggestionDependencies(candidate.suggestions[i]).some(ref=>{const parent=byRef.get(ref);return parent===undefined||!next.has(parent);})){next.delete(i);changed=true;}}
      if(next.size<selected.length-1)setMessage('이 기록에 연결되는 항목도 선택을 해제했어요.');
    }
    setSelected([...next]);
  };
  const save=async()=>{
    if(lock.current||!candidate||!selected.length)return;
    lock.current=true;setBusy(true);setMessage('');
    try {
      // Folder organization has its own reviewed action. Saving record drafts
      // never forwards document moves or a file-provided approval.
      const result=await privateRequest<{inserted:number}>('private/case/analysis','POST',{version:candidate.version,suggestions:candidate.suggestions.filter((_,i)=>selected.includes(i)),...(receiptId?{receiptId}:{}),approved:true});
      setCandidate(null);setText('');setSelected([]);setMessage(`새 기록 ${result.inserted}개를 저장했어요. 같은 내용은 중복으로 추가하지 않았어요.`);
      await reload();
    } catch(e){setMessage((e as Error).message || '저장하지 못했어요. 내용을 유지했으니 다시 시도해 주세요.');}
    finally{lock.current=false;setBusy(false);}
  };
  return <details ref={panel} className="private-card analysis-review">
    <summary>GPT 답변을 준비할 일·메모로 가져오기</summary>
    <p className="materials-caption">답변의 JSON을 붙여 넣거나 파일을 선택하세요. 일한 내용·진료·서류 등은 알맞은 곳에 나눠 담고, 저장 전 한 번에 확인할 수 있어요.</p>
    <label className="analysis-file">분석 결과 파일 가져오기<input type="file" accept=".json,application/json" disabled={busy} onChange={e=>{void loadFile(e.target.files?.[0]);e.currentTarget.value='';}}/></label>
    <label htmlFor="analysis-result">GPT 분석 결과</label><textarea id="analysis-result" rows={5} value={text} disabled={busy} maxLength={180000} onChange={e=>reset(e.target.value)}/>
    <button className="secondary" disabled={busy||!text.trim()} onClick={()=>reviewValue(text)}>내용 확인</button>
    {candidate&&<div className="analysis-proposals">
      {candidate.suggestions.map((s,i)=>{
        const record=suggestionRecord(s),fields=s.type==='record'?payloadFields(record.payload,record.kind,data).map(field=>{
          const value=record.payload.data[field.key];
          return typeof value==='string'&&value.startsWith('@')?{...field,text:candidate.suggestions.find(proposal=>proposal.ref===value.slice(1))?.title??'연결할 새 기록 확인 필요'}:field;
        }):[];
        return <article key={i} className="analysis-proposal">
          <label className="auth-check"><input type="checkbox" checked={selected.includes(i)} disabled={busy} onChange={e=>choose(i,e.target.checked)}/><strong>{s.title}</strong><small>{suggestionLabel(s)}</small></label>
          <p className="record-body">{s.body}</p>
          {s.type==='task'&&s.dueDate&&<p>권장 확인일 · {s.dueDate}</p>}
          {!!fields.length&&<dl className="analysis-fields">{fields.map(field=><div key={field.key}><dt>{field.label}</dt><dd>{field.text}</dd></div>)}</dl>}
          <small>{s.sourceIds.map(id=>data.documents.find(d=>d.id===id)?.filename??'원본 확인 필요').join(' · ')||'연결 원본 없음 · 내용 확인 필요'}</small>
        </article>;
      })}
      <p className="materials-caption">모든 항목은 확인이 필요한 기록으로 저장해요. 기관 결정·지급 확정으로 처리하지 않으며, 기존 기록과 원본 파일은 그대로 유지해요.</p>
      <div className="private-actions"><button disabled={busy||!selected.length} onClick={()=>void save()}>선택한 {selected.length}개 새 기록으로 저장</button><button className="secondary" disabled={busy} onClick={()=>reset('')}>취소</button></div>
    </div>}
    {!!moves.length&&<div className="analysis-organization"><h3>파일 정리 제안</h3><p className="materials-caption">위 기록 저장과 별개예요. 아래에서 확인한 파일만 Drive 폴더 안에서 정리해요.</p><OrganizationReview data={data} proposals={moves} reload={reload} receiptId={receiptId}/></div>}
    <p role="status">{message}</p>
  </details>;
}

export function AnalysisRequest({value,change,close}:{value:string;change:(v:string)=>void;close:()=>void}) {
  return <article className="private-card analysis-request" aria-label="GPT 분석 요청문">
    <div className="copy-toolbar"><CopyButton value={value}/><button className="secondary" onClick={close}>닫기</button></div>
    <h2>요청문이 준비됐어요</h2><p className="materials-caption">복사해서 ChatGPT에 한 번에 전달하세요. 파일과 메모가 자동 전송되지는 않아요. 답변은 아래에서 파일로 가져오거나 붙여 넣으면 돼요.</p>
    <label htmlFor="analysis-request">분석 요청문</label><textarea id="analysis-request" rows={10} value={value} onChange={e=>change(e.target.value)}/>
  </article>;
}
