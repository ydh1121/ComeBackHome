import { useEffect, useRef, useState } from 'react';
import { privateRequest } from '../../auth/client';
import { CopyButton } from '../ui/RecordEditor';
import type { IncomingAnalysis } from './AnalysisReview';
import type { ChatExchange } from './chat-contract';
import { Icon } from '../../../shared/components/Icon';

const base='private/case/documents/chat-exchanges';
export function ChatAnswers({analyst,changed,onReview,onRequest}:{analyst:boolean;changed:number;onReview:(v:IncomingAnalysis)=>void;onRequest:(value:string)=>void}){
  const [rows,setRows]=useState<ChatExchange[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [answer,setAnswer]=useState<{id:string;body:string;result:unknown;receiptId:string|null}|null>(null);
  const lock=useRef(false),mounted=useRef(true);
  const refresh=async()=>{
    if(lock.current)return;lock.current=true;setBusy(true);
    try{const value=await privateRequest<{exchanges:ChatExchange[]}>(base);if(mounted.current)setRows(value.exchanges);}
    catch(e){if(mounted.current)setMessage((e as Error).message);}
    finally{lock.current=false;if(mounted.current)setBusy(false);}
  };
  useEffect(()=>{mounted.current=true;void refresh();return()=>{mounted.current=false;};},[changed]);
  const read=async(id:string)=>{
    if(lock.current)return;lock.current=true;setBusy(true);setMessage('');setAnswer(null);
    try{
      const value=await privateRequest<{status:string;answer:string|null;result?:unknown;receiptId?:string|null}>(base+'/'+id+'/read','POST',{});
      if(!mounted.current)return;
      if(value.status==='waiting'){setMessage(analyst?'아직 답변이 없어요. 요청문을 ChatGPT 대화에 전달한 뒤 다시 확인해 주세요.':'아직 답변을 기다리고 있어요. 자료를 더 올려 두셔도 괜찮아요.');return;}
      setAnswer({id,body:value.answer??'',result:value.result??null,receiptId:value.receiptId??null});
      setRows(v=>v.map(r=>r.id===id?{...r,status:'ready'}:r));
    }catch(e){if(mounted.current)setMessage((e as Error).message);}
    finally{lock.current=false;if(mounted.current)setBusy(false);}
  };
  const requestText=async(id:string)=>{
    if(lock.current)return;lock.current=true;setBusy(true);setMessage('');
    try{const value=await privateRequest<{prompt:string}>(base+'/'+id+'/request');if(mounted.current)onRequest(value.prompt);}
    catch(e){if(mounted.current)setMessage((e as Error).message);}
    finally{lock.current=false;if(mounted.current)setBusy(false);}
  };
  const resume=async(id:string)=>{
    if(lock.current)return;lock.current=true;setBusy(true);setMessage('');
    try{
      const value=await privateRequest<ChatExchange&{prompt:string}>(base+'/'+id+'/resume','POST',{});
      if(mounted.current){setRows(v=>v.map(row=>row.id===id?value:row));onRequest(value.prompt);}
    }catch(e){if(mounted.current)setMessage((e as Error).message);}
    finally{lock.current=false;if(mounted.current)setBusy(false);}
  };
  return <section className="chat-answers" aria-label="ChatGPT 답변">
    <div className="materials-answer-heading"><div><h3>함께 보는 답변</h3><p className="materials-caption">{analyst?'ChatGPT가 Drive에 답변을 남기면 여기서 읽을 수 있어요.':'올려 둔 자료의 답변을 여기서 확인하세요.'}</p></div><button className="secondary" disabled={busy} aria-label="답변 목록 새로고침" onClick={()=>void refresh()}>새로고침</button></div>
    {!rows.length&&!busy&&<div className="materials-empty"><Icon name="file"/><h3>아직 답변이 없어요</h3><p>{analyst?'자료를 선택하고 ChatGPT에 물어볼 내용을 준비해 주세요.':'자료만 올려 두세요. 답변이 준비되면 함께 볼 수 있어요.'}</p></div>}
    <ul className="chat-request-list">{rows.map(row=><li key={row.id} data-chat-request={row.id}><div><strong>{row.status==='ready'?'답변 도착':row.status==='preparing'?'요청 준비 중':'답변 대기'}</strong><small>{new Date(row.createdAt).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric'})} · 파일 {row.documentCount}개 · 메모 {row.noteCount}개</small></div><div className="private-actions">{row.status==='preparing'?analyst&&<button className="secondary" disabled={busy} onClick={()=>void resume(row.id)}>준비 이어하기</button>:<button className="secondary" disabled={busy} onClick={()=>void read(row.id)}>{row.status==='ready'?'답변 읽기':'답변 확인'}</button>}{analyst&&row.status!=='preparing'&&<button className="secondary" disabled={busy} onClick={()=>void requestText(row.id)}>요청문 보기</button>}</div></li>)}</ul>
    {answer&&<article className="private-card chat-answer" aria-label="도착한 답변"><div className="copy-toolbar"><CopyButton value={answer.body}/></div><h3>자료를 읽고 정리한 내용</h3><div className="record-body">{answer.body}</div>{!!answer.result&&answer.receiptId&&<div className="chat-answer-apply"><p className="materials-caption">준비할 일과 메모에 추가할 내용이 있어요. 확인한 항목만 저장할 수 있어요.</p><button disabled={busy} onClick={()=>onReview({id:answer.receiptId!,result:answer.result})}>추가할 내용 확인</button></div>}</article>}
    <p role="status">{message}</p>
  </section>;
}
