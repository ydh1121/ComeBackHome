import assert from 'node:assert/strict';
export async function verifyAnalysisV2Model(vite) {
  const m=await vite.ssrLoadModule('/src/modules/injury/materials/analysis-model.ts');
  const {RECORD_SPECS}=await vite.ssrLoadModule('/src/modules/injury/domain/records.ts');
  const {caseDeadlines}=await vite.ssrLoadModule('/src/modules/injury/domain/deadlines.ts');
  let checks=0;
  const check=(a,b)=>{assert.deepEqual(a,b);checks++;};
  const bad=value=>{assert.throws(()=>m.reviewAnalysis(value));checks++;};
  const wrap=(...suggestions)=>({version:'cbh-analysis/v2',suggestions});
  const suggest=(kind,data)=>({type:'record',kind,title:'Synthetic '+kind,body:'Synthetic source observation',sourceIds:[],data});
  const fixtures=Object.entries(RECORD_SPECS).map(([kind,spec])=>suggest(kind,Object.fromEntries(spec.fields.filter(f=>f.required).map(f=>[f.key,f.type==='select'?f.options[0][0]:f.type==='date'?'2026-01-15':f.type==='number'?(f.min??0):f.type==='boolean'?false:f.key==='paidWeekdays'?'1,2,3,4,5':'synthetic-value']))));
  const all=m.reviewAnalysis(wrap(...fixtures));
  check(all.seed.records.map(r=>r.kind),Object.keys(RECORD_SPECS));
  check(all.seed.records.every(r=>r.payload.certainty==='reported'),true);
  for(const suggestion of all.result.suggestions) {
    check(m.suggestionLabel(suggestion),RECORD_SPECS[suggestion.kind].title);
    check(m.suggestionRecord(suggestion).kind,suggestion.kind);
  }
  const special=[
    suggest('intake',{status:'approved',caseType:'disease',diagnosis:'Synthetic proposed finding',decisionAt:'2026-01-15',from:'2026-01-01',to:'2026-01-31'}),
    suggest('treatment',{status:'approved',extensionStatus:'decided',from:'2026-01-01',to:'2026-01-31',appointmentAt:'2026-01-15',diagnosis:'Synthetic finding'}),
    suggest('benefit_claim',{benefitType:'unemployment',status:'approved',allocatedDays:30,officialRemainingDays:20,expiresAt:'2026-12-31',expectedAmount:1200}),
    suggest('unemployment_activity',{claimId:'synthetic-claim',status:'recognized',incomeReport:'none',recognitionAt:'2026-01-15',requiredActivities:2,recognizedDays:10}),
    suggest('agency_request',{status:'needed',dueDate:'2026-01-15'}),
    suggest('employer_opinion',{status:'sent',notifiedAt:'2026-01-15',extensionConfirmed:true}),
    suggest('task',{status:'done',deadlineKind:'official',dueDate:'2026-01-15',doneAt:'2026-01-15'}),
    suggest('paid_day',{date:'2026-01-15',dayType:'paid_work',verification:'agency'}),
    suggest('exposure',{date:'2026-01-15',measurement:'measured',diagnosisStatus:'confirmed',minutes:10}),
    suggest('content',{category:'reference',medium:'none',recipient:'advisor-profile/v1'}),
    suggest('payroll',{statementVerified:true,policyId:'synthetic-policy',basePay:1000}),
  ];
  const held=m.reviewAnalysis(wrap(...special));
  check(held.seed.records.every(r=>r.payload.certainty==='reported'),true);
  check(held.seed.records.every(r=>r.payload.body.includes('분석 제안에서 보류한 정보')),true);
  check(held.seed.records[0].payload.data.status,'preparing');
  check(held.seed.records[1].payload.data.status,'pending');
  check(held.seed.records[2].payload.data.status,'estimate');
  check(held.seed.records[2].payload.data.expectedAmount,1200);
  check(held.seed.records[2].payload.data.officialRemainingDays,undefined);
  check(held.seed.records[3].payload.data.status,'planned');
  check(held.seed.records[4].payload.data.dueDate,undefined);
  check(held.seed.records[5].payload.data.notifiedAt,undefined);
  check(held.seed.records[5].payload.data.extensionConfirmed,false);
  check(held.seed.records[6].payload.data,{status:'todo',deadlineKind:'recommended',dueDate:'2026-01-15'});
  check(held.seed.records[7].payload.data.verification,'estimated');
  check(held.seed.records[8].payload.data.diagnosisStatus,'unknown');
  check(held.seed.records[8].payload.data.measurement,'estimated');
  check(held.seed.records[9].payload.data.recipient,undefined);
  check(held.seed.records[10].payload.data.statementVerified,false);
  check(held.seed.records[10].payload.data.basePay,1000);
  check(m.reviewAnalysis(held.result),held);
  const records=held.seed.records.map((r,i)=>({...r,id:'synthetic-'+i,caseId:'synthetic-case',revision:1,updatedBy:'synthetic-member',updatedAt:'2026-01-15',archivedAt:null}));
  check(caseDeadlines(records,'2026-01-15').some(d=>d.kind!=='recommended'),false);
  const moves=[{documentId:'synthetic-document',category:'medical'}];
  check(m.reviewAnalysis({...wrap(),documentMoves:moves}).result.documentMoves,moves);
  for(const patch of [{category:'..'},{documentId:'../file'},{approved:true}])bad({...wrap(),documentMoves:[{...moves[0],...patch}]});
  for(const invalid of [
    {...fixtures[0],kind:'payment'}, {...fixtures[0],certainty:'official'}, {...fixtures[0],approved:true},
    {...fixtures[0],data:{category:'reference',medium:'none',unknownField:1}},
    suggest('treatment',{status:'approved',extensionStatus:'none',appointmentAt:'2026-02-30'}),
    suggest('employment',{employmentType:'regular',actualOrSimulated:'actual',wageType:'monthly'}),
    suggest('expense',{serviceDate:'2026-01-15',status:'review',totalAmount:-1}),
    suggest('paid_day',{date:'2026-01-15',dayType:'paid_work',verification:'agency',sourceDocument:'unlisted-document'}),
    {...fixtures[0],sourceIds:[9]}, {...fixtures[0],body:'x'.repeat(60001)},
  ])bad(wrap(invalid));
  bad({...wrap(fixtures[0]),payments:[]});
  bad({...wrap(),documentMoves:[...moves,...moves]});
  bad(wrap());
  bad(wrap(...Array(41).fill(fixtures[0])));
  const source={...fixtures.find(f=>f.kind==='paid_day'),sourceIds:['synthetic-document'],data:{date:'2026-01-15',dayType:'paid_work',verification:'estimated',sourceDocument:'synthetic-document'}};
  check(m.reviewAnalysis(wrap(source)).seed.records[0].payload.data.sourceDocument,'synthetic-document');
  const reordered={...fixtures[0],data:Object.fromEntries(Object.entries(fixtures[0].data).reverse())};
  check(m.reviewAnalysis(wrap(reordered)),m.reviewAnalysis(wrap(fixtures[0])));
  const parent={...fixtures.find(f=>f.kind==='employment'),ref:'job'};
  const child={...fixtures.find(f=>f.kind==='paid_day'),ref:'paid',data:{date:'2026-01-15',dayType:'paid_work',verification:'estimated',employmentId:'@job'}};
  const chain={type:'task',ref:'followup',title:'Synthetic followup',body:'Synthetic',sourceIds:[]};
  check(m.suggestionDependencies(child),['job']);
  check(m.analysisDependencyOrder([child,parent,chain]),[1,0,2]);
  const hash=async value=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))).toString('hex');
  const resolved=await m.resolveAnalysisSeed(m.reviewAnalysis(wrap(child,parent)),hash);
  check(resolved.records.map(r=>r.kind),['employment','paid_day']);
  const parentId='import-'+(await hash(JSON.stringify(resolved.records[0]))).slice(0,48);
  check(resolved.records[1].payload.data.employmentId,parentId);
  check(await m.resolveAnalysisSeed(m.reviewAnalysis(wrap(parent,child)),hash),resolved);
  for(const list of [[child],[parent,{...child,data:{...child.data,employmentId:'@missing'}}],[parent,{...parent}],
    [{...parent,ref:'bad ref'},child],[{...chain,ref:'job'},child],
    [{...suggest('task',{status:'todo',deadlineKind:'recommended',relatedId:'@second'}),ref:'first'},
      {...suggest('task',{status:'todo',deadlineKind:'recommended',relatedId:'@first'}),ref:'second'}],
    [{...suggest('task',{status:'todo',deadlineKind:'recommended',relatedId:'@self'}),ref:'self'}]])bad(wrap(...list));
  bad({version:'cbh-analysis/v1',suggestions:[chain]});
  console.log('PRIVATE_ANALYSIS_V2_MODEL_PASS checks='+checks+' all_record_kinds_reported_preserved_official_fields_no_ledger_no_official_deadlines');
}
