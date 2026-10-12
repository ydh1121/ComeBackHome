import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {invalidWeeklyPayloads} from './approved-weekly-import-cases.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const vite=await createServer({root,appType:'custom',logLevel:'error',server:{middlewareMode:true}});
const values=new Map();
globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
try {
  const [{commitApprovedWorkbookImport},{BrowserImportRepository},{ImportWorkflowService},
    {CommitImportReview},{WorkbookImportFileSelectionAction,getPrivateImportImageUrl,releasePrivateImportImage}]=await Promise.all([
    vite.ssrLoadModule('/worker/approved-workbook-import.ts'),
    vite.ssrLoadModule('/src/providers/browser/BrowserImportRepository.ts'),
    vite.ssrLoadModule('/src/application/services/ImportWorkflowService.ts'),
    vite.ssrLoadModule('/src/application/use-cases/commitImportReview.ts'),
    vite.ssrLoadModule('/src/application/services/WorkbookImportFileSelectionAction.ts'),
  ]);
  let dbCalls=0;
  const db={prepare(){dbCalls++;throw Error('UNEXPECTED_SQL');}};
  for(const {payload,error} of invalidWeeklyPayloads()){
    await assert.rejects(commitApprovedWorkbookImport(db,payload),new RegExp(error));
  }
  assert.equal(dbCalls,0,'invalid image approvals must fail before any D1 call');
  const imports=new BrowserImportRepository();
  const saved=new Map();
  const people={list:async()=>[{id:'existing-person',name:'합성직원'}],
    get:async id=>({id,name:'합성직원'})};
  const schedules={getByDate:async(id,date)=>saved.get(id+'|'+date)??null};
  const workflow=new ImportWorkflowService(imports,people,schedules);
  const parsed={detectedPeople:[{sourceName:'합성직원',confidence:.2}],scheduleCandidates:[],
    structure:{sheet:'weekly 7 day x start/end/break physical matrix',headerRow:2,
      personColumn:'name',dateColumn:'week',shiftColumn:'3 fields',needsReview:true,
      weeklyReview:{status:'PARTIAL_REVIEW_REQUIRED',startDate:null,confirmed:false}},confidence:.2,
    reviewCandidates:Array.from({length:7},(_,dayIndex)=>({
      sourcePersonName:'합성직원',date:null,dayIndex,sourceRow:1,
      sourceRegion:{x:dayIndex*30,y:50,width:30,height:20},
      start:'09:00',end:'18:00',breakMinutes:30,confidence:.2,recognitionState:'WORK',
    }))};
  const select=new WorkbookImportFileSelectionAction(imports,people,schedules,
    {parse:async()=>{throw Error('UNEXPECTED_XLSX');}}, {parse:async()=>structuredClone(parsed)});
  const batchId=await select.accept([{kind:'IMAGE',file:new File(['synthetic'],'synthetic.png',{type:'image/png'})}]);
  assert.ok(getPrivateImportImageUrl(batchId)?.startsWith('blob:'));
  let batch=await imports.getBatch(batchId);
  assert.equal(batch.reviewItems.length,7);
  assert.deepEqual(batch.reviewItems[0].sourceRegion,parsed.reviewCandidates[0].sourceRegion);
  let writes=0,committedPayload;
  const gateway={async commit(payload){
    writes++;committedPayload=payload;
    for(const row of payload.schedules){
      saved.set('existing-person|'+row.date,{...row,start:row.start??'00:00',end:row.end??'00:00'});
    }
    return {requestId:payload.requestId,applied:true,
      people:[{ref:payload.people[0].ref,personId:'existing-person',created:false}],schedules:payload.schedules};
  }};
  const commit=new CommitImportReview(imports,schedules,gateway);
  await assert.rejects(commit.execute(batchId),/WEEKLY_DATES_NOT_CONFIRMED/);
  await workflow.setWeeklyStartDate(batchId,'2026-10-12');
  saved.set('existing-person|2026-10-12',{enabled:true,start:'08:00',end:'17:00',breakMinutes:15});
  await workflow.confirmWeeklyDates(batchId);
  batch=await imports.getBatch(batchId);
  assert.equal(batch.reviewItems[0].existing.start,'08:00','week confirmation must fetch current existing schedule');
  await assert.rejects(commit.execute(batchId),/unreviewed schedules/);
  for(const row of batch.reviewItems)await workflow.setResolution(batchId,row.id,'NEW');
  await workflow.setImportedBreakMinutes(batchId,batch.reviewItems[0].id,45);
  await assert.rejects(commit.execute(batchId),/unreviewed schedules/);
  assert.equal(writes,0);
  await workflow.setResolution(batchId,batch.reviewItems[0].id,'NEW');
  await commit.execute(batchId);
  assert.equal(writes,1);
  assert.equal(committedPayload.source,'WEEKLY_IMAGE');
  assert.equal(committedPayload.datesConfirmed,true);
  assert.equal(committedPayload.schedules[0].existing.start,'08:00');
  assert.equal(getPrivateImportImageUrl(batchId),null,'approved image URL must be released');
  assert.ok((await imports.getBatch(batchId)).committed);

  const second=await select.accept([{kind:'IMAGE',file:new File(['synthetic'],'retry.png',{type:'image/png'})}]);
  await workflow.setWeeklyStartDate(second,'2026-10-12');
  await workflow.confirmWeeklyDates(second);
  const ref=(await imports.getBatch(second)).detectedPeople[0].id;
  await workflow.setPendingNewPerson(second,ref,'수정직원');
  const changed=await imports.getBatch(second);
  assert.equal(changed.detectedPeople[0].pendingCreate,true);
  assert.ok(changed.reviewItems.every(r=>r.personId===null&&r.existing===undefined&&r.resolution===null));
  releasePrivateImportImage();
  assert.equal(getPrivateImportImageUrl(second),null);
  assert.ok([...values.values()].every(v=>!v.includes('blob:')),'original-image URLs must never be persisted');
  console.log('OCR_APPROVED_REVIEW_CONTRACT_PASS: ten server rejection gates, date confirmation, current snapshots, cell association, revoked approvals, atomic gateway, private URL lifetime');
} finally {delete globalThis.localStorage;await vite.close();}
