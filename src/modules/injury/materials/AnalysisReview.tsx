import { useRef, useState } from 'react';
import { privateRequest } from '../../auth/client';
import type { CaseData } from '../ui/types';
import { CopyButton } from '../ui/RecordEditor';
import { reviewAnalysis, type AnalysisResult } from './model';

export function AnalysisReview({ data, reload }: { data: CaseData; reload: () => Promise<void> }) {
  const [text,setText]=useState(''),[candidate,setCandidate]=useState<AnalysisResult|null>(null),[selected,setSelected]=useState<number[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const lock=useRef(false);
  const reset=(value:string)=>{setText(value);setCandidate(null);setSelected([]);setMessage('');};
  const review=()=>{
    setCandidate(null);setSelected([]);
    try {
      const raw=text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');
      const result=reviewAnalysis(JSON.parse(raw)).result;
      const ids=new Set(data.documents.filter(d=>d.status==='ready').map(d=>d.id));
      if(result.suggestions.some(s=>s.sourceIds.some(id=>!ids.has(id)))) throw Error('source');
      setCandidate(result);setSelected(result.suggestions.map((_,i)=>i));setMessage('아직 저장하지 않았어요. 내용을 확인해 주세요.');
    } catch {setMessage('분석 결과의 형식이나 연결 원본을 확인해 주세요. 저장하지 않았어요.');}
  };
  const save=async()=>{
    if(lock.current||!candidate||!selected.length)return;
    lock.current=true;setBusy(true);setMessage('');
    try {
      const result=await privateRequest<{inserted:number}>('private/case/analysis','POST',{...candidate,suggestions:candidate.suggestions.filter((_,i)=>selected.includes(i)),approved:true});
      setCandidate(null);setText('');setSelected([]);setMessage(`새 기록 ${result.inserted}개를 저장했어요. 같은 내용은 중복으로 추가하지 않았어요.`);
      await reload();
    } catch(e){setMessage((e as Error).message || '저장하지 못했어요. 내용을 유지했으니 다시 시도해 주세요.');}
    finally{lock.current=false;setBusy(false);}
  };
  return <details className="private-card analysis-review">
    <summary>GPT 답변을 준비할 일·메모로 가져오기</summary>
    <p className="materials-caption">요청문에 맞춰 받은 JSON 부분을 붙여 넣으세요. 확인한 항목만 새 기록으로 저장해요.</p>
    <label htmlFor="analysis-result">GPT 분석 결과</label><textarea id="analysis-result" rows={5} value={text} disabled={busy} maxLength={180000} onChange={e=>reset(e.target.value)}/>
    <button className="secondary" disabled={busy||!text.trim()} onClick={review}>내용 확인</button>
    {candidate&&<div className="analysis-proposals">
      {candidate.suggestions.map((s,i)=><article key={i} className="analysis-proposal">
        <label className="auth-check"><input type="checkbox" checked={selected.includes(i)} disabled={busy} onChange={e=>setSelected(v=>e.target.checked?[...v,i]:v.filter(x=>x!==i))}/><strong>{s.title}</strong><small>{s.type==='task'?'준비할 일':'자료 요약'}</small></label>
        <p className="record-body">{s.body}</p>
        {s.dueDate&&<p>권장 확인일 · {s.dueDate}</p>}
        <small>{s.sourceIds.map(id=>data.documents.find(d=>d.id===id)?.filename??'원본 확인 필요').join(' · ')||'연결 원본 없음 · 내용 확인 필요'}</small>
      </article>)}
      <p className="materials-caption">기관 확정 자료로 저장하지 않아요. 기존 기록과 원본 파일도 그대로 유지해요.</p>
      <div className="private-actions"><button disabled={busy||!selected.length} onClick={()=>void save()}>선택한 {selected.length}개 새 기록으로 저장</button><button className="secondary" disabled={busy} onClick={()=>reset('')}>취소</button></div>
    </div>}
    <p role="status">{message}</p>
  </details>;
}

export function AnalysisRequest({value,change,close}:{value:string;change:(v:string)=>void;close:()=>void}) {
  return <article className="private-card analysis-request" aria-label="GPT 분석 요청문">
    <div className="copy-toolbar"><CopyButton value={value}/><button className="secondary" onClick={close}>닫기</button></div>
    <h2>요청문이 준비됐어요</h2><p className="materials-caption">복사해서 ChatGPT에 한 번에 전달하세요. 파일과 메모가 자동 전송되지는 않아요.</p>
    <label htmlFor="analysis-request">분석 요청문</label><textarea id="analysis-request" rows={10} value={value} onChange={e=>change(e.target.value)}/>
  </article>;
}
