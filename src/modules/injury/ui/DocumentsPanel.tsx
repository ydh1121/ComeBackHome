import { useEffect, useRef, useState } from "react";
import { privateRequest } from "../../auth/client";
import type { CaseData } from "./types";
import { driveConnectionNotice } from "../domain/drive-connection";
import { Icon } from "../../../shared/components/Icon";
import { RECORD_SPECS, type CaseRecord, type RecordKind } from "../domain/records";
import { isProfile } from "../advisor/model";
import { RecordCard, payloadText } from "./RecordEditor";
import { analysisPrompt, documentError, MAX_FILES, MAX_BATCH_BYTES } from "../materials/model";
import { uploadOriginal } from "../materials/upload";
import { NotesComposer } from "../materials/NotesComposer";
import { AnalysisReview, AnalysisRequest } from "../materials/AnalysisReview";
import "../materials/materials.css";
const base = "private/case/documents";
declare global {
  interface Window {
    gapi?: {
      load: (
        name: string,
        options: { callback: () => void; onerror: () => void },
      ) => void;
    };
    google?: { picker: PickerApi };
  }
}
interface PickerApi {
  DocsView: new (view: unknown) => {
    setIncludeFolders: (value: boolean) => unknown;
    setSelectFolderEnabled: (v: boolean) => unknown;
    setMimeTypes: (v: string) => unknown;
  };
  ViewId: { FOLDERS: unknown };
  PickerBuilder: new () => {
    setDeveloperKey: (key: string) => unknown;
    setAppId: (id: string) => unknown;
    setOAuthToken: (token: string) => unknown;
    addView: (view: unknown) => unknown;
    setCallback: (
      fn: (data: { action: string; docs?: Array<{ id: string }> }) => void,
    ) => unknown;
    setOrigin: (origin: string) => unknown;
    build: () => { setVisible: (v: boolean) => void };
  };
  Action: { PICKED: string; CANCEL: string };
}
async function loadPicker() {
  if (window.google?.picker) return;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.onload = () =>
      window.gapi?.load("picker", {
        callback: resolve,
        onerror: () => reject(Error("폴더 선택기를 열지 못했습니다.")),
      });
    script.onerror = () => reject(Error("폴더 선택기를 불러오지 못했습니다."));
    document.head.append(script);
  });
}
type UploadItem = { key:string; file?:File; name:string; state:'waiting'|'uploading'|'done'|'failed'|'cancelled'; progress:number; error?:string };
const documentState:Record<string,string> = {ready:'보관 완료',pending:'전송 대기',uploading:'전송 중단 · 재시도 가능',verifying:'원본 확인 중',failed:'원본 확인 필요',missing:'원본 찾기 필요',trashed:'숨긴 자료'};
export function DocumentsPanel({data,reload,openRecord,createRecord}:{data:CaseData;reload:()=>Promise<void>;openRecord?:(record:CaseRecord)=>void;createRecord?:(kind:RecordKind)=>void}) {
  const [status,setStatus]=useState<{configured:boolean;owner:boolean;connected:boolean;folderSelected:boolean}|null>(null);
  const [message,setMessage]=useState(()=>driveConnectionNotice(new URLSearchParams(location.search).get('drive')));
  const [busy,setBusy]=useState(false),[queue,setQueue]=useState<UploadItem[]>([]),[selected,setSelected]=useState<Set<string>>(new Set()),[query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[hidden,setHidden]=useState(false),[question,setQuestion]=useState(''),[handoff,setHandoff]=useState('');
  const controller=useRef<AbortController|null>(null),lock=useRef(false),mounted=useRef(true);
  const refresh=()=>privateRequest<NonNullable<typeof status>>(base+'/status').then(setStatus);
  useEffect(()=>{
    mounted.current=true;void refresh().catch(e=>setMessage(e.message));
    return()=>{mounted.current=false;controller.current?.abort();controller.current=null;};
  },[]);
  const notes=data.records.filter(r=>!isProfile(r)&&RECORD_SPECS[r.kind].group==='documents');
  const activeKeys=new Set([...data.documents.filter(d=>d.status==='ready').map(d=>'d:'+d.id),...notes.filter(r=>!r.archivedAt).map(r=>'r:'+r.id)]);
  useEffect(()=>{setSelected(v=>new Set([...v].filter(k=>activeKeys.has(k))));},[data]); // Selected sources never survive archival/revocation.
  const selectedDocuments=data.documents.filter(d=>d.status==='ready'&&selected.has('d:'+d.id));
  const selectedNotes=notes.filter(r=>!r.archivedAt&&selected.has('r:'+r.id));
  const selectedCount=selectedDocuments.length+selectedNotes.length;
  const toggle=(key:string)=>setSelected(v=>{const n=new Set(v);n.has(key)?n.delete(key):n.add(key);return n;});
  const matches=(text:string)=>text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const documents=data.documents.filter(d=>(d.status==='trashed')===hidden&&matches(d.filename)&&filter!=='notes');
  const visibleNotes=notes.filter(r=>!!r.archivedAt===hidden&&matches(r.payload.title+' '+r.payload.body)&&filter!=='files');
  const visibleKeys=[...documents.filter(d=>d.status==='ready').map(d=>'d:'+d.id),...visibleNotes.filter(r=>!r.archivedAt).map(r=>'r:'+r.id)];
  const connect=async()=>{
    if(lock.current)return;lock.current=true;setBusy(true);setMessage('');
    try{const r=await privateRequest<{url:string}>(base+'/oauth/start','POST',{});location.assign(r.url);}
    catch(e){setMessage((e as Error).message);}finally{lock.current=false;setBusy(false);}
  };
  const folder=async()=>{
    if(lock.current)return;lock.current=true;setBusy(true);
    try{
      await loadPicker();
      const config=await privateRequest<{accessToken:string;apiKey:string;appId:string}>(base+'/picker','POST',{}),api=window.google!.picker;
      const view=new api.DocsView(api.ViewId.FOLDERS);view.setIncludeFolders(true);view.setSelectFolderEnabled(true);view.setMimeTypes('application/vnd.google-apps.folder');
      const builder=new api.PickerBuilder();builder.setDeveloperKey(config.apiKey);builder.setAppId(config.appId);builder.setOAuthToken(config.accessToken);builder.setOrigin(location.origin);builder.addView(view);
      builder.setCallback(result=>{if(result.action===api.Action.PICKED&&result.docs?.[0])void privateRequest(base+'/folder','PUT',{folderId:result.docs[0].id}).then(refresh).catch(e=>setMessage(e.message));});
      builder.build().setVisible(true);
    }catch(e){setMessage((e as Error).message);}finally{lock.current=false;setBusy(false);}
  };
  const chooseFiles=(files:File[])=>{
    if(lock.current||!files.length)return;
    const pending=queue.filter(q=>q.state!=='done');
    if(files.length+pending.length>MAX_FILES){setMessage('한 번에 20개까지 선택할 수 있어요.');return;}
    if(files.reduce((n,f)=>n+f.size,0)+pending.reduce((n,q)=>n+(q.file?.size??0),0)>MAX_BATCH_BYTES){setMessage('선택한 파일의 합계는 100MB까지 가능해요. 나눠서 선택해 주세요.');return;}
    const keys=new Set(pending.map(q=>q.key));
    const next=[...pending];let duplicate=0;
    for(const file of files){
      const key=[file.name,file.size,file.lastModified].join(':');
      if(keys.has(key)){duplicate++;continue;}
      keys.add(key);const error=documentError(file);
      next.push({key,name:file.name,file:error?undefined:file,state:error?'failed':'waiting',progress:0,error:error??undefined});
    }
    setQueue(next);setMessage(duplicate?`이미 선택한 파일 ${duplicate}개는 제외했어요.`:'파일을 확인한 뒤 보관 버튼을 눌러 주세요.');
  };
  const upload=async(keys?:string[])=>{
    if(lock.current)return;
    const batch=queue.filter(q=>q.file&&q.state!=='done'&&(!keys||keys.includes(q.key)));
    if(!batch.length)return;
    lock.current=true;setBusy(true);setHandoff('');setMessage('');
    const abort=new AbortController();controller.current=abort;let done=0,failed=0;
    const update=(key:string,patch:Partial<UploadItem>)=>{if(mounted.current)setQueue(v=>v.map(q=>q.key===key?{...q,...patch}:q));};
    for(const q of batch){
      if(abort.signal.aborted)break;
      update(q.key,{state:'uploading',error:undefined});
      try{
        const id=await uploadOriginal(q.file!,abort.signal,p=>update(q.key,{progress:p}));
        update(q.key,{state:'done',file:undefined,progress:100});done++;
        if(mounted.current)setSelected(v=>new Set([...v,'d:'+id]));
      }catch(e){
        update(q.key,{state:abort.signal.aborted?'cancelled':'failed',error:abort.signal.aborted?'전송을 멈췄어요. 다시 시도하면 이어서 보관해요.':(e as Error).message});
        if(abort.signal.aborted)break;failed++;
      }
    }
    if(mounted.current){
      setMessage(abort.signal.aborted?'전송을 멈췄어요. 완료된 원본은 유지되며 나머지는 재시도할 수 있어요.':failed?`${done}개 보관 완료 · ${failed}개는 다시 시도해 주세요.`:`원본 보관 확인 완료 · ${done}개`);
      await reload().catch(()=>setMessage('보관 결과를 다시 불러오지 못했어요. 새로고침으로 확인해 주세요.'));
      setBusy(false);
    }
    controller.current=null;lock.current=false;
  };
  const action=async(id:string,type:'archive'|'restore'|'verify')=>{
    if(lock.current)return;lock.current=true;setBusy(true);setMessage('');
    try{await privateRequest(base+'/'+id+'/'+type,'POST',{});setHandoff('');await reload();setMessage(type==='archive'?'목록에서 숨겼어요. Drive 원본은 그대로예요.':'원본 보관 상태를 확인했어요.');}
    catch(e){setMessage((e as Error).message);}finally{lock.current=false;setBusy(false);}
  };
  const prepare=async()=>{
    if(lock.current||!selectedCount)return;lock.current=true;setBusy(true);setHandoff('');setMessage('원본을 확인하고 요청문을 묶는 중…');
    const abort=new AbortController();controller.current=abort;
    try{
      const documents=[];
      for(const d of selectedDocuments){
        const verified=await privateRequest<{url:string;sha256:string}>(base+'/'+d.id+'/handoff','GET',undefined,abort.signal);
        documents.push({id:d.id,filename:d.filename,...verified});
      }
      const value=analysisPrompt(documents,selectedNotes.map(r=>({id:r.id,title:r.payload.title,body:payloadText(r.payload,r.kind,data),revision:r.revision})),question);
      if(value.length>180000)throw Error('요청문이 너무 길어요. 자료를 나눠 선택해 주세요.');
      if(mounted.current){setHandoff(value);setMessage(`${selectedCount}개 자료를 하나의 요청문으로 준비했어요.`);}
    }catch(e){if(mounted.current)setMessage(abort.signal.aborted?'요청문 준비를 취소했어요.':(e as Error).message);}
    finally{controller.current=null;lock.current=false;if(mounted.current)setBusy(false);}
  };
  const pendingCount=queue.filter(q=>q.file&&q.state!=='done').length;
  return <section className="materials-workspace" aria-label="자료·메모 보관함">
    <div className="materials-heading"><div><h2>내 자료</h2><p>받은 서류와 적어 둔 메모를 한곳에서</p></div><small>{data.documents.filter(d=>d.status!=='trashed').length}개 파일 · {notes.filter(r=>!r.archivedAt).length}개 메모·기록</small></div>
    <details className="materials-connection" open={!status?.folderSelected||!!new URLSearchParams(location.search).get('drive')}>
      <summary>{status?.folderSelected?'Google Drive 연결됨':'원본 보관 연결'}</summary>
      {!status?<p>연결을 확인하고 있어요…</p>:!status.configured?<p>관리자가 Google Drive 설정을 완료하면 파일을 보관할 수 있어요. 메모는 지금도 작성할 수 있어요.</p>:<>
        <p className="materials-caption">{status.folderSelected?'원본 파일은 연결한 비공개 Drive 폴더에 보관해요.':status.connected?'Google 계정이 연결됐어요. 보관할 폴더를 선택해 주세요.':'Google 계정을 연결하고 비공개 보관 폴더를 선택해 주세요.'}</p>
        {status.owner&&<div className="private-actions"><button className="secondary" disabled={busy} onClick={()=>void connect()}>{status.connected?'Google 계정 다시 연결':'Google Drive 연결'}</button>{status.connected&&<button className="secondary" disabled={busy} onClick={()=>void folder()}>보관 폴더 선택</button>}</div>}
      </>}
    </details>
    {status?.folderSelected&&<div className="materials-upload private-card">
      <label className="materials-file-label"><span><Icon name="upload"/><strong>파일 여러 개 추가</strong></span><small>PDF·사진 · 파일당 20MB · 한 번에 20개</small><input type="file" multiple accept="application/pdf,image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>{chooseFiles(Array.from(e.target.files??[]));e.currentTarget.value='';}}/></label>
      {!!queue.length&&<ul className="upload-queue" aria-label="선택한 파일">{queue.map(q=><li key={q.key} data-upload-state={q.state}><div><strong>{q.name}</strong><small>{q.state==='done'?'보관 완료':q.error??(q.state==='uploading'?`보관 중 ${q.progress}%`:'보관 대기')}</small>{q.state==='uploading'&&<progress value={q.progress} max={100} aria-label={q.name+' 전송률'}/>}</div>{q.file&&['failed','cancelled'].includes(q.state)&&<button className="secondary" disabled={busy} onClick={()=>void upload([q.key])}>재시도</button>}<button className="secondary" aria-label={q.name+' 선택 해제'} disabled={busy} onClick={()=>setQueue(v=>v.filter(n=>n.key!==q.key))}><Icon name="close"/></button></li>)}</ul>}
      <div className="private-actions">{!!pendingCount&&<button disabled={busy} onClick={()=>void upload()}>선택한 {pendingCount}개 파일 보관</button>}{busy&&controller.current&&<button className="secondary" onClick={()=>controller.current?.abort()}>전송 취소</button>}</div>
    </div>}
    <NotesComposer reload={reload}/>
    {createRecord&&<details className="private-card materials-record-create"><summary>다른 내용 기록하기</summary><div className="management-kind-list">{([
      ['agency_request','기관에 요청한 서류'],
      ['exposure','몸 상태·일한 내용'],
      ['incident','회사와 나눈 대화'],
      ['content','안내·연락처·전달문'],
    ] as const).map(([kind,title])=><button className="secondary" key={kind} disabled={busy} onClick={()=>createRecord(kind)}>{title}<Icon name="chevron-right"/></button>)}</div></details>}
    <p role="status" className="materials-feedback">{message}</p>
    <div className="materials-tools"><label>자료 찾기<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="파일 이름·메모 내용 검색"/></label><label className="auth-check"><input type="checkbox" checked={hidden} disabled={busy} onChange={e=>{setHidden(e.target.checked);setSelected(new Set());setHandoff('');}}/>숨긴 자료</label></div>
    <div className="materials-filters" role="group" aria-label="자료 종류">{[['all','전체'],['files','파일'],['notes','메모·기록']].map(([key,title])=><button className="secondary" aria-pressed={filter===key} onClick={()=>setFilter(key)} key={key}>{title}</button>)}{!hidden&&!!visibleKeys.length&&<button className="secondary materials-select-all" disabled={busy} onClick={()=>setSelected(v=>{const n=new Set(v),all=visibleKeys.every(k=>n.has(k));for(const k of visibleKeys)all?n.delete(k):n.add(k);return n;})}>{visibleKeys.every(k=>selected.has(k))?'선택 해제':'보이는 자료 모두 선택'}</button>}</div>
    <div className="document-list materials-list">
      {documents.map(d=><article className="material-row" key={d.id} data-document-id={d.id}>
        <label className="material-select"><input type="checkbox" aria-label={d.filename+' 선택'} disabled={busy||d.status!=='ready'} checked={selected.has('d:'+d.id)} onChange={()=>toggle('d:'+d.id)}/></label>
        <details><summary><span className="material-icon"><Icon name={d.mime.startsWith('image/')?'image':'file'}/></span><span><h3>{d.filename}</h3><small>{documentState[d.status]??'상태 확인 필요'} · {Math.ceil(d.bytes/1024)} KB</small></span><Icon name="chevron-down"/></summary>
          <div className="private-actions">{d.status==='ready'?<a className="private-button secondary" href={'/api/'+base+'/'+d.id+'/download'} download>원본 다운로드</a>:<button className="secondary" disabled={busy} onClick={()=>void action(d.id,d.status==='trashed'?'restore':'verify')}>{d.status==='trashed'?'원본 확인 후 복원':'보관 상태 다시 확인'}</button>}{d.status!=='trashed'&&<button className="secondary" disabled={busy} onClick={()=>{if(confirm('목록에서 숨길까요? Drive 원본은 삭제되지 않습니다.'))void action(d.id,'archive')}}>목록에서 숨기기</button>}</div>
        </details>
      </article>)}
      {visibleNotes.map(r=><article className="material-row" key={r.id} data-material-record={r.id}><label className="material-select"><input type="checkbox" aria-label={r.payload.title+' 선택'} disabled={busy||!!r.archivedAt} checked={selected.has('r:'+r.id)} onChange={()=>toggle('r:'+r.id)}/></label><details><summary><span className="material-icon"><Icon name="edit"/></span><span><h3>{r.payload.title}</h3><small>{RECORD_SPECS[r.kind].title} · {new Date(r.updatedAt).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'})}</small></span><Icon name="chevron-down"/></summary><RecordCard record={r} data={data} open={!r.archivedAt&&openRecord?()=>openRecord(r):undefined}/>{r.archivedAt&&<button className="secondary" disabled={busy} onClick={async()=>{try{await privateRequest('private/case/records/'+r.id+'/restore','POST',{revision:r.revision});await reload();}catch(e){setMessage((e as Error).message);}}}>메모 복원</button>}</details></article>)}
      {!documents.length&&!visibleNotes.length&&<div className="materials-empty"><Icon name="file"/><h3>{query?'찾는 자료가 없어요':hidden?'숨긴 자료가 없어요':'아직 보관한 자료가 없어요'}</h3><p>{query?'다른 검색어로 찾아보세요.':'파일을 추가하거나 메모를 적어 두세요.'}</p></div>}
    </div>
    {!!selectedCount&&<section className="private-card materials-batch" aria-label="선택한 자료로 할 일"><div className="materials-batch-heading"><strong>{selectedCount}개 선택</strong><button className="secondary" disabled={busy} onClick={()=>{setSelected(new Set());setHandoff('');}}>선택 해제</button></div><label>궁금한 점 <small>선택사항</small><input disabled={busy} value={question} onChange={e=>setQuestion(e.target.value)} maxLength={1000} placeholder="예: 빠진 서류와 다음에 할 일을 알려줘"/></label><button disabled={busy} onClick={()=>void prepare()}>GPT 분석 요청 한 번에 준비</button></section>}
    {handoff&&<AnalysisRequest value={handoff} change={setHandoff} close={()=>setHandoff('')}/>}
    <AnalysisReview data={data} reload={reload}/>
  </section>;
}
