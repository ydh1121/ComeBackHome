import { useRef, useState } from 'react';
import { privateRequest } from '../../auth/client';
import { CopyButton } from '../ui/RecordEditor';
import type { IncomingAnalysis } from './AnalysisReview';

const base='private/case/analysis-receipts';
interface Receipt {id:string;status:string;createdAt:string;expiresAt:string;documentIds:string[];noteCount:number}
interface Grant {id:string;token:string;endpoint:string;expiresAt:string}
const label:Record<string,string>={pending:'답변 대기',waiting:'답변 대기',received:'답변 도착',revoked:'연결 취소',expired:'유효 시간 지남',ready:'답변 도착'};
const dateLabel=(value:string)=>new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'});

// Optional machine-to-machine staging. The usual copy/file/paste workflow above
// needs no tool installation, callback capability or credential configuration.
export function AnalysisReceipts({documentIds,notes,onReview}:{documentIds:string[];notes:{id:string;revision:number}[];onReview:(incoming:IncomingAnalysis)=>void}) {
  const [receipts,setReceipts]=useState<Receipt[]>([]),[grant,setGrant]=useState<Grant|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const lock=useRef(false);
  const refresh=async()=>{
    if(lock.current)return;lock.current=true;setBusy(true);setMessage('');
    try{setReceipts((await privateRequest<{receipts:Receipt[]}>(base)).receipts);}
    catch{setMessage('받은 답변을 불러오지 못했어요. 잠시 후 다시 확인해 주세요.');}
    finally{lock.current=false;setBusy(false);}
  };
  const create=async()=>{
    if(lock.current||!documentIds.length&&!notes.length)return;
    lock.current=true;setBusy(true);setMessage('');setGrant(null);
    try{
      const created=await privateRequest<Grant>(base,'POST',{documentIds,notes});
      setGrant(created);setReceipts((await privateRequest<{receipts:Receipt[]}>(base)).receipts);
      setMessage('선택한 자료의 답변만 받을 수 있어요. 도착한 답변도 검토 후 저장해야 반영됩니다.');
    }catch{setMessage('답변 받을 연결을 만들지 못했어요. 로그인 상태와 선택한 자료를 확인해 주세요.');}
    finally{lock.current=false;setBusy(false);}
  };
  const receive=async(id:string)=>{
    if(lock.current)return;lock.current=true;setBusy(true);setMessage('');
    try{
      const receipt=await privateRequest<{result:unknown|null;stale?:boolean}>(base+'/'+id);
      if(!receipt.result){setMessage(receipt.stale?'분석을 준비한 뒤 원본이나 메모가 바뀌었어요. 자료를 다시 선택해 새 요청을 준비해 주세요.':'아직 도착한 답변이 없어요.');return;}
      onReview({id,result:receipt.result});setMessage('위 검토 영역에 답변을 불러왔어요. 아직 기록을 저장하거나 파일을 옮기지 않았어요.');
    }catch{setMessage('답변을 가져오지 못했어요. 연결 상태를 다시 확인해 주세요.');}
    finally{lock.current=false;setBusy(false);}
  };
  const revoke=async(id:string)=>{
    if(lock.current)return;lock.current=true;setBusy(true);setMessage('');
    try{
      await privateRequest(base+'/'+id+'/revoke','POST',{});
      if(grant?.id===id)setGrant(null);
      setReceipts((await privateRequest<{receipts:Receipt[]}>(base)).receipts);setMessage('이 연결로 새 답변을 보낼 수 없게 했어요.');
    }catch{setMessage('연결을 취소하지 못했어요. 다시 시도해 주세요.');}
    finally{lock.current=false;setBusy(false);}
  };
  const connection=grant?JSON.stringify({method:'POST',url:grant.endpoint,headers:{Authorization:'Bearer '+grant.token,'Content-Type':'application/json'},body:'cbh-analysis/v1 또는 cbh-analysis/v2 형식의 분석 결과'},null,2):'';
  return <details className="private-card analysis-receipts" onToggle={e=>{if(e.currentTarget.open)void refresh();else setGrant(null);}}>
    <summary>분석 도구 연결 · 선택사항</summary>
    <p className="materials-caption">일반 ChatGPT 대화는 위의 복사·파일 가져오기로 사용할 수 있어요. 이 연결은 API로 답변을 전송할 수 있는 별도 분석 도구용입니다. 대화만으로 자동 연결되지는 않아요.</p>
    <div className="private-actions"><button className="secondary" disabled={busy||!documentIds.length&&!notes.length} onClick={()=>void create()}>선택한 자료의 답변 받을 연결 만들기</button><button className="secondary" disabled={busy} onClick={()=>void refresh()}>받은 답변 확인</button></div>
    {grant&&<section className="analysis-connection" aria-label="분석 도구 연결 정보"><div className="copy-toolbar"><CopyButton value={connection}/></div><h3>한 번 사용할 연결 정보</h3><p className="materials-caption">{dateLabel(grant.expiresAt)}까지 유효해요. 신뢰하는 도구에만 전달하고 공개 게시물에는 넣지 마세요. 이 영역을 닫으면 키는 다시 표시되지 않아요.</p><label>연결 정보<textarea readOnly value={connection} rows={7}/></label><button className="secondary" disabled={busy} onClick={()=>void revoke(grant.id)}>이 연결 취소</button></section>}
    {!!receipts.length&&<ul className="analysis-inbox">{receipts.map(receipt=><li key={receipt.id}><div><strong>{label[receipt.status]??'상태 확인 필요'}</strong><small>{dateLabel(receipt.createdAt)} · 파일 {receipt.documentIds.length}개 · 메모 {receipt.noteCount}개</small></div><div className="private-actions">{['received','ready'].includes(receipt.status)&&<button className="secondary" disabled={busy} onClick={()=>void receive(receipt.id)}>답변 가져와 검토</button>}{['pending','waiting'].includes(receipt.status)&&<button className="secondary" disabled={busy} onClick={()=>void revoke(receipt.id)}>연결 취소</button>}</div></li>)}</ul>}
    {!busy&&!receipts.length&&<p className="materials-caption">만든 연결이 아직 없어요. 이 기능을 쓰지 않아도 파일과 메모를 함께 분석할 수 있어요.</p>}
    <p role="status">{message}</p>
  </details>;
}
