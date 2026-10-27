import assert from 'node:assert/strict';
export async function verifyAdvisorR2Model(vite) {
  const m = await vite.ssrLoadModule('/src/modules/injury/advisor/scenarios.ts');
  const p = await vite.ssrLoadModule('/src/modules/injury/advisor/model.ts');
  const { validatePayload } = await vite.ssrLoadModule('/src/modules/injury/domain/records.ts');
  const { caseDeadlines } = await vite.ssrLoadModule('/src/modules/injury/domain/deadlines.ts');
  const { todaySeoul } = await vite.ssrLoadModule('/src/modules/injury/domain/dates.ts');
  const empty = () => ({ caseId:'case-fixture', owner:true, actors:[], records:[], policies:[], documents:[], payments:[], deadlines:[], overlaps:[] });
  let checks = 0;
  const equal = (a,b) => { assert.deepEqual(a,b); checks++; };
  const record = (id,kind,data,certainty='reported') => ({ id,caseId:'case-fixture',kind,payload:{title:'Synthetic '+kind,body:'Synthetic only',certainty,sourceIds:certainty==='official'?['synthetic-source']:[],data},revision:1,updatedBy:'synthetic-member',updatedAt:'2026-10-27T00:00:00Z',archivedAt:null });
  const withProfile = (answers) => ({...record(p.profileId('case-fixture'),'content',{}),payload:p.profilePayload({...p.emptyProfile(),answers,confirmed:true})});
  const examples = [
    ['A',[]], ['B',[withProfile([null,null,'checking'])]], ['C',[withProfile([null,'working','restriction'])]],
    ['D',[record('i','intake',{status:'preparing'})]], ['E',[record('i','intake',{status:'filed',smsReceived:false})]],
    ['F',[record('i','intake',{status:'investigating'})]], ['G',[record('i','intake',{status:'approved'},'official')]],
    ['H',[record('t','treatment',{status:'approved',extensionConsidered:true})]], ['I',[record('x','expense',{status:'review'})]],
    ['J',[record('b','benefit_claim',{benefitType:'workers_comp_leave',status:'estimate',incapacityDays:20})]],
    ['K',[record('r','resignation',{status:'left'})]], ['L',[record('d','disability',{status:'review',residual:'possible'})]],
  ];
  equal(m.SCENARIOS.length,12);
  for (const [id,records] of examples) {
    const data={...empty(),records}, before=structuredClone(data), list=m.recommend(data,'2026-10-27');
    assert(list.some(a=>a.scenario.id===id),id); checks++;
    equal(data,before);
    equal(new Set(list.map(a=>a.scenario.id)).size,list.length);
    const spec=m.scenario(id);
    assert(spec.steps.length && spec.materials.length && spec.script && spec.caution && spec.options.length); checks++;
    validatePayload('content',p.scriptPayload(spec.script)); checks++;
  }
  equal(m.recommend({...empty(),records:[record('old','intake',{status:'approved'})].map(r=>({...r,archivedAt:'2026-10-27'}))},'2026-10-27')[0].scenario.id,'A');
  equal(m.recommend({...empty(),records:[record('i','intake',{status:'denied'},'official')]},'2026-10-27')[0].scenario.id,'G');
  equal(m.recommend({...empty(),records:[record('e','employer_opinion',{status:'disputed'})]},'2026-10-27')[0].scenario.id,'F');
  equal(m.recommend({...empty(),records:[withProfile([null,'working',null])]},'2026-10-27')[0].scenario.id,'A');
  const data=empty(), reply={version:1,scenario:'A',answer:'restriction',deferred:false,basis:m.responseBasis(data),at:'2026-10-27T00:00:00Z'};
  const response={...record(m.responseId(data.caseId,'A'),'content',{}),payload:m.responsePayload(reply)};
  data.records.push(response);
  equal(validatePayload('content',response.payload),response.payload);
  equal(m.currentResponse(data,'A'),reply);
  equal(m.recommend(data,'2026-10-27')[0].scenario.id,'C');
  equal(response.payload.certainty,'reported'); equal(response.payload.sourceIds,[]);
  equal(p.readProfile(response),null); equal(p.isProfile(response),true);
  for (const patch of [{answer:'approved'},{answer:false},{scenario:'Z'},{version:2},{deferred:'yes'},{at:'invalid'}]) equal(m.readResponse({...response,payload:{...response.payload,body:JSON.stringify({...reply,...patch})}}),null);
  response.payload=m.responsePayload({...reply,deferred:true});
  equal(m.recommend(data,'2026-10-27')[0].scenario.id,'A');
  response.payload=m.responsePayload(reply);
  data.records.push(record('changed','intake',{status:'filed'}));
  equal(m.currentResponse(data,'A'),null);
  equal(m.recommend(data,'2026-10-27')[0].scenario.id,'E');
  const treatment=record('t','treatment',{status:'approved',from:'2026-09-01',to:'2026-10-31',extensionConsidered:true},'official');
  const dueData={...empty(),records:[treatment],deadlines:[]};
  equal(caseDeadlines(dueData.records,'2026-10-17',[]),[],'missing policy never manufactures a legal date');
  for (const [day,action,kind] of [['2026-10-17','treatment_consult','recommended'],['2026-10-21','plan_prepare','recommended'],['2026-10-24','plan_receipt','legal_check']]) {
    dueData.deadlines=[{id:'due',recordId:'t',date:day,action,kind,responsible:'hospital',overdue:false}];
    const advice=m.recommend(dueData,day)[0]; equal(advice.scenario.id,'H'); equal(advice.due.kind,kind); equal(advice.due.date,day);
  }
  dueData.deadlines[0].overdue=true;
  equal(m.recommend(dueData,'2026-11-01')[0].scenario.id,'H');
  equal(todaySeoul(new Date('2026-10-26T15:00:00Z')),'2026-10-27');
  const protectedData={...empty(),records:[treatment,record('leave','benefit_claim',{benefitType:'workers_comp_leave',status:'estimate',incapacityDays:20,allocatedDays:60})]};
  const before=structuredClone(protectedData);m.recommend(protectedData,'2026-10-27');equal(protectedData,before);
  assert(!JSON.stringify(m.SCENARIOS).match(/\d[\d,.]*\s*만원|20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|010[-\d]{8,10}/), 'generic guidance has no personal amount, date or mobile number'); checks++;
  console.log('PRIVATE_ADVISOR_R2_MODEL_PASS checks='+checks+' scenarios=12 unknown_defer_immutable_deadlines_kst_no_decision_writes');
}
